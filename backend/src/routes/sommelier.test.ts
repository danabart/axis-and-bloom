// Catalog Blueprint · brief 3, Part E — unit-level coverage for
// refreshCatalogSnapshotIfStale (the per-turn snapshot-refresh branch,
// extracted out of POST /:sessionId/message specifically so it's testable
// like this). Mocks the two builders (getCatalogVersion, fetchSommelierCoffees)
// plus getAliases and the db.query used for the refreshed story candidates —
// no live DB, no DATABASE_URL needed.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/catalogReads.js', () => ({
  getCatalogVersion: vi.fn(),
  getCoffees: vi.fn(),
  archetypeLabel: vi.fn(),
}));
vi.mock('../services/sommelierRag.js', () => ({
  fetchSommelierCoffees: vi.fn(),
  getAliases: vi.fn(),
}));
vi.mock('../db/client.js', () => ({
  db: { query: vi.fn() },
}));
// sommelier.ts pulls in a large dependency graph (firebase-admin, tokenService,
// claude.ts, etc.) that this unit test has no interest in exercising — mocked
// to inert stand-ins so importing the module has no side effects.
vi.mock('../services/firebase-admin.js', () => ({ firestoreDb: {}, FieldValue: {} }));
vi.mock('../services/behavioralConfidence.js', () => ({ computeBehavioralConfidence: vi.fn() }));
vi.mock('../services/sommelierEvaluator.js', () => ({ evaluateSommelier: vi.fn() }));
vi.mock('../services/tokenService.js', () => ({ getTokenBalance: vi.fn(), spendToken: vi.fn(), logUsage: vi.fn() }));
vi.mock('../services/sommelierGuards.js', () => ({ checkDailyCap: vi.fn(), checkMonthlySpendAndAlert: vi.fn() }));
vi.mock('../services/outcomeTracker.js', () => ({ writeOutcome: vi.fn(), checkReturnedToSommelier: vi.fn() }));
vi.mock('../services/claude.js', () => ({ chatWithSommelier: vi.fn() }));
vi.mock('../services/anthropicGuard.js', () => ({ isClaudeGuardBlocked: vi.fn() }));
vi.mock('../services/sommelierConfig.js', () => ({ getSommelierConfig: vi.fn(() => null) }));
vi.mock('../services/topicRouter.js', () => ({ routeTopic: vi.fn() }));

const { getCatalogVersion } = await import('../services/catalogReads.js');
const { fetchSommelierCoffees, getAliases } = await import('../services/sommelierRag.js');
const { db } = await import('../db/client.js');
const { refreshCatalogSnapshotIfStale } = await import('./sommelier.js');
type StoryCandidate = { coffeeId: number; alias: string; story: string | null };

const mockedGetCatalogVersion = getCatalogVersion as unknown as ReturnType<typeof vi.fn>;
const mockedFetch = fetchSommelierCoffees as unknown as ReturnType<typeof vi.fn>;
const mockedGetAliases = getAliases as unknown as ReturnType<typeof vi.fn>;
const mockedDbQuery = db.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('refreshCatalogSnapshotIfStale', () => {
  it('does not rebuild when the stored version matches the current one', async () => {
    mockedGetCatalogVersion.mockResolvedValue('2026-09-14T00:00:00.000Z');
    const ctx = { catalogVersion: '2026-09-14T00:00:00.000Z', catalogText: 'stale text', coffeeIds: [1, 2] };

    await refreshCatalogSnapshotIfStale(ctx, 123);

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(ctx.catalogText).toBe('stale text');
    expect(ctx.coffeeIds).toEqual([1, 2]);
  });

  it('rebuilds exactly once when the stored version is stale, mutating ctx in place', async () => {
    mockedGetCatalogVersion.mockResolvedValue('2026-09-14T01:00:00.000Z');
    mockedFetch.mockResolvedValue({ catalogText: 'fresh text', coffeeIds: [5, 6] });
    mockedDbQuery.mockResolvedValue({ rows: [
      { id: 5, story: 'Story Five', story_published: true },
      { id: 6, story: 'Story Six', story_published: false },
    ] });
    mockedGetAliases.mockResolvedValue(new Map([[5, 'Alias Five'], [6, 'Alias Six']]));

    const ctx: {
      catalogVersion?: string; ragFocus?: string; archetype?: string | null;
      previousArchetypeForRag?: string | null; excludeCoffeeIds?: number[];
      catalogText?: string; coffeeIds?: number[]; storyCandidates?: StoryCandidate[];
    } = { catalogVersion: 'old-version', ragFocus: 'exact_match', archetype: 'floral', excludeCoffeeIds: [9] };

    await refreshCatalogSnapshotIfStale(ctx, 123);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith({
      ragFocus: 'exact_match', userArchetype: 'floral', previousArchetype: null, excludeCoffeeIds: [9],
    });
    expect(ctx.catalogText).toBe('fresh text');
    expect(ctx.coffeeIds).toEqual([5, 6]);
    expect(ctx.catalogVersion).toBe('2026-09-14T01:00:00.000Z');
    expect(ctx.storyCandidates).toEqual([
      { coffeeId: 5, alias: 'Alias Five', story: 'Story Five' },
      { coffeeId: 6, alias: 'Alias Six', story: null }, // unpublished story never surfaces
    ]);
  });

  it('leaves the stale snapshot untouched and swallows the error when a rebuild fails', async () => {
    mockedGetCatalogVersion.mockResolvedValue('2026-09-14T02:00:00.000Z');
    mockedFetch.mockRejectedValue(new Error('boom'));
    const ctx = { catalogVersion: 'old-version', catalogText: 'stale text', coffeeIds: [1] };

    await expect(refreshCatalogSnapshotIfStale(ctx, 123)).resolves.toBeUndefined();
    expect(ctx.catalogText).toBe('stale text');
    expect(ctx.coffeeIds).toEqual([1]);
    expect(ctx.catalogVersion).toBe('old-version');
  });
});
