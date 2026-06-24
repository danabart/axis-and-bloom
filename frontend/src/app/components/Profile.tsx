import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Package, Heart, LogOut, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getUserProfile } from '../lib/api';
import FamilyTab from './FamilyTab';

type Tab = 'memory' | 'orders' | 'settings' | 'family';

interface Address {
  id: string;
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: boolean;
}

interface ProfileData {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  isAdmin: boolean;
  archetype: any;
  addresses: Address[];
  orders: any[];
}

const EMPTY_ADDRESS = { street: '', city: '', state: '', postalCode: '', country: 'US', addressType: 'shipping' as 'shipping' | 'billing' };

export default function Profile() {
  const [activeTab, setActiveTab]         = useState<Tab>('memory');
  const [profile, setProfile]             = useState<ProfileData | null>(null);
  const [loading, setLoading]             = useState(true);
  const { user, logout }                  = useAuth();
  const navigate                          = useNavigate();

  // Settings form state
  const [firstName, setFirstName]         = useState('');
  const [lastName, setLastName]           = useState('');
  const [dateOfBirth, setDateOfBirth]     = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved]   = useState(false);

  // Address form state
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [addressForm, setAddressForm]         = useState(EMPTY_ADDRESS);
  const [savingAddress, setSavingAddress]     = useState(false);
  const [addressError, setAddressError]       = useState('');
  const [sameAsShipping, setSameAsShipping]   = useState(false);

  useEffect(() => {
    if (!user) { navigate('/sign-in'); return; }
    getUserProfile()
      .then((data: ProfileData) => {
        setProfile(data);
        setFirstName(data.firstName ?? '');
        setLastName(data.lastName ?? '');
        setDateOfBirth(data.dateOfBirth ? data.dateOfBirth.slice(0, 10) : '');
      })
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [user]);

  const handleLogout = async () => { await logout(); navigate('/'); };

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileSaved(false);
    try {
      const token = await user!.getIdToken();
      await fetch('/api/users/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ firstName: firstName || null, lastName: lastName || null, dateOfBirth: dateOfBirth || null }),
      });
      setProfile(p => p ? { ...p, firstName, lastName, dateOfBirth: dateOfBirth || null } : p);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch { /* silent */ } finally { setSavingProfile(false); }
  }

  async function handleAddAddress(e: React.FormEvent) {
    e.preventDefault();
    setSavingAddress(true); setAddressError('');
    try {
      const token = await user!.getIdToken();
      const res = await fetch('/api/users/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...addressForm }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      const newAddr = await res.json();
      setProfile(p => p ? { ...p, addresses: [...p.addresses, newAddr] } : p);
      setAddressForm(EMPTY_ADDRESS);
      setShowAddressForm(false);
    } catch (err: any) {
      setAddressError(err.message ?? 'Failed to save address');
    } finally { setSavingAddress(false); }
  }

  async function handleSetDefault(id: string, type: string) {
    try {
      const token = await user!.getIdToken();
      await fetch(`/api/users/addresses/${id}/default`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      setProfile(p => p ? {
        ...p,
        addresses: p.addresses.map(a =>
          a.address_type === type ? { ...a, is_default: a.id === id } : a
        ),
      } : p);
    } catch { /* silent */ }
  }

  async function handleDeleteAddress(id: string) {
    try {
      const token = await user!.getIdToken();
      await fetch(`/api/users/addresses/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setProfile(p => p ? { ...p, addresses: p.addresses.filter(a => a.id !== id) } : p);
    } catch { /* silent */ }
  }

  if (loading) {
    return <div className="w-full h-screen bg-[#f2f1ea] flex items-center justify-center"><p className="text-[#a33726] text-sm uppercase tracking-widest">Loading...</p></div>;
  }

  const archetype  = profile?.archetype;
  const pastOrders = profile?.orders ?? [];
  const displayName = profile?.firstName
    ? `${profile.firstName}${profile.lastName ? ' ' + profile.lastName : ''}`
    : (user?.displayName ?? user?.email ?? '');

  const inputClass = "w-full text-left text-base tracking-wide transition-all duration-300 py-2.5 rounded-none border-b border-[#a33726]/30 bg-transparent focus:outline-none focus:border-[#ee5974] text-[#a33726] placeholder-[#a33726]/40";
  const labelClass = "block text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 mb-1.5 font-normal";

  return (
    <div className="w-full h-screen bg-[#f2f1ea] flex overflow-hidden">
      <div className="hidden lg:flex w-1/2 bg-[#1a1a1a] relative flex-col justify-center items-center overflow-hidden">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1080&q=80')` }} />
      </div>

      <div className="w-full lg:w-1/2 flex flex-col p-8 md:p-16 lg:p-24 relative z-10 overflow-y-auto">
        <div className="mt-16 lg:mt-8 mb-16">
          <h3 className="text-[10px] uppercase tracking-[0.3em] text-[#a33726]/60 mb-4 font-normal">
            Welcome back, {displayName}
          </h3>
          <h1 className="text-[3rem] lg:text-[4rem] text-[#a33726] leading-[1.05] font-normal tracking-tight">
            {archetype ? 'Your flavor memory.' : 'Trust your taste.'}
          </h1>
        </div>

        <div className="flex w-full mb-12 border-b border-[#a33726]/20 relative gap-8">
          {(['memory', 'orders', 'settings', 'family'] as Tab[]).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`pb-4 text-[11px] uppercase tracking-[0.2em] font-normal transition-colors relative ${activeTab === tab ? 'text-[#ee5974]' : 'text-[#a33726]/40 hover:text-[#a33726]/70'}`}>
              {tab === 'memory' ? 'Flavor Memory' : tab === 'orders' ? 'Past Orders' : tab === 'settings' ? 'Settings' : 'Family'}
              {activeTab === tab && <motion.div layoutId="profile-tab-indicator" className="absolute bottom-0 left-0 right-0 h-[1px] bg-[#ee5974]" />}
            </button>
          ))}
        </div>

        <div className="flex-grow w-full max-w-[480px]">
          <AnimatePresence mode="wait">

            {/* ── Flavor Memory ── */}
            {activeTab === 'memory' && (
              <motion.div key="memory" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }} className="flex flex-col gap-12">
                {!archetype ? (
                  <div className="flex flex-col items-start gap-6 py-8">
                    <Heart size={32} className="text-[#a33726]/30" strokeWidth={1} />
                    <p className="text-lg text-[#a33726]/70 tracking-wide font-light leading-relaxed">You haven't discovered your flavor archetype yet. Take the quiz to unlock exact matches tailored to your palate.</p>
                    <Link to="/find-my-flavor" className="mt-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-[#a33726] border-b border-[#a33726]/30 pb-1 hover:border-[#a33726] hover:text-[#ee5974] transition-colors">Start the Quiz <ArrowRight size={14} /></Link>
                  </div>
                ) : (
                  <div>
                    <h2 className="text-2xl text-[#a33726] font-normal mb-8">Your Archetype: {archetype.name}</h2>
                    <ul className="flex flex-col gap-6">
                      {(archetype.features ?? []).map((f: string, i: number) => (
                        <li key={i} className="flex items-start gap-5">
                          <div className="w-[1px] h-8 shrink-0 opacity-40 mt-1" style={{ backgroundColor: '#ee5974' }} />
                          <span className="text-lg text-[#a33726]/80 font-light leading-relaxed">{f}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Liam entry point */}
                    <div className="mt-10 border-t border-[#a33726]/10 pt-8">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[#a33726]/40 mb-3">Coffee Sommelier</p>
                      <Link
                        to="/sommelier?entry=user_initiated"
                        className="flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-[#a33726] border-b border-[#a33726]/30 pb-1 hover:border-[#a33726] transition-colors w-fit"
                      >
                        Talk to Liam <ArrowRight size={14} />
                      </Link>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Past Orders ── */}
            {activeTab === 'orders' && (
              <motion.div key="orders" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }} className="flex flex-col gap-8">
                {pastOrders.length === 0 ? (
                  <div className="flex flex-col items-start gap-6 py-8">
                    <Package size={32} className="text-[#a33726]/30" strokeWidth={1} />
                    <p className="text-lg text-[#a33726]/70 tracking-wide font-light leading-relaxed">You haven't placed any orders yet.</p>
                    <Link to="/shop" className="mt-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-[#a33726] border-b border-[#a33726]/30 pb-1 hover:border-[#a33726] hover:text-[#ee5974] transition-colors">Explore the Shop <ArrowRight size={14} /></Link>
                  </div>
                ) : (
                  <div className="flex flex-col gap-8">
                    {pastOrders.map((order: any, idx: number) => (
                      <div key={idx} className="flex flex-col border border-[#a33726]/20 bg-white/40 p-6">
                        <div className="flex justify-between items-end mb-6 pb-6 border-b border-[#a33726]/10">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 mb-2 font-normal">Order {order.id}</p>
                            <p className="text-sm text-[#a33726] font-normal">{order.date}</p>
                          </div>
                          <span className="text-[10px] font-normal px-2 py-1 bg-[#a33726]/10 text-[#a33726] rounded-sm uppercase tracking-[0.1em]">{order.status}</span>
                        </div>
                        <p className="text-lg text-[#a33726]">Total: {order.total}</p>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Family ── */}
            {activeTab === 'family' && (
              <motion.div key="family" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }}>
                <FamilyTab />
              </motion.div>
            )}

            {/* ── Settings ── */}
            {activeTab === 'settings' && (
              <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }} className="flex flex-col gap-10">

                {/* Personal info */}
                <form onSubmit={handleSaveProfile} className="flex flex-col gap-6">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 font-normal">Personal Info</p>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className={labelClass}>First name</label>
                      <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" className={inputClass} />
                    </div>
                    <div className="flex-1">
                      <label className={labelClass}>Last name</label>
                      <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" className={inputClass} />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Email</label>
                    <p className="text-base text-[#a33726]/60 py-2.5 border-b border-[#a33726]/10">{profile?.email ?? user?.email ?? '—'}</p>
                  </div>
                  <div>
                    <label className={labelClass}>Birthday <span className="opacity-50 normal-case tracking-normal">— for exclusive promos</span></label>
                    <input type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} className={inputClass} style={{ colorScheme: 'light' }} />
                  </div>
                  <div className="flex items-center gap-4 pt-2">
                    <button type="submit" disabled={savingProfile}
                      className="text-[10px] uppercase tracking-[0.3em] text-[#a33726] border-b border-[#a33726]/40 pb-1 hover:border-[#ee5974] hover:text-[#ee5974] transition-colors disabled:opacity-30">
                      {savingProfile ? 'Saving…' : 'Save Changes'}
                    </button>
                    {profileSaved && <span className="text-[10px] uppercase tracking-[0.2em] text-green-700">Saved</span>}
                  </div>
                </form>

                {/* Addresses — Shipping + Billing */}
                {(['shipping', 'billing'] as const).map(type => {
                  const typeAddresses = (profile?.addresses ?? []).filter(a => a.address_type === type);
                  const isThisFormOpen = showAddressForm && addressForm.addressType === type;
                  const defaultShipping = (profile?.addresses ?? []).find(a => a.address_type === 'shipping' && a.is_default);

                  return (
                    <div key={type} className="flex flex-col gap-4 border-t border-[#a33726]/10 pt-8">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 font-normal">
                        {type === 'shipping' ? 'Shipping Addresses' : 'Billing Addresses'}
                      </p>

                      {typeAddresses.map(addr => (
                        <div key={addr.id}
                          className="flex items-start justify-between p-4 bg-white/40"
                          style={{ border: `1px solid ${addr.is_default ? '#a33726' : 'rgba(163,55,38,0.15)'}` }}
                        >
                          <div>
                            {addr.is_default && (
                              <span className="text-[9px] uppercase tracking-widest font-normal block mb-1.5" style={{ color: '#a33726' }}>
                                ✓ Default {type} address
                              </span>
                            )}
                            <p className="text-sm text-[#a33726] font-light">{addr.street}</p>
                            <p className="text-sm text-[#a33726]/70 font-light">{addr.city}, {addr.state} {addr.postal_code}</p>
                            <p className="text-sm text-[#a33726]/50 font-light">{addr.country}</p>
                          </div>
                          <div className="flex flex-col items-end gap-2 ml-4 mt-1 shrink-0">
                            {!addr.is_default && (
                              <button onClick={() => handleSetDefault(addr.id, type)}
                                className="text-[9px] uppercase tracking-[0.2em] text-[#a33726]/50 hover:text-[#a33726] transition-colors whitespace-nowrap">
                                Use as default
                              </button>
                            )}
                            <button onClick={() => handleDeleteAddress(addr.id)}
                              className="text-[9px] uppercase tracking-[0.2em] text-[#a33726]/30 hover:text-[#a33726] transition-colors">
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}

                      {!isThisFormOpen ? (
                        <button
                          onClick={() => {
                            setSameAsShipping(false);
                            setShowAddressForm(true);
                            setAddressForm({ ...EMPTY_ADDRESS, addressType: type });
                            setAddressError('');
                          }}
                          className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/50 hover:text-[#a33726] transition-colors border-b border-[#a33726]/20 pb-1 w-fit">
                          + Add {type === 'shipping' ? 'Shipping' : 'Billing'} Address
                        </button>
                      ) : (
                        <form onSubmit={handleAddAddress} className="flex flex-col gap-4 border border-[#a33726]/15 p-4 bg-white/40">

                          {/* Same as shipping checkbox — billing only */}
                          {type === 'billing' && defaultShipping && (
                            <label className="flex items-center gap-2.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={sameAsShipping}
                                onChange={e => {
                                  const checked = e.target.checked;
                                  setSameAsShipping(checked);
                                  if (checked) {
                                    setAddressForm(f => ({
                                      ...f,
                                      street: defaultShipping.street,
                                      city: defaultShipping.city,
                                      state: defaultShipping.state,
                                      postalCode: defaultShipping.postal_code,
                                      country: defaultShipping.country,
                                    }));
                                  } else {
                                    setAddressForm(f => ({ ...f, street: '', city: '', state: '', postalCode: '', country: 'US' }));
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
                            <input required value={addressForm.street} onChange={e => setAddressForm(f => ({ ...f, street: e.target.value }))} placeholder="123 Main St" className={inputClass} disabled={sameAsShipping} />
                          </div>
                          <div className="flex gap-3">
                            <div className="flex-1">
                              <label className={labelClass}>City</label>
                              <input required value={addressForm.city} onChange={e => setAddressForm(f => ({ ...f, city: e.target.value }))} placeholder="New York" className={inputClass} disabled={sameAsShipping} />
                            </div>
                            <div className="w-20">
                              <label className={labelClass}>State</label>
                              <input required value={addressForm.state} onChange={e => setAddressForm(f => ({ ...f, state: e.target.value }))} placeholder="NY" maxLength={2} className={inputClass} disabled={sameAsShipping} />
                            </div>
                            <div className="w-24">
                              <label className={labelClass}>ZIP</label>
                              <input required value={addressForm.postalCode} onChange={e => setAddressForm(f => ({ ...f, postalCode: e.target.value }))} placeholder="10001" className={inputClass} disabled={sameAsShipping} />
                            </div>
                          </div>
                          {addressError && <p className="text-xs text-red-600">{addressError}</p>}
                          <div className="flex gap-4 pt-2">
                            <button type="submit" disabled={savingAddress}
                              className="text-[10px] uppercase tracking-[0.3em] text-[#a33726] border-b border-[#a33726]/40 pb-1 hover:border-[#ee5974] hover:text-[#ee5974] transition-colors disabled:opacity-30">
                              {savingAddress ? 'Saving…' : 'Save Address'}
                            </button>
                            <button type="button" onClick={() => { setShowAddressForm(false); setSameAsShipping(false); setAddressForm(EMPTY_ADDRESS); setAddressError(''); }}
                              className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/40 hover:text-[#a33726] transition-colors">
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  );
                })}

                {/* Sign out */}
                <div className="border-t border-[#a33726]/10 pt-8">
                  <button onClick={handleLogout} className="flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-[#a33726]/60 hover:text-[#a33726] transition-colors">
                    <LogOut size={14} /> Sign Out
                  </button>
                </div>

              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
