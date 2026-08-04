import { auth } from './firebase';

const BASE = '/api';

async function getHeaders(): Promise<HeadersInit> {
  const token = await auth.currentUser?.getIdToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function saveQuizResult(payload: {
  archetype: string;
  scores: Record<string, number>;
  answers: Record<number, number>;
  decaf: boolean;
}) {
  const res = await fetch(`${BASE}/quiz/results`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to save quiz result');
  return res.json();
}

export async function getCoffeeRecommendations(archetype: string) {
  const res = await fetch(`${BASE}/shop/recommendations?archetype=${archetype}`, {
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch recommendations');
  return res.json();
}

export async function sendChatMessage(message: string, context: object) {
  const res = await fetch(`${BASE}/agent/chat`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({ message, context }),
  });
  if (!res.ok) throw new Error('Chat failed');
  return res.json();
}

export async function placeOrder(order: {
  items: Array<
    | { variantId: string; quantity: number; priceCents?: number }
    | { archetype: string; dialSortOrder: number; weightOz: number; quantity: number; priceCents?: number }
    // Direct category coffee, no dial position — Bloom Dial Base Data Part 3, Phase 6.
    | { coffeeId: number; weightOz: number; quantity: number; priceCents?: number }
  >;
  shippingAddress: object;
}) {
  const res = await fetch(`${BASE}/orders`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify(order),
  });
  if (!res.ok) throw new Error('Order failed');
  return res.json();
}

// Step 04 (A2): shared subscribe call for the firm quiz gate (guest card submit,
// recognized-guest silent resync, signed-in auto-subscribe/archetype-sync) — reuses
// the existing POST /api/newsletter/subscribe endpoint, no parallel code path.
// getHeaders() attaches the Firebase token when signed in, so the backend's
// optionalAuth can link user_id; guests simply send no Authorization header.
export async function subscribeNewsletter(payload: {
  email: string;
  firstName?: string;
  source: string;
  archetype?: string;
  experimental?: boolean;
  confidence?: string;
  quizSessionKey?: string;
}) {
  const res = await fetch(`${BASE}/newsletter/subscribe`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to subscribe');
  return res.json();
}

// First-party quiz funnel logging — public endpoint, no auth. Fire-and-forget by
// design (callers should .catch() and never let this block/break the calling flow).
export async function logQuizFunnelEvent(
  sessionKey: string,
  event: 'quiz_start' | 'quiz_complete' | 'email_submitted',
  archetype?: string,
) {
  const res = await fetch(`${BASE}/quiz/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionKey, event, archetype }),
  });
  if (!res.ok) throw new Error('Failed to log funnel event');
}

export async function getUserProfile() {
  const res = await fetch(`${BASE}/users/profile`, {
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch profile');
  return res.json();
}

export async function getHomepageState() {
  const res = await fetch(`${BASE}/users/homepage-state`, {
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch homepage state');
  return res.json();
}

export interface FlavorMemoryJournalEntry {
  orderId: string;
  date: string;
  blendName: string | null;
  coffeeId: number | null;
  rating: number | null;
  note: string | null;
  source: 'onsite' | 'sms' | null;
  hasFeedback: boolean;
  /** Profile Part 5 edit-prefill only. */
  expectation: 'lighter' | 'as_expected' | 'bolder' | null;
  tastedNoteIds: string[];
}

export interface FlavorMemoryJourneyEntry {
  archetype: string;
  archetypeLabel: string;
  at: string | null;
  trigger: 'first_quiz' | 'retake';
}

// Profile Part 7 Task 3 — the activity log. One deliberate moment per entry
// (editorial rule): quiz, order, explicit save, accepted Liam recipe. Never
// add_to_cart, rotation, reveal, or anything inferred.
export interface FlavorMemoryActivityEntry {
  id: string;
  type: 'quiz' | 'ordered' | 'saved' | 'recipe';
  at: string | null;
  archetype?: string | null;
  archetypeLabel?: string | null;
  /** quiz only. */
  trigger?: 'first_quiz' | 'retake';
  /** saved only. */
  dialSortOrder?: number | null;
  /** ordered: own-order blend_name; saved: platformName snapshot at save time. */
  coffeeName?: string | null;
  /** recipe only. */
  title?: string | null;
  body?: string | null;
  removable: boolean;
}

// HOME_TASK_6 (§3.2) — read-only v1 display. coffeeName is already alias-
// resolved server-side (S44/S77 discipline) — never a raw coffee name.
export interface BrewCardSummary {
  id: number;
  coffeeId: number;
  coffeeName: string | null;
  method: string;
  ratio: string;
  grindLabel: string;
  tempC: number | null;
  notes: string;
  revision: number;
  lastAdjustmentReason: string | null;
  updatedAt: string;
}

export interface FlavorMemoryData {
  journal: FlavorMemoryJournalEntry[];
  journey: FlavorMemoryJourneyEntry[];
  activity: FlavorMemoryActivityEntry[];
  contributionCount: number;
  brewCards: BrewCardSummary[];
}

export async function getFlavorMemory(): Promise<FlavorMemoryData> {
  const res = await fetch(`${BASE}/users/flavor-memory`, {
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch flavor memory');
  return res.json();
}

// Profile Part 7 Task 2 — tombstone only, never a hard delete.
export async function removeFlavorMemoryEntry(kind: 'saved' | 'recipe', id: string) {
  const path = kind === 'saved' ? 'saved' : 'recipes';
  const res = await fetch(`${BASE}/users/flavor-memory/${path}/${encodeURIComponent(id)}/remove`, {
    method: 'PATCH',
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to remove entry');
  return res.json();
}

// Profile Part 7 Task 5 — user-initiated (chip tap), never called from a model
// response directly. title/body come from the already-rendered chat message.
export async function saveLiamRecipe(title: string, body: string) {
  const res = await fetch(`${BASE}/users/flavor-memory/liam-saves`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({ title, body }),
  });
  if (!res.ok) throw new Error('Failed to save recipe');
  return res.json();
}

export interface BrewProfileFieldEntry {
  value: string | boolean | string[];
  source: 'conversation' | 'profile_page' | null;
  capturedAt: string | null;
}
export type BrewProfileData = Record<string, BrewProfileFieldEntry>;

// HOME_TASK_4 (§4.5 write rule 2) — the day-one mirror: read, edit, delete per
// captured field. GET returns {} (not 404) when nothing has been captured yet.
export async function getBrewProfile(): Promise<BrewProfileData> {
  const res = await fetch(`${BASE}/users/brew-profile`, { headers: await getHeaders() });
  if (!res.ok) throw new Error('Failed to fetch brew profile');
  return res.json();
}

export async function setBrewProfileField(field: string, value: string | boolean | string[]) {
  const res = await fetch(`${BASE}/users/brew-profile`, {
    method: 'PATCH',
    headers: await getHeaders(),
    body: JSON.stringify({ field, value }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? 'Failed to save field');
  }
  return res.json();
}

export async function deleteBrewProfileField(field: string) {
  const res = await fetch(`${BASE}/users/brew-profile`, {
    method: 'DELETE',
    headers: await getHeaders(),
    body: JSON.stringify({ field }),
  });
  if (!res.ok) throw new Error('Failed to delete field');
  return res.json();
}

export async function getDialPosition(archetype: string): Promise<{ dialSortOrder: number | null }> {
  const res = await fetch(`${BASE}/users/dial-position?archetype=${encodeURIComponent(archetype)}`, {
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch dial position');
  return res.json();
}

export async function setDialPosition(
  archetype: string,
  dialSortOrder: number,
  event?: { trigger: 'explicit_save' | 'add_to_cart'; source?: string | null; coffeeId?: number | null; platformName?: string | null }
) {
  const res = await fetch(`${BASE}/users/dial-position`, {
    method: 'PATCH',
    headers: await getHeaders(),
    body: JSON.stringify({ archetype, dialSortOrder, ...event }),
  });
  if (!res.ok) throw new Error('Failed to save dial position');
  return res.json();
}

export async function lookupCompanyGiftCode(code: string): Promise<
  | { valid: true; companyName: string; sponsorshipMonths: number }
  | { valid: false; error: string }
> {
  const res = await fetch(`${BASE}/company-gift-redemption/${encodeURIComponent(code)}`);
  return res.json();
}

export async function redeemCompanyGiftCode(code: string): Promise<{ ok: true; sponsoredExpiresAt: string } | { error: string }> {
  const res = await fetch(`${BASE}/company-gift-redemption/${encodeURIComponent(code)}/redeem`, {
    method: 'POST',
    headers: await getHeaders(),
  });
  return res.json();
}

export async function submitOrderFeedback(orderId: string, rating: number, note?: string, v2?: {
  expectation?: 'lighter' | 'as_expected' | 'bolder';
  tastedNoteIds?: string[];
}) {
  const res = await fetch(`${BASE}/orders/${orderId}/feedback`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({ rating, note, ...v2 }),
  });
  if (!res.ok) throw new Error('Failed to submit feedback');
  return res.json();
}

// HOME_TASK_7 (§3.1, QR indirection) — the /b/:token page's one call. Uses
// getHeaders() same as every other call here, so a signed-in scanner's
// Authorization header rides along automatically and a signed-out scanner
// simply sends none — the backend's optionalAuth handles both, same pattern
// subscribeNewsletter() already established. Never throws on a 404 (unknown
// token) or a rate-limit 429 — both are real, renderable states for this
// page, not exceptional failures, so the caller reads `status` instead.
export interface QrBagCard {
  method: string; ratio: string; grindLabel: string; tempC: number | null; notes: string;
}

export type QrResolveResult =
  | { status: 'unknown' }
  | { status: 'sign_in' }
  | { status: 'retired'; coffeeId: number; displayName: string; nearestHopCoffeeId: number | null }
  | { status: 'non_owner'; coffeeId: number }
  // 'owner' is the legacy per-coffee digital-link destination only (unchanged
  // since HOME_TASK_7) — nothing mints or surfaces a per-coffee token anymore
  // (HOME_TASK_7E, decision #2), but an existing one must keep resolving.
  | { status: 'owner'; coffeeId: number; displayName: string; card: QrBagCard }
  // HOME_TASK_7E (decisions 2026-08-04, amends 7c) — the universal token's
  // only two signed-in outcomes: a customer (orders or B2B sponsorship) goes
  // to their profile, where every one of their cards already lives; anyone
  // else goes to the quiz. Supersedes 7c's 'no_orders'/'picker' pair — the
  // picker no longer exists (the profile page shows every bag for free).
  | { status: 'profile' }
  | { status: 'quiz' }
  | { status: 'rate_limited' }
  | { status: 'error' };

export async function resolveQrToken(token: string): Promise<QrResolveResult> {
  try {
    const res = await fetch(`${BASE}/qr/${encodeURIComponent(token)}/resolve`, {
      headers: await getHeaders(),
    });
    if (res.status === 404) return { status: 'unknown' };
    if (res.status === 429) return { status: 'rate_limited' };
    if (!res.ok) return { status: 'error' };
    return res.json();
  } catch {
    return { status: 'error' };
  }
}
