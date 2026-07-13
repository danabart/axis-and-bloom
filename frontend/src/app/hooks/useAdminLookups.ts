import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export interface LookupOption {
  value: string;
  label: string;
}

export type Lookups = Record<string, LookupOption[]>;

export function useAdminLookups() {
  const { user } = useAuth();
  const [lookups, setLookups] = useState<Lookups>({});
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/lookups', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLookups(await res.json());
    } catch {
      // leave whatever was already loaded — forms will show no/stale options rather than crash
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [user]);

  return { lookups, loading, refresh };
}
