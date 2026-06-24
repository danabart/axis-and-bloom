import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';

const RUST = '#a33726';

const INTENT_LABELS: Record<string, string> = {
  PROFILE_AMBIGUOUS:   'Discovering your profile',
  RECOMMENDATION_MISS: 'Finding a better match',
  TASTE_EVOLUTION:     'Recalibrating your taste',
  DISCOVERY_SEEKER:    'Going somewhere unexpected',
  CONVERSION:          'Taking the first step',
  EXPLORATION:         'Exploring together',
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
  synthetic?: boolean;
}

interface ResumableSession {
  sessionId: number;
  intent: string;
  turnCount: number;
  turnsRemaining: number;
}

interface EvalResult {
  needsSommelier: boolean;
  intent: string | null;
  openingContext: string | null;
  evaluationId: string | null;
}

interface StartResult {
  sessionId?: number;
  openingMessage?: string;
  coffeeNames?: string[];
  tokenBalance?: number;
  turnsRemaining?: number;
  resumableSession?: ResumableSession;
}

export default function Sommelier() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const entry = searchParams.get('entry') ?? '';
  const tiedParam = searchParams.get('tied') ?? '';

  const [phase, setPhase] = useState<'loading' | 'resume_prompt' | 'chat' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [tokenBalance, setTokenBalance] = useState(0);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [intent, setIntent] = useState<string | null>(null);
  const [coffeeNames, setCoffeeNames] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [maxTurns, setMaxTurns] = useState(8);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [coffeesExpanded, setCoffeesExpanded] = useState(false);
  const [purchaseEnabled, setPurchaseEnabled] = useState(false);
  const [resumable, setResumable] = useState<ResumableSession | null>(null);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function getToken() {
    return user!.getIdToken();
  }

  async function doFetch(url: string, opts?: RequestInit) {
    const token = await getToken();
    return fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts?.headers ?? {}),
      },
    });
  }

  const openSession = useCallback(async (ev: EvalResult, forceNew = false, closeSessionId?: number) => {
    if (forceNew && closeSessionId) {
      await doFetch(`/api/sommelier/${closeSessionId}/close`, { method: 'POST' }).catch(() => {});
    }

    const startRes = await doFetch('/api/sommelier/start', {
      method: 'POST',
      body: JSON.stringify({
        intent: ev.intent,
        openingContext: ev.openingContext,
        evaluationId: ev.evaluationId,
        tiedArchetypes: tiedParam ? tiedParam.split(',') : [],
      }),
    });

    if (startRes.status === 402) {
      const j = await startRes.json();
      setTokenBalance(j.balance ?? 0);
      setPhase('chat');
      setMessages([]);
      return;
    }

    if (!startRes.ok) throw new Error('Failed to start session');

    const data: StartResult = await startRes.json();

    if (data.resumableSession && !forceNew) {
      setResumable(data.resumableSession);
      setIntent(data.resumableSession.intent);
      setPhase('resume_prompt');
      return;
    }

    setSessionId(data.sessionId ?? null);
    setIntent(ev.intent);
    setCoffeeNames(data.coffeeNames ?? []);
    setTokenBalance(data.tokenBalance ?? tokenBalance);
    const tr = data.turnsRemaining ?? 7;
    setMaxTurns(tr + 1);
    setTurnCount(1);
    setMessages(data.openingMessage
      ? [{ role: 'assistant', content: data.openingMessage }]
      : []
    );
    setPhase('chat');
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [tiedParam, tokenBalance]);

  useEffect(() => {
    (async () => {
      try {
        const [balRes, cfgRes] = await Promise.all([
          doFetch('/api/tokens/balance'),
          fetch('/api/admin/sommelier/config').catch(() => null),
        ]);

        const balData = await balRes.json();
        setTokenBalance(balData.balance ?? 0);

        if (cfgRes?.ok) {
          const cfgData = await cfgRes.json();
          setPurchaseEnabled(cfgData?.tokenEconomy?.purchaseEnabled ?? false);
        }

        const evalRes = await doFetch('/api/sommelier/evaluate', {
          method: 'POST',
          body: JSON.stringify({
            quizTie: entry === 'quiz_tie',
            tiedArchetypes: tiedParam ? tiedParam.split(',') : [],
            userInitiated: entry === 'user_initiated',
          }),
        });

        if (!evalRes.ok) throw new Error('Evaluation failed');
        const ev: EvalResult = await evalRes.json();
        setEvalResult(ev);

        if (!ev.needsSommelier && entry !== 'user_initiated') {
          navigate('/coffees', { replace: true });
          return;
        }

        const resolvedIntent = ev.intent ?? 'EXPLORATION';
        const resolvedEval: EvalResult = {
          ...ev,
          intent: resolvedIntent,
          needsSommelier: true,
        };
        setEvalResult(resolvedEval);

        await openSession(resolvedEval);
      } catch {
        setErrorMsg('Something went wrong starting your session with Liam.');
        setPhase('error');
      }
    })();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    if (!inputText.trim() || !sessionId || sending || sessionClosed || tokenBalance <= 0) return;
    const text = inputText.trim();
    setInputText('');
    setSending(true);
    setMessages((prev) => [...prev, { role: 'user', content: text }]);

    try {
      const res = await doFetch(`/api/sommelier/${sessionId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      });

      if (res.status === 402) {
        const j = await res.json();
        setTokenBalance(j.balance ?? 0);
        return;
      }

      if (res.status === 409) {
        setSessionClosed(true);
        return;
      }

      if (!res.ok) throw new Error('Message failed');

      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      setTurnCount(data.turnCount);
      setTokenBalance(data.tokenBalance ?? tokenBalance);
      if (data.sessionClosed) setSessionClosed(true);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong. Please try again.' },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function handleResumeResume() {
    if (!resumable || !evalResult) return;
    setSessionId(resumable.sessionId);
    setTurnCount(resumable.turnCount);
    setMaxTurns(resumable.turnCount + resumable.turnsRemaining);
    setMessages([{ role: 'assistant', content: 'Welcome back — continuing your conversation with Liam.', synthetic: true }]);
    setPhase('chat');
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  async function handleResumeFresh() {
    if (!resumable || !evalResult) return;
    setResumable(null);
    setPhase('loading');
    try {
      await openSession(evalResult, true, resumable.sessionId);
    } catch {
      setErrorMsg('Failed to start a new session.');
      setPhase('error');
    }
  }

  async function handleRestart() {
    if (!evalResult) return;
    setPhase('loading');
    setMessages([]);
    setSessionClosed(false);
    setSessionId(null);
    try {
      await openSession(evalResult, true, sessionId ?? undefined);
    } catch {
      setErrorMsg('Failed to start a new session.');
      setPhase('error');
    }
  }

  const turnsRemaining = maxTurns - turnCount;
  const turnColor = turnsRemaining <= 0 ? RUST : turnsRemaining <= 2 ? '#d97706' : '#a8a29e';
  const balColor = tokenBalance === 0 ? RUST : tokenBalance <= 3 ? '#d97706' : '#a8a29e';
  const inputDisabled = sessionClosed || tokenBalance <= 0 || sending;

  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <motion.div
          className="w-10 h-10 rounded-full border-2 flex items-center justify-center text-sm font-black"
          style={{ borderColor: RUST, color: RUST }}
          animate={{ scale: [1, 1.1, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          L
        </motion.div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
        <p className="text-stone-500">{errorMsg}</p>
        <button
          onClick={() => { setPhase('loading'); setErrorMsg(''); window.location.reload(); }}
          className="text-xs uppercase tracking-widest border-b pb-0.5 transition-colors"
          style={{ color: RUST, borderColor: RUST }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase === 'resume_prompt' && resumable) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-sm w-full border border-stone-200 rounded-xl p-8 text-center space-y-6 bg-white"
        >
          <div
            className="w-12 h-12 rounded-full border-2 flex items-center justify-center text-lg font-black mx-auto"
            style={{ borderColor: RUST, color: RUST }}
          >
            L
          </div>
          <div>
            <p className="text-stone-700 font-normal mb-1">You have an open conversation with Liam.</p>
            <p className="text-sm text-stone-400">
              {INTENT_LABELS[resumable.intent] ?? resumable.intent} · {resumable.turnsRemaining} turns remaining
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <button
              onClick={handleResumeResume}
              className="w-full py-2.5 rounded-lg text-sm text-white"
              style={{ backgroundColor: RUST }}
            >
              Resume conversation
            </button>
            <button
              onClick={handleResumeFresh}
              className="w-full py-2.5 rounded-lg text-sm border border-stone-200 text-stone-600 hover:bg-stone-50"
            >
              Start fresh
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-h-[800px] md:max-h-none md:h-auto md:min-h-[600px]">
      {/* ── Header ── */}
      <div className="border-b border-stone-100 px-4 py-3 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs tracking-widest uppercase font-thin" style={{ color: '#a8a29e', fontWeight: 100 }}>
              {INTENT_LABELS[intent ?? ''] ?? 'Exploring together'}
            </p>
            {/* Coffee strip */}
            {coffeeNames.length > 0 && (
              <div className="mt-1.5">
                <span className="text-xs text-stone-400 mr-2">Exploring today:</span>
                {/* Desktop: show all */}
                <span className="hidden sm:inline-flex flex-wrap gap-1.5">
                  {coffeeNames.map((name) => (
                    <span key={name} className="text-xs px-2 py-0.5 rounded-full border border-stone-200 text-stone-600">
                      {name}
                    </span>
                  ))}
                </span>
                {/* Mobile: collapsible */}
                <span className="sm:hidden">
                  {coffeesExpanded ? (
                    <span className="inline-flex flex-wrap gap-1.5">
                      {coffeeNames.map((name) => (
                        <span key={name} className="text-xs px-2 py-0.5 rounded-full border border-stone-200 text-stone-600">
                          {name}
                        </span>
                      ))}
                      <button onClick={() => setCoffeesExpanded(false)} className="text-xs text-stone-400">
                        less ↑
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setCoffeesExpanded(true)}
                      className="text-xs px-2 py-0.5 rounded-full border border-stone-200 text-stone-600"
                    >
                      {coffeeNames.length} coffees ↓
                    </button>
                  )}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => navigate(-1)}
            className="shrink-0 text-stone-300 hover:text-stone-500 transition-colors"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 4L4 14M4 4l10 10" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-3`}
            >
              {msg.role === 'assistant' && (
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div
                    className="w-7 h-7 rounded-full border flex items-center justify-center text-xs font-black"
                    style={{ borderColor: RUST, color: RUST }}
                  >
                    L
                  </div>
                  {i === 0 && <span className="text-xs text-stone-400">Liam</span>}
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'text-white'
                    : msg.synthetic
                    ? 'border border-stone-100 text-stone-400 italic bg-stone-50'
                    : 'border text-stone-700 bg-white'
                }`}
                style={{
                  backgroundColor: msg.role === 'user' ? RUST : undefined,
                  borderColor: msg.role === 'assistant' && !msg.synthetic ? RUST + '33' : undefined,
                }}
              >
                {msg.content}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Loading pulse */}
        {sending && (
          <div className="flex justify-start gap-3">
            <motion.div
              className="w-7 h-7 rounded-full border flex items-center justify-center text-xs font-black shrink-0"
              style={{ borderColor: RUST, color: RUST }}
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1, repeat: Infinity }}
            >
              L
            </motion.div>
            <div className="border rounded-xl px-4 py-3 flex gap-1 items-center" style={{ borderColor: RUST + '33' }}>
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-stone-300"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Session closed */}
        {sessionClosed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-6 space-y-4"
          >
            <p className="text-sm text-stone-400">This conversation with Liam has ended.</p>
            <button
              onClick={handleRestart}
              className="text-xs uppercase tracking-widest border-b pb-0.5 transition-colors"
              style={{ color: RUST, borderColor: RUST }}
            >
              Start a new conversation →
            </button>
          </motion.div>
        )}

        {/* Out of tokens */}
        {!sessionClosed && tokenBalance === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="border border-amber-200 bg-amber-50 rounded-xl px-4 py-4 text-center space-y-3"
          >
            <p className="text-sm text-amber-800">You've run out of tokens.</p>
            <p className="text-xs text-amber-700">Orders earn you more — or purchase tokens to continue.</p>
            <button
              onClick={() => {
                if (purchaseEnabled) {
                  navigate('/shop');
                } else {
                  alert('Token purchases coming soon.');
                }
              }}
              className="text-xs uppercase tracking-widest border-b pb-0.5 transition-colors"
              style={{ color: '#92400e', borderColor: '#92400e' }}
            >
              Get more tokens
            </button>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Status + Input ── */}
      <div className="border-t border-stone-100 px-4 py-3 shrink-0">
        {/* Status bar */}
        <div className="flex items-center justify-between mb-2 text-xs">
          <span style={{ color: turnColor }}>
            {turnCount} of {maxTurns} turns
          </span>
          <span style={{ color: balColor }}>
            {tokenBalance} token{tokenBalance !== 1 ? 's' : ''} remaining
          </span>
        </div>

        {/* Input */}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            rows={1}
            className="flex-1 resize-none border border-stone-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-stone-400 transition-colors disabled:bg-stone-50 disabled:text-stone-300"
            placeholder={inputDisabled ? (sessionClosed ? 'Session ended' : 'No tokens remaining') : 'Ask Liam anything…'}
            value={inputText}
            disabled={inputDisabled}
            onChange={(e) => {
              setInputText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
          />
          <button
            onClick={sendMessage}
            disabled={inputDisabled || !inputText.trim()}
            className="px-4 py-2.5 rounded-lg text-sm font-normal text-white transition-all shrink-0 disabled:opacity-40"
            style={{ backgroundColor: RUST }}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}
