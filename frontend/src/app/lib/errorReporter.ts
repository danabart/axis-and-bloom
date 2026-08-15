// Global client error reporter — Observability Foundation Part C (see
// OBSERVABILITY_POLICY.md at the repo root). This is what makes client-side
// errors visible at all — the browser console is otherwise the only place
// they exist. Two entry points: initErrorReporter() hooks window.onerror +
// window.onunhandledrejection for anything that escapes every boundary;
// reportError(tag, err, context?) is called explicitly from catch blocks
// (Part D) that already know what failed.
//
// Hard rule: this module must never throw or recurse. A failure here would
// mean an error handler causing a new error — swallow everything internally.
//
// Deliberately no auth token attached to the POST: keeping this module free
// of the Firebase Auth import chain means it can never fail because *that*
// failed. The backend's optionalAuth just sees no token from a reporter
// call and records uid as null — acceptable, since this is weekly-reviewed
// aggregate signal, not per-user support data.

const MAX_PER_SIGNATURE = 3;
const MAX_TOTAL = 20;

// Module-level (not sessionStorage) — resets on a full page reload, not on
// SPA client-side navigation. That's "per session" for how this app is
// actually used: a reload is rare, and avoids storage-quota/serialization
// concerns for a purely load-bearing safety mechanism.
const perSignatureCount = new Map<string, number>();
let totalReported = 0;

function computeSignature(message: string, source: string): string {
  return `${message}::${source}`.slice(0, 200);
}

function send(message: string, stack: string | undefined, signature: string): void {
  try {
    if (totalReported >= MAX_TOTAL) return;
    const count = (perSignatureCount.get(signature) ?? 0) + 1;
    if (count > MAX_PER_SIGNATURE) return;
    perSignatureCount.set(signature, count);
    totalReported++;

    const route = window.location.pathname;
    fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.slice(0, 2000), stack, route, signature, count }),
      keepalive: true, // survives a navigation that happens right after the error
    }).catch(() => {}); // fire-and-forget — a failed report is not itself reported
  } catch {
    // Constructing/sending the report itself failed — swallow. This
    // function is the last line; there is nowhere else for this to go.
  }
}

/** For use inside catch blocks (Part D) that already know what failed. */
export function reportError(tag: string, err: unknown, context?: object): void {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const contextSuffix = context ? ` ${safeStringify(context)}` : '';
    const signature = computeSignature(`${tag}: ${message}`, tag);
    send(`${tag}: ${message}${contextSuffix}`, stack, signature);
  } catch {
    // Never let a reporting call throw back into the caller's catch block.
  }
}

function safeStringify(value: object): string {
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return '[unserializable context]';
  }
}

let initialized = false;

/** Call once at app startup (main.tsx), before render. */
export function initErrorReporter(): void {
  if (initialized) return;
  initialized = true;

  window.onerror = (message, source, lineno, colno, error) => {
    try {
      const msg = typeof message === 'string' ? message : 'Unknown error';
      const src = `${source ?? window.location.pathname}:${lineno ?? '?'}:${colno ?? '?'}`;
      send(msg, error?.stack, computeSignature(msg, src));
    } catch {
      // see module-level rule
    }
    return false; // don't suppress the browser's own default handling
  };

  window.onunhandledrejection = (event) => {
    try {
      const reason = event.reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;
      send(msg, stack, computeSignature(msg, 'unhandledrejection'));
    } catch {
      // see module-level rule
    }
  };
}
