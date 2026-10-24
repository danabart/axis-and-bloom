import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';
import { signatureText, accentClauses, type SignatureRow } from '../../lib/signatureLine';

interface Coffee {
  id: number;
  name: string;
  roaster: string | null;
  is_active?: boolean; // Roastery lifecycle (2026-08-25) — present when ?include_inactive=true
}

interface WheelRow {
  coffee_name: string;
  wheel_category: string;
  wheel_subcategory: string;
  descriptor: string;
  source: 'internal' | 'roastery' | 'client';
  mentions: string;
  avg_intensity: string | null;
  // Cupping evidence brief 6, B2 (2026-10-21): internal rows are our cupping
  // notes as a consensus per node (one row per node, not per cupping).
  sessions_named?: number;
  sessions_total?: number;
  share?: number;
  cuppers?: string[];
  words?: string[];
  // Coffee presentation brief 1 (2026-10-23), E1: roastery rows are the
  // customer voice's roaster rows, with how the customer sees each one.
  family?: string | null;
  roaster_channels?: string[];
  roaster_rank?: number | null;
  confirmed_by_cupping?: boolean;
  is_signature?: boolean;
  qualifies?: boolean;
  display_order?: number | null;
  customer_sees?: 'signature' | 'accent' | 'hidden by cap' | 'hidden by tier';
}

interface PublicContent { threeVoiceStory: string | null }

/**
 * Coffee presentation brief 1, E2 — "What the customer sees": the signature
 * line and accent clauses from the same public read the Bloom page uses
 * (GET /api/coffees/:id/flavor-wheel) and the coffee's description exactly as
 * GET /api/coffees/:id/content serves it, with Regenerate (the existing
 * POST /api/admin/coffees/:id/refresh-content), then a reload. Brief 2
 * (2026-10-24): one description per coffee, three_voice_story, under the
 * header customers see ("In the roaster's words").
 */
function CustomerSeesBlock({ coffeeId, onRegenerated }: { coffeeId: string; onRegenerated: () => void }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<SignatureRow[]>([]);
  const [content, setContent] = useState<PublicContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const [wheel, text] = await Promise.all([
        fetch(`/api/coffees/${coffeeId}/flavor-wheel`).then(r => r.json()),
        fetch(`/api/coffees/${coffeeId}/content`).then(r => r.json()),
      ]);
      setRows(Array.isArray(wheel) ? wheel : []);
      setContent(text);
    } catch (err) { reportError('[AdminFlavorWheel/customer-sees]', err); }
  }, [coffeeId]);
  useEffect(() => { setNote(''); load(); }, [load]);

  async function regenerate() {
    setBusy(true); setNote('');
    try {
      const token = await user!.getIdToken();
      const res = await fetch(`/api/admin/coffees/${coffeeId}/refresh-content`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      setNote(res.ok ? 'Regenerated.' : `Regenerate failed (${res.status}).`);
      await load();
      onRegenerated();
    } catch (err) { reportError('[AdminFlavorWheel/regenerate]', err); setNote('Regenerate failed.'); }
    finally { setBusy(false); }
  }

  const line = signatureText(rows);
  const clauses = accentClauses(rows);
  const text = (label: string, value: string | null | undefined) => (
    <div>
      <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">{label}</p>
      {value ? <p className="text-sm text-stone-700 leading-relaxed">{value}</p> : <p className="text-sm text-stone-300">empty</p>}
    </div>
  );
  return (
    <div className="mb-8 border border-stone-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-normal text-stone-700">What the customer sees</h2>
        <div className="flex items-center gap-3">
          {note && <span className="text-xs text-stone-500">{note}</span>}
          <button onClick={regenerate} disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-stone-300 text-stone-700 hover:bg-stone-50 disabled:opacity-50">
            {busy ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      </div>
      <div className="mb-5">
        <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Signature notes</p>
        {line ? <p className="text-[15px] text-stone-800">{line}</p> : <p className="text-sm text-stone-300">no signature notes</p>}
        {clauses.map(c => <p key={c} className="text-[12.5px] text-stone-500 mt-1">{c}</p>)}
      </div>
      {text("In the roaster's words (three_voice_story)", content?.threeVoiceStory)}
    </div>
  );
}

const SEES_STYLE: Record<string, string> = {
  signature: 'bg-stone-800 text-white',
  accent: 'bg-stone-200 text-stone-700',
  'hidden by cap': 'bg-stone-100 text-stone-400',
  'hidden by tier': 'bg-stone-100 text-stone-400',
};

const SOURCE_LABELS: Record<string, string> = {
  internal: 'Internal Cupping',
  roastery:  'Roastery Notes',
  client:    'Client Feedback',
};

const SOURCE_COLORS: Record<string, string> = {
  internal: '#b05642',
  roastery: '#7c9e87',
  client:   '#8a7cbe',
};

export default function AdminFlavorWheel() {
  const { user }                    = useAuth();
  const [coffees, setCoffees]       = useState<Coffee[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [rows, setRows]             = useState<WheelRow[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  // Roastery lifecycle (2026-08-25) — "Show inactive" toggle, component state
  // only, same pattern as every other admin list this task touches.
  const [showInactive, setShowInactive] = useState(false);

  // Load coffee list for selector. GET /api/admin/coffees was retired (410,
  // Catalog Blueprint brief 4) — this was missed at the time and kept
  // silently 410ing until caught as a hotfix; repointed to
  // /catalog/coffees (v_coffee-backed) and mapped roaster_name -> roaster,
  // the field name this component already uses.
  useEffect(() => {
    (async () => {
      try {
        const token = await user!.getIdToken();
        const res   = await fetch(`/api/admin/catalog/coffees${showInactive ? '?include_inactive=true' : ''}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data: { id: number; name: string; roaster_name: string | null; is_active?: boolean }[] = await res.json();
        const mapped: Coffee[] = data.map(c => ({ id: c.id, name: c.name, roaster: c.roaster_name, is_active: c.is_active }));
        setCoffees(mapped);
        if (mapped.length > 0) setSelectedId(String(mapped[0].id));
      } catch (err) {
        reportError('[AdminFlavorWheel/load-coffees]', err);
        setError('Failed to load coffees');
      }
    })();
  }, [user, showInactive]);

  // Load wheel data when coffee changes
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const token = await user!.getIdToken();
        const res   = await fetch(`/api/admin/flavor-wheel/${selectedId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setRows(await res.json());
      } catch (err) {
        reportError('[AdminFlavorWheel/load-wheel]', err);
        setError('Failed to load flavor wheel');
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedId, user, reloadKey]);

  // Group by source
  const bySource = rows.reduce<Record<string, WheelRow[]>>((acc, row) => {
    (acc[row.source] ??= []).push(row);
    return acc;
  }, {});

  const selectedCoffee = coffees.find(c => String(c.id) === selectedId);

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-xl font-normal text-stone-800">Flavor Wheel</h1>
        {coffees.length > 0 && (
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="border border-stone-300 rounded px-3 py-1.5 text-sm"
          >
            {coffees.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.roaster ? ` — ${c.roaster}` : ''}{c.is_active === false ? ' (inactive)' : ''}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-sm text-stone-500">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
            className="accent-stone-700" />
          Show inactive
        </label>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {selectedId && <CustomerSeesBlock coffeeId={selectedId} onRegenerated={() => setReloadKey(k => k + 1)} />}

      {loading && <p className="text-stone-400 text-sm">Loading…</p>}

      {!loading && rows.length === 0 && selectedCoffee && (
        <div className="text-center py-16 text-stone-400">
          <p className="text-lg mb-1">No descriptors recorded yet</p>
          <p className="text-sm">Add cupping scores or roastery notes for <strong>{selectedCoffee.name}</strong> to see its flavor profile here.</p>
        </div>
      )}

      {!loading && rows.length > 0 && (() => {
        const totalMentions   = rows.reduce((s, r) => s + Number(r.mentions), 0);
        const uniqueDescs     = new Set(rows.map(r => r.descriptor)).size;
        const topDescriptors  = [...rows]
          .sort((a, b) => Number(b.mentions) - Number(a.mentions))
          .slice(0, 3);
        const sourceCounts    = rows.reduce<Record<string,number>>((acc, r) => {
          acc[r.source] = (acc[r.source] ?? 0) + Number(r.mentions); return acc;
        }, {});
        return (
          <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border border-stone-200 rounded-lg px-4 py-3">
              <p className="text-xs text-stone-400 mb-1">Total mentions</p>
              <p className="text-2xl font-normal text-stone-800">{totalMentions}</p>
            </div>
            <div className="border border-stone-200 rounded-lg px-4 py-3">
              <p className="text-xs text-stone-400 mb-1">Unique descriptors</p>
              <p className="text-2xl font-normal text-stone-800">{uniqueDescs}</p>
            </div>
            <div className="border border-stone-200 rounded-lg px-4 py-3 md:col-span-2">
              <p className="text-xs text-stone-400 mb-1">Top descriptors</p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {topDescriptors.map(r => (
                  <span key={r.descriptor} className="px-2 py-0.5 rounded-full text-xs font-normal text-white"
                    style={{ backgroundColor: SOURCE_COLORS[r.source] }}>
                    {r.descriptor} ×{r.mentions}
                  </span>
                ))}
              </div>
            </div>
            {Object.entries(sourceCounts).map(([src, count]) => (
              <div key={src} className="border border-stone-200 rounded-lg px-4 py-3">
                <p className="text-xs text-stone-400 mb-1">{SOURCE_LABELS[src]}</p>
                <p className="text-lg font-normal" style={{ color: SOURCE_COLORS[src] }}>{count} mentions</p>
              </div>
            ))}
          </div>
        );
      })()}

      {!loading && rows.length > 0 && (
        <div className="space-y-8">
          {['internal', 'roastery', 'client'].map(source => {
            const sourceRows = bySource[source];
            if (!sourceRows?.length) return null;

            if (source === 'internal') {
              // Brief 6, B2: one row per node, k of n sessions, most shared first
              const consensus = [...sourceRows].sort((a, b) =>
                (b.share ?? 0) - (a.share ?? 0) || (b.sessions_named ?? 0) - (a.sessions_named ?? 0) || a.descriptor.localeCompare(b.descriptor));
              return (
                <div key={source}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS[source] }} />
                    <h2 className="text-sm font-normal text-stone-700">{SOURCE_LABELS[source]}</h2>
                    <span className="text-xs text-stone-400">({consensus.length} nodes, from the cupper rows of every session)</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead>
                        <tr className="border-b border-stone-200 text-xs text-stone-400 uppercase tracking-wide">
                          <th className="pb-2 pr-4">Descriptor</th>
                          <th className="pb-2 pr-4">Sessions</th>
                          <th className="pb-2 pr-4">Cuppers</th>
                          <th className="pb-2 pr-4">Category</th>
                          <th className="pb-2">Words written</th>
                        </tr>
                      </thead>
                      <tbody>
                        {consensus.map(row => (
                          <tr key={row.descriptor} className="border-b border-stone-100 hover:bg-stone-50">
                            <td className="py-2.5 pr-4 text-stone-800">{row.descriptor}</td>
                            <td className="py-2.5 pr-4 whitespace-nowrap tabular-nums">
                              <span className="px-2 py-0.5 rounded-full text-xs text-white" style={{ backgroundColor: SOURCE_COLORS[source] }}>
                                {row.sessions_named} of {row.sessions_total}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4 text-stone-600">{(row.cuppers ?? []).join(', ')}</td>
                            <td className="py-2.5 pr-4 text-stone-500">{row.wheel_category}</td>
                            <td className="py-2.5 text-stone-400">{(row.words ?? []).join(', ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            }

            if (source === 'roastery') {
              // Coffee presentation brief 1, E2: the customer voice's roaster rows,
              // in the order the customer sees them (rows the customer never sees last).
              return (
                <div key={source}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS[source] }} />
                    <h2 className="text-sm font-normal text-stone-700">{SOURCE_LABELS[source]}</h2>
                    <span className="text-xs text-stone-400">({sourceRows.length} nodes, accepted form notes and the latest website capture)</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead>
                        <tr className="border-b border-stone-200 text-xs text-stone-400 uppercase tracking-wide">
                          <th className="pb-2 pr-4">Descriptor</th>
                          <th className="pb-2 pr-4">Family</th>
                          <th className="pb-2 pr-4">Named on</th>
                          <th className="pb-2 pr-4">Form rank</th>
                          <th className="pb-2 pr-4">Cupping</th>
                          <th className="pb-2">Customer sees</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sourceRows.map(row => (
                          <tr key={row.descriptor} className="border-b border-stone-100 hover:bg-stone-50">
                            <td className="py-2.5 pr-4 text-stone-800">{row.descriptor}</td>
                            <td className="py-2.5 pr-4 text-stone-500">{row.family ?? row.wheel_category}</td>
                            <td className="py-2.5 pr-4">
                              <span className="flex flex-wrap gap-1">
                                {(row.roaster_channels ?? []).map(ch => (
                                  <span key={ch} className="px-2 py-0.5 rounded-full text-xs text-white" style={{ backgroundColor: SOURCE_COLORS[source] }}>{ch}</span>
                                ))}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4 text-stone-500 tabular-nums">{row.roaster_rank ?? '—'}</td>
                            <td className="py-2.5 pr-4 text-stone-500">{row.confirmed_by_cupping ? 'confirmed' : '—'}</td>
                            <td className="py-2.5">
                              {row.customer_sees && (
                                <span className={`px-2 py-0.5 rounded text-xs ${SEES_STYLE[row.customer_sees] ?? ''}`}>{row.customer_sees}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            }

            // Group by category
            const byCategory = sourceRows.reduce<Record<string, WheelRow[]>>((acc, row) => {
              (acc[row.wheel_category] ??= []).push(row);
              return acc;
            }, {});

            return (
              <div key={source}>
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: SOURCE_COLORS[source] }}
                  />
                  <h2 className="text-sm font-normal text-stone-700">
                    {SOURCE_LABELS[source]}
                  </h2>
                  <span className="text-xs text-stone-400">({sourceRows.length} descriptors)</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-stone-200 text-xs text-stone-400 uppercase tracking-wide">
                        <th className="pb-2 pr-4">Category</th>
                        <th className="pb-2 pr-4">Subcategory</th>
                        <th className="pb-2 pr-4">Descriptor</th>
                        <th className="pb-2 pr-4">Mentions</th>
                        <th className="pb-2">Avg Intensity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(byCategory).map(([category, catRows]) =>
                        catRows.map((row, i) => (
                          <tr key={`${row.descriptor}-${i}`} className="border-b border-stone-100 hover:bg-stone-50">
                            <td className="py-2.5 pr-4 text-stone-500">
                              {i === 0 ? category : ''}
                            </td>
                            <td className="py-2.5 pr-4 text-stone-500">{row.wheel_subcategory}</td>
                            <td className="py-2.5 pr-4 font-normal text-stone-800">{row.descriptor}</td>
                            <td className="py-2.5 pr-4">
                              <span
                                className="px-2 py-0.5 rounded-full text-xs text-white"
                                style={{ backgroundColor: SOURCE_COLORS[source] }}
                              >
                                {row.mentions}×
                              </span>
                            </td>
                            <td className="py-2.5 text-stone-400">
                              {row.avg_intensity != null
                                ? Number(row.avg_intensity).toFixed(1)
                                : '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
