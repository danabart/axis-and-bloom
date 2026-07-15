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

export async function getDialPosition(archetype: string): Promise<{ dialSortOrder: number | null }> {
  const res = await fetch(`${BASE}/users/dial-position?archetype=${encodeURIComponent(archetype)}`, {
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch dial position');
  return res.json();
}

export async function setDialPosition(archetype: string, dialSortOrder: number) {
  const res = await fetch(`${BASE}/users/dial-position`, {
    method: 'PATCH',
    headers: await getHeaders(),
    body: JSON.stringify({ archetype, dialSortOrder }),
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

export async function submitOrderFeedback(orderId: string, rating: number, note?: string) {
  const res = await fetch(`${BASE}/orders/${orderId}/feedback`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({ rating, note }),
  });
  if (!res.ok) throw new Error('Failed to submit feedback');
  return res.json();
}
