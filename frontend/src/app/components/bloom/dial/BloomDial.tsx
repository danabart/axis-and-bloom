import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties, type ReactNode } from 'react';
import { getCells, colorizeCells, BEIGE, W, H, type Cell, type RGB } from './fillEngine';
import { LINEWORK_URI } from './linework';
import type { DialConfig, DialCoffee } from './archetypeConfig';
import type { DoorTarget } from '../types';

// The Bloom Dial — reusable component, source of truth on the Bloom page
// (brief 33). One archetype per mount; the wheel/ruler/bag interaction and the
// coloring-book fill engine are ported faithfully from mockup 32 v8.

export interface BloomDialHandle {
  /** Rotate to a dial position (1..4) with the dry snap animation — used by deep links. */
  rotateTo(dialSortOrder: number): void;
}

interface Props {
  config: DialConfig;
  /** Saved/initial position (1..4). Defaults to 2 (brief §3: coffee 2 selected). */
  initialDialSortOrder?: number;
  /** Fired on a settled zone change (release, keyboard, programmatic) with dialSortOrder 1..4. */
  onZoneChange?: (dialSortOrder: number) => void;
  /** Fired by PRE-ORDER THIS COFFEE with the currently selected coffee. */
  onPreOrder?: (coffee: DialCoffee) => void;
  /** Replaces the built-in PRE-ORDER button when provided — the parent section
   *  owns commerce so all four dial surfaces share one flow. */
  bottomContent?: ReactNode;
  /** Full-width content rendered below the reading/instrument stage, inside the
   *  section (the revealed informational layer). */
  belowStage?: ReactNode;
  /** Compact variant for embedded contexts (quiz screens, Profile). */
  embedded?: boolean;
  /** Part 19 §A — fired when a door chip (the outward step-chip slot at an
   * extreme position, showing "leave this dial") is clicked. `edge` is which
   * side was exited — the caller needs it to resolve the continuity landing
   * position on the target dial (see doorConfig.ts). Optional so a bare
   * `<BloomDial>` without a handler just doesn't render doors (they only ever
   * appear when both this prop and config.doors are present). */
  onDoorClick?: (edge: 'left' | 'right', target: DoorTarget) => void;
  /** Part 21 (was Part 20's boolean `signedIn`) — non-embedded Zone 1 only:
   * the exact kicker text to show on the identity row ("YOUR FRUITY" /
   * "TO EXPLORE FRUITY"), or null/undefined to omit it (guests, and
   * folded surfaces, which never show a kicker at all). Embedded's own
   * identity block is untouched and always shows "YOUR" unconditionally. */
  kicker?: string | null;
  /** Part 21 — this instance supports folding: the field collapses to zero
   * width (desktop) / zero height (phone) via CSS transition instead of the
   * grid's normal 38/62 (or embedded 32/68) split. False everywhere except
   * quiz/Profile's folded surfaces — /bloom passes nothing and this whole
   * mechanism is inert (the original grid rule wins unchanged). */
  folded?: boolean;
  /** Part 21 — only meaningful when `folded`: whether the field is currently
   * revealed. Toggled by the caller's own open/closed state (door band click
   * / "fold the dial" click) — BloomDial only renders the CSS class, it
   * doesn't own the state. */
  dialOpen?: boolean;
  /** Part 21 — rendered inside `.bd-instrument`, absolutely positioned by the
   * caller. Used for the "FOLD THE DIAL ↑" control (top-right of the field) —
   * a slot rather than a dedicated prop so BloomDial stays agnostic of the
   * fold control's own copy/behavior, matching the bottomContent/belowStage
   * precedent. */
  fieldOverlay?: ReactNode;
  /** Part 21 — the needle-ceremony "YOUR SPOT" tag: which dialSortOrder it
   * belongs to, its text, and whether the fade-in gate has been lifted yet
   * (`revealed`). Tracks the needle's own left offset in paint() so it never
   * needs its own position math; shows only when the CURRENT zone matches
   * `dialSortOrder` AND `revealed` is true, live on every zone change (turning
   * back to the spot later re-shows it) — the one-shot "ceremony" part is
   * purely `revealed`'s own timing, owned by the caller. Null/undefined =
   * no tag ever (folded surfaces with no personal position skip it entirely). */
  ceremony?: { dialSortOrder: number; text: string; revealed: boolean } | null;
  /** Part 21 — true while a folded surface's card is showing the classic
   * (match mode, before the first unfold). Embedded's own bd-coffee-head-text
   * label (a duplicate of the card's own header, kept for the "big name"
   * display /bloom gets for free from its dial field, which embedded has no
   * room for) needs to agree with the card's wording — "THE {ARCHETYPE}
   * CLASSIC" instead of "ON THE DIAL NOW" — or the two disagree right next
   * to each other. No-op for non-embedded (that label doesn't render there
   * at all) and for non-folded embedded instances (always false). */
  matchMode?: boolean;
  /** Part 21 §4.2 — the /bloom-only "why this dial" sentence, rendered above
   * the "TURN THE WHEEL..." hint. A plain string (not JSX) kept simple since
   * every consumer just interpolates data into one sentence; null/undefined
   * omits it (embedded contexts, or an archetype with no dial dimension). */
  whyLine?: string | null;
}

const TRAVEL = 120;

// Part 16 §B, hardened by Part 17 §E — stop layout, Dana's literal assignment
// order:
//   1. The default coffee (isDefault slot)              -> the CENTER of the bar.
//   2. The extreme positions (first/last by dialSortOrder) -> the EDGES.
//   3. Any remaining positions                           -> spaced evenly between
//      center and their nearer edge (their side of the default).
//   4. dialSortOrder order is always preserved left-to-right.
// Falls back to dumb even spacing — no cleverness, but every position still a
// distinct, reachable, snappable stop — when there's no single clean default to
// center on: no position flagged default, MORE than one flagged default (Part 17
// §E hardening — Part 16 silently took the first match via findIndex and ignored
// the conflict; an archetype with two isDefault=true rows is a data problem, not
// something to center on ambiguously), the one default is itself an extreme, or
// fewer than 3 positions exist (nothing meaningful to "center").
function computeStopPositions(coffees: DialCoffee[]): number[] {
  const n = coffees.length;
  const ordered = [...coffees].sort((a, b) => a.dialSortOrder - b.dialSortOrder);
  const evenFallback = () => Array.from({ length: n }, (_, i) => (n <= 1 ? 0.5 : i / (n - 1)));

  const defaultIndices = ordered.reduce<number[]>((acc, c, i) => (c.isDefault ? [...acc, i] : acc), []);
  if (defaultIndices.length !== 1) return evenFallback();
  const defaultIdx = defaultIndices[0];

  if (n < 3 || defaultIdx <= 0 || defaultIdx >= n - 1) return evenFallback();

  const stops = new Array<number>(n);
  // Left side: edge (index 0) at 0, default at 0.5, anything between spaced
  // evenly across [0, 0.5].
  for (let i = 0; i <= defaultIdx; i++) stops[i] = (i / defaultIdx) * 0.5;
  // Right side: default at 0.5, edge (index n-1) at 1, anything between spaced
  // evenly across [0.5, 1].
  for (let i = defaultIdx; i < n; i++) stops[i] = 0.5 + ((i - defaultIdx) / (n - 1 - defaultIdx)) * 0.5;
  return stops;
}

// Part 18 §A — the dial-native step chip's text: "{More|Less} {dimension} →
// {position label}", where {dimension} is this archetype's OWN dial dimension
// (config.dimensionName, lowercased) and {position label} is the neighboring
// stop's generic position label (dial_position_vocabulary.label) — never a
// different archetype (that's the whole point of this section: the dial only
// ever travels its own one dimension now, never a hop-graph jump).
function stepChipText(direction: 'less' | 'more', dimensionName: string | null, targetLabel: string): string {
  const dir = direction === 'more' ? 'More' : 'Less';
  const dim = (dimensionName ?? '').toLowerCase();
  return dim ? `${dir} ${dim} → ${targetLabel}` : `${dir} → ${targetLabel}`;
}

// Stack a coffee name one word per line for the field display, but keep "&"
// glued to the following word so it never sits alone on a row (Camila's rule).
function nameToLines(name: string): string {
  const words = name.split(' ');
  const lines: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i] === '&' && i + 1 < words.length) { lines.push('& ' + words[i + 1]); i++; }
    else if (words[i] === '&' && lines.length) { lines[lines.length - 1] += ' &'; }
    else { lines.push(words[i]); }
  }
  return lines.join('\n');
}

// Inject the dial stylesheet once. Colours are per-instance CSS vars set inline
// on each root, so all dials share one <style> but render their own field colour.
const STYLE_ID = 'bloom-dial-styles';
function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export const BloomDial = forwardRef<BloomDialHandle, Props>(function BloomDial(
  {
    config, initialDialSortOrder = 2, onZoneChange, onPreOrder, bottomContent, belowStage, embedded = false, onDoorClick,
    kicker = null, folded = false, dialOpen = false, fieldOverlay, ceremony = null, whyLine = null, matchMode = false,
  },
  ref,
) {
  // Part 16 §B — this archetype's stop layout (0..1 position per coffee, index
  // = zone). Recomputed every render (cheap — at most a handful of positions)
  // but only actually read at ref-init time and inside the setup effect below,
  // which only reruns when `config.archetype` changes — same lifecycle as the
  // rest of the drag/snap machinery, so a stale closure here is no different
  // from the existing TRAVEL-based logic.
  const stopPositions = computeStopPositions(config.coffees);
  const maxZone = stopPositions.length - 1;
  const clampZone = (z: number) => Math.min(maxZone, Math.max(0, z));
  const stopRot = (zone: number) => stopPositions[zone] * 2 * TRAVEL - TRAVEL;
  // Kept fresh every render (unlike the setup effect below, which only reruns on
  // `config.archetype` change) so `rotateTo` and the drag handlers never snap
  // against a stale stop layout if `config.coffees`' isDefault flags change
  // after mount (e.g. placeholder → real catalogue data resolving).
  const stopPositionsRef = useRef<number[]>(stopPositions);
  stopPositionsRef.current = stopPositions;

  const rootRef    = useRef<HTMLDivElement>(null);
  const wrapRef    = useRef<HTMLDivElement>(null);
  const rotorRef   = useRef<HTMLDivElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const ticksRef   = useRef<HTMLDivElement>(null);
  const needleRef  = useRef<HTMLDivElement>(null);
  const nowRef     = useRef<HTMLDivElement>(null);
  const nameRef    = useRef<HTMLDivElement>(null);
  const nlinesRef  = useRef<HTMLDivElement>(null);
  const fieldNameRef = useRef<HTMLDivElement>(null);
  // Part 18 §A — the two dial-native step chips; text and visibility are set
  // imperatively in paint() (same pattern as nameRef/priceRef above), not via
  // React state, so they stay correct mid-drag the same way the coffee name
  // does — not just at rest.
  const lessChipRef = useRef<HTMLButtonElement>(null);
  const moreChipRef = useRef<HTMLButtonElement>(null);
  // Part 21 — the needle-ceremony tag; text/visibility/position set in paint()
  // (same pattern as everything else here), not via React state, so it stays
  // correct through the settle animation the same way the coffee name does.
  const tagRef = useRef<HTMLDivElement>(null);

  // Engine state (per instance).
  const cellsRef   = useRef<Cell[] | null>(null);
  const colorsRef  = useRef<RGB[] | null>(null);
  const imgDataRef = useRef<ImageData | null>(null);
  const alphaRef   = useRef<number[]>([]);
  const ctxRef     = useRef<CanvasRenderingContext2D | null>(null);

  const rotRef     = useRef<number>(stopRot(clampZone(initialDialSortOrder - 1)));
  const zoneRef    = useRef<number>(clampZone(initialDialSortOrder - 1));
  const draggingRef = useRef<false | 'wheel' | 'bar'>(false);
  const lastZoneRef = useRef<number>(-1);

  // Keep latest callbacks/config without re-running the setup effect.
  const onZoneChangeRef = useRef(onZoneChange);
  const onPreOrderRef   = useRef(onPreOrder);
  const configRef       = useRef(config);
  const ceremonyRef     = useRef(ceremony);
  const matchModeRef    = useRef(matchMode);
  onZoneChangeRef.current = onZoneChange;
  onPreOrderRef.current   = onPreOrder;
  configRef.current       = config;
  ceremonyRef.current     = ceremony;
  matchModeRef.current    = matchMode;

  useImperativeHandle(ref, () => ({
    rotateTo(dialSortOrder: number) {
      const positions = stopPositionsRef.current;
      const zone = Math.min(positions.length - 1, Math.max(0, dialSortOrder - 1));
      zoneRef.current = zone;
      rotRef.current = positions[zone] * 2 * TRAVEL - TRAVEL;
      paintRef.current?.(rotRef.current);
    },
  }), []);

  // paint() is stored in a ref so handlers/imperative calls share one instance.
  const paintRef = useRef<((rot: number) => void) | null>(null);
  // Part 18 §A — step() likewise, so the step-chip buttons (rendered outside
  // the effect closure) can trigger the exact same one-position move keyboard
  // arrows use.
  const stepRef = useRef<((d: number) => void) | null>(null);

  useEffect(() => {
    ensureStyles();
    const wrap = wrapRef.current!, rotor = rotorRef.current!, canvas = canvasRef.current!;
    const ticks = ticksRef.current!, needle = needleRef.current!;
    let cancelled = false;

    const ctx = canvas.getContext('2d');
    ctxRef.current = ctx;

    const posOf = (rot: number) => (rot + TRAVEL) / (2 * TRAVEL);
    // Part 16 §B — nearest stop, not a fixed floor(pos*4): positions are no
    // longer necessarily evenly spaced (the default position sits at center).
    // Reads stopPositionsRef fresh each call rather than closing over a single
    // snapshot, so this effect doesn't need to rerun if the stop layout changes
    // without the archetype itself changing.
    const zoneOf = (pos: number) => {
      const positions = stopPositionsRef.current;
      let best = 0, bestDist = Infinity;
      for (let i = 0; i < positions.length; i++) {
        const d = Math.abs(positions[i] - pos);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      return best;
    };
    const rotForZone = (zone: number) => stopPositionsRef.current[zone] * 2 * TRAVEL - TRAVEL;

    function paintFill(pos: number) {
      const cells = cellsRef.current, colors = colorsRef.current, imgData = imgDataRef.current;
      if (!cells || !colors || !imgData || !ctx) return;
      const n = cells.length, d = imgData.data, alpha = alphaRef.current;
      const lead = n + Math.ceil(n * 0.25);
      let dirty = false;
      for (let rank = 0; rank < n; rank++) {
        const t = Math.max(0, Math.min(1, pos * lead - rank)) * 0.9;
        const a = Math.round(t * 255);
        if (a !== alpha[rank]) {
          alpha[rank] = a; dirty = true;
          const col = colors[rank];
          const r = Math.round(col[0] * t + BEIGE[0] * (1 - t));
          const g = Math.round(col[1] * t + BEIGE[1] * (1 - t));
          const b = Math.round(col[2] * t + BEIGE[2] * (1 - t));
          const px = cells[rank].px;
          for (let j = 0; j < px.length; j++) { const p = px[j]; d[p * 4] = r; d[p * 4 + 1] = g; d[p * 4 + 2] = b; }
        }
      }
      if (dirty) ctx.putImageData(imgData, 0, 0);
    }

    function paint(rot: number) {
      const pos = posOf(rot), zone = zoneOf(pos);
      zoneRef.current = zone;
      rotor.style.transform = 'rotate(' + rot + 'deg)';
      needle.style.left = (pos * 100) + '%';
      paintFill(Math.max(0, Math.min(1, (pos - 0.125) / 0.75)));
      const coffee = configRef.current.coffees[zone];
      if (nowRef.current) {
        nowRef.current.textContent = matchModeRef.current
          ? `THE ${configRef.current.archetypeLabel.toUpperCase()} CLASSIC`
          : 'ON THE DIAL NOW';
      }
      if (nameRef.current) nameRef.current.textContent = coffee.name;
      if (fieldNameRef.current) fieldNameRef.current.textContent = nameToLines(coffee.name);
      // Part 21 — needle-ceremony tag: tracks the needle's own left offset
      // (so it never needs separate position math), shown live whenever the
      // CURRENT zone matches the ceremony's target position AND the caller's
      // fade-in gate (`revealed`) is open. Re-evaluated every paint, so
      // turning back to the spot later re-shows it — only the FIRST reveal's
      // timing is a one-shot, and that's the caller's concern, not this.
      if (tagRef.current) {
        const cer = ceremonyRef.current;
        const show = !!cer?.revealed && cer.dialSortOrder - 1 === zone;
        tagRef.current.style.opacity = show ? '1' : '0';
        tagRef.current.style.left = needle.style.left;
        tagRef.current.textContent = cer?.text ?? '';
      }
      wrap.setAttribute('aria-valuenow', String(zone));
      ticks.setAttribute('aria-valuenow', String(zone));
      if (zone !== lastZoneRef.current) {
        lastZoneRef.current = zone;
        [nowRef.current, nameRef.current, fieldNameRef.current].forEach(el => {
          if (!el) return;
          el.style.opacity = '0';
          setTimeout(() => { el.style.opacity = '1'; }, 60);
        });
      }

      // Part 18 §A — step chips: text + visibility both set here (not via
      // React state) so they stay correct on every zone change, including
      // mid-drag, the same way the coffee name/price already do. visibility
      // (not display) keeps the hidden chip's flex slot reserved at an
      // extreme, so the remaining chip stays anchored to its own edge instead
      // of the row collapsing to a single centered item.
      //
      // Part 19 §A — at an extreme, the slot that used to just go empty now
      // shows a DOOR chip instead (if config.doors resolved one): visually
      // distinct (bd-door-chip — filled, not the step chips' transparent
      // pills) and worded as an exit ("{archetype} →" / "← {archetype}"), not
      // a step. The click handler (in the JSX below) re-checks zoneRef.current
      // at click time rather than needing a second ref for "which mode is this
      // chip in right now" — it's already exactly what determines door-vs-step
      // here.
      const positions = stopPositionsRef.current;
      const dimName = configRef.current.dimensionName;
      const doors = configRef.current.doors;
      if (lessChipRef.current) {
        if (zone === 0 && doors?.left) {
          lessChipRef.current.textContent = `← ${doors.left.archetypeLabel}`;
          lessChipRef.current.classList.add('bd-door-chip');
          lessChipRef.current.style.visibility = 'visible';
        } else if (zone > 0) {
          lessChipRef.current.textContent = stepChipText('less', dimName, configRef.current.coffees[zone - 1].positionLabel);
          lessChipRef.current.classList.remove('bd-door-chip');
          lessChipRef.current.style.visibility = 'visible';
        } else {
          lessChipRef.current.style.visibility = 'hidden';
        }
      }
      if (moreChipRef.current) {
        if (zone === positions.length - 1 && doors?.right) {
          moreChipRef.current.textContent = `${doors.right.archetypeLabel} →`;
          moreChipRef.current.classList.add('bd-door-chip');
          moreChipRef.current.style.visibility = 'visible';
        } else if (zone < positions.length - 1) {
          moreChipRef.current.textContent = stepChipText('more', dimName, configRef.current.coffees[zone + 1].positionLabel);
          moreChipRef.current.classList.remove('bd-door-chip');
          moreChipRef.current.style.visibility = 'visible';
        } else {
          moreChipRef.current.style.visibility = 'hidden';
        }
      }
    }
    paintRef.current = paint;

    // Part 16 §B — always lands on exactly one stop, never between: called on
    // every release path (wheel drag, bar/needle drag; PointerEvent already
    // unifies mouse/touch/pen, so no separate touch handling is needed). Keeps
    // the existing spring/ease (rotor & needle's own CSS transitions, restored
    // the instant `bd-dragging` is removed just before this runs) — short,
    // confident, no bounce past the stop.
    function snap() {
      const zone = zoneOf(posOf(rotRef.current));
      zoneRef.current = zone;
      rotRef.current = rotForZone(zone);
      paint(rotRef.current);
      onZoneChangeRef.current?.(zone + 1);
    }

    // ── Fill engine setup (cells shared across dials; colour per instance) ──
    getCells().then(cells => {
      if (cancelled || !ctx) return;
      cellsRef.current = cells;
      colorsRef.current = colorizeCells(cells, config.color);
      const imgData = ctx.createImageData(W, H);
      const d = imgData.data;
      cells.forEach(c => c.px.forEach(p => { d[p * 4] = BEIGE[0]; d[p * 4 + 1] = BEIGE[1]; d[p * 4 + 2] = BEIGE[2]; d[p * 4 + 3] = 255; }));
      ctx.putImageData(imgData, 0, 0);
      imgDataRef.current = imgData;
      alphaRef.current = new Array(cells.length).fill(-1);
      // Initial paint with no rotor animation.
      wrap.classList.add('bd-dragging');
      paint(rotRef.current);
      requestAnimationFrame(() => wrap.classList.remove('bd-dragging'));
    }).catch(() => { /* leave the beige wheel; brief §3 base still reads fine */ });

    // ── Ruler ticks (41, majors at 0/20/40) + needle ──
    for (let i = 0; i <= 40; i++) {
      const t = document.createElement('div');
      t.className = 'bd-tick' + (i === 0 || i === 20 || i === 40 ? ' bd-major' : '');
      t.style.left = (i / 40 * 100) + '%';
      ticks.appendChild(t);
    }
    ticks.appendChild(needle);

    // ── fitLines: size each title line to fill the column width ──
    // Part 20 — non-embedded's title cap drops 72->56 ("slightly smaller than
    // today's," proportionally matching the mockup's 58->46 today/proposed
    // ratio): closes over this render's `embedded` prop directly rather than
    // reading it off the DOM, safe because `embedded` never changes for an
    // already-mounted instance (this effect only reruns on config.archetype
    // change, same lifecycle as everything else it sets up).
    function fitLines() {
      const nlines = nlinesRef.current;
      if (!nlines) return;
      const lockW = (nlines.parentElement?.clientWidth ?? 300) - 36;
      const cap = embedded ? 72 : 56;
      nlines.querySelectorAll<HTMLElement>('.bd-nline').forEach(l => {
        l.style.fontSize = '100px';
        const tw = l.scrollWidth || 1;
        l.style.fontSize = Math.min(cap, Math.max(30, Math.floor(100 * lockW / tw))) + 'px';
      });
    }
    fitLines();
    window.addEventListener('resize', fitLines);

    // ── Wheel drag ──
    let startAngle = 0, startRot = 0;
    const angleAt = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
    };
    const onWheelDown = (e: PointerEvent) => {
      e.preventDefault();
      draggingRef.current = 'wheel'; wrap.classList.add('bd-dragging');
      wrap.setPointerCapture(e.pointerId);
      startAngle = angleAt(e); startRot = rotRef.current;
    };
    const onWheelMove = (e: PointerEvent) => {
      if (draggingRef.current !== 'wheel') return;
      rotRef.current = Math.max(-TRAVEL, Math.min(TRAVEL, startRot + (angleAt(e) - startAngle)));
      paint(rotRef.current);
    };
    const onWheelUp = () => {
      if (draggingRef.current !== 'wheel') return;
      draggingRef.current = false; wrap.classList.remove('bd-dragging'); snap();
    };
    wrap.addEventListener('pointerdown', onWheelDown);
    wrap.addEventListener('pointermove', onWheelMove);
    wrap.addEventListener('pointerup', onWheelUp);
    wrap.addEventListener('pointercancel', onWheelUp);

    // ── Bar drag ──
    const barPos = (e: PointerEvent) => {
      const r = ticks.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };
    const onBarDown = (e: PointerEvent) => {
      e.preventDefault();
      draggingRef.current = 'bar'; ticks.classList.add('bd-dragging'); wrap.classList.add('bd-dragging');
      ticks.setPointerCapture(e.pointerId);
      rotRef.current = barPos(e) * 2 * TRAVEL - TRAVEL; paint(rotRef.current);
    };
    const onBarMove = (e: PointerEvent) => {
      if (draggingRef.current !== 'bar') return;
      rotRef.current = barPos(e) * 2 * TRAVEL - TRAVEL; paint(rotRef.current);
    };
    const onBarUp = () => {
      if (draggingRef.current !== 'bar') return;
      draggingRef.current = false; ticks.classList.remove('bd-dragging'); wrap.classList.remove('bd-dragging'); snap();
    };
    ticks.addEventListener('pointerdown', onBarDown);
    ticks.addEventListener('pointermove', onBarMove);
    ticks.addEventListener('pointerup', onBarUp);
    ticks.addEventListener('pointercancel', onBarUp);

    // ── Keyboard (both wheel and bar) — already moves in whole positions;
    // Part 16 §B just points it at the same computed stops as drag/snap so
    // ARIA values stay correct for the new (possibly uneven) layout. ──
    const step = (d: number) => {
      const positions = stopPositionsRef.current;
      const zone = Math.max(0, Math.min(positions.length - 1, zoneRef.current + d));
      zoneRef.current = zone; rotRef.current = rotForZone(zone);
      paint(rotRef.current);
      onZoneChangeRef.current?.(zone + 1);
    };
    // Part 18 §A — the step chips call this exact function (via the ref below),
    // so clicking one is "identical effect to turning the wheel one stop": same
    // snap-free direct paint, same onZoneChange, same everything keyboard
    // stepping already gets.
    stepRef.current = step;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1); }
    };
    wrap.addEventListener('keydown', onKey);
    ticks.addEventListener('keydown', onKey);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', fitLines);
      wrap.removeEventListener('pointerdown', onWheelDown);
      wrap.removeEventListener('pointermove', onWheelMove);
      wrap.removeEventListener('pointerup', onWheelUp);
      wrap.removeEventListener('pointercancel', onWheelUp);
      ticks.removeEventListener('pointerdown', onBarDown);
      ticks.removeEventListener('pointermove', onBarMove);
      ticks.removeEventListener('pointerup', onBarUp);
      ticks.removeEventListener('pointercancel', onBarUp);
      wrap.removeEventListener('keydown', onKey);
      ticks.removeEventListener('keydown', onKey);
      ticks.innerHTML = '';
      paintRef.current = null;
      stepRef.current = null;
    };
    // Rebuild only if the archetype identity changes (each dial is one archetype).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.archetype]);

  // Apply an externally-changed position (saved position arriving, deep link)
  // without fighting an in-progress drag or looping on our own emits.
  useEffect(() => {
    const positions = stopPositionsRef.current;
    const zone = Math.min(positions.length - 1, Math.max(0, initialDialSortOrder - 1));
    if (draggingRef.current || zone === zoneRef.current) return;
    zoneRef.current = zone;
    rotRef.current = positions[zone] * 2 * TRAVEL - TRAVEL;
    paintRef.current?.(rotRef.current);
  }, [initialDialSortOrder]);

  // Part 21 — repaint on any ceremony prop change (specifically `revealed`
  // flipping true after the caller's own delay), or on `matchMode` flipping
  // (the embedded name lockup's "THE {ARCHETYPE} CLASSIC" vs "ON THE DIAL
  // NOW" label) — paint() is the only place that sets either, and nothing
  // else calls paint() on a plain prop change that isn't also a zone change
  // (matchMode can flip false on unfold with NO zone change at all, in the
  // "no personal position" edge case where the classic IS the selected
  // position — the label still needs to update even though the dial doesn't
  // visually move).
  useEffect(() => {
    paintRef.current?.(rotRef.current);
  }, [ceremony?.revealed, ceremony?.dialSortOrder, ceremony?.text, matchMode]);

  // Terracotta field text (Balanced & Sweet mustard) vs beige (deep fields) —
  // ruler ticks/labels take matching palette tints.
  const darkFieldText = config.ftext === '#9a2918';
  const rootVars = {
    '--bd-field': config.color,
    '--bd-ftext': config.ftext,
    '--bd-ftext-weak': darkFieldText ? 'rgba(154,41,24,.40)' : 'rgba(242,241,234,.35)',
    '--bd-ftext-mid':  darkFieldText ? 'rgba(154,41,24,.65)' : 'rgba(242,241,234,.65)',
    // Part 18 §B — scroll-margin-top so any scroll-to-this-section (archetype
    // strip, Worth Exploring) clears the sticky header(s) instead of landing
    // with the title tucked underneath. Bloom (non-embedded) sits under BOTH
    // the site's fixed 46px global nav AND its own sticky archetype jump-nav
    // (own ~45px, offset 64px down) — embedded contexts (Profile/quiz) only
    // ever have the global 46px nav.
    scrollMarginTop: embedded ? 70 : 130,
  } as CSSProperties;

  return (
    <section
      ref={rootRef}
      id={config.archetype}
      className={embedded ? 'bd-section bd-embedded' : 'bd-section'}
      style={rootVars}
    >
      <div className={folded ? `bd-stage bd-folded${dialOpen ? ' bd-dial-open' : ''}` : 'bd-stage'}>
        {/* Reading column */}
        <div className="bd-reading">
          {/* Part 20 — Zone 1 (identity). Embedded keeps its original lockup
              (vertical NO., BLOOM DIAL repeated per-instance) untouched — the
              redesign only restructures the non-embedded /bloom layout: a
              horizontal baseline row (YOUR + NO., YOUR omitted for guests)
              instead of the vertical NO., BLOOM DIAL removed here entirely
              (added once at the page level instead — see BloomPage.tsx), and
              a smaller title cap (fitLines below). Part 21 — `kicker` is null
              on every folded surface (they never show YOUR/TO EXPLORE, only
              the band/card speak there), so this whole block still only ever
              matters for /bloom. */}
          <div className="bd-namelock">
            {embedded ? (
              <>
                <div className="bd-your">YOUR</div>
                <div ref={nlinesRef}>
                  {config.nameLines.map((l, i) => <div key={i} className="bd-nline">{l}</div>)}
                </div>
                <div className="bd-bdial">BLOOM&nbsp;DIAL</div>
                <div className="bd-vno">NO. {config.no}</div>
              </>
            ) : (
              <>
                <div className="bd-idrow">
                  {kicker && <span className="bd-idrow-your">{kicker}</span>}
                  <span className="bd-idrow-no">NO. {config.no}</span>
                </div>
                <div ref={nlinesRef}>
                  {config.nameLines.map((l, i) => <div key={i} className="bd-nline">{l}</div>)}
                </div>
              </>
            )}
          </div>
          <div className="bd-reading-bottom">
            {/* Non-embedded (Bloom): the coffee's name/bag/price/teaser now all
                live inside Zone 2's card (bottomContent, built by
                DialArchetypeSection) — nothing of the old bag-mini/duplicate
                price line stays here. Embedded (quiz/profile) keeps its own
                compact name lockup, just relabeled ("ON THE DIAL NOW" —
                Part 20's naming, set in paint() above) to match Zone 2's
                header wording. */}
            {embedded && (
              <div className="bd-coffee-head-text">
                <div className="bd-now" ref={nowRef}>
                  {matchMode ? `THE ${config.archetypeLabel.toUpperCase()} CLASSIC` : 'ON THE DIAL NOW'}
                </div>
                <div className="bd-coffee-name" ref={nameRef}>
                  {config.coffees[clampZone(initialDialSortOrder - 1)].name}
                </div>
              </div>
            )}
            {bottomContent ?? (
              <button
                className="bd-btn"
                type="button"
                onClick={() => onPreOrderRef.current?.(configRef.current.coffees[zoneRef.current])}
              >
                PRE-ORDER THIS COFFEE&nbsp;&nbsp;→
              </button>
            )}
          </div>
        </div>

        {/* Instrument field */}
        <div className="bd-instrument">
          {/* Part 21 — the "FOLD THE DIAL ↑" control lives here when supplied:
              top-right corner of the field, mirroring where "Collapse ↑"
              already sits for the RevealedPanel below — .bd-instrument is
              already position:relative, so this just needs its own absolute
              placement (bd-field-fold, in the CSS below). */}
          {fieldOverlay}
          <div className="bd-field-inner">
            <div className="bd-wheel-col">
              <div
                className="bd-dial-wrap" ref={wrapRef}
                role="slider" tabIndex={0}
                aria-label={`${config.archetypeLabel} Bloom Dial`}
                aria-valuemin={0} aria-valuemax={maxZone} aria-valuenow={clampZone(initialDialSortOrder - 1)}
              >
                <div className="bd-marker" />
                <div className="bd-rotor" ref={rotorRef}>
                  <canvas ref={canvasRef} width={W} height={H} />
                  <img src={LINEWORK_URI} alt="" draggable={false} />
                </div>
              </div>
              <div className="bd-ruler">
                <div
                  className="bd-ruler-ticks" ref={ticksRef} tabIndex={0}
                  role="slider" aria-label={`${config.archetypeLabel} Bloom Dial position`}
                  aria-valuemin={0} aria-valuemax={maxZone} aria-valuenow={clampZone(initialDialSortOrder - 1)}
                >
                  <div className="bd-needle" ref={needleRef} />
                  {/* Part 21 — needle-ceremony tag ("YOUR SPOT" / "YOUR SPOT ·
                      FROM YOUR QUIZ"). Shares bd-ruler-ticks' positioning
                      context with the needle so its `left` (set in paint(),
                      mirroring needle.style.left exactly) lines up with it
                      pixel-for-pixel. Starts at opacity:0 — paint() only ever
                      turns it on when a ceremony prop is actually supplied. */}
                  <div className="bd-tag" ref={tagRef} />
                </div>
                <div className="bd-ruler-ends">
                  <span>{(config.scaleMinLabel ?? 'Delicate').toUpperCase()}</span>
                  <span>{(config.scaleMaxLabel ?? 'Pronounced').toUpperCase()}</span>
                </div>
              </div>
              {/* Part 18 §A — dial-native step chips, replacing the Part 16/17
                  hop-graph chips: these travel ONE dimension only (this dial's
                  own), one position at a time, never leaving the archetype. Text
                  and visibility are set imperatively in paint() so they stay
                  correct through drag/keyboard/click the same way the coffee
                  name does; the values below are just the pre-paint initial
                  render, computed the same way the embedded coffee-name default
                  is a few lines up. Anchored to the ruler's own edges (Part 17 §B's
                  layout, kept); at an extreme the outward chip is invisible but
                  still occupies its flex slot, so the remaining chip stays
                  anchored to its own edge instead of the row re-centering.
                  Part 19 §A — at an extreme, that slot is a DOOR chip instead
                  (an explicit "leave this dial" choice, never automatic) when
                  onDoorClick is wired up and config.doors resolved a target for
                  that edge. The click handlers re-check zoneRef.current (not a
                  value captured at render time) so they're always correct even
                  mid-drag or after a keyboard step that hasn't re-rendered yet. */}
              <div className="bd-step-chips">
                <button
                  type="button"
                  ref={lessChipRef}
                  className={
                    clampZone(initialDialSortOrder - 1) === 0 && config.doors?.left
                      ? 'bd-step-chip bd-step-chip-less bd-door-chip'
                      : 'bd-step-chip bd-step-chip-less'
                  }
                  style={{ visibility: clampZone(initialDialSortOrder - 1) > 0 || config.doors?.left ? 'visible' : 'hidden' }}
                  onClick={() => {
                    if (zoneRef.current === 0 && config.doors?.left) onDoorClick?.('left', config.doors.left);
                    else stepRef.current?.(-1);
                  }}
                >
                  {clampZone(initialDialSortOrder - 1) === 0
                    ? (config.doors?.left ? `← ${config.doors.left.archetypeLabel}` : '')
                    : stepChipText('less', config.dimensionName, config.coffees[clampZone(initialDialSortOrder - 1) - 1].positionLabel)}
                </button>
                <button
                  type="button"
                  ref={moreChipRef}
                  className={
                    clampZone(initialDialSortOrder - 1) === maxZone && config.doors?.right
                      ? 'bd-step-chip bd-step-chip-more bd-door-chip'
                      : 'bd-step-chip bd-step-chip-more'
                  }
                  style={{ visibility: clampZone(initialDialSortOrder - 1) < maxZone || config.doors?.right ? 'visible' : 'hidden' }}
                  onClick={() => {
                    if (zoneRef.current === maxZone && config.doors?.right) onDoorClick?.('right', config.doors.right);
                    else stepRef.current?.(1);
                  }}
                >
                  {clampZone(initialDialSortOrder - 1) === maxZone
                    ? (config.doors?.right ? `${config.doors.right.archetypeLabel} →` : '')
                    : stepChipText('more', config.dimensionName, config.coffees[clampZone(initialDialSortOrder - 1) + 1].positionLabel)}
                </button>
              </div>

              {/* Part 21 §4.2 — /bloom-only "why this dial" sentence, above
                  the hint. whyLine is null on every embedded/folded surface
                  (DialArchetypeSection only computes it for /bloom). */}
              {whyLine && <p className="bd-whyline">{whyLine}</p>}
              <div className="bd-hint">TURN THE WHEEL, OR SLIDE THE BAR</div>
            </div>

            {/* Coffee identity by the wheel (Bloom layout only): small label,
                big live name (one word per line, "&" kept with its word), small
                tagline. Palette colours only, via --bd-ftext. */}
            {!embedded && (
              <div className="bd-field-id">
                <div className="bd-field-label">THE COFFEE</div>
                <div className="bd-field-name" ref={fieldNameRef}>
                  {nameToLines(config.coffees[clampZone(initialDialSortOrder - 1)].name)}
                </div>
                <div className="bd-field-tagline">Every turn, a coffee of its own.</div>
              </div>
            )}
          </div>
          {/* Field bag only in the compact embedded dial (quiz/profile). On the
              Bloom page the bag moves into the left lockup beside the name. */}
          {embedded && (
            <div className="bd-field-bag">
              <img src={config.bag} alt={`${config.archetypeLabel} bag`} draggable={false} />
              <div className="bd-bag-shadow" />
            </div>
          )}
        </div>
      </div>
      {belowStage}
    </section>
  );
});

const EASE = 'cubic-bezier(0.22,1,0.36,1)';
const CSS = `
.bd-section{background:#f2f1ea;}
/* Part 20 — non-embedded column widens 27%->38% (embedded's own 32% override
   below, unchanged, still wins there via specificity). */
.bd-stage{display:grid;grid-template-columns:minmax(380px,38%) 1fr;min-height:0;}
.bd-reading{background:#f2f1ea;text-align:left;display:flex;flex-direction:column;justify-content:center;padding:40px 44px 44px;}
.bd-reading-bottom{padding-top:22px;}
.bd-namelock{position:relative;padding-right:36px;}
.bd-your{font-size:12px;letter-spacing:.3em;color:#45474a;font-weight:500;margin-bottom:8px;}
.bd-nline{font-weight:600;color:#9a2918;line-height:.95;letter-spacing:-.01em;text-transform:uppercase;white-space:nowrap;}
.bd-bdial{margin-top:12px;font-size:26px;font-weight:600;color:#ee5974;letter-spacing:.02em;}
.bd-vno{position:absolute;right:0;top:34px;writing-mode:vertical-rl;transform:rotate(180deg);font-size:11px;letter-spacing:.3em;color:#7b7f80;font-weight:500;}
/* Part 20 — Zone 1's non-embedded identity row: a plain horizontal baseline
   (YOUR left, NO. right) replacing the vertical .bd-vno treatment above,
   which stays exactly as-is for embedded. New class names (not a reuse of
   .bd-your/.bd-vno) specifically so this restyle can't leak onto embedded's
   untouched lockup. */
.bd-idrow{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;}
.bd-idrow-your{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#7b7f80;}
.bd-idrow-no{font-size:11px;letter-spacing:.2em;color:#b3b0a6;}
.bd-instrument{position:relative;user-select:none;background:var(--bd-field);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 40px;}
.bd-dial-wrap{position:relative;width:400px;height:400px;margin:0 auto;cursor:grab;touch-action:none;}
.bd-dial-wrap:active{cursor:grabbing;}
.bd-dial-wrap:focus{outline:none;}
.bd-dial-wrap:focus-visible{outline:1px solid #c5c7c8;outline-offset:12px;}
.bd-rotor{position:absolute;inset:0;transition:transform 560ms ${EASE};}
.bd-dial-wrap.bd-dragging .bd-rotor{transition:none;}
.bd-rotor canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}
.bd-rotor img{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;-webkit-user-drag:none;}
.bd-marker{position:absolute;top:-16px;left:50%;transform:translateX(-50%);width:2px;height:18px;background:#45474a;z-index:2;}
.bd-ruler{width:360px;max-width:86vw;margin:26px auto 0;}
.bd-ruler-ticks{position:relative;height:26px;margin-bottom:10px;cursor:pointer;touch-action:none;}
.bd-ruler-ticks:focus{outline:none;}
.bd-ruler-ticks:focus-visible{outline:1px solid #c5c7c8;outline-offset:6px;}
.bd-tick{position:absolute;bottom:0;width:1px;height:8px;background:var(--bd-ftext-weak);}
.bd-tick.bd-major{height:14px;background:var(--bd-ftext-mid);}
.bd-needle{position:absolute;bottom:0;width:2px;height:18px;background:var(--bd-ftext);transition:left 560ms ${EASE};}
.bd-needle::after{content:'';position:absolute;top:-9px;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:var(--bd-ftext);}
.bd-ruler-ticks.bd-dragging .bd-needle{transition:none;}
.bd-ruler-ends{display:flex;justify-content:space-between;font-size:9.5px;letter-spacing:.24em;color:var(--bd-ftext);}
/* Part 14 — end labels are now DB-driven per archetype (Body/Acidity/etc.'s real
   scale_min_label/scale_max_label) instead of the fixed "DELICATE"/"PRONOUNCED",
   so length varies (e.g. Floral's "TRANSPARENT / CLEAN" / "VERY DEEP / COMPLEX" is
   much longer). Never wrap — clip to an ellipsis instead so the ruler's width/
   layout never shifts; each side caps at ~48% so a long label on one side can't
   crowd out the other. */
.bd-ruler-ends span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:48%;}
.bd-hint{margin-top:12px;font-size:10.5px;letter-spacing:.14em;color:var(--bd-ftext-mid);}
/* Part 21 — needle-ceremony tag: shares .bd-ruler-ticks' positioning context
   with the needle, its left offset mirrored from it exactly in paint(). Uses
   ftext, not a fixed white, so it reads correctly on Balanced & Sweet's
   mustard field for free (the same reuse the door band's copy asks for). */
.bd-tag{position:absolute;top:-24px;left:0;transform:translateX(-50%);font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--bd-ftext);white-space:nowrap;opacity:0;transition:opacity 500ms ease;pointer-events:none;}
/* Part 21 §2.4 — the fold control: top-right of the field, mirroring where
   "Collapse ↑" sits for the RevealedPanel below (chosen over e.g. bottom-left
   of the field, which would sit awkwardly close to the step chips/hint
   stack — the field's top-right corner is otherwise empty at every viewport
   this component supports). */
.bd-field-fold{position:absolute;top:18px;right:20px;background:none;border:none;font-family:inherit;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--bd-ftext);opacity:.75;cursor:pointer;padding:4px;z-index:2;}
.bd-field-fold:hover{opacity:1;}
/* Part 21 §4.2 — /bloom's data-driven "why this dial" sentence. */
.bd-whyline{width:360px;max-width:86vw;margin:14px auto 0;font-size:12px;font-weight:300;line-height:1.5;color:var(--bd-ftext);opacity:.85;text-align:center;}
/* Part 21 §2.2 — the door band (DoorBand.tsx): background/text colors are
   per-archetype dynamic values (field color, ink-vs-beige ftext) and stay as
   inline style props on the component; everything static (layout, hover,
   the narrow-width wrap rule below) lives here, matching the Part 20 card
   precedent. flex-wrap + a text min-basis (not a fixed breakpoint) is what
   actually saves this at phone width: below ~480px there's no longer room
   for glyph + a readable text column + the action pill on one line, so the
   pill wraps to its own line instead of every word in the sentence getting
   squeezed onto its own line (the failure mode a fixed three-column flex
   row hits first). */
.bd-band{display:flex;align-items:center;flex-wrap:wrap;gap:12px 16px;width:100%;margin-top:14px;border:none;border-radius:2px;cursor:pointer;font-family:inherit;text-align:left;padding:16px 20px;transition:filter 200ms ease;}
.bd-band:hover{filter:brightness(1.06);}
.bd-band-glyph{flex:none;}
.bd-band-text{flex:1 1 180px;min-width:0;}
.bd-band-micro{display:block;font-size:9px;letter-spacing:.2em;text-transform:uppercase;margin-bottom:4px;}
.bd-band-line{display:block;font-size:13.5px;font-weight:300;line-height:1.45;}
.bd-band-act{flex:none;font-size:9.5px;letter-spacing:.15em;text-transform:uppercase;border-radius:999px;padding:7px 13px;white-space:nowrap;}
/* Part 18 §A — dial-native step chips, replacing Part 16/17's hop-graph chips.
   Same instrument-native styling (transparent, thin field-text border,
   field-text-mid label, small pill) and the same fixed left/right anchoring
   Part 17 §B introduced — kept because it's still correct for two fixed
   controls, just no longer graph-driven. Full text always: wrap to a second
   line instead of the old ellipsis truncation (spec's own "no ellipsis, ever"
   — these are short, deterministic sentences now, not hop-graph labels of
   unpredictable length). visibility (not display) hides the outward chip at
   an extreme so the remaining one stays anchored to its own edge — the row
   never collapses to a single centered item. */
.bd-step-chips{width:360px;max-width:86vw;margin:14px auto 0;display:flex;justify-content:space-between;gap:14px;}
.bd-step-chip{font-family:inherit;font-size:11px;letter-spacing:.02em;line-height:1.4;padding:8px 15px;border-radius:999px;border:1px solid var(--bd-ftext-weak);background:none;color:var(--bd-ftext-mid);cursor:pointer;transition:border-color 240ms ${EASE},color 240ms ${EASE};max-width:172px;white-space:normal;}
.bd-step-chip-less{text-align:left;}
.bd-step-chip-more{text-align:right;}
.bd-step-chip:hover{border-color:var(--bd-ftext);color:var(--bd-ftext);}
/* Part 19 §A — doors: same pill family as the step chips, but visually
   distinct as "leave this dial" rather than "step this dial" — filled with
   the field-text color at low opacity (transitioning to the mid tone on
   hover) instead of the step chips' transparent background, and bolder text.
   The leading/trailing arrow is baked into the text itself ("→ {archetype}" /
   "{archetype} ←" via the door text template), not a separate glyph, so it
   reads correctly with screen readers and the title/full-text-always rule. */
.bd-door-chip{background:var(--bd-ftext-weak);border-color:transparent;color:var(--bd-ftext);font-weight:500;}
.bd-door-chip:hover{background:var(--bd-ftext-mid);}
.bd-field-inner{display:flex;align-items:center;justify-content:center;gap:clamp(28px,4vw,72px);width:100%;}
.bd-wheel-col{display:flex;flex-direction:column;align-items:center;flex-shrink:0;}
/* The identity block has a FIXED width (and the name a fixed height) so the row
   never reflows as the coffee changes — the wheel stays locked. white-space:pre
   means ONLY our own line breaks apply; auto-wrap was splitting "& Word" in two. */
.bd-field-id{flex:0 0 auto;width:clamp(220px,30vw,460px);display:flex;flex-direction:column;justify-content:center;}
.bd-field-label{font-size:10.5px;letter-spacing:.28em;text-transform:uppercase;color:var(--bd-ftext);opacity:.72;margin:0 0 14px;}
.bd-field-name{min-height:172px;display:flex;flex-direction:column;justify-content:center;color:var(--bd-ftext);font-size:clamp(40px,5.2vw,80px);font-weight:500;line-height:0.98;letter-spacing:-0.015em;text-align:left;white-space:pre;transition:opacity 300ms ${EASE};}
.bd-field-tagline{font-size:12.5px;line-height:1.5;color:var(--bd-ftext);opacity:.72;margin:16px 0 0;}
.bd-field-bag{position:absolute;right:54px;bottom:42px;text-align:center;pointer-events:none;}
.bd-field-bag img{width:146px;height:auto;display:block;-webkit-user-drag:none;}
.bd-bag-shadow{width:102px;height:10px;margin:-4px auto 0;border-radius:50%;background:radial-gradient(ellipse,rgba(58,60,62,.22),rgba(58,60,62,0) 70%);}
.bd-now{font-size:9.5px;letter-spacing:.28em;color:#7b7f80;transition:opacity 300ms ${EASE};}
.bd-coffee-name{margin-top:12px;font-size:32px;min-height:84px;font-weight:500;color:#9a2918;letter-spacing:-0.008em;line-height:1.25;transition:opacity 300ms ${EASE};}
.bd-coffee-head-text{min-width:0;}
.bd-btn{display:block;width:100%;margin-top:26px;background:#9a2918;color:#f2f1ea;font-size:12px;letter-spacing:.16em;font-weight:500;padding:15px 10px;text-align:center;text-decoration:none;cursor:pointer;border:none;font-family:inherit;transition:background 480ms ${EASE};}
.bd-btn:hover{background:#8a2416;}
/* Part 20 §2/§3 — the commerce-column redesign's Zone 2 card and Zone 3 quick
   picks. Consumed by DialArchetypeSection.tsx's bottomContent via className
   (that component owns none of its own stylesheet — this one, injected once
   by ensureStyles() above, is the only <style> tag either component has), so
   these rules live here alongside every other bd-* class rather than as
   inline styles, matching the step-chip/door-chip precedent (Part 18/19) of
   "hover state = real CSS, not JS state". Ported from the mockup
   (commerce-column-redesign.html, Proposed · 38/62 tab) 1:1 on pixel values;
   brand hex literals only, no new colors. */
.bd-card{background:#fff;border:1px solid #deded1;border-radius:2px;}
.bd-card-main{padding:22px 24px 20px;}
.bd-card-headrow{display:flex;gap:16px;align-items:center;margin-bottom:14px;}
.bd-card-bag{width:54px;flex:none;display:block;}
.bd-card-microlabel{font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:#7b7f80;margin:0 0 3px;}
.bd-card-name{font-size:19px;font-weight:400;color:#45474a;margin:0;}
.bd-card-teaser{font-size:13.5px;font-weight:300;line-height:1.6;color:#45474a;margin:0 0 16px;}
.bd-card-status{align-self:flex-start;display:inline-block;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#7b7f80;border:1px solid rgba(123,127,128,.35);border-radius:999px;padding:5px 12px;}
.bd-card-pricerow{display:flex;align-items:baseline;gap:22px;flex-wrap:wrap;margin-bottom:16px;}
.bd-card-weight{font-family:inherit;font-size:14px;letter-spacing:.02em;padding:2px 0;border:none;border-bottom:1.5px solid transparent;background:none;cursor:pointer;}
.bd-card-weight.sel{color:#9a2918;border-bottom-color:#9a2918;font-weight:500;}
.bd-card-weight.un{color:#7b7f80;font-weight:400;}
.bd-card-ship{font-size:11px;color:#b3b0a6;font-weight:300;margin-left:auto;}
.bd-card-atc{display:block;width:100%;background:#9a2918;color:#fff;text-align:center;border:none;font-family:inherit;font-size:12.5px;letter-spacing:.16em;font-weight:500;padding:13px 0;cursor:pointer;margin-bottom:14px;transition:background 480ms ${EASE};}
.bd-card-atc:hover{background:#8a2416;}
.bd-card-atc:disabled{opacity:.5;cursor:default;}
.bd-card-quietrow{display:flex;gap:26px;flex-wrap:wrap;}
.bd-card-quietrow button{font-family:inherit;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#7b7f80;cursor:pointer;background:none;border:none;padding:0;}
.bd-card-quietrow button:hover{color:#9a2918;}
.bd-card-quietrow button:disabled{cursor:default;opacity:.6;}
.bd-card-saved-link{display:block;margin-top:8px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#9a2918;opacity:.85;}
.bd-card-reveal{width:100%;border:none;border-top:1px solid #deded1;background:none;padding:13px 24px;font-family:inherit;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#ee5974;cursor:pointer;display:flex;justify-content:space-between;align-items:center;}
.bd-card-reveal:hover{background:#fdf8f7;}
.bd-qp{margin-top:26px;}
.bd-qp-label{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#7b7f80;margin:0 0 12px;}
.bd-qp-row{display:flex;width:100%;justify-content:space-between;align-items:baseline;gap:14px;padding:11px 0;border:none;border-top:1px solid #deded1;background:none;cursor:pointer;text-align:left;font-family:inherit;}
.bd-qp-row:last-child{border-bottom:1px solid #deded1;}
.bd-qp-what{font-size:13.5px;font-weight:300;color:#45474a;}
.bd-qp-what em{font-style:normal;color:#7b7f80;font-size:12px;}
.bd-qp-act{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#9a2918;white-space:nowrap;flex-shrink:0;}
/* Part 21 — folded surfaces (quiz results/returning, Profile): the field
   collapses to zero width instead of the base rule's grid-driven 38/62
   split, and the reading column centers at a fixed width rather than
   stretching to fill the row alone (matching the mockup's card-centered
   closed state). Unfolding (.bd-dial-open) restores the EXACT same 38/62
   split /bloom already uses (embedded's 32/68 override sits with the rest
   of the embedded rules below) — recognition, not a new layout, per the
   prompt's own framing. flex, not the base rule's grid, specifically
   because animating a flex child's own width/max-height is reliable
   cross-browser; animating grid-template-columns is not. Every rule here is
   scoped under .bd-folded, so /bloom (which never gets that class) is
   completely unaffected — the original grid rule above wins there untouched. */
.bd-stage.bd-folded{display:flex;justify-content:center;}
.bd-stage.bd-folded .bd-reading{width:480px;max-width:100%;flex:none;transition:width 800ms ${EASE};}
.bd-stage.bd-folded.bd-dial-open .bd-reading{width:38%;}
.bd-stage.bd-folded .bd-instrument{width:0;padding:0;overflow:hidden;flex:none;transition:width 900ms ${EASE},padding 900ms ${EASE};}
.bd-stage.bd-folded.bd-dial-open .bd-instrument{width:62%;padding:40px 40px;}
@media (max-width:940px){
  .bd-stage{grid-template-columns:1fr;min-height:0;}
  .bd-instrument{order:1;padding:48px 20px 120px;}
  .bd-field-bag{right:18px;bottom:16px;}
  .bd-field-bag img{width:96px;}
  .bd-reading{order:2;padding:44px 28px;}
  .bd-coffee-name{min-height:0;}
  .bd-dial-wrap{width:320px;height:320px;}
  /* Part 21 — folded surfaces stack (card above, field below) exactly how
     /bloom already stacks below this breakpoint, but since folded uses flex
     not grid (and needs to visually start at zero, not just reordered), swap
     the width transition for a max-height one — same idea as the mockup's
     own phone treatment, ported to this component's real dimensions rather
     than the mockup's placeholder ones. */
  .bd-stage.bd-folded{flex-direction:column;}
  .bd-stage.bd-folded .bd-reading{width:100%;max-width:100%;order:1;}
  .bd-stage.bd-folded.bd-dial-open .bd-reading{width:100%;}
  .bd-stage.bd-folded .bd-instrument{width:100%;max-height:0;padding:0 20px;order:2;transition:max-height 800ms ${EASE},padding 800ms ${EASE};}
  .bd-stage.bd-folded.bd-dial-open .bd-instrument{max-height:900px;padding:48px 20px 120px;}
}
/* Below ~1100px the wheel + big name no longer fit side by side — stack the
   name under the wheel, centered, and let its box size to content there. */
@media (max-width:1100px){
  .bd-field-inner{flex-direction:column;gap:26px;}
  .bd-field-id{width:auto;max-width:92%;align-items:center;text-align:center;}
  .bd-field-name{min-height:0;text-align:center;white-space:pre;font-size:clamp(30px,7vw,58px);}
}
@media (prefers-reduced-motion:reduce){
  .bd-rotor,.bd-needle,.bd-now,.bd-coffee-name,.bd-field-name,.bd-btn{transition:none !important;}
}
.bd-section.bd-embedded .bd-stage{min-height:0;grid-template-columns:minmax(260px,32%) 1fr;}
.bd-embedded .bd-reading{padding:34px 30px 38px;}
.bd-embedded .bd-instrument{padding:42px 24px;}
.bd-embedded .bd-dial-wrap{width:300px;height:300px;}
.bd-embedded .bd-ruler{width:280px;margin-top:28px;}
.bd-embedded .bd-step-chips{width:280px;}
.bd-embedded .bd-step-chip{max-width:128px;}
.bd-embedded .bd-bdial{font-size:19px;margin-top:8px;}
.bd-embedded .bd-coffee-name{font-size:23px;min-height:0;margin-top:10px;}
.bd-embedded .bd-reading-bottom{padding-top:22px;}
.bd-embedded .bd-field-bag{right:22px;bottom:18px;}
.bd-embedded .bd-field-bag img{width:92px;}
/* Part 21 — embedded's own unfolded ratio (32/68, matching its normal grid
   split above) rather than the base folded rule's 38/62. Every quiz/Profile
   folded surface is embedded, so this is the ratio that actually ships. */
.bd-section.bd-embedded .bd-stage.bd-folded.bd-dial-open .bd-reading{width:32%;}
.bd-section.bd-embedded .bd-stage.bd-folded.bd-dial-open .bd-instrument{width:68%;padding:42px 24px;}
@media (max-width:940px){
  .bd-embedded .bd-instrument{padding:36px 16px 96px;}
  .bd-embedded .bd-dial-wrap{width:260px;height:260px;}
  .bd-section.bd-embedded .bd-stage.bd-folded.bd-dial-open .bd-instrument{padding:36px 16px 96px;}
}
`;
