// Roastery portal (2026-10-05) — screen 3: one coffee, six sections (01 The
// coffee, 02 Tasting notes + Bloom Dial, 03 Dimensions, 04 How to drink it,
// 05 Availability, 06 Anything else). Debounced autosave (about 1 s) through
// PUT .../draft sends the whole document; SAVE COFFEE submits it. Nothing is
// required. Opening a submitted coffee shows its answers; the first edit opens
// a new draft version on the server (the submitted one is never changed).

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { portalApi, PortalApiError, docToWire } from './api';
import { COPY } from './copy';
import { Chip, Field, MultiChips, Scale, SingleChips, SrcTag, formatWhen, timeAgo } from './ui';
import NotesSection, { newNoteKey } from './NotesSection';
import { ARCHETYPE_VISUALS } from '../bloom/bloomVisuals';
import type { Doc, Landing, LineupRow, PortalResponse } from './types';

const DEBOUNCE_MS = 1000;
const RETRY_MS = 4000;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Meta {
  status: 'none' | 'draft' | 'submitted';
  version: number | null;
  updatedAt: string | null;
  lastSavedByName: string | null;
  lastSavedByRespondentId: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
}

const caffeineFromPrefill = (isDecaf: boolean | null) => (isDecaf === null ? null : isDecaf ? 'decaf' : 'regular');

function blankNote() { return { key: newNoteKey(), words: '', cuppingNoteId: null as string | null }; }

function docFromCoffee(coffee: LineupRow): Doc {
  return {
    origin: coffee.origin ?? '',
    processValues: coffee.processValues ?? [],
    roastLevel: coffee.roastLevel,
    blendOrSingle: coffee.blendOrSingle,
    additivesPresent: null,
    additivesDetail: '',
    blendComponents: '',
    blendRotation: null,
    // the lineup row's is_decaf prefill prefills the caffeine answer (true = Decaf, false = Regular)
    caffeineLevel: caffeineFromPrefill(coffee.isDecaf),
    decafProcess: null,
    certifications: [],
    notes: [blankNote()],
    proposedArchetype: null,
    dimensions: {},
    dominantDimensionId: null,
    bestBrew: null,
    alsoGoodBrews: [],
    takesIt: null,
    brewNotes: '',
    availability: null,
    typicalNotice: null,
    expectedAvailability: '',
    similarWhenOut: null,
    closestCousinPortalCoffeeId: null,
    whatChanges: '',
    anythingElse: '',
  };
}

function docFromResponse(r: PortalResponse): Doc {
  const notes = r.notes
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map(n => ({ key: newNoteKey(), words: n.roasterWords, cuppingNoteId: n.cuppingNoteId }));
  return {
    origin: r.origin ?? '',
    processValues: r.processValues ?? [],
    roastLevel: r.roastLevel,
    blendOrSingle: r.blendOrSingle,
    additivesPresent: r.additivesPresent,
    additivesDetail: r.additivesDetail ?? '',
    blendComponents: r.blendComponents ?? '',
    blendRotation: r.blendRotation,
    caffeineLevel: r.caffeineLevel, // already the effective answer: an old is_decaf response is derived by the view
    decafProcess: r.decafProcess,
    certifications: r.certifications ?? [],
    notes: notes.length ? notes : [blankNote()],
    proposedArchetype: r.proposedArchetype,
    dimensions: r.dimensions ?? {},
    dominantDimensionId: r.dominantDimensionId,
    bestBrew: r.bestBrew,
    alsoGoodBrews: r.alsoGoodBrews ?? [],
    takesIt: r.takesIt,
    brewNotes: r.brewNotes ?? '',
    availability: r.availability,
    typicalNotice: r.typicalNotice,
    expectedAvailability: r.expectedAvailability ?? '',
    similarWhenOut: r.similarWhenOut,
    closestCousinPortalCoffeeId: r.closestCousinPortalCoffeeId,
    whatChanges: r.whatChanges ?? '',
    anythingElse: r.anythingElse ?? '',
  };
}

function metaFromResponse(r: PortalResponse | null): Meta {
  if (!r) return { status: 'none', version: null, updatedAt: null, lastSavedByName: null, lastSavedByRespondentId: null, submittedAt: null, submittedByName: null };
  return {
    status: r.status, version: r.version, updatedAt: r.updatedAt, lastSavedByName: r.lastSavedByName,
    lastSavedByRespondentId: r.lastSavedByRespondentId, submittedAt: r.submittedAt, submittedByName: r.submittedByName,
  };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));

export default function CoffeeScreen({ token, id, landing, respondent, onRespondentInvalid, onChanged }: {
  token: string; id: string; landing: Landing; respondent: { id: string; name: string };
  onRespondentInvalid: () => void; onChanged: () => void;
}) {
  const navigate = useNavigate();
  const v = landing.vocabulary;

  const [phase, setPhase] = useState<'loading' | 'missing' | 'error' | 'ready'>('loading');
  const [coffee, setCoffee] = useState<LineupRow | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [meta, setMeta] = useState<Meta>(metaFromResponse(null));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [, tick] = useState(0);

  const docRef = useRef<Doc | null>(null);
  const metaRef = useRef<Meta>(meta);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const mountedRef = useRef(true);

  useEffect(() => { metaRef.current = meta; }, [meta]);

  // ── load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const r = await portalApi.getCoffee(token, id);
        if (cancelled) return;
        const d = r.response ? docFromResponse(r.response) : docFromCoffee(r.coffee);
        docRef.current = d;
        setCoffee(r.coffee);
        setDoc(d);
        const m = metaFromResponse(r.response);
        metaRef.current = m;
        setMeta(m);
        setPhase('ready');
      } catch (err) {
        if (cancelled) return;
        setPhase(err instanceof PortalApiError && err.status === 404 ? 'missing' : 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [token, id]);

  // "Draft saved 2 min ago" ticks along.
  useEffect(() => {
    const i = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(i);
  }, []);

  // ── autosave ───────────────────────────────────────────────────────────────
  const flush = useCallback((): Promise<boolean> => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    chainRef.current = chainRef.current.then(async () => {
      if (!dirtyRef.current || !docRef.current) return true;
      dirtyRef.current = false;
      if (mountedRef.current) setSaveState('saving');
      try {
        const saved = await portalApi.saveDraft(token, id, respondent.id, docToWire(docRef.current));
        const m: Meta = {
          ...metaRef.current, status: 'draft', version: saved.version, updatedAt: saved.updatedAt,
          lastSavedByName: respondent.name, lastSavedByRespondentId: respondent.id,
        };
        metaRef.current = m;
        if (mountedRef.current) { setMeta(m); setSaveState(dirtyRef.current ? 'saving' : 'saved'); setError(''); }
        return true;
      } catch (err) {
        if (err instanceof PortalApiError && err.status === 400 && /respondent/i.test(err.message)) {
          onRespondentInvalid();
          return false;
        }
        dirtyRef.current = true;
        if (mountedRef.current) {
          setSaveState('error');
          setError(err instanceof PortalApiError && err.status === 400 ? err.message : '');
          if (!(err instanceof PortalApiError && err.status === 400)) {
            timerRef.current = setTimeout(() => { void flush(); }, RETRY_MS);
          }
        }
        return false;
      }
    });
    return chainRef.current;
  }, [token, id, respondent.id, respondent.name, onRespondentInvalid]);

  const markChanged = useCallback(() => {
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
  }, [flush]);

  // Flush on the way out: leaving the screen, and a page refresh or close
  // (pagehide, with keepalive so the request outlives the page).
  useEffect(() => {
    const onHide = () => {
      if (dirtyRef.current && docRef.current) {
        dirtyRef.current = false;
        void portalApi.saveDraft(token, id, respondent.id, docToWire(docRef.current), true).catch(() => undefined);
      }
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      mountedRef.current = false;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (dirtyRef.current && docRef.current) {
        dirtyRef.current = false;
        void portalApi.saveDraft(token, id, respondent.id, docToWire(docRef.current), true).catch(() => undefined);
      }
    };
  }, [token, id, respondent.id]);

  // A patch may be a function of the LATEST document (docRef), so two quick
  // changes in one render tick (e.g. two dots, two chips) never overwrite each other.
  const update = useCallback((patch: Partial<Doc> | ((d: Doc) => Partial<Doc>)) => {
    if (!docRef.current) return;
    const next = { ...docRef.current, ...(typeof patch === 'function' ? patch(docRef.current) : patch) };
    docRef.current = next;
    setDoc(next);
    markChanged();
  }, [markChanged]);

  // ── submit ─────────────────────────────────────────────────────────────────
  async function saveAndGo(openNext: boolean) {
    setSubmitting(true); setError('');
    try {
      // A coffee nobody has touched still gets its first draft, so "save" never fails for lack of one.
      if (metaRef.current.status === 'none') dirtyRef.current = true;
      const ok = await flush();
      if (!ok) { setSubmitting(false); return; }
      if (metaRef.current.status === 'draft') {
        await portalApi.submit(token, id, respondent.id);
      }
      onChanged();
      const next = openNext
        ? (() => {
            const list = landing.lineup;
            const at = list.findIndex(c => c.portalCoffeeId === id);
            const ordered = [...list.slice(at + 1), ...list.slice(0, Math.max(at, 0))];
            return ordered.find(c => c.portalCoffeeId !== id && c.state !== 'submitted');
          })()
        : undefined;
      navigate(next ? `/roastery/${token}/coffee/${next.portalCoffeeId}` : `/roastery/${token}`);
    } catch (err) {
      if (err instanceof PortalApiError && err.status === 400 && /respondent/i.test(err.message)) { onRespondentInvalid(); return; }
      setError(err instanceof PortalApiError && err.status === 400 ? err.message : 'We could not save that just now. Please try again.');
      setSubmitting(false);
    }
  }

  // ── derived ────────────────────────────────────────────────────────────────
  const cousins = useMemo(() => landing.lineup.filter(c => c.portalCoffeeId !== id).map(c => ({ value: c.portalCoffeeId, label: c.name })), [landing.lineup, id]);
  const archetypes = useMemo(() => v.archetypes.slice().sort((a, b) => a.sortOrder - b.sortOrder), [v.archetypes]);
  const dimensionOptions = useMemo(() => v.dimensions.map(d => ({ value: String(d.dimensionId), label: d.label })), [v.dimensions]);

  if (phase === 'loading') return <p className="lede" aria-live="polite">Loading…</p>;
  if (phase === 'missing') return (
    <>
      <h1><span className="b">We could not find that coffee</span></h1>
      <p className="lede"><Link to={`/roastery/${token}`} className="ghost">Back to your coffees</Link></p>
    </>
  );
  if (phase === 'error' || !doc || !coffee) return (
    <>
      <h1><span className="b">Something went wrong</span></h1>
      <p className="lede">Please refresh the page. Anything you saved is safe.</p>
    </>
  );

  const lineupNotice = landing.lineupResponse?.typicalNotice ?? null;
  const lineupSimilar = landing.lineupResponse?.similarWhenOut ?? null;
  const effectiveNotice = doc.typicalNotice ?? lineupNotice;
  const effectiveSimilar = doc.similarWhenOut ?? lineupSimilar;

  const tagFor = (has: boolean, unchanged: boolean) =>
    has && unchanged && coffee.prefillSource ? COPY.prefillTag[coffee.prefillSource] ?? null : null;
  const originTag = tagFor(!!coffee.origin, doc.origin === (coffee.origin ?? ''));
  const processTag = tagFor(coffee.processValues.length > 0, sameSet(doc.processValues, coffee.processValues));
  const roastTag = tagFor(!!coffee.roastLevel, doc.roastLevel === coffee.roastLevel);
  const blendTag = tagFor(!!coffee.blendOrSingle, doc.blendOrSingle === coffee.blendOrSingle);
  const caffeineTag = tagFor(coffee.isDecaf !== null, doc.caffeineLevel === caffeineFromPrefill(coffee.isDecaf));

  const someoneElseSaved = meta.status === 'draft' && meta.lastSavedByRespondentId && meta.lastSavedByRespondentId !== respondent.id;
  const statusText =
    saveState === 'saving' ? 'Saving…'
    : saveState === 'error' ? 'Not saved yet. We will keep trying.'
    : meta.status === 'draft' ? `Draft saved ${timeAgo(meta.updatedAt)}`
    : '';

  return (
    <>
      <div className="crumb">
        {landing.roastery.name} &nbsp;/&nbsp; <Link to={`/roastery/${token}`}>{COPY.yourCoffees}</Link> &nbsp;/&nbsp; <b>{coffee.name}</b>
      </div>
      <h1>
        <span className="a">{coffee.name}</span><br />
        <span className="b">in your words.</span>
      </h1>
      <p className="lede">{COPY.lede.before}<b>{COPY.lede.bold}</b>{COPY.lede.after}</p>

      {someoneElseSaved && (
        <p className="banner" role="status">Last saved by {meta.lastSavedByName}, {timeAgo(meta.updatedAt)}</p>
      )}
      {meta.status === 'submitted' && (
        <p className="banner" role="status">
          Submitted {formatWhen(meta.submittedAt)}{meta.submittedByName ? ` by ${meta.submittedByName}` : ''}. Changing anything starts a new version; the one you sent stays as it is.
        </p>
      )}

      {/* 01 The coffee */}
      <div className="sec"><span className="sn">01</span><h2 className="st">The coffee</h2></div>
      <div className="f">
        <label className="lab" htmlFor="rp-origin">{COPY.originLabel}<small>{COPY.originHint}</small><SrcTag text={originTag} /></label>
        <input id="rp-origin" className="in" value={doc.origin} maxLength={300} onChange={e => update({ origin: e.target.value })} />
      </div>
      <Field legend="Single origin or blend" tag={<SrcTag text={blendTag} />}>
        <SingleChips
          options={v.blendOrSingle}
          value={doc.blendOrSingle}
          // the form mirrors the service: leaving Blend clears what only a blend answers
          onChange={blendOrSingle => update(blendOrSingle === 'blend' ? { blendOrSingle } : { blendOrSingle, blendComponents: '', blendRotation: null })}
        />
      </Field>
      {doc.blendOrSingle === 'blend' && (
        <>
          <div className="f">
            <label className="lab" htmlFor="rp-blend-components">{COPY.blendComponentsLabel}<small>{COPY.blendComponentsHint}</small></label>
            <input id="rp-blend-components" className="in" value={doc.blendComponents} maxLength={300} onChange={e => update({ blendComponents: e.target.value })} />
          </div>
          <Field legend={COPY.blendRotationLabel}>
            <SingleChips options={v.blendRotation} value={doc.blendRotation} onChange={blendRotation => update({ blendRotation })} />
          </Field>
        </>
      )}
      <Field legend={COPY.caffeineLabel} tag={<SrcTag text={caffeineTag} />}>
        <SingleChips
          options={v.caffeine}
          value={doc.caffeineLevel}
          onChange={caffeineLevel => update(caffeineLevel === 'decaf' || caffeineLevel === 'half_caff' ? { caffeineLevel } : { caffeineLevel, decafProcess: null })}
        />
      </Field>
      {(doc.caffeineLevel === 'decaf' || doc.caffeineLevel === 'half_caff') && (
        <Field legend={COPY.decafProcessLabel}>
          <SingleChips options={v.decafProcess} value={doc.decafProcess} onChange={decafProcess => update({ decafProcess })} />
        </Field>
      )}
      <Field legend="Process" tag={<SrcTag text={processTag} />}>
        <MultiChips options={v.process} values={doc.processValues} onChange={processValues => update({ processValues })} />
      </Field>
      <Field legend={COPY.additivesLabel} hint={COPY.additivesHint}>
        <SingleChips
          options={[{ value: 'yes', label: COPY.yes }, { value: 'no', label: COPY.no }]}
          value={doc.additivesPresent === null ? null : doc.additivesPresent ? 'yes' : 'no'}
          onChange={x => update(x === 'yes' ? { additivesPresent: true } : { additivesPresent: x === null ? null : false, additivesDetail: '' })}
        />
      </Field>
      {doc.additivesPresent === true && (
        <div className="f">
          <label className="lab" htmlFor="rp-additives-detail">{COPY.additivesDetailLabel}</label>
          <input id="rp-additives-detail" className="in" value={doc.additivesDetail} maxLength={300} onChange={e => update({ additivesDetail: e.target.value })} />
        </div>
      )}
      <Field legend="Roast level" tag={<SrcTag text={roastTag} />}>
        <SingleChips options={v.roastLevel} value={doc.roastLevel} onChange={roastLevel => update({ roastLevel })} />
      </Field>
      <Field legend={COPY.certificationsLabel}>
        <MultiChips
          options={v.certification}
          values={doc.certifications}
          // "None" is a real answer and clears the others; picking another one drops None; nothing picked = not answered
          onChange={next => update(cur => {
            const added = next.find(x => !cur.certifications.includes(x));
            return { certifications: added === 'none' ? ['none'] : next.filter(x => x !== 'none') };
          })}
        />
      </Field>

      {/* 02 Tasting notes, then the Bloom Dial question */}
      <div className="sec"><span className="sn">02</span><h2 className="st">Tasting notes</h2></div>
      <NotesSection notes={doc.notes} wheel={v.wheel} onChange={notes => update({ notes })} />

      <Field legend={COPY.bloomDialLabel} hint={COPY.bloomDialHint}>
        <div className="agrid" role="radiogroup">
          {archetypes.map(a => {
            const vis = ARCHETYPE_VISUALS[a.code];
            const on = doc.proposedArchetype === a.code;
            return (
              <button
                key={a.code}
                type="button"
                role="radio"
                aria-checked={on}
                className={`acard${on ? ' on' : ''}`}
                style={vis ? ({ '--c': vis.color, '--t': vis.tint } as CSSProperties) : undefined}
                onClick={() => update({ proposedArchetype: on ? null : a.code })}
              >
                <span className="dialwrap">{vis ? <img className="dialimg" src={vis.dial} alt="" /> : null}</span>
                <span className="atext">
                  <span className="anum" style={{ display: 'block' }}>{vis?.num ?? ''} —</span>
                  <span className="aname" style={{ display: 'block' }}>{a.label}</span>
                  {vis && <span className="adesc" style={{ display: 'block' }}>{vis.tagline}</span>}
                  {a.code === 'experimental' && <span className="awarn" style={{ display: 'block' }}>{COPY.experimentalWarning}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      {/* 03 Dimensions */}
      <div className="sec"><span className="sn">03</span><h2 className="st">Dimensions</h2></div>
      <div className="help">{COPY.dimensionsHelp}</div>
      <div className="dims">
        {v.dimensions.map(d => (
          <Scale
            key={d.dimensionId}
            id={`rp-dim-${d.dimensionId}`}
            label={d.label}
            low={d.lowLabel}
            high={d.highLabel}
            value={doc.dimensions[String(d.dimensionId)]}
            onChange={val => update(cur => {
              const next = { ...cur.dimensions };
              if (val === undefined) delete next[String(d.dimensionId)]; else next[String(d.dimensionId)] = val;
              return { dimensions: next };
            })}
          />
        ))}
      </div>
      <Field legend={COPY.dominantLabel} hint={COPY.dominantHint}>
        <SingleChips
          options={dimensionOptions}
          value={doc.dominantDimensionId === null ? null : String(doc.dominantDimensionId)}
          onChange={x => update({ dominantDimensionId: x === null ? null : Number(x) })}
        />
      </Field>

      {/* 04 How to drink it */}
      <div className="sec"><span className="sn">04</span><h2 className="st">How to drink it</h2></div>
      <div className="row">
        <Field legend={COPY.whereItShines}>
          <SingleChips
            options={v.brewMethods}
            value={doc.bestBrew}
            onChange={bestBrew => update(cur => ({ bestBrew, alsoGoodBrews: bestBrew ? cur.alsoGoodBrews.filter(m => m !== bestBrew) : cur.alsoGoodBrews }))}
          />
        </Field>
        <Field legend="Also good as">
          <div className="chips" role="group">
            {v.brewMethods.map(o => {
              const on = doc.alsoGoodBrews.includes(o.value);
              return (
                <Chip key={o.value} role="checkbox" on={on} disabled={doc.bestBrew === o.value}
                  onClick={() => update(cur => ({ alsoGoodBrews: cur.alsoGoodBrews.includes(o.value) ? cur.alsoGoodBrews.filter(m => m !== o.value) : [...cur.alsoGoodBrews, o.value] }))}>
                  {o.label}
                </Chip>
              );
            })}
          </div>
        </Field>
      </div>
      <Field legend={COPY.milkLabel}>
        <SingleChips options={v.takesIt} value={doc.takesIt} onChange={takesIt => update({ takesIt })} />
      </Field>
      <div className="f">
        <label className="lab" htmlFor="rp-brew-notes">{COPY.brewNotesLabel}<small>optional</small></label>
        <textarea id="rp-brew-notes" className="in" value={doc.brewNotes} maxLength={2000} placeholder={COPY.brewNotesPlaceholder} onChange={e => update({ brewNotes: e.target.value })} />
      </div>

      {/* 05 Availability */}
      <div className="sec"><span className="sn">05</span><h2 className="st">Availability</h2></div>
      <Field legend="How it lives in your lineup">
        <SingleChips options={v.availability} value={doc.availability} onChange={availability => update({ availability })} />
      </Field>
      <div className="row">
        <Field legend={COPY.noticeLabel}>
          <SingleChips
            options={v.notice}
            value={effectiveNotice}
            onChange={x => {
              // Clicking the selected chip steps back to "same as your lineup"; clicking another stores an override.
              if (x === null) { if (doc.typicalNotice !== null) update({ typicalNotice: null }); return; }
              update({ typicalNotice: x === lineupNotice ? null : x });
            }}
          />
          {doc.typicalNotice === null && lineupNotice && <p className="quiet">{COPY.sameAsLineup}</p>}
        </Field>
        <div className="f">
          <label className="lab" htmlFor="rp-expected">{COPY.expectedLabel}<small>{COPY.expectedHint}</small></label>
          <input id="rp-expected" className="in" value={doc.expectedAvailability} maxLength={300} placeholder={COPY.expectedPlaceholder} onChange={e => update({ expectedAvailability: e.target.value })} />
        </div>
      </div>
      <Field legend={COPY.similarLabel}>
        <SingleChips
          options={v.similar}
          value={effectiveSimilar}
          onChange={x => {
            if (x === null) { if (doc.similarWhenOut !== null) update({ similarWhenOut: null }); return; }
            update({ similarWhenOut: x === lineupSimilar ? null : x });
          }}
        />
        {doc.similarWhenOut === null && lineupSimilar && <p className="quiet">{COPY.sameAsLineup}</p>}
      </Field>
      <Field legend={COPY.cousinLabel}>
        {cousins.length === 0
          ? <p className="quiet">No other coffees in your lineup yet.</p>
          : <SingleChips options={cousins} value={doc.closestCousinPortalCoffeeId} onChange={closestCousinPortalCoffeeId => update({ closestCousinPortalCoffeeId })} />}
      </Field>
      <div className="f">
        <label className="lab" htmlFor="rp-changes">{COPY.changesLabel}<small>{COPY.changesHint}</small></label>
        <input id="rp-changes" className="in" value={doc.whatChanges} maxLength={300} onChange={e => update({ whatChanges: e.target.value })} />
      </div>

      {/* 06 Anything else */}
      <div className="sec"><span className="sn">06</span><h2 className="st">Anything else</h2></div>
      <div className="f">
        <label className="lab" htmlFor="rp-else" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Anything else</label>
        <textarea id="rp-else" className="in" value={doc.anythingElse} maxLength={2000} placeholder={COPY.anythingElsePlaceholder} onChange={e => update({ anythingElse: e.target.value })} />
      </div>

      {error && <p className="err" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn" type="button" disabled={submitting} onClick={() => void saveAndGo(false)}>{COPY.saveCoffee}&nbsp;&nbsp;→</button>
        <button className="ghost" type="button" disabled={submitting} onClick={() => void saveAndGo(true)}>{COPY.saveAndNext}</button>
        <span className="saved" aria-live="polite">{statusText}</span>
      </div>
    </>
  );
}
