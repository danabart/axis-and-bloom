import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';
import EvidenceParametersCard from './EvidenceParametersCard';
import LiamAnswersCard from './LiamAnswersCard';
import LiamGateRulesCard from './LiamGateRulesCard';

interface ConfigDiff {
  path: string;
  seedValue: unknown;
  liveValue: unknown;
}

interface SommelierConfig {
  confidenceWeights: Record<string, number>;
  confidenceThresholds: { medium: number; high: number };
  // Brief Rev 3, Part C (2026-10-24): the threshold, nudges and customer
  // copy are optional until applyMissingKeys has reached the live doc.
  sessionLimits: {
    maxTurns: number;
    warnAtTurnsRemaining?: number;
    closingTurns?: number;
    nudges?: { closing: string; last: string };
    customerCopy?: { limitNotice: string; closedNotice: string };
  };
  // Part A4: the rules around the brand facts; the facts are rows (Liam answers card).
  brandFacts?: { enabled: boolean; cacheSeconds: number; rules: string[]; supportContact?: string };
  // Liam sees everything brief Rev 2 (2026-10-24): optional until applyMissingKeys reaches the live doc.
  catalogBlock?: {
    header: string; template: string[]; sizesForm: string; notYetAvailable: string;
    storySentences: number; maxTokens: number; fitHeader: string; decafHeader: string;
  };
  customerBlock?: { quizHistoryCount: number; ordersFullCount: number; feedbackCount: number; sessionsCount: number; rules: string[] };
  promptCache?: { sharedTtl: '5m' | '1h' };
  // Liam answer layer (2026-10-25): the gate's knobs and prompts; optional until applyMissingKeys reaches the live doc.
  gate?: {
    enabled: boolean; confirmModel: string; confirmThreshold: number; confirmMaxTokens: number; confirmPrompt: string;
    phraseModel: string; phraseMaxTokens: number; phrasePrompt: string; maxMessageChars: number;
    offline?: { enabled: boolean; model: string; missShareThreshold: number };
  };
  tokenEconomy: { signupBonus: number; orderBonus: number; costPerTurn: number; purchaseEnabled: boolean };
  ragLimits: { maxCoffees: number };
  timeWindows: Record<string, number>;
  evaluatorRulePriority: string[];
  confidenceComponents: Record<string, { active: boolean; label: string; description: string }>;
  intents: Record<string, { label: string }>;
}

const TIME_WINDOW_LABELS: Record<string, string> = {
  negativeFeedbackLookback: 'Negative feedback lookback (days)',
  orderOutcome7Day: '7-day order outcome window (days)',
  orderOutcome30Day: '30-day order outcome window (days)',
  returnVisitWindow: 'Return visit window (days)',
  sessionResumeWindowHours: 'Session resume window (hours)',
};

function pct(v: number) { return `${Math.round(v * 100)}%`; }

export default function AdminSommelierConfig() {
  const { user } = useAuth();
  const [config, setConfig] = useState<SommelierConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMsg, setRecomputeMsg] = useState('');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [drift, setDrift] = useState<ConfigDiff[] | null>(null);
  const [driftLoading, setDriftLoading] = useState(true);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState('');
  const dragItem = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);

  async function getToken() { return user!.getIdToken(); }

  async function loadDrift() {
    setDriftLoading(true);
    try {
      const res = await fetch('/api/admin/sommelier/config-drift', {
        headers: { Authorization: `Bearer ${await getToken()}` },
      });
      if (!res.ok) throw new Error();
      const j = await res.json();
      setDrift(j.diffs);
      setSelectedPaths(new Set((j.diffs as ConfigDiff[]).map((d) => d.path)));
    } catch (err) {
      reportError('[AdminSommelierConfig/load-drift]', err);
      setDrift(null);
    } finally {
      setDriftLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/sommelier/config', {
          headers: { Authorization: `Bearer ${await getToken()}` },
        });
        if (!res.ok) throw new Error();
        setConfig(await res.json());
      } catch (err) {
        reportError('[AdminSommelierConfig/load-config]', err);
        setError('Failed to load sommelier config');
      } finally {
        setLoading(false);
      }
    })();
    loadDrift();
  }, []);

  function togglePath(path: string) {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function formatDiffValue(v: unknown): string {
    if (v === undefined) return '(not set)';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  }

  async function handleApplyDrift() {
    if (selectedPaths.size === 0) return;
    setApplying(true);
    setApplyMsg('');
    try {
      const res = await fetch('/api/admin/sommelier/config-apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getToken()}`,
        },
        body: JSON.stringify({ paths: Array.from(selectedPaths) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'Apply failed');
      setApplyMsg(`Applied ${j.appliedPaths.length} field${j.appliedPaths.length === 1 ? '' : 's'}`);
      await loadDrift();
      const cfgRes = await fetch('/api/admin/sommelier/config', {
        headers: { Authorization: `Bearer ${await getToken()}` },
      });
      if (cfgRes.ok) setConfig(await cfgRes.json());
    } catch (e: unknown) {
      reportError('[AdminSommelierConfig/apply-drift]', e);
      setApplyMsg(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setApplying(false);
    }
  }

  function updateConfig(path: string[], value: unknown) {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as SommelierConfig;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let obj: any = next;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      obj[path[path.length - 1]] = value;
      return next;
    });
  }

  const weightTotal = config
    ? Object.values(config.confidenceWeights).reduce((s, v) => s + v, 0)
    : 0;
  const weightValid = Math.abs(weightTotal - 1) < 0.005;
  const thresholdValid =
    config ? config.confidenceThresholds.high > config.confidenceThresholds.medium : true;
  const canSave = weightValid && thresholdValid;

  async function handleSave() {
    if (!config || !canSave) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/sommelier/config', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getToken()}`,
        },
        body: JSON.stringify({
          confidenceWeights: config.confidenceWeights,
          confidenceThresholds: config.confidenceThresholds,
          sessionLimits: config.sessionLimits,
          ...(config.brandFacts ? { brandFacts: config.brandFacts } : {}),
          ...(config.catalogBlock ? { catalogBlock: config.catalogBlock } : {}),
          ...(config.customerBlock ? { customerBlock: config.customerBlock } : {}),
          ...(config.promptCache ? { promptCache: config.promptCache } : {}),
          ...(config.gate ? { gate: config.gate } : {}),
          tokenEconomy: config.tokenEconomy,
          ragLimits: config.ragLimits,
          timeWindows: config.timeWindows,
          evaluatorRulePriority: config.evaluatorRulePriority,
          confidenceComponents: config.confidenceComponents,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? 'Save failed');
      }
      setToast('Config saved');
      setTimeout(() => setToast(''), 3000);
    } catch (e: unknown) {
      reportError('[AdminSommelierConfig/save]', e);
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleRecompute() {
    setRecomputing(true);
    setRecomputeMsg('');
    try {
      const res = await fetch('/api/admin/sommelier/recompute-centroids', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await getToken()}` },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      const total = Object.values(j.intentCounts as Record<string, number>).reduce((s, v) => s + v, 0);
      setRecomputeMsg(`Centroids updated — ${total} evaluations processed`);
    } catch (e: unknown) {
      reportError('[AdminSommelierConfig/recompute]', e);
      setRecomputeMsg(e instanceof Error ? e.message : 'Failed');
    } finally {
      setRecomputing(false);
    }
  }

  function handleDragStart(i: number) { dragItem.current = i; }
  function handleDragEnter(i: number) { dragOver.current = i; }
  function handleDragEnd() {
    if (dragItem.current === null || dragOver.current === null) return;
    const order = [...(config?.evaluatorRulePriority ?? [])];
    const [moved] = order.splice(dragItem.current, 1);
    order.splice(dragOver.current, 0, moved);
    updateConfig(['evaluatorRulePriority'], order);
    dragItem.current = null;
    dragOver.current = null;
  }

  if (loading) return <div className="text-stone-400 text-sm">Loading…</div>;
  if (!config) return <div className="text-red-500 text-sm">{error || 'No config'}</div>;

  const med = config.confidenceThresholds.medium;
  const high = config.confidenceThresholds.high;
  const lowWidth = Math.round(med * 100);
  const medWidth = Math.round((high - med) * 100);
  const highWidth = 100 - lowWidth - medWidth;

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-normal text-stone-800 mb-1">Sommelier Configuration</h1>
      <p className="text-sm text-stone-400 mb-8">All changes are picked up by the backend within ~1 second via live config listener.</p>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      {toast && (
        <div className="fixed top-6 right-6 bg-stone-800 text-white text-sm px-4 py-2 rounded shadow-lg z-50">
          {toast}
        </div>
      )}

      {/* ── Cupping evidence brief 6, E3: evidence parameters (System Health is read-only by policy) ── */}
      <EvidenceParametersCard />

      {/* ── Liam brand answers brief Rev 3, A7: the brand facts as rows, edit = new row ── */}
      <LiamAnswersCard />

      {/* ── Liam answer layer (2026-10-25): the gate's rules, read-only ── */}
      <LiamGateRulesCard />

      {/* ── Section 0: Config Source of Truth ── */}
      <section className="mb-8">
        <div className="flex items-center justify-between gap-4 mb-2">
          <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400">Config Source of Truth</h2>
          {!driftLoading && drift && (
            drift.length === 0 ? (
              <span className="text-xs text-stone-400">seed and live match</span>
            ) : (
              <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 whitespace-nowrap">
                seed differs from live: {drift.length} field{drift.length === 1 ? '' : 's'}
              </span>
            )
          )}
        </div>
        <p className="text-xs text-stone-400 mb-3">
          This admin portal is the canonical source for <code>config/sommelier</code>. Seed files only apply to fresh
          environments — a seed edit that matters must be applied below to reach live config.
        </p>
        {applyMsg && <p className="text-xs text-stone-600 mb-2">{applyMsg}</p>}
        {driftLoading && <p className="text-xs text-stone-400">Checking for drift…</p>}
        {!driftLoading && !drift && <p className="text-xs text-red-500">Failed to load drift status</p>}
        {!driftLoading && drift && drift.length > 0 && (
          <div className="border border-stone-200 rounded-lg divide-y divide-stone-100">
            {drift.map((d) => (
              <label key={d.path} className="flex items-start gap-3 p-3 cursor-pointer hover:bg-stone-50">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selectedPaths.has(d.path)}
                  onChange={() => togglePath(d.path)}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs text-stone-600">{d.path}</p>
                  <p className="text-xs text-stone-400 mt-0.5">seed: <span className="text-stone-700">{formatDiffValue(d.seedValue)}</span></p>
                  <p className="text-xs text-stone-400">live: <span className="text-stone-700">{formatDiffValue(d.liveValue)}</span></p>
                </div>
              </label>
            ))}
            <div className="p-3 flex justify-end">
              <button
                onClick={handleApplyDrift}
                disabled={applying || selectedPaths.size === 0}
                className="px-4 py-2 text-sm text-white rounded disabled:opacity-50"
                style={{ backgroundColor: '#b05642' }}
              >
                {applying ? 'Applying…' : `Apply ${selectedPaths.size} selected`}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Section 1: Confidence Weights ── */}
      <section className="mb-8">
        <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">Behavioral Confidence Weights</h2>
        <div className="border border-stone-200 rounded-lg divide-y divide-stone-100">
          {Object.entries(config.confidenceComponents).map(([key, comp]) => (
            <div key={key} className="p-4 flex items-start gap-4">
              <div className="flex-1">
                <p className="text-sm font-normal text-stone-800">{comp.label}</p>
                <p className="text-xs text-stone-400 mt-0.5">{comp.description}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => updateConfig(['confidenceComponents', key, 'active'], !comp.active)}
                  className={`w-9 h-5 rounded-full transition-colors relative ${comp.active ? 'bg-stone-700' : 'bg-stone-200'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${comp.active ? 'left-4' : 'left-0.5'}`} />
                </button>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  className="w-20 border border-stone-200 rounded px-2 py-1 text-sm text-right"
                  value={config.confidenceWeights[key] ?? 0}
                  onChange={(e) => updateConfig(['confidenceWeights', key], parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
          ))}
        </div>
        <p className={`text-sm mt-2 ${weightValid ? 'text-stone-400' : 'text-amber-600'}`}>
          Weight total: {weightTotal.toFixed(2)}
          {!weightValid && ' — Weights must sum to 1.00'}
        </p>
      </section>

      {/* ── Section 2: Confidence Thresholds ── */}
      <section className="mb-8">
        <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">Confidence Thresholds</h2>
        <div className="border border-stone-200 rounded-lg p-4 space-y-4">
          <div className="flex gap-6">
            <label className="flex-1">
              <span className="text-xs text-stone-400 block mb-1">Medium threshold</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                className="w-full border border-stone-200 rounded px-3 py-1.5 text-sm"
                value={med}
                onChange={(e) => updateConfig(['confidenceThresholds', 'medium'], parseFloat(e.target.value) || 0)}
              />
            </label>
            <label className="flex-1">
              <span className="text-xs text-stone-400 block mb-1">High threshold</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                className={`w-full border rounded px-3 py-1.5 text-sm ${thresholdValid ? 'border-stone-200' : 'border-red-400'}`}
                value={high}
                onChange={(e) => updateConfig(['confidenceThresholds', 'high'], parseFloat(e.target.value) || 0)}
              />
            </label>
          </div>
          {!thresholdValid && <p className="text-xs text-red-500">High threshold must be greater than medium threshold</p>}
          <div className="h-5 rounded overflow-hidden flex text-xs font-normal">
            <div className="flex items-center justify-center bg-stone-200 text-stone-600" style={{ width: `${lowWidth}%` }}>
              {lowWidth > 8 ? `Low ${pct(med)}` : ''}
            </div>
            <div className="flex items-center justify-center bg-amber-200 text-amber-800" style={{ width: `${medWidth}%` }}>
              {medWidth > 8 ? `Med ${pct(high - med)}` : ''}
            </div>
            <div className="flex items-center justify-center bg-stone-700 text-white" style={{ width: `${highWidth}%` }}>
              {highWidth > 8 ? 'High' : ''}
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3: Token Economy ── */}
      <section className="mb-8">
        <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">Token Economy</h2>
        <div className="border border-stone-200 rounded-lg p-4 space-y-4">
          {[
            { key: 'signupBonus', label: 'Signup bonus tokens' },
            { key: 'orderBonus', label: 'Order bonus tokens' },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between gap-4">
              <span className="text-sm text-stone-700">{label}</span>
              <input
                type="number"
                min="0"
                className="w-24 border border-stone-200 rounded px-3 py-1.5 text-sm text-right"
                value={config.tokenEconomy[key as 'signupBonus' | 'orderBonus']}
                onChange={(e) => updateConfig(['tokenEconomy', key], parseInt(e.target.value) || 0)}
              />
            </label>
          ))}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-stone-700">Tokens per turn</p>
              <p className="text-xs text-stone-400">Changing this affects all future turns</p>
            </div>
            <span className="text-sm font-normal text-stone-500 border border-stone-200 rounded px-3 py-1.5 bg-stone-50">
              {config.tokenEconomy.costPerTurn}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-stone-700">Token purchases enabled</p>
              <p className="text-xs text-stone-400">Enable when Stripe integration is configured.</p>
            </div>
            <button
              onClick={() => updateConfig(['tokenEconomy', 'purchaseEnabled'], !config.tokenEconomy.purchaseEnabled)}
              className={`w-9 h-5 rounded-full transition-colors relative ${config.tokenEconomy.purchaseEnabled ? 'bg-stone-700' : 'bg-stone-200'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${config.tokenEconomy.purchaseEnabled ? 'left-4' : 'left-0.5'}`} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Section 5: Session Limits ── */}
      <section className="mb-8">
        <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">Session Limits</h2>
        <div className="border border-stone-200 rounded-lg p-4">
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm text-stone-700">Max turns per session</span>
            <input
              type="number"
              min="1"
              className="w-24 border border-stone-200 rounded px-3 py-1.5 text-sm text-right"
              value={config.sessionLimits.maxTurns}
              onChange={(e) => updateConfig(['sessionLimits', 'maxTurns'], parseInt(e.target.value) || 1)}
            />
          </label>
          <p className="text-xs text-stone-400 mt-2">
            Each intent's own max turns (Intent Editor) overrides this number for that intent.
          </p>
          {config.sessionLimits.nudges && config.sessionLimits.customerCopy && (
            <div className="mt-4 pt-4 border-t border-stone-100 space-y-4">
              <label className="flex items-center justify-between gap-4">
                <span className="text-sm text-stone-700">Show the "close to its limit" notice from this many replies left</span>
                <input
                  type="number"
                  min="0"
                  className="w-24 border border-stone-200 rounded px-3 py-1.5 text-sm text-right"
                  value={config.sessionLimits.warnAtTurnsRemaining ?? 0}
                  onChange={(e) => updateConfig(['sessionLimits', 'warnAtTurnsRemaining'], parseInt(e.target.value) || 0)}
                />
              </label>
              <label className="flex items-center justify-between gap-4">
                <span className="text-sm text-stone-700">Liam gets a closing nudge on the last this many replies</span>
                <input
                  type="number"
                  min="0"
                  className="w-24 border border-stone-200 rounded px-3 py-1.5 text-sm text-right"
                  value={config.sessionLimits.closingTurns ?? 0}
                  onChange={(e) => updateConfig(['sessionLimits', 'closingTurns'], parseInt(e.target.value) || 0)}
                />
              </label>
              {([
                ['nudges', 'closing', 'Nudge to Liam before the last reply ({n} = replies left)'],
                ['nudges', 'last', 'Nudge to Liam on the last reply'],
                ['customerCopy', 'limitNotice', 'Customer notice near the end (no numbers)'],
                ['customerCopy', 'closedNotice', 'Customer notice when the conversation reached its length (no numbers)'],
              ] as const).map(([group, field, label]) => (
                <label key={`${group}.${field}`} className="block">
                  <span className="text-xs text-stone-500">{label}</span>
                  <textarea
                    rows={2}
                    className="mt-1 w-full border border-stone-200 rounded px-3 py-1.5 text-sm"
                    value={(config.sessionLimits[group] as Record<string, string>)[field]}
                    onChange={(e) => updateConfig(['sessionLimits', group, field], e.target.value)}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Brief Rev 3, A4/A7: brand facts toggle and the rules Liam follows around them ── */}
      {config.brandFacts && (
        <section className="mb-8">
          <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">Brand Facts in Liam's Prompt</h2>
          <div className="border border-stone-200 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-stone-700">Give Liam the brand facts</p>
                <p className="text-xs text-stone-400">The facts themselves are edited in the Liam answers card above.</p>
              </div>
              <button
                onClick={() => updateConfig(['brandFacts', 'enabled'], !config.brandFacts!.enabled)}
                className={`w-9 h-5 rounded-full transition-colors relative ${config.brandFacts.enabled ? 'bg-stone-700' : 'bg-stone-200'}`}
                aria-label="Toggle brand facts"
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${config.brandFacts.enabled ? 'left-4' : 'left-0.5'}`} />
              </button>
            </div>
            <div>
              <p className="text-xs text-stone-500 mb-1">Rules Liam follows around the facts</p>
              {config.brandFacts.rules.map((rule, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <textarea
                    rows={2}
                    className="flex-1 border border-stone-200 rounded px-3 py-1.5 text-sm"
                    value={rule}
                    onChange={(e) => updateConfig(['brandFacts', 'rules', String(i)], e.target.value)}
                  />
                  <button
                    onClick={() => updateConfig(['brandFacts', 'rules'], config.brandFacts!.rules.filter((_, j) => j !== i))}
                    className="text-xs text-stone-400 hover:text-stone-700 self-start mt-2"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                onClick={() => updateConfig(['brandFacts', 'rules'], [...config.brandFacts!.rules, ''])}
                className="text-xs text-stone-600 border-b border-stone-300"
              >
                Add a rule
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Liam sees everything brief Rev 2: the catalog block, the customer block, the shared cache TTL ── */}
      {config.catalogBlock && config.customerBlock && (
        <section className="mb-8">
          <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">Liam Context</h2>
          <div className="border border-stone-200 rounded-lg p-4 space-y-4">
            <p className="text-xs text-stone-400">
              Liam sees every coffee customers can see (the catalog block, shared by every conversation) and this customer's facts.
              Template placeholders: {'{alias} {archetype} {categories} {dial} {sizes} {tastingNote} {keyFlavors} {story}'}; a line whose placeholders are all empty is left out.
            </p>
            {config.brandFacts && (
              <label className="flex items-center justify-between gap-4">
                <span className="text-sm text-stone-700">Support contact Liam points to</span>
                <input
                  className="w-72 border border-stone-200 rounded px-3 py-1.5 text-sm"
                  value={config.brandFacts.supportContact ?? ''}
                  onChange={(e) => updateConfig(['brandFacts', 'supportContact'], e.target.value)}
                />
              </label>
            )}
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm text-stone-700">Shared prompt cache lifetime</span>
              <select
                className="w-24 border border-stone-200 rounded px-2 py-1.5 text-sm bg-white"
                value={config.promptCache?.sharedTtl ?? '5m'}
                onChange={(e) => updateConfig(['promptCache', 'sharedTtl'], e.target.value)}
              >
                <option value="5m">5 min</option>
                <option value="1h">1 hour</option>
              </select>
            </label>
            {([
              ['catalogBlock', 'storySentences', 'Story sentences per coffee'],
              ['catalogBlock', 'maxTokens', 'Catalog block token limit (stories shorten past it)'],
              ['customerBlock', 'quizHistoryCount', 'Earlier quiz results shown'],
              ['customerBlock', 'ordersFullCount', 'Orders shown in full'],
              ['customerBlock', 'feedbackCount', 'Feedback entries shown'],
              ['customerBlock', 'sessionsCount', 'Earlier Liam conversations shown'],
            ] as const).map(([group, field, label]) => (
              <label key={`${group}.${field}`} className="flex items-center justify-between gap-4">
                <span className="text-sm text-stone-700">{label}</span>
                <input
                  type="number"
                  min="0"
                  className="w-24 border border-stone-200 rounded px-3 py-1.5 text-sm text-right"
                  value={(config[group] as unknown as Record<string, number>)[field]}
                  onChange={(e) => updateConfig([group, field], parseInt(e.target.value) || 0)}
                />
              </label>
            ))}
            {([
              ['header', 'Catalog header'],
              ['fitHeader', 'Fit block header'],
              ['decafHeader', 'Decaf-only line'],
            ] as const).map(([field, label]) => (
              <label key={field} className="block">
                <span className="text-xs text-stone-500">{label}</span>
                <textarea
                  rows={2}
                  className="mt-1 w-full border border-stone-200 rounded px-3 py-1.5 text-sm"
                  value={config.catalogBlock![field]}
                  onChange={(e) => updateConfig(['catalogBlock', field], e.target.value)}
                />
              </label>
            ))}
            <label className="block">
              <span className="text-xs text-stone-500">Catalog line template (one line per row)</span>
              <textarea
                rows={5}
                className="mt-1 w-full border border-stone-200 rounded px-3 py-1.5 text-sm font-mono"
                value={config.catalogBlock.template.join('\n')}
                onChange={(e) => updateConfig(['catalogBlock', 'template'], e.target.value.split('\n'))}
              />
            </label>
            <div>
              <p className="text-xs text-stone-500 mb-1">Rules about the customer facts (shown to Liam with the brand rules; {'{supportContact}'} is filled in)</p>
              {config.customerBlock.rules.map((rule, i) => (
                <textarea
                  key={i}
                  rows={2}
                  className="mb-2 w-full border border-stone-200 rounded px-3 py-1.5 text-sm"
                  value={rule}
                  onChange={(e) => updateConfig(['customerBlock', 'rules', String(i)], e.target.value)}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Liam answer layer (2026-10-25): the gate's kill switch, knobs and prompts ── */}
      {config.gate && (
        <section className="mb-8">
          <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">Liam Gate</h2>
          <div className="border border-stone-200 rounded-lg p-4 space-y-4">
            <p className="text-xs text-stone-400">
              Off sends every reply to Sonnet, with no deploy. On: a message that matches a gate rule (see Liam Gate Rules above) is checked by
              one Haiku call and, when confirmed, answered from one row: a brand answer word for word, or a price, the decaf list or the
              subscription status in two Haiku sentences. The opening and the closing replies always go to Sonnet.
            </p>
            {([
              ['enabled', 'Gate on'],
            ] as const).map(([field, label]) => (
              <label key={field} className="flex items-center justify-between gap-4">
                <span className="text-sm text-stone-700">{label}</span>
                <input type="checkbox" checked={config.gate!.enabled} onChange={(e) => updateConfig(['gate', field], e.target.checked)} />
              </label>
            ))}
            {config.gate.offline && (
              <label className="flex items-center justify-between gap-4">
                <span className="text-sm text-stone-700">Nightly labeller on (misses and replay agreement on System Health)</span>
                <input type="checkbox" checked={config.gate.offline.enabled} onChange={(e) => updateConfig(['gate', 'offline', 'enabled'], e.target.checked)} />
              </label>
            )}
            {([
              ['confirmThreshold', 'Confirmation confidence needed (0 to 1)', '0.05'],
              ['maxMessageChars', 'Longest message the gate answers (characters)', '1'],
              ['confirmMaxTokens', 'Confirmation output cap (tokens)', '1'],
              ['phraseMaxTokens', 'Phrasing output cap (tokens)', '1'],
            ] as const).map(([field, label, step]) => (
              <label key={field} className="flex items-center justify-between gap-4">
                <span className="text-sm text-stone-700">{label}</span>
                <input
                  type="number"
                  min="0"
                  step={step}
                  className="w-24 border border-stone-200 rounded px-3 py-1.5 text-sm text-right"
                  value={config.gate![field]}
                  onChange={(e) => updateConfig(['gate', field], step === '1' ? parseInt(e.target.value) || 0 : parseFloat(e.target.value) || 0)}
                />
              </label>
            ))}
            {config.gate.offline && (
              <label className="flex items-center justify-between gap-4">
                <span className="text-sm text-stone-700">Miss share of Sonnet spend that justifies Brief 4 (0 to 1)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-24 border border-stone-200 rounded px-3 py-1.5 text-sm text-right"
                  value={config.gate.offline.missShareThreshold}
                  onChange={(e) => updateConfig(['gate', 'offline', 'missShareThreshold'], parseFloat(e.target.value) || 0)}
                />
              </label>
            )}
            {([
              ['confirmModel', 'Confirmation model'],
              ['phraseModel', 'Phrasing model'],
            ] as const).map(([field, label]) => (
              <label key={field} className="flex items-center justify-between gap-4">
                <span className="text-sm text-stone-700">{label}</span>
                <input
                  className="w-72 border border-stone-200 rounded px-3 py-1.5 text-sm"
                  value={config.gate![field]}
                  onChange={(e) => updateConfig(['gate', field], e.target.value)}
                />
              </label>
            ))}
            {([
              ['confirmPrompt', 'Confirmation prompt ({labels} {aliases} {previous} {message})'],
              ['phrasePrompt', 'Phrasing prompt ({facts} {history} {message})'],
            ] as const).map(([field, label]) => (
              <label key={field} className="block">
                <span className="text-xs text-stone-500">{label}</span>
                <textarea
                  rows={7}
                  className="mt-1 w-full border border-stone-200 rounded px-3 py-1.5 text-sm font-mono"
                  value={config.gate![field]}
                  onChange={(e) => updateConfig(['gate', field], e.target.value)}
                />
              </label>
            ))}
          </div>
        </section>
      )}

      {/* ── Section 6: RAG Limits ── */}
      <section className="mb-8">
        <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">RAG Limits</h2>
        <div className="border border-stone-200 rounded-lg p-4">
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm text-stone-700">
              Max coffees per session
              <span className="block text-xs text-stone-400">Retired 2026-10-24: Liam now sees the whole catalog; this number is kept but ignored.</span>
            </span>
            <input
              type="number"
              min="1"
              className="w-24 border border-stone-200 rounded px-3 py-1.5 text-sm text-right"
              value={config.ragLimits.maxCoffees}
              onChange={(e) => updateConfig(['ragLimits', 'maxCoffees'], parseInt(e.target.value) || 1)}
            />
          </label>
        </div>
      </section>

      {/* ── Section 7: Time Windows ── */}
      <section className="mb-8">
        <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">Time Windows</h2>
        <div className="border border-stone-200 rounded-lg divide-y divide-stone-100">
          {Object.entries(config.timeWindows).map(([key, val]) => (
            <label key={key} className="flex items-center justify-between gap-4 p-4">
              <span className="text-sm text-stone-700">
                {TIME_WINDOW_LABELS[key] ?? key}
              </span>
              <input
                type="number"
                min="0"
                className="w-24 border border-stone-200 rounded px-3 py-1.5 text-sm text-right"
                value={val}
                onChange={(e) => updateConfig(['timeWindows', key], parseInt(e.target.value) || 0)}
              />
            </label>
          ))}
        </div>
      </section>

      {/* ── Section 8: Evaluator Rule Priority ── */}
      <section className="mb-8">
        <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">Evaluator Rule Priority</h2>
        <p className="text-xs text-stone-400 mb-3">Drag to reorder. First matching active intent wins.</p>
        <div className="border border-stone-200 rounded-lg divide-y divide-stone-100">
          {config.evaluatorRulePriority.map((intentKey, i) => (
            <div
              key={intentKey}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragEnter={() => handleDragEnter(i)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              className="flex items-center gap-3 p-3 cursor-grab active:cursor-grabbing hover:bg-stone-50"
            >
              <span className="text-xs text-stone-300 w-4 text-center select-none">⠿</span>
              <span className="text-xs text-stone-400 w-4">{i + 1}</span>
              <span className="font-mono text-xs text-stone-600">{intentKey}</span>
              <span className="text-xs text-stone-400">
                {config.intents?.[intentKey]?.label ?? ''}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 9: Recompute Centroids ── */}
      <section className="mb-10">
        <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">Intent Centroids</h2>
        <div className="border border-stone-200 rounded-lg p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-stone-700">Recompute intent centroids</p>
            <p className="text-xs text-stone-400">Averages feature vectors across all collected evaluations per intent.</p>
            {recomputeMsg && <p className="text-xs text-stone-600 mt-1">{recomputeMsg}</p>}
          </div>
          <button
            onClick={handleRecompute}
            disabled={recomputing}
            className="px-4 py-2 border border-stone-300 rounded text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50 whitespace-nowrap"
          >
            {recomputing ? 'Computing…' : 'Recompute'}
          </button>
        </div>
      </section>

      {/* ── Save ── */}
      <div className="sticky bottom-0 bg-white border-t border-stone-200 -mx-8 px-8 py-4 flex items-center justify-between">
        {!canSave && (
          <p className="text-xs text-amber-600">
            {!weightValid && 'Fix weight sum. '}
            {!thresholdValid && 'Fix threshold order.'}
          </p>
        )}
        {canSave && <span />}
        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className="px-6 py-2 text-sm text-white rounded disabled:opacity-50"
          style={{ backgroundColor: canSave && !saving ? '#b05642' : undefined, background: !canSave || saving ? '#d6c9c1' : undefined }}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
