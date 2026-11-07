import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { PETALS, WHEEL_VIEWBOX, WHEEL_CENTRE, WHEEL_SWEEP_DEG } from './wheelGeometry';
import { tints } from './tints';
import '../field/bloomField.css';

// Website 5 (2026-11-05): the handoff's single flower wheel (source/bloom-b),
// one drawing for every family. The geometry is a component asset
// (wheelGeometry.ts); everything it shows (stops, their labels, the colours)
// comes from props. Controlled: the parent holds `t` (0..1) and the stop
// it maps to (k / (stops - 1)). onChange fires while dragging or sliding
// (continuous), onCommit once a turn settles, snapped to a stop: that is the
// dial's "settled turn" (the silent auto-save hangs off it upstream).
// Website 9 (2026-11-06, D19): turned like the old dial. The pointer is
// tracked by accumulating each move's angle (never the angle from the start,
// which flipped end to end at half a turn), the wheel repaints locally during
// a drag and the parent hears onChange only when the stop under the needle
// changes, the tick row is a drag strip (BloomDial's ruler), and the page never
// scrolls or selects text. Snap on release only.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_5_THE_BLOOM.md, Part A

export interface FlowerWheelProps {
  /** 0..1 */
  t: number;
  /** How many stops the family has (its visible slots); 1 holds the wheel still. */
  stops: number;
  /** The family colour; the petal tints come from tints(colour). */
  color: string;
  /** Label per stop for the screen reader ("2 · Classic"), index = stop. */
  stopLabels: string[];
  /** The slider's accessible name, e.g. "Chocolate & Nutty: lighter to fuller". */
  ariaLabel: string;
  onChange: (t: number) => void;
  onCommit: (t: number) => void;
  /** Rendered between the wheel and the ticks (the measure and the stop label). */
  meta?: ReactNode;
  /** Rendered under the slider (the end words and the hints). */
  foot?: ReactNode;
  /** Website 9: true while a pointer turn is in progress (wheel or bar), false once it settles. */
  onDragChange?: (dragging: boolean) => void;
}

/** The stop a value sits on. */
export function stopOf(t: number, stops: number): number {
  return stops <= 1 ? 0 : Math.round(Math.max(0, Math.min(1, t)) * (stops - 1));
}

/** The value of a stop. */
export function tOf(stop: number, stops: number): number {
  return stops <= 1 ? 0 : Math.max(0, Math.min(stops - 1, stop)) / (stops - 1);
}

/** A petal is open at `t` (the handoff's paint(): the fill grows from the centre outward). */
export function petalOn(thr: number, t: number): boolean {
  return thr <= t * 1.02 - 0.02;
}

export function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

const RANGE_MAX = 300;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Share of the wheel's size around the centre where a drag does not turn it. */
const CENTRE_DEAD_ZONE = 0.12;

/** One pointer move's turn in radians, folded into (-π, π]: summed per move, it never flips at half a turn. */
export function angleStep(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

export function FlowerWheel({ t, stops, color, stopLabels, ariaLabel, onChange, onCommit, meta, foot, onDragChange }: FlowerWheelProps) {
  const reduced = usePrefersReducedMotion();
  const still = stops <= 1;
  const tt = tints(color);
  const gRef = useRef<SVGGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  // the wheel's own value while a pointer turns it; null at rest (then it shows `t`)
  const [dragT, setDragT] = useState<number | null>(null);
  const [dragKind, setDragKind] = useState<'wheel' | 'bar' | null>(null);
  const shown = dragT ?? t;
  const cur = useRef(-shown * WHEEL_SWEEP_DEG);
  const target = useRef(cur.current);
  const raf = useRef<number | null>(null);
  const instant = useRef(false);
  const drag = useRef<{ kind: 'wheel' | 'bar'; last: number; t: number; stop: number } | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const paintRotation = (deg: number) => {
    gRef.current?.setAttribute('transform', `rotate(${deg.toFixed(2)} ${WHEEL_CENTRE.x} ${WHEEL_CENTRE.y})`);
  };

  // spin(): ease the rotation toward -t*270deg; instant under reduced motion
  // and while a pointer or the slider is turning it.
  useEffect(() => {
    target.current = -shown * WHEEL_SWEEP_DEG;
    if (reduced || instant.current || dragT != null || typeof requestAnimationFrame === 'undefined') {
      if (raf.current != null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf.current);
      raf.current = null;
      cur.current = target.current;
      paintRotation(cur.current);
      return;
    }
    if (raf.current != null) return;
    const step = () => {
      const d = target.current - cur.current;
      cur.current = Math.abs(d) < 0.05 ? target.current : cur.current + d * 0.18;
      paintRotation(cur.current);
      raf.current = cur.current !== target.current ? requestAnimationFrame(step) : null;
    };
    raf.current = requestAnimationFrame(step);
  }, [shown, reduced, dragT]);

  useEffect(() => () => { if (raf.current != null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf.current); }, []);

  const k = stopOf(shown, stops);
  const commitStop = (stop: number) => onCommit(tOf(stop, stops));

  function angle(e: PointerEvent) {
    const r = wrapRef.current!.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  }
  /** Near the centre the angle swings wildly; a pointer there turns nothing (the crossing is not a half-turn jump). */
  function nearCentre(e: PointerEvent) {
    const r = wrapRef.current!.getBoundingClientRect();
    return Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) < CENTRE_DEAD_ZONE * Math.min(r.width, r.height);
  }
  function barValue(e: PointerEvent) {
    const r = barRef.current!.getBoundingClientRect();
    return clamp01((e.clientX - r.left) / (r.width || 1));
  }
  /** A pointer value: repaint here, tell the parent only when the stop changes. */
  function move(next: number) {
    const d = drag.current!;
    d.t = next;
    setDragT(next);
    const s = stopOf(next, stops);
    if (s !== d.stop) { d.stop = s; onChange(next); }
  }
  function start(e: PointerEvent<HTMLDivElement>, kind: 'wheel' | 'bar') {
    if (still || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); // no text selection, no focus jump, no native drag
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { kind, last: kind === 'wheel' ? angle(e) : 0, t: tRef.current, stop: stopOf(tRef.current, stops) };
    setDragT(tRef.current);
    setDragKind(kind);
    onDragChange?.(true);
    if (kind === 'bar') move(barValue(e));
  }
  function onWheelMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.kind !== 'wheel') return;
    const a = angle(e);
    if (nearCentre(e)) { d.last = a; return; }
    const turn = angleStep(d.last, a);
    d.last = a;
    // clockwise on screen turns toward the first stop, as before
    move(clamp01(d.t - turn / (Math.PI * 1.5)));
  }
  function onBarMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.kind !== 'bar') return;
    move(barValue(e));
  }
  function end() {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragT(null);
    setDragKind(null);
    onDragChange?.(false);
    commitStop(stopOf(d.t, stops));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (still) return;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? k + 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? k - 1
      : e.key === 'Home' ? 0 : e.key === 'End' ? stops - 1 : null;
    if (next == null) return;
    e.preventDefault();
    commitStop(Math.max(0, Math.min(stops - 1, next)));
  }

  const ticksPer = 6;
  const tickCount = still ? 1 : (stops - 1) * ticksPer + 1;

  return (
    <div className="bf-wheel" data-testid="flower-wheel">
      <div
        ref={wrapRef}
        className={`bf-wheel-wrap${still ? ' is-still' : ''}${dragKind === 'wheel' ? ' is-dragging' : ''}`}
        data-testid="wheel-drag"
        onPointerDown={e => start(e, 'wheel')}
        onPointerMove={onWheelMove}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        <span className="bf-marker" aria-hidden="true" />
        <svg viewBox={WHEEL_VIEWBOX} aria-hidden="true" focusable="false">
          <g ref={gRef} transform={`rotate(${(-t * WHEEL_SWEEP_DEG).toFixed(2)} ${WHEEL_CENTRE.x} ${WHEEL_CENTRE.y})`}>
            <g fill="none" strokeMiterlimit={10}>
              {PETALS.map((p, i) => {
                const on = petalOn(p.thr, shown);
                return (
                  <path
                    key={i}
                    d={p.d}
                    stroke={p.stroke}
                    className={on ? 'on' : undefined}
                    style={{ ['--tint' as string]: p.accent ?? tt[p.tier] } as CSSProperties}
                    data-on={on ? '1' : '0'}
                  />
                );
              })}
            </g>
          </g>
        </svg>
      </div>
      <div className="bf-slider">
      {meta}
      <div
        ref={barRef}
        className={`bf-bar${still ? ' is-still' : ''}${dragKind === 'bar' ? ' is-dragging' : ''}`}
        data-testid="wheel-bar"
        onPointerDown={e => start(e, 'bar')}
        onPointerMove={onBarMove}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        <div className="bf-ticks" aria-hidden="true">
          {Array.from({ length: tickCount }, (_, q) => <i key={q} className={q % ticksPer === 0 ? 'big' : undefined} />)}
        </div>
        <input
          className="bf-range"
          type="range"
          min={0}
          max={RANGE_MAX}
          step={1}
          value={Math.round(shown * RANGE_MAX)}
          disabled={still}
          aria-label={ariaLabel}
          aria-valuemin={1}
          aria-valuemax={Math.max(1, stops)}
          aria-valuenow={k + 1}
          aria-valuetext={stopLabels[k] ?? String(k + 1)}
          onKeyDown={onKeyDown}
          onChange={e => { instant.current = true; onChange(Number(e.target.value) / RANGE_MAX); }}
          onBlur={() => { if (instant.current) { instant.current = false; commitStop(stopOf(tRef.current, stops)); } }}
        />
      </div>
      {foot}
      </div>
    </div>
  );
}
