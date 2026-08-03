import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db/client.js';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { getBrewProfile } from './sommelier.js';
import {
  resolveTokenToCoffeeId,
  isCoffeeRetired,
  getNearestHopCoffeeId,
  resolveQrDisplayName,
  resolveOwnership,
  buildBagView,
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

type QrAuthState = 'owner' | 'signed_out' | 'non_owner' | 'unresolved';
type QrDestination = 'bag_view' | 'sign_in' | 'story_page' | 'retired_story' | 'unknown';

// Scan-analytics point (§3.1 closing pass) — every resolve logs exactly one
// row, regardless of outcome. Fire-and-forget-safe (awaited here, but a
// logging failure must never break the redirect itself) — wrapped so a
// write error surfaces in logs without 500ing the actual scan.
async function logScanEvent(
  token: string,
  coffeeId: number | null,
  authState: QrAuthState,
  destination: QrDestination,
  userId: string | null
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO qr_scan_event (token, coffee_id, auth_state, destination, user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [token, coffeeId, authState, destination, userId]
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
    // (`if (!user || isGuest)`) — mirrored here for the same reason.
    const isRealSignIn = !!req.uid && !req.isAnonymous;

    const coffeeId = await resolveTokenToCoffeeId(token);
    const profileId = isRealSignIn ? await resolveProfileId(req.uid!) : null;

    if (coffeeId === null) {
      await logScanEvent(token, null, 'unresolved', 'unknown', profileId);
      res.status(404).json({ status: 'unknown' });
      return;
    }

    if (await isCoffeeRetired(coffeeId)) {
      const [displayName, nearestHopCoffeeId] = await Promise.all([
        resolveQrDisplayName(coffeeId),
        getNearestHopCoffeeId(coffeeId),
      ]);
      await logScanEvent(token, coffeeId, 'unresolved', 'retired_story', profileId);
      res.json({ status: 'retired', coffeeId, displayName, nearestHopCoffeeId });
      return;
    }

    if (!isRealSignIn) {
      await logScanEvent(token, coffeeId, 'signed_out', 'sign_in', null);
      res.json({ status: 'sign_in' });
      return;
    }

    const { isOwner } = await resolveOwnership(req.uid!, coffeeId);

    if (!isOwner) {
      await logScanEvent(token, coffeeId, 'non_owner', 'story_page', profileId);
      res.json({ status: 'non_owner', coffeeId });
      return;
    }

    const brewProfile = await getBrewProfile(req.uid!);
    const bagView = await buildBagView(profileId!, coffeeId, brewProfile);
    await logScanEvent(token, coffeeId, 'owner', 'bag_view', profileId);
    res.json({ status: 'owner', coffeeId, displayName: bagView.displayName, card: bagView.card });
  } catch (err) {
    console.error('[qr/:token/resolve]', err);
    res.status(500).json({ error: 'Failed to resolve code' });
  }
});

export default router;
