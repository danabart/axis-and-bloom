import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';

interface SommelierConfig {
  confidenceWeights: Record<string, number>;
  confidenceThresholds: { medium: number; high: number };
  sessionLimits: { maxTurns: number };
  tokenEconomy: { signupBonus: number; orderBonus: number; costPerTurn: number; purchaseEnabled: boolean };
  modelRouting: { sonnetKeywords: string[]; sonnetMinMessageWords: number };
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
  const [newKeyword, setNewKeyword] = useState('');
  const dragItem = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);

  async function getToken() { return user!.getIdToken(); }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/sommelier/config', {
          headers: { Authorization: `Bearer ${await getToken()}` },
        });
        if (!res.ok) throw new Error();
        setConfig(await res.json());
      } catch {
        setError('Failed to load sommelier config');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
          tokenEconomy: config.tokenEconomy,
          modelRouting: config.modelRouting,
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

      {/* ── Section 4: Model Routing ── */}
      <section className="mb-8">
        <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">Model Routing</h2>
        <div className="border border-stone-200 rounded-lg p-4 space-y-4">
          <div>
            <p className="text-xs text-stone-400 mb-2">Sonnet keywords — messages containing any of these trigger Sonnet</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {config.modelRouting.sonnetKeywords.map((kw) => (
                <span key={kw} className="flex items-center gap-1 bg-stone-100 text-stone-700 text-xs px-2 py-1 rounded">
                  {kw}
                  <button
                    onClick={() =>
                      updateConfig(['modelRouting', 'sonnetKeywords'], config.modelRouting.sonnetKeywords.filter((k) => k !== kw))
                    }
                    className="text-stone-400 hover:text-stone-700 leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 border border-stone-200 rounded px-3 py-1.5 text-sm"
                placeholder="Add keyword…"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newKeyword.trim()) {
                    updateConfig(['modelRouting', 'sonnetKeywords'], [...config.modelRouting.sonnetKeywords, newKeyword.trim()]);
                    setNewKeyword('');
                  }
                }}
              />
              <button
                onClick={() => {
                  if (newKeyword.trim()) {
                    updateConfig(['modelRouting', 'sonnetKeywords'], [...config.modelRouting.sonnetKeywords, newKeyword.trim()]);
                    setNewKeyword('');
                  }
                }}
                className="px-3 py-1.5 border border-stone-200 rounded text-sm text-stone-600 hover:bg-stone-50"
              >
                Add
              </button>
            </div>
          </div>
          <label className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-stone-700">Sonnet min message words</p>
              <p className="text-xs text-stone-400">Messages longer than this word count trigger Sonnet</p>
            </div>
            <input
              type="number"
              min="1"
              className="w-24 border border-stone-200 rounded px-3 py-1.5 text-sm text-right"
              value={config.modelRouting.sonnetMinMessageWords}
              onChange={(e) => updateConfig(['modelRouting', 'sonnetMinMessageWords'], parseInt(e.target.value) || 1)}
            />
          </label>
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
        </div>
      </section>

      {/* ── Section 6: RAG Limits ── */}
      <section className="mb-8">
        <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">RAG Limits</h2>
        <div className="border border-stone-200 rounded-lg p-4">
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm text-stone-700">Max coffees per session</span>
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
