import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';
import { getCells, colorizeCells, BEIGE, W, H, type Cell, type RGB } from './fillEngine';
import { LINEWORK_URI } from './linework';
import type { DialConfig, DialCoffee } from './archetypeConfig';

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
}

const TRAVEL = 120;
const ZONE_ROT = [-90, -30, 30, 90];

function fmtPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
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
  { config, initialDialSortOrder = 2, onZoneChange, onPreOrder },
  ref,
) {
  const rootRef    = useRef<HTMLDivElement>(null);
  const wrapRef    = useRef<HTMLDivElement>(null);
  const rotorRef   = useRef<HTMLDivElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const ticksRef   = useRef<HTMLDivElement>(null);
  const needleRef  = useRef<HTMLDivElement>(null);
  const nowRef     = useRef<HTMLDivElement>(null);
  const nameRef    = useRef<HTMLDivElement>(null);
  const priceRef   = useRef<HTMLDivElement>(null);
  const nlinesRef  = useRef<HTMLDivElement>(null);

  // Engine state (per instance).
  const cellsRef   = useRef<Cell[] | null>(null);
  const colorsRef  = useRef<RGB[] | null>(null);
  const imgDataRef = useRef<ImageData | null>(null);
  const alphaRef   = useRef<number[]>([]);
  const ctxRef     = useRef<CanvasRenderingContext2D | null>(null);

  const rotRef     = useRef<number>(ZONE_ROT[Math.min(3, Math.max(0, initialDialSortOrder - 1))]);
  const zoneRef    = useRef<number>(Math.min(3, Math.max(0, initialDialSortOrder - 1)));
  const draggingRef = useRef<false | 'wheel' | 'bar'>(false);
  const lastZoneRef = useRef<number>(-1);

  // Keep latest callbacks/config without re-running the setup effect.
  const onZoneChangeRef = useRef(onZoneChange);
  const onPreOrderRef   = useRef(onPreOrder);
  const configRef       = useRef(config);
  onZoneChangeRef.current = onZoneChange;
  onPreOrderRef.current   = onPreOrder;
  configRef.current       = config;

  useImperativeHandle(ref, () => ({
    rotateTo(dialSortOrder: number) {
      const zone = Math.min(3, Math.max(0, dialSortOrder - 1));
      zoneRef.current = zone;
      rotRef.current = ZONE_ROT[zone];
      paintRef.current?.(rotRef.current);
    },
  }), []);

  // paint() is stored in a ref so handlers/imperative calls share one instance.
  const paintRef = useRef<((rot: number) => void) | null>(null);

  useEffect(() => {
    ensureStyles();
    const wrap = wrapRef.current!, rotor = rotorRef.current!, canvas = canvasRef.current!;
    const ticks = ticksRef.current!, needle = needleRef.current!;
    let cancelled = false;

    const ctx = canvas.getContext('2d');
    ctxRef.current = ctx;

    const posOf = (rot: number) => (rot + TRAVEL) / (2 * TRAVEL);
    const zoneOf = (pos: number) => Math.max(0, Math.min(3, Math.floor(pos * 4)));

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
      if (nowRef.current) nowRef.current.textContent = 'COFFEE NO. ' + (zone + 1);
      if (nameRef.current) nameRef.current.textContent = coffee.name;
      if (priceRef.current) priceRef.current.textContent =
        `12oz · ${fmtPrice(coffee.price12Cents)}  /  5lb · ${fmtPrice(coffee.price5Cents)}`;
      wrap.setAttribute('aria-valuenow', String(zone));
      ticks.setAttribute('aria-valuenow', String(zone));
      if (zone !== lastZoneRef.current) {
        lastZoneRef.current = zone;
        [nowRef.current, nameRef.current].forEach(el => {
          if (!el) return;
          el.style.opacity = '0';
          setTimeout(() => { el.style.opacity = '1'; }, 60);
        });
      }
    }
    paintRef.current = paint;

    function snap() {
      const zone = zoneOf(posOf(rotRef.current));
      zoneRef.current = zone;
      rotRef.current = ZONE_ROT[zone];
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
    function fitLines() {
      const nlines = nlinesRef.current;
      if (!nlines) return;
      const lockW = (nlines.parentElement?.clientWidth ?? 300) - 36;
      nlines.querySelectorAll<HTMLElement>('.bd-nline').forEach(l => {
        l.style.fontSize = '100px';
        const tw = l.scrollWidth || 1;
        l.style.fontSize = Math.min(92, Math.max(30, Math.floor(100 * lockW / tw))) + 'px';
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

    // ── Keyboard (both wheel and bar) ──
    const step = (d: number) => {
      const zone = Math.max(0, Math.min(3, zoneRef.current + d));
      zoneRef.current = zone; rotRef.current = ZONE_ROT[zone];
      paint(rotRef.current);
      onZoneChangeRef.current?.(zone + 1);
    };
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
    };
    // Rebuild only if the archetype identity changes (each dial is one archetype).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.archetype]);

  // Apply an externally-changed position (saved position arriving, deep link)
  // without fighting an in-progress drag or looping on our own emits.
  useEffect(() => {
    const zone = Math.min(3, Math.max(0, initialDialSortOrder - 1));
    if (draggingRef.current || zone === zoneRef.current) return;
    zoneRef.current = zone;
    rotRef.current = ZONE_ROT[zone];
    paintRef.current?.(rotRef.current);
  }, [initialDialSortOrder]);

  const rootVars = {
    '--bd-field': config.color,
    '--bd-ftext': config.ftext,
    '--bd-ftext-weak': config.ftext === '#3a3c3e' ? 'rgba(58,60,62,.35)' : 'rgba(242,241,234,.35)',
    '--bd-ftext-mid':  config.ftext === '#3a3c3e' ? 'rgba(58,60,62,.65)' : 'rgba(242,241,234,.65)',
  } as CSSProperties;

  return (
    <section ref={rootRef} id={config.archetype} className="bd-section" style={rootVars}>
      <div className="bd-stage">
        {/* Reading column */}
        <div className="bd-reading">
          <div className="bd-namelock">
            <div className="bd-your">YOUR</div>
            <div ref={nlinesRef}>
              {config.nameLines.map((l, i) => <div key={i} className="bd-nline">{l}</div>)}
            </div>
            <div className="bd-bdial">BLOOM&nbsp;DIAL</div>
            <div className="bd-vno">NO. {config.no}</div>
          </div>
          <div className="bd-reading-bottom">
            <div className="bd-now" ref={nowRef}>COFFEE NO. {initialDialSortOrder}</div>
            <div className="bd-coffee-name" ref={nameRef}>
              {config.coffees[Math.min(3, Math.max(0, initialDialSortOrder - 1))].name}
            </div>
            <div className="bd-coffee-price" ref={priceRef}>
              12oz · $32.00 &nbsp;/&nbsp; 5lb · $185.00
            </div>
            <button
              className="bd-btn"
              type="button"
              onClick={() => onPreOrderRef.current?.(configRef.current.coffees[zoneRef.current])}
            >
              PRE-ORDER THIS COFFEE&nbsp;&nbsp;→
            </button>
          </div>
        </div>

        {/* Instrument field */}
        <div className="bd-instrument">
          <div
            className="bd-dial-wrap" ref={wrapRef}
            role="slider" tabIndex={0}
            aria-label={`${config.archetypeLabel} Bloom Dial`}
            aria-valuemin={0} aria-valuemax={3} aria-valuenow={Math.min(3, Math.max(0, initialDialSortOrder - 1))}
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
              aria-valuemin={0} aria-valuemax={3} aria-valuenow={Math.min(3, Math.max(0, initialDialSortOrder - 1))}
            >
              <div className="bd-needle" ref={needleRef} />
            </div>
            <div className="bd-ruler-ends"><span>DELICATE</span><span>PRONOUNCED</span></div>
          </div>
          <div className="bd-hint">TURN THE WHEEL, OR SLIDE THE BAR</div>
          <div className="bd-field-bag">
            <img src={config.bag} alt={`${config.archetypeLabel} bag`} draggable={false} />
            <div className="bd-bag-shadow" />
          </div>
        </div>
      </div>
    </section>
  );
});

const EASE = 'cubic-bezier(0.22,1,0.36,1)';
const CSS = `
.bd-section{background:#f2f1ea;}
.bd-stage{display:grid;grid-template-columns:minmax(300px,27%) 1fr;min-height:78vh;}
.bd-reading{background:#f2f1ea;text-align:left;display:flex;flex-direction:column;justify-content:space-between;padding:56px 48px 60px;}
.bd-reading-bottom{padding-top:34px;}
.bd-namelock{position:relative;padding-right:36px;}
.bd-your{font-size:12px;letter-spacing:.3em;color:#45474a;font-weight:500;margin-bottom:12px;}
.bd-nline{font-weight:600;color:#9a2918;line-height:.95;letter-spacing:-.01em;text-transform:uppercase;white-space:nowrap;}
.bd-bdial{margin-top:12px;font-size:26px;font-weight:600;color:#ee5974;letter-spacing:.02em;}
.bd-vno{position:absolute;right:0;top:34px;writing-mode:vertical-rl;transform:rotate(180deg);font-size:11px;letter-spacing:.3em;color:#7b7f80;font-weight:500;}
.bd-instrument{position:relative;user-select:none;background:var(--bd-field);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 40px;}
.bd-dial-wrap{position:relative;width:440px;height:440px;margin:0 auto;cursor:grab;touch-action:none;}
.bd-dial-wrap:active{cursor:grabbing;}
.bd-dial-wrap:focus{outline:none;}
.bd-dial-wrap:focus-visible{outline:1px solid #c5c7c8;outline-offset:12px;}
.bd-rotor{position:absolute;inset:0;transition:transform 560ms ${EASE};}
.bd-dial-wrap.bd-dragging .bd-rotor{transition:none;}
.bd-rotor canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}
.bd-rotor img{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;-webkit-user-drag:none;}
.bd-marker{position:absolute;top:-16px;left:50%;transform:translateX(-50%);width:2px;height:18px;background:#45474a;z-index:2;}
.bd-ruler{width:360px;max-width:86vw;margin:38px auto 0;}
.bd-ruler-ticks{position:relative;height:26px;margin-bottom:10px;cursor:pointer;touch-action:none;}
.bd-ruler-ticks:focus{outline:none;}
.bd-ruler-ticks:focus-visible{outline:1px solid #c5c7c8;outline-offset:6px;}
.bd-tick{position:absolute;bottom:0;width:1px;height:8px;background:var(--bd-ftext-weak);}
.bd-tick.bd-major{height:14px;background:var(--bd-ftext-mid);}
.bd-needle{position:absolute;bottom:0;width:2px;height:18px;background:var(--bd-ftext);transition:left 560ms ${EASE};}
.bd-needle::after{content:'';position:absolute;top:-9px;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:var(--bd-ftext);}
.bd-ruler-ticks.bd-dragging .bd-needle{transition:none;}
.bd-ruler-ends{display:flex;justify-content:space-between;font-size:9.5px;letter-spacing:.24em;color:var(--bd-ftext);}
.bd-hint{margin-top:12px;font-size:10.5px;letter-spacing:.14em;color:var(--bd-ftext-mid);}
.bd-field-bag{position:absolute;right:54px;bottom:42px;text-align:center;pointer-events:none;}
.bd-field-bag img{width:146px;height:auto;display:block;-webkit-user-drag:none;}
.bd-bag-shadow{width:102px;height:10px;margin:-4px auto 0;border-radius:50%;background:radial-gradient(ellipse,rgba(58,60,62,.22),rgba(58,60,62,0) 70%);}
.bd-now{font-size:9.5px;letter-spacing:.28em;color:#7b7f80;transition:opacity 300ms ${EASE};}
.bd-coffee-name{margin-top:14px;font-size:32px;min-height:122px;font-weight:500;color:#9a2918;letter-spacing:-0.008em;line-height:1.25;transition:opacity 300ms ${EASE};}
.bd-coffee-price{margin-top:10px;font-size:12.5px;color:#7b7f80;}
.bd-btn{display:block;width:100%;margin-top:26px;background:#9a2918;color:#f2f1ea;font-size:12px;letter-spacing:.16em;font-weight:500;padding:15px 10px;text-align:center;text-decoration:none;cursor:pointer;border:none;font-family:inherit;transition:background 480ms ${EASE};}
.bd-btn:hover{background:#8a2416;}
@media (max-width:940px){
  .bd-stage{grid-template-columns:1fr;min-height:0;}
  .bd-instrument{order:1;padding:48px 20px 120px;}
  .bd-field-bag{right:18px;bottom:16px;}
  .bd-field-bag img{width:96px;}
  .bd-reading{order:2;padding:44px 28px;}
  .bd-coffee-name{min-height:0;}
  .bd-dial-wrap{width:320px;height:320px;}
}
@media (prefers-reduced-motion:reduce){
  .bd-rotor,.bd-needle,.bd-now,.bd-coffee-name,.bd-btn{transition:none !important;}
}
`;
