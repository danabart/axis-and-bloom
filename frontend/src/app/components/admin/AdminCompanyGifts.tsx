import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface CompanyGiftSummary {
  id: string;
  company_name: string;
  seat_count: number;
  sponsorship_months: number;
  admin_contact_name: string | null;
  admin_contact_email: string;
  code_redeem_by: string | null;
  payment_confirmed_at: string | null;
  total_amount_cents: number | null;
  created_at: string;
  company_id: string | null;
  redeemed_count: string;
  remaining_count: string;
  expired_count: string;
  company_gift_count: string;
}

interface CompanySuggestion {
  id: string;
  companyName: string;
}

interface CompanyGiftDetailData {
  companyGift: CompanyGiftSummary & { payment_notes: string | null };
  codes: Array<{ id: string; code: string; status: string; redeemed_at: string | null; created_at: string }>;
}

type FormData = {
  companyName: string;
  seatCount: string;
  sponsorshipMonths: string;
  adminContactName: string;
  adminContactEmail: string;
  codeRedeemBy: string;
  paymentNotes: string;
  totalAmountDollars: string;
  paymentAlreadyReceived: boolean;
};

const EMPTY_FORM: FormData = {
  companyName: '', seatCount: '', sponsorshipMonths: '3', adminContactName: '', adminContactEmail: '',
  codeRedeemBy: '', paymentNotes: '', totalAmountDollars: '', paymentAlreadyReceived: false,
};

function PaymentBadge({ confirmedAt }: { confirmedAt: string | null }) {
  return confirmedAt ? (
    <span className="px-2 py-0.5 rounded-full text-xs font-normal bg-green-100 text-green-700">Confirmed</span>
  ) : (
    <span className="px-2 py-0.5 rounded-full text-xs font-normal bg-amber-100 text-amber-700">Pending</span>
  );
}

function NewGiftForm({ onCreated, onCancel, getToken }: {
  onCreated: (giftId: string) => void;
  onCancel: () => void;
  getToken: () => Promise<string>;
}) {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const f = (k: keyof FormData) => (v: string | boolean) => setForm(prev => ({ ...prev, [k]: v as any }));

  // Company combobox — type to search existing companies (see GET /api/admin/companies),
  // select one to reuse it, or keep a non-matching name to fall through to create-new.
  const [companySuggestions, setCompanySuggestions] = useState<CompanySuggestion[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleCompanyNameChange(value: string) {
    f('companyName')(value);
    setSelectedCompanyId(null); // typing after a selection falls through to create-new
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!value.trim()) { setCompanySuggestions([]); setShowSuggestions(false); return; }
    searchDebounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/admin/companies?search=${encodeURIComponent(value.trim())}`, {
        headers: { Authorization: `Bearer ${await getToken()}` },
      });
      if (res.ok) {
        const data: CompanySuggestion[] = await res.json();
        setCompanySuggestions(data);
        setShowSuggestions(data.length > 0);
      }
    }, 300);
  }

  function handleSelectCompany(company: CompanySuggestion) {
    setSelectedCompanyId(company.id);
    f('companyName')(company.companyName);
    setShowSuggestions(false);
    setCompanySuggestions([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/company-gifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
        body: JSON.stringify({
          companyId: selectedCompanyId ?? undefined,
          companyName: form.companyName.trim(),
          seatCount: Number(form.seatCount),
          sponsorshipMonths: Number(form.sponsorshipMonths) || 3,
          adminContactName: form.adminContactName.trim() || undefined,
          adminContactEmail: form.adminContactEmail.trim(),
          codeRedeemBy: form.codeRedeemBy || undefined,
          paymentNotes: form.paymentNotes.trim() || undefined,
          totalAmountCents: form.totalAmountDollars ? Math.round(Number(form.totalAmountDollars) * 100) : undefined,
          paymentAlreadyReceived: form.paymentAlreadyReceived,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create company gift');
      onCreated(data.companyGift.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create company gift');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="md:col-span-2 relative">
        <label className="block text-xs text-stone-500 mb-1">Company Name *</label>
        <input
          required
          value={form.companyName}
          onChange={e => handleCompanyNameChange(e.target.value)}
          onFocus={() => { if (companySuggestions.length) setShowSuggestions(true); }}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="e.g. Acme Corp"
          autoComplete="off"
        />
        {showSuggestions && (
          <ul className="absolute z-10 w-full mt-1 bg-white border border-stone-200 rounded shadow-sm max-h-48 overflow-auto">
            {companySuggestions.map(c => (
              <li key={c.id}>
                <button type="button" onMouseDown={() => handleSelectCompany(c)}
                  className="w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-stone-50">
                  {c.companyName}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-stone-400 mt-1">
          {selectedCompanyId ? '✓ Linking to existing company' : 'No match selected — will create a new company record'}
        </p>
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Seat Count *</label>
        <input required type="number" min="1" value={form.seatCount} onChange={e => f('seatCount')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm" placeholder="e.g. 25" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Sponsorship Months</label>
        <input type="number" min="1" value={form.sponsorshipMonths} onChange={e => f('sponsorshipMonths')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Contact Name</label>
        <input value={form.adminContactName} onChange={e => f('adminContactName')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm" placeholder="e.g. Jane Smith" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Contact Email *</label>
        <input required type="email" value={form.adminContactEmail} onChange={e => f('adminContactEmail')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm" placeholder="hr@acmecorp.com" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Redeem By <span className="opacity-60">(optional)</span></label>
        <input type="date" value={form.codeRedeemBy} onChange={e => f('codeRedeemBy')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Total Amount ($) <span className="opacity-60">(optional)</span></label>
        <input type="number" min="0" step="0.01" value={form.totalAmountDollars} onChange={e => f('totalAmountDollars')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm" placeholder="e.g. 1250.00" />
      </div>
      <div className="md:col-span-2">
        <label className="block text-xs text-stone-500 mb-1">Payment Notes <span className="opacity-60">(internal only)</span></label>
        <textarea rows={2} value={form.paymentNotes} onChange={e => f('paymentNotes')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm resize-none" placeholder="Terms, invoice #, wire ref…" />
      </div>
      <div className="md:col-span-2">
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" checked={form.paymentAlreadyReceived} onChange={e => f('paymentAlreadyReceived')(e.target.checked)} />
          Payment already received — activate codes immediately
        </label>
      </div>
      {error && <p className="md:col-span-2 text-red-500 text-sm">{error}</p>}
      <div className="md:col-span-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded text-sm border border-stone-200 text-stone-500 hover:bg-stone-50">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="px-5 py-2 rounded text-sm font-normal text-white disabled:opacity-50" style={{ backgroundColor: '#b05642' }}>
          {saving ? 'Creating…' : 'Create Company Gift'}
        </button>
      </div>
    </form>
  );
}

function GiftDetail({ giftId, getToken, onBack }: {
  giftId: string;
  getToken: () => Promise<string>;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<CompanyGiftDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [template, setTemplate] = useState<string | null>(null);
  const [isCustomTemplate, setIsCustomTemplate] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/admin/company-gifts/${giftId}`, { headers: { Authorization: `Bearer ${await getToken()}` } });
    if (res.ok) setDetail(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, [giftId]);

  async function handleConfirmPayment() {
    setConfirming(true);
    try {
      await fetch(`/api/admin/company-gifts/${giftId}/confirm-payment`, {
        method: 'POST', headers: { Authorization: `Bearer ${await getToken()}` },
      });
      await load();
    } finally {
      setConfirming(false);
    }
  }

  async function handleDownloadCsv() {
    const res = await fetch(`/api/admin/company-gifts/${giftId}/codes.csv`, { headers: { Authorization: `Bearer ${await getToken()}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `company-gift-codes-${detail?.companyGift.company_name ?? giftId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleShowTemplate() {
    const res = await fetch(`/api/admin/company-gifts/${giftId}/email-template`, { headers: { Authorization: `Bearer ${await getToken()}` } });
    const data = await res.json();
    setTemplate(data.template);
    setIsCustomTemplate(data.isCustom);
    setCopied(false);
    setTemplateError('');
  }

  async function handleCopyTemplate() {
    if (!template) return;
    await navigator.clipboard.writeText(template);
    setCopied(true);
  }

  async function handleSaveTemplate() {
    setSavingTemplate(true);
    setTemplateError('');
    try {
      const res = await fetch(`/api/admin/company-gifts/${giftId}/email-template`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
        body: JSON.stringify({ template }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save template');
      setTemplate(data.template);
      setIsCustomTemplate(data.isCustom);
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleResetTemplate() {
    setSavingTemplate(true);
    setTemplateError('');
    try {
      const res = await fetch(`/api/admin/company-gifts/${giftId}/email-template`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
        body: JSON.stringify({ template: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to reset template');
      setTemplate(data.template);
      setIsCustomTemplate(data.isCustom);
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Failed to reset template');
    } finally {
      setSavingTemplate(false);
    }
  }

  if (loading) return <p className="text-stone-400 text-sm py-8 text-center">Loading…</p>;
  if (!detail) return <p className="text-red-500 text-sm">Company gift not found.</p>;

  const { companyGift, codes } = detail;

  return (
    <div>
      <button onClick={onBack} className="text-xs text-stone-500 hover:text-stone-800 mb-4">← Back to Company Gifts</button>

      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-normal text-stone-800">{companyGift.company_name}</h1>
        <PaymentBadge confirmedAt={companyGift.payment_confirmed_at} />
      </div>
      <p className="text-sm text-stone-500 mb-6">
        {companyGift.seat_count} seats · {companyGift.sponsorship_months} months · {companyGift.admin_contact_email}
        {companyGift.code_redeem_by && ` · redeem by ${new Date(companyGift.code_redeem_by).toLocaleDateString()}`}
      </p>

      {!companyGift.payment_confirmed_at && (
        <div className="border border-amber-300 bg-amber-50 rounded-lg px-5 py-4 mb-6 flex items-center justify-between">
          <p className="text-sm text-amber-800">Codes generated but not yet active — confirm payment to activate.</p>
          <button onClick={handleConfirmPayment} disabled={confirming}
            className="px-4 py-2 rounded text-sm font-normal text-white disabled:opacity-50" style={{ backgroundColor: '#b05642' }}>
            {confirming ? 'Confirming…' : 'Mark as Paid'}
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-6">
        <button onClick={handleDownloadCsv} className="px-4 py-2 rounded text-sm border border-stone-200 text-stone-600 hover:bg-stone-50">
          Download CSV
        </button>
        <button onClick={handleShowTemplate} className="px-4 py-2 rounded text-sm border border-stone-200 text-stone-600 hover:bg-stone-50">
          Email Template
        </button>
      </div>

      {template !== null && (
        <div className="border border-stone-200 rounded-lg p-4 mb-6 bg-stone-50">
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs ${isCustomTemplate ? 'text-amber-700' : 'text-stone-500'}`}>
              {isCustomTemplate ? 'Custom template for this company' : 'Using default template'}
            </span>
          </div>
          <textarea
            value={template}
            onChange={e => setTemplate(e.target.value)}
            rows={11}
            className="w-full text-xs text-stone-700 font-sans bg-white border border-stone-200 rounded p-3 resize-y focus:outline-none focus:border-[#b05642]"
          />
          {templateError && <p className="text-red-500 text-xs mt-2">{templateError}</p>}
          <div className="flex gap-2 mt-3">
            <button onClick={handleCopyTemplate} className="px-3 py-1.5 rounded text-xs border border-stone-300 text-stone-600 hover:bg-stone-100">
              {copied ? 'Copied ✓' : 'Copy to clipboard'}
            </button>
            <button onClick={handleSaveTemplate} disabled={savingTemplate}
              className="px-3 py-1.5 rounded text-xs font-normal text-white disabled:opacity-50" style={{ backgroundColor: '#b05642' }}>
              {savingTemplate ? 'Saving…' : 'Save'}
            </button>
            {isCustomTemplate && (
              <button onClick={handleResetTemplate} disabled={savingTemplate}
                className="px-3 py-1.5 rounded text-xs border border-stone-300 text-stone-600 hover:bg-stone-100 disabled:opacity-50">
                Reset to default
              </button>
            )}
          </div>
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-stone-500 border-b border-stone-200">
            <th className="py-2 font-normal">Code</th>
            <th className="py-2 font-normal">Status</th>
            <th className="py-2 font-normal">Redeemed</th>
          </tr>
        </thead>
        <tbody>
          {codes.map(c => (
            <tr key={c.id} className="border-b border-stone-100">
              <td className="py-2 font-mono text-stone-700">{c.code}</td>
              <td className="py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-normal ${
                  c.status === 'redeemed' ? 'bg-stone-200 text-stone-600' :
                  c.status === 'expired'  ? 'bg-red-100 text-red-700' :
                  'bg-green-100 text-green-700'
                }`}>
                  {c.status}
                </span>
              </td>
              <td className="py-2 text-stone-500">{c.redeemed_at ? new Date(c.redeemed_at).toLocaleDateString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminCompanyGifts() {
  const { user } = useAuth();
  const [gifts, setGifts] = useState<CompanyGiftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function getToken() { return user!.getIdToken(); }

  async function load() {
    try {
      const res = await fetch('/api/admin/company-gifts', { headers: { Authorization: `Bearer ${await getToken()}` } });
      const data = await res.json();
      if (!Array.isArray(data)) { setError(data?.error ?? 'Failed to load company gifts'); setGifts([]); }
      else { setGifts(data); setError(''); }
    } catch {
      setError('Failed to load company gifts');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user && !selectedId) load(); }, [user, selectedId]);

  if (selectedId) {
    return (
      <GiftDetail
        giftId={selectedId}
        getToken={getToken}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-normal text-stone-800">Company Gifts</h1>
        <button onClick={() => setShowAddForm(v => !v)}
          className="px-4 py-2 rounded text-sm font-normal text-white hover:opacity-80" style={{ backgroundColor: '#b05642' }}>
          {showAddForm ? 'Cancel' : '+ New Company Gift'}
        </button>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {showAddForm && (
        <div className="border border-stone-200 rounded-lg p-6 mb-6 bg-stone-50">
          <NewGiftForm
            getToken={getToken}
            onCancel={() => setShowAddForm(false)}
            onCreated={giftId => { setShowAddForm(false); setSelectedId(giftId); }}
          />
        </div>
      )}

      {loading && <p className="text-stone-400 text-sm py-8 text-center">Loading…</p>}

      {!loading && gifts.length === 0 && !showAddForm && (
        <div className="py-12 text-center text-stone-400">
          <p className="text-lg mb-1">No company gifts yet</p>
          <p className="text-sm">Click "+ New Company Gift" to set up your first sponsored batch.</p>
        </div>
      )}

      <div className="space-y-2">
        {gifts.map(g => (
          <button
            key={g.id}
            onClick={() => setSelectedId(g.id)}
            className="w-full text-left border border-stone-200 rounded-lg px-5 py-4 hover:bg-stone-50 transition-colors flex items-center justify-between"
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="font-normal text-stone-800">{g.company_name}</p>
                <PaymentBadge confirmedAt={g.payment_confirmed_at} />
                {Number(g.company_gift_count) > 1 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-normal bg-blue-100 text-blue-700">
                    Repeat customer ({g.company_gift_count}x)
                  </span>
                )}
              </div>
              <p className="text-xs text-stone-500">
                {g.redeemed_count} / {g.seat_count} redeemed · {g.remaining_count} remaining
                {Number(g.expired_count) > 0 && ` · ${g.expired_count} expired`}
                {' · '}created {new Date(g.created_at).toLocaleDateString()}
              </p>
            </div>
            <span className="text-stone-300">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
