import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { Caps, Titled } from '../chrome';
import { Photo, type RegistryImage } from '../home/Photo';
import { formatPrice } from '../bloom/types';
import type { SlotPrice } from '../bloom/types';
import { useSlotAvailability } from '../bloom/useSlotAvailability';
import { dialCartItem, directCartItem, syncDialAddToCart } from '../bloom/cartItems';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import type { SlotCard, OtherCard, CardPresentation } from '../../lib/api';
import { optimizedAsset, archetypeAssets, shopAssets, lifestyleAssets, type ArchetypeSlug } from '../../../design/assets';
import { ARCHETYPE_VISUALS } from '../bloom/bloomVisuals';
import './shop.css';

// Website 4 (2026-11-05) — Shop all's coffee card, built once (G4.1). The look
// is the handoff's `.card` (source/shop/build.py); every value is the
// /api/coffees/cards payload (brief 2). A row whose value is absent is left
// out, never a placeholder (D9). No roaster or award name reaches the DOM:
// the award is a boolean shown as "Premium ★" (D12, G4.5).
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_4_SHOP_ALL.md

export type CardState = 'buy' | 'unpriced' | 'soon';

export interface ShopCoffeeCardProps {
  /** family colour (hover fill) and the text colour on it */
  color: string;
  plateInk: string;
  photo: { asset: RegistryImage; fallback: RegistryImage };
  premium: boolean;
  /** top-right caps label: "2 · Classic" for a slot, the category for an Other coffee */
  stopLabel: string;
  words: string[] | null;
  name: string;
  presentation: Partial<CardPresentation>;
  state: CardState;
  prices: Pick<SlotPrice, 'weightOz' | 'retailPriceCents'>[];
  selectedWeight: number | null;
  onSelectWeight: (weightOz: number) => void;
  onAdd: () => void;
  /** the coffee's full profile (Flavor Intelligence); absent for a slot with no coffee */
  profileHref: string | null;
  gated: boolean;
  /** Website 5 (The Bloom lineup): no photo, no words, no hint, no spec rows. */
  compact?: boolean;
  /** Website 5: the card the dial is on (the handoff's `.card.on`). */
  selected?: boolean;
  /** Website 5: clicking (or Enter/Space on) the card turns the dial to it; its buttons and links keep their own action. */
  onSelect?: () => void;
}

export function ShopCoffeeCard(p: ShopCoffeeCardProps) {
  const style = { ['--c' as string]: p.color, ['--ink' as string]: p.plateInk } as CSSProperties;
  const own = (e: { target: EventTarget | null; currentTarget: EventTarget }) =>
    !(e.target as HTMLElement | null)?.closest?.('button, a') || e.target === e.currentTarget;
  const select = p.onSelect ? {
    role: 'button' as const,
    tabIndex: 0,
    'aria-pressed': !!p.selected,
    'aria-label': `Turn the dial to ${p.name}`,
    onClick: (e: MouseEvent) => { if (own(e)) p.onSelect!(); },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      p.onSelect!();
    },
  } : {};
  const pres = p.presentation;
  const selected = p.prices.find(x => x.weightOz === p.selectedWeight) ?? p.prices[0];
  const spec: Array<[string, string]> = [];
  if (pres.bestBrew) spec.push(['Best brew', pres.bestBrew]);
  if (pres.alsoGood && pres.alsoGood.length) spec.push(['Also good', pres.alsoGood.join(', ')]);
  if (pres.milk) spec.push(['Milk', pres.milk]);
  if (pres.leadsInCup) spec.push(['Leads in cup', pres.leadsInCup]);
  if (pres.originRegion) spec.push(['Origin', pres.originRegion]);

  return (
    <article
      className={`sh-card${p.state === 'soon' ? ' is-soon' : ''}${p.compact ? ' is-compact' : ''}${p.selected ? ' on' : ''}${p.onSelect ? ' is-select' : ''}`}
      style={style} data-testid="shop-card" data-state={p.state} {...select}
    >
      {!p.compact && <Photo asset={p.photo.asset} fallback={p.photo.fallback} alt="" sizes="(max-width: 560px) 100vw, (max-width: 1000px) 50vw, 33vw" className="sh-card-img" />}
      <div className="sh-in">
        <Caps as="div" className="sh-row">
          <span>The coffee{p.premium && <span style={{ fontWeight: 400 }} data-testid="premium"> · Premium ★</span>}</span>
          <span style={{ fontWeight: 400 }}>{p.stopLabel}</span>
        </Caps>
        {!p.compact && p.words && p.words.length > 0 && <Caps weight={400} style={{ letterSpacing: '.3em' }}>{p.words.join(' · ')}</Caps>}
        <h3 className="sh-cn">{p.name}</h3>
        {pres.signatureNotes && pres.signatureNotes.length > 0 && (
          <>
            <Titled style={{ alignSelf: 'flex-start', marginTop: 6 }}>Signature notes</Titled>
            <span className="sh-sig">{pres.signatureNotes.join(', ')}</span>
          </>
        )}
        {!p.compact && pres.hint && <span className="sh-hint">{pres.hint}</span>}
        {!p.compact && spec.length > 0 && (
          <dl className="sh-spec">
            {spec.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        )}
        <div className="sh-foot">
          {p.state === 'soon' ? (
            <Caps weight={400}>Coming soon</Caps>
          ) : p.state === 'unpriced' ? (
            <Caps weight={400}>Price coming</Caps>
          ) : p.gated ? null : (
            <>
              {p.prices.length > 1 && (
                <div className="sh-chips ab-caps" role="group" aria-label="Bag size">
                  {p.prices.map(x => (
                    <button key={x.weightOz} type="button" className="sh-chip" aria-pressed={x.weightOz === selected?.weightOz} onClick={() => p.onSelectWeight(x.weightOz)}>
                      {x.weightOz} oz
                    </button>
                  ))}
                </div>
              )}
              {selected && (
                <div className="sh-row ab-caps" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 400 }}>{formatPrice(selected.retailPriceCents)} · {selected.weightOz} oz whole bean</span>
                  <button type="button" className="sh-link" onClick={p.onAdd}>Add to cart ↗</button>
                </div>
              )}
            </>
          )}
          {p.profileHref && (
            <Caps as="div" style={{ alignSelf: 'flex-end', fontWeight: 600 }}>
              <Link to={p.profileHref} className="sh-link">Full profile ↗</Link>
            </Caps>
          )}
        </div>
      </div>
    </article>
  );
}

// ── the two sources ──────────────────────────────────────────────────────────

export interface FamilyLook {
  archetype: string;
  archetypeLabel: string;
  color: string;
  plateInk: string;
  words: string[] | null;
  photo: { asset: RegistryImage; fallback: RegistryImage };
}

const SLUG_BY_CODE: Record<string, Exclude<ArchetypeSlug, 'experimental'>> = {
  floral: 'floral', fruity: 'fruity', balanced_sweet: 'balanced-sweet', chocolate_nutty: 'chocolate-nutty', earthy: 'spicy-earthy',
};

/** A family's card look (colours from ARCHETYPE_VISUALS, words and label from the payload). Shared by Shop all and The Bloom. */
export function familyLookOf(f: { archetype: string; archetypeLabel: string; customerWords?: string[] | null }): FamilyLook {
  const v = ARCHETYPE_VISUALS[f.archetype];
  const slug = SLUG_BY_CODE[f.archetype];
  return {
    archetype: f.archetype,
    archetypeLabel: f.archetypeLabel,
    color: v?.color ?? 'var(--ab-ink)',
    plateInk: v?.plateInk ?? 'var(--ab-paper)',
    words: f.customerWords ?? null,
    photo: slug
      ? { asset: shopAssets.family[slug], fallback: archetypeAssets[slug].sm1 }
      : { asset: shopAssets.other, fallback: lifestyleAssets.coffee15 },
  };
}

function photoFor(photoKey: string | undefined, fallbackPhoto: { asset: RegistryImage; fallback: RegistryImage }) {
  return photoKey ? { asset: optimizedAsset(photoKey), fallback: fallbackPhoto.asset } : fallbackPhoto;
}

/** A dial slot's card: availability from the shared hook, add = the dial item + dial sync. */
export function SlotShopCard({ family, card, gated, source = 'shop', compact, selected, onSelect }: {
  family: FamilyLook; card: SlotCard; gated: boolean;
  /** the dial-event source for add-to-cart ('shop', or 'bloom' on The Bloom's lineup) */
  source?: string;
  compact?: boolean; selected?: boolean; onSelect?: () => void;
}) {
  const { user } = useAuth();
  const { addToCart } = useCart();
  const avail = useSlotAvailability(card, family.archetype);
  const hasCoffee = card.isActive && card.coffeeId != null;
  const state: CardState = !hasCoffee || (!avail.isUnpriced && !avail.effectivelyActive) ? 'soon' : avail.isUnpriced ? 'unpriced' : 'buy';
  const prices = avail.availableWeights.length ? avail.availableWeights : card.prices;
  const onAdd = () => {
    const price = card.prices.find(x => x.weightOz === avail.selectedWeight) ?? prices[0];
    if (!price) return;
    const item = dialCartItem(family, card, price);
    if (!item) return;
    addToCart(item);
    syncDialAddToCart(user, family.archetype, card.dialSortOrder, source, card.coffeeId);
  };
  return (
    <ShopCoffeeCard
      color={family.color} plateInk={family.plateInk}
      photo={photoFor(card.photoKey, family.photo)}
      premium={!!card.hasAward}
      stopLabel={`${card.dialSortOrder} · ${card.positionLabel}`}
      words={family.words}
      name={card.platformName ?? card.positionLabel}
      presentation={card}
      state={state}
      prices={prices}
      selectedWeight={avail.selectedWeight ?? prices[0]?.weightOz ?? null}
      onSelectWeight={avail.setSelectedWeight}
      onAdd={onAdd}
      profileHref={hasCoffee ? `/flavor-intelligence?archetype=${family.archetype}&slot=${card.dialSortOrder}` : null}
      gated={gated}
      compact={compact} selected={selected} onSelect={onSelect}
    />
  );
}

/** A category coffee's card (Other): priced by coffee id, add = the direct item. */
export function OtherShopCard({ card, look, gated }: {
  card: OtherCard & { platformName: string };
  look: Omit<FamilyLook, 'archetype' | 'archetypeLabel' | 'words'>;
  gated: boolean;
}) {
  const { addToCart } = useCart();
  const [selectedWeight, onSelectWeight] = useState<number | null>(null);
  const active = card.prices.filter(x => x.isActive);
  const state: CardState = card.isUnpriced ? 'unpriced' : card.effectivelyActive ? 'buy' : 'soon';
  const categoryLabel = card.categories.map(c => c.label).join(' · ');
  const onAdd = () => {
    const price = active.find(x => x.weightOz === selectedWeight) ?? active.find(x => x.isAnchor) ?? active[0];
    if (!price) return;
    addToCart(directCartItem(card, categoryLabel, price));
  };
  return (
    <ShopCoffeeCard
      color={look.color} plateInk={look.plateInk}
      photo={photoFor(card.photoKey, look.photo)}
      premium={!!card.hasAward}
      stopLabel={categoryLabel}
      words={null}
      name={card.platformName}
      presentation={card}
      state={state}
      prices={active}
      selectedWeight={selectedWeight ?? (active.find(x => x.isAnchor) ?? active[0])?.weightOz ?? null}
      onSelectWeight={onSelectWeight}
      onAdd={onAdd}
      profileHref={`/flavor-intelligence?directCoffee=${card.coffeeId}`}
      gated={gated}
    />
  );
}
