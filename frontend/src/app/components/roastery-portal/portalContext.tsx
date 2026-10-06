// Roastery portal (part 5, 2026-10-06) — the one seam between the partner screens and the server. The screens read
// their client, the base path they navigate within and whether they are a preview from here instead of importing
// `portalApi`. RoasteryPortal.tsx provides it: the public route passes `portalApi` and `/roastery/:token`; the admin
// preview passes the preview client and the preview routes. No default client on purpose (a screen rendered outside
// a provider fails loudly instead of silently talking to the public API).

import { createContext, useContext } from 'react';
import type { PortalClient } from './apiShared';

export interface PortalCtx { client: PortalClient; basePath: string; isPreview: boolean }

export const PortalContext = createContext<PortalCtx | null>(null);

export function usePortal(): PortalCtx {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error('usePortal must be used inside <RoasteryPortal>');
  return ctx;
}
