// Roastery portal (2026-10-05) — screen 1: who is filling this in. Shown when
// this device has no stored respondent for this token. Name and email,
// prefilled from the link's contact when it was created for a named person.
// The server is the record; the device only remembers the respondent id.

import { useState, type FormEvent } from 'react';
import { portalApi, PortalApiError } from './api';
import { COPY } from './copy';

export default function WhoScreen({ token, contactName, contactEmail, onDone }: {
  token: string; contactName: string | null; contactEmail: string | null;
  onDone: (respondent: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState(contactName ?? '');
  const [email, setEmail] = useState(contactEmail ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await portalApi.registerRespondent(token, name, email);
      onDone({ id: r.respondentId, name: r.name });
    } catch (err) {
      setError(err instanceof PortalApiError && err.status === 400 ? err.message : 'We could not save that just now. Please try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <div className="crumb">Axis &amp; Bloom</div>
      <h1><span className="b">{COPY.whoTitle}</span></h1>
      <p className="lede">{COPY.whoHint}</p>
      <form onSubmit={submit} noValidate>
        <div className="f">
          <label className="lab" htmlFor="rp-who-name">Your name</label>
          <input id="rp-who-name" className="in" value={name} maxLength={120} autoComplete="name" onChange={e => setName(e.target.value)} />
        </div>
        <div className="f">
          <label className="lab" htmlFor="rp-who-email">Your email</label>
          <input id="rp-who-email" className="in" type="email" inputMode="email" value={email} maxLength={254} autoComplete="email" onChange={e => setEmail(e.target.value)} />
        </div>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="actions">
          <button className="btn" type="submit" disabled={busy || !name.trim() || !email.trim()}>CONTINUE&nbsp;&nbsp;→</button>
        </div>
      </form>
    </>
  );
}
