import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { getUserProfile, getDialPosition, setDialPosition } from '../lib/api';
import { ARCHETYPE_ORDER, ARCHETYPE_VISUALS } from './bloom/bloomVisuals';
import { ArchetypeSection, computeDefaultSortOrder } from './bloom/ArchetypeSection';
import { CompareOverlay } from './bloom/CompareOverlay';
import type { BloomDialHandle } from './BloomDialWidget';
import type { ArchetypeData, Slot } from './bloom/types';
import { slotKey } from './bloom/types';

export default function BloomPage() {
  const { user } = useAuth();
  const { addToCart } = useCart();

  const [archetypes, setArchetypes] = useState<ArchetypeData[]>([]);
  const [error, setError] = useState('');
  const [userArchetype, setUserArchetype] = useState<string | null>(null);

  const [selectedSortOrder, setSelectedSortOrder] = useState<Record<string, number>>({});
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const dialRefs = useRef<Record<string, BloomDialHandle | null>>({});

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
    if (!user) { setUserArchetype(null); return; }
    getUserProfile()
      .then(p => setUserArchetype(p?.archetype?.id ?? null))
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

  function openCompare(archetype: string, archetypeLabel: string, slot: Slot) {
    setCompareState({ open: true, archetype, archetypeLabel, slot });
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
          onAddToCart={addToCart}
          onHopClick={handleHopClick}
          onCompare={openCompare}
          userArchetype={userArchetype}
          registerDialRef={registerDialRef}
        />
      ))}

      <CompareOverlay
        open={compareState.open}
        onClose={() => setCompareState(s => ({ ...s, open: false }))}
        left={compareState.slot ? { archetype: compareState.archetype, archetypeLabel: compareState.archetypeLabel, slot: compareState.slot } : null}
        archetypes={archetypes}
      />
    </div>
  );
}
