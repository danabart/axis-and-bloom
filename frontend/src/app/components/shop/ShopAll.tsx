import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Wrap, Caps, Titled } from '../chrome';
import { SlotShopCard, OtherShopCard, familyLookOf, type FamilyLook } from './ShopCoffeeCard';
import { ARCHETYPE_VISUALS } from '../bloom/bloomVisuals';
import { collectionCartItem } from '../bloom/cartItems';
import { formatPrice } from '../bloom/types';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { usePrelaunchGated } from '../../lib/prelaunch';
import { getCoffeeCards, getArchetypeOrder, getUserProfile, getHomeContent, type CoffeeCards, type FamilyCards, type OtherCard } from '../../lib/api';
import { reportError } from '../../lib/errorReporter';
import { archetypeAssets, shopAssets, lifestyleAssets, type ArchetypeSlug } from '../../../design/assets';
import './shop.css';

// Website 4 (2026-11-05) — /shop is the handoff "Shop all" page (D4, D5):
// intro, family menu (scroll-spy, sticky on desktop), "Your family first",
// five family sections (collection row + card grid), then "Other" for the
// category coffees. Every word, count, name and price is the
// /api/coffees/cards payload (G2.1, G4.2); the order is the archetype-order
// endpoint when "Your family first" is on, else sort_order. Replaces Shop.tsx.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_4_SHOP_ALL.md

/** Remembered per browser: whether "Your family first" is on (default on). */
export const FAMILY_FIRST_KEY = 'ab.shop.familyFirst';
const OTHER_ID = 'other';

const pad2 = (n: number) => String(n).padStart(2, '0');
const INK = 'var(--ab-ink)';
const PAPER = 'var(--ab-paper)';

/** Website 5: moved to ShopCoffeeCard.familyLookOf (shared with The Bloom). */
const familyLook = (f: FamilyCards): FamilyLook => familyLookOf(f);

function readFamilyFirst(): boolean {
  try { return localStorage.getItem(FAMILY_FIRST_KEY) !== 'off'; } catch { return true; }
}

export default function ShopAll() {
  const { user } = useAuth();
  const { addToCart } = useCart();
  const gated = usePrelaunchGated();

  const [data, setData] = useState<CoffeeCards | null>(null);
  const [error, setError] = useState(false);
  const [you, setYou] = useState<{ code: string; name: string } | null>(null);
  const [familyFirst, setFamilyFirst] = useState(readFamilyFirst);
  const [order, setOrder] = useState<string[] | null>(null);
  const [current, setCurrent] = useState<string>('all');
  const [dimensions, setDimensions] = useState<number | null>(null);

  useEffect(() => {
    getCoffeeCards().then(setData).catch(err => { reportError('[ShopAll/cards]', err); setError(true); });
    // the cupped-dimension count Home shows (homeContentReads.getHomeFacts), for the lead
    getHomeContent().then(c => setDimensions(c.facts.dimensions)).catch(err => reportError('[ShopAll/facts]', err));
  }, []);

  // The customer's family, as The Bloom reads it (guests included, `user` is truthy for them).
  useEffect(() => {
    if (!user) { setYou(null); return; }
    getUserProfile()
      .then(p => setYou(p?.archetype?.id ? { code: p.archetype.id, name: p.archetype.name ?? p.archetype.id } : null))
      .catch(err => { reportError('[ShopAll/profile]', err); setYou(null); });
  }, [user]);

  const families = useMemo(() => (data?.families ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder), [data]);
  const yourFamily = you ? families.find(f => f.archetype === you.code) ?? null : null;
  const personalise = !!yourFamily && familyFirst;

  useEffect(() => {
    if (!personalise || !yourFamily) { setOrder(null); return; }
    getArchetypeOrder(yourFamily.archetype).then(setOrder).catch(err => { reportError('[ShopAll/archetype-order]', err); setOrder(null); });
  }, [personalise, yourFamily?.archetype]);

  const ordered = useMemo(() => {
    if (!order) return families;
    const rank = new Map(order.map((code, i) => [code, i]));
    return families.slice().sort((a, b) => (rank.get(a.archetype) ?? 99) - (rank.get(b.archetype) ?? 99) || a.sortOrder - b.sortOrder);
  }, [families, order]);

  // OT-70: a category coffee with no customer-facing name is never shown.
  const otherCards = useMemo(
    () => (data?.other.cards ?? []).filter((c): c is OtherCard & { platformName: string } => !!c.platformName),
    [data],
  );
  const otherHeading = [...new Set(otherCards.flatMap(c => c.categories.map(k => k.label)))].join(' · ');

  const toggleFamilyFirst = () => {
    const next = !familyFirst;
    setFamilyFirst(next);
    try { localStorage.setItem(FAMILY_FIRST_KEY, next ? 'on' : 'off'); } catch { /* blocked storage: the toggle still works for this visit */ }
  };

  // Scroll-spy: the menu marks the section in view.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-shop-section]'));
    if (!sections.length) return;
    const io = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setCurrent((visible.target as HTMLElement).id);
    }, { rootMargin: '-30% 0px -60% 0px' });
    sections.forEach(s => io.observe(s));
    return () => io.disconnect();
  }, [ordered, otherCards.length]);

  // A deep link (/shop#fruity, Home's family panels) lands once the sections exist.
  useEffect(() => {
    if (!data) return;
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    if (!id) return;
    const el = document.getElementById(id);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }, [data]);

  const menu = [
    { id: 'all', label: 'All', color: INK },
    ...families.map(f => ({ id: f.archetype, label: f.archetypeLabel, color: ARCHETYPE_VISUALS[f.archetype]?.color ?? INK })),
    ...(otherCards.length ? [{ id: OTHER_ID, label: 'Other', color: INK }] : []),
  ];

  return (
    <div className="sh">
      <Wrap as="section" id="all" aria-label="Shop all" data-shop-section="">
        <div className="sh-intro">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Titled style={{ alignSelf: 'flex-start' }}>Shop all</Titled>
            <h1 className="sh-h">Every coffee we cup.</h1>
          </div>
          {families.length > 0 && (
            <p className="sh-lead">{families.length} families, a handful of coffees in each. Every one cupped{dimensions ? ` on ${dimensions} dimensions` : ''}, from partner roasteries.</p>
          )}
        </div>
      </Wrap>

      <div className="sh-menubar">
        <Wrap>
          <nav className="sh-fmenu" aria-label="Families">
            {menu.map(m => (
              <a
                key={m.id}
                href={`#${m.id}`}
                className={current === m.id ? 'on' : undefined}
                aria-current={current === m.id ? 'true' : undefined}
                style={{ ['--c' as string]: m.color }}
                onClick={e => {
                  e.preventDefault();
                  document.getElementById(m.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  history.replaceState(null, '', `#${m.id}`);
                  setCurrent(m.id);
                }}
              >
                {m.label}
              </a>
            ))}
          </nav>
        </Wrap>
      </div>
      <Wrap>
          <div className="sh-foryou" data-testid="shop-foryou">
            {yourFamily ? (
              <>
                <Caps weight={400}>Your family is <b style={{ fontWeight: 700 }}>{yourFamily.archetypeLabel}</b> · from your quiz</Caps>
                <button type="button" className="sh-toggle" aria-pressed={familyFirst} onClick={toggleFamilyFirst}>Your family first</button>
              </>
            ) : (
              <Caps weight={400}><Link to="/find-my-flavor" className="sh-link">Find your family first →</Link></Caps>
            )}
          </div>
      </Wrap>

      {error && (
        <Wrap><p className="sh-lead" style={{ paddingBlock: 48 }}>Refresh the page to see every coffee.</p></Wrap>
      )}

      <div id="families">
        {ordered.map(f => {
          const look = familyLook(f);
          const mine = personalise && yourFamily?.archetype === f.archetype;
          const offer = f.collectionOffer;
          return (
            <Wrap as="section" key={f.archetype} id={f.archetype} className="sh-family" aria-label={f.archetypeLabel} data-shop-section="" data-testid="shop-family" style={{ ['--c' as string]: look.color }}>
              <div className="sh-fam-head">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Titled style={{ alignSelf: 'flex-start' }}>{pad2(f.sortOrder)} — {mine ? 'Your family' : 'Family of taste'}</Titled>
                  <h2 className="sh-fam-name">{f.archetypeLabel}</h2>
                  {f.customerWords && <Caps weight={400}>{f.customerWords.join(' · ')}</Caps>}
                </div>
                {offer && !gated && (
                  <div className="sh-collection ab-caps" data-testid="shop-collection">
                    <span style={{ fontWeight: 400 }}>The collection · {offer.memberCount} coffees · {formatPrice(offer.discountedCents)}</span>
                    <button type="button" className="sh-link" onClick={() => { const item = collectionCartItem(f); if (item) addToCart(item); }}>Add the collection ↗</button>
                  </div>
                )}
              </div>
              <div className="sh-grid">
                {f.cards.map(card => <SlotShopCard key={card.dialSortOrder} family={look} card={card} gated={gated} />)}
              </div>
            </Wrap>
          );
        })}

        {otherCards.length > 0 && (
          <Wrap as="section" id={OTHER_ID} className="sh-family" aria-label="Other" data-shop-section="" data-testid="shop-other" style={{ ['--c' as string]: INK }}>
            <div className="sh-fam-head">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Titled style={{ alignSelf: 'flex-start' }}>Other</Titled>
                <h2 className="sh-fam-name">{otherHeading}</h2>
              </div>
            </div>
            <div className="sh-grid">
              {otherCards.map(card => {
                const fam = card.archetype ? ARCHETYPE_VISUALS[card.archetype] : undefined;
                return (
                  <OtherShopCard
                    key={card.coffeeId}
                    card={card}
                    gated={gated}
                    look={{ color: fam?.color ?? INK, plateInk: fam?.plateInk ?? PAPER, photo: { asset: shopAssets.other, fallback: lifestyleAssets.coffee15 } }}
                  />
                );
              })}
            </div>
          </Wrap>
        )}
      </div>
    </div>
  );
}
