import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { ArchetypeData, Slot } from './types';
import { slotKey } from './types';
import { DimensionBars, type DimensionRow } from '../coffee-info/DimensionBars';
import { CollaborativeFlavorWheel, type WheelRow } from '../coffee-info/CollaborativeFlavorWheel';

interface SlotRef { archetype: string; archetypeLabel: string; slot: Slot; }

interface CompareOverlayProps {
  open: boolean;
  onClose: () => void;
  left: SlotRef | null;
  archetypes: ArchetypeData[];
}

function slotLabel(ref: SlotRef) {
  return `${ref.archetypeLabel} — ${ref.slot.positionLabel} — ${ref.slot.platformName}`;
}

/** "⇄ Compare" overlay — modal instead of an inline page state, so it doesn't disrupt Bloom's scroll layout. */
export function CompareOverlay({ open, onClose, left, archetypes }: CompareOverlayProps) {
  const [rightKey, setRightKey] = useState('');
  const [leftDims, setLeftDims] = useState<DimensionRow[]>([]);
  const [leftWheel, setLeftWheel] = useState<WheelRow[]>([]);
  const [rightDims, setRightDims] = useState<DimensionRow[]>([]);
  const [rightWheel, setRightWheel] = useState<WheelRow[]>([]);

  const options: SlotRef[] = archetypes.flatMap(a =>
    a.slots.filter(s => s.isActive && s.coffeeId).map(s => ({ archetype: a.archetype, archetypeLabel: a.archetypeLabel, slot: s }))
  );
  const right = options.find(o => slotKey(o.archetype, o.slot.dialSortOrder) === rightKey) ?? null;

  useEffect(() => {
    if (!open) { setRightKey(''); return; }
  }, [open]);

  useEffect(() => {
    if (!open || !left?.slot.coffeeId) return;
    Promise.all([
      fetch(`/api/coffees/${left.slot.coffeeId}/dimensions`).then(r => r.json()),
      fetch(`/api/coffees/${left.slot.coffeeId}/flavor-wheel`).then(r => r.json()),
    ]).then(([dimData, wheel]) => { setLeftDims(dimData.dimensions ?? []); setLeftWheel(wheel); }).catch(() => {});
  }, [open, left?.slot.coffeeId]);

  useEffect(() => {
    if (!right?.slot.coffeeId) { setRightDims([]); setRightWheel([]); return; }
    Promise.all([
      fetch(`/api/coffees/${right.slot.coffeeId}/dimensions`).then(r => r.json()),
      fetch(`/api/coffees/${right.slot.coffeeId}/flavor-wheel`).then(r => r.json()),
    ]).then(([dimData, wheel]) => { setRightDims(dimData.dimensions ?? []); setRightWheel(wheel); }).catch(() => {});
  }, [right?.slot.coffeeId]);

  if (!left) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center p-6"
          style={{ backgroundColor: 'rgba(20,16,12,0.55)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
            className="rounded-2xl overflow-y-auto"
            style={{ backgroundColor: '#f2f1ea', maxWidth: 900, width: '100%', maxHeight: '85vh', padding: '2.5rem' }}
          >
            <div className="flex items-center justify-between mb-6">
              <p className="text-xs uppercase tracking-widest" style={{ color: '#b05642' }}>Compare</p>
              <button onClick={onClose} className="text-sm" style={{ color: '#8a8070' }}>✕ Close</button>
            </div>

            <div className="grid grid-cols-2 gap-8 mb-8">
              <div>
                <p className="text-xs uppercase tracking-widest mb-2" style={{ color: '#a09880' }}>This one</p>
                <h3 className="text-lg font-normal" style={{ color: '#b05642' }}>{slotLabel(left)}</h3>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest mb-2" style={{ color: '#a09880' }}>Compare with</p>
                <select
                  value={rightKey}
                  onChange={e => setRightKey(e.target.value)}
                  className="text-sm px-3 py-1.5 rounded border bg-white w-full"
                  style={{ borderColor: '#d0ccc4', color: '#4a4035' }}
                >
                  <option value="">Select a coffee…</option>
                  {options
                    .filter(o => !(o.archetype === left.archetype && o.slot.dialSortOrder === left.slot.dialSortOrder))
                    .map(o => (
                      <option key={slotKey(o.archetype, o.slot.dialSortOrder)} value={slotKey(o.archetype, o.slot.dialSortOrder)}>
                        {slotLabel(o)}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="space-y-10">
              <DimensionBars
                dimensions={leftDims}
                compareDimensions={right ? rightDims : undefined}
                primaryLabel={left.slot.platformName ?? undefined}
                compareLabel={right?.slot.platformName ?? undefined}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div>
                  <p className="text-xs mb-4" style={{ color: '#a09880' }}>{left.slot.platformName}</p>
                  <CollaborativeFlavorWheel wheelRows={leftWheel} />
                </div>
                {right && (
                  <div>
                    <p className="text-xs mb-4" style={{ color: '#a09880' }}>{right.slot.platformName}</p>
                    <CollaborativeFlavorWheel wheelRows={rightWheel} />
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
