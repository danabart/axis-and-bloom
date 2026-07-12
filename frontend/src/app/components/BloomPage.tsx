import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { getUserProfile, placeOrder, getDialPosition, setDialPosition } from '../lib/api';
import { ARCHETYPE_ORDER, ARCHETYPE_VISUALS } from './bloom/bloomVisuals';
import { PositionCard } from './bloom/PositionCard';
import { FloatingCart } from './bloom/FloatingCart';
import { CompareOverlay } from './bloom/CompareOverlay';
import { BloomDialWidget, type BloomDialHandle, type DialPosition } from './BloomDialWidget';
import type { ArchetypeData, CartItem, Slot } from './bloom/types';
import { slotKey } from './bloom/types';

interface Address {
  id: number; street: string; city: string; state: string; postal_code: string; country: string;
}

/** ★ default position — sort_order 2 ("Classic"/"Balanced"/etc.) by established convention
 * across every archetype's seeded vocabulary; falls back to the first defined position
 * for the rare archetype that doesn't have one. */
function computeDefaultSortOrder(data: ArchetypeData): number {
  return data.slots.some(s => s.dialSortOrder === 2) ? 2 : (data.slots[0]?.dialSortOrder ?? 1);
}

function ArchetypeSection({
  data, index, selectedSortOrder, revealedKeys, onDialSelect, onToggleReveal, onAddToCart, onHopClick, onCompare,
  userArchetype, registerDialRef,
}: {
  data: ArchetypeData;
  index: number;
  selectedSortOrder: number;
  revealedKeys: Set<string>;
  onDialSelect: (archetype: string, dialSortOrder: number) => void;
  onToggleReveal: (key: string) => void;
  onAddToCart: (item: CartItem) => void;
  onHopClick: (archetype: string, dialSortOrder: number) => void;
  onCompare: (archetype: string, archetypeLabel: string, slot: Slot) => void;
  userArchetype: string | null;
  registerDialRef: (archetype: string, handle: BloomDialHandle | null) => void;
}) {
  const visual = ARCHETYPE_VISUALS[data.archetype];
  const flip = index % 2 !== 0;
  const eager = index === 0;

  if (!visual) return null;

  const defaultSortOrder = computeDefaultSortOrder(data);
  const dialPositions: DialPosition[] = data.slots.map(s => ({
    dialSortOrder: s.dialSortOrder,
    label: s.positionLabel,
    description: s.description,
    isActive: s.isActive,
  }));
  const currentSlot = data.slots.find(s => s.dialSortOrder === selectedSortOrder)
    ?? data.slots.find(s => s.dialSortOrder === defaultSortOrder)
    ?? data.slots[0];
  const currentKey = slotKey(data.archetype, currentSlot.dialSortOrder);

  return (
    <motion.section
      id={data.archetype}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.06 }}
      transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
      style={{
        borderTop: '1px solid rgba(154,41,24,0.08)',
        padding: 'clamp(52px, 7vh, 92px) clamp(32px, 6vw, 96px)',
      }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 'clamp(28px, 4vh, 52px)',
      }}>
        <span style={{ fontSize: '0.49rem', letterSpacing: '0.38em', textTransform: 'uppercase', color: visual.color, opacity: 0.52 }}>
          No. {visual.num}
        </span>
        <span style={{ fontSize: '0.49rem', letterSpacing: '0.26em', textTransform: 'uppercase', color: visual.color, opacity: 0.40 }}>
          {data.archetypeLabel}
        </span>
      </div>

      <div style={{
        display: 'flex', flexDirection: flip ? 'row-reverse' : 'row',
        gap: 'clamp(24px, 3.5vw, 56px)', alignItems: 'flex-start',
      }}>
        {/* ── Photo column ── */}
        <div style={{ flex: '0 0 34%', display: 'flex', flexDirection: 'column', gap: 5, position: 'sticky', top: 100 }}>
          <div style={{ aspectRatio: '4 / 3', overflow: 'hidden' }}>
            <img
              src={visual.hero}
              alt={`${data.archetypeLabel} — Axis & Bloom archetype`}
              width={800} height={600}
              loading={eager ? 'eager' : 'lazy'}
              decoding={eager ? 'sync' : 'async'}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
            <div style={{ aspectRatio: '1 / 1', overflow: 'hidden' }}>
              <img src={visual.sm1} alt="" width={400} height={400} loading="lazy" decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
            <div style={{ aspectRatio: '1 / 1', overflow: 'hidden' }}>
              <img src={visual.sm2} alt="" width={400} height={400} loading="lazy" decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
          </div>
        </div>

        {/* ── Dial column ── */}
        <div style={{ flex: '0 0 26%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <BloomDialWidget
            ref={el => registerDialRef(data.archetype, el)}
            color={visual.color}
            positions={dialPositions}
            dimensionLabel={data.dimensionPlatformName}
            defaultSortOrder={defaultSortOrder}
            initialSortOrder={selectedSortOrder}
            onSelect={sortOrder => onDialSelect(data.archetype, sortOrder)}
          />
          <img
            src={visual.bag}
            alt={`${data.archetypeLabel} bag`}
            width={160} height={200}
            loading="lazy" decoding="async"
            style={{ maxHeight: 160, maxWidth: '70%', objectFit: 'contain', filter: 'drop-shadow(0 18px 44px rgba(0,0,0,0.09))', marginTop: 8 }}
          />
        </div>

        {/* ── Dynamic position card ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{
            fontSize: 'clamp(2rem, 3.2vw, 4rem)', color: visual.color, fontWeight: 400,
            lineHeight: 0.95, margin: '0 0 clamp(20px, 3vh, 32px)', letterSpacing: '-0.02em',
          }}>
            {data.archetypeLabel}
          </h2>
          <PositionCard
            key={currentKey}
            slot={currentSlot}
            archetype={data.archetype}
            archetypeLabel={data.archetypeLabel}
            color={visual.color}
            isRevealed={revealedKeys.has(currentKey)}
            onToggleReveal={() => onToggleReveal(currentKey)}
            onAddToCart={onAddToCart}
            onHopClick={onHopClick}
            onCompare={() => onCompare(data.archetype, data.archetypeLabel, currentSlot)}
            userArchetype={userArchetype}
            cardRef={() => {}}
          />
        </div>
      </div>
    </motion.section>
  );
}

export default function BloomPage() {
  const { user } = useAuth();

  const [archetypes, setArchetypes] = useState<ArchetypeData[]>([]);
  const [error, setError] = useState('');
  const [userArchetype, setUserArchetype] = useState<string | null>(null);
  const [defaultAddress, setDefaultAddress] = useState<Address | null>(null);
  const [customerName, setCustomerName] = useState<{ first: string; last: string } | null>(null);

  const [selectedSortOrder, setSelectedSortOrder] = useState<Record<string, number>>({});
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const dialRefs = useRef<Record<string, BloomDialHandle | null>>({});

  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);

  const [compareState, setCompareState] = useState<{ open: boolean; archetype: string; archetypeLabel: string; slot: Slot | null }>({
    open: false, archetype: '', archetypeLabel: '', slot: null,
  });

  useEffect(() => {
    fetch('/api/coffees/archetypes')
      .then(r => r.json())
      .then((data: ArchetypeData[]) => {
        const ordered = [...data].sort(
          (a, b) => ARCHETYPE_ORDER.indexOf(a.archetype as any) - ARCHETYPE_ORDER.indexOf(b.archetype as any)
        );
        setArchetypes(ordered);
        setSelectedSortOrder(prev => {
          const next = { ...prev };
          for (const a of ordered) if (!(a.archetype in next)) next[a.archetype] = computeDefaultSortOrder(a);
          return next;
        });
      })
      .catch(() => setError('Failed to load coffees'));
  }, []);

  useEffect(() => {
    if (!user) { setUserArchetype(null); setDefaultAddress(null); setCustomerName(null); return; }
    getUserProfile()
      .then(p => {
        setUserArchetype(p?.archetype?.id ?? null);
        setCustomerName({ first: p?.firstName ?? '', last: p?.lastName ?? '' });
        const addr = (p?.addresses ?? []).find((a: any) => a.address_type === 'shipping') ?? p?.addresses?.[0] ?? null;
        setDefaultAddress(addr ?? null);
      })
      .catch(() => {});
  }, [user]);

  // Phase D — pre-set each archetype's dial to the signed-in user's saved position.
  useEffect(() => {
    if (!user || !archetypes.length) return;
    Promise.all(archetypes.map(a => getDialPosition(a.archetype).then(r => [a.archetype, r.dialSortOrder] as const).catch(() => [a.archetype, null] as const)))
      .then(entries => {
        setSelectedSortOrder(prev => {
          const next = { ...prev };
          for (const [archetype, sortOrder] of entries) if (sortOrder != null) next[archetype] = sortOrder;
          return next;
        });
      });
  }, [user, archetypes]);

  function registerDialRef(archetype: string, handle: BloomDialHandle | null) {
    dialRefs.current[archetype] = handle;
  }

  function handleDialSelect(archetype: string, dialSortOrder: number) {
    setSelectedSortOrder(prev => ({ ...prev, [archetype]: dialSortOrder }));
    if (user) setDialPosition(archetype, dialSortOrder).catch(() => {});
  }

  function toggleReveal(key: string) {
    setRevealedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleHopClick(archetype: string, dialSortOrder: number) {
    dialRefs.current[archetype]?.rotateTo(dialSortOrder);
    setRevealedKeys(prev => new Set(prev).add(slotKey(archetype, dialSortOrder)));
    requestAnimationFrame(() => {
      document.getElementById(archetype)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function handleAddToCart(item: CartItem) {
    setCart(prev => {
      const idx = prev.findIndex(i => i.archetype === item.archetype && i.dialSortOrder === item.dialSortOrder && i.weightOz === item.weightOz);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, item];
    });
    setCartOpen(true);
  }

  function handleRemoveFromCart(index: number) {
    setCart(prev => prev.filter((_, i) => i !== index));
  }

  function openCompare(archetype: string, archetypeLabel: string, slot: Slot) {
    setCompareState({ open: true, archetype, archetypeLabel, slot });
  }

  async function handleCheckout() {
    if (!defaultAddress) {
      setCheckoutStatus('error');
      setCheckoutMessage('Add a shipping address in your Profile before checking out.');
      return;
    }
    setCheckoutStatus('loading');
    setCheckoutMessage(null);
    try {
      await placeOrder({
        items: cart.map(item => ({
          archetype: item.archetype,
          dialSortOrder: item.dialSortOrder,
          weightOz: item.weightOz,
          quantity: item.qty,
          priceCents: item.retailPriceCents,
        })),
        shippingAddress: {
          firstName: customerName?.first || 'Customer',
          lastName: customerName?.last || '',
          address1: defaultAddress.street,
          city: defaultAddress.city,
          province: defaultAddress.state,
          zip: defaultAddress.postal_code,
          country: defaultAddress.country,
        },
      });
      setCheckoutStatus('success');
      setCheckoutMessage('Order placed!');
      setCart([]);
    } catch {
      setCheckoutStatus('error');
      setCheckoutMessage("Checkout isn't live yet — online ordering opens soon. Everything up to this point worked.");
    }
  }

  return (
    <div style={{ backgroundColor: '#f2f1ea', minHeight: '100vh' }}>
      {/* ── Hero ── */}
      <section style={{ padding: 'clamp(100px, 14vh, 160px) clamp(32px, 6vw, 96px) clamp(52px, 7vh, 80px)' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.95 }}>
          <p style={{ fontSize: '0.50rem', letterSpacing: '0.38em', textTransform: 'uppercase', color: 'rgba(154,41,24,0.40)', margin: '0 0 16px' }}>
            The Bloom
          </p>
          <h1 style={{ fontSize: 'clamp(3.2rem, 6.5vw, 8.5rem)', color: '#9a2918', fontWeight: 400, lineHeight: 0.92, margin: '0 0 clamp(28px, 4vh, 48px)', letterSpacing: '-0.03em' }}>
            Six worlds.<br />Every detail, at your pace.
          </h1>
        </motion.div>
      </section>

      {/* ── Sticky archetype jump-nav ── */}
      <div style={{
        position: 'sticky', top: 64, zIndex: 40, backgroundColor: '#f2f1ea',
        borderTop: '1px solid rgba(154,41,24,0.07)', borderBottom: '1px solid rgba(154,41,24,0.07)',
        padding: 'clamp(10px, 1.4vh, 16px) clamp(32px, 6vw, 96px)',
        display: 'flex', gap: 'clamp(14px, 2.5vw, 40px)', overflowX: 'auto',
      }}>
        {archetypes.map(a => {
          const visual = ARCHETYPE_VISUALS[a.archetype];
          if (!visual) return null;
          return (
            <a
              key={a.archetype}
              href={`#${a.archetype}`}
              style={{
                fontSize: '0.48rem', letterSpacing: '0.28em', textTransform: 'uppercase',
                color: visual.color, opacity: 0.6, whiteSpace: 'nowrap', textDecoration: 'none',
              }}
            >
              {visual.num} · {a.archetypeLabel}
            </a>
          );
        })}
      </div>

      {error && <p className="text-sm text-red-500 px-8 py-4">{error}</p>}

      {archetypes.map((data, i) => (
        <ArchetypeSection
          key={data.archetype}
          data={data}
          index={i}
          selectedSortOrder={selectedSortOrder[data.archetype] ?? computeDefaultSortOrder(data)}
          revealedKeys={revealedKeys}
          onDialSelect={handleDialSelect}
          onToggleReveal={toggleReveal}
          onAddToCart={handleAddToCart}
          onHopClick={handleHopClick}
          onCompare={openCompare}
          userArchetype={userArchetype}
          registerDialRef={registerDialRef}
        />
      ))}

      <FloatingCart
        items={cart}
        open={cartOpen}
        onToggle={() => setCartOpen(v => !v)}
        onRemove={handleRemoveFromCart}
        onCheckout={handleCheckout}
        checkoutStatus={checkoutStatus}
        checkoutMessage={checkoutMessage}
        isSignedIn={!!user}
      />

      <CompareOverlay
        open={compareState.open}
        onClose={() => setCompareState(s => ({ ...s, open: false }))}
        left={compareState.slot ? { archetype: compareState.archetype, archetypeLabel: compareState.archetypeLabel, slot: compareState.slot } : null}
        archetypes={archetypes}
      />
    </div>
  );
}
