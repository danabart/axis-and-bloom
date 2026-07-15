import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import bagImage from '../../../design/IMAGES/bags/GENERIC_bag_front_v3_your_archetype.png';
import { WORLD_LANDMASSES } from './worldOutline';

// ── The Axis map — one abstract visual, seven states (0–6) ──────────────────
// Renders a purely synthetic, seeded network: cluster centers per archetype
// (and, in states 0-1, per world sourcing region), node counts driven by live
// aggregate counts (never real coffee IDs, coordinates, or dimension data —
// see THE_AXIS_REDESIGN_STRATEGY.md §2 and CLAUDE_CODE_PROMPT_THE_AXIS_V2.md's
// competitive-safety rules). Positions are generated layout with a fixed seed,
// not real placements.
//
// Round 2 (CLAUDE_CODE_PROMPT_THE_AXIS_V2_REFINEMENTS_R2.md) restructured the
// opening: states 0-1 show geography (origin is where the data starts), state
// 2 migrates every dot into its archetype region (flavor is where it lives —
// the page's signature moment), states 3-6 are unchanged flavor-space views.
// State 6 (Handoff) plays once per mount — see hasPlayedHandoff below.

export type ArchetypeKey = 'fruity' | 'floral' | 'balanced_sweet' | 'chocolate_nutty' | 'earthy';
type GeoKey = 'africa' | 'central_america' | 'south_america' | 'asia';

export interface AxisMapStats {
  archetypes: { key: string; name: string; coffeeCount: number }[];
  connectionCount: number;
  experimentalCount: number;
}

interface AxisMapProps {
  stage: number; // 0 (hero) through 6 (handoff, at the CTA)
  focusArchetype?: ArchetypeKey | null;
  stats?: AxisMapStats | null;
  reducedMotion?: boolean;
}

// Generic, non-brand vocabulary only — never real coffee/roastery names.
// Cross-archetype rotation per CLAUDE_CODE_PROMPT_THE_AXIS_V2_REFINEMENTS_R6.md
// item ("familiar coffee vocabulary" — flavor words ~2:1 over process words).
// Only a curated 6-word subset is currently wired to the stream word-slots
// below (FIELD_STREAMS); the full list is kept here as the canonical pool.
const FIELD_FRAGMENTS = [
  'chocolate', 'nutty', 'caramel', 'hazelnut', 'cocoa', 'honey',
  'berry', 'citrus', 'jasmine', 'floral', 'stone fruit', 'earthy',
  'spice', 'full body', 'washed', 'natural', 'honey process',
];

const ARCHETYPE_ORDER: ArchetypeKey[] = ['fruity', 'floral', 'balanced_sweet', 'chocolate_nutty', 'earthy'];

const ARCHETYPE_LABEL: Record<ArchetypeKey, string> = {
  fruity: 'Fruity',
  floral: 'Floral',
  balanced_sweet: 'Balanced & Sweet',
  chocolate_nutty: 'Chocolate & Nutty',
  earthy: 'Earthy',
};

const ARCHETYPE_VAR: Record<ArchetypeKey, string> = {
  fruity: 'var(--color-archetype-fruity)',
  floral: 'var(--color-archetype-floral)',
  balanced_sweet: 'var(--color-archetype-balanced-sweet)',
  chocolate_nutty: 'var(--color-archetype-chocolate-nutty)',
  earthy: 'var(--color-archetype-earthy)',
};

// World sourcing regions — geography labels only, never real farm/roastery names.
const GEO_ORDER: GeoKey[] = ['central_america', 'south_america', 'africa', 'asia'];
const GEO_LABEL: Record<GeoKey, string> = {
  africa: 'AFRICA & ARABIA',
  central_america: 'CENTRAL AMERICA & MEXICO',
  south_america: 'SOUTH AMERICA',
  asia: 'ASIA & PACIFIC',
};
const NEUTRAL_COLOR = '#8a7a6b';

// Deterministic PRNG (mulberry32) — same layout every render/reload.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Point along a quadratic bezier at t∈[0,1] — used to place the traveling
// dot/ticks exactly on a capture-stream curve, not a straight-line approximation.
function quadPoint(p0: { x: number; y: number }, c: { x: number; y: number }, p1: { x: number; y: number }, t: number) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
  };
}

interface Node {
  id: string;
  archetype: ArchetypeKey;
  cx: number;
  cy: number;
  geoRegion: GeoKey;
  geoCx: number;
  geoCy: number;
  isExperimental: boolean;
  driftPhase: number;
}

interface Edge {
  id: string;
  from: Node;
  to: Node;
  bridge: boolean; // crosses archetype regions
}

const VIEW_W = 640;
const VIEW_H = 520; // the map proper (archetype/geo clusters live in 0..VIEW_H)
const HANDOFF_BAND = 300; // reserved, always-empty-until-state-6 strip below the map
const TOTAL_VIEW_H = VIEW_H + HANDOFF_BAND;
const CENTER_X = VIEW_W / 2;
const CENTER_Y = VIEW_H / 2 + 10;
const CLUSTER_RADIUS = 190;
const NODE_MAX_PER_CLUSTER = 7;
const NODE_MIN_PER_CLUSTER = 3;

// Loosely echoes real west-to-east world layout (not accurate coordinates —
// see worldOutline.ts) so dots sit "on" the coffee-belt silhouette beneath them.
const GEO_CLUSTER_CENTERS: Record<GeoKey, { x: number; y: number }> = {
  central_america: { x: 140, y: 175 },
  south_america: { x: 185, y: 330 },
  africa: { x: 365, y: 255 },
  asia: { x: 515, y: 220 },
};

function buildLayout(stats: AxisMapStats | null | undefined) {
  const rand = mulberry32(20260714);

  const totalExperimental = Math.min(stats?.experimentalCount ?? 3, 8);
  let experimentalLeft = totalExperimental;

  const nodes: Node[] = [];
  const clusterCenters: Record<ArchetypeKey, { x: number; y: number; angle: number }> = {} as any;

  ARCHETYPE_ORDER.forEach((key, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / ARCHETYPE_ORDER.length;
    const cx = CENTER_X + CLUSTER_RADIUS * Math.cos(angle);
    const cy = CENTER_Y + CLUSTER_RADIUS * Math.sin(angle);
    clusterCenters[key] = { x: cx, y: cy, angle };

    const rawCount = stats?.archetypes.find(a => a.key === key)?.coffeeCount ?? 5;
    const count = Math.max(NODE_MIN_PER_CLUSTER, Math.min(NODE_MAX_PER_CLUSTER, rawCount || NODE_MIN_PER_CLUSTER));

    for (let n = 0; n < count; n++) {
      const jitterR = 34 + rand() * 58;
      const jitterA = rand() * Math.PI * 2;
      const wantsExperimental = experimentalLeft > 0 && rand() < 0.3;
      if (wantsExperimental) experimentalLeft--;

      const geoRegion = GEO_ORDER[Math.floor(rand() * GEO_ORDER.length)];
      const geoCenter = GEO_CLUSTER_CENTERS[geoRegion];
      const geoJitterR = 20 + rand() * 55;
      const geoJitterA = rand() * Math.PI * 2;

      nodes.push({
        id: `${key}-${n}`,
        archetype: key,
        cx: cx + jitterR * Math.cos(jitterA),
        cy: cy + jitterR * Math.sin(jitterA),
        geoRegion,
        geoCx: geoCenter.x + geoJitterR * Math.cos(geoJitterA),
        geoCy: geoCenter.y + geoJitterR * Math.sin(geoJitterA),
        isExperimental: wantsExperimental,
        driftPhase: rand() * Math.PI * 2,
      });
    }
  });

  // Within-cluster edges: connect each node to its nearest 1–2 siblings.
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const addEdge = (a: Node, b: Node, bridge: boolean) => {
    const key = [a.id, b.id].sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ id: key, from: a, to: b, bridge });
  };

  ARCHETYPE_ORDER.forEach(key => {
    const clusterNodes = nodes.filter(n => n.archetype === key);
    clusterNodes.forEach((node, i) => {
      const next = clusterNodes[(i + 1) % clusterNodes.length];
      if (next && next.id !== node.id) addEdge(node, next, false);
      if (rand() < 0.4) {
        const other = clusterNodes[Math.floor(rand() * clusterNodes.length)];
        if (other && other.id !== node.id) addEdge(node, other, false);
      }
    });
  });

  // Bridge edges between adjacent regions (fixed count, density-flavored by connectionCount).
  const bridgeBudget = Math.max(4, Math.min(10, Math.round((stats?.connectionCount ?? 30) / 6)));
  for (let i = 0; i < ARCHETYPE_ORDER.length && edges.filter(e => e.bridge).length < bridgeBudget; i++) {
    const a = ARCHETYPE_ORDER[i];
    const b = ARCHETYPE_ORDER[(i + 1) % ARCHETYPE_ORDER.length];
    const aNodes = nodes.filter(n => n.archetype === a);
    const bNodes = nodes.filter(n => n.archetype === b);
    const na = aNodes[Math.floor(rand() * aNodes.length)];
    const nb = bNodes[Math.floor(rand() * bNodes.length)];
    if (na && nb) addEdge(na, nb, true);
  }

  const experimentalNodes = nodes.filter(n => n.isExperimental);
  const highlightWalk: Edge[] = [];
  if (experimentalNodes.length > 0) {
    const target = experimentalNodes[0];
    const home = nodes.find(n => n.archetype === target.archetype && !n.isExperimental);
    const bridgeFromHome = edges.find(e => e.bridge && (e.from.archetype === target.archetype || e.to.archetype === target.archetype));
    if (home) highlightWalk.push({ id: 'walk-1', from: home, to: target, bridge: false });
    if (bridgeFromHome) highlightWalk.push(bridgeFromHome);
  }

  return { nodes, edges, clusterCenters, highlightWalk };
}

function useReducedMotionPreference(explicit?: boolean) {
  const [prefers, setPrefers] = useState(explicit ?? false);
  useEffect(() => {
    if (explicit !== undefined) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefers(mq.matches);
    const onChange = () => setPrefers(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [explicit]);
  return prefers;
}

export default function AxisMap({ stage, focusArchetype, stats, reducedMotion }: AxisMapProps) {
  const prefersReduced = useReducedMotionPreference(reducedMotion);
  const { nodes, edges, clusterCenters, highlightWalk } = useMemo(() => buildLayout(stats), [stats]);
  const transitionDuration = prefersReduced ? 0.3 : 1;
  const migrationDuration = prefersReduced ? 0.3 : 1.8;
  const ease: [number, number, number, number] = [0.16, 1, 0.3, 1];

  const isGeoStage = stage <= 1;           // states 0-1: geography, no archetypes
  const labelsFull = stage >= 2;
  const edgesVisible = stage >= 3;
  const walkHighlighted = stage === 3;
  const showReaderChips = stage === 4;
  const showRefineCycle = stage === 5;
  const showHandoff = stage === 6;

  const highlightWalkIds = new Set(highlightWalk.map(e => e.id));

  // The "incoming coffee" demo node — a single narrative thread walked through
  // Capture (state 1, gray, near the geographic clusters) → Structure (state
  // 2, resolves, migrates and takes its region's color). From state 2 on it
  // behaves like any other node.
  const incomingGeoAnchor = GEO_CLUSTER_CENTERS[GEO_ORDER[0]];
  const incomingGeoStart = { cx: incomingGeoAnchor.x + 14, cy: incomingGeoAnchor.y - 10 };
  const incomingArchetypeTarget = { cx: clusterCenters.fruity.x + 22, cy: clusterCenters.fruity.y - 16 };
  const showIncomingDemo = stage === 1 || stage === 2;

  // The 3 field streams (state 1), each carrying 1-2 words anchored to the
  // first ~40% of its own path (t=0.10 / t=0.37, ≥25% apart) — never near
  // the merge zone. Two words per stream max; alternating above/below
  // offset so the word rides the line without covering it. `wave` groups
  // one word per stream into a shared, non-overlapping timing window (see
  // the word transition below) so at most 3 words are ever visible at once
  // globally, and never more than 1 per stream at a time.
  const FIELD_STREAMS = [
    {
      start: { x: 30, y: 30 }, ctrl: { x: incomingGeoStart.cx - 160, y: incomingGeoStart.cy - 130 },
      words: [
        { t: 0.10, yOffset: -10, word: FIELD_FRAGMENTS[0], wave: 0 },  // chocolate
        { t: 0.37, yOffset: 10, word: FIELD_FRAGMENTS[14], wave: 1 },  // washed
      ],
    },
    {
      start: { x: 60, y: 90 }, ctrl: { x: incomingGeoStart.cx - 110, y: incomingGeoStart.cy - 70 },
      words: [
        { t: 0.10, yOffset: -10, word: FIELD_FRAGMENTS[8], wave: 0 },  // jasmine
        { t: 0.37, yOffset: 10, word: FIELD_FRAGMENTS[10], wave: 1 }, // stone fruit
      ],
    },
    {
      start: { x: 20, y: 150 }, ctrl: { x: incomingGeoStart.cx - 150, y: incomingGeoStart.cy - 20 },
      words: [
        { t: 0.10, yOffset: -10, word: FIELD_FRAGMENTS[11], wave: 0 }, // earthy
        { t: 0.37, yOffset: 10, word: FIELD_FRAGMENTS[16], wave: 1 }, // honey process
      ],
    },
  ];


  // Handoff (state 6) — one dot detaches and lands on the bag as an
  // archetype-colored swatch inside the dashed label box. Defaults to the
  // visitor's archetype if entry-aware, else a fixed seeded default (the
  // first cluster) so the choice is stable, not random. Lands in the
  // reserved band below the map so it never collides with region labels
  // (round-2 fix). Round 3: real generic-bag asset (593×1273), scaled to
  // ~260px tall; swatch position read directly off the asset (just left of
  // "Your Archetype" inside its dashed box) as a fraction of the bag's
  // rendered box, so it scales cleanly if the bag size ever changes.
  const handoffArchetype = focusArchetype ?? ARCHETYPE_ORDER[0];
  const handoffNode = nodes.find(n => n.archetype === handoffArchetype && !n.isExperimental) ?? nodes[0];
  const handoffLanding = { cx: CENTER_X, cy: VIEW_H + HANDOFF_BAND / 2 };
  const BAG_ASPECT = 593 / 1273;
  const bagHeight = 260;
  const bagWidth = bagHeight * BAG_ASPECT;
  const bagBox = { x: handoffLanding.cx - bagWidth / 2, y: handoffLanding.cy - bagHeight / 2, width: bagWidth, height: bagHeight };
  // Round 5: the persistent round swatch read as a stray dot overlapping the
  // "Y" in "Your Archetype." Replaced with a thin underline beneath the text
  // — position/width estimated from the actual asset (visually inspected):
  // centered under the text, sitting just below its baseline and clearly
  // above "WHOLE BEAN COFFEE."
  const underlineBox = {
    x: bagBox.x + bagBox.width * 0.19,
    y: bagBox.y + bagBox.height * 0.415,
    width: bagBox.width * 0.62,
    height: 3.5,
  };
  const underlineTarget = { cx: underlineBox.x + underlineBox.width / 2, cy: underlineBox.y };
  const travelDotSize = 10;

  const [hasPlayedHandoff, setHasPlayedHandoff] = useState(false);
  useEffect(() => {
    if (stage === 6) setHasPlayedHandoff(true);
  }, [stage]);
  const isFirstHandoffPlay = showHandoff && !hasPlayedHandoff && !prefersReduced;

  // Round 4 fix: the reserved handoff band only belongs in the viewBox for
  // the one instance that ever shows it (the CTA's stage-6 map). Every other
  // instance (Hero, journey) previously always carried the tall 640x820
  // aspect even though it never rendered anything in that band — which made
  // those maps sit disproportionately tall/high against their text columns.
  const svgHeight = stage === 6 ? TOTAL_VIEW_H : VIEW_H;
  const pctX = (px: number) => (px / VIEW_W) * 100;
  const pctY = (px: number) => (px / svgHeight) * 100;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
    <svg
      viewBox={`0 0 ${VIEW_W} ${svgHeight}`}
      width="100%"
      style={{ display: 'block', overflow: 'visible' }}
      role="img"
      aria-label="An abstract, anonymized map of coffees connected by taste, grouped into five archetype regions"
    >
      {/* Everything but the Handoff dims to let the bag take the stage (round-2 fix) */}
      <motion.g
        initial={false}
        animate={{ opacity: showHandoff ? 0.25 : 1 }}
        transition={{ duration: transitionDuration, ease }}
      >
        {/* World-map silhouette — states 0-1 only. A single muted, low-poly
            landmass layer (worldOutline.ts) standing in for "origin," not a
            set of archetype-like regions. Abstract pattern, not an atlas. */}
        <motion.g
          initial={false}
          animate={{ opacity: isGeoStage ? 1 : 0 }}
          transition={{ duration: transitionDuration, ease }}
        >
          {WORLD_LANDMASSES.map((d, i) => (
            <path key={i} d={d} fill={NEUTRAL_COLOR} fillOpacity={0.14} stroke="none" />
          ))}
        </motion.g>

        {/* Coffee-belt labels — states 0-1 only, positioned near their dot groups */}
        {GEO_ORDER.map(key => {
          const c = GEO_CLUSTER_CENTERS[key];
          const dx = c.x - CENTER_X;
          const dy = c.y - CENTER_Y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const labelX = c.x + (dx / dist) * 105;
          const labelY = c.y + (dy / dist) * 105;
          return (
            <motion.text
              key={`geo-label-${key}`}
              initial={false}
              animate={{ opacity: isGeoStage ? 0.55 : 0 }}
              transition={{ duration: transitionDuration, ease }}
              x={labelX}
              y={labelY}
              textAnchor="middle"
              fontSize={13}
              letterSpacing="0.06em"
              fontFamily="'Lato', Arial, sans-serif"
              fill={NEUTRAL_COLOR}
            >
              {GEO_LABEL[key]}
            </motion.text>
          );
        })}

        {/* Archetype region halos — states 2+ only (the migration destination) */}
        {ARCHETYPE_ORDER.map(key => {
          const c = clusterCenters[key];
          const isFocused = labelsFull && focusArchetype === key;
          return (
            <motion.g key={`region-${key}`}>
              <motion.circle
                cx={c.x}
                cy={c.y}
                r={112}
                fill={ARCHETYPE_VAR[key]}
                initial={false}
                animate={{ fillOpacity: !labelsFull ? 0 : isFocused ? 0.14 : 0.07 }}
                transition={{ duration: migrationDuration, ease }}
              />
              <motion.text
                initial={false}
                animate={{ opacity: !labelsFull ? 0 : isFocused ? 0.9 : 0.55 }}
                transition={{ duration: migrationDuration, ease }}
                x={c.x + 55 * Math.cos(c.angle)}
                y={c.y + 55 * Math.sin(c.angle)}
                textAnchor="middle"
                fontSize={14}
                letterSpacing="0.06em"
                fontFamily="'Lato', Arial, sans-serif"
                fill={ARCHETYPE_VAR[key]}
              >
                {ARCHETYPE_LABEL[key].toUpperCase()}
              </motion.text>
            </motion.g>
          );
        })}

        {/* Edges — only meaningful once every dot has migrated into place */}
        {edges.map(edge => {
          const visible = edgesVisible;
          const isWalkEdge = highlightWalkIds.has(edge.id);
          return (
            <motion.line
              key={edge.id}
              x1={edge.from.cx}
              y1={edge.from.cy}
              x2={edge.to.cx}
              y2={edge.to.cy}
              stroke={isWalkEdge && walkHighlighted ? 'var(--color-experimental)' : 'rgba(0,0,0,0.18)'}
              initial={false}
              animate={{
                opacity: visible ? (isWalkEdge && walkHighlighted ? 0.9 : 0.35) : 0,
                strokeWidth: isWalkEdge && walkHighlighted ? 2 : 1,
              }}
              transition={{ duration: transitionDuration, ease, delay: prefersReduced ? 0 : Math.random() * 0.3 }}
            />
          );
        })}

        {/* Capture streams (state 1) — field stream (left/upper) carries generic
            origin-vocabulary fragments; measurement stream (right/lower) carries
            neutral ticks only. Both visibly converge on the incoming gray node,
            which appears near the geographic clusters (not yet an archetype).
            Round 3: bolder lines/text, a slow flowing dash, and a subtle
            traveling dot per stream so direction reads clearly. */}
        {stage === 1 && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: transitionDuration, ease }}>
            {/* Field stream — 3 arcs, each carrying 1-2 words anchored to the
                first ~40% of its own path (the entry end, off-canvas side) —
                never near the merge zone. Round 6: words are back on the
                lines (R5's fully-detached ambient slots read as unrelated to
                anything); two global, non-overlapping "waves" cap total
                concurrent words at 3 (one per stream, per wave) and each
                stream never shows more than 1 at once. */}
            {FIELD_STREAMS.map((streamDef, i) => {
              const end = { x: incomingGeoStart.cx, y: incomingGeoStart.cy };
              const path = `M ${streamDef.start.x} ${streamDef.start.y} Q ${streamDef.ctrl.x} ${streamDef.ctrl.y} ${end.x} ${end.y}`;
              const travel = [0.05, 0.35, 0.65, 0.95].map(t => quadPoint(streamDef.start, streamDef.ctrl, end, t));
              return (
                <g key={`field-${i}`}>
                  <motion.path
                    d={path} fill="none" stroke="rgba(154,41,24,0.6)" strokeWidth={2.5} strokeDasharray="3,5"
                    initial={{ strokeDashoffset: 0 }}
                    animate={prefersReduced ? {} : { strokeDashoffset: [0, -16] }}
                    transition={{ duration: 3.5, repeat: prefersReduced ? 0 : Infinity, ease: 'linear' }}
                  />
                  {!prefersReduced && (
                    <motion.circle
                      r={3}
                      fill="rgba(154,41,24,0.55)"
                      initial={{ opacity: 0 }}
                      animate={{
                        cx: travel.map(p => p.x),
                        cy: travel.map(p => p.y),
                        opacity: [0, 0.6, 0.6, 0],
                      }}
                      transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.6 }}
                    />
                  )}
                  {streamDef.words.map((w, wi) => {
                    const p = quadPoint(streamDef.start, streamDef.ctrl, end, w.t);
                    return (
                      <motion.text
                        key={`word-${i}-${wi}`}
                        x={p.x}
                        y={p.y + w.yOffset}
                        fontSize={14}
                        fontWeight={600}
                        fontFamily="'Lato', Arial, sans-serif"
                        fill="rgba(154,41,24,0.75)"
                        fontStyle="italic"
                        textAnchor="middle"
                        initial={{ opacity: 0 }}
                        animate={prefersReduced ? { opacity: 0.7 } : { opacity: [0, 0, 0.9, 0.9, 0, 0] }}
                        transition={
                          prefersReduced
                            ? { duration: 0 }
                            : { duration: 3.2, times: [0, 0.1, 0.25, 0.75, 0.9, 1], repeat: Infinity, repeatDelay: 4.8, delay: w.wave * 4, ease: 'easeInOut' }
                        }
                      >
                        {w.word}
                      </motion.text>
                    );
                  })}
                </g>
              );
            })}

            {/* Measurement stream — one arc, plain neutral ticks (no numbers, no dimension names) */}
            {(() => {
              const start = { x: VIEW_W - 40, y: incomingGeoStart.cy - 130 > 40 ? 60 : 40 };
              const ctrl = { x: incomingGeoStart.cx + 120, y: incomingGeoStart.cy - 110 };
              const end = { x: incomingGeoStart.cx, y: incomingGeoStart.cy };
              const path = `M ${start.x} ${start.y} Q ${ctrl.x} ${ctrl.y} ${end.x} ${end.y}`;
              const travel = [0.05, 0.35, 0.65, 0.95].map(t => quadPoint(start, ctrl, end, t));
              return (
                <g>
                  <motion.path
                    d={path} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={3} strokeDasharray="1,6"
                    initial={{ strokeDashoffset: 0 }}
                    animate={prefersReduced ? {} : { strokeDashoffset: [0, -14] }}
                    transition={{ duration: 3.5, repeat: prefersReduced ? 0 : Infinity, ease: 'linear' }}
                  />
                  {!prefersReduced && (
                    <motion.circle
                      r={3}
                      fill="rgba(0,0,0,0.4)"
                      initial={{ opacity: 0 }}
                      animate={{
                        cx: travel.map(p => p.x),
                        cy: travel.map(p => p.y),
                        opacity: [0, 0.55, 0.55, 0],
                      }}
                      transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                  {[0.3, 0.5, 0.7].map((t, i) => {
                    const p = quadPoint(start, ctrl, end, t);
                    return (
                      <motion.line
                        key={i}
                        x1={p.x - 3} y1={p.y} x2={p.x + 3} y2={p.y}
                        stroke="rgba(0,0,0,0.5)" strokeWidth={2}
                        initial={{ opacity: 0 }}
                        animate={prefersReduced ? { opacity: 0.6 } : { opacity: [0, 0.6, 0.6, 0] }}
                        transition={{ duration: 5, repeat: prefersReduced ? 0 : Infinity, ease: 'easeInOut', delay: i * 0.6 }}
                      />
                    );
                  })}
                </g>
              );
            })()}
          </motion.g>
        )}

        {/* The incoming demo node — walks Capture (near geography) → Structure
            (migrates into its archetype region and takes its color) */}
        {showIncomingDemo && (
          <motion.circle
            r={6}
            initial={false}
            animate={{
              cx: stage === 1 ? incomingGeoStart.cx : incomingArchetypeTarget.cx,
              cy: stage === 1 ? incomingGeoStart.cy : incomingArchetypeTarget.cy,
              fill: stage === 1 ? NEUTRAL_COLOR : ARCHETYPE_VAR.fruity,
            }}
            transition={{ duration: stage === 2 ? migrationDuration : transitionDuration, ease }}
          />
        )}

        {/* Nodes — geographic position/color in states 0-1, migrate to their
            archetype position/color from state 2 on (the page's signature moment) */}
        {nodes.map(node => {
          const cx = isGeoStage ? node.geoCx : node.cx;
          const cy = isGeoStage ? node.geoCy : node.cy;
          const fill = isGeoStage ? NEUTRAL_COLOR : ARCHETYPE_VAR[node.archetype];
          // Entry-aware ?archetype= highlight only applies once archetypes exist (state 2+)
          const isFocusedRegion = labelsFull && focusArchetype === node.archetype;
          const isHandoffSource = showHandoff && node.id === handoffNode?.id;
          const baseOpacity = isHandoffSource ? 0 : isFocusedRegion ? 1 : 0.85;
          return (
            <motion.g key={node.id}>
              <motion.circle
                r={node.isExperimental ? 6.5 : 5}
                initial={false}
                animate={
                  prefersReduced
                    ? { cx, cy, fill, opacity: baseOpacity }
                    : {
                        cx,
                        cy: stage === 0 ? [cy - 3, cy + 3, cy - 3] : cy,
                        fill,
                        opacity: baseOpacity,
                      }
                }
                transition={
                  stage === 0 && !prefersReduced
                    ? { duration: 6 + (node.driftPhase % 3), repeat: Infinity, ease: 'easeInOut', delay: node.driftPhase }
                    : { duration: stage === 2 ? migrationDuration : transitionDuration, ease, delay: stage === 2 && !prefersReduced ? (node.driftPhase % 1) * 0.4 : 0 }
                }
              />
              {node.isExperimental && stage >= 3 && (
                <motion.circle
                  cx={node.cx}
                  cy={node.cy}
                  r={10}
                  fill="none"
                  stroke="var(--color-experimental)"
                  strokeWidth={1.5}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.85 }}
                  transition={{ duration: transitionDuration, ease }}
                />
              )}
            </motion.g>
          );
        })}

        {/* Reader chips (state 4) */}
        {showReaderChips && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: transitionDuration, ease }}>
            {[
              { label: 'Quiz', x: 70, y: 60 },
              { label: 'Profile', x: VIEW_W - 70, y: 60 },
              { label: 'Liam', x: CENTER_X, y: VIEW_H - 30 },
            ].map(chip => (
              <g key={chip.label}>
                <line x1={chip.x} y1={chip.y} x2={CENTER_X} y2={CENTER_Y} stroke="rgba(0,0,0,0.18)" strokeWidth={1} strokeDasharray="2,3" />
                <rect x={chip.x - 32} y={chip.y - 15} width={64} height={28} rx={14} fill="#f2f1ea" stroke="rgba(0,0,0,0.2)" strokeWidth={1} />
                <text x={chip.x} y={chip.y + 4} textAnchor="middle" fontSize={13} fontFamily="'Lato', Arial, sans-serif" fill="rgba(0,0,0,0.6)">
                  {chip.label}
                </text>
              </g>
            ))}
          </motion.g>
        )}

        {/* Refine cycle (state 5) */}
        {showRefineCycle && (
          <motion.circle
            cx={CENTER_X}
            cy={CENTER_Y}
            r={CLUSTER_RADIUS + 60}
            fill="none"
            stroke="rgba(0,0,0,0.12)"
            strokeWidth={1}
            strokeDasharray="1,6"
            initial={{ rotate: 0, opacity: 0 }}
            animate={prefersReduced ? { opacity: 0.6 } : { opacity: 0.6, rotate: 360 }}
            transition={prefersReduced ? { duration: transitionDuration } : { duration: 40, repeat: Infinity, ease: 'linear' }}
            style={{ transformOrigin: `${CENTER_X}px ${CENTER_Y}px` }}
          />
        )}
      </motion.g>

    </svg>

    {/* Handoff (state 6) — the map hands a coffee to the customer. Round 4:
        rendered as a plain HTML <img> overlay (not an SVG <image>, not
        transform-scaled) because the SVG-scaled version rendered blurry —
        browsers rasterize a normal <img> at its layout size crisply. The
        overlay is positioned in percentages of the same VIEW_W×svgHeight
        box the SVG uses, so it tracks the map exactly at any width. Lands in
        the reserved band below the map, clear of every label (round-2 fix).
        Plays once per mount (isFirstHandoffPlay), then holds the settled
        frame; under prefers-reduced-motion it renders the settled frame
        immediately. */}
    {showHandoff && handoffNode && (
      <>
        <motion.img
          src={bagImage}
          alt=""
          style={{
            position: 'absolute',
            left: `${pctX(bagBox.x)}%`,
            top: `${pctY(bagBox.y)}%`,
            width: `${pctX(bagBox.width)}%`,
            height: `${pctY(bagBox.height)}%`,
            filter: 'drop-shadow(0 10px 10px rgba(0,0,0,0.18))',
            pointerEvents: 'none',
          }}
          initial={isFirstHandoffPlay ? { opacity: 0 } : { opacity: 1 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, delay: isFirstHandoffPlay ? 0.7 : 0, ease }}
        />
        {/* Round 5: the traveling dot dissolves on arrival — no persistent
            circle (it read as a stray dot overlapping the bag art). It fades
            out right as the underline below draws in. */}
        {isFirstHandoffPlay && (
          <motion.div
            style={{
              position: 'absolute',
              width: `${pctX(travelDotSize)}%`,
              height: `${pctY(travelDotSize)}%`,
              borderRadius: '50%',
              background: ARCHETYPE_VAR[handoffArchetype],
              pointerEvents: 'none',
            }}
            initial={{
              left: `${pctX(handoffNode.cx) - pctX(travelDotSize) / 2}%`,
              top: `${pctY(handoffNode.cy) - pctY(travelDotSize) / 2}%`,
              opacity: 1,
            }}
            animate={{
              left: [`${pctX(handoffNode.cx) - pctX(travelDotSize) / 2}%`, `${pctX(handoffNode.cx) - pctX(travelDotSize) / 2}%`, `${pctX(underlineTarget.cx) - pctX(travelDotSize) / 2}%`, `${pctX(underlineTarget.cx) - pctX(travelDotSize) / 2}%`],
              top: [`${pctY(handoffNode.cy) - pctY(travelDotSize) / 2}%`, `${pctY(handoffNode.cy) - pctY(travelDotSize) / 2}%`, `${pctY(underlineTarget.cy) - pctY(travelDotSize) / 2}%`, `${pctY(underlineTarget.cy) - pctY(travelDotSize) / 2}%`],
              opacity: [1, 1, 1, 0],
            }}
            transition={{ duration: 1.3, times: [0, 0.2, 0.75, 1], ease }}
          />
        )}
        {/* The underline draws in left-to-right beneath "Your Archetype" as
            the dot dissolves — printed-looking, not a floating shape. */}
        <motion.div
          style={{
            position: 'absolute',
            left: `${pctX(underlineBox.x)}%`,
            top: `${pctY(underlineBox.y)}%`,
            width: `${pctX(underlineBox.width)}%`,
            height: `${pctY(underlineBox.height)}%`,
            borderRadius: 4,
            background: ARCHETYPE_VAR[handoffArchetype],
            transformOrigin: 'left center',
            pointerEvents: 'none',
          }}
          initial={{ scaleX: isFirstHandoffPlay ? 0 : 1, opacity: 1 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ duration: isFirstHandoffPlay ? 0.5 : 0, delay: isFirstHandoffPlay ? 0.95 : 0, ease }}
        />
      </>
    )}
    </div>
  );
}
