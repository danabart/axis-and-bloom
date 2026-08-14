import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import type { AuthRequest } from './auth.js';

// api_event capture-first log (2026-08-13). Single app-level middleware,
// mounted once in index.ts after appCheckGate and before every router --
// see backend/src/features/api_event_log/CLAUDE_CODE_PROMPT_API_EVENT_LOG.md
// for the full design rationale. Zero per-route work by construction: any
// route that exists today, or any route added in the future, is captured
// automatically as long as it's mounted under this app.
//
// Hard requirement: this middleware can never fail, slow, or otherwise
// change a request. Both DB writes are fire-and-forget (never awaited in
// the request path); every code path here is wrapped so an internal error
// degrades to "no log row," never to a 500 or an added delay.

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SKIP_PATH_PREFIXES = ['/api/cron', '/api/webhooks'];
const REDACT_KEY_PATTERN = /password|passwd|secret|token|authorization|apikey|api_key|card|cvv|cvc/i;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_RESPONSE_ERROR_BYTES = 2 * 1024;

// UUIDs, purely-numeric ids, and long opaque tokens (Firebase uids, QR
// tokens, etc.) all collapse to ':id' so call_type stays stable across
// individual records instead of minting one type per id.
const ID_SEGMENT_PATTERNS = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\d+$/,
  /^[A-Za-z0-9_-]{20,}$/,
];

function isIdSegment(segment: string): boolean {
  return ID_SEGMENT_PATTERNS.some((pattern) => pattern.test(segment));
}

function normalizeIdSegments(path: string): string {
  return path
    .split('/')
    .map((segment) => (segment && isIdSegment(segment) ? ':id' : segment))
    .join('/');
}

function shouldCapture(req: Request): boolean {
  if (!MUTATING_METHODS.has(req.method)) return false;
  if (req.path === '/health') return false;
  if (SKIP_PATH_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) return false;
  return true;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEY_PATTERN.test(key) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

// Truncates a redacted JSON-able value to fit `maxBytes`. Under budget: the
// value passes through unchanged. Over budget: the marker object from the
// spec, merged with as many first-level keys (or array indices, via
// Object.entries) as fit within the byte budget, in original order.
function truncate(value: unknown, maxBytes: number): { value: unknown; truncated: boolean } {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? 'null';
  } catch {
    return { value: null, truncated: true };
  }
  const originalBytes = Buffer.byteLength(serialized, 'utf-8');
  if (originalBytes <= maxBytes) return { value, truncated: false };

  const marker: Record<string, unknown> = { _truncated: true, _originalBytes: originalBytes };
  let usedBytes = Buffer.byteLength(JSON.stringify(marker), 'utf-8');
  if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      let entryBytes: number;
      try {
        entryBytes = Buffer.byteLength(JSON.stringify({ [key]: v }), 'utf-8');
      } catch {
        continue;
      }
      if (usedBytes + entryBytes > maxBytes) continue;
      marker[key] = v;
      usedBytes += entryBytes;
    }
  }
  return { value: marker, truncated: true };
}

// call_type derivation, stable across ids. Once a route has matched,
// req.route.path is the router-relative pattern (e.g. '/:id/cancel') --
// combined with req.baseUrl (the router's mount prefix) that yields
// 'POST /api/orders/:id/cancel'. Before any route matches (404s), fall
// back to method + path with id-shaped segments normalized.
function deriveCallType(req: Request): string {
  // req.route is typed `any` by Express -- present once a route has
  // matched, populated with the router-relative pattern in `.path`.
  const routePath: string | undefined = req.route?.path;
  if (routePath !== undefined) {
    return `${req.method} ${req.baseUrl}${routePath === '/' ? '' : routePath}`;
  }
  return `${req.method} ${normalizeIdSegments(req.path)}`;
}

export function apiEventLog(req: Request, res: Response, next: NextFunction): void {
  try {
    if (!shouldCapture(req)) { next(); return; }

    const id = randomUUID();
    res.locals.apiEventId = id;
    const startedAtNs = process.hrtime.bigint();
    const path = req.path;
    const provisionalCallType = `${req.method} ${path}`;

    let requestBody: unknown = null;
    let bodyTruncated = false;
    const rawBody = req.body;
    if (rawBody && typeof rawBody === 'object') {
      const { value, truncated } = truncate(redact(rawBody), MAX_REQUEST_BODY_BYTES);
      requestBody = value;
      bodyTruncated = truncated;
    }

    db.query(
      `INSERT INTO api_event (id, call_type, method, path, request_body, body_truncated)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, provisionalCallType, req.method, path, requestBody === null ? null : JSON.stringify(requestBody), bodyTruncated]
    ).catch((err) => console.error('[apiEventLog/insert]', err));

    // Capture the outgoing body without altering it or the response --
    // needed to fill response_error on failures, since Express gives no
    // other hook into what a handler actually sent. Guarded independently
    // of everything above so a bug here can never throw into the handler.
    let responseBodyCaptured = false;
    let responseBody: unknown;
    try {
      const originalJson = res.json.bind(res);
      res.json = ((body?: unknown) => {
        if (!responseBodyCaptured) { responseBody = body; responseBodyCaptured = true; }
        return originalJson(body);
      }) as typeof res.json;
      const originalSend = res.send.bind(res);
      res.send = ((body?: unknown) => {
        if (!responseBodyCaptured) { responseBody = body; responseBodyCaptured = true; }
        return originalSend(body);
      }) as typeof res.send;
    } catch (err) {
      console.error('[apiEventLog/wrap-response]', err);
    }

    res.on('finish', () => {
      try {
        const durationMs = Number(process.hrtime.bigint() - startedAtNs) / 1e6;
        const callType = deriveCallType(req);
        const authReq = req as AuthRequest;
        const firebaseUid = authReq.uid ?? null;
        const isAnonymous = authReq.isAnonymous ?? null;

        let responseError: unknown = null;
        if (res.statusCode >= 400 && responseBodyCaptured) {
          const { value } = truncate(redact(responseBody), MAX_RESPONSE_ERROR_BYTES);
          responseError = value;
        }

        db.query(
          `UPDATE api_event
           SET call_type = $1, firebase_uid = $2, is_anonymous = $3,
               response_status = $4, response_error = $5, duration_ms = $6
           WHERE id = $7`,
          [
            callType,
            firebaseUid,
            isAnonymous,
            res.statusCode,
            responseError === null ? null : JSON.stringify(responseError),
            Math.round(durationMs),
            id,
          ]
        ).catch((err) => console.error('[apiEventLog/update-finish]', err));
      } catch (err) {
        console.error('[apiEventLog/finish-handler]', err);
      }
    });

    res.on('close', () => {
      try {
        if (res.writableEnded) return; // 'finish' already handled this response
        const durationMs = Number(process.hrtime.bigint() - startedAtNs) / 1e6;
        db.query(`UPDATE api_event SET duration_ms = $1 WHERE id = $2`, [Math.round(durationMs), id])
          .catch((err) => console.error('[apiEventLog/update-close]', err));
      } catch (err) {
        console.error('[apiEventLog/close-handler]', err);
      }
    });

    next();
  } catch (err) {
    console.error('[apiEventLog/middleware]', err);
    next();
  }
}
