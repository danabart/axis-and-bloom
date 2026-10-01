import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';

// Liam access & cost brief, Part A6 (2026-10-01) — the route-level proof:
// a signed-in user without Liam access gets 403 liam_not_included on /start
// and /:sessionId/message, and nothing downstream runs — no daily-cap read,
// no Claude call. The real middleware chain (requireAuth, blockAnonymousAuth,
// requireLiamAccess) is exercised; only token verification and the access
// decision itself are stubbed.

const verifyIdToken = vi.fn();
vi.mock('../services/firebase-admin.js', () => ({
  default: { auth: () => ({ verifyIdToken }) },
  firestoreDb: {},
  FieldValue: {},
}));
vi.mock('../services/liamAccess.js', () => ({ hasLiamAccess: vi.fn() }));
vi.mock('../db/client.js', () => ({ db: { query: vi.fn() } }));
vi.mock('../services/claude.js', () => ({ chatWithSommelier: vi.fn() }));
vi.mock('../services/sommelierGuards.js', () => ({ checkDailyCap: vi.fn(), checkMonthlySpendAndAlert: vi.fn() }));
vi.mock('../services/sommelierEvaluator.js', () => ({ evaluateSommelier: vi.fn() }));
vi.mock('../services/behavioralConfidence.js', () => ({ computeBehavioralConfidence: vi.fn() }));
vi.mock('../services/tokenService.js', () => ({ getTokenBalance: vi.fn(), spendToken: vi.fn(), logUsage: vi.fn() }));
vi.mock('../services/outcomeTracker.js', () => ({ writeOutcome: vi.fn(), checkReturnedToSommelier: vi.fn() }));
vi.mock('../services/catalogReads.js', () => ({ getCatalogVersion: vi.fn(), getCoffees: vi.fn(), archetypeLabel: vi.fn(), archetypeCode: vi.fn() }));
vi.mock('../services/sommelierRag.js', () => ({ fetchSommelierCoffees: vi.fn(), getAliases: vi.fn() }));
vi.mock('../services/customerReads.js', () => ({}));
vi.mock('../services/liamProfile.js', () => ({ loadProfileReads: vi.fn(), buildProfileLine: vi.fn() }));
vi.mock('../services/customerFacts.js', () => ({ record: {} }));
vi.mock('../services/liamWriteBack.js', () => ({ recordTurn: vi.fn(), recordReplyForOpenQuestion: vi.fn() }));
vi.mock('../services/anthropicGuard.js', () => ({ isClaudeGuardBlocked: vi.fn() }));
vi.mock('../services/sommelierConfig.js', () => ({ getSommelierConfig: vi.fn(() => null) }));
vi.mock('../services/topicRouter.js', () => ({ routeTopic: vi.fn() }));
vi.mock('../services/brewCard.js', () => ({}));

const { default: sommelierRouter } = await import('./sommelier.js');
const { hasLiamAccess } = await import('../services/liamAccess.js');
const { chatWithSommelier } = await import('../services/claude.js');
const { checkDailyCap } = await import('../services/sommelierGuards.js');
const { evaluateSommelier } = await import('../services/sommelierEvaluator.js');
const mockedAccess = hasLiamAccess as unknown as ReturnType<typeof vi.fn>;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/sommelier', sommelierRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/sommelier`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  verifyIdToken.mockResolvedValue({ uid: 'vitest-no-liam', email: 'x@example.com', firebase: { sign_in_provider: 'password' } });
});

const post = (path: string, body: unknown, auth = true) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer test-token' } : {}) },
    body: JSON.stringify(body),
  });

describe('requireLiamAccess on customer sommelier routes', () => {
  it('403 liam_not_included on /start, no daily-cap read, no Claude call', async () => {
    mockedAccess.mockResolvedValue({ allowed: false, reason: null });
    const res = await post('/start', { intent: 'MATCHED' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'liam_not_included' });
    expect(mockedAccess).toHaveBeenCalledWith('vitest-no-liam');
    expect(checkDailyCap).not.toHaveBeenCalled();
    expect(chatWithSommelier).not.toHaveBeenCalled();
  });

  it('403 liam_not_included on /:sessionId/message, no Claude call', async () => {
    mockedAccess.mockResolvedValue({ allowed: false, reason: null });
    const res = await post('/42/message', { message: 'hello' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'liam_not_included' });
    expect(checkDailyCap).not.toHaveBeenCalled();
    expect(chatWithSommelier).not.toHaveBeenCalled();
  });

  it('403 on /evaluate too, before the evaluator runs', async () => {
    mockedAccess.mockResolvedValue({ allowed: false, reason: null });
    const res = await post('/evaluate', {});
    expect(res.status).toBe(403);
    expect(evaluateSommelier).not.toHaveBeenCalled();
  });

  it('an entitled user passes through to the handler', async () => {
    mockedAccess.mockResolvedValue({ allowed: true, reason: 'subscriber' });
    const res = await post('/start', {}); // no intent → the handler's own 400, proving the middleware called next()
    expect(res.status).toBe(400);
    expect(chatWithSommelier).not.toHaveBeenCalled();
  });

  it('no token → 401, access never checked', async () => {
    const res = await post('/start', { intent: 'MATCHED' }, false);
    expect(res.status).toBe(401);
    expect(mockedAccess).not.toHaveBeenCalled();
  });
});
