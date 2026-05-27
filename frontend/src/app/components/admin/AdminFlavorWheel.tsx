import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface Coffee {
  id: number;
  name: string;
  roaster: string | null;
}

interface WheelRow {
  coffee_name: string;
  wheel_category: string;
  wheel_subcategory: string;
  descriptor: string;
  source: 'internal' | 'roastery' | 'client';
  mentions: string;
  avg_intensity: string | null;
}

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

  // Load coffee list for selector
  useEffect(() => {
    (async () => {
      try {
        const token = await user!.getIdToken();
        const res   = await fetch('/api/admin/coffees', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data: Coffee[] = await res.json();
        setCoffees(data);
        if (data.length > 0) setSelectedId(String(data[0].id));
      } catch {
        setError('Failed to load coffees');
      }
    })();
  }, [user]);

  // Load wheel data when coffee changes
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
      } catch {
        setError('Failed to load flavor wheel');
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedId, user]);

  // Group by source
  const bySource = rows.reduce<Record<string, WheelRow[]>>((acc, row) => {
    (acc[row.source] ??= []).push(row);
    return acc;
  }, {});

  const selectedCoffee = coffees.find(c => String(c.id) === selectedId);

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-xl font-semibold text-stone-800">Flavor Wheel</h1>
        {coffees.length > 0 && (
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="border border-stone-300 rounded px-3 py-1.5 text-sm"
          >
            {coffees.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.roaster ? ` — ${c.roaster}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

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
              <p className="text-2xl font-semibold text-stone-800">{totalMentions}</p>
            </div>
            <div className="border border-stone-200 rounded-lg px-4 py-3">
              <p className="text-xs text-stone-400 mb-1">Unique descriptors</p>
              <p className="text-2xl font-semibold text-stone-800">{uniqueDescs}</p>
            </div>
            <div className="border border-stone-200 rounded-lg px-4 py-3 md:col-span-2">
              <p className="text-xs text-stone-400 mb-1">Top descriptors</p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {topDescriptors.map(r => (
                  <span key={r.descriptor} className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: SOURCE_COLORS[r.source] }}>
                    {r.descriptor} ×{r.mentions}
                  </span>
                ))}
              </div>
            </div>
            {Object.entries(sourceCounts).map(([src, count]) => (
              <div key={src} className="border border-stone-200 rounded-lg px-4 py-3">
                <p className="text-xs text-stone-400 mb-1">{SOURCE_LABELS[src]}</p>
                <p className="text-lg font-semibold" style={{ color: SOURCE_COLORS[src] }}>{count} mentions</p>
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
                  <h2 className="text-sm font-semibold text-stone-700">
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
                            <td className="py-2.5 pr-4 font-medium text-stone-800">{row.descriptor}</td>
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
