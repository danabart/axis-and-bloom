import { auth } from './firebase';
import { reportError } from './errorReporter';
import type { Slot, SlotPrice, ArchetypeData } from '../components/bloom/types';

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
  answerIds?: string[];
  branchedFrom?: string | null;
  // Interpretation v2.2 (Prompt 4B): the quiz_answer id of the branch answer the person picked; the server
  // validates it against its own scoring and derives match / lean / secondary itself.
  branchAnswerId?: string | null;
  secondaryArchetype?: string | null;
  foodSignal?: string | null;
  foodSignalAlignment?: string;
  recommendationMode?: string;
  experimental?: boolean;
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

// ── Commerce 1 (2026-10-31): Stripe checkout ─────────────────────────────────
// placeOrder (POST /api/orders) is retired: the server answers 410. An order is
// written only when Stripe confirms payment (the webhook).

/** A checkout error with the server's code (409 price_changed/unavailable, 422 shipping_address_required, 503 checkout_unavailable). */
export class CheckoutApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'CheckoutApiError';
  }
}

export type CheckoutItem =
  | { archetype: string; dialSortOrder: number; weightOz: number; quantity: number; priceCents: number }
  // Direct category coffee, no dial position — Bloom Dial Base Data Part 3, Phase 6.
  | { coffeeId: number; weightOz: number; quantity: number; priceCents: number }
  // "The collection" (Part 19 §C) — no member/weight details sent; the backend
  // re-resolves and re-verifies everything itself.
  | { collection: true; archetype: string; quantity: number; priceCents: number };

export interface CheckoutRules {
  shippingFeeCents: number;
  freeShippingMinBags: number;
  // Commerce 2: the subscribe choice (commerce_parameter, never typed in here).
  subscriptionFrequencyWeeks: number[];
  subscriptionDiscountPct1Bag: number;
  subscriptionDiscountPct2PlusBags: number;
}

/** Commerce 2: the subscription the cart will start (null = one-time). */
export interface SubscriptionChoice { frequencyWeeks: number }

export interface CartQuote {
  bagCount: number;
  subtotalCents: number;
  shippingCents: number;
  subscription: { frequencyWeeks: number; discountPct: number; discountCents: number; subtotalCents: number } | null;
}

/** POST /api/checkout/quote: the cart's numbers from the server, and the subscription price when one is chosen. */
export async function quoteCheckout(body: { items: CheckoutItem[]; subscription?: SubscriptionChoice | null }): Promise<CartQuote> {
  const res = await fetch(`${BASE}/checkout/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CheckoutApiError(res.status, data.error ?? 'quote_failed', data.message ?? 'Could not price the cart.');
  return data;
}

export async function getCheckoutRules(): Promise<CheckoutRules> {
  const res = await fetch(`${BASE}/checkout/rules`);
  if (!res.ok) throw new Error('Failed to load checkout rules');
  return res.json();
}

// ── Website 2 (2026-11-04): presentation data for the handoff pages ─────────
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_2_PRESENTATION_DATA.md
// Every value below comes from the API; a key that is absent means "no value"
// and the card leaves that row out (never a placeholder).

/** What a card shows beyond its slot and price (services/coffeeCardReads.ts CardPresentation). */
export interface CardPresentation {
  /** the signature notes, the roaster's words first */
  signatureNotes: string[];
  hint?: string;
  bestBrew?: string;
  alsoGood: string[];
  milk?: string;
  leadsInCup?: string;
  originRegion?: string;
  /** Premium ★: the coffee carries an award (never its name) */
  hasAward: boolean;
  /** asset registry key (frontend/src/design/assets.ts); absent until Camila supplies one */
  photoKey?: string;
}

/** A family slot as a card; a slot with no coffee has no presentation keys. */
export type SlotCard = Slot & { archetype: string; archetypeLabel: string } & Partial<CardPresentation>;

export interface FamilyCards {
  archetype: string;
  archetypeLabel: string;
  sortOrder: number;
  customerWords: string[] | null;
  collectionOffer: { memberCount: number; sumCents: number; discountedCents: number } | null;
  cards: SlotCard[];
}

export interface OtherCard extends Partial<CardPresentation> {
  coffeeId: number;
  /** the home slot's name; null when the coffee has none (never the raw coffee name) */
  platformName: string | null;
  archetype: string | null;
  archetypeLabel: string | null;
  categories: { code: string; label: string; sortOrder: number }[];
  prices: (SlotPrice & { isActive: boolean })[];
  effectivelyActive: boolean;
  isUnpriced: boolean;
}

export interface CoffeeCards { families: FamilyCards[]; other: { cards: OtherCard[] } }

export async function getCoffeeCards(): Promise<CoffeeCards> {
  const res = await fetch(`${BASE}/coffees/cards`);
  if (!res.ok) throw new Error('Failed to load coffee cards');
  return res.json();
}

export interface HomeContent {
  /** scaleMin/scaleMax (Website 3): the score line of the counted dimensions ("0 to 15"), null when none */
  facts: { questions: number; dimensions: number; families: number; scaleMin: number | null; scaleMax: number | null };
  quotes: string[];
  featured: { card: SlotCard; price: { weightOz: number; retailPriceCents: number; label: string } | null } | null;
}

/** GET /api/coffees/archetypes: the five families (is_archetype) in sort_order, with slots and words. */
export async function getArchetypes(): Promise<ArchetypeData[]> {
  const res = await fetch(`${BASE}/coffees/archetypes`);
  if (!res.ok) throw new Error('Failed to load archetypes');
  return res.json();
}

/** GET /api/coffees/archetype-order?archetype=: the customer's family first, then its neighbours (catalogReads.getArchetypeOrder). */
export async function getArchetypeOrder(archetype: string | null): Promise<string[]> {
  const qs = archetype ? `?archetype=${encodeURIComponent(archetype)}` : '';
  const res = await fetch(`${BASE}/coffees/archetype-order${qs}`);
  if (!res.ok) throw new Error('Failed to load archetype order');
  return (await res.json()).order ?? [];
}

export async function getHomeContent(): Promise<HomeContent> {
  const res = await fetch(`${BASE}/home/content`);
  if (!res.ok) throw new Error('Failed to load home content');
  return res.json();
}

export interface ShipsTo { street: string; city: string; state: string; postalCode: string; country: string }

export async function createCheckoutSession(body: { items: CheckoutItem[]; shippingAddressId?: string | null; subscription?: SubscriptionChoice | null }): Promise<{ clientSecret: string; checkoutSessionId: string; shipsTo: ShipsTo }> {
  const res = await fetch(`${BASE}/checkout/session`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CheckoutApiError(res.status, data.error ?? 'checkout_failed', data.message ?? 'Checkout failed. Please try again.');
  return data;
}

export interface CheckoutSessionStatus {
  status: 'open' | 'complete' | 'expired';
  orderId?: string;
  finalized?: boolean;
  orderPlacedLine?: string | null;
  order?: {
    lines: Array<{ displayName: string | null; weightOz: number | null; quantity: number }>;
    shipsTo: { street: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null };
    subtotalCents: number; shippingCents: number; taxCents: number; totalCents: number;
    customerLabel: string | null;
  };
  /** Commerce 2: present when the checkout started a subscription. */
  subscription?: { frequencyWeeks: number | null; nextDeliveryDate: string | null; discountCents: number };
}

export async function getCheckoutSessionStatus(sessionId: string): Promise<CheckoutSessionStatus> {
  const res = await fetch(`${BASE}/checkout/session/${encodeURIComponent(sessionId)}/status`, { headers: await getHeaders() });
  if (!res.ok) throw new CheckoutApiError(res.status, 'status_failed', 'Could not read the checkout status');
  return res.json();
}

// ── Commerce 2 (2026-10-31): subscriptions, read-only (Commerce 3 adds the buttons) ──
export interface MySubscription {
  id: string;
  status: string;
  statusLabel: string;
  countsAsSubscriber: boolean;
  frequencyWeeks: number | null;
  /** The delivery that will actually ship next (past a pending skip or pause). */
  nextDeliveryDate: string | null;
  nextCoffees: Array<{ displayName: string; weightOz: number | null; quantity: number }>;
  followsDial: boolean;
  bagCount: number;
  discountPct: number;
  lastOrderId: string | null;
  // Commerce 3: the panel's state, decided by the server.
  skippedDate: string | null;
  resumesOn: string | null;
  canceledAt: string | null;
  hasPaymentMethod: boolean;
  actions: { frequency: boolean; skip: boolean; pause: boolean; resume: boolean; cancel: boolean; updateCard: boolean };
}

/** GET /api/subscriptions/mine: the subscriptions plus the panel's options (frequencies, pause bounds), all from the server. */
export interface MySubscriptionsResponse {
  subscriptions: MySubscription[];
  frequencies: number[];
  pause: { maxWeeks: number; earliestResume: string; latestResume: string };
}

export async function getMySubscriptionPanel(): Promise<MySubscriptionsResponse> {
  const res = await fetch(`${BASE}/subscriptions/mine`, { headers: await getHeaders() });
  if (!res.ok) throw new Error('Could not load your subscription');
  const data = await res.json();
  return { subscriptions: data.subscriptions ?? [], frequencies: data.frequencies ?? [], pause: data.pause };
}

export async function getMySubscriptions(): Promise<MySubscription[]> {
  return (await getMySubscriptionPanel()).subscriptions;
}

/** A self-service change refused with the server's friendly message (409 skip pending, 422 resume date, …). */
export class SubscriptionApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'SubscriptionApiError';
  }
}

async function subscriptionAction<T = { changed: boolean }>(id: string, path: string, body?: object): Promise<T> {
  const res = await fetch(`${BASE}/subscriptions/${encodeURIComponent(id)}/${path}`, {
    method: 'POST', headers: await getHeaders(), body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SubscriptionApiError(res.status, data.error ?? 'failed', data.message ?? 'That did not go through. Please try again.');
  return data;
}

export const changeSubscriptionFrequency = (id: string, weeks: number) => subscriptionAction(id, 'frequency', { weeks });
export const skipNextDelivery = (id: string) => subscriptionAction(id, 'skip');
export const pauseSubscription = (id: string, resumeOn: string) => subscriptionAction(id, 'pause', { resumeOn });
export const resumeSubscription = (id: string) => subscriptionAction(id, 'resume');
export const cancelSubscription = (id: string) => subscriptionAction(id, 'cancel');
/** A setup-mode Stripe session for a new card; its client secret goes to StripeEmbeddedCheckout. */
export const createCardUpdateSession = (id: string) => subscriptionAction<{ clientSecret: string }>(id, 'payment-method/session');

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
  campaign?: string;
  campaignVid?: string;
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
  // 'quiz_final' added Quiz Resync Fix Part A4 (2026-09-25) — the post-branch,
  // on-screen archetype, logged on its own row so the funnel carries the true
  // final result even when quiz_complete (pre-branch) and the actual result differ.
  event: 'quiz_start' | 'quiz_complete' | 'email_submitted' | 'quiz_final',
  archetype?: string,
  attribution?: { campaign: string; vid: string },
) {
  const res = await fetch(`${BASE}/quiz/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionKey,
      event,
      archetype,
      campaign: attribution?.campaign,
      campaignVid: attribution?.vid,
    }),
  });
  if (!res.ok) throw new Error('Failed to log funnel event');
}

// Hoboken Coffee Crawl (2026-08-31) — fire-and-forget landing beacon from
// CrawlLanding.tsx. Never blocks rendering; callers should .catch() and swallow.
export async function logCampaignLanding(payload: {
  campaign: string;
  vid: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
}) {
  const res = await fetch(`${BASE}/campaign/landing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to log campaign landing');
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
    // Error responses aren't guaranteed to be valid JSON (e.g. a raw 500
    // from an intermediary) — fall back to a generic message rather than
    // letting a parse failure mask the real error being thrown below.
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
  // bag_qr (2026-10-05) — a signed-out universal scan: the two-door page.
  | { status: 'doors' }
  | { status: 'rate_limited' }
  | { status: 'error' };

// No token = the bare printed address /b, resolved server-side against the
// one canonical universal token (GET /api/qr/resolve).
export async function resolveQrToken(token?: string): Promise<QrResolveResult> {
  try {
    const path = token ? `/qr/${encodeURIComponent(token)}/resolve` : '/qr/resolve';
    const res = await fetch(`${BASE}${path}`, {
      headers: await getHeaders(),
    });
    if (res.status === 404) return { status: 'unknown' };
    if (res.status === 429) return { status: 'rate_limited' };
    if (!res.ok) return { status: 'error' };
    return res.json();
  } catch (err) {
    reportError('[api/resolveQrToken]', err);
    return { status: 'error' };
  }
}
