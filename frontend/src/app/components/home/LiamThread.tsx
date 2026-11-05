import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Caps } from '../chrome';

// 08 Liam (Website 3). The handoff's typed exchange: it plays once the thread
// scrolls into view (40 %), the question types at ~38 ms a character, three
// dots, the answer at ~16 ms, then the suggestions; it replays after 14 s.
// Reduced motion shows the whole exchange at once.
const Q_MS = 38;
const A_MS = 16;
const DOTS_MS = 1400;
const REPLAY_MS = 14000;

export default function LiamThread({ question, answer, suggestions }: { question: string; answer: string; suggestions: string[] }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  const [phase, setPhase] = useState<'idle' | 'q' | 'dots' | 'a' | 'done'>('idle');

  useEffect(() => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setStarted(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setStarted(true); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);

  useEffect(() => {
    if (reduce || !started) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) => new Promise<void>(res => { timers.push(setTimeout(res, ms)); });
    const type = async (text: string, speed: number, set: (s: string) => void) => {
      for (let n = 1; n <= text.length && !cancelled; n++) {
        set(text.slice(0, n));
        await wait(speed + Math.random() * speed);
      }
    };
    const play = async () => {
      while (!cancelled) {
        setQ(''); setA(''); setPhase('q');
        await wait(500);
        await type(question, Q_MS, setQ);
        if (cancelled) return;
        await wait(350);
        setPhase('dots');
        await wait(DOTS_MS);
        if (cancelled) return;
        setPhase('a');
        await type(answer, A_MS, setA);
        if (cancelled) return;
        await wait(350);
        setPhase('done');
        await wait(REPLAY_MS);
      }
    };
    play();
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [reduce, started, question, answer]);

  const full = reduce;
  const showAnswer = full || phase === 'dots' || phase === 'a' || phase === 'done';
  const showSugg = full || phase === 'done';
  const typingQ = !full && phase === 'q';
  const typingA = !full && phase === 'a';

  return (
    <div className="hm-thread" ref={ref}>
      {/* The whole exchange for screen readers, once; the animated copy is hidden from them. */}
      <p className="sr-only">You: {question} Liam: {answer}</p>
      <Caps className="hm-thread-who" style={{ fontWeight: 600 }} aria-hidden="true">You</Caps>
      <p className="hm-thread-q" aria-hidden="true">{full ? question : q}{typingQ && q.length < question.length && <span className="hm-caret" />}</p>
      <div className={`hm-thread-a${showAnswer ? '' : ' hm-hidden'}`} aria-hidden="true">
        <Caps className="hm-thread-who" style={{ fontWeight: 600 }}>Liam</Caps>
        <p>
          {phase === 'dots' && !full
            ? <span className="hm-typing"><i /><i /><i /></span>
            : <>{full ? answer : a}{typingA && a.length < answer.length && <span className="hm-caret" />}</>}
        </p>
      </div>
      <div className={`hm-sugg${showSugg ? '' : ' hm-hidden'}`} aria-hidden="true">
        {suggestions.map(s => <span key={s}>{s}</span>)}
      </div>
    </div>
  );
}
