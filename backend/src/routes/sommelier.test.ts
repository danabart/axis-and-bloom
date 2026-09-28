// Catalog Blueprint · brief 3, Part E — unit-level coverage for
// refreshCatalogSnapshotIfStale (the per-turn snapshot-refresh branch,
// extracted out of POST /:sessionId/message specifically so it's testable
// like this). Mocks the two builders (getCatalogVersion, fetchSommelierCoffees)
// plus getAliases and the db.query used for the refreshed story candidates —
// no live DB, no DATABASE_URL needed.
//
// Liam L1, Part C — refreshCatalogSnapshotIfStale now takes a uid (first arg)
// and, on an actual refresh, re-reads getSlotCandidates/getFeedbackCurrent
// live rather than trusting a stored snapshot of either — both mocked here
// via customerReads.js, alongside the pre-existing mocks.
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
vi.mock('../services/customerReads.js', () => ({
  getSlotCandidates: vi.fn(),
  getFeedbackCurrent: vi.fn(),
  getBrewProfileCurrent: vi.fn(),
}));
vi.mock('../services/liamProfile.js', () => ({
  loadProfileReads: vi.fn(),
  buildProfileLine: vi.fn(),
}));
// Liam L2, Part 0 — resolveRemember's only real I/O beyond db.query is
// record.brewProfileChange() (customerFacts.js) and incrementBrewProfileCounter()
// (brewProfile.js, Firestore); everything else in brewProfile.js is pure
// validation logic, kept real so FALLBACK_FIELDS' actual whitelist still governs.
vi.mock('../services/customerFacts.js', () => ({
  record: { brewProfileChange: vi.fn() },
}));
vi.mock('../services/brewProfile.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/brewProfile.js')>();
  return { ...actual, incrementBrewProfileCounter: vi.fn() };
});
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
// Liam L1, Part C.6 — assembleSystemPrompt is kept real (not stubbed) so its
// profile-line injection can be asserted directly; only chatWithSommelier
// (the actual Anthropic call) is replaced.
vi.mock('../services/claude.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/claude.js')>();
  return { ...actual, chatWithSommelier: vi.fn() };
});
vi.mock('../services/anthropicGuard.js', () => ({ isClaudeGuardBlocked: vi.fn() }));
vi.mock('../services/sommelierConfig.js', () => ({ getSommelierConfig: vi.fn(() => null) }));
vi.mock('../services/topicRouter.js', () => ({ routeTopic: vi.fn() }));

const { getCatalogVersion } = await import('../services/catalogReads.js');
const { fetchSommelierCoffees, getAliases } = await import('../services/sommelierRag.js');
type CoffeeSlice = 'palate' | 'primary' | 'secondary' | 'thread' | 'focus' | 'had';
const { getSlotCandidates, getFeedbackCurrent, getBrewProfileCurrent } = await import('../services/customerReads.js');
const { record } = await import('../services/customerFacts.js');
const { db } = await import('../db/client.js');
const { refreshCatalogSnapshotIfStale, refreshSliceIfFactsChanged, resolveRemember } = await import('./sommelier.js');
const { assembleSystemPrompt } = await import('../services/claude.js');
type StoryCandidate = { coffeeId: number; alias: string; story: string | null };

const mockedGetCatalogVersion = getCatalogVersion as unknown as ReturnType<typeof vi.fn>;
const mockedFetch = fetchSommelierCoffees as unknown as ReturnType<typeof vi.fn>;
const mockedGetAliases = getAliases as unknown as ReturnType<typeof vi.fn>;
const mockedGetSlotCandidates = getSlotCandidates as unknown as ReturnType<typeof vi.fn>;
const mockedGetFeedbackCurrent = getFeedbackCurrent as unknown as ReturnType<typeof vi.fn>;
const mockedGetBrewProfileCurrent = getBrewProfileCurrent as unknown as ReturnType<typeof vi.fn>;
const mockedRecordBrewProfileChange = record.brewProfileChange as unknown as ReturnType<typeof vi.fn>;
const mockedDbQuery = db.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSlotCandidates.mockResolvedValue([]);
  mockedGetFeedbackCurrent.mockResolvedValue([]);
});

describe('refreshCatalogSnapshotIfStale', () => {
  it('does not rebuild when the stored version matches the current one', async () => {
    mockedGetCatalogVersion.mockResolvedValue('2026-09-14T00:00:00.000Z');
    const ctx = { catalogVersion: '2026-09-14T00:00:00.000Z', catalogText: 'stale text', coffeeIds: [1, 2] };

    await refreshCatalogSnapshotIfStale('vitest-uid', ctx, 123);

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
    mockedGetSlotCandidates.mockResolvedValue([{ coffee_id: 5, already_bought: false, last_rating: null }]);
    mockedGetFeedbackCurrent.mockResolvedValue([{ coffeeId: 42, sentiment: 'negative' }]);

    const ctx: {
      catalogVersion?: string;
      ragInputs?: {
        ragFocus: string; userArchetype: string | null; previousArchetype: string | null; excludeCoffeeIds: number[];
        secondaryArchetype: string | null; exploreArchetype: string | null; dislikedCoffeeIds: number[]; slotCandidateIds: number[];
      };
      catalogText?: string; coffeeIds?: number[]; storyCandidates?: StoryCandidate[];
    } = {
      catalogVersion: 'old-version',
      ragInputs: {
        ragFocus: 'exact_match', userArchetype: 'floral', previousArchetype: null, excludeCoffeeIds: [9],
        secondaryArchetype: 'fruity', exploreArchetype: null, dislikedCoffeeIds: [], slotCandidateIds: [],
      },
    };

    await refreshCatalogSnapshotIfStale('vitest-uid', ctx, 123);

    expect(mockedGetSlotCandidates).toHaveBeenCalledWith('vitest-uid');
    expect(mockedGetFeedbackCurrent).toHaveBeenCalledWith('vitest-uid', { sentiment: 'negative' });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith({
      ragFocus: 'exact_match', userArchetype: 'floral', previousArchetype: null, excludeCoffeeIds: [9],
      secondaryArchetype: 'fruity', exploreArchetype: null,
      slotCandidates: [{ coffee_id: 5, already_bought: false, last_rating: null }],
      dislikedCoffeeIds: [42],
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

    await expect(refreshCatalogSnapshotIfStale('vitest-uid', ctx, 123)).resolves.toBeUndefined();
    expect(ctx.catalogText).toBe('stale text');
    expect(ctx.coffeeIds).toEqual([1]);
    expect(ctx.catalogVersion).toBe('old-version');
  });
});

// Liam L1, Part C.6 — refreshSliceIfFactsChanged mirrors
// refreshCatalogSnapshotIfStale's own test shape exactly: same mocks, same
// "does nothing when nothing changed" / "rebuilds when it should" pair.
describe('refreshSliceIfFactsChanged', () => {
  const profileReads = {
    feedbackCurrent: [{ coffeeId: 42, sentiment: 'negative' }],
    slotCandidates: [{ coffee_id: 7, already_bought: false, last_rating: null }],
  };

  it('does not trigger when nothing has changed (watermark not newer than stored)', async () => {
    const ctx = { factsWatermark: '2026-09-28T10:00:00.000Z', catalogText: 'stale text', coffeeIds: [1] };
    const watermark = new Date('2026-09-28T10:00:00.000Z'); // equal, not newer

    await refreshSliceIfFactsChanged(ctx, 123, 3, profileReads, watermark);

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(ctx.catalogText).toBe('stale text');
  });

  it('triggers when a brew change (or any fact) lands between turns, rebuilding the slice', async () => {
    mockedFetch.mockResolvedValue({
      catalogText: 'fresh text', coffeeIds: [7],
      slices: [{ coffeeId: 7, slice: 'palate' }],
    });
    mockedDbQuery.mockResolvedValue({ rows: [{ id: 7, story: null, story_published: false }] });
    mockedGetAliases.mockResolvedValue(new Map([[7, 'Alias Seven']]));

    const ctx: { factsWatermark?: string; catalogText?: string; coffeeIds?: number[]; slices?: Array<{ coffeeId: number; slice: CoffeeSlice }> } = {
      factsWatermark: '2026-09-28T10:00:00.000Z',
      catalogText: 'stale text', coffeeIds: [1],
    };
    const newWatermark = new Date('2026-09-28T11:00:00.000Z'); // a brew change (or any fact) landed since

    await refreshSliceIfFactsChanged(ctx, 123, 3, profileReads, newWatermark);

    expect(mockedFetch).toHaveBeenCalledWith(expect.objectContaining({ dislikedCoffeeIds: [42] }));
    expect(ctx.catalogText).toBe('fresh text');
    expect(ctx.coffeeIds).toEqual([7]);
    expect(ctx.slices).toEqual([{ coffeeId: 7, slice: 'palate' }]);
    expect(ctx.factsWatermark).toBe(newWatermark.toISOString());
  });
});

// Liam L1, Part C.6 — assembleSystemPrompt's own profile-line injection,
// tested directly against the real (unmocked) function.
describe('assembleSystemPrompt — profile line (Liam L1, Part C.4)', () => {
  const PROFILE_LINE = 'ABOUT THIS CUSTOMER (facts; rebuilt every turn)\nMatch: Fruity';

  it('injects the profile line on turn 0 and on turn 3, matching mode', () => {
    const base = {
      catalogContext: 'YOUR CURRENT CATALOG — some coffees', mode: 'matching' as const, config: null, profileLine: PROFILE_LINE,
    };
    const turn0 = assembleSystemPrompt({ ...base, session: { intent: 'EXPLORATION', turnCount: 0, openingContext: 'tone note' } });
    const turn3 = assembleSystemPrompt({ ...base, session: { intent: 'EXPLORATION', turnCount: 3, openingContext: 'tone note' } });

    expect(turn0).toContain(PROFILE_LINE);
    expect(turn3).toContain(PROFILE_LINE);
  });

  it('carries the profile line in expertise mode even though the catalog itself is omitted', () => {
    const result = assembleSystemPrompt({
      session: { intent: 'EXPLORATION', turnCount: 2, openingContext: '' },
      catalogContext: 'YOUR CURRENT CATALOG — some coffees',
      mode: 'expertise',
      config: null,
      profileLine: PROFILE_LINE,
    });

    expect(result).toContain(PROFILE_LINE);
    expect(result).not.toContain('YOUR CURRENT CATALOG');
  });
});

// Liam L2, Part 0 — a re-affirmed scalar fact is not a new fact (D14): the
// exact "two takes_it=milk rows" case the L1 smoke surfaced, now fixed.
describe('resolveRemember — re-affirmed scalar facts (Liam L2, Part 0)', () => {
  it('two turns marking the same scalar value produce one customer_brew_profile_change row', async () => {
    mockedDbQuery.mockResolvedValue({ rows: [{ id: 'profile-1' }] });

    // Turn 1: nothing known yet — a real new fact, one row written.
    mockedGetBrewProfileCurrent.mockResolvedValueOnce({});
    await resolveRemember('vitest-uid', [{ field: 'takes_it', rawValue: 'milk' }], 1, 1);
    expect(mockedRecordBrewProfileChange).toHaveBeenCalledTimes(1);

    // Turn 2: the model re-emits the same marker on a turn where the
    // customer didn't restate it — getBrewProfileCurrent now reflects turn
    // 1's write, so this is a no-op: still exactly one row total.
    mockedGetBrewProfileCurrent.mockResolvedValueOnce({
      takes_it: { value: 'milk', source: 'conversation', capturedAt: null },
    });
    await resolveRemember('vitest-uid', [{ field: 'takes_it', rawValue: 'milk' }], 1, 2);
    expect(mockedRecordBrewProfileChange).toHaveBeenCalledTimes(1);
  });

  it('a genuinely changed scalar value still writes a new row', async () => {
    mockedDbQuery.mockResolvedValue({ rows: [{ id: 'profile-1' }] });
    mockedGetBrewProfileCurrent.mockResolvedValueOnce({
      takes_it: { value: 'black', source: 'conversation', capturedAt: null },
    });
    await resolveRemember('vitest-uid', [{ field: 'takes_it', rawValue: 'milk' }], 1, 1);
    expect(mockedRecordBrewProfileChange).toHaveBeenCalledTimes(1);
  });

  it('array fields keep their own pre-existing "already known" skip, unaffected by the scalar no-op', async () => {
    mockedDbQuery.mockResolvedValue({ rows: [{ id: 'profile-1' }] });
    mockedGetBrewProfileCurrent.mockResolvedValueOnce({
      brew_methods: { value: ['v60'], source: 'conversation', capturedAt: null },
    });
    await resolveRemember('vitest-uid', [{ field: 'brew_methods', rawValue: 'v60' }], 1, 1);
    expect(mockedRecordBrewProfileChange).not.toHaveBeenCalled();
  });
});
