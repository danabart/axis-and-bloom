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

export interface FlavorMemoryData {
  journal: FlavorMemoryJournalEntry[];
  journey: FlavorMemoryJourneyEntry[];
  contributionCount: number;
}

export async function getFlavorMemory(): Promise<FlavorMemoryData> {
  const res = await fetch(`${BASE}/users/flavor-memory`, {
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch flavor memory');
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
  event?: { trigger: 'explicit_save' | 'add_to_cart'; source?: string | null; coffeeId?: number | null }
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
