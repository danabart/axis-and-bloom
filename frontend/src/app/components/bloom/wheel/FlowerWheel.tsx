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

export function FlowerWheel({ t, stops, color, stopLabels, ariaLabel, onChange, onCommit, meta, foot }: FlowerWheelProps) {
  const reduced = usePrefersReducedMotion();
  const still = stops <= 1;
  const tt = tints(color);
  const gRef = useRef<SVGGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const cur = useRef(-t * WHEEL_SWEEP_DEG);
  const target = useRef(cur.current);
  const raf = useRef<number | null>(null);
  const instant = useRef(false);
  const drag = useRef<{ a0: number; t0: number; id: number } | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const paintRotation = (deg: number) => {
    gRef.current?.setAttribute('transform', `rotate(${deg.toFixed(2)} ${WHEEL_CENTRE.x} ${WHEEL_CENTRE.y})`);
  };

  // spin(): ease the rotation toward -t*270deg; instant under reduced motion,
  // while dragging and while sliding (the handoff's `instant`).
  useEffect(() => {
    target.current = -t * WHEEL_SWEEP_DEG;
    if (reduced || instant.current || typeof requestAnimationFrame === 'undefined') {
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
  }, [t, reduced]);

  useEffect(() => () => { if (raf.current != null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf.current); }, []);

  const k = stopOf(t, stops);
  const commitStop = (stop: number) => onCommit(tOf(stop, stops));

  function angle(e: PointerEvent) {
    const r = wrapRef.current!.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  }
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (still) return;
    drag.current = { a0: angle(e), t0: tRef.current, id: e.pointerId };
    instant.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    let d = angle(e) - drag.current.a0;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    onChange(Math.max(0, Math.min(1, drag.current.t0 - d / (Math.PI * 1.5))));
  }
  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    instant.current = false;
    commitStop(stopOf(tRef.current, stops));
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
        className={`bf-wheel-wrap${still ? ' is-still' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="bf-marker" aria-hidden="true" />
        <svg viewBox={WHEEL_VIEWBOX} aria-hidden="true" focusable="false">
          <g ref={gRef} transform={`rotate(${(-t * WHEEL_SWEEP_DEG).toFixed(2)} ${WHEEL_CENTRE.x} ${WHEEL_CENTRE.y})`}>
            <g fill="none" strokeMiterlimit={10}>
              {PETALS.map((p, i) => {
                const on = petalOn(p.thr, t);
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
      <div className="bf-ticks" aria-hidden="true">
        {Array.from({ length: tickCount }, (_, q) => <i key={q} className={q % ticksPer === 0 ? 'big' : undefined} />)}
      </div>
      <input
        className="bf-range"
        type="range"
        min={0}
        max={RANGE_MAX}
        step={1}
        value={Math.round(t * RANGE_MAX)}
        disabled={still}
        aria-label={ariaLabel}
        aria-valuemin={1}
        aria-valuemax={Math.max(1, stops)}
        aria-valuenow={k + 1}
        aria-valuetext={stopLabels[k] ?? String(k + 1)}
        onKeyDown={onKeyDown}
        onChange={e => { instant.current = true; onChange(Number(e.target.value) / RANGE_MAX); }}
        onPointerUp={() => { instant.current = false; commitStop(stopOf(tRef.current, stops)); }}
        onBlur={() => { if (instant.current) { instant.current = false; commitStop(stopOf(tRef.current, stops)); } }}
      />
      {foot}
      </div>
    </div>
  );
}
