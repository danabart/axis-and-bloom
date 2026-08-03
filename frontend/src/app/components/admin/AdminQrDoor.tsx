import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface QrTokenRow {
  coffeeId: number;
  displayName: string;
  token: string | null;
  url: string | null;
  retired: boolean;
}

interface UniversalTokenRow {
  source: string;
  token: string;
  url: string;
}

const SOURCE_LABEL: Record<string, string> = { path: 'Path Coffee Roasters', temecula: 'Temecula Coffee Roasters' };

/** HOME_TASK_7 (§3.1, QR indirection) — the artwork-export page, originally
 * every active coffee's full `/b/{token}` URL for the label-design pass.
 *
 * HOME_TASK_7C (strategy §9, 2026-08-03) — the printed QR is now universal:
 * one identical code goes on every bag, both roasteries. This page's whole
 * shape changes to match — "Printed codes" leads, is visually unmissable,
 * and is the only section a label designer should ever copy from. The
 * per-coffee list demotes to "Digital links (not for print)": those tokens
 * still exist and still work (story pages, emails), they're just no longer
 * what goes on a label. The split has to be impossible to misread — a label
 * designer must be physically unable to grab a per-coffee URL by accident. */
export default function AdminQrDoor() {
  const { user } = useAuth();
  const [rows, setRows] = useState<QrTokenRow[]>([]);
  const [universalRows, setUniversalRows] = useState<UniversalTokenRow[]>([]);
  const [error, setError] = useState('');
  const [minting, setMinting] = useState(false);
  const [mintingUniversal, setMintingUniversal] = useState(false);
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
      const [res, universalRes] = await Promise.all([
        apiFetch('/api/admin/qr/tokens'),
        apiFetch('/api/admin/qr/universal-tokens'),
      ]);
      setRows(await res.json());
      setUniversalRows(await universalRes.json());
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

  async function mintMissingUniversal() {
    setMintingUniversal(true);
    try {
      await apiFetch('/api/admin/qr/universal-tokens/mint-missing', { method: 'POST' });
      await load();
    } catch { setError('Failed to mint universal tokens'); }
    setMintingUniversal(false);
  }

  function copy(url: string, token: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 1500);
    });
  }

  const missingCount = rows.filter(r => !r.token).length;
  const missingUniversalCount = 2 - universalRows.length; // path + temecula

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-xl mb-1">QR Door</h1>
      <p className="text-sm text-stone-500 mb-6">
        The printed code is universal — one identical code on every bag, both roasteries. Per-coffee codes below are
        digital-only and are never printed.
      </p>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {/* ── Printed codes — the only section meant to ever reach a printer ── */}
      <div className="mb-4 border-2 border-[#a33726] bg-[#a33726]/5 p-6">
        <p className="text-xs uppercase tracking-[0.2em] font-semibold mb-1" style={{ color: '#a33726' }}>
          Printed codes
        </p>
        <p className="text-sm text-stone-600 mb-4">
          This is what goes on the bag label. Both roasteries get the same physical artwork element — only the URL
          underneath differs per roastery so scans stay analytics-segmentable.
        </p>

        {missingUniversalCount > 0 && (
          <button
            onClick={mintMissingUniversal}
            disabled={mintingUniversal}
            className="mb-4 px-4 py-2 text-xs uppercase tracking-wide bg-[#a33726] text-white disabled:opacity-50"
          >
            {mintingUniversal ? 'Minting…' : `Mint ${missingUniversalCount} missing roastery code${missingUniversalCount === 1 ? '' : 's'}`}
          </button>
        )}

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-300">
              <th className="py-2 pr-4">Roastery</th>
              <th className="py-2 pr-4">URL</th>
              <th className="py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {universalRows.map(row => (
              <tr key={row.source} className="border-b border-stone-200">
                <td className="py-2 pr-4">{SOURCE_LABEL[row.source] ?? row.source}</td>
                <td className="py-2 pr-4 font-mono text-xs text-stone-700">{row.url}</td>
                <td className="py-2">
                  <button
                    onClick={() => copy(row.url, row.token)}
                    className="text-xs uppercase tracking-wide font-semibold text-[#a33726]"
                  >
                    {copiedToken === row.token ? 'Copied' : 'Copy'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-stone-50 p-6 text-sm text-stone-600 mb-12">
        <p className="font-medium mb-2">Print-QA checklist before mass print</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Test the actual code at final label size on final bag material — not a screen preview.</li>
          <li>Matte finishes and low-contrast palettes are the classic way a QR passes on screen and fails on a counter.</li>
          <li>Scan one real printed test code with a phone before committing to a full print run.</li>
          <li>Confirm whose printer the artwork lands on (roastery vs. Axis &amp; Bloom-supplied labels).</li>
        </ul>
      </div>

      {/* ── Digital links — never printed ── */}
      <p className="text-xs uppercase tracking-[0.2em] font-semibold text-stone-400 mb-1">
        Digital links (not for print)
      </p>
      <p className="text-sm text-stone-500 mb-6">
        One token per coffee, used only in story-page links and emails. These are never label artwork — if you're
        looking for the printed code, it's above.
      </p>

      {missingCount > 0 && (
        <button
          onClick={mintMissing}
          disabled={minting}
          className="mb-6 px-4 py-2 text-xs uppercase tracking-wide border border-stone-300 text-stone-600 disabled:opacity-50"
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
                    className="text-xs uppercase tracking-wide text-stone-500"
                  >
                    {copiedToken === row.token ? 'Copied' : 'Copy'}
                  </button>
                ) : (
                  <button
                    onClick={() => mintOne(row.coffeeId)}
                    className="text-xs uppercase tracking-wide text-stone-500"
                  >
                    Mint
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
