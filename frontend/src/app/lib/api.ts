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
  items: Array<{ variantId: string; quantity: number }>;
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
