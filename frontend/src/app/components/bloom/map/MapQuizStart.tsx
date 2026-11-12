// Ella's Bloom Map 3 (2026-11-12), C2 — the quiz result's map piece: one
// sentence from the API (the base, or "You start here: <coffee>") and the
// thumb face with the person's dot. Renders only when the quiz_result surface
// says map (dial_surface); with the row on lane it renders nothing and the
// result screen is unchanged. The quiz door has already written the decision.
import { useEffect, useState } from 'react';
import EllaMapFace from './EllaMapFace';
import { getMapSurfaces, getMapMe, getMapFace, useMapFetch, type MapMe, type MapFaceData } from '../../../lib/mapCustomer';

/** `refreshKey` changes when the quiz save has landed (the screen's profile refresh), so the piece re-reads then. */
export default function MapQuizStart({ refreshKey }: { refreshKey?: unknown }) {
  const apiFetch = useMapFetch();
  const [me, setMe] = useState<MapMe | null>(null);
  const [face, setFace] = useState<MapFaceData | null>(null);

  useEffect(() => {
    if (!apiFetch) return;
    let live = true;
    (async () => {
      try {
        const s = await getMapSurfaces(apiFetch);
        if (s.quiz_result !== 'map') return;
        const [m, f] = await Promise.all([getMapMe(apiFetch), getMapFace(apiFetch)]);
        if (live) { setMe(m); setFace(f); }
      } catch { /* the piece is optional: the result screen stands without it */ }
    })();
    return () => { live = false; };
  }, [apiFetch, refreshKey]);

  if (!me?.position || !face) return null;
  return (
    <div className="flex items-center gap-4 mt-4" data-testid="map-quiz-start">
      <EllaMapFace placements={face.placements} wedges={face.wedges} size="thumb" highlightCoffeeId={me.position.coffeeId} />
      {me.position.sentence && <p className="qz-mhead-line" data-testid="map-quiz-sentence">{me.position.sentence}</p>}
    </div>
  );
}
