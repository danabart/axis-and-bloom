// Ella's Bloom Map 3 (2026-11-12), C3 — the profile's "Your trail": the
// decisions as a story (coffee → coffee with the move word) and the active
// version's face with the dots joined (R3.9). Renders only when the
// profile_trail surface says map; with the row on lane it renders nothing.
// Title and move words come from the API (dial_customer_copy, dial_hop_phrase).
import { useEffect, useState } from 'react';
import EllaMapFace from './EllaMapFace';
import { getMapSurfaces, getMapMe, getMapFace, useMapFetch, type MapMe, type MapFaceData } from '../../../lib/mapCustomer';

export default function MapTrail() {
  const apiFetch = useMapFetch();
  const [me, setMe] = useState<MapMe | null>(null);
  const [face, setFace] = useState<MapFaceData | null>(null);

  useEffect(() => {
    if (!apiFetch) return;
    let live = true;
    (async () => {
      try {
        const s = await getMapSurfaces(apiFetch);
        if (s.profile_trail !== 'map') return;
        const [m, f] = await Promise.all([getMapMe(apiFetch), getMapFace(apiFetch)]);
        if (live) { setMe(m); setFace(f); }
      } catch { /* optional section */ }
    })();
    return () => { live = false; };
  }, [apiFetch]);

  if (!me || !face || me.trail.length === 0) return null;
  return (
    <div data-testid="map-trail">
      <hr className="border-0 border-t border-[var(--ab-ink-hairline)] my-[34px]" />
      <p className="text-[11px] uppercase tracking-[0.2em] text-[#a33726]/40 mb-4">{me.copy.trail_title}</p>
      <div className="flex flex-col md:flex-row gap-6 items-start">
        <ol className="flex flex-col gap-2 text-sm text-[#3f3a36] flex-1">
          {me.trail.map(t => (
            <li key={t.step} className="flex gap-2 items-baseline">
              <span className="text-[11px] uppercase tracking-[0.15em] text-[#a33726]/60 min-w-[6.5rem]">{t.moveWord}</span>
              <span>{t.name}</span>
            </li>
          ))}
        </ol>
        <div className="w-full md:w-[320px]">
          <EllaMapFace placements={face.placements} wedges={face.wedges} size="full" labelMode="none"
            highlightCoffeeId={me.position?.coffeeId ?? null} path={me.trail.map(t => t.coffeeId)} />
        </div>
      </div>
    </div>
  );
}
