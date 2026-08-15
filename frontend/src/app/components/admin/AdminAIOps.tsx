import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

type AiFeature = 'liam_chat' | 'quiz_recommendation' | 'coffee_content' | 'lifecycle';

const AI_FEATURES: AiFeature[] = ['liam_chat', 'quiz_recommendation', 'coffee_content', 'lifecycle'];

const FEATURE_LABELS: Record<AiFeature, string> = {
  liam_chat: 'Liam Chat',
  quiz_recommendation: 'Quiz Recommendation',
  coffee_content: 'Coffee Content',
  lifecycle: 'Lifecycle / Beats',
};

interface DaySpend {
  date: string;
  totalCents: number;
  byFeature: Record<string, number>;
}

interface AiFeatureControls {
  enabled: boolean;
  dailyUsd: number | null;
}

interface AiControls {
  enabled: boolean;
  globalDailyUsd: number;
  features: Record<AiFeature, AiFeatureControls>;
}

interface AuditEntry {
  uid: string | null;
  email: string | null;
  at: string | null;
  old: AiControls | null;
  new: AiControls | null;
}

interface AiOpsData {
  today: DaySpend;
  trend14d: DaySpend[];
  controls: AiControls;
  envCeilingUsd: number;
  envKilled: boolean;
  recentAudit: AuditEntry[];
}

const RUST = '#b05642';
const CARD = 'border rounded-lg p-4 bg-white';
const LABEL = 'text-xs text-stone-400 tracking-widest uppercase mb-1';
const STAT_BIG = 'text-2xl font-normal text-stone-800';

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${on ? 'bg-stone-700' : 'bg-stone-200'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-4' : 'left-0.5'}`} />
    </button>
  );
}

function Trend({ trend, feature }: { trend: DaySpend[]; feature?: AiFeature }) {
  const values = trend.map((d) => (feature ? d.byFeature[feature] ?? 0 : d.totalCents));
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-1 h-12">
      {trend.map((d, i) => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full rounded-sm bg-stone-200" style={{ height: `${Math.max(3, (values[i] / max) * 40)}px` }} />
          <span className="text-[8px] text-stone-300">{d.date.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminAIOps() {
  const { user } = useAuth();
  const [data, setData] = useState<AiOpsData | null>(null);
  const [draft, setDraft] = useState<AiControls | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  async function getToken() { return user!.getIdToken(); }

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/ai-ops', { headers: { Authorization: `Bearer ${await getToken()}` } });
      if (!res.ok) throw new Error();
      const j = (await res.json()) as AiOpsData;
      setData(j);
      setDraft(j.controls);
    } catch (err) {
      reportError('[AdminAIOps/load]', err);
      setError('Failed to load AI Operations data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  function setGlobalEnabled(next: boolean) {
    if (!next && !confirm('Turn off ALL AI features? Liam, quiz recommendations, coffee content, and lifecycle messages will all stop generating until this is turned back on.')) return;
    setDraft((prev) => (prev ? { ...prev, enabled: next } : prev));
  }

  function setFeatureEnabled(feature: AiFeature, next: boolean) {
    if (!next && !confirm(`Turn off ${FEATURE_LABELS[feature]}? This is customer-facing — it will stop generating immediately once saved.`)) return;
    setDraft((prev) => (prev ? { ...prev, features: { ...prev.features, [feature]: { ...prev.features[feature], enabled: next } } } : prev));
  }

  function setGlobalCap(usdValue: number) {
    setDraft((prev) => (prev ? { ...prev, globalDailyUsd: usdValue } : prev));
  }

  function setFeatureCap(feature: AiFeature, usdValue: number | null) {
    setDraft((prev) => (prev ? { ...prev, features: { ...prev.features, [feature]: { ...prev.features[feature], dailyUsd: usdValue } } } : prev));
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/ai-ops/controls', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
        body: JSON.stringify(draft),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'Save failed');
      setToast('AI controls saved — changes take effect within a minute');
      setTimeout(() => setToast(''), 4000);
      await loadData();
    } catch (e: unknown) {
      reportError('[AdminAIOps/save]', e);
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-stone-400 text-sm">Loading…</div>;
  if (!data || !draft) return <div className="text-red-500 text-sm">{error || 'Failed to load'}</div>;

  const effectiveCapCents = Math.round(Math.min(data.envCeilingUsd, data.controls.globalDailyUsd) * 100);
  const pctOfCap = effectiveCapCents > 0 ? Math.min(1, data.today.totalCents / effectiveCapCents) : 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.controls);

  return (
    <div className="pb-16 max-w-4xl">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl font-normal text-stone-800">AI Operations</h1>
          <p className="text-sm text-stone-400">Today's Claude spend, on/off switches, and daily budgets — global and per feature.</p>
        </div>
        <button onClick={loadData} className="px-4 py-2 text-sm border border-stone-200 rounded text-stone-600 hover:bg-stone-50">
          Refresh
        </button>
      </div>
      <p className="text-xs text-stone-400 mb-6">Toggle/cap changes take effect within a minute of saving. This page controls AI/Claude calls only — nothing here touches the store, quiz flow, checkout, or auth.</p>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      {toast && (
        <div className="fixed top-6 right-6 bg-stone-800 text-white text-sm px-4 py-2 rounded shadow-lg z-50">{toast}</div>
      )}

      {data.envKilled && (
        <div className="border-2 rounded-lg p-4 mb-6" style={{ borderColor: RUST, backgroundColor: '#fdf2f0' }}>
          <p className="text-sm font-normal" style={{ color: RUST }}>Killed at the infra level (CLAUDE_ENABLED=false)</p>
          <p className="text-xs text-stone-500 mt-1">Every AI call is blocked regardless of the toggles below — this is the env-var kill switch, and it always wins. Nothing in this portal can override it; it requires a Cloud Run env-var change.</p>
        </div>
      )}

      {/* ── Global ── */}
      <div className="mb-8">
        <p className={LABEL}>Global</p>
        <div className={`${CARD} border-stone-300`}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm text-stone-700">All AI features</p>
              <p className="text-xs text-stone-400">Master toggle — turns off Liam, quiz recommendations, coffee content, and lifecycle messages at once</p>
            </div>
            <Toggle on={draft.enabled} onClick={() => setGlobalEnabled(!draft.enabled)} disabled={data.envKilled} />
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-stone-500 mb-1">
              <span>Today's spend</span>
              <span>{usd(data.today.totalCents)} / {usd(effectiveCapCents)}</span>
            </div>
            <div className="w-full h-2 rounded-full bg-stone-100 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pctOfCap * 100}%`, backgroundColor: pctOfCap >= 1 ? RUST : '#78716c' }} />
            </div>
          </div>

          <label className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-stone-700">Working daily cap</p>
              <p className="text-xs text-stone-400">max ${data.envCeilingUsd} — raised via deploy (CLAUDE_GLOBAL_DAILY_USD)</p>
            </div>
            <input
              type="number"
              min="0"
              max={data.envCeilingUsd}
              step="0.01"
              className="w-28 border border-stone-200 rounded px-3 py-1.5 text-sm text-right"
              value={draft.globalDailyUsd}
              onChange={(e) => setGlobalCap(Math.min(data.envCeilingUsd, Math.max(0, Number(e.target.value) || 0)))}
            />
          </label>

          <div className="mt-4">
            <p className="text-xs text-stone-400 mb-2">14-day total spend</p>
            <Trend trend={data.trend14d} />
          </div>
        </div>
      </div>

      {/* ── Per feature ── */}
      <div className="mb-8">
        <p className={LABEL}>Per Feature</p>
        <div className="space-y-3">
          {AI_FEATURES.map((feature) => {
            const f = draft.features[feature];
            const spentToday = data.today.byFeature[feature] ?? 0;
            return (
              <div key={feature} className={`${CARD} border-stone-200`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm text-stone-700">{FEATURE_LABELS[feature]}</p>
                    <p className="text-xs text-stone-400">Today: {usd(spentToday)}{f.dailyUsd !== null ? ` / $${f.dailyUsd.toFixed(2)}` : ' (no cap)'}</p>
                  </div>
                  <Toggle on={f.enabled} onClick={() => setFeatureEnabled(feature, !f.enabled)} disabled={data.envKilled} />
                </div>
                <div className="grid grid-cols-2 gap-4 items-center">
                  <div>
                    <p className="text-xs text-stone-400 mb-2">14-day spend</p>
                    <Trend trend={data.trend14d} feature={feature} />
                  </div>
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-xs text-stone-400">Daily cap</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="no cap"
                      className="w-24 border border-stone-200 rounded px-3 py-1.5 text-sm text-right"
                      value={f.dailyUsd ?? ''}
                      onChange={(e) => setFeatureCap(feature, e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0))}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Save ── */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className={`px-5 py-2 text-sm rounded text-white ${!dirty || saving ? 'bg-stone-300 cursor-not-allowed' : 'hover:opacity-90'}`}
          style={!dirty || saving ? undefined : { backgroundColor: RUST }}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        {dirty && <span className="text-xs text-stone-400">Unsaved changes</span>}
      </div>

      {/* ── Audit ── */}
      <div>
        <p className={LABEL}>Recent Changes</p>
        <div className={`${CARD} border-stone-200`}>
          {data.recentAudit.length === 0 ? (
            <p className="text-xs text-stone-400">No changes recorded yet</p>
          ) : (
            <div className="space-y-2">
              {data.recentAudit.map((entry, i) => (
                <div key={i} className="text-xs text-stone-500 border-b border-stone-100 last:border-b-0 pb-2 last:pb-0">
                  <span className="text-stone-700">{entry.email ?? entry.uid ?? 'unknown admin'}</span>
                  {' · '}
                  <span>{entry.at ? new Date(entry.at).toLocaleString() : 'unknown time'}</span>
                  {entry.old && entry.new && (
                    <span>
                      {' · '}
                      {entry.old.enabled !== entry.new.enabled && `global ${entry.new.enabled ? 'on' : 'off'} · `}
                      {entry.old.globalDailyUsd !== entry.new.globalDailyUsd && `cap $${entry.old.globalDailyUsd}→$${entry.new.globalDailyUsd} · `}
                      {AI_FEATURES.filter((k) => entry.old!.features[k].enabled !== entry.new!.features[k].enabled).map((k) => `${FEATURE_LABELS[k]} ${entry.new!.features[k].enabled ? 'on' : 'off'}`).join(', ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
