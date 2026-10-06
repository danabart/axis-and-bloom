// Roastery portal (2026-10-05) — the partner page: /roastery/:token and
// /roastery/:token/coffee/:id. One private, revocable link per roastery; no
// sign-in. Outside <PublicLayout> and not wrapped in <PrelaunchGate> (see
// PRELAUNCH_OPEN_ROUTES): no site navigation, no footer links, no newsletter
// modal, no consent banner, no analytics events, no Liam. Noindex, nofollow.
//
// Everything on the page (roastery name, coffee list, prefills, every chip
// group, the dimensions, the wheel, the family cards) is read from the DB via
// GET /api/roastery-portal/:token. The wording of the new/changed lines lives
// in ./copy.ts (re-exported here as COPY) for Camila's review.
//
// Brief: backend/src/features/roastery_portal/CLAUDE_CODE_PROMPT_ROASTERY_PORTAL_1.md

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import './portal.css';
import { portalApi } from './api';
import { PortalApiError, type PortalClient } from './apiShared';
import { PortalContext } from './portalContext';
import { COPY } from './copy';
import WhoScreen from './WhoScreen';
import LineupScreen from './LineupScreen';
import CoffeeScreen from './CoffeeScreen';
import { ARCHETYPE_VISUALS } from '../bloom/bloomVisuals';
import type { Landing } from './types';

export { COPY };

interface Respondent { id: string; name: string }

// The server is the record; this device only remembers who it is, once per token.
const storageKey = (token: string) => `rp:respondent:${token}`;
function readRespondent(token: string): Respondent | null {
  try {
    const raw = localStorage.getItem(storageKey(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.id === 'string' && typeof parsed?.name === 'string' ? parsed : null;
  } catch { return null; }
}
function writeRespondent(token: string, r: Respondent | null) {
  try {
    if (r) localStorage.setItem(storageKey(token), JSON.stringify(r));
    else localStorage.removeItem(storageKey(token));
  } catch { /* storage unavailable (private window, blocked): the page still works, it just asks again */ }
}

// The preview banner: in the page flow (sticky, never over the form), one slim line, so it also fits a phone.
export function PreviewBanner({ backTo }: { backTo: string }) {
  return (
    <div className="preview-banner" role="note">
      <span>Preview. Nothing you do here is saved.</span>
      <Link to={backTo}>Back to admin</Link>
    </div>
  );
}

/** Set by the admin preview route only; absent on the public route. */
export interface PreviewMode { client: PortalClient; basePath: string; backTo: string; roasterId: string }

function Chrome({ right, children, bandCodes, banner }: { right?: string; children: React.ReactNode; bandCodes: string[]; banner?: React.ReactNode }) {
  return (
    <div className="rp">
      {banner}
      <div className="bar">
        <div className="wm">AXIS &amp; BLOOM <small>ROASTER PORTAL</small></div>
        {right ? <div className="who">{right}</div> : null}
      </div>
      <main className="wrap">{children}</main>
      <p className="usage">{COPY.usage}</p>
      <footer>
        <div className="fromto">FROM: AXIS &amp; BLOOM — TO: OUR ROASTERS</div>
        <div className="band">
          {bandCodes.map(code => <div key={code} style={{ background: ARCHETYPE_VISUALS[code]?.color }} />)}
        </div>
      </footer>
    </div>
  );
}

export default function RoasteryPortal({ preview }: { preview?: PreviewMode } = {}) {
  const params = useParams();
  const id = params.id;
  // In preview there is no token: the roastery id stands in so every screen keeps its (token, id) arguments.
  const token = preview ? preview.roasterId : (params.token ?? '');
  const client: PortalClient = preview ? preview.client : portalApi;
  const basePath = preview ? preview.basePath : `/roastery/${token}`;
  const ctx = useMemo(() => ({ client, basePath, isPreview: !!preview }), [client, basePath, preview]);
  const [status, setStatus] = useState<'loading' | 'inactive' | 'error' | 'ready'>('loading');
  const [landing, setLanding] = useState<Landing | null>(null);
  const [respondent, setRespondent] = useState<Respondent | null>(() => (preview ? null : readRespondent(token)));

  // Noindex, nofollow (the hosting header does the same for crawlers that never run JS),
  // and the page ground, restored on the way out.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = 'Axis & Bloom · Roaster Portal';
    const prevBg = document.body.style.background;
    document.body.style.background = '#f2f1ea';
    return () => {
      meta.remove();
      document.title = prevTitle;
      document.body.style.background = prevBg;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      setLanding(await client.landing(token));
      setStatus('ready');
    } catch (err) {
      // Unknown and revoked tokens are the same 404, so they get the same page.
      setStatus(err instanceof PortalApiError && err.status === 404 ? 'inactive' : 'error');
    }
  }, [token, client]);

  // Load on arrival, and again whenever we come back to the lineup so its states are current.
  useEffect(() => { void load(); }, [load, id]);

  // Preview keeps the respondent in React state only: nothing is read from or written to localStorage.
  const onWho = useCallback((r: Respondent) => { if (!preview) writeRespondent(token, r); setRespondent(r); }, [token, preview]);
  const onRespondentInvalid = useCallback(() => { if (!preview) writeRespondent(token, null); setRespondent(null); }, [token, preview]);

  const bandCodes = landing?.vocabulary.archetypes.slice().sort((a, b) => a.sortOrder - b.sortOrder).map(a => a.code) ?? [];

  if (status === 'inactive') {
    return (
      <Chrome bandCodes={[]} banner={preview ? <PreviewBanner backTo={preview.backTo} /> : undefined}>
        <div className="centered" style={{ padding: '56px 0' }}>
          <h1><span className="b">{COPY.inactiveTitle}</span></h1>
          <p className="lede">{COPY.inactiveBody}</p>
        </div>
      </Chrome>
    );
  }
  if (status === 'loading' || (status === 'ready' && !landing)) {
    return <Chrome bandCodes={[]} banner={preview ? <PreviewBanner backTo={preview.backTo} /> : undefined}><p className="lede" aria-live="polite">Loading…</p></Chrome>;
  }
  if (status === 'error' || !landing) {
    return (
      <Chrome bandCodes={[]} banner={preview ? <PreviewBanner backTo={preview.backTo} /> : undefined}>
        <h1><span className="b">Something went wrong</span></h1>
        <p className="lede">Please refresh the page in a moment.</p>
      </Chrome>
    );
  }

  const right = `${landing.roastery.name} · ${landing.counts.submitted} of ${landing.counts.total} coffees done`;

  return (
    <PortalContext.Provider value={ctx}>
    <Chrome right={right} bandCodes={bandCodes} banner={preview ? <PreviewBanner backTo={preview.backTo} /> : undefined}>
      {!respondent ? (
        <WhoScreen token={token} contactName={landing.contact.name} contactEmail={landing.contact.email} onDone={onWho} />
      ) : id ? (
        <CoffeeScreen key={id} token={token} id={id} landing={landing} respondent={respondent} onRespondentInvalid={onRespondentInvalid} onChanged={() => void load()} />
      ) : (
        <LineupScreen key={landing.lineupResponse?.id ?? 'none'} token={token} landing={landing} respondentId={respondent.id} onRespondentInvalid={onRespondentInvalid} onChanged={() => void load()} />
      )}
    </Chrome>
    </PortalContext.Provider>
  );
}
