import { randomBytes } from 'crypto';
import { db } from '../db/client.js';
import { getAliases } from './sommelierRag.js';
import { getMostRecentCard, generateCard, resolveDefaultMethod, type BrewCardRow } from './brewCard.js';
import type { BrewProfileDoc } from './brewProfile.js';

// HOME_TASK_7 (§3.1, QR indirection) — "One code per coffee, not per bag ...
// The ink encodes only an opaque token bound to the coffee's stable id —
// never an alias, never a name ... never print a URL whose meaning is
// fixed — print a pointer the server re-aims." This file is the redirect
// endpoint's whole resolution seam: token <-> coffee, retired/active,
// ownership, and the nearest-hop fallback for a retired coffee — kept out of
// routes/qr.ts so the route file stays thin request/response plumbing, same
// split as brewCard.ts/sommelier.ts.

const TOKEN_BYTES = 16; // -> 32 hex chars, well over the spec's "≥16 chars" floor

export function generateQrToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

// Token -> coffeeId cache, per the spec: "Cache the token→coffee resolution
// in memory; the ownership check stays live per request." A 5-minute TTL
// rather than indefinite — an admin correcting a data-entry mistake before
// print (the only legitimate reason a token's coffee_id would ever change)
// becomes visible without a restart, without adding invalidation plumbing
// for something this rare.
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const tokenCache = new Map<string, { coffeeId: number | null; cachedAt: number }>();

export async function resolveTokenToCoffeeId(token: string): Promise<number | null> {
  const cached = tokenCache.get(token);
  if (cached && Date.now() - cached.cachedAt < TOKEN_CACHE_TTL_MS) {
    return cached.coffeeId;
  }
  const result = await db.query(`SELECT id FROM coffees WHERE qr_token = $1`, [token]);
  const coffeeId: number | null = result.rows[0]?.id ?? null;
  tokenCache.set(token, { coffeeId, cachedAt: Date.now() });
  return coffeeId;
}

export function invalidateTokenCache(token?: string): void {
  if (token) tokenCache.delete(token);
  else tokenCache.clear();
}

// Mint — idempotent, never regenerates an existing token (print immutability
// cuts both ways: the token can't change once it might already be in ink).
// The unique partial index on coffees.qr_token is the actual guarantee
// against a collision; the retry loop below is belt-and-suspenders against
// the astronomically unlikely case, not the primary defense.
export async function mintTokenForCoffee(coffeeId: number): Promise<string> {
  const existing = await db.query(`SELECT qr_token FROM coffees WHERE id = $1`, [coffeeId]);
  if (!existing.rows.length) throw new Error(`Coffee ${coffeeId} not found`);
  if (existing.rows[0].qr_token) return existing.rows[0].qr_token;

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = generateQrToken();
    try {
      const updated = await db.query(
        `UPDATE coffees SET qr_token = $2 WHERE id = $1 AND qr_token IS NULL RETURNING qr_token`,
        [coffeeId, token]
      );
      if (updated.rows.length) return updated.rows[0].qr_token;
      // Someone minted concurrently between the SELECT above and here.
      const recheck = await db.query(`SELECT qr_token FROM coffees WHERE id = $1`, [coffeeId]);
      if (recheck.rows[0]?.qr_token) return recheck.rows[0].qr_token;
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== '23505') throw err; // not a unique-violation on qr_token — rethrow
    }
  }
  throw new Error(`Failed to mint a unique qr_token for coffee ${coffeeId} after 3 attempts`);
}

export async function mintTokensForAllCoffees(): Promise<{ minted: number[]; alreadyMinted: number[] }> {
  const result = await db.query(`SELECT id, qr_token FROM coffees ORDER BY id`);
  const minted: number[] = [];
  const alreadyMinted: number[] = [];
  for (const row of result.rows as { id: number; qr_token: string | null }[]) {
    if (row.qr_token) { alreadyMinted.push(row.id); continue; }
    await mintTokenForCoffee(row.id);
    minted.push(row.id);
  }
  return { minted, alreadyMinted };
}

// ─── HOME_TASK_7C — the universal printed QR (strategy §9, 2026-08-03) ─────
// "The printed QR is universal — one identical code on every bag, every
// coffee, both roasteries." A second, additive token type: not bound to a
// coffee, one per roastery/print run, resolved through this same
// /b/{token} endpoint. Per-coffee tokens above are untouched — they remain
// for digital links only.

// The two real roasteries this catalog has today (Path Coffee Roasters,
// Temecula Coffee Roasters — see roaster.name in prod). A short, stable
// source code per roastery, not a raw name (same naming discipline as
// everything customer-facing, even though this label is admin/analytics
// only, never shown to a customer). New roasteries mean a new source code
// added here and minted once — this list is deliberately not DB-derived
// from the `roaster` table, since a universal print run is a print-artwork
// decision Dana makes, not something that should auto-mint the moment a new
// roaster row is created.
export const UNIVERSAL_QR_SOURCES = ['path', 'temecula'] as const;

// ─── HOME_TASK_7E — exactly ONE universal token (2026-08-04, amends 7c) ────
// Dana ruled the per-roastery print-run split (above) not worth carrying two
// artwork variants. 'path' is the token that ships in ink — chosen
// arbitrarily between the two 7c already minted, since the task's own words
// are "pick one as canonical," not "pick which one." UNIVERSAL_QR_SOURCES
// stays as-is (unchanged type/history for the `source` column, and
// resolveUniversalToken() below still resolves either by row lookup, not by
// this list) — only the admin surface and future minting narrow to one.
// 'temecula's existing row is left in place, untouched: it keeps resolving
// through the exact same code path as 'path', just never minted again and
// never returned by the admin endpoint. Same "keep working, surface
// nowhere" discipline as per-coffee token retirement (item 2 of this task).
export const CANONICAL_UNIVERSAL_QR_SOURCE = 'path';

// Idempotent, same immutability rule as mintTokenForCoffee: never regenerate
// a source's token once it exists (it may already be printed).
export async function mintUniversalToken(source: string): Promise<string> {
  const existing = await db.query(`SELECT token FROM qr_universal_token WHERE source = $1`, [source]);
  if (existing.rows.length) return existing.rows[0].token;

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = generateQrToken();
    try {
      const inserted = await db.query(
        `INSERT INTO qr_universal_token (token, source) VALUES ($1, $2)
         ON CONFLICT (source) DO NOTHING
         RETURNING token`,
        [token, source]
      );
      if (inserted.rows.length) return inserted.rows[0].token;
      // Someone minted concurrently between the SELECT above and here.
      const recheck = await db.query(`SELECT token FROM qr_universal_token WHERE source = $1`, [source]);
      if (recheck.rows[0]?.token) return recheck.rows[0].token;
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== '23505') throw err; // not a unique-violation on token — rethrow
    }
  }
  throw new Error(`Failed to mint a unique universal qr token for source ${source} after 3 attempts`);
}

export async function mintMissingUniversalTokens(): Promise<{ minted: string[]; alreadyMinted: string[] }> {
  const existingResult = await db.query(`SELECT source FROM qr_universal_token`);
  const existingSources = new Set(existingResult.rows.map((r: { source: string }) => r.source));
  const minted: string[] = [];
  const alreadyMinted: string[] = [];
  for (const source of UNIVERSAL_QR_SOURCES) {
    if (existingSources.has(source)) { alreadyMinted.push(source); continue; }
    await mintUniversalToken(source);
    minted.push(source);
  }
  return { minted, alreadyMinted };
}

export interface UniversalTokenRow {
  source: string;
  token: string;
}

export async function listUniversalTokens(): Promise<UniversalTokenRow[]> {
  const result = await db.query(`SELECT source, token FROM qr_universal_token ORDER BY source`);
  return result.rows;
}

// HOME_TASK_7E — the admin page's own "one printed URL" (decision #0). Mints
// the canonical source on first call if 7c's original mint-missing pass
// somehow hadn't reached it yet; idempotent, same as mintUniversalToken.
export async function getOrMintCanonicalUniversalToken(): Promise<UniversalTokenRow> {
  const token = await mintUniversalToken(CANONICAL_UNIVERSAL_QR_SOURCE);
  return { source: CANONICAL_UNIVERSAL_QR_SOURCE, token };
}

// Same 5-minute-TTL cache pattern as resolveTokenToCoffeeId — a distinct
// cache since a universal token never resolves to a coffeeId at all.
const universalTokenCache = new Map<string, { source: string | null; cachedAt: number }>();

export async function resolveUniversalToken(token: string): Promise<string | null> {
  const cached = universalTokenCache.get(token);
  if (cached && Date.now() - cached.cachedAt < TOKEN_CACHE_TTL_MS) {
    return cached.source;
  }
  const result = await db.query(`SELECT source FROM qr_universal_token WHERE token = $1`, [token]);
  const source: string | null = result.rows[0]?.source ?? null;
  universalTokenCache.set(token, { source, cachedAt: Date.now() });
  return source;
}

// HOME_TASK_7E — the universal-token resolve's only remaining question:
// "has this profile ever ordered, or been sponsored, at all?" Supersedes
// 7c's getActiveBagsForProfile (deleted — no per-coffee grouping, no
// recency window, no roaster_blend join needed, since the destination is
// /profile either way and the profile page already shows every card).
// Same personal-order-or-sponsorship union resolveOwnership() checks
// per-coffee, just without a coffee_id filter.
export async function hasAnyOrderOrSponsorship(profileId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM order_line_item li
     JOIN "order" o ON o.id = li.order_id
     WHERE o.user_id = $1 OR li.intended_for_user_id = $1
     LIMIT 1`,
    [profileId]
  );
  return result.rows.length > 0;
}

// "Retired/inactive" has no dedicated column on coffees (checked — none
// exists). Closest real signal: a coffee is fulfillable only through an
// active roaster_blend row, so "no active roaster_blend" is treated as
// retired. This is an inferred convention, not a documented one — recorded
// as a decision in the build log, not assumed silently.
export async function isCoffeeRetired(coffeeId: number): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM roaster_blend WHERE coffee_id = $1 AND is_active = true LIMIT 1`,
    [coffeeId]
  );
  return result.rows.length === 0;
}

// Nearest recommended hop, for a retired coffee's "this one's moved on —
// here's its closest relative" destination. Deliberately queries
// dial_coffee_relationships directly rather than the v_dial_navigation view
// sommelierRag.ts uses: the view's definition checked into schema.sql
// (from bloom_dial_seed_2026_06_23.sql) only exposes from_coffee/to_coffee
// as *names*, but sommelierRag.ts's own live queries select
// vdn.from_coffee_id/to_coffee_id — columns the checked-in view definition
// doesn't have. That only works if the live view was altered directly
// against prod at some point after the seed migration and schema.sql was
// never updated to match — a real, unflagged instance of the exact
// seed-vs-live drift Task 1 exists to catch, just for a view instead of
// config. Not this task's job to fix (out of scope, and re-running
// schema.sql's stale CREATE VIEW would silently break sommelierRag.ts's
// working queries against the live view — a landmine, not a cleanup).
// Querying the base table's columns, which I verified directly against
// schema.sql byte-for-byte, sidesteps the drift entirely. Flagged in the
// build log for whoever next touches the Bloom Dial views.
export async function getNearestHopCoffeeId(coffeeId: number): Promise<number | null> {
  const result = await db.query(
    `SELECT to_coffee_id AS id
     FROM dial_coffee_relationships
     WHERE from_coffee_id = $1 AND to_coffee_id IS NOT NULL AND is_recommended = true
     ORDER BY CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END
     LIMIT 1`,
    [coffeeId]
  );
  return result.rows[0]?.id ?? null;
}

// Display name for a single coffee — same S44-correct join as everywhere
// else (getAliases(), not reinvented), falling back to the archetype label,
// never the raw name. sommelier.ts's own resolveCoffeeDisplayNames() does
// the identical thing for a batch but isn't exported (per that file's own
// "keep your own inline copy" precedent for resolveProfileId, S79) — this is
// the single-coffee equivalent for the QR resolve response.
export async function resolveQrDisplayName(coffeeId: number): Promise<string> {
  const [aliasMap, archetypeResult] = await Promise.all([
    getAliases([coffeeId]),
    db.query(
      `SELECT aa.archetype::text AS archetype FROM archetype_assignments aa
       WHERE aa.coffee_id = $1 AND aa.superseded_at IS NULL LIMIT 1`,
      [coffeeId]
    ),
  ]);
  const archetype = archetypeResult.rows[0]?.archetype as string | undefined;
  const archetypeLabel = archetype
    ? archetype.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
    : null;
  return aliasMap.get(coffeeId) ?? archetypeLabel ?? 'This coffee';
}

async function resolveProfileId(uid: string): Promise<string | null> {
  const result = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [uid]);
  return result.rows[0]?.id ?? null;
}

// Ownership, split into two independently pluggable checks per the task's
// environment note. checkPersonalOrderOwnership is the plain case: this
// profile placed a real order containing this coffee. Same
// order_line_item -> roaster_blend -> coffee_id path brewCard.ts's
// getBagNumberForCoffee() and users.ts's flavor-memory route already use.
export async function checkPersonalOrderOwnership(profileId: string, coffeeId: number): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM order_line_item li
     JOIN "order" o ON o.id = li.order_id
     JOIN roaster_blend rb ON rb.id = li.blend_id
     WHERE o.user_id = $1 AND rb.coffee_id = $2
     LIMIT 1`,
    [profileId, coffeeId]
  );
  return result.rows.length > 0;
}

// checkSponsorshipOwnership — the "B2B sponsorship must also confer
// ownership" resolver (strategy closing pass). The B2B sponsorship data
// model (company_gift/company_gift_code/user_profile.company_gift_id,
// routes/companyGiftRedemption.ts) links a company to a subscription, but
// nothing in it links a specific order/order_line to a specific coffee —
// and since a sponsored employee's fulfillment orders already carry
// order.user_id = that employee's own profile, checkPersonalOrderOwnership
// above already covers the common case.
//
// The one real, already-in-schema seam for the case where it *wouldn't*
// (an order placed on an employee's behalf, attributed to someone else's
// login) is order_line_item.intended_for_user_id — present in schema.sql
// since before this task, referenced nowhere in backend/src until now
// (grepped, confirmed zero reads/writes). This is not an invented column —
// per the environment note's "do NOT invent a sponsorship schema"
// instruction, this check only reads a column that already exists. Nothing
// in the checkout/gifting flow writes to it yet, so this check will
// honestly return false for every real scan until that flow does — logged
// below as a TODO for the B2B workstream, not silently glossed over.
//
// Kept as its own exported function (not inlined into the personal check)
// specifically so it's independently testable — the seam the environment
// note asked for: a test can insert a marked test order_line_item with
// intended_for_user_id set and prove the bag-view path resolves through
// this function alone, without needing a real B2B checkout flow to exist.
export async function checkSponsorshipOwnership(profileId: string, coffeeId: number): Promise<boolean> {
  // TODO(B2B workstream): order_line_item.intended_for_user_id is never
  // written by any current checkout/gifting path (company_gift redemption
  // sets user_profile.company_gift_id + subscription.company_gift_id, not
  // this column). Once B2B fulfillment attributes a line item to a specific
  // sponsored employee distinct from the placing account, this check starts
  // resolving real scans — no code change needed here when that day comes.
  const result = await db.query(
    `SELECT 1 FROM order_line_item li
     JOIN roaster_blend rb ON rb.id = li.blend_id
     WHERE li.intended_for_user_id = $1 AND rb.coffee_id = $2
     LIMIT 1`,
    [profileId, coffeeId]
  );
  return result.rows.length > 0;
}

export interface OwnershipResult {
  isOwner: boolean;
  profileId: string | null;
}

export async function resolveOwnership(uid: string, coffeeId: number): Promise<OwnershipResult> {
  const profileId = await resolveProfileId(uid);
  if (!profileId) return { isOwner: false, profileId: null };
  const [personal, sponsored] = await Promise.all([
    checkPersonalOrderOwnership(profileId, coffeeId),
    checkSponsorshipOwnership(profileId, coffeeId),
  ]);
  return { isOwner: personal || sponsored, profileId };
}

export interface QrBagView {
  displayName: string;
  card: {
    method: string;
    ratio: string;
    grindLabel: string;
    tempC: number | null;
    notes: string;
  };
}

// The owner destination's payload — this bag's brew card, fetch-or-create
// exactly like sommelier.ts's own entry=bag/card resolution (S79), not
// reinvented. Note-first: this is data for a static page, not a chat
// session — the door to Liam is a link the frontend renders next to it.
export async function buildBagView(profileId: string, coffeeId: number, brewProfile: BrewProfileDoc | null): Promise<QrBagView> {
  const [displayName, existingCard] = await Promise.all([
    resolveQrDisplayName(coffeeId),
    getMostRecentCard(profileId, coffeeId),
  ]);
  let card: BrewCardRow;
  if (existingCard) {
    card = existingCard;
  } else {
    const method = await resolveDefaultMethod(coffeeId, brewProfile);
    card = await generateCard(profileId, coffeeId, method, 'conversation', brewProfile);
  }
  return {
    displayName,
    card: {
      method: card.method,
      ratio: card.params.ratio,
      grindLabel: card.params.grindLabel,
      tempC: card.params.tempC,
      notes: card.params.notes,
    },
  };
}
