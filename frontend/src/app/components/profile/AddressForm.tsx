import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

// Commerce 1, C2 (2026-10-31) — extracted from Profile.tsx's Settings tab so
// /checkout can add a ships-to address with the exact same form (same fields,
// same POST /api/users/addresses, same "Same as my shipping address" option
// for billing). Profile renders it unchanged.

export const inputClass = "w-full text-left text-base tracking-wide transition-all duration-300 py-2.5 rounded-none border-b border-[#a33726]/30 bg-transparent focus:outline-none focus:border-[#ee5974] text-[#a33726] placeholder-[#a33726]/40";
export const labelClass = "block text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 mb-1.5 font-normal";

export interface SavedAddress {
  id: string;
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: boolean;
  address_type?: 'shipping' | 'billing';
}

interface AddressFormProps {
  addressType: 'shipping' | 'billing';
  /** Billing only: offers "Same as my shipping address" when given. */
  defaultShipping?: SavedAddress | null;
  onSaved: (address: SavedAddress) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

export default function AddressForm({ addressType, defaultShipping, onSaved, onCancel, submitLabel = 'Save Address' }: AddressFormProps) {
  const { user } = useAuth();
  const empty = { street: '', city: '', state: '', postalCode: '', country: 'US', addressType };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sameAsShipping, setSameAsShipping] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const token = await user!.getIdToken();
      const res = await fetch('/api/users/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      const newAddr = await res.json();
      setForm(empty);
      setSameAsShipping(false);
      onSaved(newAddr);
    } catch (err: any) {
      reportError('[AddressForm/add-address]', err);
      setError(err.message ?? 'Failed to save address');
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 border border-[#a33726]/15 p-4 bg-white/40">

      {/* Same as shipping checkbox — billing only */}
      {addressType === 'billing' && defaultShipping && (
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={sameAsShipping}
            onChange={e => {
              const checked = e.target.checked;
              setSameAsShipping(checked);
              if (checked) {
                setForm(f => ({
                  ...f,
                  street: defaultShipping.street,
                  city: defaultShipping.city,
                  state: defaultShipping.state,
                  postalCode: defaultShipping.postal_code,
                  country: defaultShipping.country,
                }));
              } else {
                setForm(f => ({ ...f, street: '', city: '', state: '', postalCode: '', country: 'US' }));
              }
            }}
            className="accent-[#a33726]"
          />
          <span className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60">
            Same as my shipping address
          </span>
        </label>
      )}

      <div>
        <label className={labelClass}>Street</label>
        <input required value={form.street} onChange={e => setForm(f => ({ ...f, street: e.target.value }))} placeholder="123 Main St" className={inputClass} disabled={sameAsShipping} />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelClass}>City</label>
          <input required value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="New York" className={inputClass} disabled={sameAsShipping} />
        </div>
        <div className="w-20">
          <label className={labelClass}>State</label>
          <input required value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} placeholder="NY" maxLength={2} className={inputClass} disabled={sameAsShipping} />
        </div>
        <div className="w-24">
          <label className={labelClass}>ZIP</label>
          <input required value={form.postalCode} onChange={e => setForm(f => ({ ...f, postalCode: e.target.value }))} placeholder="10001" className={inputClass} disabled={sameAsShipping} />
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-4 pt-2">
        <button type="submit" disabled={saving}
          className="text-[10px] uppercase tracking-[0.3em] text-[#a33726] border-b border-[#a33726]/40 pb-1 hover:border-[#ee5974] hover:text-[#ee5974] transition-colors disabled:opacity-30">
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={() => { setSameAsShipping(false); setForm(empty); setError(''); onCancel(); }}
            className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/40 hover:text-[#a33726] transition-colors">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
