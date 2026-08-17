import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

// ─────────────────────────────────────────────────────────────────────────────
// Bloom Dial admin — Map & Journey (backend/src/features/dial_map_journey/
// CLAUDE_CODE_PROMPT_DIAL_MAP_JOURNEY.md). Everything rendered here — archetypes,
// vocabulary labels, coffee names, roasters, dimensions, hops — comes from
// GET /api/admin/dial/graph (or the adjacency endpoint for lane order). The only
// literals in this file are presentation tokens: the dimension→color map and the
// compass axis-angle formula, both keyed/derived from whatever `dimensions` the
// API returns, never assumed to be a fixed set. This page renders correctly
// (empty lanes, empty shelf, no arcs) against an empty database.
// ─────────────────────────────────────────────────────────────────────────────

// ── Types (mirror GET /api/admin/dial/graph) ──────────────────────────────────

interface DimensionInfo { id: number; name: string; platformAxis: string; }
interface VocabSlot { id: number; sortOrder: number; label: string; }
interface ArchetypeInfo {
  archetype: string; label: string; dominantDimensionId: number | null; vocabulary: VocabSlot[];
}
interface Position {
  id: number; coffeeId: number; coffeeName: string; roaster: string;
  archetype: string; vocabularyId: number; sortOrder: number;
  isDefault: boolean; isGuest: boolean;
}
type HopType = 'within_archetype' | 'bridge_archetype' | 'category_hop';
type Direction = 'more' | 'less';
type Confidence = 'low' | 'medium' | 'high';
interface Relationship {
  id: number;
  fromCoffeeId: number | null; fromCoffeeName: string | null;
  fromCategoryId: number | null; fromCategoryLabel: string | null;
  toCoffeeId: number | null; toCoffeeName: string | null;
  toCategoryId: number | null; toCategoryLabel: string | null;
  dimensionId: number; direction: Direction; delta: number | null;
  hopType: HopType; isRecommended: boolean; confidence: Confidence; notes: string | null;
  fromAvgScore: number | null; toAvgScore: number | null;
}
interface UnplacedCoffee {
  coffeeId: number; name: string; roaster: string; proposedArchetype: string; category: string | null;
}
interface Graph {
  dimensions: DimensionInfo[];
  archetypes: ArchetypeInfo[];
  positions: Position[];
  relationships: Relationship[];
  unplaced: UnplacedCoffee[];
}
interface CoffeeOption { id: number; name: string; roaster: string; archetype: string | null; }

// ── Presentation constants (allowed literals — keyed by/derived from data ids,
//    with defined fallbacks; never used to decide which dimensions/archetypes exist) ──

// Validated palette from the concept mockup, keyed by dimension id. Any dimension id
// not in this map (a future 5th dial dimension) falls back to FALLBACK_HOP_COLOR —
// the map is never consulted to decide *which* dimensions exist, only how to color one
// that the API already returned.
const DIMENSION_COLOR_MAP: Record<number, string> = {
  5: '#2a78d6', // Acidity
  6: '#1baf7a', // Bitterness
  7: '#eb6834', // Body
  9: '#4a3aa7', // Savory / Depth
};
const FALLBACK_HOP_COLOR = '#8a8a8a';

const CONFIDENCE_OPACITY: Record<Confidence, number> = { high: 1, medium: 0.7, low: 0.45 };

const BRAND = '#b05642';

// Compass axis geometry: given k dimensions sorted ascending by id (a stable, data-
// derived order — the same order the API already returns them in), the i-th spoke
// gets angle i * 180/k degrees (each spoke's opposite end is +180°, so k spokes
// evenly fill the 360° circle). For today's 4 dimensions (ids 5,6,7,9 → Acidity,
// Bitterness, Body, Savory/Depth) that yields 0°, 45°, 90°, 135° — Acidity E/W,
// Bitterness SE/NW, Body S/N, Savory/Depth NE/SW, matching the concept mockup
// exactly. A 5th dimension is never dropped — it gets its own evenly spaced angle
// (180/5 = 36° apart) instead of colliding with an existing spoke.
function axisAngleDeg(indexAscendingById: number, totalDimensions: number): number {
  if (totalDimensions <= 0) return 0;
  return (indexAscendingById * 180) / totalDimensions;
}

function roasterBadge(roaster: string): string {
  // Presentation-only initial, computed from whatever roaster string the data has —
  // a third roaster gets its own badge letter automatically, no code change needed.
  return (roaster.trim()[0] ?? '?').toUpperCase();
}

// ── Lane order (Map lens) ──────────────────────────────────────────────────────
// Derives lane order from live archetype-adjacency data so lane adjacency mirrors
// seam adjacency. `stableOrder` is the archetype list exactly as GET /api/admin/dial/graph
// returned it — which is itself ORDER BY dac.archetype, i.e. the archetype_enum's own
// declaration order in Postgres. Using that same order as the tie-break (which start
// node to try first, which neighbor to prefer at a branch) means there's no separate
// hardcoded preference list — the tie-break is just "the order the data already came in."
function computeLaneOrder(stableOrder: string[], adjacency: Record<string, string[]>): string[] {
  const nodes = stableOrder;
  const byStableIndex = (a: string, b: string) => nodes.indexOf(a) - nodes.indexOf(b);
  const neighborsOf = (n: string) => (adjacency[n] ?? []).filter(x => nodes.includes(x)).sort(byStableIndex);

  // Phase 1: exact Hamiltonian path via backtracking, trying start candidates and
  // branch choices in stable order. Small n (today: 5) — backtracking is cheap.
  function tryFrom(path: string[], visited: Set<string>): string[] | null {
    if (path.length === nodes.length) return path;
    const last = path[path.length - 1];
    for (const next of neighborsOf(last)) {
      if (visited.has(next)) continue;
      visited.add(next);
      const result = tryFrom([...path, next], visited);
      if (result) return result;
      visited.delete(next);
    }
    return null;
  }
  for (const start of [...nodes].sort(byStableIndex)) {
    const found = tryFrom([start], new Set([start]));
    if (found) return found;
  }

  // Phase 2 fallback: the adjacency graph isn't a clean Hamiltonian path (disconnected,
  // or every branch dead-ends). Greedy nearest-neighbor construction instead: repeatedly
  // extend the tail with an unvisited neighbor (stable-order tie-break); when the tail has
  // no unvisited neighbor, append the next unvisited node in stable order — a deliberate
  // non-adjacent "bridge crossing" in the lane order, unavoidable for a non-path graph.
  const order: string[] = [];
  const remaining = new Set(nodes);
  let current = [...nodes].sort(byStableIndex)[0];
  while (current) {
    order.push(current);
    remaining.delete(current);
    const next = neighborsOf(current).find(n => remaining.has(n))
      ?? [...remaining].sort(byStableIndex)[0];
    current = next as string;
    if (!current) break;
  }
  return order;
}

// ── API helper (matches existing admin-component fetch pattern) ───────────────

function useApiFetch() {
  const { user } = useAuth();
  return useCallback(async (url: string, options: RequestInit = {}) => {
    const token = await user!.getIdToken();
    return fetch(url, {
      cache: 'no-store',
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
  }, [user]);
}

// ── Arc grouping — one visual arc per undirected (endpoint, endpoint, dimension,
//    hopType) pair; a reverse row (opposite direction) merges into the same arc and
//    gets a double arrowhead instead of a second overlapping line. ────────────────

function endpointKey(coffeeId: number | null, categoryId: number | null): string {
  return coffeeId != null ? `c:${coffeeId}` : `g:${categoryId}`;
}
function arcGroupKey(r: Relationship): string {
  const a = endpointKey(r.fromCoffeeId, r.fromCategoryId);
  const b = endpointKey(r.toCoffeeId, r.toCategoryId);
  const [x, y] = [a, b].sort();
  return `${x}|${y}|${r.dimensionId}|${r.hopType}`;
}
interface Arc {
  key: string;
  rows: Relationship[];
  primary: Relationship;
  hasReverse: boolean;
  fromKey: string; // anchor lookup key
  toKey: string;
  dimensionId: number;
  hopType: HopType;
  contradiction: boolean;
}
function anchorKeyForRelationshipEnd(coffeeId: number | null, categoryId: number | null): string {
  return coffeeId != null ? `coffee:${coffeeId}` : `category:${categoryId}`;
}
function buildArcs(relationships: Relationship[]): Arc[] {
  const groups = new Map<string, Relationship[]>();
  for (const r of relationships) {
    const k = arcGroupKey(r);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const arcs: Arc[] = [];
  for (const [key, rows] of groups) {
    const primary = rows[0];
    const contradiction = rows.some(r => {
      if (r.fromAvgScore == null || r.toAvgScore == null) return false;
      const toIsMore = r.toAvgScore > r.fromAvgScore;
      const claimedToIsMore = r.direction === 'more';
      return toIsMore !== claimedToIsMore;
    });
    arcs.push({
      key, rows, primary, hasReverse: rows.length > 1,
      fromKey: anchorKeyForRelationshipEnd(primary.fromCoffeeId, primary.fromCategoryId),
      toKey: anchorKeyForRelationshipEnd(primary.toCoffeeId, primary.toCategoryId),
      dimensionId: primary.dimensionId, hopType: primary.hopType, contradiction,
    });
  }
  return arcs;
}

// ── Tooltip content builders ───────────────────────────────────────────────────

function positionTooltip(p: Position, dims: DimensionInfo[], arch: ArchetypeInfo | undefined): string {
  const slot = arch?.vocabulary.find(v => v.id === p.vocabularyId);
  const bits = [
    `${p.coffeeName} · ${p.roaster}`,
    `${arch?.label ?? p.archetype} — ${slot?.label ?? '?'} (${slot?.sortOrder ?? '?'} of ${arch?.vocabulary.length ?? '?'})`,
    p.isGuest ? 'guest position' : (p.isDefault ? 'default · cupped' : 'cupped'),
  ];
  return bits.join('\n');
}
function arcTooltip(a: Arc, dims: DimensionInfo[]): string {
  const dim = dims.find(d => d.id === a.dimensionId);
  const from = a.primary.fromCoffeeName ?? a.primary.fromCategoryLabel ?? '—';
  const to = a.primary.toCoffeeName ?? a.primary.toCategoryLabel ?? '—';
  const lines = [
    `${from} → ${to}`,
    `${dim?.platformAxis ?? dim?.name ?? `dimension #${a.dimensionId}`} · ${a.primary.direction}${a.primary.delta != null ? ` (Δ${a.primary.delta})` : ''}`,
    `${a.hopType === 'within_archetype' ? 'Dial Turn' : a.hopType === 'bridge_archetype' ? 'Bridge' : 'Category hop'} · ${a.primary.confidence} confidence · ${a.primary.isRecommended ? 'recommended' : 'secondary'}`,
  ];
  if (a.primary.notes) lines.push(a.primary.notes);
  if (a.contradiction) {
    lines.push(`⚠ cupping says ${a.primary.fromAvgScore} → ${a.primary.toAvgScore}, contradicts "${a.primary.direction}"`);
  }
  return lines.join('\n');
}

// ── Main component ─────────────────────────────────────────────────────────────

type Lens = 'map' | 'journey';

export default function AdminDial() {
  const apiFetch = useApiFetch();

  const [graph, setGraph] = useState<Graph | null>(null);
  const [adjacency, setAdjacency] = useState<Record<string, string[]>>({});
  const [coffeeOptions, setCoffeeOptions] = useState<CoffeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [lens, setLens] = useState<Lens>('map');
  const [trail, setTrail] = useState<number[]>([]);
  const [horizon, setHorizon] = useState<1 | 2 | 3>(1);

  const [dimensionFilter, setDimensionFilter] = useState<number | 'all'>('all');
  const [showDialTurns, setShowDialTurns] = useState(true);
  const [showBridges, setShowBridges] = useState(true);
  const [showGuests, setShowGuests] = useState(true);
  const [roasterFilter, setRoasterFilter] = useState<string | 'all'>('all');
  const [editMode, setEditMode] = useState(false);
  const [hoveredCoffeeId, setHoveredCoffeeId] = useState<number | null>(null);
  const [hoveredArcKey, setHoveredArcKey] = useState<string | null>(null);
  const [howToOpen, setHowToOpen] = useState(false);

  const [addHopArmed, setAddHopArmed] = useState(false);
  const [addHopSource, setAddHopSource] = useState<number | null>(null);
  const [hopDialog, setHopDialog] = useState<{ from: number; to: number } | null>(null);
  const [hopForm, setHopForm] = useState({
    dimensionId: '', direction: 'more' as Direction, delta: '1',
    isRecommended: true, confidence: 'medium' as Confidence, notes: '', mirror: true,
  });
  const [hopSaving, setHopSaving] = useState(false);
  const [hopError, setHopError] = useState('');

  const [addPositionSocket, setAddPositionSocket] = useState<{ archetype: string; vocabularyId: number } | null>(null);
  const [addPositionSearch, setAddPositionSearch] = useState('');
  const [arcDetail, setArcDetail] = useState<Arc | null>(null);

  const loadGraph = useCallback(async () => {
    try {
      const [graphRes, adjRes, coffeesRes] = await Promise.all([
        apiFetch('/api/admin/dial/graph'),
        apiFetch('/api/axis/adjacency'),
        apiFetch('/api/admin/coffees'),
      ]);
      if (!graphRes.ok) throw new Error('Failed to fetch dial graph');
      const graphData: Graph = await graphRes.json();
      const adjData = await adjRes.json().catch(() => ({ adjacency: {} }));
      const coffeesData = await coffeesRes.json().catch(() => []);
      setGraph(graphData);
      setAdjacency(adjData.adjacency ?? {});
      setCoffeeOptions((coffeesData as any[]).map(c => ({ id: c.id, name: c.name, roaster: c.roaster, archetype: c.archetype ?? null })));
      setError('');
    } catch (err) {
      reportError('[AdminDial/load]', err);
      setError('Failed to load the dial graph.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  const laneOrder = useMemo(() => {
    if (!graph) return [];
    return computeLaneOrder(graph.archetypes.map(a => a.archetype), adjacency);
  }, [graph, adjacency]);

  const sortedDimensions = useMemo(
    () => (graph ? [...graph.dimensions].sort((a, b) => a.id - b.id) : []),
    [graph]
  );

  const roasters = useMemo(() => {
    if (!graph) return [];
    return Array.from(new Set(graph.positions.map(p => p.roaster))).sort();
  }, [graph]);

  const arcs = useMemo(() => (graph ? buildArcs(graph.relationships) : []), [graph]);

  const visibleArcs = useMemo(() => arcs.filter(a => {
    if (dimensionFilter !== 'all' && a.dimensionId !== dimensionFilter) return false;
    if (a.hopType === 'within_archetype' && !showDialTurns) return false;
    if ((a.hopType === 'bridge_archetype' || a.hopType === 'category_hop') && !showBridges) return false;
    if (roasterFilter !== 'all') {
      const coffeeIds = [a.primary.fromCoffeeId, a.primary.toCoffeeId].filter((x): x is number => x != null);
      const posByCoffee = graph?.positions.filter(p => coffeeIds.includes(p.coffeeId)) ?? [];
      const touchesRoaster = posByCoffee.some(p => p.roaster === roasterFilter);
      if (coffeeIds.length > 0 && !touchesRoaster) return false; // ghosted, not filtered — handled below
    }
    return true;
  }), [arcs, dimensionFilter, showDialTurns, showBridges, roasterFilter, graph]);

  // ── audit strip (client-computed from graph) ─────────────────────────────────
  const audits = useMemo(() => {
    if (!graph) return null;
    const openRange: { archetype: string; label: string; vocab: VocabSlot }[] = [];
    const guestHeld: { archetype: string; vocab: VocabSlot }[] = [];
    for (const arch of graph.archetypes) {
      for (const vocab of arch.vocabulary) {
        const here = graph.positions.filter(p => p.archetype === arch.archetype && p.vocabularyId === vocab.id);
        if (here.length === 0) openRange.push({ archetype: arch.archetype, label: arch.label, vocab });
        else if (here.every(p => p.isGuest)) guestHeld.push({ archetype: arch.archetype, vocab });
      }
    }
    const oneWay: Relationship[] = [];
    for (const r of graph.relationships) {
      const hasReverse = graph.relationships.some(o =>
        o.id !== r.id && o.dimensionId === r.dimensionId && o.direction !== r.direction &&
        endpointKey(o.fromCoffeeId, o.fromCategoryId) === endpointKey(r.toCoffeeId, r.toCategoryId) &&
        endpointKey(o.toCoffeeId, o.toCategoryId) === endpointKey(r.fromCoffeeId, r.fromCategoryId));
      if (!hasReverse) oneWay.push(r);
    }
    const coffeeIds = new Set(graph.positions.filter(p => !p.isGuest).map(p => p.coffeeId));
    const thin: { coffeeId: number; name: string; reason: string }[] = [];
    for (const cid of coffeeIds) {
      const hops = graph.relationships.filter(r => r.fromCoffeeId === cid || r.toCoffeeId === cid);
      const name = graph.positions.find(p => p.coffeeId === cid)?.coffeeName ?? `#${cid}`;
      if (hops.length === 0) thin.push({ coffeeId: cid, name, reason: 'no hops at all' });
      else if (hops.every(h => !h.isRecommended)) thin.push({ coffeeId: cid, name, reason: 'every hop is secondary' });
    }
    const archPairs: string[] = [];
    for (let i = 0; i < laneOrder.length; i++) {
      for (let j = i + 1; j < laneOrder.length; j++) {
        const a = laneOrder[i], b = laneOrder[j];
        const bridged = graph.relationships.some(r => r.hopType === 'bridge_archetype' &&
          [a, b].includes(graph.positions.find(p => p.coffeeId === r.fromCoffeeId)?.archetype ?? '') &&
          [a, b].includes(graph.positions.find(p => p.coffeeId === r.toCoffeeId)?.archetype ?? ''));
        if (!bridged) archPairs.push(`${graph.archetypes.find(x => x.archetype === a)?.label ?? a} ↔ ${graph.archetypes.find(x => x.archetype === b)?.label ?? b}`);
      }
    }
    return { openRange, guestHeld, oneWay, thin, archPairs };
  }, [graph, laneOrder]);

  // ── layout measurement for SVG arcs ──────────────────────────────────────────
  const boardRef = useRef<HTMLDivElement>(null);
  const anchorRefs = useRef<Map<string, HTMLElement>>(new Map());
  const registerAnchor = useCallback((key: string) => (el: HTMLElement | null) => {
    if (el) anchorRefs.current.set(key, el);
    else anchorRefs.current.delete(key);
  }, []);
  const [arcGeometry, setArcGeometry] = useState<Map<string, { x1: number; y1: number; x2: number; y2: number }>>(new Map());

  const recomputeGeometry = useCallback(() => {
    const board = boardRef.current;
    if (!board || !graph) return;
    const boardRect = board.getBoundingClientRect();
    const next = new Map<string, { x1: number; y1: number; x2: number; y2: number }>();
    for (const a of visibleArcs) {
      const fromEl = anchorRefs.current.get(a.fromKey);
      const toEl = anchorRefs.current.get(a.toKey);
      if (!fromEl || !toEl) continue;
      const fr = fromEl.getBoundingClientRect();
      const tr = toEl.getBoundingClientRect();
      // Anchor at the pill's bottom edge (+ a small gap), not its vertical center — arcs
      // then depart from below each name instead of visually cutting through the text.
      next.set(a.key, {
        x1: fr.left + fr.width / 2 - boardRect.left, y1: fr.bottom + 3 - boardRect.top,
        x2: tr.left + tr.width / 2 - boardRect.left, y2: tr.bottom + 3 - boardRect.top,
      });
    }
    setArcGeometry(next);
  }, [graph, visibleArcs]);

  useLayoutEffect(() => { recomputeGeometry(); }, [recomputeGeometry]);
  useEffect(() => {
    const onResize = () => recomputeGeometry();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [recomputeGeometry]);

  // ── writes (all reuse existing endpoints; every success refetches graph) ──────

  async function refetch() { await loadGraph(); }

  async function movePosition(pos: Position, vocabularyId: number) {
    try {
      const res = await apiFetch(`/api/admin/dial/positions/${pos.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabulary_id: vocabularyId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Move failed');
      await refetch();
    } catch (err) { reportError('[AdminDial/move]', err); setToast(err instanceof Error ? err.message : 'Move failed'); }
  }
  async function toggleDefault(pos: Position) {
    try {
      const res = await apiFetch(`/api/admin/dial/positions/${pos.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: !pos.isDefault }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Update failed');
      await refetch();
    } catch (err) { reportError('[AdminDial/default]', err); setToast(err instanceof Error ? err.message : 'Update failed'); }
  }
  async function removePosition(pos: Position) {
    const arch = graph?.archetypes.find(a => a.archetype === pos.archetype);
    const slot = arch?.vocabulary.find(v => v.id === pos.vocabularyId);
    if (!confirm(`Remove ${pos.coffeeName} from ${arch?.label ?? pos.archetype} — ${slot?.label ?? '?'}?`)) return;
    try {
      const url = pos.isGuest ? `/api/admin/dial/positions/guest/${pos.id}` : `/api/admin/dial/positions/${pos.id}`;
      const res = await apiFetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Remove failed');
      await refetch();
    } catch (err) { reportError('[AdminDial/remove]', err); setToast(err instanceof Error ? err.message : 'Remove failed'); }
  }
  async function addPosition(coffee: CoffeeOption, archetype: string, vocabularyId: number) {
    const isHome = coffee.archetype === archetype;
    try {
      const res = await apiFetch(isHome ? '/api/admin/dial/positions' : '/api/admin/dial/positions/guest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isHome
          ? { archetype, coffee_id: coffee.id, vocabulary_id: vocabularyId }
          : { coffee_id: coffee.id, archetype, vocabulary_id: vocabularyId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Add failed');
      setAddPositionSocket(null); setAddPositionSearch('');
      await refetch();
    } catch (err) { reportError('[AdminDial/add-position]', err); setToast(err instanceof Error ? err.message : 'Add failed'); }
  }

  function openAddHopDialog(from: number, to: number) {
    setHopDialog({ from, to });
    const fromArch = graph?.positions.find(p => p.coffeeId === from)?.archetype;
    const toArch = graph?.positions.find(p => p.coffeeId === to)?.archetype;
    setHopForm({
      dimensionId: '', direction: 'more', delta: '1', isRecommended: true, confidence: 'medium', notes: '',
      mirror: true,
    });
    setHopError('');
    void fromArch; void toArch;
  }
  function hopTypeFor(from: number, to: number): HopType {
    const fromArch = graph?.positions.find(p => p.coffeeId === from)?.archetype;
    const toArch = graph?.positions.find(p => p.coffeeId === to)?.archetype;
    return fromArch && toArch && fromArch === toArch ? 'within_archetype' : 'bridge_archetype';
  }
  async function saveHop() {
    if (!hopDialog || !hopForm.dimensionId) { setHopError('Dimension is required'); return; }
    setHopSaving(true); setHopError('');
    const hopType = hopTypeFor(hopDialog.from, hopDialog.to);
    try {
      const res = await apiFetch('/api/admin/dial/relationships', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_coffee_id: hopDialog.from, to_coffee_id: hopDialog.to,
          dimension_id: Number(hopForm.dimensionId), direction: hopForm.direction, hop_type: hopType,
          delta: hopForm.delta ? Number(hopForm.delta) : null,
          is_recommended: hopForm.isRecommended, confidence: hopForm.confidence, notes: hopForm.notes || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setHopError(res.status === 409 ? 'This hop already exists.' : (body.error ?? 'Failed to save hop'));
        setHopSaving(false); return;
      }
      if (hopForm.mirror) {
        const mirrorRes = await apiFetch('/api/admin/dial/relationships', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from_coffee_id: hopDialog.to, to_coffee_id: hopDialog.from,
            dimension_id: Number(hopForm.dimensionId),
            direction: hopForm.direction === 'more' ? 'less' : 'more', hop_type: hopType,
            delta: hopForm.delta ? Number(hopForm.delta) : null,
            is_recommended: hopForm.isRecommended, confidence: hopForm.confidence,
            notes: hopForm.notes ? `${hopForm.notes} (reverse)` : null,
          }),
        });
        void mirrorRes;
      }
      if (body.warning) setToast(body.warning);
      setHopDialog(null); setAddHopArmed(false); setAddHopSource(null);
      await refetch();
    } catch (err) {
      reportError('[AdminDial/add-hop]', err);
      setHopError(err instanceof Error ? err.message : 'Failed to save hop');
    } finally { setHopSaving(false); }
  }
  async function deleteHopRow(id: number) {
    try {
      const res = await apiFetch(`/api/admin/dial/relationships/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed');
      setArcDetail(null);
      await refetch();
    } catch (err) { reportError('[AdminDial/delete-hop]', err); setToast(err instanceof Error ? err.message : 'Delete failed'); }
  }

  function onPillClick(coffeeId: number) {
    if (editMode && addHopArmed) {
      if (addHopSource == null) { setAddHopSource(coffeeId); return; }
      if (addHopSource === coffeeId) { setAddHopSource(null); return; }
      openAddHopDialog(addHopSource, coffeeId);
      setAddHopSource(null);
      return;
    }
    if (editMode) return; // edit mode uses the dedicated move/star/remove affordances
    setTrail(t => [...t, coffeeId]);
    setLens('journey');
    setHorizon(1);
  }

  function travelTo(coffeeId: number, trailIndex?: number) {
    setLens('journey'); setHorizon(1);
    setTrail(t => trailIndex != null ? t.slice(0, trailIndex + 1) : [...t, coffeeId]);
  }

  if (loading) return <div className="text-sm text-stone-400 py-12 text-center">Loading dial graph…</div>;
  if (error || !graph) return <div className="text-sm text-red-500 py-12 text-center">{error || 'No data'}</div>;

  const journeyCoffeeId = trail[trail.length - 1] ?? null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-normal text-stone-800">Bloom Dial — Map &amp; Journey</h1>
          <p className="text-xs text-stone-400 mt-0.5">
            The Map is every coffee in its slot, every hop, every seam. Click any coffee to stand on it — the Journey lens shows the world from there.
          </p>
        </div>
        <div className="flex rounded-lg border border-stone-200 overflow-hidden shrink-0">
          <button onClick={() => setLens('map')}
            className={`px-4 py-1.5 text-sm ${lens === 'map' ? 'text-white' : 'text-stone-500 hover:bg-stone-50'}`}
            style={lens === 'map' ? { backgroundColor: '#1c1c1c' } : {}}>Map</button>
          <button onClick={() => journeyCoffeeId != null && setLens('journey')}
            disabled={journeyCoffeeId == null}
            className={`px-4 py-1.5 text-sm disabled:opacity-40 ${lens === 'journey' ? 'text-white' : 'text-stone-500 hover:bg-stone-50'}`}
            style={lens === 'journey' ? { backgroundColor: '#1c1c1c' } : {}}>Journey</button>
        </div>
      </div>

      {toast && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <span>{toast}</span>
          <button onClick={() => setToast('')} className="text-sm text-amber-400 hover:text-amber-700 shrink-0">✕</button>
        </div>
      )}

      {lens === 'map' ? (
        <MapLens
          graph={graph} laneOrder={laneOrder} sortedDimensions={sortedDimensions} roasters={roasters}
          arcs={visibleArcs} arcGeometry={arcGeometry} boardRef={boardRef} registerAnchor={registerAnchor}
          dimensionFilter={dimensionFilter} setDimensionFilter={setDimensionFilter}
          showDialTurns={showDialTurns} setShowDialTurns={setShowDialTurns}
          showBridges={showBridges} setShowBridges={setShowBridges}
          showGuests={showGuests} setShowGuests={setShowGuests}
          roasterFilter={roasterFilter} setRoasterFilter={setRoasterFilter}
          editMode={editMode} setEditMode={setEditMode}
          hoveredCoffeeId={hoveredCoffeeId} setHoveredCoffeeId={setHoveredCoffeeId}
          hoveredArcKey={hoveredArcKey} setHoveredArcKey={setHoveredArcKey}
          howToOpen={howToOpen} setHowToOpen={setHowToOpen}
          onPillClick={onPillClick}
          addHopArmed={addHopArmed} setAddHopArmed={setAddHopArmed}
          addHopSource={addHopSource} setAddHopSource={setAddHopSource}
          onMove={movePosition} onToggleDefault={toggleDefault} onRemove={removePosition}
          addPositionSocket={addPositionSocket} setAddPositionSocket={setAddPositionSocket}
          addPositionSearch={addPositionSearch} setAddPositionSearch={setAddPositionSearch}
          coffeeOptions={coffeeOptions} onAddPosition={addPosition}
          arcDetail={arcDetail} setArcDetail={setArcDetail} onDeleteHopRow={deleteHopRow}
          audits={audits}
        />
      ) : journeyCoffeeId != null ? (
        <JourneyLens
          graph={graph} sortedDimensions={sortedDimensions} coffeeId={journeyCoffeeId}
          trail={trail} onTravel={travelTo} onBackToMap={() => setLens('map')}
          horizon={horizon} setHorizon={setHorizon}
          editMode={editMode}
          onDeadEndAddHop={(coffeeId, dimensionId, direction) => {
            setEditMode(true);
            openAddHopDialog(coffeeId, coffeeId); // placeholder target — dialog lets admin pick target below
            setHopForm(f => ({ ...f, dimensionId: String(dimensionId), direction }));
          }}
        />
      ) : null}

      {hopDialog && (
        <HopDialog
          graph={graph} dialog={hopDialog} setDialog={setHopDialog} form={hopForm} setForm={setHopForm}
          saving={hopSaving} error={hopError} onSave={saveHop} onCancel={() => { setHopDialog(null); setHopError(''); }}
          hopType={hopTypeFor(hopDialog.from, hopDialog.to)}
        />
      )}
    </div>
  );
}

// ── Map lens ────────────────────────────────────────────────────────────────────

function MapLens(props: {
  graph: Graph; laneOrder: string[]; sortedDimensions: DimensionInfo[]; roasters: string[];
  arcs: Arc[]; arcGeometry: Map<string, { x1: number; y1: number; x2: number; y2: number }>;
  boardRef: React.RefObject<HTMLDivElement>; registerAnchor: (key: string) => (el: HTMLElement | null) => void;
  dimensionFilter: number | 'all'; setDimensionFilter: (v: number | 'all') => void;
  showDialTurns: boolean; setShowDialTurns: (v: boolean) => void;
  showBridges: boolean; setShowBridges: (v: boolean) => void;
  showGuests: boolean; setShowGuests: (v: boolean) => void;
  roasterFilter: string | 'all'; setRoasterFilter: (v: string | 'all') => void;
  editMode: boolean; setEditMode: (v: boolean) => void;
  hoveredCoffeeId: number | null; setHoveredCoffeeId: (v: number | null) => void;
  hoveredArcKey: string | null; setHoveredArcKey: (v: string | null) => void;
  howToOpen: boolean; setHowToOpen: (v: boolean) => void;
  onPillClick: (coffeeId: number) => void;
  addHopArmed: boolean; setAddHopArmed: (v: boolean) => void;
  addHopSource: number | null; setAddHopSource: (v: number | null) => void;
  onMove: (pos: Position, vocabularyId: number) => void;
  onToggleDefault: (pos: Position) => void;
  onRemove: (pos: Position) => void;
  addPositionSocket: { archetype: string; vocabularyId: number } | null;
  setAddPositionSocket: (v: { archetype: string; vocabularyId: number } | null) => void;
  addPositionSearch: string; setAddPositionSearch: (v: string) => void;
  coffeeOptions: CoffeeOption[];
  onAddPosition: (coffee: CoffeeOption, archetype: string, vocabularyId: number) => void;
  arcDetail: Arc | null; setArcDetail: (v: Arc | null) => void;
  onDeleteHopRow: (id: number) => void;
  audits: {
    openRange: { archetype: string; label: string; vocab: VocabSlot }[];
    guestHeld: { archetype: string; vocab: VocabSlot }[];
    oneWay: Relationship[];
    thin: { coffeeId: number; name: string; reason: string }[];
    archPairs: string[];
  } | null;
}) {
  const { graph, laneOrder, sortedDimensions, roasters, arcs, arcGeometry, boardRef, registerAnchor,
    dimensionFilter, setDimensionFilter, showDialTurns, setShowDialTurns, showBridges, setShowBridges,
    showGuests, setShowGuests, roasterFilter, setRoasterFilter, editMode, setEditMode,
    hoveredCoffeeId, setHoveredCoffeeId, hoveredArcKey, setHoveredArcKey, howToOpen, setHowToOpen,
    onPillClick, addHopArmed, setAddHopArmed, addHopSource, setAddHopSource,
    onMove, onToggleDefault, onRemove, addPositionSocket, setAddPositionSocket,
    addPositionSearch, setAddPositionSearch, coffeeOptions, onAddPosition,
    arcDetail, setArcDetail, onDeleteHopRow, audits } = props;

  const highlightedCoffeeIds = useMemo(() => {
    if (hoveredCoffeeId == null) return null;
    const ids = new Set<number>([hoveredCoffeeId]);
    for (const a of arcs) {
      if (a.primary.fromCoffeeId === hoveredCoffeeId && a.primary.toCoffeeId != null) ids.add(a.primary.toCoffeeId);
      if (a.primary.toCoffeeId === hoveredCoffeeId && a.primary.fromCoffeeId != null) ids.add(a.primary.fromCoffeeId);
    }
    return ids;
  }, [hoveredCoffeeId, arcs]);

  function arcPath(a: Arc): string | null {
    const g = arcGeometry.get(a.key);
    if (!g) return null;
    const { x1, y1, x2, y2 } = g;
    const dx = x2 - x1;
    if (a.hopType === 'within_archetype') {
      const dip = 18;
      const cx = (x1 + x2) / 2, cy = Math.max(y1, y2) + dip;
      return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
    }
    if (a.hopType === 'category_hop') {
      const cy = Math.max(y1, y2) + 32;
      return `M ${x1} ${y1} Q ${x1} ${cy} ${x2} ${y2}`;
    }
    // bridge_archetype — adjacent lanes get a tight direct S-curve, control points
    // pulled in close to the straight line rather than ballooning outward.
    if (Math.abs(dx) < 400) {
      const cx1 = x1 + dx * 0.35, cx2 = x1 + dx * 0.65;
      return `M ${x1} ${y1} C ${cx1} ${y1} ${cx2} ${y2} ${x2} ${y2}`;
    }
    // Far-apart lanes: one quadratic control point just left of whichever anchor is
    // already leftmost (not a fixed board-edge margin) — a contained hug of the near
    // edge instead of a wide rectangular loop across the whole board.
    const marginX = Math.min(x1, x2) - 50;
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} Q ${marginX} ${midY} ${x2} ${y2}`;
  }
  function arcMidpoint(a: Arc): { x: number; y: number } | null {
    const g = arcGeometry.get(a.key);
    if (!g) return null;
    return { x: (g.x1 + g.x2) / 2, y: (g.y1 + g.y2) / 2 };
  }
  function strokeDash(a: Arc): string | undefined {
    if (a.primary.isRecommended) return undefined;
    if (a.primary.confidence === 'low') return '1,4';
    return '6,4';
  }

  return (
    <div>
      <button onClick={() => setHowToOpen(!howToOpen)} className="text-xs text-stone-400 hover:text-stone-600 mb-2">
        {howToOpen ? '▼' : '▶'} How to read the map
      </button>
      {howToOpen && (
        <p className="text-xs text-stone-500 mb-3 max-w-3xl leading-relaxed">
          Each row is an archetype's dial — one socket per vocabulary slot, gentle on the left, pronounced on the right.
          Solid pills are coffees in their home slot (★ = default). Dashed pills are guests — coffees whose home is another
          dial, welding families together at a touching edge. Curved lines are hops, colored by the dimension you travel
          on; hops between rows are the seams. Empty slots with an amber tint are open range.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={() => setDimensionFilter('all')}
          className={`px-3 py-1 rounded-full text-xs border ${dimensionFilter === 'all' ? 'border-stone-800 text-stone-800' : 'border-stone-200 text-stone-500'}`}>
          All dimensions
        </button>
        {sortedDimensions.map(d => (
          <button key={d.id} onClick={() => setDimensionFilter(d.id)}
            className={`px-3 py-1 rounded-full text-xs border flex items-center gap-1.5 ${dimensionFilter === d.id ? 'border-stone-800 text-stone-800' : 'border-stone-200 text-stone-500'}`}>
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: DIMENSION_COLOR_MAP[d.id] ?? FALLBACK_HOP_COLOR }} />
            {d.platformAxis}
          </button>
        ))}
        <span className="w-px h-4 bg-stone-200 mx-1" />
        <button onClick={() => setShowDialTurns(!showDialTurns)}
          className={`px-3 py-1 rounded-full text-xs border ${showDialTurns ? 'border-stone-800 text-stone-800' : 'border-stone-200 text-stone-400'}`}>Dial turns</button>
        <button onClick={() => setShowBridges(!showBridges)}
          className={`px-3 py-1 rounded-full text-xs border ${showBridges ? 'border-stone-800 text-stone-800' : 'border-stone-200 text-stone-400'}`}>Bridges</button>
        <button onClick={() => setShowGuests(!showGuests)}
          className={`px-3 py-1 rounded-full text-xs border ${showGuests ? 'border-stone-800 text-stone-800' : 'border-stone-200 text-stone-400'}`}>Guests</button>
        <span className="w-px h-4 bg-stone-200 mx-1" />
        <button onClick={() => setRoasterFilter('all')}
          className={`px-3 py-1 rounded-full text-xs border ${roasterFilter === 'all' ? 'border-stone-800 text-stone-800' : 'border-stone-200 text-stone-500'}`}>All roasters</button>
        {roasters.map(r => (
          <button key={r} onClick={() => setRoasterFilter(r)}
            className={`px-3 py-1 rounded-full text-xs border ${roasterFilter === r ? 'border-stone-800 text-stone-800' : 'border-stone-200 text-stone-500'}`}>
            {roasterBadge(r)} · {r}
          </button>
        ))}
        <span className="flex-1" />
        <button
          onClick={() => { setEditMode(!editMode); setAddHopArmed(false); setAddHopSource(null); }}
          className={`px-4 py-1.5 rounded text-sm ${editMode ? 'text-white' : 'text-stone-600 border border-stone-300'}`}
          style={editMode ? { backgroundColor: BRAND } : {}}>
          {editMode ? 'Done editing' : 'Edit'}
        </button>
        {editMode && (
          <button
            onClick={() => { setAddHopArmed(!addHopArmed); setAddHopSource(null); }}
            className={`px-3 py-1.5 rounded text-sm border ${addHopArmed ? 'border-stone-800 text-stone-800' : 'border-stone-300 text-stone-600'}`}>
            {addHopArmed ? (addHopSource ? 'Click target coffee…' : 'Click source coffee…') : '+ Add hop'}
          </button>
        )}
      </div>

      <div ref={boardRef} className="relative border border-stone-100 rounded-lg p-4 overflow-x-auto" style={{ minWidth: 720 }}>
        <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%" style={{ overflow: 'visible' }}>
          {arcs.map(a => {
            const path = arcPath(a);
            if (!path) return null;
            const color = DIMENSION_COLOR_MAP[a.dimensionId] ?? FALLBACK_HOP_COLOR;
            const somethingHovered = hoveredCoffeeId != null || hoveredArcKey != null;
            const isRelevant = hoveredArcKey === a.key ||
              (hoveredCoffeeId != null &&
                ((a.primary.fromCoffeeId != null && a.primary.fromCoffeeId === hoveredCoffeeId) ||
                 (a.primary.toCoffeeId != null && a.primary.toCoffeeId === hoveredCoffeeId)));
            const isFiltered = roasterFilter !== 'all' && !graph.positions.some(p =>
              (p.coffeeId === a.primary.fromCoffeeId || p.coffeeId === a.primary.toCoffeeId) && p.roaster === roasterFilter);
            // Dim by default (resting state) — the board otherwise reads as an
            // illegible tangle of ~48 hops at once. Hovering a coffee or an arc itself
            // brings just that hop's family up to full strength; everything else stays
            // low. This is the same highlight/dim behavior the mockup describes, just
            // applied as the *default* rather than only on top of an always-visible line.
            let opacity: number;
            if (somethingHovered) opacity = isRelevant ? CONFIDENCE_OPACITY[a.primary.confidence] : 0.05;
            else opacity = 0.14;
            if (isFiltered) opacity = Math.min(opacity, 0.08);
            const mid = arcMidpoint(a);
            return (
              <g key={a.key} opacity={opacity}>
                <path d={path} fill="none" stroke={color} strokeWidth={2} strokeDasharray={strokeDash(a)}
                  markerEnd="url(#arrow)" markerStart={a.hasReverse ? 'url(#arrow)' : undefined}
                  style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredArcKey(a.key)} onMouseLeave={() => setHoveredArcKey(null)}
                  onClick={() => setArcDetail(a)}>
                  <title>{arcTooltip(a, sortedDimensions)}</title>
                </path>
                {a.contradiction && mid && (
                  <text x={mid.x} y={mid.y} textAnchor="middle" fontSize={12} style={{ pointerEvents: 'none' }}>⚠</text>
                )}
              </g>
            );
          })}
          <defs>
            <marker id="arrow" markerWidth={8} markerHeight={8} refX={7} refY={4} orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#8a8a8a" />
            </marker>
          </defs>
        </svg>

        <div className="relative" style={{ zIndex: 1 }}>
          {laneOrder.map(archKey => {
            const arch = graph.archetypes.find(a => a.archetype === archKey);
            if (!arch) return null;
            return (
              <Lane key={archKey} archetype={arch} graph={graph} sortedDimensions={sortedDimensions}
                registerAnchor={registerAnchor} editMode={editMode}
                showGuests={showGuests} roasterFilter={roasterFilter}
                hoveredCoffeeId={hoveredCoffeeId} setHoveredCoffeeId={setHoveredCoffeeId}
                highlightedCoffeeIds={highlightedCoffeeIds}
                onPillClick={onPillClick} onMove={onMove} onToggleDefault={onToggleDefault} onRemove={onRemove}
                addPositionSocket={addPositionSocket} setAddPositionSocket={setAddPositionSocket}
                addHopArmed={addHopArmed} addHopSource={addHopSource}
              />
            );
          })}

          <div className="mt-6 pt-4 border-t border-stone-100">
            <div className="text-xs text-stone-400 mb-2">Off-dial (uncupped)</div>
            <div className="flex flex-wrap gap-2 items-center">
              {graph.unplaced.map(u => (
                <div key={u.coffeeId} ref={registerAnchor(`coffee:${u.coffeeId}`)}
                  className="px-2.5 py-1 rounded border border-dashed border-stone-300 text-xs text-stone-500 bg-stone-50">
                  {u.name} <span className="text-stone-300">{u.category ?? ''}</span>
                </div>
              ))}
              {graph.relationships.some(r => r.toCategoryId != null || r.fromCategoryId != null) && (() => {
                const catRel = graph.relationships.find(r => r.toCategoryId != null || r.fromCategoryId != null);
                const catId = catRel?.toCategoryId ?? catRel?.fromCategoryId ?? null;
                const catLabel = catRel?.toCategoryLabel ?? catRel?.fromCategoryLabel ?? 'Category';
                return catId != null ? (
                  <div ref={registerAnchor(`category:${catId}`)}
                    className="px-2.5 py-1 rounded border border-dashed border-stone-400 text-xs text-stone-600">
                    {catLabel} (category)
                  </div>
                ) : null;
              })()}
            </div>
          </div>
        </div>
      </div>

      {addPositionSocket && (
        <AddPositionPopover
          socket={addPositionSocket} onClose={() => setAddPositionSocket(null)}
          coffeeOptions={coffeeOptions} search={addPositionSearch} setSearch={setAddPositionSearch}
          graph={graph} adjacencyCheckArchetype={addPositionSocket.archetype}
          onPick={c => onAddPosition(c, addPositionSocket.archetype, addPositionSocket.vocabularyId)}
        />
      )}

      {arcDetail && (
        <ArcDetailPopover arc={arcDetail} dims={sortedDimensions} editMode={editMode}
          onClose={() => setArcDetail(null)} onDelete={onDeleteHopRow} />
      )}

      {audits && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-6">
          <AuditCard title="Open range" value={audits.openRange.length}>
            {audits.openRange.map((o, i) => <div key={i}>{o.label} · {o.vocab.label}</div>)}
          </AuditCard>
          <AuditCard title="Guest-held slots" value={audits.guestHeld.length}>
            {audits.guestHeld.map((o, i) => <div key={i}>{graph.archetypes.find(a => a.archetype === o.archetype)?.label} · {o.vocab.label}</div>)}
          </AuditCard>
          <AuditCard title="One-way doors" value={audits.oneWay.length}>
            {audits.oneWay.length === 0
              ? <div>None — every hop out has a matching hop back.</div>
              : audits.oneWay.map(r => <div key={r.id}>{r.fromCoffeeName ?? r.fromCategoryLabel} → {r.toCoffeeName ?? r.toCategoryLabel}</div>)}
          </AuditCard>
          <AuditCard title="Thin connections" value={audits.thin.length}>
            {audits.thin.map(t => <div key={t.coffeeId}>{t.name} — {t.reason}</div>)}
          </AuditCard>
          <AuditCard title="Unbridged archetype pairs" value={audits.archPairs.length}>
            {audits.archPairs.map((p, i) => <div key={i}>{p}</div>)}
          </AuditCard>
        </div>
      )}
    </div>
  );
}

function AuditCard({ title, value, children }: { title: string; value: number; children: React.ReactNode }) {
  return (
    <div className="border border-stone-100 rounded-lg p-3 bg-stone-50/60">
      <div className="text-2xl text-stone-800">{value}</div>
      <div className="text-xs text-stone-500 mb-1.5">{title}</div>
      <div className="text-xs text-stone-400 leading-snug max-h-24 overflow-y-auto">{children}</div>
    </div>
  );
}

function Lane(props: {
  archetype: ArchetypeInfo; graph: Graph; sortedDimensions: DimensionInfo[];
  registerAnchor: (key: string) => (el: HTMLElement | null) => void; editMode: boolean;
  showGuests: boolean; roasterFilter: string | 'all';
  hoveredCoffeeId: number | null; setHoveredCoffeeId: (v: number | null) => void;
  highlightedCoffeeIds: Set<number> | null;
  onPillClick: (coffeeId: number) => void;
  onMove: (pos: Position, vocabularyId: number) => void;
  onToggleDefault: (pos: Position) => void;
  onRemove: (pos: Position) => void;
  addPositionSocket: { archetype: string; vocabularyId: number } | null;
  setAddPositionSocket: (v: { archetype: string; vocabularyId: number } | null) => void;
  addHopArmed: boolean; addHopSource: number | null;
}) {
  const { archetype, graph, sortedDimensions, registerAnchor, editMode, showGuests, roasterFilter,
    hoveredCoffeeId, setHoveredCoffeeId, highlightedCoffeeIds, onPillClick, onMove, onToggleDefault, onRemove,
    addPositionSocket, setAddPositionSocket, addHopArmed, addHopSource } = props;
  const dim = sortedDimensions.find(d => d.id === archetype.dominantDimensionId);
  const vocab = [...archetype.vocabulary].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="flex border-b border-stone-50 py-3">
      <div className="w-40 shrink-0 pr-3">
        <div className="text-sm text-stone-800">{archetype.label}</div>
        {dim && (
          <div className="text-xs text-stone-400 flex items-center gap-1.5 mt-0.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: DIMENSION_COLOR_MAP[dim.id] ?? FALLBACK_HOP_COLOR }} />
            {dim.platformAxis}
          </div>
        )}
      </div>
      <div className="flex-1 grid gap-2" style={{ gridTemplateColumns: `repeat(${vocab.length || 1}, minmax(150px, 1fr))` }}>
        {vocab.map(v => {
          const here = graph.positions.filter(p => p.archetype === archetype.archetype && p.vocabularyId === v.id)
            .filter(p => showGuests || !p.isGuest)
            .sort((a, b) => (a.isGuest === b.isGuest ? a.roaster.localeCompare(b.roaster) : a.isGuest ? 1 : -1));
          const open = here.length === 0;
          const isAddingHere = addPositionSocket?.archetype === archetype.archetype && addPositionSocket.vocabularyId === v.id;
          return (
            <div key={v.id} className={`rounded border px-2 py-1.5 min-h-[52px] ${open ? 'border-amber-200 bg-amber-50/50' : 'border-stone-100'}`}>
              {here.map(p => (
                <Pill key={p.id} pos={p} archetype={archetype} registerAnchor={registerAnchor}
                  dimmed={highlightedCoffeeIds != null && !highlightedCoffeeIds.has(p.coffeeId)}
                  filtered={roasterFilter !== 'all' && p.roaster !== roasterFilter}
                  onHoverEnter={() => setHoveredCoffeeId(p.coffeeId)} onHoverLeave={() => setHoveredCoffeeId(null)}
                  onClick={() => onPillClick(p.coffeeId)}
                  armedAsSource={addHopArmed && addHopSource === p.coffeeId}
                  editMode={editMode}
                  vocab={vocab} onMove={onMove} onToggleDefault={onToggleDefault} onRemove={onRemove}
                  sortedDimensions={sortedDimensions}
                />
              ))}
              {open && !editMode && <div className="text-xs text-amber-500 text-center pt-2">open</div>}
              {open && editMode && !isAddingHere && (
                <button onClick={() => setAddPositionSocket({ archetype: archetype.archetype, vocabularyId: v.id })}
                  className="text-xs text-stone-400 hover:text-stone-700 w-full text-center pt-2">+ place a coffee</button>
              )}
              <div className="text-[10px] text-stone-300 text-center mt-1">{v.sortOrder} · {v.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Pill(props: {
  pos: Position; archetype: ArchetypeInfo; registerAnchor: (key: string) => (el: HTMLElement | null) => void;
  dimmed: boolean; filtered: boolean; onHoverEnter: () => void; onHoverLeave: () => void; onClick: () => void;
  armedAsSource: boolean; editMode: boolean; vocab: VocabSlot[];
  onMove: (pos: Position, vocabularyId: number) => void;
  onToggleDefault: (pos: Position) => void;
  onRemove: (pos: Position) => void;
  sortedDimensions: DimensionInfo[];
}) {
  const { pos, archetype, registerAnchor, dimmed, filtered, onHoverEnter, onHoverLeave, onClick,
    armedAsSource, editMode, vocab, onMove, onToggleDefault, onRemove, sortedDimensions } = props;
  const idx = vocab.findIndex(v => v.id === pos.vocabularyId);
  const prev = vocab[idx - 1], next = vocab[idx + 1];
  return (
    <div ref={registerAnchor(`coffee:${pos.coffeeId}`)}
      className={`flex items-center gap-1 text-xs py-0.5 group ${pos.isGuest ? 'border border-dashed border-stone-300 rounded px-1' : ''}`}
      style={{ opacity: dimmed ? 0.2 : (filtered ? 0.3 : 1) }}
      onMouseEnter={onHoverEnter} onMouseLeave={onHoverLeave}>
      {editMode && !pos.isGuest && (
        <button onClick={() => prev && onMove(pos, prev.id)} disabled={!prev}
          className="text-stone-200 hover:text-stone-500 disabled:opacity-0 group-hover:opacity-100 transition-all px-0.5">←</button>
      )}
      <button onClick={onClick}
        className={`text-stone-700 hover:underline ${armedAsSource ? 'font-semibold underline' : ''}`}
        title={positionTooltip(pos, sortedDimensions, archetype)}>
        <span className="inline-block w-3 h-3 rounded-full text-[9px] leading-3 text-center border border-stone-300 mr-1 align-middle">
          {roasterBadge(pos.roaster)}
        </span>
        {pos.coffeeName}
      </button>
      {pos.isGuest && <span className="text-[9px] text-stone-400 border border-stone-200 rounded px-1">guest</span>}
      {!pos.isGuest && (
        editMode
          ? <button onClick={() => onToggleDefault(pos)} className={pos.isDefault ? 'text-amber-500' : 'text-stone-200 hover:text-amber-400'}>★</button>
          : (pos.isDefault && <span className="text-amber-500">★</span>)
      )}
      {editMode && !pos.isGuest && (
        <button onClick={() => next && onMove(pos, next.id)} disabled={!next}
          className="text-stone-200 hover:text-stone-500 disabled:opacity-0 group-hover:opacity-100 transition-all px-0.5">→</button>
      )}
      {editMode && (
        <button onClick={() => onRemove(pos)} className="text-stone-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">×</button>
      )}
    </div>
  );
}

function AddPositionPopover(props: {
  socket: { archetype: string; vocabularyId: number }; onClose: () => void;
  coffeeOptions: CoffeeOption[]; search: string; setSearch: (v: string) => void;
  graph: Graph; adjacencyCheckArchetype: string;
  onPick: (c: CoffeeOption) => void;
}) {
  const { socket, onClose, coffeeOptions, search, setSearch, graph, onPick } = props;
  const placedIds = new Set(graph.positions.map(p => p.coffeeId));
  const filtered = coffeeOptions
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    .filter(c => !(placedIds.has(c.id) && graph.positions.some(p => p.coffeeId === c.id && p.archetype === socket.archetype)));
  const archLabel = graph.archetypes.find(a => a.archetype === socket.archetype)?.label ?? socket.archetype;
  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-4 w-80" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm text-stone-700">Place a coffee — {archLabel}</h3>
          <button onClick={onClose} className="text-stone-300 hover:text-stone-600">✕</button>
        </div>
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search coffees…"
          className="w-full border border-stone-300 rounded px-3 py-1.5 text-sm mb-2" />
        <div className="max-h-64 overflow-y-auto divide-y divide-stone-50">
          {filtered.map(c => {
            const isHome = c.archetype === socket.archetype;
            return (
              <button key={c.id} onClick={() => onPick(c)}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-stone-50 flex items-center justify-between">
                <span>{c.name} <span className="text-stone-300 text-xs">{c.roaster}</span></span>
                {!isHome && (
                  <span className="text-xs text-stone-400">add as guest — home stays at {graph.archetypes.find(a => a.archetype === c.archetype)?.label ?? c.archetype ?? '—'}</span>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && <div className="text-xs text-stone-400 py-4 text-center">No matches.</div>}
        </div>
      </div>
    </div>
  );
}

function ArcDetailPopover({ arc, dims, editMode, onClose, onDelete }: {
  arc: Arc; dims: DimensionInfo[]; editMode: boolean; onClose: () => void; onDelete: (id: number) => void;
}) {
  const dim = dims.find(d => d.id === arc.dimensionId);
  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-4 w-96" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm text-stone-700">
            {arc.primary.fromCoffeeName ?? arc.primary.fromCategoryLabel} → {arc.primary.toCoffeeName ?? arc.primary.toCategoryLabel}
          </h3>
          <button onClick={onClose} className="text-stone-300 hover:text-stone-600">✕</button>
        </div>
        <p className="text-xs text-stone-500 mb-1">{dim?.platformAxis ?? dim?.name} · {arc.primary.direction}{arc.primary.delta != null ? ` (Δ${arc.primary.delta})` : ''}</p>
        <p className="text-xs text-stone-500 mb-1">
          {arc.hopType === 'within_archetype' ? 'Dial Turn' : arc.hopType === 'bridge_archetype' ? 'Bridge' : 'Category hop (read-only)'} · {arc.primary.confidence} confidence · {arc.primary.isRecommended ? 'recommended' : 'secondary'}
        </p>
        {arc.primary.notes && <p className="text-xs text-stone-400 mb-2">{arc.primary.notes}</p>}
        {arc.hopType !== 'category_hop' && editMode && (
          <div className="flex gap-2 mt-3">
            {arc.rows.map(r => (
              <button key={r.id} onClick={() => onDelete(r.id)}
                className="text-xs px-3 py-1.5 rounded border border-red-200 text-red-500 hover:bg-red-50">
                Delete {r.direction === arc.primary.direction ? 'this direction' : 'reverse direction'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HopDialog(props: {
  graph: Graph; dialog: { from: number; to: number }; setDialog: (v: { from: number; to: number } | null) => void;
  form: { dimensionId: string; direction: Direction; delta: string; isRecommended: boolean; confidence: Confidence; notes: string; mirror: boolean };
  setForm: (fn: (f: any) => any) => void;
  saving: boolean; error: string; onSave: () => void; onCancel: () => void; hopType: HopType;
}) {
  const { graph, dialog, form, setForm, saving, error, onSave, onCancel, hopType } = props;
  const fromName = graph.positions.find(p => p.coffeeId === dialog.from)?.coffeeName ?? `#${dialog.from}`;
  const toName = graph.positions.find(p => p.coffeeId === dialog.to)?.coffeeName ?? `#${dialog.to}`;
  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-lg p-5 w-96" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm text-stone-700 mb-1">Add hop — {fromName} → {toName}</h3>
        <p className="text-xs text-stone-400 mb-3">{hopType === 'within_archetype' ? 'Dial Turn (same archetype)' : 'Bridge (different archetypes)'}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-stone-400 mb-1">Dimension *</label>
            <select value={form.dimensionId} onChange={e => setForm((f: any) => ({ ...f, dimensionId: e.target.value }))}
              className="w-full border border-stone-300 rounded px-2 py-1.5 text-sm">
              <option value="">— select —</option>
              {graph.dimensions.map(d => <option key={d.id} value={d.id}>{d.platformAxis}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">Direction *</label>
            <select value={form.direction} onChange={e => setForm((f: any) => ({ ...f, direction: e.target.value }))}
              className="w-full border border-stone-300 rounded px-2 py-1.5 text-sm">
              <option value="more">More</option>
              <option value="less">Less</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">Delta</label>
            <input type="number" step="0.1" value={form.delta} onChange={e => setForm((f: any) => ({ ...f, delta: e.target.value }))}
              className="w-full border border-stone-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">Confidence</label>
            <select value={form.confidence} onChange={e => setForm((f: any) => ({ ...f, confidence: e.target.value }))}
              className="w-full border border-stone-300 rounded px-2 py-1.5 text-sm">
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" id="hop-rec" checked={form.isRecommended} onChange={e => setForm((f: any) => ({ ...f, isRecommended: e.target.checked }))} />
            <label htmlFor="hop-rec" className="text-sm text-stone-600">Recommended</label>
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" id="hop-mirror" checked={form.mirror} onChange={e => setForm((f: any) => ({ ...f, mirror: e.target.checked }))} />
            <label htmlFor="hop-mirror" className="text-sm text-stone-600">Also create the reverse hop</label>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1">Notes</label>
            <input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))}
              className="w-full border border-stone-300 rounded px-2 py-1.5 text-sm" />
          </div>
        </div>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="text-sm text-stone-500 px-3 py-1.5">Cancel</button>
          <button onClick={onSave} disabled={saving}
            className="text-sm text-white px-4 py-1.5 rounded disabled:opacity-50" style={{ backgroundColor: BRAND }}>
            {saving ? 'Saving…' : 'Save hop'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Journey lens ────────────────────────────────────────────────────────────────

function JourneyLens(props: {
  graph: Graph; sortedDimensions: DimensionInfo[]; coffeeId: number;
  trail: number[]; onTravel: (coffeeId: number, trailIndex?: number) => void; onBackToMap: () => void;
  horizon: 1 | 2 | 3; setHorizon: (v: 1 | 2 | 3) => void;
  editMode: boolean;
  onDeadEndAddHop: (coffeeId: number, dimensionId: number, direction: Direction) => void;
}) {
  const { graph, sortedDimensions, coffeeId, trail, onTravel, onBackToMap, horizon, setHorizon, editMode, onDeadEndAddHop } = props;

  const homePos = graph.positions.find(p => p.coffeeId === coffeeId && !p.isGuest);
  const guestPos = graph.positions.filter(p => p.coffeeId === coffeeId && p.isGuest);
  const unplaced = graph.unplaced.find(u => u.coffeeId === coffeeId);
  const name = homePos?.coffeeName ?? unplaced?.name ?? `#${coffeeId}`;
  const roaster = homePos?.roaster ?? unplaced?.roaster ?? '';
  const archetype = homePos ? graph.archetypes.find(a => a.archetype === homePos.archetype) : undefined;
  const slot = archetype?.vocabulary.find(v => v.id === homePos?.vocabularyId);

  const outbound = graph.relationships.filter(r => r.fromCoffeeId === coffeeId && r.toCoffeeId != null);
  const inbound = graph.relationships.filter(r => r.toCoffeeId === coffeeId && r.fromCoffeeId != null);
  const oneWayInbound = inbound.filter(r => !outbound.some(o => o.toCoffeeId === r.fromCoffeeId && o.dimensionId === r.dimensionId));

  // BFS horizon over directed coffee↔coffee hops.
  const edges = graph.relationships.filter(r => r.fromCoffeeId != null && r.toCoffeeId != null);
  function bfsRing(n: number): { coffeeId: number; path: number[] }[] {
    const dist = new Map<number, number[]>([[coffeeId, [coffeeId]]]);
    let frontier = [coffeeId];
    for (let step = 1; step <= n; step++) {
      const nextFrontier: number[] = [];
      for (const cid of frontier) {
        for (const e of edges.filter(x => x.fromCoffeeId === cid)) {
          const target = e.toCoffeeId as number;
          if (dist.has(target)) continue;
          dist.set(target, [...(dist.get(cid) ?? []), target]);
          nextFrontier.push(target);
        }
      }
      frontier = nextFrontier;
      if (step === n) return frontier.map(cid => ({ coffeeId: cid, path: dist.get(cid) ?? [] }));
    }
    return [];
  }
  const allReachable = new Set<number>([coffeeId]);
  const rings: { turn: number; coffees: { coffeeId: number; path: number[] }[] }[] = [];
  for (let t = 1; t <= horizon; t++) {
    const ring = bfsRing(t).filter(r => !allReachable.has(r.coffeeId));
    ring.forEach(r => allReachable.add(r.coffeeId));
    rings.push({ turn: t, coffees: ring });
  }
  const beyond = graph.positions.filter(p => !p.isGuest && !allReachable.has(p.coffeeId))
    .map(p => p.coffeeName);

  const dimCount = sortedDimensions.length;

  return (
    <div>
      <div className="flex items-center gap-1.5 text-sm mb-4 flex-wrap">
        <button onClick={onBackToMap} className="text-stone-400 hover:text-stone-700">← Map</button>
        {trail.map((cid, i) => {
          const p = graph.positions.find(x => x.coffeeId === cid && !x.isGuest) ?? graph.positions.find(x => x.coffeeId === cid);
          const label = p?.coffeeName ?? graph.unplaced.find(u => u.coffeeId === cid)?.name ?? `#${cid}`;
          const isLast = i === trail.length - 1;
          return (
            <span key={i} className="flex items-center gap-1.5">
              <span className="text-stone-300">|</span>
              {isLast
                ? <span className="text-stone-800 font-medium">{label}</span>
                : <button onClick={() => onTravel(cid, i)} className="text-stone-400 hover:text-stone-700">{label}</button>}
              {!isLast && <span className="text-stone-300">→</span>}
            </span>
          );
        })}
      </div>

      <div className="relative mx-auto border border-stone-100 rounded-lg" style={{ width: 560, height: 560 }}>
        <div className="absolute inset-0 rounded-full border border-dashed border-stone-100 m-16" />
        <div className="absolute inset-0 rounded-full border border-dashed border-stone-100 m-28" />

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-stone-800 rounded-lg bg-white px-4 py-3 text-center z-10 max-w-[220px]">
          <div className="text-sm font-medium text-stone-800">{name}</div>
          <div className="text-xs text-stone-400">{roaster}{homePos ? (homePos.isDefault ? ' · ★ default' : '') : ''}</div>
          {archetype && (
            <div className="text-xs text-stone-500 mt-1">{archetype.label} — {slot?.label} ({slot?.sortOrder} of {archetype.vocabulary.length})</div>
          )}
          {guestPos.length > 0 && (
            <div className="text-xs text-stone-400 mt-1">
              guest at {guestPos.map(g => graph.archetypes.find(a => a.archetype === g.archetype)?.label).join(', ')}
            </div>
          )}
        </div>

        {sortedDimensions.map((d, i) => {
          const angle = axisAngleDeg(i, dimCount);
          const rad = (angle * Math.PI) / 180;
          const dx = Math.cos(rad), dy = Math.sin(rad);
          const more = outbound.filter(r => r.dimensionId === d.id && r.direction === 'more');
          const less = outbound.filter(r => r.dimensionId === d.id && r.direction === 'less');
          const color = DIMENSION_COLOR_MAP[d.id] ?? FALLBACK_HOP_COLOR;
          return (
            <div key={d.id}>
              {[{ chips: more, sign: 1, label: `more ${d.platformAxis.toLowerCase()}` },
                { chips: less, sign: -1, label: `less ${d.platformAxis.toLowerCase()}` }].map(({ chips, sign, label: spokeLabel }) => {
                const bx = 280 + dx * sign * 240, by = 280 + dy * sign * 240;
                const lx = 280 + dx * sign * 270, ly = 280 + dy * sign * 270;
                return (
                  <div key={sign}>
                    <div className="absolute text-[10px] text-stone-300" style={{ left: lx - 40, top: ly - 6, width: 80, textAlign: 'center' }}>
                      {spokeLabel}
                    </div>
                    {chips.length === 0 ? (
                      <div className="absolute" style={{ left: bx - 8, top: by - 8 }}>
                        <button
                          onClick={() => editMode && onDeadEndAddHop(coffeeId, d.id, sign === 1 ? 'more' : 'less')}
                          className="w-4 h-4 rounded-full border border-dashed border-stone-300"
                          title={`dead end — no ${spokeLabel} move`} />
                      </div>
                    ) : chips.map((c, ci) => {
                      const offset = (ci - (chips.length - 1) / 2) * 26;
                      const perpX = -dy, perpY = dx;
                      const cx = bx + perpX * offset, cy = by + perpY * offset;
                      return (
                        <button key={c.id}
                          onClick={() => onTravel(c.toCoffeeId as number)}
                          className="absolute px-2 py-1 rounded border border-stone-200 bg-white text-xs hover:border-stone-800 text-left"
                          style={{ left: cx - 55, top: cy - 14, width: 110, borderLeftColor: color, borderLeftWidth: 3 }}
                          title={`Δ${c.delta ?? 1}`}>
                          {c.toCoffeeName}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-stone-500 mt-3 text-center">
        {inbound.length} arrival{inbound.length === 1 ? '' : 's'} land{inbound.length === 1 ? 's' : ''} here from {new Set(inbound.map(r => r.fromCoffeeId)).size} coffee{new Set(inbound.map(r => r.fromCoffeeId)).size === 1 ? '' : 's'}
        {' — '}
        {oneWayInbound.length === 0
          ? 'every arrival has a matching departure (no one-way doors at this coffee).'
          : `${oneWayInbound.length} one-way arrival${oneWayInbound.length === 1 ? '' : 's'}: ${oneWayInbound.map(r => r.fromCoffeeName).join(', ')}.`}
      </p>

      <div className="flex items-center gap-2 mt-4">
        <span className="text-xs text-stone-400">Horizon:</span>
        {[1, 2, 3].map(n => (
          <button key={n} onClick={() => setHorizon(n as 1 | 2 | 3)}
            className={`px-3 py-1 rounded-full text-xs border ${horizon === n ? 'border-stone-800 text-stone-800' : 'border-stone-200 text-stone-500'}`}>
            {n} turn{n === 1 ? '' : 's'}
          </button>
        ))}
      </div>
      <div className="text-xs mt-2 space-y-1">
        {rings.slice(1).map(r => (
          <div key={r.turn}>
            <span className="text-stone-400">Reachable in {r.turn} turns ({r.coffees.length}): </span>
            {r.coffees.map((c, i) => {
              const cname = graph.positions.find(p => p.coffeeId === c.coffeeId)?.coffeeName ?? `#${c.coffeeId}`;
              const pathNames = c.path.map(pid => graph.positions.find(p => p.coffeeId === pid)?.coffeeName ?? `#${pid}`).join(' → ');
              return (
                <button key={c.coffeeId} onClick={() => onTravel(c.coffeeId)} title={pathNames}
                  className="text-stone-600 hover:underline mr-2">{cname}{i < r.coffees.length - 1 ? ',' : ''}</button>
              );
            })}
          </div>
        ))}
        {horizon === 1 && <div className="text-stone-400">Showing direct moves only.</div>}
        {beyond.length > 0 && (
          <div className="text-stone-400">Beyond {horizon} turn{horizon === 1 ? '' : 's'}: {beyond.join(' · ')}</div>
        )}
      </div>
    </div>
  );
}
