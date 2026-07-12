import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import logoLinesSvg from '../../design/LOGO/LogoLines.svg';

export interface DialPosition {
  dialSortOrder: number;
  label: string;
  description: string | null;
  isActive: boolean;
}

export interface BloomDialHandle {
  /** Programmatically rotate to a position — used by hop navigation. */
  rotateTo: (dialSortOrder: number) => void;
}

interface BloomDialWidgetProps {
  color: string;
  archetypeLabel: string;
  positions: DialPosition[];
  dimensionLabel: string | null;
  defaultSortOrder: number;
  initialSortOrder?: number | null;
  onSelect: (dialSortOrder: number) => void;
}

/**
 * Generalized, reusable Bloom Dial — same draggable/snapping-wheel mechanics as
 * FlavorQuiz.tsx's BloomDial (that component stays exactly as-is, hardcoded to
 * Chocolate & Nutty/Body for the quiz result screen; this is a separate,
 * data-driven extraction for The Bloom, see Part 3 Phase B).
 *
 * Rotation convention, consistent across every archetype: clockwise increases
 * dialSortOrder ("more" of the dimension), counter-clockwise decreases it
 * ("less") — same angle math as the original component, which already encoded
 * this (BODY_LEVELS goes Gentle→Deep as the angle increases).
 */
export const BloomDialWidget = forwardRef<BloomDialHandle, BloomDialWidgetProps>(function BloomDialWidget(
  { color, archetypeLabel, positions, dimensionLabel, defaultSortOrder, initialSortOrder, onSelect }, ref
) {
  const sorted = [...positions].sort((a, b) => a.dialSortOrder - b.dialSortOrder);
  const n = sorted.length;
  const snapDeg = 360 / n;

  const indexForSortOrder = (sortOrder: number) => {
    const idx = sorted.findIndex(p => p.dialSortOrder === sortOrder);
    return idx >= 0 ? idx : 0;
  };
  const startIdx = indexForSortOrder(initialSortOrder ?? defaultSortOrder);

  const [dialAngle, setDialAngle]     = useState(startIdx * snapDeg);
  const [selectedIdx, setSelectedIdx] = useState<number>(startIdx);
  const [isDragging, setIsDragging]   = useState(false);
  const [isSnapping, setIsSnapping]   = useState(false);

  const wheelRef     = useRef<HTMLDivElement>(null);
  const dialAngleRef = useRef(startIdx * snapDeg);
  const dragRef      = useRef({ startPA: 0, startDA: 0, active: false });
  const snapTimeout  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Re-center on the saved/default position if it changes after mount (e.g. the
  // signed-in user's saved position loads in after the widget's first render).
  useEffect(() => {
    const idx = indexForSortOrder(initialSortOrder ?? defaultSortOrder);
    dialAngleRef.current = idx * snapDeg;
    setDialAngle(idx * snapDeg);
    setSelectedIdx(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSortOrder, n]);

  useEffect(() => () => { if (snapTimeout.current) clearTimeout(snapTimeout.current); }, []);

  const pointerAngle = (clientX: number, clientY: number): number => {
    const el = wheelRef.current;
    if (!el) return 0;
    const { left, top, width, height } = el.getBoundingClientRect();
    return Math.atan2(clientY - (top + height / 2), clientX - (left + width / 2)) * (180 / Math.PI) + 90;
  };

  const snapAndSelect = (rawAngle: number) => {
    const nrm     = ((rawAngle % 360) + 360) % 360;
    const snapped = Math.round(nrm / snapDeg) * snapDeg % 360;
    const idx     = Math.round(nrm / snapDeg) % n;
    dialAngleRef.current = snapped;
    setDialAngle(snapped);
    setSelectedIdx(idx);
    onSelect(sorted[idx].dialSortOrder);
    if (!reducedMotion) {
      setIsSnapping(true);
      if (snapTimeout.current) clearTimeout(snapTimeout.current);
      snapTimeout.current = setTimeout(() => setIsSnapping(false), 400);
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startPA: pointerAngle(e.clientX, e.clientY), startDA: dialAngleRef.current, active: true };
    setIsDragging(true);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    dragRef.current = { startPA: pointerAngle(t.clientX, t.clientY), startDA: dialAngleRef.current, active: true };
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;
    const move = (cx: number, cy: number) => {
      if (!dragRef.current.active) return;
      let delta = pointerAngle(cx, cy) - dragRef.current.startPA;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      const a = dragRef.current.startDA + delta;
      dialAngleRef.current = a;
      setDialAngle(a);
    };
    const end = () => {
      dragRef.current.active = false;
      setIsDragging(false);
      snapAndSelect(dialAngleRef.current);
    };
    const onMM = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onTM = (e: TouchEvent) => { const t = e.touches[0]; move(t.clientX, t.clientY); };
    window.addEventListener('mousemove', onMM);
    window.addEventListener('mouseup', end);
    window.addEventListener('touchmove', onTM, { passive: false });
    window.addEventListener('touchend', end);
    return () => {
      window.removeEventListener('mousemove', onMM);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchmove', onTM);
      window.removeEventListener('touchend', end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);

  // Programmatic rotation (e.g. a hop link targeting a position within this archetype).
  useImperativeHandle(ref, () => ({
    rotateTo(dialSortOrder: number) {
      const idx = indexForSortOrder(dialSortOrder);
      dialAngleRef.current = idx * snapDeg;
      setDialAngle(idx * snapDeg);
      setSelectedIdx(idx);
      onSelect(sorted[idx].dialSortOrder);
      if (!reducedMotion) {
        setIsSnapping(true);
        if (snapTimeout.current) clearTimeout(snapTimeout.current);
        snapTimeout.current = setTimeout(() => setIsSnapping(false), 400);
      }
    },
  }));

  const current = sorted[selectedIdx];

  const wheelT = reducedMotion ? 'none'
    : isDragging ? 'none'
    : isSnapping ? 'transform 0.35s cubic-bezier(0.34, 1.4, 0.64, 1)'
    : 'transform 0.08s ease-out';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <p style={{ fontSize: '0.49rem', letterSpacing: '0.26em', textTransform: 'uppercase', color, opacity: 0.40, margin: '0 0 14px', textAlign: 'center' }}>
        Personalize your {archetypeLabel}
      </p>

      {dimensionLabel && (
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 320, marginBottom: 16 }}>
          <span style={{ fontSize: '0.58rem', letterSpacing: '0.2em', textTransform: 'uppercase', color, opacity: 0.65 }}>← {sorted[0].label}</span>
          <span style={{ fontSize: '0.58rem', letterSpacing: '0.2em', textTransform: 'uppercase', color, opacity: 0.65 }}>{dimensionLabel} →</span>
        </div>
      )}

      <div style={{ position: 'relative', marginBottom: 20 }}>
        <div style={{
          position: 'absolute', top: -15, left: '50%', transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
          borderTop: `8px solid ${color}`, zIndex: 2,
        }} />
        <div
          ref={wheelRef}
          style={{
            width: 'clamp(130px, 14vw, 190px)', height: 'clamp(130px, 14vw, 190px)',
            cursor: isDragging ? 'grabbing' : 'grab',
            transform: `rotate(${dialAngle}deg)`,
            transition: wheelT, userSelect: 'none', touchAction: 'none',
          }}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
        >
          <img src={logoLinesSvg} alt="" draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }} />
        </div>
      </div>

      <div style={{ textAlign: 'center', minHeight: 48 }}>
        <p style={{ fontSize: '0.68rem', letterSpacing: '0.22em', textTransform: 'uppercase', color, margin: '0 0 5px' }}>
          {current.label}
          {!current.isActive && <span style={{ opacity: 0.5 }}> · Temporarily unavailable</span>}
        </p>
        {current.description && (
          <p style={{ fontSize: 'clamp(0.68rem, 0.80vw, 0.78rem)', color, opacity: 0.68, lineHeight: 1.6, margin: 0, maxWidth: 320 }}>
            {current.description}
          </p>
        )}
      </div>
    </div>
  );
});
