// Roastery portal (part 5, 2026-10-06) — admin preview of a roastery's form. Rendered by the two routes
// /admin/roastery-portal/:roasterId/preview[/coffee/:id] (behind AdminRoute, outside AdminLayout). It is the real
// <RoasteryPortal> with the preview client (./previewApi.ts): reads come from two read-only admin endpoints, every
// write stays in the browser. One instance serves both routes (nested route), so what is entered survives moving
// between the lineup and a coffee, and is gone on refresh.

import { useMemo } from 'react';
import { useParams } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import RoasteryPortal from './RoasteryPortal';
import { createPreviewClient } from './previewApi';

export default function RoasteryPortalPreview() {
  const { roasterId = '' } = useParams();
  const { user } = useAuth();
  const client = useMemo(
    () => createPreviewClient(roasterId, async () => (user ? user.getIdToken() : '')),
    [roasterId, user],
  );
  const preview = useMemo(() => ({
    client,
    basePath: `/admin/roastery-portal/${roasterId}/preview`,
    backTo: `/admin/roastery-portal?roastery=${encodeURIComponent(roasterId)}`,
    roasterId,
  }), [client, roasterId]);
  return <RoasteryPortal preview={preview} />;
}
