import { useEffect, useState } from 'react';
import { reportError } from '../../lib/errorReporter';
import type { ContentData } from './TastingNotes';
import type { DimensionRow } from './DimensionBars';
import type { WheelRow } from './CollaborativeFlavorWheel';

/**
 * Ella's Bloom Map 12 (2026-11-26, Dana's yes at the Task 0 STOP): the three
 * public reads the reveal panel draws from, in one place: the description
 * (GET /api/coffees/:id/content), the notes (…/flavor-wheel) and the cupping
 * bars (…/dimensions). The content and the notes are read as soon as there is
 * a coffee; the bars once `withDimensions` turns true (the Bloom page: on
 * first reveal; /map: at once, since its button shows only for a coffee with a
 * description or bars). usePositionCardData (the Bloom page) and /map's card
 * both call this, so there is one copy of the fetching. `logTag` keeps each
 * caller's error tag as it was.
 * Ella map 13 (2026-11-26): `withRoasterProfile` (/map only) also reads
 * GET /api/coffees/:id/roaster-profile: where it shines and the roaster's own
 * ratings. The Bloom page never sets it, so its reads are as they were.
 */
export interface RoasterProfile {
  whereItShines: string[];
  scale: number;
  ratings: Array<{ label: string; lowLabel: string; highLabel: string; value: number }>;
}

export function useCoffeeDetail(coffeeId: number | null, opts: { withDimensions: boolean; logTag: string; readContent?: boolean; withRoasterProfile?: boolean }) {
  const [content, setContent] = useState<ContentData | null>(null);
  const [dimensions, setDimensions] = useState<DimensionRow[]>([]);
  const [wheelRows, setWheelRows] = useState<WheelRow[]>([]);
  const [dimensionsLoaded, setDimensionsLoaded] = useState(false);
  const [roasterProfile, setRoasterProfile] = useState<RoasterProfile | null>(null);
  // readContent false holds the content and notes back (the Bloom page: a slot that is not a real position)
  const { withDimensions, logTag, readContent = true, withRoasterProfile = false } = opts;

  useEffect(() => {
    if (!coffeeId || !withRoasterProfile) return;
    fetch(`/api/coffees/${coffeeId}/roaster-profile`).then(r => r.json())
      .then(p => setRoasterProfile({ whereItShines: p?.whereItShines ?? [], scale: Number(p?.scale) || 0, ratings: p?.ratings ?? [] }))
      .catch(err => reportError(`[${logTag}/roaster-profile]`, err));
  }, [coffeeId, withRoasterProfile, logTag]);

  useEffect(() => {
    if (!coffeeId || !readContent) return;
    fetch(`/api/coffees/${coffeeId}/content`).then(r => r.json()).then(setContent).catch(err => reportError(`[${logTag}/content]`, err));
    fetch(`/api/coffees/${coffeeId}/flavor-wheel`).then(r => r.json()).then(setWheelRows).catch(err => reportError(`[${logTag}/flavor-wheel]`, err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coffeeId, readContent]);

  useEffect(() => {
    if (!withDimensions || dimensionsLoaded || !coffeeId) return;
    setDimensionsLoaded(true);
    fetch(`/api/coffees/${coffeeId}/dimensions`).then(r => r.json())
      .then(dimData => setDimensions(dimData.dimensions ?? []))
      .catch(err => reportError(`[${logTag}/dimensions]`, err));
  }, [withDimensions, dimensionsLoaded, coffeeId, logTag]);

  return { content, dimensions, wheelRows, dimensionsLoaded, roasterProfile };
}
