import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { setDialPosition } from '../../lib/api';
import { BloomDial, type BloomDialHandle } from './dial/BloomDial';
import { buildDialConfig } from './dial/archetypeConfig';
import { computeDefaultSortOrder } from './ArchetypeSection';
import { RevealedPanel } from './RevealedPanel';
import { DoorBand } from './DoorBand';
import { usePositionCardData } from './usePositionCardData';
import type { ArchetypeData, CartItem, DoorTarget, Slot } from './types';
import { slotKey, formatPrice, formatWeight } from './types';

// Part 21 — small-number spellout for the /bloom why-line ("Four {Archetype}
// coffees live here..."); falls back to the numeral itself past Ten (never
// happens today — every archetype has exactly 4 — but the prompt's own
// "when a slot count != 4, use the real count" means this must hold for any
// real value, not just the current one).
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/**
 * The Bloom Part 12 — unified archetype section built on Camila's Bloom Dial
 * (brief 33), restoring the commerce/reveal/save-to-memory layer that lived in
 * the pre-33 ArchetypeSection/PositionCard/RevealedPanel trio. Prop surface
 * matches the old ArchetypeSection exactly so every call site is a one-line
 * swap; `index` is accepted for compatibility but unused (no more flip/eager
 * layout — the dial owns its own presentation).
 */
export function DialArchetypeSection({
  data, selectedSortOrder, revealedKeys, onDialSelect, onToggleReveal, onAddToCart, onCompare,
  userArchetype, registerDialRef, source = null, hideProfileLink = false, embedded = false, onDoorClick,
  folded = false, ceremonyTag = 'YOUR SPOT', unfoldMode = 'inline', showBreakoutHeader = true, prelaunch = false,
}: {
  data: ArchetypeData;
  index: number;
  selectedSortOrder: number;
  revealedKeys: Set<string>;
  onDialSelect: (archetype: string, dialSortOrder: number) => void;
  onToggleReveal: (key: string) => void;
  onAddToCart: (item: CartItem) => void;
  onCompare: (archetype: string, archetypeLabel: string, slot: Slot) => void;
  userArchetype: string | null;
  registerDialRef: (archetype: string, handle: BloomDialHandle | null) => void;
  source?: 'bloom' | 'find_my_flavor_returning' | 'find_my_flavor_results' | 'profile' | null;
  hideProfileLink?: boolean;
  /** Compact variant for embedded contexts (quiz screens, Profile). */
  embedded?: boolean;
  /** Part 19 §A — bubbled straight through to BloomDial's own onDoorClick; the
   * parent (Bloom page vs Profile/quiz) decides how to travel, since only it
   * knows about the other archetype sections/adjacent-section mechanism. */
  onDoorClick?: (archetype: string, edge: 'left' | 'right', target: DoorTarget) => void;
  /** Part 21 — folds the dial by default: match card (showing the archetype's
   * classic coffee) + door band, no dial visible, until the user explicitly
   * unfolds it. /bloom passes nothing (default false) — every folded-specific
   * branch below is gated on this, so /bloom is completely unaffected. Quiz
   * results/returning + Profile pass `folded` on their PRIMARY archetype
   * block only; the "Worth Exploring" adjacent section stays unfolded, since
   * opening it at all is already an explicit choice. */
  folded?: boolean;
  /** Part 21 — needle-ceremony tag text, shown once (then live-tracked
   * whenever the dial rests there again) above the needle after the FIRST
   * unfold — only when this surface's selected position actually differs
   * from the classic; otherwise the ceremony is skipped entirely per spec
   * ("no personal position, nothing to celebrate"). Quiz surfaces pass
   * "YOUR SPOT · FROM YOUR QUIZ"; Profile keeps the default "YOUR SPOT". */
  ceremonyTag?: string;
  /** Part 22 — passed straight through to BloomDial's own `unfoldMode` (see
   * that prop's own doc for the full mechanism). `'inline'` (default,
   * Part 21's original behavior) for every existing folded surface (quiz
   * results/returning kept theirs unchanged per the prompt's own scope);
   * `'breakout'` for Profile's primary block and Find My Flavor returning's
   * primary block, both now living in a one-column page layout. */
  unfoldMode?: 'inline' | 'breakout';
  /** Part 22 — only meaningful with unfoldMode="breakout": whether to render
   * the archname+NO. row above the block (mockup's `.archhead`). Profile's
   * compact intro has no archetype-name display of its own, so the block
   * needs to supply one (default true). Find My Flavor returning's own
   * compact header (§4 item 1) ALREADY shows the archetype name prominently
   * — a second one right above the block would duplicate it — so that call
   * site passes `false`. */
  showBreakoutHeader?: boolean;
  /** Pre-Launch Gate — hides Add to Cart (main button + Quick Picks), and
   * threads through to RevealedPanel to hide the Liam/flavor-intelligence
   * footer links. Dial, position card, and reveal panel content all stay —
   * only commerce and doors into hidden routes are removed. Default false;
   * every call site derives this from lib/prelaunch.ts's usePrelaunchGated(),
   * the same source of truth the route guard uses, so `?preview=true`
   * restores the full component for the team. */
  prelaunch?: boolean;
}) {
  const { user } = useAuth();
  const config = buildDialConfig(data);
  // Part 19 §B — a local handle to THIS dial (in addition to forwarding one up
  // via registerDialRef) so "the classic" CTA can turn the dial itself as
  // feedback, without needing the parent to plumb a lookup back down.
  const dialRef = useRef<BloomDialHandle | null>(null);
  if (!config) return null;

  // Part 19 §B / Part 21 match mode — the archetype's DEFAULT (classic)
  // position, resolved once and reused by the Quick Picks classic CTA, the
  // folded match card, and the needle ceremony's "does this surface even
  // have a personal position worth celebrating" check.
  //
  // Only trust isDefault when EXACTLY ONE slot carries it — same hardening
  // philosophy as computeStopPositions (Part 17 §E): an archetype with two
  // conflicting isDefault=true rows (chocolate_nutty, still unresolved DB
  // data — see WHAT_WE_BUILT.md #145) is a data problem, not something to
  // pick a "first match" default from. Naively taking data.slots.find(s =>
  // s.isDefault) here would have picked chocolate_nutty's UNPRICED
  // dialSortOrder-1 row over its real, priced dialSortOrder-2 default —
  // caught live during Part 19's own QA.
  const isDefaultSlots = data.slots.filter(s => s.isDefault);
  const defaultSlot = isDefaultSlots.length === 1
    ? isDefaultSlots[0]
    : data.slots.find(s => s.dialSortOrder === computeDefaultSortOrder(data));
  const defaultSortOrder = defaultSlot?.dialSortOrder ?? computeDefaultSortOrder(data);
  const defaultPrice = defaultSlot?.prices.find(p => p.weightOz === 12) ?? defaultSlot?.prices[0];
  const classicAvailable = !!(defaultSlot && defaultSlot.isActive && defaultSlot.platformName && defaultPrice);

  // Part 21 — fold/unfold state. Purely local: each mount of this component
  // (one per surface) owns its own fold state; nothing here persists across
  // navigations, which the prompt never asked for. `isOpen` starts true (and
  // stays irrelevant) when `folded` is false, so /bloom never touches any of
  // this. `everOpened` — not `isOpen` — decides card content mode below: once
  // the user has unfolded even once, folding back shows whatever's actually
  // selected, never resets to the classic (§2.4, "the card never lies").
  const [isOpen, setIsOpen] = useState(!folded);
  const [everOpened, setEverOpened] = useState(!folded);
  const [showCeremonyTag, setShowCeremonyTag] = useState(false);

  // Part 21 — the needle ceremony. Fires once, on the FIRST isOpen:false->true
  // transition (guarded by `everOpened`). A short delay lets the field's own
  // reveal transition (width/max-height, in BloomDial's CSS) get underway
  // before the needle starts moving — flipping `everOpened` is what actually
  // moves it: BloomDial's initialDialSortOrder prop changes from
  // defaultSortOrder to selectedSortOrder in the same render (see
  // dialInitialSortOrder below), and BloomDial's own existing "externally
  // changed position" effect animates that via its normal 560ms CSS
  // transition — no imperative rotateTo() call needed here at all. The tag
  // fade-in is a second, longer delay so it visibly follows the settle
  // rather than fighting it. Skipped entirely (no timers, no tag) when this
  // surface's selected position IS the classic — nothing personal to
  // celebrate, the needle simply rests there already.
  useEffect(() => {
    if (!folded || !isOpen || everOpened) return;
    const t1 = setTimeout(() => {
      setEverOpened(true);
      if (selectedSortOrder !== defaultSortOrder) {
        setTimeout(() => setShowCeremonyTag(true), 750);
      }
    }, 350);
    return () => clearTimeout(t1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Part 21 §2.1/§2.4 — match mode: while folded and never yet opened, the
  // card always shows the CLASSIC regardless of `selectedSortOrder`. Once
  // unfolded (everOpened), it's the real selected position forever after —
  // "ON THE DIAL NOW", exactly like /bloom, even after folding back.
  const matchMode = folded && !everOpened;
  const displaySortOrder = matchMode ? defaultSortOrder : selectedSortOrder;

  // Synthetic slot for placeholders (hooks must run unconditionally) — a dial
  // position with no resolved catalogue slot at all, distinct from a real slot
  // that's merely inactive/unpriced.
  const realSlot = data.slots.find(s => s.dialSortOrder === displaySortOrder);
  const isPlaceholder = !realSlot;
  const currentSlot: Slot = realSlot ?? {
    dialSortOrder: displaySortOrder,
    positionLabel: '',
    description: null,
    isActive: false,
    platformName: null,
    isDefault: false,
    prices: [],
    coffeeId: null,
  };
  const currentKey = slotKey(data.archetype, currentSlot.dialSortOrder);
  const isRevealed = revealedKeys.has(currentKey);

  // Shared fetch/derived state for this position — one fetch, used by both the
  // commerce controls below and the full-width RevealedPanel underneath. In
  // match mode this is the CLASSIC's data (currentSlot is the classic then),
  // so "Reveal the full profile" folded shows the classic's profile — never
  // whatever position the user happens to be personally matched to but
  // hasn't looked at yet.
  const cardData = usePositionCardData(currentSlot, data.archetype, isRevealed);

  // "Save to my flavor memory" — signed-in + a real (non-placeholder) slot only.
  const [savedKey, setSavedKey] = useState<string | null>(null);
  useEffect(() => { setSavedKey(null); }, [currentKey]);

  function handleExplicitSave() {
    if (!user) return;
    setDialPosition(data.archetype, currentSlot.dialSortOrder, {
      trigger: 'explicit_save', source, coffeeId: currentSlot.coffeeId, platformName: currentSlot.platformName,
    })
      .then(() => setSavedKey(currentKey))
      .catch(() => {});
  }

  function handleAddToCart() {
    if (!currentSlot.platformName || !cardData.selectedPrice) return;
    const item: CartItem = {
      kind: 'dial',
      archetype: data.archetype,
      archetypeLabel: data.archetypeLabel,
      dialSortOrder: currentSlot.dialSortOrder,
      weightOz: cardData.selectedPrice.weightOz,
      platformName: currentSlot.platformName,
      retailPriceCents: cardData.selectedPrice.retailPriceCents,
      qty: 1,
    };
    onAddToCart(item);
    if (user) {
      setDialPosition(data.archetype, currentSlot.dialSortOrder, {
        trigger: 'add_to_cart', source, coffeeId: currentSlot.coffeeId,
      }).catch(() => {});
    }
  }

  function handleClassicAdd() {
    if (!defaultSlot || !defaultPrice || !defaultSlot.platformName) return;
    const item: CartItem = {
      kind: 'dial',
      archetype: data.archetype,
      archetypeLabel: data.archetypeLabel,
      dialSortOrder: defaultSlot.dialSortOrder,
      weightOz: defaultPrice.weightOz,
      platformName: defaultSlot.platformName,
      retailPriceCents: defaultPrice.retailPriceCents,
      qty: 1,
    };
    onAddToCart(item);
    // Turn the dial to the default position as feedback — same snap animation
    // as any other settle, via the imperative handle this component keeps a
    // local copy of specifically for this.
    dialRef.current?.rotateTo(defaultSlot.dialSortOrder);
    onDialSelect(data.archetype, defaultSlot.dialSortOrder);
    if (user) {
      setDialPosition(data.archetype, defaultSlot.dialSortOrder, {
        trigger: 'add_to_cart', source, coffeeId: defaultSlot.coffeeId,
      }).catch(() => {});
    }
  }

  // Part 19 §C — "the collection": data.collectionOffer is already the
  // backend-computed, backend-verified-at-order-time preview (null when fewer
  // than 3 positions are purchasable — the CTA's own hide condition). No
  // client-side discount math anywhere in this component.
  function handleCollectionAdd() {
    if (!data.collectionOffer) return;
    const item: CartItem = {
      kind: 'collection',
      archetype: data.archetype,
      archetypeLabel: data.archetypeLabel,
      memberCount: data.collectionOffer.memberCount,
      retailPriceCents: data.collectionOffer.discountedCents,
      undiscountedPriceCents: data.collectionOffer.sumCents,
      qty: 1,
    };
    onAddToCart(item);
  }

  const showReveal = currentSlot.coffeeId != null && currentSlot.isActive;

  // Part 21 — /bloom-only copy layer (§4). Both null on every folded/embedded
  // surface — computed here (not in BloomDial) since both need data this
  // component already has (userArchetype, data.slots/dimension labels) that
  // BloomDial itself never sees.
  const isBloomSurface = !folded && !embedded;
  const kicker = (isBloomSurface && user)
    ? (userArchetype === data.archetype ? 'YOUR' : (userArchetype ? 'TO EXPLORE' : null))
    : null;
  const whyLine = (isBloomSurface && data.dimensionScaleMinLabel && data.dimensionScaleMaxLabel)
    ? `${numberWord(data.slots.length)} ${data.archetypeLabel} coffees live here, from ${data.dimensionScaleMinLabel.toLowerCase()} to ${data.dimensionScaleMaxLabel.toLowerCase()}.`
    : null;

  // Part 20 — Zone 2 (the coffee card) + Zone 3 (quick picks), replacing the
  // ~12-line stack this column used to be with three real zones (see
  // PROMPT_commerce_column_redesign.md / commerce-column-redesign.html,
  // "Proposed · 38/62"). Zone 1 (identity: YOUR/title/NO.) lives one level up,
  // in BloomDial.tsx's bd-namelock — this component owns everything from the
  // card down. Compare's visibility mirrors its old gating exactly
  // (cardData.effectivelyActive only); Save's mirrors its old gating exactly
  // (signed-in + !isPlaceholder) — unified into one quiet row per the
  // mockup, but neither button's OWN visibility rule changed.
  //
  // Part 21 — when folded and still closed, Zone 3 (quick picks) is replaced
  // by the door band (§2.2); the card's micro-label switches to "THE
  // {ARCHETYPE} CLASSIC" in match mode.
  const bottomContent = (
    <div style={{ marginTop: 18 }}>
      <div className="bd-card">
        <div className="bd-card-main">
          <div className="bd-card-headrow">
            <img className="bd-card-bag" src={config.bag} alt={`${data.archetypeLabel} bag`} draggable={false} />
            <div style={{ minWidth: 0 }}>
              <p className="bd-card-microlabel">{matchMode ? `The ${data.archetypeLabel} classic` : 'On the dial now'}</p>
              <p className="bd-card-name">{currentSlot.platformName ?? 'Coming soon'}</p>
            </div>
          </div>

          <p className="bd-card-teaser">
            {(!isPlaceholder && cardData.effectivelyActive && cardData.teaser)
              ? cardData.teaser
              : `A ${data.archetypeLabel} coffee for this turn of the dial. Its full tasting notes are arriving soon.`}
          </p>

          {isPlaceholder ? (
            <span className="bd-card-status">Coming soon</span>
          ) : !cardData.effectivelyActive ? (
            <span className="bd-card-status">{cardData.isUnpriced ? 'Unpriced' : 'Temporarily unavailable'}</span>
          ) : (
            <>
              <div className="bd-card-pricerow">
                {cardData.availableWeights.length > 1 ? (
                  cardData.availableWeights.map(p => {
                    const selected = cardData.selectedWeight === p.weightOz;
                    return (
                      <button
                        key={p.weightOz}
                        type="button"
                        className={`bd-card-weight ${selected ? 'sel' : 'un'}`}
                        onClick={() => cardData.setSelectedWeight(p.weightOz)}
                      >
                        {formatWeight(p.weightOz)} · {formatPrice(p.retailPriceCents)}
                      </button>
                    );
                  })
                ) : cardData.selectedPrice ? (
                  <span className="bd-card-weight sel" style={{ cursor: 'default' }}>
                    {formatWeight(cardData.selectedPrice.weightOz)} · {formatPrice(cardData.selectedPrice.retailPriceCents)}
                  </span>
                ) : null}
                <span className="bd-card-ship">shipping included</span>
              </div>

              {!prelaunch && (
                <button className="bd-card-atc" type="button" onClick={handleAddToCart} disabled={!cardData.selectedPrice}>
                  ADD TO CART&nbsp;&nbsp;→
                </button>
              )}
            </>
          )}

          {!isPlaceholder && (cardData.effectivelyActive || user) && (
            <div className="bd-card-quietrow">
              {cardData.effectivelyActive && (
                <button type="button" onClick={() => onCompare(data.archetype, data.archetypeLabel, currentSlot)}>
                  ⇄ Compare
                </button>
              )}
              {user && (
                <button type="button" onClick={handleExplicitSave} disabled={savedKey === currentKey}>
                  {savedKey === currentKey ? 'Saved ✓' : 'Save to my flavor memory'}
                </button>
              )}
            </div>
          )}
          {savedKey === currentKey && (
            <Link to="/profile?tab=memory" className="bd-card-saved-link">
              View in your flavor memory →
            </Link>
          )}
        </div>

        {/* Part 23 §E — the toggle already closed the panel on click
            (onToggleReveal always flips isRevealed); the only real gap was
            the label reading the bare "Collapse" instead of the full
            "Collapse the profile" counterpart to "Reveal the full profile"
            — same row, same style, one shared component, so this one
            label change covers every surface (Profile, quiz screens,
            /find-my-flavor, and /bloom, which shares this exact code
            path) at once. */}
        {showReveal && (
          <button type="button" className="bd-card-reveal" onClick={() => onToggleReveal(currentKey)}>
            <span>{isRevealed ? 'Collapse the profile' : 'Reveal the full profile'}</span>
            <span>{isRevealed ? '↑' : '↓'}</span>
          </button>
        )}
      </div>

      {folded && !isOpen ? (
        <DoorBand
          archetypeLabel={data.archetypeLabel}
          color={config.color}
          ftext={config.ftext}
          onClick={() => setIsOpen(true)}
        />
      ) : (
        /* Zone 3 — quick picks. Naming decision (Dana, 2026-08-08): "The
           {Archetype} classic" and "The {Archetype} Collection" everywhere,
           never a bare "classic" or "set". Shown once unfolded too, same as
           /bloom — folding doesn't remove commerce options, only the field.
           Pre-Launch Gate: both rows are Add to Cart variants, so the whole
           block is hidden while gated, same as the main ATC button above. */
        !prelaunch && (classicAvailable || data.collectionOffer) && (
          <div className="bd-qp">
            <p className="bd-qp-label">Quick picks</p>
            {classicAvailable && (
              <button type="button" className="bd-qp-row" onClick={handleClassicAdd}>
                <span className="bd-qp-what">The {data.archetypeLabel} classic — {defaultSlot!.platformName}</span>
                <span className="bd-qp-act">Add to cart →</span>
              </button>
            )}
            {data.collectionOffer && (
              <button type="button" className="bd-qp-row" onClick={handleCollectionAdd}>
                <span className="bd-qp-what">
                  The {data.archetypeLabel} Collection <em>· {data.collectionOffer.memberCount} coffees — 10% off</em>
                </span>
                <span className="bd-qp-act">Add the collection →</span>
              </button>
            )}
          </div>
        )
      )}
    </div>
  );

  // Part 21 §2.4 — the fold-back control, only present once open. Rendered
  // via BloomDial's fieldOverlay slot (top-right of the field).
  const fieldOverlay = folded && isOpen ? (
    <button type="button" className="bd-field-fold" onClick={() => setIsOpen(false)}>
      Fold the dial&nbsp;↑
    </button>
  ) : undefined;

  // Part 21 — the needle-ceremony config passed to BloomDial: only non-null
  // once unfolded AND this surface actually has a personal position distinct
  // from the classic (the "skip the ceremony" edge case otherwise).
  const ceremony = (folded && everOpened && selectedSortOrder !== defaultSortOrder)
    ? { dialSortOrder: selectedSortOrder, text: ceremonyTag, revealed: showCeremonyTag }
    : null;

  // Part 21 — while folded and still closed, the dial itself rests on the
  // CLASSIC (matching the match card) rather than the real selected
  // position; the moment `everOpened` flips (see the effect above), this
  // switches to `selectedSortOrder` in the same render, and BloomDial's own
  // existing "externally changed position" effect animates the move — the
  // needle ceremony, with no new imperative code needed for the motion itself.
  const dialInitialSortOrder = matchMode ? defaultSortOrder : selectedSortOrder;

  const belowStagePaddingX = embedded ? 0 : 'clamp(32px, 6vw, 96px)';
  const belowStage = (
    <div style={{ paddingLeft: belowStagePaddingX, paddingRight: belowStagePaddingX }}>
      <RevealedPanel
        key={currentKey}
        isRevealed={isRevealed}
        archetype={data.archetype}
        dialSortOrder={currentSlot.dialSortOrder}
        content={cardData.content}
        dimensions={cardData.dimensions}
        wheelRows={cardData.wheelRows}
        userArchetype={userArchetype}
        hideProfileLink={hideProfileLink}
        prelaunch={prelaunch}
      />
    </div>
  );

  // Part 22 — breakout's external archname+NO. header (mockup's .archhead),
  // rendered ABOVE the section entirely so it never participates in the
  // breakout width transition — it stays at column width whether the block
  // below it is folded or broken out. Only ever shown alongside `folded`
  // (unfoldMode is meaningless otherwise); BloomDial itself suppresses its
  // own internal identity lockup in this same mode, so the two never
  // duplicate or disagree (see BloomDial.tsx's `isBreakout`).
  const renderBreakoutHeader = folded && unfoldMode === 'breakout' && showBreakoutHeader;

  return (
    <>
      {renderBreakoutHeader && (
        <div className="bd-breakout-archhead">
          <span className="bd-breakout-archname">{data.archetypeLabel}</span>
          <span className="bd-breakout-archno">NO. {config.no}</span>
        </div>
      )}
      <BloomDial
        ref={h => { dialRef.current = h; registerDialRef(data.archetype, h); }}
        config={config}
        initialDialSortOrder={dialInitialSortOrder}
        onZoneChange={n => onDialSelect(data.archetype, n)}
        bottomContent={bottomContent}
        belowStage={belowStage}
        embedded={embedded}
        kicker={kicker}
        folded={folded}
        matchMode={matchMode}
        dialOpen={isOpen}
        fieldOverlay={fieldOverlay}
        ceremony={ceremony}
        whyLine={whyLine}
        unfoldMode={unfoldMode}
        onDoorClick={onDoorClick ? (edge, target) => onDoorClick(data.archetype, edge, target) : undefined}
      />
    </>
  );
}
