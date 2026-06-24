import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../context/AuthContext';

interface SommelierConfig {
  confidenceWeights: Record<string, number>;
  confidenceThresholds: { medium: number; high: number };
  sessionLimits: { maxTurns: number };
  tokenEconomy: { signupBonus: number; orderBonus: number; costPerTurn: number };
  modelRouting: { sonnetKeywords: string[]; sonnetMinMessageWords: number };
  evaluatorRulePriority: string[];
  intents: Record<string, { active: boolean; label: string; ragFocus: string }>;
  confidenceComponents: Record<string, { label: string }>;
}

interface Stats {
  totalEvaluations: number;
  needsSommelierRate: number;
  intentDistribution: Record<string, { count: number; sessionStartedRate: number; avgTurnsUsed: number; orderConversionRate: number }>;
  confidenceDistribution: { low: number; medium: number; high: number };
  outcomeStats: { sessionCompletionRate: number; orderedWithin7DaysRate: number; returnedRate: number; avgTokensPerSession: number };
  tokenStats: { totalTokensIssued: number; totalTokensSpent: number; avgBalancePerUser: number; usersWithZeroBalance: number };
  periodDays: number;
}

const INPUT_CARDS = [
  { key: 'quizSessions',        label: 'Quiz Sessions',       icon: '◎' },
  { key: 'orderHistory',        label: 'Order History',       icon: '◈' },
  { key: 'feedbackEvents',      label: 'Feedback Events',     icon: '◆' },
  { key: 'archetypeStability',  label: 'Archetype Stability', icon: '◉' },
  { key: 'tokenBalance',        label: 'Token Balance',       icon: '◇' },
];

const RUST = '#b05642';

function pct(v: number) { return `${Math.round(v * 100)}%`; }

export default function AdminSommelierFlow() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [config, setConfig] = useState<SommelierConfig | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showValues, setShowValues] = useState(false);
  const [hoveredIntent, setHoveredIntent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  async function getToken() { return user!.getIdToken(); }

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [cfgRes, statsRes] = await Promise.all([
        fetch('/api/admin/sommelier/config', { headers: { Authorization: `Bearer ${await getToken()}` } }),
        fetch('/api/admin/sommelier/stats',  { headers: { Authorization: `Bearer ${await getToken()}` } }),
      ]);
      if (!cfgRes.ok || !statsRes.ok) throw new Error();
      const [cfgData, statsData] = await Promise.all([cfgRes.json(), statsRes.json()]);
      setConfig(cfgData);
      setStats(statsData);
    } catch {
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  if (loading) return <div className="text-stone-400 text-sm">Loading…</div>;
  if (error) return <div className="text-red-500 text-sm">{error}</div>;
  if (!config || !stats) return null;

  const intentKeys = config.evaluatorRulePriority.length > 0
    ? config.evaluatorRulePriority
    : Object.keys(config.intents);

  const CARD = 'border rounded-lg p-4 bg-white';
  const LABEL = 'text-xs text-stone-400 tracking-widest uppercase mb-1';
  const STAT_BIG = 'text-2xl font-normal text-stone-800';

  return (
    <div ref={containerRef} className="pb-16">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-normal text-stone-800">Flow & Stats</h1>
          <p className="text-sm text-stone-400">Live view of the evaluation pipeline · last {stats.periodDays} days</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer">
            <input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} className="accent-stone-700" />
            Show config values
          </label>
          <button
            onClick={loadData}
            className="px-4 py-2 text-sm border border-stone-200 rounded text-stone-600 hover:bg-stone-50"
          >
            Refresh Stats
          </button>
        </div>
      </div>

      <div className="space-y-6 max-w-4xl">

        {/* ── Row 1: User State Inputs ── */}
        <div>
          <p className={LABEL}>User State Inputs</p>
          <div className="grid grid-cols-5 gap-3">
            {INPUT_CARDS.map(({ key, label, icon }) => {
              let stat = '';
              if (key === 'quizSessions') stat = `${stats.totalEvaluations} evals (${pct(stats.needsSommelierRate)} triggered)`;
              else if (key === 'orderHistory') stat = `${stats.tokenStats.totalTokensIssued - stats.tokenStats.totalTokensSpent >= 0 ? stats.tokenStats.totalTokensIssued : 0} issued`;
              else if (key === 'feedbackEvents') stat = `${stats.confidenceDistribution.low + stats.confidenceDistribution.medium + stats.confidenceDistribution.high} users scored`;
              else if (key === 'archetypeStability') stat = `${stats.confidenceDistribution.high} high · ${stats.confidenceDistribution.medium} med · ${stats.confidenceDistribution.low} low`;
              else if (key === 'tokenBalance') stat = `avg ${stats.tokenStats.avgBalancePerUser} tokens`;

              return (
                <div key={key} className={`${CARD} border-stone-200 text-center`}>
                  <div className="text-lg mb-1" style={{ color: RUST }}>{icon}</div>
                  <p className="text-xs font-normal text-stone-700">{label}</p>
                  <p className="text-xs text-stone-400 mt-1">{stat || 'No data'}</p>
                </div>
              );
            })}
          </div>
          <div className="flex justify-around mt-2 px-[10%]">
            {[0, 1, 2, 3, 4].map((i) => (
              <svg key={i} width="2" height="24" viewBox="0 0 2 24"><line x1="1" y1="0" x2="1" y2="24" stroke="#d6d3d1" strokeWidth="2" strokeDasharray="4 3" /></svg>
            ))}
          </div>
        </div>

        {/* ── Row 2: Behavioral Confidence Score ── */}
        <div>
          <p className={LABEL}>Behavioral Confidence Score</p>
          <div className={`${CARD} border-stone-300`}>
            <p className="text-sm text-stone-600 mb-3">Composite 0.0–1.0 score · thresholds{showValues ? `: low <${config.confidenceThresholds.medium} · high ≥${config.confidenceThresholds.high}` : ' from config'}</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(config.confidenceWeights).map(([key, w]) => {
                const label = config.confidenceComponents?.[key]?.label ?? key;
                return (
                  <span key={key} className="text-xs border border-stone-200 rounded-full px-3 py-1 text-stone-600">
                    {label} × {showValues ? w.toFixed(2) : '?'}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="flex justify-center mt-2">
            <svg width="2" height="24"><line x1="1" y1="0" x2="1" y2="24" stroke="#d6d3d1" strokeWidth="2" strokeDasharray="4 3" /></svg>
          </div>
        </div>

        {/* ── Row 3: Trigger Evaluator ── */}
        <div>
          <p className={LABEL}>Trigger Evaluator · Rule Priority</p>
          <div className={`${CARD} border-stone-300 space-y-2`}>
            {intentKeys.map((intentKey, i) => {
              const intent = config.intents[intentKey];
              const RULE_DESC: Record<string, string> = {
                DISCOVERY_SEEKER:   'experimental flag in latest quiz',
                PROFILE_AMBIGUOUS:  'quiz tie · low food signal · ai_agent mode',
                TASTE_EVOLUTION:    'archetype changed since last quiz',
                RECOMMENDATION_MISS:'negative feedback on AI-recommended coffee',
                CONVERSION:         'confidence ≥ medium + zero orders',
                EXPLORATION:        'user-initiated or browsing signal',
              };
              return (
                <div key={intentKey} className="flex items-center gap-3">
                  <span className="text-xs text-stone-300 w-4 text-center">{i + 1}</span>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${intent?.active ? 'bg-green-400' : 'bg-stone-200'}`} />
                  <span className="font-mono text-xs text-stone-600 w-40 shrink-0">{intentKey}</span>
                  <span className="text-xs text-stone-400">{RULE_DESC[intentKey] ?? ''}</span>
                </div>
              );
            })}
          </div>
          {/* Fan-out arrows */}
          <div className="relative h-8 mt-1">
            <svg className="w-full h-full" preserveAspectRatio="none">
              {intentKeys.map((_, i) => {
                const x = ((i + 0.5) / intentKeys.length) * 100;
                return (
                  <line key={i} x1="50%" y1="0" x2={`${x}%`} y2="100%" stroke="#d6d3d1" strokeWidth="1.5" strokeDasharray="4 3" />
                );
              })}
            </svg>
          </div>
        </div>

        {/* ── Row 4: Intent Buckets ── */}
        <div>
          <p className={LABEL}>Intent Buckets</p>
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${intentKeys.length}, 1fr)` }}>
            {intentKeys.map((intentKey) => {
              const intent = config.intents[intentKey];
              const dist = stats.intentDistribution[intentKey];
              const isHovered = hoveredIntent === intentKey;
              const ragFocus = intent?.ragFocus ?? '';

              return (
                <div
                  key={intentKey}
                  className={`${CARD} cursor-pointer transition-all ${
                    intent?.active
                      ? 'border-2'
                      : 'border border-stone-200 opacity-50'
                  } ${isHovered ? 'shadow-md' : ''}`}
                  style={{ borderColor: intent?.active ? RUST : undefined }}
                  onMouseEnter={() => setHoveredIntent(intentKey)}
                  onMouseLeave={() => setHoveredIntent(null)}
                  onClick={() => navigate('/admin/sommelier/intents')}
                >
                  <div className="flex items-center gap-1 mb-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${intent?.active ? 'bg-green-400' : 'bg-stone-200'}`} />
                    <span className="font-mono text-xs text-stone-500">{intentKey.split('_').map(w => w[0]).join('')}</span>
                  </div>
                  <p className="text-xs font-normal text-stone-700 leading-tight mb-2">{intent?.label ?? intentKey}</p>
                  {dist && (
                    <>
                      <p className="text-xs text-stone-400">{dist.count} sessions</p>
                      <p className="text-xs text-stone-400">{pct(dist.orderConversionRate)} conv.</p>
                    </>
                  )}
                  <p className="text-xs text-stone-300 mt-1 truncate">{ragFocus.replace(/_/g, ' ')}</p>
                </div>
              );
            })}
          </div>
          <div className="flex justify-center mt-2">
            <svg width="2" height="24"><line x1="1" y1="0" x2="1" y2="24" stroke="#d6d3d1" strokeWidth="2" strokeDasharray="4 3" /></svg>
          </div>
        </div>

        {/* ── Row 5: Liam ── */}
        <div>
          <p className={LABEL}>Liam — Coffee Sommelier</p>
          <div className={`${CARD} border-2`} style={{ borderColor: RUST }}>
            <p className="text-sm font-normal text-stone-800 mb-2">Axis & Bloom Coffee Sommelier</p>
            <div className="grid grid-cols-3 gap-4 text-xs text-stone-500">
              <div>
                <span className="text-stone-400 block">Default model</span>
                claude-haiku
              </div>
              <div>
                <span className="text-stone-400 block">Sonnet trigger</span>
                keywords match OR message &gt;{showValues ? ` ${config.modelRouting.sonnetMinMessageWords}` : ' N'} words
              </div>
              <div>
                <span className="text-stone-400 block">Max turns</span>
                {showValues ? config.sessionLimits.maxTurns : '—'} per session
              </div>
            </div>
            {hoveredIntent && config.intents[hoveredIntent] && (
              <div className="mt-3 pt-3 border-t border-stone-100">
                <p className="text-xs text-stone-400">
                  RAG focus for <span className="font-mono">{hoveredIntent}</span>:{' '}
                  <span className="text-stone-600">{config.intents[hoveredIntent].ragFocus.replace(/_/g, ' ')}</span>
                </p>
              </div>
            )}
          </div>
          <div className="flex justify-around mt-2">
            {[0, 1, 2].map((i) => (
              <svg key={i} width="2" height="24" viewBox="0 0 2 24"><line x1="1" y1="0" x2="1" y2="24" stroke="#d6d3d1" strokeWidth="2" strokeDasharray="4 3" /></svg>
            ))}
          </div>
        </div>

        {/* ── Row 6: Outcomes ── */}
        <div>
          <p className={LABEL}>Outcomes (last {stats.periodDays} days)</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Session completion', value: pct(stats.outcomeStats.sessionCompletionRate) },
              { label: 'Ordered within 7 days', value: pct(stats.outcomeStats.orderedWithin7DaysRate) },
              { label: 'Returned to Liam', value: pct(stats.outcomeStats.returnedRate) },
            ].map(({ label, value }) => (
              <div key={label} className={`${CARD} border-stone-200 text-center`}>
                <p className={STAT_BIG}>{value}</p>
                <p className="text-xs text-stone-400 mt-1">{label}</p>
              </div>
            ))}
          </div>
          {/* Feedback loop arrow */}
          <div className="flex justify-end mt-2 pr-4">
            <div className="border-r-2 border-b-2 border-dashed border-stone-200 w-16 h-8 rounded-br-xl" />
          </div>
          <p className="text-xs text-stone-300 text-right pr-4 -mt-1">Improves future classifications</p>
        </div>

        {/* ── Row 7: Token Economy ── */}
        <div>
          <p className={LABEL}>Token Economy</p>
          <div className="grid grid-cols-2 gap-3">
            <div className={`${CARD} border-stone-200`}>
              <p className="text-xs text-stone-400">Tokens Issued (lifetime)</p>
              <p className={STAT_BIG}>{stats.tokenStats.totalTokensIssued.toLocaleString()}</p>
              {showValues && (
                <p className="text-xs text-stone-400 mt-1">
                  Signup: +{config.tokenEconomy.signupBonus} · Order: +{config.tokenEconomy.orderBonus}
                </p>
              )}
            </div>
            <div className={`${CARD} border-stone-200`}>
              <p className="text-xs text-stone-400">Tokens Spent (lifetime)</p>
              <p className={STAT_BIG}>{stats.tokenStats.totalTokensSpent.toLocaleString()}</p>
              <p className="text-xs text-stone-400 mt-1">
                avg {stats.outcomeStats.avgTokensPerSession} per session
                {showValues && ` · ${config.tokenEconomy.costPerTurn} per turn`}
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
