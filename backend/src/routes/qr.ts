import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db/client.js';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { getBrewProfile } from './sommelier.js';
import { getSommelierConfig } from '../services/sommelierConfig.js';
import {
  resolveTokenToCoffeeId,
  isCoffeeRetired,
  getNearestHopCoffeeId,
  resolveQrDisplayName,
  resolveOwnership,
  buildBagView,
  resolveUniversalToken,
  getActiveBagsForProfile,
} from '../services/qrDoor.js';

const router = Router();

// HOME_TASK_7 — no new Firestore config path for this (the environment note
// is explicit: "No new config unless the task file lists it," and the task
// file doesn't list one) — a fixed per-IP limit, same express-rate-limit
// shape Task 3 established in sommelier.ts, just not config-driven. A scan
// endpoint has no per-account concept worth limiting separately (most scans
// are signed out) — per-IP only.
const qrResolveLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests — please slow down.' },
});

type QrAuthState = 'owner' | 'signed_out' | 'non_owner' | 'unresolved' | 'no_orders';
type QrDestination = 'bag_view' | 'sign_in' | 'story_page' | 'retired_story' | 'unknown' | 'bag_picker' | 'brand_landing';
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
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO qr_scan_event (token, coffee_id, auth_state, destination, user_id, token_type, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [token, coffeeId, authState, destination, userId, tokenType, source]
    );
  } catch (err) {
    console.error('[qr] scan event log failed:', err);
  }
}

async function resolveProfileId(uid: string): Promise<string | null> {
  const result = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [uid]);
  return result.rows[0]?.id ?? null;
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
    // Every visitor gets an anonymous Firebase session automatically
    // (AuthContext.tsx signs one in whenever there's no user yet), and
    // getHeaders() sends that anonymous user's ID token on every request —
    // optionalAuth decodes it fine and sets req.uid. Caught live during
    // verification: without this check, a guest's first-ever scan (the
    // strategy doc's own "majority case for a first scan") silently
    // resolved to the public story page instead of the sign-in prompt,
    // because an anonymous uid looks "signed in" to a naive uid check.
    // RequireAuth.tsx already treats isAnonymous as not-really-signed-in
    // (`if (!user || isGuest)`) — mirrored here for the same reason. Reused
    // verbatim for the universal-token branch below, per HOME_TASK_7C's
    // environment note — not re-derived.
    const isRealSignIn = !!req.uid && !req.isAnonymous;
    const profileId = isRealSignIn ? await resolveProfileId(req.uid!) : null;

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

      if (!isRealSignIn) {
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
      await logScanEvent(token, coffeeId, 'owner', 'bag_view', profileId, 'coffee', null);
      res.json({ status: 'owner', coffeeId, displayName: bagView.displayName, card: bagView.card });
      return;
    }

    // HOME_TASK_7C — the universal printed QR (strategy §9, 2026-08-03).
    // Not a per-coffee token; check whether it's one of the (few) minted
    // universal tokens instead. Bag-specificity comes from the scanner's
    // own order history at resolve time, not from the ink.
    const source = await resolveUniversalToken(token);

    if (source !== null) {
      if (!isRealSignIn) {
        await logScanEvent(token, null, 'signed_out', 'sign_in', null, 'universal', source);
        res.json({ status: 'sign_in' });
        return;
      }

      const activeBags = await getActiveBagsForProfile(profileId!);

      if (activeBags.length === 0) {
        await logScanEvent(token, null, 'no_orders', 'brand_landing', profileId, 'universal', source);
        res.json({ status: 'no_orders' });
        return;
      }

      // "Exactly two or more plausible active bags (recent orders within a
      // config window) → a minimal picker. No hard guessing." Below that,
      // always resolve to a single bag — the customer's single most recent
      // order, even if it happens to fall outside the window, rather than
      // ever falling back to the no-orders state once we know they have
      // real order history.
      const activeBagWindowDays = getSommelierConfig()?.qr?.activeBagWindowDays ?? 45;
      const windowMs = activeBagWindowDays * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const withinWindow = activeBags.filter(b => now - new Date(b.mostRecentOrderAt).getTime() <= windowMs);
      const candidates = withinWindow.length >= 2 ? withinWindow : [activeBags[0]];

      const brewProfile = await getBrewProfile(req.uid!);

      if (candidates.length >= 2) {
        const bags = await Promise.all(
          candidates.map(async (b) => {
            const view = await buildBagView(profileId!, b.coffeeId, brewProfile);
            return { coffeeId: b.coffeeId, displayName: view.displayName, card: view.card };
          })
        );
        await logScanEvent(token, null, 'owner', 'bag_picker', profileId, 'universal', source);
        res.json({ status: 'picker', bags });
        return;
      }

      const singleCoffeeId = candidates[0].coffeeId;
      const bagView = await buildBagView(profileId!, singleCoffeeId, brewProfile);
      await logScanEvent(token, singleCoffeeId, 'owner', 'bag_view', profileId, 'universal', source);
      res.json({ status: 'owner', coffeeId: singleCoffeeId, displayName: bagView.displayName, card: bagView.card });
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

export default router;
