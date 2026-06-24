import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

const INTENT_KEYS = [
  'DISCOVERY_SEEKER',
  'PROFILE_AMBIGUOUS',
  'TASTE_EVOLUTION',
  'RECOMMENDATION_MISS',
  'CONVERSION',
  'EXPLORATION',
] as const;

const RAG_FOCUS_OPTIONS = [
  { value: 'archetype_range',   label: 'Archetype Range',   desc: '2 coffees from each of the 3 nearest archetypes' },
  { value: 'alternatives',      label: 'Alternatives',      desc: 'Adjacent archetypes, excluding negatively-rated coffees' },
  { value: 'evolution_bridge',  label: 'Evolution Bridge',  desc: '3 from old archetype + 3 from new archetype' },
  { value: 'discovery',         label: 'Discovery',         desc: 'Experimental coffees + Bloom Dial bridge hops' },
  { value: 'exact_match',       label: 'Exact Match',       desc: "User's primary archetype with best editorial content" },
  { value: 'curated_mix',       label: 'Curated Mix',       desc: '1 best-content coffee per archetype' },
];

interface IntentConfig {
  active: boolean;
  label: string;
  conversationGoal: string;
  systemPromptAddendum: string;
  ragFocus: string;
  maxTurns: number;
}

const LIAM_BASE = `You are Liam, the Axis & Bloom Coffee Sommelier. You are warm, precise, and genuinely curious. Your job is not to sell coffee — it is to understand the person in front of you and guide them toward something they will love.

Rules:
- Your name is Liam. Use it naturally if asked.
- Only recommend coffees from the catalog provided. Never invent a coffee or make up a tasting note.
- Ask at most one follow-up question per turn.
- Keep responses under 180 words.
- Be specific. Name actual flavors and sensations. Avoid vague terms like "smooth" or "rich" without qualification.`;

export default function AdminIntentEditor() {
  const { user } = useAuth();
  const [intents, setIntents] = useState<Record<string, IntentConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ key: string; cfg: IntentConfig } | null>(null);
  const [globalError, setGlobalError] = useState('');

  async function getToken() { return user!.getIdToken(); }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/sommelier/config', {
          headers: { Authorization: `Bearer ${await getToken()}` },
        });
        if (!res.ok) throw new Error();
        const cfg = await res.json();
        setIntents(cfg.intents ?? {});
      } catch {
        setGlobalError('Failed to load intent config');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function updateIntent(key: string, field: keyof IntentConfig, value: unknown) {
    setIntents((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  async function saveIntent(key: string) {
    setSaving(key);
    setErrors((e) => ({ ...e, [key]: '' }));
    try {
      const res = await fetch('/api/admin/sommelier/config', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getToken()}`,
        },
        body: JSON.stringify({ intents: { [key]: intents[key] } }),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? 'Save failed');
      }
      setToasts((t) => ({ ...t, [key]: 'Saved' }));
      setTimeout(() => setToasts((t) => ({ ...t, [key]: '' })), 3000);
    } catch (e: unknown) {
      setErrors((prev) => ({ ...prev, [key]: e instanceof Error ? e.message : 'Save failed' }));
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <div className="text-stone-400 text-sm">Loading…</div>;
  if (globalError) return <div className="text-red-500 text-sm">{globalError}</div>;

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-normal text-stone-800 mb-1">Intent Editor</h1>
      <p className="text-sm text-stone-400 mb-8">Each intent shapes how Liam opens a session, which coffees are fetched, and what goal he pursues. Save per-intent individually.</p>

      <div className="space-y-6">
        {INTENT_KEYS.map((key) => {
          const cfg = intents[key];
          if (!cfg) return <div key={key} className="text-stone-400 text-xs">{key} — not in config</div>;
          const charCount = (cfg.systemPromptAddendum ?? '').length;
          const addendumEmpty = !cfg.systemPromptAddendum?.trim();

          return (
            <div key={key} className="border border-stone-200 rounded-lg overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-stone-50 border-b border-stone-200">
                <span className="font-mono text-xs text-stone-500 bg-stone-200 px-2 py-0.5 rounded">{key}</span>
                <input
                  type="text"
                  className="flex-1 text-sm font-normal text-stone-800 bg-transparent border-none outline-none"
                  value={cfg.label}
                  onChange={(e) => updateIntent(key, 'label', e.target.value)}
                  placeholder="Human-readable label"
                />
                <button
                  onClick={() => updateIntent(key, 'active', !cfg.active)}
                  className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors ${
                    cfg.active
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-stone-100 border-stone-200 text-stone-400'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.active ? 'bg-green-500' : 'bg-stone-300'}`} />
                  {cfg.active ? 'Active' : 'Inactive'}
                </button>
              </div>

              {/* Body */}
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <label>
                    <span className="text-xs text-stone-400 block mb-1">RAG Focus</span>
                    <select
                      className="w-full border border-stone-200 rounded px-3 py-1.5 text-sm"
                      value={cfg.ragFocus}
                      onChange={(e) => updateIntent(key, 'ragFocus', e.target.value)}
                    >
                      {RAG_FOCUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-stone-400 mt-1">
                      {RAG_FOCUS_OPTIONS.find((o) => o.value === cfg.ragFocus)?.desc}
                    </p>
                  </label>
                  <label>
                    <span className="text-xs text-stone-400 block mb-1">Max Turns</span>
                    <input
                      type="number"
                      min="1"
                      className="w-full border border-stone-200 rounded px-3 py-1.5 text-sm"
                      value={cfg.maxTurns}
                      onChange={(e) => updateIntent(key, 'maxTurns', parseInt(e.target.value) || 1)}
                    />
                  </label>
                </div>

                <label>
                  <span className="text-xs text-stone-400 block mb-1">Conversation Goal</span>
                  <textarea
                    rows={2}
                    className="w-full border border-stone-200 rounded px-3 py-2 text-sm resize-none"
                    value={cfg.conversationGoal}
                    onChange={(e) => updateIntent(key, 'conversationGoal', e.target.value)}
                  />
                </label>

                <label>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-stone-400">System Prompt Addendum</span>
                    <span className="text-xs text-stone-400">{charCount} chars</span>
                  </div>
                  <textarea
                    rows={5}
                    className={`w-full border rounded px-3 py-2 text-sm resize-y font-mono ${
                      addendumEmpty ? 'border-amber-300 bg-amber-50' : 'border-stone-200'
                    }`}
                    value={cfg.systemPromptAddendum}
                    onChange={(e) => updateIntent(key, 'systemPromptAddendum', e.target.value)}
                    placeholder="Instructions appended to Liam's system prompt for this intent…"
                  />
                  {addendumEmpty && (
                    <p className="text-xs text-amber-600 mt-1">No addendum set — Liam will use only the base prompt for this intent.</p>
                  )}
                </label>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-3 bg-stone-50 border-t border-stone-200">
                <button
                  onClick={() => setPreview({ key, cfg })}
                  className="text-xs text-stone-500 hover:text-stone-800 underline"
                >
                  Preview system prompt
                </button>
                <div className="flex items-center gap-3">
                  {errors[key] && <p className="text-xs text-red-500">{errors[key]}</p>}
                  {toasts[key] && <p className="text-xs text-green-600">{toasts[key]}</p>}
                  <button
                    onClick={() => saveIntent(key)}
                    disabled={saving === key}
                    className="px-4 py-1.5 text-sm text-white rounded disabled:opacity-50"
                    style={{ backgroundColor: '#b05642' }}
                  >
                    {saving === key ? 'Saving…' : `Save ${cfg.label || key}`}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Preview modal */}
      {preview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-8">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
              <p className="text-sm font-normal text-stone-800">System Prompt Preview — {preview.key}</p>
              <button onClick={() => setPreview(null)} className="text-stone-400 hover:text-stone-700 text-lg leading-none">×</button>
            </div>
            <div className="overflow-auto p-5 flex-1">
              <pre className="text-xs text-stone-600 font-mono whitespace-pre-wrap leading-relaxed">
{`${LIAM_BASE}

[YOUR CURRENT CATALOG — injected at session start]
---
Example Coffee — Roaster — Archetype
Tasting note: ...
What's unexpected: ...
Key flavors: ...
---
${preview.cfg.systemPromptAddendum ? `\n${preview.cfg.systemPromptAddendum}` : ''}
${preview.cfg.conversationGoal ? `\nYour goal: ${preview.cfg.conversationGoal}` : ''}

[Context for this user: <generated by evaluator at session start>]`}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
