import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Wrap, Caps, Titled, Btn, ArrowIcon } from '../chrome';
import { Photo, type RegistryImage } from '../home/Photo';
import './quiz.css';

// Website 7A (2026-11-06): Find my flavor's scenes in option B's language
// (source/flavor-b/build.py): a photo per scene under a dark wash, paper text,
// A–D rows, the progress bar that replaces the header. Render only: every
// state, fetch, score, branch and funnel call stays in FlavorQuiz.tsx.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_7A_FIND_MY_FLAVOR_ENTRY_AND_QUESTIONS.md

export interface SceneImage { asset: RegistryImage; fallback: RegistryImage }

/** The photographic scene: full-bleed photo, the wash, content on top. */
export function Scene({ image, position, label, children, testId }: {
  image: SceneImage;
  position?: string;
  label: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="qz-scene" aria-label={label} data-testid={testId}>
      <Photo asset={image.asset} fallback={image.fallback} alt="" sizes="100vw" className="qz-bg" loading="eager"
        style={position ? { objectPosition: position } : undefined} />
      <div className="qz-wash" aria-hidden="true" />
      {children}
    </section>
  );
}

/** Loading and error states, on the entry photo. */
export function StatusScene({ image, header, title, children }: { image: SceneImage; header: ReactNode; title: string; children?: ReactNode }) {
  return (
    <Scene image={image} label={title} testId="quiz-status">
      {header}
      <Wrap className="qz-in">
        <div className="qz-entry" role="status" aria-live="polite">
          <h1 className="qz-eh" style={{ fontSize: 'clamp(32px, 3.6vw, 56px)', maxWidth: '18ch' }}>{title}</h1>
          {children}
        </div>
      </Wrap>
    </Scene>
  );
}

/** The bar that replaces the header while questions run: name, one segment per question, Save progress, Exit ×. */
export function ProgressBar({ name, total, done, extra, showSave, onExit }: {
  name: string;
  total: number;
  /** segments on (questions answered or current) */
  done: number;
  /** shown after the segments on the branch scene ("One more"), without renumbering */
  extra?: string | null;
  showSave: boolean;
  onExit: () => void;
}) {
  return (
    <Wrap className="qz-bar" data-testid="quiz-progress">
      <Caps weight={400}>{name ? `${name}’s profile` : 'Your profile'}</Caps>
      <span className="qz-prog" role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(done, total)}>
        {Array.from({ length: total }, (_, i) => <i key={i} className={i < done ? 'on' : undefined} />)}
        {extra && <Caps weight={400} style={{ marginLeft: 10 }}>{extra}</Caps>}
      </span>
      <span className="qz-bar-r">
        {showSave && <a href="/sign-in" className="ab-caps qz-ulink" style={{ fontWeight: 400 }}>Save progress</a>}
        <button type="button" className="ab-caps qz-plain" onClick={onExit}>Exit ×</button>
      </span>
    </Wrap>
  );
}

export interface SceneAnswer { id: string; text: string }

/**
 * One question: a radio group of rows lettered A… (the data decides how many).
 * Keyboard: the letter keys pick an answer; ↑/↓ move between rows; Enter/Space
 * picks the focused row. `counter` is announced politely ("2 / 6", "One more").
 */
export function QuestionScene({ image, bar, counter, question, answers, selectedId, onSelect, onBack, status, testId }: {
  image: SceneImage;
  bar: ReactNode;
  counter: ReactNode;
  question: string;
  answers: SceneAnswer[];
  selectedId: string | null;
  onSelect: (id: string, index: number) => void;
  onBack?: (() => void) | null;
  status?: ReactNode;
  testId?: string;
}) {
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const headingId = `qz-h-${testId ?? 'q'}`;

  // A, B, C … pick the matching answer anywhere on the scene (not while typing, not with modifiers).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key.length !== 1) return;
      const i = e.key.toUpperCase().charCodeAt(0) - 65;
      if (i < 0 || i >= answers.length) return;
      e.preventDefault();
      rows.current[i]?.focus();
      onSelect(answers[i].id, i);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [answers, onSelect]);

  const selectedIndex = answers.findIndex(a => a.id === selectedId);
  function onRowKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : null;
    if (next == null) return;
    e.preventDefault();
    rows.current[(next + answers.length) % answers.length]?.focus();
  }

  return (
    <Scene image={image} label={question} testId={testId}>
      {bar}
      <Wrap className="qz-in">
        <div className="qz-qblock">
          <div className="qz-qtop">
            {onBack
              ? <button type="button" className="ab-caps qz-plain" onClick={onBack} data-testid="quiz-back">← Back</button>
              : <span />}
            <Caps weight={400} aria-live="polite" data-testid="quiz-counter">{counter}</Caps>
          </div>
          <h2 className="qz-qh" id={headingId}>{question}</h2>
          <div className={`qz-answers${answers.length > 4 ? ' many' : ''}`} role="radiogroup" aria-labelledby={headingId}>
            {answers.map((a, i) => {
              const checked = a.id === selectedId;
              const focusable = selectedIndex >= 0 ? checked : i === 0;
              return (
                <button
                  key={a.id}
                  ref={el => { rows.current[i] = el; }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={focusable ? 0 : -1}
                  className="qz-ans"
                  onClick={() => onSelect(a.id, i)}
                  onKeyDown={e => onRowKey(e, i)}
                  data-testid="quiz-answer"
                >
                  <Caps weight={400} aria-hidden="true">{String.fromCharCode(65 + i)}</Caps>
                  <span className="qz-ans-t">{a.text}</span>
                  <ArrowIcon size={18} />
                </button>
              );
            })}
          </div>
          <div className="qz-status" aria-live="polite">{status}</div>
        </div>
      </Wrap>
    </Scene>
  );
}

/** "Exit ×" with answers given: the design's own confirm, never window.confirm. */
export function ExitConfirm({ onLeave, onStay }: { onLeave: () => void; onStay: () => void }) {
  const stayRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    stayRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onStay(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onStay]);
  return (
    <div className="qz-confirm" role="alertdialog" aria-modal="true" aria-labelledby="qz-confirm-h" data-testid="quiz-exit-confirm">
      <div className="qz-confirm-in">
        <h2 id="qz-confirm-h">Leave your profile here?</h2>
        <p style={{ margin: 0, fontWeight: 300, lineHeight: 1.55 }}>You can start again from the first question any time.</p>
        <div className="qz-confirm-row" ref={stayRef}>
          <Btn tone="paper" onClick={onStay} icon={false}>Keep going</Btn>
          <button type="button" className="ab-caps qz-ulink" onClick={onLeave}>Leave</button>
        </div>
      </div>
    </div>
  );
}

/** The entry scene's text column (title, lead, name field, Begin, sign-in or the signed-in line, bottom bar). */
export function EntryBody({ leadCount, name, onName, onBegin, signedInLine, showSignIn }: {
  /** the question count as a word ("Six"), from the questions payload (D15) */
  leadCount: string;
  name: string;
  onName: (v: string) => void;
  onBegin: () => void;
  signedInLine: string | null;
  showSignIn: boolean;
}) {
  return (
    <Wrap className="qz-in">
      <div className="qz-entry" data-testid="quiz-entry">
        <Titled style={{ alignSelf: 'flex-start' }}>Find my flavor</Titled>
        {signedInLine && <Caps weight={400} data-testid="quiz-signed-in">{signedInLine}</Caps>}
        <h1 className="qz-eh">Whose palate are we profiling today?</h1>
        <p className="qz-ep" data-testid="quiz-lead">
          {leadCount} questions about moments, reactions and familiar foods, in your own words. About three minutes. On the other side: your family of taste and your place on the dial.
        </p>
        <form className="qz-field" onSubmit={e => { e.preventDefault(); onBegin(); }}>
          <label htmlFor="qz-name" className="ab-caps" style={{ fontWeight: 600 }}>First name (yours or whoever you’re profiling)</label>
          <input id="qz-name" type="text" autoComplete="given-name" value={name} onChange={e => onName(e.target.value)} data-testid="quiz-name" />
        </form>
        <div className="qz-efoot">
          <Btn tone="paper" onClick={onBegin}>Begin my profile</Btn>
          {showSignIn && (
            <Caps weight={400}>Already have a profile? <a href="/sign-in?mode=signin&redirect=/find-my-flavor" className="qz-ulink" style={{ fontWeight: 600 }}>Sign in</a></Caps>
          )}
        </div>
      </div>
      <Caps as="div" weight={400} className="qz-ebar">
        <span>Every answer counts. We listen for moments and reactions.</span>
        <span>Free · about three minutes</span>
      </Caps>
    </Wrap>
  );
}

