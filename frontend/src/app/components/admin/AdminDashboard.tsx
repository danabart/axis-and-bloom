import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import AdminQuizIntegrity from './AdminQuizIntegrity';

interface Stats {
  coffees: string;
  sessions: string;
  internal_descriptors: string;
  roastery_descriptors: string;
  client_feedback: string;
  sca_descriptors: string;
}

const CARDS = [
  { key: 'coffees',              label: 'Coffees in catalogue' },
  { key: 'sessions',             label: 'Cupping sessions'     },
  { key: 'internal_descriptors', label: 'Internal descriptors' },
  { key: 'roastery_descriptors', label: 'Roastery descriptors' },
  { key: 'client_feedback',      label: 'Client feedback rows' },
  { key: 'sca_descriptors',      label: 'SCA wheel entries'    },
];

type MarketingConfigKey = 'looker_studio_url' | 'mailchimp_audience_url' | 'adspend_sheet_url';
type MarketingConfig = Record<MarketingConfigKey, string | null>;

const MARKETING_LINKS: { key: MarketingConfigKey; label: string }[] = [
  { key: 'looker_studio_url',      label: 'Looker Studio report' },
  { key: 'mailchimp_audience_url', label: 'Mailchimp audience'   },
  { key: 'adspend_sheet_url',      label: 'Ad Spend sheet'       },
];

export default function AdminDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [marketing, setMarketing] = useState<MarketingConfig | null>(null);
  const [editingKey, setEditingKey] = useState<MarketingConfigKey | null>(null);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const token = await user!.getIdToken();
        const [statsRes, marketingRes] = await Promise.all([
          fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/admin/marketing/config', { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        setStats(await statsRes.json());
        setMarketing(await marketingRes.json());
      } catch {
        setError('Failed to load stats');
      }
    })();
  }, [user]);

  async function saveMarketingLink(key: MarketingConfigKey) {
    const token = await user!.getIdToken();
    const res = await fetch('/api/admin/marketing/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ key, value: editValue }),
    });
    if (res.ok) setMarketing(await res.json());
    setEditingKey(null);
  }

  return (
    <div>
      <h1 className="text-xl font-normal text-stone-800 mb-6">Dashboard</h1>
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <p className="text-xs font-normal tracking-widest uppercase mb-2" style={{ color: '#b05642' }}>
        Marketing
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        {MARKETING_LINKS.map(({ key, label }) => {
          const url = marketing?.[key] ?? null;
          const isEditing = editingKey === key;
          return (
            <div key={key} className="border border-stone-200 rounded-lg p-5">
              <p className="text-sm text-stone-400 mb-2">{label}</p>
              {isEditing ? (
                <div className="flex flex-col gap-2">
                  <input
                    autoFocus
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    placeholder="https://…"
                    className="text-sm border border-stone-300 rounded px-2 py-1"
                  />
                  <div className="flex gap-3">
                    <button onClick={() => saveMarketingLink(key)} className="text-xs text-stone-600 hover:text-stone-900">
                      Save
                    </button>
                    <button onClick={() => setEditingKey(null)} className="text-xs text-stone-400 hover:text-stone-600">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : url ? (
                <div className="flex items-center justify-between gap-2">
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-stone-800 hover:underline truncate">
                    Open →
                  </a>
                  <button
                    onClick={() => { setEditingKey(key); setEditValue(url); }}
                    className="text-xs text-stone-400 hover:text-stone-600 shrink-0"
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingKey(key); setEditValue(''); }}
                  className="text-sm text-stone-400 hover:text-stone-600"
                >
                  Not set — add link
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs font-normal tracking-widest uppercase mb-2" style={{ color: '#b05642' }}>
        Cupping & Catalogue
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        {CARDS.map(({ key, label }) => (
          <div key={key} className="border border-stone-200 rounded-lg p-5">
            <p className="text-3xl font-normal text-stone-800">
              {stats ? Number(stats[key as keyof Stats]).toLocaleString() : '—'}
            </p>
            <p className="text-sm text-stone-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      <AdminQuizIntegrity />
    </div>
  );
}
