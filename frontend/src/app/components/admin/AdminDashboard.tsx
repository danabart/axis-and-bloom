import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

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

export default function AdminDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const token = await user!.getIdToken();
        const res = await fetch('/api/admin/stats', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setStats(await res.json());
      } catch {
        setError('Failed to load stats');
      }
    })();
  }, [user]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-stone-800 mb-6">Dashboard</h1>
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {CARDS.map(({ key, label }) => (
          <div key={key} className="border border-stone-200 rounded-lg p-5">
            <p className="text-3xl font-semibold text-stone-800">
              {stats ? Number(stats[key as keyof Stats]).toLocaleString() : '—'}
            </p>
            <p className="text-sm text-stone-400 mt-1">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
