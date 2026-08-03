import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface QrTokenRow {
  coffeeId: number;
  displayName: string;
  token: string | null;
  url: string | null;
  retired: boolean;
}

/** HOME_TASK_7 (§3.1, QR indirection) — the artwork-export page: every active
 * coffee's full `/b/{token}` URL for the label-design pass, plus a
 * one-click mint for anything still missing a token. URL-only, no
 * server-side PNG (decision recorded in admin.ts) — the label designer's
 * own QR tool generates the printed code from the URL. */
export default function AdminQrDoor() {
  const { user } = useAuth();
  const [rows, setRows] = useState<QrTokenRow[]>([]);
  const [error, setError] = useState('');
  const [minting, setMinting] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  async function apiFetch(url: string, options: RequestInit = {}) {
    const token = await user!.getIdToken();
    return fetch(url, {
      cache: 'no-store', ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
  }

  async function load() {
    try {
      const res = await apiFetch('/api/admin/qr/tokens');
      setRows(await res.json());
    } catch { setError('Failed to load QR tokens'); }
  }

  useEffect(() => { if (user) load(); }, [user]);

  async function mintMissing() {
    setMinting(true);
    try {
      await apiFetch('/api/admin/qr/mint-missing', { method: 'POST' });
      await load();
    } catch { setError('Failed to mint tokens'); }
    setMinting(false);
  }

  async function mintOne(coffeeId: number) {
    try {
      await apiFetch(`/api/admin/qr/mint/${coffeeId}`, { method: 'POST' });
      await load();
    } catch { setError('Failed to mint token'); }
  }

  function copy(url: string, token: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 1500);
    });
  }

  const missingCount = rows.filter(r => !r.token).length;

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-xl mb-1">QR Door</h1>
      <p className="text-sm text-stone-500 mb-6">
        One code per coffee, printed once into label artwork. Never regenerate a token for a coffee that's already
        been printed — print immutability cuts both ways.
      </p>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {missingCount > 0 && (
        <button
          onClick={mintMissing}
          disabled={minting}
          className="mb-6 px-4 py-2 text-xs uppercase tracking-wide bg-[#a33726] text-white disabled:opacity-50"
        >
          {minting ? 'Minting…' : `Mint ${missingCount} missing token${missingCount === 1 ? '' : 's'}`}
        </button>
      )}

      <table className="w-full text-sm border-collapse mb-10">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
            <th className="py-2 pr-4">Coffee</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">URL</th>
            <th className="py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.coffeeId} className="border-b border-stone-100">
              <td className="py-2 pr-4">{row.displayName}</td>
              <td className="py-2 pr-4">
                {row.retired && <span className="text-xs text-stone-400">retired</span>}
              </td>
              <td className="py-2 pr-4 font-mono text-xs text-stone-600">
                {row.url ?? <span className="italic text-stone-400">not minted</span>}
              </td>
              <td className="py-2">
                {row.url && row.token ? (
                  <button
                    onClick={() => copy(row.url!, row.token!)}
                    className="text-xs uppercase tracking-wide text-[#a33726]"
                  >
                    {copiedToken === row.token ? 'Copied' : 'Copy'}
                  </button>
                ) : (
                  <button
                    onClick={() => mintOne(row.coffeeId)}
                    className="text-xs uppercase tracking-wide text-[#a33726]"
                  >
                    Mint
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="bg-stone-50 p-6 text-sm text-stone-600">
        <p className="font-medium mb-2">Print-QA checklist before mass print</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Test the actual code at final label size on final bag material — not a screen preview.</li>
          <li>Matte finishes and low-contrast palettes are the classic way a QR passes on screen and fails on a counter.</li>
          <li>Scan one real printed test code with a phone before committing to a full print run.</li>
          <li>Confirm whose printer the artwork lands on (roastery vs. Axis &amp; Bloom-supplied labels).</li>
        </ul>
      </div>
    </div>
  );
}
