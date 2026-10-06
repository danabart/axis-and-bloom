// Roastery portal (2026-10-05) — screen 2: the lineup. One row per coffee with
// its state (Not started, In progress n of 6, Submitted with date and who), a
// dashed "+ A coffee not listed" row, and a short "About your lineup" block
// with the two lineup-wide questions and their own save.

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { PortalApiError } from './apiShared';
import { usePortal } from './portalContext';
import { COPY } from './copy';
import { Chip, Field, SingleChips, formatWhen } from './ui';
import type { Landing, LineupRow } from './types';

function stateLabel(c: LineupRow): string {
  if (c.state === 'submitted') {
    const by = c.submittedByName ? `, ${c.submittedByName}` : '';
    return `Submitted, ${formatWhen(c.submittedAt)}${by}${c.hasOpenDraft ? ' · edit in progress' : ''}`;
  }
  if (c.state === 'in_progress') return `In progress, ${c.sectionsAnswered} of 6`;
  return COPY.notStarted;
}

export default function LineupScreen({ token, landing, respondentId, onRespondentInvalid, onChanged }: {
  token: string; landing: Landing; respondentId: string;
  onRespondentInvalid: () => void; onChanged: () => void;
}) {
  const navigate = useNavigate();
  const { client: portalApi, basePath } = usePortal();
  const v = landing.vocabulary;
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [busy, setBusy] = useState(false);

  const lr = landing.lineupResponse;
  const [notice, setNotice] = useState<string | null>(lr?.typicalNotice ?? null);
  const [similar, setSimilar] = useState<string | null>(lr?.similarWhenOut ?? null);
  // "Which of these do you sell most?": up to three of the roastery's own coffees, in pick order.
  const [best, setBest] = useState<string[]>(lr?.bestSellers.map(b => b.portalCoffeeId) ?? []);
  const [bestNote, setBestNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<{ when: string; by: string | null } | null>(
    lr?.status === 'submitted' ? { when: lr.submittedAt ?? lr.updatedAt, by: lr.submittedByName } : null
  );
  const [lineupError, setLineupError] = useState('');

  function failure(err: unknown, fallback: string): string {
    if (err instanceof PortalApiError && err.status === 400 && /respondent/i.test(err.message)) { onRespondentInvalid(); return ''; }
    return err instanceof PortalApiError && err.status === 400 ? err.message : fallback;
  }

  async function addCoffee(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setAddError('');
    try {
      const created = await portalApi.addCoffee(token, newName, respondentId);
      navigate(`${basePath}/coffee/${created.id}`);
    } catch (err) {
      setAddError(failure(err, 'We could not add that just now. Please try again.'));
      setBusy(false);
    }
  }

  async function saveLineup() {
    setSaving(true); setLineupError('');
    try {
      await portalApi.saveLineup(token, respondentId, { typicalNotice: notice, similarWhenOut: similar, bestSellers: best });
      const sub = await portalApi.submitLineup(token, respondentId);
      setSavedAt({ when: sub.submittedAt, by: null });
      setDirty(false);
      onChanged();
    } catch (err) {
      setLineupError(failure(err, 'We could not save that just now. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="crumb">{landing.roastery.name} &nbsp;/&nbsp; <b>{COPY.yourCoffees}</b></div>
      <h1>
        <span className="a">Hello, {landing.roastery.name}.</span><br />
        <span className="b">Your coffees,</span><br />
        <span className="b">in your words.</span>
      </h1>
      <p className="lede">{COPY.lede.before}<b>{COPY.lede.bold}</b>{COPY.lede.after}</p>

      <div className="sec"><span className="sn">{String(landing.counts.submitted).padStart(2, '0')}/{String(landing.counts.total).padStart(2, '0')}</span><h2 className="st">{COPY.yourCoffees}</h2></div>
      <div className="rows">
        {landing.lineup.map(c => (
          <Link key={c.portalCoffeeId} to={`${basePath}/coffee/${c.portalCoffeeId}`} className={`crow ${c.state}`}>
            <span className="cn">{c.name}</span>
            <span className="cs">{stateLabel(c)}</span>
          </Link>
        ))}
      </div>

      {adding ? (
        <form className="addbox" onSubmit={addCoffee} noValidate>
          <label className="lab" htmlFor="rp-add-name">{COPY.addCoffeeLabel}</label>
          <input id="rp-add-name" className="in" value={newName} maxLength={120} autoFocus onChange={e => setNewName(e.target.value)} />
          {addError && <p className="err" role="alert">{addError}</p>}
          <div className="actions" style={{ marginTop: 18 }}>
            <button className="btn" type="submit" disabled={busy || !newName.trim()}>ADD&nbsp;&nbsp;→</button>
            <button className="ghost" type="button" onClick={() => { setAdding(false); setNewName(''); setAddError(''); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="crow add" onClick={() => setAdding(true)}>{COPY.addCoffee}</button>
      )}

      <div className="sec"><span className="sn">+</span><h2 className="st">{COPY.lineupHeading}</h2></div>
      <div className="help">{COPY.lineupHint}</div>
      <Field legend={COPY.noticeLabel}>
        <SingleChips options={v.notice} value={notice} onChange={x => { setNotice(x); setDirty(true); }} />
      </Field>
      <Field legend={COPY.similarLabel}>
        <SingleChips options={v.similar} value={similar} onChange={x => { setSimilar(x); setDirty(true); }} />
      </Field>
      <fieldset className="f">
        <legend className="lab">{COPY.bestSellersLabel}<small>{COPY.bestSellersHint}</small></legend>
        <div className="chips" role="group">
          {landing.lineup.map(c => {
            const at = best.indexOf(c.portalCoffeeId);
            return (
              <Chip key={c.portalCoffeeId} role="checkbox" on={at !== -1}
                onClick={() => {
                  setBestNote('');
                  if (at !== -1) { setBest(best.filter(x => x !== c.portalCoffeeId)); setDirty(true); return; }
                  if (best.length >= 3) { setBestNote('You can pick up to three. Tap one to remove it first.'); return; }
                  setBest([...best, c.portalCoffeeId]); setDirty(true);
                }}>
                {at !== -1 ? `${at + 1} · ` : ''}{c.name}
              </Chip>
            );
          })}
        </div>
        {bestNote && <p className="quiet" role="status">{bestNote}</p>}
      </fieldset>
      {lineupError && <p className="err" role="alert">{lineupError}</p>}
      <div className="actions" style={{ marginTop: 28 }}>
        <button className="btn" type="button" disabled={saving || !dirty} onClick={saveLineup}>SAVE&nbsp;&nbsp;→</button>
        <span className="saved" aria-live="polite">
          {saving ? 'Saving…' : savedAt && !dirty ? `Saved ${formatWhen(savedAt.when)}${savedAt.by ? `, ${savedAt.by}` : ''}` : ''}
        </span>
      </div>
    </>
  );
}
