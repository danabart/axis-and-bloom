import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { Wrap, Caps, Titled, ArrowIcon } from '../../chrome';
import { FlowerWheel, stopOf, tOf, usePrefersReducedMotion } from '../wheel/FlowerWheel';
import { tints } from '../wheel/tints';
import { fieldLook } from '../dial/archetypeConfig';
import { DOORS_ENABLED } from '../doorConfig';
import { RevealedPanel } from '../RevealedPanel';
import { ComfortZoneAside } from './ComfortZoneAside';
import { useDialSlot, classicOf, collectionPct, arrivingSoonLine, numberWord } from '../useDialSlot';
import { useCheckoutRules, shippingCentsFor } from '../CartLines';
import { dialCartItem } from '../cartItems';
import { SlotShopCard, familyLookOf } from '../../shop/ShopCoffeeCard';
import { formatPrice, priceLabel } from '../types';
import type { SlotCard } from '../../../lib/api';
import type { DialArchetypeSectionProps } from '../DialArchetypeSection';
import './bloomField.css';

// Website 5 (2026-11-05): DialArchetypeSection layout="field", The Bloom's
// handoff page body for one family (source/bloom-b): the tinted field (the
// flower wheel left, the coffee in the middle, the comfort-zone aside right),
// the two-column reveal, then the lineup, the quick picks, whatever the page
// passes as `between` (the Other block), the door row and the quiz link.
// Every slot rule, save, add-to-cart and dial event is useDialSlot's (shared
// with the per-archetype dial); every word, name, price, count and end word is
// the payload's. The wheel's stops are the family's visible slots.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_5_THE_BLOOM.md, Part B

const pad2 = (n: number) => String(n).padStart(2, '0');

export function DialFieldLayout(props: DialArchetypeSectionProps) {
  const {
    data, cards, selectedSortOrder, revealedKeys, onDialSelect, onToggleReveal, onAddToCart, onCompare,
    userArchetype, source = 'bloom', hideProfileLink = false, prelaunch = false, onDoorClick, between, hideHints = false, hideQuizLink = false,
  } = props;
  const look = fieldLook(data.archetype);
  const reduced = usePrefersReducedMotion();
  const rules = useCheckoutRules();

  const slots = useMemo(() => [...data.slots].sort((a, b) => a.dialSortOrder - b.dialSortOrder), [data.slots]);
  const stops = slots.length;
  const { defaultSortOrder } = classicOf(data);
  const indexOf = (dialSortOrder: number) => {
    const i = slots.findIndex(s => s.dialSortOrder === dialSortOrder);
    if (i >= 0) return i;
    return Math.max(0, slots.findIndex(s => s.dialSortOrder === defaultSortOrder));
  };

  // The wheel opens on the selected stop (deep link, else saved, else the classic);
  // `t` follows it whenever it changes from outside (a tab, a deep link, a quick pick).
  const selectedIdx = indexOf(selectedSortOrder);
  const [t, setT] = useState(() => tOf(selectedIdx, stops));
  useEffect(() => { setT(tOf(selectedIdx, stops)); }, [selectedIdx, stops, data.archetype]);

  const liveIdx = stopOf(t, stops);
  const liveSlot = slots[liveIdx];
  const displaySortOrder = liveSlot?.dialSortOrder ?? selectedSortOrder;

  const ds = useDialSlot({ data, displaySortOrder, revealedKeys, source, onAddToCart, onDialSelect });
  const { currentSlot, cardData } = ds;
  const card: SlotCard | undefined = cards?.find(c => c.dialSortOrder === currentSlot.dialSortOrder);
  const hasCoffee = currentSlot.isActive && currentSlot.coffeeId != null;

  /** A settled turn: snap to the stop; a new stop is the dial's select (silent auto-save upstream). */
  function commit(value: number) {
    const i = stopOf(value, stops);
    setT(tOf(i, stops));
    const so = slots[i]?.dialSortOrder;
    if (so != null && so !== selectedSortOrder) onDialSelect(data.archetype, so);
  }

  if (!look || !stops) return null;
  const tt = tints(look.color);
  const fieldStyle = {
    ['--fam' as string]: look.color, ['--fink' as string]: look.ink,
    ['--accent' as string]: look.accent, ['--t40' as string]: tt[2],
  } as CSSProperties;

  const measure = data.dimensionPlatformName ?? data.dimensionName;
  const first = slots[0], last = slots[stops - 1];
  const stopLabels = slots.map((s, i) => `${i + 1} · ${s.positionLabel}`);
  const famNum = data.sortOrder != null ? pad2(data.sortOrder) : look.num;
  const words = data.customerWords ?? null;
  const notes = card?.signatureNotes ?? [];
  const spec: Array<[string, string]> = [];
  if (card?.bestBrew) spec.push(['Best brew', card.bestBrew]);
  if (card?.alsoGood?.length) spec.push(['Also good', card.alsoGood.join(', ')]);
  if (card?.milk) spec.push(['Milk', card.milk]);
  if (card?.leadsInCup) spec.push(['Leads in cup', card.leadsInCup]);
  if (card?.originRegion) spec.push(['Origin', card.originRegion]);

  const selectedPrice = cardData.selectedPrice;
  const shipping = selectedPrice ? shippingCentsFor(
    [dialCartItem(data, currentSlot, selectedPrice)].filter((x): x is NonNullable<typeof x> => !!x), rules,
  ) : null;
  const panelId = `bf-profile-${data.archetype}`;

  // the lineup: the payload's cards, or the slots themselves when /cards is unavailable
  const lineup: SlotCard[] = slots.map(s => cards?.find(c => c.dialSortOrder === s.dialSortOrder)
    ?? { ...s, archetype: data.archetype, archetypeLabel: data.archetypeLabel });
  const family = familyLookOf(data);
  const scrollToField = () => document.getElementById(data.archetype)
    ?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });

  const offer = data.collectionOffer;
  const { classicAvailable, defaultSlot } = ds;

  return (
    <>
      <section className="bf-field" id={data.archetype} style={fieldStyle} data-testid="bloom-field" data-archetype={data.archetype}>
        <Wrap>
          <div className="bf-intro">
            <h2 className="bf-h">Turn the dial.<br />Each stop is a coffee.</h2>
            <Caps weight={400}>{famNum} — {data.archetypeLabel}</Caps>
          </div>
          <div className="bf-dial">
            <div className="bf-dial-left">
              <FlowerWheel
                t={t}
                stops={stops}
                color={look.color}
                stopLabels={stopLabels}
                ariaLabel={`${data.archetypeLabel}${measure ? `: ${measure}` : ''}`}
                onChange={setT}
                onCommit={commit}
                meta={(
                  <Caps as="div" className="bf-row">
                    <span>{measure}</span>
                    <span style={{ fontWeight: 400 }} data-testid="stop-label">{stopLabels[liveIdx]}</span>
                  </Caps>
                )}
                foot={(
                  <>
                    {(data.dimensionScaleMinLabel || data.dimensionScaleMaxLabel) && (
                      <Caps as="div" weight={400} className="bf-ends">
                        <span>{data.dimensionScaleMinLabel}</span><span>{data.dimensionScaleMaxLabel}</span>
                      </Caps>
                    )}
                    {!hideHints && measure && stops > 1 && (
                      <div className="bf-hints" data-testid="wheel-hints">
                        <span>← Less {measure.toLowerCase()} · {first.positionLabel}</span>
                        <span>More {measure.toLowerCase()} · {last.positionLabel} →</span>
                      </div>
                    )}
                  </>
                )}
              />
            </div>

            <div className="bf-coffee">
              <Caps as="div" className="bf-row">
                <span>The coffee{card?.hasAward && <span style={{ fontWeight: 400 }} data-testid="premium"> · Premium ★</span>}</span>
                <span className="bf-stop" aria-hidden="true">{slots.map((s, i) => <i key={s.dialSortOrder} className={i <= liveIdx ? 'on' : undefined} />)}</span>
              </Caps>
              {words && words.length > 0 && <span className="bf-words">{words.join(' · ')}</span>}
              <h3 className="bf-name" data-testid="coffee-name">{currentSlot.platformName ?? currentSlot.positionLabel}</h3>
              <div className="bf-sigblock">
                {notes.length > 0 && (
                  <>
                    <Titled style={{ alignSelf: 'flex-start' }}>Signature notes</Titled>
                    <p className="bf-sig">{notes.join(', ')}</p>
                  </>
                )}
                {notes.length === 0 && (!hasCoffee || !cardData.hasVoiceRows) && <p className="bf-hint">{arrivingSoonLine(data.archetypeLabel)}</p>}
                {card?.hint && <p className="bf-hint">{card.hint}</p>}
                {spec.length > 0 && (
                  <dl className="bf-spec">
                    {spec.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
                  </dl>
                )}
              </div>

              <div className="bf-commerce" data-testid="commerce">
                {!hasCoffee ? (
                  <Caps weight={400} data-testid="state">Coming soon</Caps>
                ) : cardData.isUnpriced ? (
                  <Caps weight={400} data-testid="state">Price coming</Caps>
                ) : !cardData.effectivelyActive ? (
                  <Caps weight={400} data-testid="state">Temporarily unavailable</Caps>
                ) : (
                  <>
                    {cardData.availableWeights.length > 1 && (
                      <div className="bf-chips" role="group" aria-label="Bag size">
                        {cardData.availableWeights.map(p => (
                          <button key={p.weightOz} type="button" className="ab-caps bf-chip" aria-pressed={cardData.selectedWeight === p.weightOz}
                            onClick={() => cardData.setSelectedWeight(p.weightOz)}>
                            {priceLabel(p)} · {formatPrice(p.retailPriceCents)}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="bf-buy">
                      {!prelaunch && (
                        <button type="button" className="ab-caps bf-btn" onClick={ds.handleAddToCart} disabled={!selectedPrice} data-testid="add-to-cart">
                          Add to cart{selectedPrice ? ` · ${formatPrice(selectedPrice.retailPriceCents)}` : ''}
                        </button>
                      )}
                      {selectedPrice && <Caps weight={400}>{priceLabel(selectedPrice)} whole bean</Caps>}
                    </div>
                    {shipping != null && rules && (
                      <Caps weight={400} className="bf-ship">
                        {shipping === 0 ? 'Free shipping' : `Free shipping with ${rules.freeShippingMinBags} bags`}
                      </Caps>
                    )}
                  </>
                )}
                {ds.user && !ds.isPlaceholder && (
                  <div className="bf-quiet">
                    <button type="button" className="ab-caps bf-ulink" onClick={ds.handleExplicitSave} disabled={ds.isSaved} data-testid="save">
                      {ds.isSaved ? 'Saved to flavor memory ✓' : 'Save to flavor memory'}
                    </button>
                    {ds.isSaved && <Link to="/profile?tab=memory" className="ab-caps bf-ulink">View in flavor memory ↗</Link>}
                  </div>
                )}
              </div>

              {ds.showReveal && (
                <button type="button" className="ab-caps bf-reveal" aria-expanded={ds.isRevealed} aria-controls={panelId}
                  onClick={() => onToggleReveal(ds.currentKey)} data-testid="reveal">
                  <span>{ds.isRevealed ? 'Hide the full profile' : 'Reveal the full profile'}</span>
                  <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 3v12M3 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
                </button>
              )}
            </div>

            <ComfortZoneAside archetype={data.archetype} userArchetype={userArchetype} coffeeId={hasCoffee ? currentSlot.coffeeId : null} prelaunch={prelaunch} />
          </div>

          <RevealedPanel
            key={ds.currentKey}
            variant="field"
            panelId={panelId}
            isRevealed={ds.isRevealed}
            archetype={data.archetype}
            coffeeId={hasCoffee ? currentSlot.coffeeId : null}
            dialSortOrder={currentSlot.dialSortOrder}
            content={cardData.content}
            dimensions={cardData.dimensions}
            wheelRows={cardData.wheelRows}
            userArchetype={userArchetype}
            hideProfileLink={hideProfileLink}
            prelaunch={prelaunch}
            onCompare={cardData.effectivelyActive ? () => onCompare(data.archetype, data.archetypeLabel, currentSlot) : undefined}
          />
        </Wrap>
      </section>

      <section className="bf-lineup" aria-label={`The ${data.archetypeLabel} coffees`}>
        <Wrap>
          <div className="bf-lineup-head">
            <Titled style={{ alignSelf: 'flex-start' }} data-testid="lineup-label">
              The {numberWord(stops).toLowerCase()} {data.archetypeLabel} coffees
            </Titled>
            {data.dimensionScaleMinLabel && data.dimensionScaleMaxLabel && (
              <h2 className="bf-h">From {data.dimensionScaleMinLabel} to {data.dimensionScaleMaxLabel}.</h2>
            )}
          </div>
          <div className="bf-cards">
            {lineup.map((c, i) => (
              <SlotShopCard
                key={c.dialSortOrder}
                family={family}
                card={c}
                gated={prelaunch}
                source={source ?? 'bloom'}
                compact
                selected={i === liveIdx}
                onSelect={() => { commit(tOf(i, stops)); scrollToField(); }}
              />
            ))}
          </div>

          {!prelaunch && (classicAvailable || offer) && (
            <div className="bf-qp" data-testid="quick-picks">
              <Caps weight={400}>Quick picks</Caps>
              {classicAvailable && defaultSlot && (
                <button type="button" className="bf-qp-row" onClick={() => ds.handleClassicAdd()}>
                  <span>The {data.archetypeLabel} classic · {defaultSlot.platformName}</span>
                  <span className="ab-caps">Add to cart <ArrowIcon /></span>
                </button>
              )}
              {offer && (
                <button type="button" className="bf-qp-row" onClick={ds.handleCollectionAdd}>
                  <span>The {data.archetypeLabel} Collection · {offer.memberCount} coffees · {collectionPct(offer)}% off · {formatPrice(offer.discountedCents)}</span>
                  <span className="ab-caps">Add the collection <ArrowIcon /></span>
                </button>
              )}
            </div>
          )}

          {between}

          {/* Doors (S1, Dana 2026-11-05): drawn here, shown only when the Part 23 kill switch is on. */}
          {DOORS_ENABLED && data.doors && onDoorClick && (
            <div className="bf-doors" data-testid="doors">
              <button type="button" className="ab-caps bf-btn" onClick={() => onDoorClick(data.archetype, 'left', data.doors!.left)}>
                ← Turn the {data.doors.left.archetypeLabel} dial
              </button>
              <button type="button" className="ab-caps bf-btn" onClick={() => onDoorClick(data.archetype, 'right', data.doors!.right)}>
                Turn the {data.doors.right.archetypeLabel} dial →
              </button>
            </div>
          )}

          {!hideQuizLink && (
            <div className="bf-quiz">
              <Link to="/find-my-flavor" className="ab-caps bf-ulink">Not sure which family is yours? Take the quiz ↗</Link>
            </div>
          )}
        </Wrap>
      </section>
    </>
  );
}

