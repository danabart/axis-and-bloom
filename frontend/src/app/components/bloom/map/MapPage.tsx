// Ella's Bloom Map 3 (2026-11-12), C1 — /map, the customer side of the map.
// Behind the pre-launch gate and AdminRoute in this brief; brief 4 moves it
// under the customer_face surface row. One coffee big (the position), the
// thumb face above it, the four moves under it; a move reveals its cards with
// the move line leading each, and "Choose this" decides through the one door.
// Every word comes from /api/map (dial_hop_phrase, dial_customer_copy, the
// card readers); nothing here names a ring, lane, cell, seam, grade or version.
// No price and no add to cart in this brief (Dana 2026-11-12, decision 7).
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_3_MATCH_AND_CUSTOMER.md
import { useCallback, useEffect, useState } from 'react';
import EllaMapFace from './EllaMapFace';
import {
  getMapFace, getMapMoves, decideMove, useMapFetch,
  type MapFaceData, type MapMoves, type MapMoveOption, type MapCard,
} from '../../../lib/mapCustomer';

const INK = 'text-[#3f3a36]';
const ACCENT = '#a33726';

function Notes({ notes }: { notes: string[] }) {
  return notes.length ? <p className="text-sm text-[#6b5a56]">{notes.join(' · ')}</p> : null;
}

function CoffeeCard({ card, choose, busy, onChoose }: { card: MapCard; choose: string; busy: boolean; onChoose: () => void }) {
  return (
    <div className="rounded-xl bg-white border border-[#e8e4dc] p-4" data-testid="map-card">
      {card.moveLine && <p className="text-sm italic text-[#6b5a56] mb-2" data-testid="move-line">{card.moveLine}</p>}
      <h3 className={`text-lg font-semibold ${INK}`}>{card.name}</h3>
      <Notes notes={card.notes} />
      {card.compatibility && <p className="text-sm text-[#6b5a56] mt-1">{card.compatibility}</p>}
      <button type="button" disabled={busy} onClick={onChoose} data-testid="choose"
        className="mt-3 px-4 py-2 rounded-full text-sm font-medium text-white disabled:opacity-50" style={{ background: ACCENT }}>
        {choose}
      </button>
    </div>
  );
}

export default function MapPage() {
  const apiFetch = useMapFetch();
  const [face, setFace] = useState<MapFaceData | null>(null);
  const [data, setData] = useState<MapMoves | null>(null);
  const [open, setOpen] = useState<MapMoveOption['move'] | null>(null);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!apiFetch) return;
    try {
      const [f, m] = await Promise.all([getMapFace(apiFetch), getMapMoves(apiFetch)]);
      setFace(f); setData(m); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [apiFetch]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (move: MapMoveOption['move'], coffeeId?: number) => {
    if (!apiFetch) return;
    setBusy(true);
    try {
      await decideMove(apiFetch, { move, coffeeId, requestId: crypto.randomUUID() });
      setOpen(null);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  if (error && !data) return <main className="max-w-md mx-auto px-4 py-10"><p className="text-sm text-[#6b5a56]" data-testid="map-error">{error}</p></main>;
  if (!data || !face) return <main className="max-w-md mx-auto px-4 py-10" />;
  const pos = data.position;
  const copy = data.copy;
  if (!pos) return <main className="max-w-md mx-auto px-4 py-10" data-testid="map-empty" />;

  const stay = data.moves.find(m => m.move === 'stay');
  const others = data.moves.filter(m => m.move !== 'stay');
  const revealed = others.find(m => m.move === open);

  return (
    <main className="max-w-md mx-auto px-4 py-6" style={{ fontFamily: 'Lato, sans-serif' }} data-testid="map-page">
      <div className="flex items-end justify-between gap-3 mb-4">
        <EllaMapFace placements={face.placements} wedges={face.wedges} size="thumb" highlightCoffeeId={pos.coffeeId} />
        <button type="button" className="text-sm underline" style={{ color: ACCENT }} onClick={() => setSheet(true)} data-testid="see-whole-map">
          {copy.see_whole_map}
        </button>
      </div>

      <section className="rounded-2xl bg-[#f2f1ea] p-5 mb-5" data-testid="position-card">
        {pos.sentence && <p className="text-sm text-[#6b5a56] mb-2" data-testid="position-sentence">{pos.sentence}</p>}
        <h1 className={`text-2xl font-semibold ${INK}`}>{pos.name}</h1>
        <Notes notes={pos.notes} />
        {pos.compatibility && <p className="text-sm text-[#6b5a56] mt-1">{pos.compatibility}</p>}
      </section>

      {stay && (
        <button type="button" disabled={busy} onClick={() => decide('stay')} data-testid="move-stay"
          className="w-full py-3 rounded-full text-white font-medium mb-3 disabled:opacity-50" style={{ background: ACCENT }}>
          {stay.label}
        </button>
      )}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {others.map(m => (
          <button key={m.move} type="button" data-testid={`move-${m.move}`} aria-pressed={open === m.move}
            disabled={m.edge}
            onClick={() => setOpen(open === m.move ? null : m.move)}
            className={`py-2.5 px-2 rounded-full text-sm border ${m.edge ? 'border-[#e8e4dc] text-[#b8aca8]' : open === m.move ? 'text-white' : ''}`}
            style={m.edge ? undefined : open === m.move ? { background: ACCENT, borderColor: ACCENT } : { borderColor: ACCENT, color: ACCENT }}>
            {m.label}
          </button>
        ))}
      </div>
      {others.filter(m => m.edge && m.edgePhrase).map(m => (
        <p key={m.move} className="text-xs text-[#9b8f8b] mb-2" data-testid={`edge-${m.move}`}>{m.label}: {m.edgePhrase}</p>
      ))}

      {revealed && (
        <div className="flex flex-col gap-3" data-testid="revealed">
          {revealed.cards.map(card => (
            <CoffeeCard key={card.coffeeId} card={card} choose={copy.choose_this} busy={busy} onChoose={() => decide(revealed.move, card.coffeeId)} />
          ))}
        </div>
      )}
      {error && <p className="text-sm text-[#a33726] mt-3">{error}</p>}

      {sheet && (
        <div className="fixed inset-0 z-[1000] bg-black/40 flex items-end sm:items-center justify-center" onClick={() => setSheet(false)} data-testid="map-sheet">
          <div className="bg-[#f2f1ea] w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-end">
              <button type="button" aria-label="close" data-testid="sheet-close" className="text-2xl leading-none px-2" style={{ color: ACCENT }} onClick={() => setSheet(false)}>×</button>
            </div>
            {/* no seams: the customer page names no seam, ring, lane or cell (C1) */}
            <EllaMapFace placements={face.placements} wedges={face.wedges} size="full" labelMode="name" highlightCoffeeId={pos.coffeeId} />
          </div>
        </div>
      )}
    </main>
  );
}
