import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

interface UniversalTokenRow {
  source: string;
  token: string;
  url: string;
}

/** HOME_TASK_7 (§3.1, QR indirection) — originally the artwork-export page,
 * every active coffee's full `/b/{token}` URL for the label-design pass.
 *
 * HOME_TASK_7C (strategy §9, 2026-08-03) — the printed QR became universal:
 * one identical code on every bag, both roasteries.
 *
 * HOME_TASK_7E (decisions 2026-08-04, amends 7c) — simplified again: exactly
 * ONE printed code, not one per roastery (decision #0 — GET
 * /api/admin/qr/universal-tokens now returns a single row, not a list), and
 * per-coffee tokens are retired from every surface (decision #2) — the
 * "Digital links" section that used to live below is gone entirely, not
 * just demoted. This page is now just the printed code and the print-QA
 * checklist, nothing else. */
export default function AdminQrDoor() {
  const { user } = useAuth();
  const [row, setRow] = useState<UniversalTokenRow | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function apiFetch(url: string, options: RequestInit = {}) {
    const token = await user!.getIdToken();
    return fetch(url, {
      cache: 'no-store', ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
  }

  async function load() {
    try {
      const res = await apiFetch('/api/admin/qr/universal-tokens');
      setRow(await res.json());
    } catch (err) { reportError('[AdminQrDoor/load]', err); setError('Failed to load the QR code'); }
  }

  useEffect(() => { if (user) load(); }, [user]);

  function copy(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-xl mb-1">QR Door</h1>
      <p className="text-sm text-stone-500 mb-6">
        One identical code, printed on every bag, both roasteries.
      </p>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {/* ── Printed code — the only thing meant to ever reach a printer ── */}
      <div className="mb-4 border-2 border-[#a33726] bg-[#a33726]/5 p-6">
        <p className="text-xs uppercase tracking-[0.2em] font-semibold mb-1" style={{ color: '#a33726' }}>
          Printed code
        </p>
        <p className="text-sm text-stone-600 mb-4">
          This is what goes on the bag label — same physical artwork element for both roasteries.
        </p>

        {row ? (
          <div className="flex items-center gap-4">
            <span className="font-mono text-xs text-stone-700 break-all">{row.url}</span>
            <button
              onClick={() => copy(row.url)}
              className="shrink-0 text-xs uppercase tracking-wide font-semibold text-[#a33726]"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        ) : (
          !error && <p className="text-sm text-stone-400">Loading…</p>
        )}
      </div>

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
