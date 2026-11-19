// Ella's Bloom Map 7 (2026-11-17), C1 — /map, rebuilt as Dana's page
// (map5_mockup_customer.png). Behind the pre-launch gate and AdminRoute; brief 4
// moves it under the customer_face surface row. Top to bottom: a heading and
// one line, the map with only the customer's part lit (their coffee named, an
// arrow to each step, every other coffee a quiet unnamed dot), the first bag
// with its one reason (or "You are here" after a bag), one card per published
// step, and one closing line. "Make it my next bag" decides through the one
// door (move step) and re-reads the page.
// Every word comes from /api/map (dial_customer_copy, the step rows, the card
// readers); nothing here names a ring, lane, grade, version, basis or roaster.
// A price shows where one exists (brief 8 makes every coffee buyable).
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_7_MATCH_RULE_AND_CUSTOMER_PAGE.md
// Ella map 8 (2026-11-18), C1: a buyable coffee shows its price chip, and its
// button adds one bag at the anchor size to the cart as a direct line (useCart,
// G4.1) and records the choice as before; a coffee that is not buyable records
// the choice only. The first bag's button adds it to the cart (the quiz already
// recorded the position). The cart, checkout and subscribe choice are the
// existing components.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_8_PRICES_AND_BUYABLE.md
import { useCallback, useEffect, useState } from 'react';
import EllaMapFace from './EllaMapFace';
import { useCart } from '../../../context/CartContext';
import { directCartItem } from '../cartItems';
import type { CartItem } from '../types';
import {
  getMapFace, getMapSteps, decideMove, useMapFetch,
  type MapFaceData, type MapSteps, type MapStepCard, type MapPrice,
} from '../../../lib/mapCustomer';

const INK = 'text-[#3f3a36]';
const SOFT = 'text-[#6b5a56]';
const TEAL = '#2f6f68';
const EYEBROW = 'text-[11px] uppercase tracking-[0.18em] font-semibold';

/** One bag of a buyable map coffee, at its anchor size and price, as a direct line. */
function mapCartItem(c: { coffeeId: number; name: string; familyLabel: string | null; price: MapPrice | null }): CartItem | null {
  if (!c.price) return null;
  return directCartItem({ coffeeId: c.coffeeId, platformName: c.name, archetypeLabel: c.familyLabel }, c.familyLabel ?? '',
    { weightOz: c.price.weightOz, retailPriceCents: c.price.cents });
}

function Price({ price }: { price: MapPrice | null }) {
  if (!price) return null;
  return (
    <span className="inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium border" style={{ borderColor: TEAL, color: TEAL }} data-testid="price">
      ${(price.cents / 100).toFixed(2)} · {price.sizeLabel}
    </span>
  );
}

function StepCard({ step, copy, open, busy, onToggle, onChoose }: {
  step: MapStepCard; copy: Record<string, string>; open: boolean; busy: boolean; onToggle: () => void; onChoose: () => void;
}) {
  return (
    <div className="rounded-xl bg-white border border-[#e8e4dc] p-4" data-testid="step-card">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className={EYEBROW} style={{ color: TEAL }} data-testid="step-word">{step.word}</p>
          <h3 className={`text-lg font-semibold ${INK}`} data-testid="step-coffee">{step.name}</h3>
          {step.line && <p className={`text-sm ${SOFT}`} data-testid="step-line">{step.line}</p>}
        </div>
        <button type="button" onClick={onToggle} aria-expanded={open} data-testid="see-it"
          className="shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold border" style={{ borderColor: TEAL, color: TEAL }}>
          {copy.see_it}
        </button>
      </div>
      {open && (
        <div className="mt-3 pt-3 border-t border-[#e8e4dc]" data-testid="step-open">
          <p className={`text-base font-semibold ${INK}`}>{step.name}</p>
          {step.notes.length > 0 && <p className={`text-sm ${SOFT}`}>{step.notes.join(', ')}</p>}
          {step.line && <p className={`text-sm ${SOFT} mt-1`}>{step.line}</p>}
          <Price price={step.price} />
          <div>
            <button type="button" disabled={busy} onClick={onChoose} data-testid="make-next-bag"
              className="mt-3 px-4 py-2 rounded-full text-sm font-medium text-white disabled:opacity-50" style={{ background: TEAL }}>
              {copy.make_next_bag}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MapPage() {
  const apiFetch = useMapFetch();
  const [face, setFace] = useState<MapFaceData | null>(null);
  const [data, setData] = useState<MapSteps | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<number | null>(null);
  const { addToCart } = useCart();

  const load = useCallback(async () => {
    if (!apiFetch) return;
    try {
      const [f, s] = await Promise.all([getMapFace(apiFetch), getMapSteps(apiFetch)]);
      setFace(f); setData(s); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [apiFetch]);
  useEffect(() => { void load(); }, [load]);

  const choose = async (step: MapStepCard) => {
    if (!apiFetch) return;
    setBusy(true);
    try {
      await decideMove(apiFetch, { move: 'step', coffeeId: step.coffeeId, requestId: crypto.randomUUID() });
      const line = mapCartItem(step);
      if (line) { addToCart(line); setAdded(step.coffeeId); }
      setOpen(null);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const addFirstBag = (c: Parameters<typeof mapCartItem>[0]) => {
    const line = mapCartItem(c);
    if (line) { addToCart(line); setAdded(c.coffeeId); }
  };

  if (error && !data) return <main className="max-w-md mx-auto px-4 py-10"><p className={`text-sm ${SOFT}`} data-testid="map-error">{error}</p></main>;
  if (!data || !face) return <main className="max-w-md mx-auto px-4 py-10" />;
  const pos = data.position;
  const copy = data.copy;
  if (!pos) return <main className="max-w-md mx-auto px-4 py-10" data-testid="map-empty" />;
  const first = data.firstBag && !pos.hasBag ? data.firstBag : null;

  return (
    <main className="max-w-md mx-auto px-4 py-6" style={{ fontFamily: 'Lato, sans-serif' }} data-testid="map-page">
      <p className={`${EYEBROW} ${SOFT}`}>{copy.map_eyebrow}</p>
      <h1 className={`text-3xl font-semibold ${INK} mt-1`} data-testid="map-title">{first ? copy.map_title_first : copy.map_title_after}</h1>
      <p className={`text-sm ${SOFT} mt-2 mb-4`}>{copy.map_intro}</p>

      <div className="mb-5" data-testid="map-face">
        <EllaMapFace placements={face.placements} wedges={face.wedges} size="full" labelMode="name"
          highlightCoffeeId={pos.coffeeId} arrowsTo={data.steps.map(s => s.coffeeId)} quietOthers />
      </div>

      <section className="rounded-xl bg-white border border-[#e8e4dc] p-5 mb-6" data-testid="position-card">
        <p className={EYEBROW} style={{ color: TEAL }} data-testid="position-title">{first ? copy.first_bag_title : copy.here_title}</p>
        <h2 className={`text-2xl font-semibold ${INK} mt-1`} data-testid="position-name">{pos.name}</h2>
        {pos.notes.length > 0 && <p className={`text-base ${INK} mt-1`}>{pos.notes.join(', ')}</p>}
        {first && (
          <p className={`text-sm ${SOFT} mt-2`} data-testid="first-bag-reason"><strong className={INK}>{copy.why_this_one}</strong> {first.reason}</p>
        )}
        <Price price={pos.price} />
        {first && pos.price && (
          <div>
            <button type="button" onClick={() => addFirstBag(pos)} data-testid="add-first-bag"
              className="mt-3 px-4 py-2 rounded-full text-sm font-medium text-white" style={{ background: TEAL }}>
              {copy.add_first_bag}
            </button>
          </div>
        )}
        {added === pos.coffeeId && <p className={`text-sm ${SOFT} mt-2`} data-testid="added-to-cart">{copy.added_to_cart}</p>}
      </section>

      {data.steps.length > 0 && (
        <section data-testid="steps">
          <div className="flex items-baseline justify-between mb-3">
            <p className={`${EYEBROW} ${SOFT}`}>{copy.steps_title}</p>
            <p className={`text-xs ${SOFT}`}>{copy.steps_hint}</p>
          </div>
          <div className="flex flex-col gap-3">
            {data.steps.map(s => (
              <StepCard key={s.stepId} step={s} copy={copy} open={open === s.stepId} busy={busy}
                onToggle={() => setOpen(open === s.stepId ? null : s.stepId)} onChoose={() => choose(s)} />
            ))}
          </div>
        </section>
      )}
      {error && <p className="text-sm text-[#a33726] mt-3">{error}</p>}

      <p className={`text-sm ${SOFT} text-center mt-8`} data-testid="closing-line">{copy.closing_line}</p>
    </main>
  );
}
