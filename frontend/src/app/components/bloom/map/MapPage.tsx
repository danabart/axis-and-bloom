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
// Ella map 9 (2026-11-20), C1: the first bag carries the "Founder's pick" label
// and its composed text; the one lead step sits first under its own title, the
// rest under the next. A step card is the coffee's name, its text and the price
// chip ("{price} · Add"), which does what "Make it my next bag" did (records the
// step, adds one bag). No "See it". Every word comes from /api/map/steps.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_9_PERSONAL_REASONS.md
// Ella map 12 (2026-11-26), C: "More about this coffee" (copy row more_about) on
// the top card and every step card opens the Bloom page's own reveal panel
// (RevealedPanel variant="field", G4.1) beneath that card, one open at a time,
// with the coffee's own parts only: the description, its best-brew tags, the
// cupping bars and the notes wheel. No comfort-zone label (a Bloom-page sibling,
// not in the panel), no compatibility sentence (the field variant reads none),
// no links (prelaunch, hideProfileLink, no onCompare). The reads are the public
// coffee reads through useCoffeeDetail, shared with the Bloom page. The button
// shows only for a coffee with a description or cupping bars.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_12_STEP_COMPARISONS_AND_REVEAL.md
// Ella map 13 (2026-11-26): a laptop layout from lg (the phone layout below lg
// is as it was): the map beside the top card, the step cards in two columns
// with the lead card across both; a card whose panel is open spans both
// columns, and the top card's open panel spans the page under the map and the
// top card. The panel is in the roaster's terms (RevealedPanel mapProfile): the
// description, where it shines (every method the roaster named, best first),
// the notes, then the roaster's own 1 to 5 ratings, never A&B's cupping bars;
// every heading is a copy row. It shows for a coffee with a description, the
// roaster's ratings, or notes with a where-it-shines answer.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_13_LAPTOP_LAYOUT_AND_ROASTER_PROFILE.md
// Ella map 14 (2026-11-27): the spot and the walk. The price chip only adds the
// bag (nothing is recorded; the cart never moves the map). Tapping a coffee's
// dot or a step card's name looks at that coffee: the page address carries it
// (?at=<coffee id>, so refresh and back work) and nothing is saved. The
// customer's own spot stays ringed; the coffee looked at has a lighter ring and
// the arrows leave it; the Founder's pick keeps a small ring once the spot has
// moved off it. The top card's label is a copy row (Founder's pick, here_title
// "Your spot", looking_at_title "Looking at"); "Back to your spot" clears ?at=.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_14_SPOT_AND_WALK.md
import { useCallback, useEffect, useId, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router';
import EllaMapFace from './EllaMapFace';
import { RevealedPanel, type MapPanelProfile } from '../RevealedPanel';
import { useCoffeeDetail } from '../../coffee-info/useCoffeeDetail';
import '../field/bloomField.css';
import { useCart } from '../../../context/CartContext';
import { directCartItem } from '../cartItems';
import type { CartItem } from '../types';
import {
  getMapFace, getMapSteps, useMapFetch,
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

const priceWords = (price: MapPrice) => `$${(price.cents / 100).toFixed(2)} · ${price.sizeLabel}`;

/** The panel's colours on /map: the page's ink on white, the card border as the range track. */
const PANEL_LOOK = { ['--accent' as string]: '#3f3a36', ['--t40' as string]: '#e8e4dc' } as CSSProperties;

/** Ella map 13: the lg breakpoint (Tailwind's, 1024px), where /map takes its laptop layout. */
const LAPTOP = '(min-width: 1024px)';
function useIsLaptop(): boolean {
  const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(LAPTOP) : null;
  const [is, setIs] = useState(() => query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = () => setIs(query.matches);
    query.addEventListener?.('change', on);
    return () => query.removeEventListener?.('change', on);
  }, [query]);
  return is;
}

/**
 * Ella map 12/13: one coffee's panel reads, once, for its button and its panel
 * (the public reads through useCoffeeDetail; withRoasterProfile is /map's).
 * `profile` is null until the roaster-profile read is back, so the button never
 * opens a half-read panel. A&B's cupping bars are not read here (/map shows the
 * roaster's ratings only).
 */
export function useMoreAbout(coffeeId: number, copy: Record<string, string>) {
  const { content, wheelRows, roasterProfile } = useCoffeeDetail(coffeeId, { withDimensions: false, withRoasterProfile: true, logTag: 'MapPage/more-about' });
  const profile: MapPanelProfile | null = roasterProfile ? {
    headings: {
      roasterWords: copy.roaster_words_title, whereItShines: copy.where_it_shines, notesHeading: copy.notes_heading, notes: copy.notes_title,
      roasterRates: copy.roaster_rates, roasterRatesCaption: copy.roaster_rates_caption,
    },
    whereItShines: roasterProfile.whereItShines, scale: roasterProfile.scale, ratings: roasterProfile.ratings,
  } : null;
  const hasMore = !!profile && content !== null && (
    !!content.threeVoiceStory || (profile.ratings.length > 0 && profile.scale > 0)
    || (wheelRows.length > 0 && profile.whereItShines.length > 0));
  return { coffeeId, content, wheelRows, profile, hasMore };
}
type MoreAboutData = ReturnType<typeof useMoreAbout>;

/** Ella map 12: the "More about this coffee" button (copy row more_about). */
export function MoreAboutButton({ label, open, onToggle, panelId }: { label: string; open: boolean; onToggle: () => void; panelId: string }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId} data-testid="more-about-button"
      className={`inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] font-semibold ${SOFT} min-h-[44px]`}>
      <span>{label}</span>
      <svg width="12" height="12" viewBox="0 0 18 18" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined }}>
        <path d="M9 3v12M3 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </button>
  );
}

/** Ella map 12/13: the Bloom page's own reveal panel (variant="field", G4.1), in the roaster's terms. */
export function MoreAboutPanel({ data, open, panelId }: { data: MoreAboutData; open: boolean; panelId: string }) {
  if (!data.profile) return null;
  return (
    <div className="bf-profile-stack bf-map-panel" style={PANEL_LOOK}>
      <RevealedPanel variant="field" panelId={panelId} isRevealed={open} archetype="" coffeeId={data.coffeeId} dialSortOrder={null}
        content={data.content} dimensions={[]} wheelRows={data.wheelRows} userArchetype={null}
        prelaunch hideProfileLink mapProfile={data.profile} />
    </div>
  );
}

/**
 * Ella map 12: "More about this coffee" and the shared reveal panel beneath the
 * card. Nothing shows until the coffee's reads say there is more to show.
 */
export function MoreAbout({ coffeeId, copy, open, onToggle }: { coffeeId: number; copy: Record<string, string>; open: boolean; onToggle: () => void }) {
  const data = useMoreAbout(coffeeId, copy);
  const panelId = useId();
  if (!data.hasMore || !copy.more_about) return null;
  return (
    <div className="mt-3" data-testid="more-about">
      <MoreAboutButton label={copy.more_about} open={open} onToggle={onToggle} panelId={panelId} />
      <MoreAboutPanel data={data} open={open} panelId={panelId} />
    </div>
  );
}

/** The price chip ("{price} · Add"): adds one bag to the cart, nothing else (Ella map 14). */
function PriceAdd({ price, copy, onAdd }: { price: MapPrice; copy: Record<string, string>; onAdd: () => void }) {
  return (
    <button type="button" onClick={onAdd} data-testid="price-add"
      className="mt-3 px-4 py-1.5 rounded-full text-sm font-semibold border" style={{ borderColor: TEAL, color: TEAL }}>
      {(copy.price_add ?? '{price}').replace('{price}', priceWords(price))}
    </button>
  );
}

/**
 * Ella map 9: the coffee's name, its composed text and the price chip. Ella map
 * 14: the chip only adds one bag; the name looks at the coffee (onLook). A
 * coffee with no price has no chip.
 */
export function StepCard({ step, copy, onAdd, onLook, open = false, onToggle = () => {} }: {
  step: MapStepCard; copy: Record<string, string>; onAdd: () => void;
  /** Ella map 14: look at this coffee (the page address ?at=); nothing is saved */
  onLook?: () => void;
  /** Ella map 12: this card's "More about this coffee" panel is the open one */
  open?: boolean; onToggle?: () => void;
}) {
  return (
    <div className={`rounded-xl bg-white border p-4 ${step.isLead ? 'border-[#2f6f68]' : 'border-[#e8e4dc]'} ${open ? 'lg:col-span-2' : ''}`} data-testid="step-card" data-lead={step.isLead ? '1' : '0'} data-open={open ? '1' : '0'}>
      <h3 className={`text-lg font-semibold ${INK}`} data-testid="step-coffee">
        {onLook
          ? <button type="button" onClick={onLook} data-testid="step-look" className="text-left underline decoration-[#e8e4dc] underline-offset-4 hover:decoration-[#2f6f68] min-h-[44px]">{step.name}</button>
          : step.name}
      </h3>
      <p className={`text-sm ${SOFT} mt-1`} data-testid="step-text">{step.text}</p>
      {step.price && <PriceAdd price={step.price} copy={copy} onAdd={onAdd} />}
      <MoreAbout coffeeId={step.coffeeId} copy={copy} open={open} onToggle={onToggle} />
    </div>
  );
}

/**
 * Ella map 13: the map and the top card. Below lg, one column as before, the
 * top card's panel inside the card; from lg, the map beside the card and the
 * open panel across the page under both.
 */
function TopRow({ face, data, copy, added, onAddFirstBag, open, onToggle, onLook, onBack }: {
  face: MapFaceData; data: MapSteps; copy: Record<string, string>; added: number | null;
  onAddFirstBag: (c: Parameters<typeof mapCartItem>[0]) => void; open: boolean; onToggle: () => void;
  /** Ella map 14: look at a coffee (its dot), and go back to the spot */
  onLook: (coffeeId: number) => void; onBack: () => void;
}) {
  const pos = data.position!;
  const more = useMoreAbout(pos.coffeeId, copy);
  const panelId = useId();
  const isLaptop = useIsLaptop();
  const showMore = more.hasMore && !!copy.more_about;
  // Ella map 10 (C1): the top card carries its label and its text whenever the customer has a quiz
  // (Founder's pick on a first match, "You are here" after a step); with no quiz, the notes as before.
  const top = data.firstBag ?? null;
  const topLabel = top?.labelCode ? copy[top.labelCode] ?? null : null;
  const looking = data.lookingAt === true;
  return (
    <>
      <div className="mb-6 lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start" data-testid="top-row">
        <div className="mb-5 lg:mb-0" data-testid="map-face">
          <EllaMapFace placements={face.placements} wedges={face.wedges} size="full" labelMode="name"
            highlightCoffeeId={data.spot?.coffeeId ?? pos.coffeeId} lookingAtCoffeeId={looking ? pos.coffeeId : null}
            startCoffeeId={data.startCoffeeId ?? null} onTapCoffee={onLook}
            arrowsTo={data.steps.map(s => s.coffeeId)} quietOthers />
        </div>

        <section className="rounded-xl bg-white border border-[#e8e4dc] p-5" data-testid="position-card">
          <div className="flex items-baseline justify-between gap-2">
            <p className={EYEBROW} style={{ color: TEAL }} data-testid="position-title" data-label={top?.labelCode ?? ''}>
              {topLabel ?? (pos.hasBag ? copy.here_title : copy.first_bag_title)}
            </p>
          </div>
          <h2 className={`text-2xl font-semibold ${INK} mt-1`} data-testid="position-name">{pos.name}</h2>
          {!top && pos.notes.length > 0 && <p className={`text-base ${INK} mt-1`}>{pos.notes.join(', ')}</p>}
          {top && (
            <p className={`text-sm ${SOFT} mt-2`} data-testid="first-bag-reason">{top.text ?? top.reason}</p>
          )}
          {!looking && <Price price={pos.price} />}
          {looking && pos.price && <div><PriceAdd price={pos.price} copy={copy} onAdd={() => onAddFirstBag(pos)} /></div>}
          {looking && data.spot?.backLine && (
            <div>
              <button type="button" onClick={onBack} data-testid="back-to-spot"
                className={`mt-3 text-sm font-semibold underline underline-offset-4 min-h-[44px]`} style={{ color: TEAL }}>
                {data.spot.backLine}
              </button>
            </div>
          )}
          {!looking && !pos.hasBag && pos.price && (
            <div>
              <button type="button" onClick={() => onAddFirstBag(pos)} data-testid="add-first-bag"
                className="mt-3 px-4 py-2 rounded-full text-sm font-medium text-white" style={{ background: TEAL }}>
                {copy.add_first_bag}
              </button>
            </div>
          )}
          {added === pos.coffeeId && <p className={`text-sm ${SOFT} mt-2`} data-testid="added-to-cart">{copy.added_to_cart}</p>}
          {showMore && (
            <div className="mt-3" data-testid="more-about">
              <MoreAboutButton label={copy.more_about} open={open} onToggle={onToggle} panelId={panelId} />
              {!isLaptop && <MoreAboutPanel data={more} open={open} panelId={panelId} />}
            </div>
          )}
        </section>
      </div>
      {showMore && isLaptop && open && (
        <div className="mb-6 rounded-xl bg-white border border-[#e8e4dc] px-6 pb-6" data-testid="top-panel-wide">
          <MoreAboutPanel data={more} open={open} panelId={panelId} />
        </div>
      )}
    </>
  );
}

export default function MapPage() {
  const apiFetch = useMapFetch();
  const [face, setFace] = useState<MapFaceData | null>(null);
  const [data, setData] = useState<MapSteps | null>(null);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<number | null>(null);
  // Ella map 14: the coffee looked at lives in the page address only (?at=)
  const [searchParams, setSearchParams] = useSearchParams();
  const atRaw = Number(searchParams.get('at'));
  const at = Number.isInteger(atRaw) && atRaw > 0 ? atRaw : null;
  // Ella map 12: the one open "More about this coffee" panel ('top' or 'step:<id>')
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const toggle = (key: string) => setOpenPanel(cur => (cur === key ? null : key));
  const { addToCart } = useCart();

  const load = useCallback(async () => {
    if (!apiFetch) return;
    try {
      const [f, s] = await Promise.all([getMapFace(apiFetch), getMapSteps(apiFetch, at)]);
      setFace(f); setData(s); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [apiFetch, at]);
  useEffect(() => { void load(); }, [load]);

  // Ella map 14: the chip adds one bag and nothing else; the map, the top card and the trail do not change.
  const choose = (step: MapStepCard) => {
    const line = mapCartItem(step);
    if (line) { addToCart(line); setAdded(step.coffeeId); }
  };
  /** Ella map 14: look at a coffee (its own spot clears ?at=); a new history entry, so back returns */
  const look = (coffeeId: number) => {
    setOpenPanel(null);
    setAdded(null);
    if (data?.spot && coffeeId === data.spot.coffeeId) setSearchParams({});
    else setSearchParams({ at: String(coffeeId) });
  };
  const back = () => { setOpenPanel(null); setAdded(null); setSearchParams({}); };
  const addFirstBag = (c: Parameters<typeof mapCartItem>[0]) => {
    const line = mapCartItem(c);
    if (line) { addToCart(line); setAdded(c.coffeeId); }
  };

  if (error && !data) return <main className="max-w-md mx-auto px-4 py-10"><p className={`text-sm ${SOFT}`} data-testid="map-error">{error}</p></main>;
  if (!data || !face) return <main className="max-w-md mx-auto px-4 py-10" />;
  const pos = data.position;
  const copy = data.copy;
  if (!pos) return <main className="max-w-md mx-auto px-4 py-10" data-testid="map-empty" />;
  const lead = data.steps.find(s => s.isLead) ?? null;
  const others = data.steps.filter(s => !s.isLead);

  return (
    <main className="max-w-md lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-10" style={{ fontFamily: 'Lato, sans-serif' }} data-testid="map-page">
      <p className={`${EYEBROW} ${SOFT}`}>{copy.map_eyebrow}</p>
      <h1 className={`text-3xl font-semibold ${INK} mt-1`} data-testid="map-title">{!pos.hasBag ? copy.map_title_first : copy.map_title_after}</h1>
      <p className={`text-sm ${SOFT} mt-2 mb-4 lg:mb-8 lg:max-w-2xl`}>{copy.map_intro}</p>

      <TopRow face={face} data={data} copy={copy} added={added} onAddFirstBag={addFirstBag}
        open={openPanel === 'top'} onToggle={() => toggle('top')} onLook={look} onBack={back} />

      <div className="lg:grid lg:grid-cols-2 lg:gap-6">
        {lead && (
          <section className="mb-6 lg:mb-0 lg:col-span-2" data-testid="lead-step">
            <p className={`${EYEBROW} ${SOFT} mb-3`} data-testid="lead-title">{copy.lead_title}</p>
            <StepCard step={lead} copy={copy} onAdd={() => choose(lead)} onLook={() => look(lead.coffeeId)}
              open={openPanel === `step:${lead.stepId}`} onToggle={() => toggle(`step:${lead.stepId}`)} />
          </section>
        )}
        {others.length > 0 && (
          <section className="lg:col-span-2" data-testid="steps">
            <p className={`${EYEBROW} ${SOFT} mb-3`} data-testid="others-title">{lead ? copy.others_title : copy.steps_title}</p>
            <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start" data-testid="steps-grid">
              {others.map(s => <StepCard key={s.stepId} step={s} copy={copy} onAdd={() => choose(s)} onLook={() => look(s.coffeeId)}
                open={openPanel === `step:${s.stepId}`} onToggle={() => toggle(`step:${s.stepId}`)} />)}
            </div>
          </section>
        )}
      </div>
      {error && <p className="text-sm text-[#a33726] mt-3">{error}</p>}

      <p className={`text-sm ${SOFT} text-center mt-8`} data-testid="closing-line">{copy.closing_line}</p>
    </main>
  );
}
