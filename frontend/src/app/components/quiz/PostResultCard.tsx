// Usual Drink 1 (2026-11-12), B2 — the optional card under the quiz result:
// the card-eligible fields (active, with a prompt) in sort order, one control
// each by picker (BrewFieldControl), Save / Skip. Optional and non-blocking:
// it renders after the result is saved and the reveal has finished, outside
// the ceremony and the email gate, and never on a proxy quiz (FlavorQuiz
// decides; the server refuses a proxy session too). Every question, answer
// and button word comes from GET /api/quiz/post-result/options; an empty
// field list renders nothing (the data kill switch). Save sends every shown
// field; the server records a declined row for each one left unanswered.
import { useEffect, useRef, useState } from 'react';
import { getPostResultOptions, savePostResultCard, logQuizFunnelEvent, type BrewProfileOptions } from '../../lib/api';
import { reportError } from '../../lib/errorReporter';
import BrewFieldControl, { emptyDraft, valueFromDraft, draftTakesWords, type BrewDraft } from './BrewFieldControl';

export default function PostResultCard({ quizSessionId, funnelSessionKey }: { quizSessionId: string; funnelSessionKey: string }) {
  const [options, setOptions] = useState<BrewProfileOptions | null>(null);
  const [drafts, setDrafts] = useState<Record<string, BrewDraft>>({});
  const [words, setWords] = useState<Record<string, string>>({});
  const [state, setState] = useState<'open' | 'saving' | 'done'>('open');
  const [error, setError] = useState('');
  const shownLogged = useRef(false);

  useEffect(() => {
    let live = true;
    getPostResultOptions()
      .then(o => {
        if (!live) return;
        setOptions(o);
        setDrafts(Object.fromEntries(o.fields.map(f => [f.code, emptyDraft(f)])));
      })
      .catch(err => reportError('[PostResultCard/options]', err));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (options?.fields.length && !shownLogged.current) {
      shownLogged.current = true;
      logQuizFunnelEvent(funnelSessionKey, 'post_result_shown').catch(() => undefined);
    }
  }, [options, funnelSessionKey]);

  if (!options || options.fields.length === 0 || state === 'done') return null;
  const { fields, copy } = options;

  async function submit(skip: boolean) {
    setState('saving');
    setError('');
    const answers = skip ? [] : fields.flatMap(f => {
      const value = valueFromDraft(f, drafts[f.code] ?? null);
      if (value === undefined) return [];
      const w = draftTakesWords(f, drafts[f.code] ?? null) ? (words[f.code] ?? '').trim() : '';
      return [w ? { field: f.code, value, words: w } : { field: f.code, value }];
    });
    try {
      await savePostResultCard({ quizSessionId, shown: fields.map(f => f.code), answers });
      logQuizFunnelEvent(funnelSessionKey, skip ? 'post_result_skipped' : 'post_result_saved').catch(() => undefined);
      setState('done');
    } catch (err) {
      reportError('[PostResultCard/save]', err);
      setError(err instanceof Error ? err.message : String(err));
      setState('open');
    }
  }

  return (
    <div className="qz-col" data-testid="post-result-card">
      <div className="flex flex-col gap-5 rounded-2xl border border-[#a33726]/15 bg-white/60 p-5">
        {copy.post_result_title && <p className="text-[11px] uppercase tracking-[0.2em] text-[#a33726]/60">{copy.post_result_title}</p>}
        {fields.map(f => (
          <div key={f.code} className="flex flex-col gap-2">
            <p className="text-sm text-[#3a2e28]">{f.prompt}</p>
            <BrewFieldControl field={f} draft={drafts[f.code] ?? null} words={words[f.code] ?? ''} copy={copy}
              onChange={d => setDrafts(x => ({ ...x, [f.code]: d }))}
              onWords={w => setWords(x => ({ ...x, [f.code]: w }))} />
          </div>
        ))}
        {error && <p className="text-xs text-[#a33726]">{error}</p>}
        <div className="flex gap-4 text-[11px] uppercase tracking-[0.15em]">
          <button type="button" disabled={state === 'saving'} onClick={() => submit(false)} data-testid="post-result-save"
            className="text-[#a33726] border-b border-[#a33726] pb-0.5 disabled:opacity-50">{copy.post_result_save}</button>
          <button type="button" disabled={state === 'saving'} onClick={() => submit(true)} data-testid="post-result-skip"
            className="text-[#a33726]/60 hover:text-[#a33726] disabled:opacity-50">{copy.post_result_skip}</button>
        </div>
      </div>
    </div>
  );
}
