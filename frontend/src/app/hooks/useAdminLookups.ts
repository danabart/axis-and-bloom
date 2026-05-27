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

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/admin/lookups', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setLookups(await res.json());
      } catch {
        // leave empty — forms will show no options rather than crash
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  return { lookups, loading };
}
