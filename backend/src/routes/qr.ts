import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db/client.js';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { getRealClientIp } from '../middleware/clientIp.js';
import { getBrewProfile } from './sommelier.js';
import {
  resolveTokenToCoffeeId,
  isCoffeeRetired,
  getNearestHopCoffeeId,
  resolveQrDisplayName,
  resolveOwnership,
  buildBagView,
  resolveUniversalToken,
  resolveUniversalScan,
  getOrMintCanonicalUniversalToken,
  findOwnedOrderLineItem,
} from '../services/qrDoor.js';
import { record } from '../services/customerFacts.js';

const router = Router();

// HOME_TASK_7 — no new Firestore config path for this (the environment note
// is explicit: "No new config unless the task file lists it," and the task
// file doesn't list one) — a fixed per-IP limit, same express-rate-limit
// shape Task 3 established in sommelier.ts, just not config-driven. A scan
// endpoint has no per-account concept worth limiting separately (most scans
// are signed out) — per-IP only.
// C17 — keyed on the real visitor IP (see middleware/clientIp.ts); req.ip
// alone collapses behind Cloudflare -> Firebase Hosting -> Cloud Run.
const qrResolveLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: getRealClientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests — please slow down.' },
});

type QrAuthState = 'owner' | 'signed_out' | 'non_owner' | 'unresolved' | 'no_orders';
type QrDestination = 'bag_view' | 'sign_in' | 'story_page' | 'retired_story' | 'unknown' | 'bag_picker' | 'brand_landing' | 'door_choice';
type QrTokenType = 'coffee' | 'universal';

// Scan-analytics point (§3.1 closing pass; token_type/source added
// HOME_TASK_7C) — every resolve logs exactly one row, regardless of
// outcome. Fire-and-forget-safe (awaited here, but a logging failure must
// never break the redirect itself) — wrapped so a write error surfaces in
// logs without 500ing the actual scan.
async function logScanEvent(
  token: string,
  coffeeId: number | null,
  authState: QrAuthState,
  destination: QrDestination,
  userId: string | null,
  tokenType: QrTokenType,
  source: string | null
): Promise<number | null> {
  try {
    const result = await db.query<{ id: number }>(
      `INSERT INTO qr_scan_event (token, coffee_id, auth_state, destination, user_id, token_type, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [token, coffeeId, authState, destination, userId, tokenType, source]
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    console.error('[qr] scan event log failed:', err);
    return null;
  }
}

async function resolveProfileId(uid: string): Promise<string | null> {
  const result = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [uid]);
  return result.rows[0]?.id ?? null;
}

// Every visitor gets an anonymous Firebase session automatically
// (AuthContext.tsx signs one in whenever there's no user yet), and
// getHeaders() sends that anonymous user's ID token on every request —
// optionalAuth decodes it fine and sets req.uid. Caught live during
// HOME_TASK_7 verification: without this check, a guest's first-ever scan
// silently resolved as "signed in", because an anonymous uid looks signed in
// to a naive uid check. RequireAuth.tsx already treats isAnonymous as
// not-really-signed-in (`if (!user || isGuest)`) — mirrored here. Shared by
// both resolve routes below (bag_qr, 2026-10-05), not re-derived.
function isRealSignIn(req: AuthRequest): boolean {
  return !!req.uid && !req.isAnonymous;
}

// bag_qr (2026-10-05) — the universal branch's request plumbing, shared by
// the long form (/:token/resolve) and the bare printed address (/resolve).
// The decision itself lives in resolveUniversalScan() (services/qrDoor.ts).
// One log row per scan, carrying the real token + source either way, so a
// bare /b scan is indistinguishable in qr_scan_event from a long-form one.
async function respondUniversal(
  res: Response,
  token: string,
  source: string,
  realSignIn: boolean,
  profileId: string | null
): Promise<void> {
  const outcome = await resolveUniversalScan(realSignIn, profileId);
  await logScanEvent(token, null, outcome.authState, outcome.destination, profileId, 'universal', source);
  res.json({ status: outcome.status });
}

// ─── GET /api/qr/:token/resolve ────────────────────────────────────────────
// Public — no auth required to resolve (optionalAuth decodes a token if
// present, never rejects if absent). Auth state only changes the
// destination. This is the frontend's /b/:token page's one call — the
// literal "/b/{token}" path itself can't exist as a bare Express route since
// every backend router here mounts under /api/* (index.ts); the frontend SPA
// owns the /b/:token URL and asks this endpoint what to render, the same
// split /coffee/:id/story already uses against GET /api/coffees/:id/story.
router.get('/:token/resolve', qrResolveLimiter, optionalAuth, async (req: AuthRequest, res) => {
  const { token } = req.params;
  try {
    // Anonymous is NOT signed in — see isRealSignIn() above.
    const realSignIn = isRealSignIn(req);
    const profileId = realSignIn ? await resolveProfileId(req.uid!) : null;

    // Per-coffee token first (unchanged from HOME_TASK_7) — this is still
    // the digital-link path (story pages, emails). Only if it doesn't match
    // do we check the universal token below.
    const coffeeId = await resolveTokenToCoffeeId(token);

    if (coffeeId !== null) {
      if (await isCoffeeRetired(coffeeId)) {
        const [displayName, nearestHopCoffeeId] = await Promise.all([
          resolveQrDisplayName(coffeeId),
          getNearestHopCoffeeId(coffeeId),
        ]);
        await logScanEvent(token, coffeeId, 'unresolved', 'retired_story', profileId, 'coffee', null);
        res.json({ status: 'retired', coffeeId, displayName, nearestHopCoffeeId });
        return;
      }

      if (!realSignIn) {
        await logScanEvent(token, coffeeId, 'signed_out', 'sign_in', null, 'coffee', null);
        res.json({ status: 'sign_in' });
        return;
      }

      const { isOwner } = await resolveOwnership(req.uid!, coffeeId);

      if (!isOwner) {
        await logScanEvent(token, coffeeId, 'non_owner', 'story_page', profileId, 'coffee', null);
        res.json({ status: 'non_owner', coffeeId });
        return;
      }

      const brewProfile = await getBrewProfile(req.uid!);
      const bagView = await buildBagView(profileId!, coffeeId, brewProfile);
      const scanEventId = await logScanEvent(token, coffeeId, 'owner', 'bag_view', profileId, 'coffee', null);
      // Customer Blueprint C2, Part A5 — dual-write into customer_bag_claim.
      // Coffee-token owner scans only: the universal-token owner path below
      // has no single coffee to attribute a claim to (it's an account-level
      // "you have some bag" check via hasAnyOrderOrSponsorship(), not tied to
      // one coffee) — customer_bag_claim.coffee_id is NOT NULL, so that path
      // is deliberately skipped (Task 0, approved). A second scan of the same
      // bag is a new scan event and a new claim row (different sourceId); C3's
      // attribution read takes the earliest.
      if (scanEventId !== null) {
        try {
          const orderLineItemId = await findOwnedOrderLineItem(profileId!, coffeeId);
          await record.bagClaim({
            userId: profileId!, source: 'qr', sourceId: String(scanEventId),
            qrScanEventId: scanEventId, coffeeId, orderLineItemId,
          });
        } catch (err) {
          console.error('[customerFacts:bag-claim]', err);
        }
      }
      res.json({ status: 'owner', coffeeId, displayName: bagView.displayName, card: bagView.card });
      return;
    }

    // HOME_TASK_7C — the universal printed QR (strategy §9, 2026-08-03).
    // Not a per-coffee token; check whether it's one of the (few) minted
    // universal tokens instead — including 7c's now-dormant 'temecula' row
    // (HOME_TASK_7E, decision #0), which still resolves through this exact
    // branch, just never surfaced on the admin page or minted again.
    const source = await resolveUniversalToken(token);

    // HOME_TASK_7E (decision #1, amends 7c) — a signed-in universal scan
    // lands on /profile (customer, 'owner'/'bag_view') or the quiz (not a
    // customer, 'no_orders'/'brand_landing'). bag_qr (2026-10-05) — signed
    // out now gets the two-door page ('signed_out'/'door_choice'), and the
    // whole branch is shared with the bare /resolve route below, so the long
    // form /b/<canonical token> behaves identically to the printed /b.
    if (source !== null) {
      await respondUniversal(res, token, source, realSignIn, profileId);
      return;
    }

    // Neither a per-coffee nor a universal token matched.
    await logScanEvent(token, null, 'unresolved', 'unknown', profileId, 'coffee', null);
    res.status(404).json({ status: 'unknown' });
  } catch (err) {
    console.error('[qr/:token/resolve]', err);
    res.status(500).json({ error: 'Failed to resolve code' });
  }
});

// ─── GET /api/qr/resolve ───────────────────────────────────────────────────
// bag_qr (2026-10-05) — the bare printed address, /b. The ink carries no
// token, so this is a permanent alias for the ONE canonical universal token
// (CANONICAL_UNIVERSAL_QR_SOURCE, HOME_TASK_7E decision #0): it fetches that
// token (minting it on first call, idempotent) and runs the exact same
// universal branch as /:token/resolve. Never 404s — there is nothing to
// mistype in the ink.
router.get('/resolve', qrResolveLimiter, optionalAuth, async (req: AuthRequest, res) => {
  try {
    const realSignIn = isRealSignIn(req);
    const profileId = realSignIn ? await resolveProfileId(req.uid!) : null;
    const { source, token } = await getOrMintCanonicalUniversalToken();
    await respondUniversal(res, token, source, realSignIn, profileId);
  } catch (err) {
    console.error('[qr/resolve]', err);
    res.status(500).json({ error: 'Failed to resolve code' });
  }
});

export default router;
