import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { SEGMENTS, READER_ANGLES, tierFill, allocateSegments } from './axisWheel';
import './axis.css';

// Website 6 (2026-11-05): the panels of The Axis (source/axis/build.py:
// origin_list, family_bands, the 02 list, wheel('families'), readers()) and the
// handoff's accordion, drawn from data. `ax-` CSS prefix (axis.css).

/** Adds `in` once the element scrolls into view (the handoff's IntersectionObserver); at once under reduced motion or without IO. */
export function useInView<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const reduce = useReducedMotion();
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (reduce || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { setInView(true); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);
  return [ref, inView];
}

export interface FamilyLook { code: string; label: string; color: string; ink: string; accent: string; words: string[] | null }

/** Hero: the origin regions with one dot per sellable coffee (GET /api/axis/stats originRegions). */
export function OriginList({ regions }: { regions: { label: string; coffeeCount: number }[] }) {
  const [ref, inView] = useInView<HTMLOListElement>();
  const reduce = useReducedMotion();
  return (
    <ol ref={ref} className={`ax-origins${inView ? ' in' : ''}`} data-motion={reduce ? 'off' : 'on'} data-testid="origin-list">
      {regions.map(r => (
        <li key={r.label} aria-label={`${r.label}: ${r.coffeeCount} ${r.coffeeCount === 1 ? 'coffee' : 'coffees'}`}>
          <span className="ax-o-name" aria-hidden="true">{r.label}</span>
          <span className="ax-o-dots" aria-hidden="true" data-testid="origin-dots">
            {Array.from({ length: r.coffeeCount }, (_, j) => <i key={j} style={{ ['--i' as string]: j } as CSSProperties} />)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** 02 Place: the five colour bands; the hot one opens and shows the family's three words. */
export function FamilyBands({ families, hot, onHot }: { families: FamilyLook[]; hot: string | null; onHot: (code: string | null) => void }) {
  return (
    <div className="ax-bands" data-testid="family-bands">
      {families.map(f => (
        <div
          key={f.code}
          className={`ax-band${hot === f.code ? ' hot' : ''}`}
          data-fam={f.code}
          tabIndex={0}
          aria-label={f.words?.length ? `${f.label}: ${f.words.join(', ')}` : f.label}
          style={{ ['--c' as string]: f.color, ['--ink' as string]: f.ink } as CSSProperties}
          onMouseEnter={() => onHot(f.code)}
          onMouseLeave={() => onHot(null)}
          onFocus={() => onHot(f.code)}
          onBlur={() => onHot(null)}
        >
          <span className="ax-b-name" aria-hidden="true">{f.label}</span>
          {f.words && f.words.length > 0 && <span className="ax-b-desc" aria-hidden="true">{f.words.join(' · ')}</span>}
        </div>
      ))}
    </div>
  );
}

/** 02 Place, text column: the families as a list; hovering or focusing one opens its band. */
export function FamilyList({ families, hot, onHot }: { families: FamilyLook[]; hot: string | null; onHot: (code: string | null) => void }) {
  return (
    <ul className="ax-fams" data-testid="family-list">
      {families.map(f => (
        <li
          key={f.code}
          tabIndex={0}
          className={hot === f.code ? 'hot' : undefined}
          style={{ ['--c' as string]: f.color, ['--a' as string]: f.accent } as CSSProperties}
          onMouseEnter={() => onHot(f.code)}
          onMouseLeave={() => onHot(null)}
          onFocus={() => onHot(f.code)}
          onBlur={() => onHot(null)}
        >
          <i aria-hidden="true" />
          <span><b>{f.label}</b>{f.words && f.words.length > 0 ? <> — {f.words.join(' · ')}</> : null}</span>
        </li>
      ))}
    </ul>
  );
}

/** 03 Network: the family wheel, one segment per coffee (allocateSegments). */
export function FamilyWheel({ families, experimentalCount, ink }: {
  families: (FamilyLook & { count: number })[];
  experimentalCount: number;
  ink: string;
}) {
  const [ref, inView] = useInView<SVGSVGElement>();
  const kinds = allocateSegments(families.map(f => ({ code: f.code, color: f.color, count: f.count })), experimentalCount);
  const label = families.filter(f => f.count > 0).map(f => `${f.label}: ${f.count}`).join(', ')
    + (experimentalCount > 0 ? `, Experimental: ${experimentalCount}` : '');
  return (
    <svg ref={ref} className={`ax-wheel${inView ? ' in' : ''}`} viewBox="0 0 162.4763 171.4078" role="img"
      aria-label={`Coffees on the map by family. ${label}`} data-testid="family-wheel">
      <g stroke="#ffffff" strokeWidth={0.7} strokeMiterlimit={10}>
        {SEGMENTS.map((p, i) => {
          const k = kinds[i];
          if (k.kind === 'experimental') {
            return <path key={i} className="ax-seg exp" d={p.d} fill="#ffffff" stroke={ink} strokeWidth={0.8} strokeDasharray="1.6 1.6" data-kind="experimental" />;
          }
          if (k.kind === 'open') {
            return <path key={i} className="ax-seg open" d={p.d} fill="none" stroke={ink} strokeOpacity={0.25} strokeWidth={0.5} data-kind="open" />;
          }
          return <path key={i} className="ax-seg" style={{ ['--i' as string]: i } as CSSProperties} d={p.d} fill={tierFill(k.color, p.tier)} data-kind={k.code} />;
        })}
      </g>
    </svg>
  );
}

/** 04 Readers: three petals, the three readers of the map. */
export function ReadersPanel({ ink, labels }: { ink: string; labels: [string, string, string] }) {
  const [ref, inView] = useInView<SVGSVGElement>();
  const petals = SEGMENTS.filter(p => READER_ANGLES.includes(p.ang));
  return (
    <div className="ax-readers">
      <span className="ax-rd ax-rd-a">{labels[0]}</span>
      <span className="ax-rd ax-rd-b">{labels[1]}</span>
      <svg ref={ref} className={`ax-wheel small${inView ? ' in' : ''}`} viewBox="0 0 162.4763 171.4078" aria-hidden="true">
        <g stroke="#ffffff" strokeWidth={0.7} strokeMiterlimit={10}>
          {petals.map((p, i) => <path key={i} className="ax-seg" style={{ ['--i' as string]: i } as CSSProperties} d={p.d} fill={tierFill(ink, p.tier)} />)}
        </g>
      </svg>
      <span className="ax-rd ax-rd-c">{labels[2]}</span>
      <svg className="ax-rd-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M14,14 L50,50 L86,14 M50,50 L50,90" fill="none" stroke={ink} strokeWidth={0.35} strokeDasharray="1 2.2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/** The handoff's `.acc`: a button that opens a region (keyboard: Enter / Space, as any button). */
export function Accordion({ question, children }: { question: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="ax-acc" data-open={open ? 'true' : 'false'}>
      <h3 className="ax-acc-h">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
          <span>{question}</span><i aria-hidden="true" />
        </button>
      </h3>
      <div id={id} role="region" aria-label={question} hidden={!open} className="ax-acc-body">{children}</div>
    </div>
  );
}
