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
 */
export function useCoffeeDetail(coffeeId: number | null, opts: { withDimensions: boolean; logTag: string; readContent?: boolean }) {
  const [content, setContent] = useState<ContentData | null>(null);
  const [dimensions, setDimensions] = useState<DimensionRow[]>([]);
  const [wheelRows, setWheelRows] = useState<WheelRow[]>([]);
  const [dimensionsLoaded, setDimensionsLoaded] = useState(false);
  // readContent false holds the content and notes back (the Bloom page: a slot that is not a real position)
  const { withDimensions, logTag, readContent = true } = opts;

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

  return { content, dimensions, wheelRows, dimensionsLoaded };
}
