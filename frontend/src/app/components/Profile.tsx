import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Package, Heart, LogOut, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { getUserProfile, getHomepageState, getDialPosition, setDialPosition, getFlavorMemory, type FlavorMemoryData } from '../lib/api';
import { computeDefaultSortOrder } from './bloom/ArchetypeSection';
import { DialArchetypeSection } from './bloom/DialArchetypeSection';
import { CompareOverlay } from './bloom/CompareOverlay';
import { useArchetypeAdjacency } from './coffee-info/archetypeAdjacency';
import type { BloomDialHandle } from './BloomDialWidget';
import type { ArchetypeData, Slot } from './bloom/types';
import { slotKey } from './bloom/types';
import FamilyTab from './FamilyTab';
import OrderFeedbackForm from './OrderFeedbackForm';
import TastingJournal from './profile/TastingJournal';
import PalateTimeline from './profile/PalateTimeline';
import BrewProfileMirror from './profile/BrewProfileMirror';
import WorthExploring from './profile/WorthExploring';

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
  hasPhone: boolean;
  phoneNumber: string | null;
  smsOptIn: boolean;
}

interface HomepageState {
  stageCode: string;
  archetype: { name: string; id: string; color: string; features: string[] } | null;
  daysSinceQuiz: number | null;
  pendingFeedback: { orderId: string; blendName: string | null; coffeeId: number | null } | null;
  usualBlend: { id: string; name: string } | null;
  nextDeliveryDate: string | null;
}

const EMPTY_ADDRESS = { street: '', city: '', state: '', postalCode: '', country: 'US', addressType: 'shipping' as 'shipping' | 'billing' };

const VALID_TABS: Tab[] = ['memory', 'orders', 'settings', 'family'];

// Mirrors Home.tsx / FlavorIntelligencePage.tsx's own constant.
const FEEDBACK_NAG_SUPPRESS_DAYS = 14;

export default function Profile() {
  const [searchParams]                    = useSearchParams();
  const tabParam                          = searchParams.get('tab');
  const [activeTab, setActiveTab]         = useState<Tab>(
    VALID_TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'memory'
  );
  const [profile, setProfile]             = useState<ProfileData | null>(null);
  const [loading, setLoading]             = useState(true);
  const [feedbackOrderId, setFeedbackOrderId] = useState<string | null>(null);
  const { user, logout, loading: authLoading } = useAuth();
  const { addToCart }                     = useCart();
  const navigate                          = useNavigate();

  // Settings form state
  const [firstName, setFirstName]         = useState('');
  const [lastName, setLastName]           = useState('');
  const [dateOfBirth, setDateOfBirth]     = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved]   = useState(false);

  // SMS opt-in state
  const [smsOptIn, setSmsOptIn]               = useState(false);
  const [savingSms, setSavingSms]             = useState(false);

  // Phone number state (Profile Part 4)
  const [editingPhone, setEditingPhone]       = useState(false);
  const [phoneInput, setPhoneInput]           = useState('');
  const [savingPhone, setSavingPhone]         = useState(false);
  const [phoneError, setPhoneError]           = useState('');

  // Address form state
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [addressForm, setAddressForm]         = useState(EMPTY_ADDRESS);
  const [savingAddress, setSavingAddress]     = useState(false);
  const [addressError, setAddressError]       = useState('');
  const [sameAsShipping, setSameAsShipping]   = useState(false);

  // ── Lifecycle-driven Flavor Memory tab (Profile Part 1) ─────────────────────
  const [homepageState, setHomepageState]       = useState<HomepageState | null>(null);
  const [homepageStateLoaded, setHomepageStateLoaded] = useState(false);
  const [archetypesList, setArchetypesList]     = useState<ArchetypeData[]>([]);
  const [experimentalData, setExperimentalData] = useState<ArchetypeData | null>(null);
  const [dialSortOrder, setDialSortOrderState]  = useState<number | null>(null);
  const [revealedKeys, setRevealedKeys]         = useState<Set<string>>(new Set());
  const dialRef = useRef<BloomDialHandle | null>(null);
  const [compareState, setCompareState] = useState<{ open: boolean; archetype: string; archetypeLabel: string; slot: Slot | null }>({
    open: false, archetype: '', archetypeLabel: '', slot: null,
  });
  const [feedbackNudgeDismissed, setFeedbackNudgeDismissed] = useState(false);
  const adjacency = useArchetypeAdjacency();

  // ── Memory + Horizon layers (Profile Part 3) ────────────────────────────────
  const [flavorMemory, setFlavorMemory] = useState<FlavorMemoryData | null>(null);
  const [expandedJournalOrderId, setExpandedJournalOrderId] = useState<string | null>(null);

  function loadFlavorMemory() {
    getFlavorMemory().then(setFlavorMemory).catch(() => setFlavorMemory(null));
  }

  useEffect(() => {
    // Gated on authLoading, not just `user` — Firebase's onAuthStateChanged
    // starts with user=null before it resolves from persisted session storage,
    // so without this a signed-in user hitting a fresh page load (e.g. a
    // ?tab= deep link) could get bounced to /sign-in by a false negative.
    // Same guard FlavorIntelligencePage.tsx already uses for this exact race.
    if (authLoading) return;
    if (!user) { navigate('/sign-in'); return; }
    getUserProfile()
      .then((data: ProfileData) => {
        setProfile(data);
        setFirstName(data.firstName ?? '');
        setLastName(data.lastName ?? '');
        setDateOfBirth(data.dateOfBirth ? data.dateOfBirth.slice(0, 10) : '');
        setSmsOptIn(data.smsOptIn ?? false);
      })
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  useEffect(() => {
    if (authLoading || !user) return;
    getHomepageState()
      .then(setHomepageState)
      .catch(() => setHomepageState(null))
      .finally(() => setHomepageStateLoaded(true));
  }, [user, authLoading]);

  // Fetch the Memory/Horizon-layer data once we know there's an archetype box to
  // hang it under — mirrors the `showFullLayout` guard computed below (duplicated
  // here since hooks can't reference a const defined after the loading early-return).
  useEffect(() => {
    if (!homepageStateLoaded || !homepageState) return;
    if (homepageState.stageCode === 'NEW_NO_QUIZ' || !homepageState.archetype) return;
    loadFlavorMemory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homepageStateLoaded, homepageState]);

  // Archetype catalogue for the embedded ArchetypeSection — same public fetch
  // FlavorQuiz.tsx's returning-user screen and FlavorIntelligencePage.tsx use.
  useEffect(() => {
    fetch('/api/coffees/archetypes')
      .then(r => r.json())
      .then((data: ArchetypeData[]) => setArchetypesList(data))
      .catch(() => {});
    fetch('/api/coffees/experimental')
      .then(r => r.json())
      .then((data: ArchetypeData) => setExperimentalData(data))
      .catch(() => {});
  }, []);

  const matchArchetypeId = homepageState?.archetype?.id ?? null;
  const matchedData = matchArchetypeId
    ? (matchArchetypeId === 'experimental' ? experimentalData : archetypesList.find(a => a.archetype === matchArchetypeId) ?? null)
    : null;

  // Pre-set the dial to the user's saved position for this archetype (mirrors
  // FlavorQuiz.tsx's returning-user screen / BloomPage.tsx Phase D). User is
  // always signed in on this page, so no guest gating is needed here.
  useEffect(() => {
    if (!matchArchetypeId) return;
    getDialPosition(matchArchetypeId)
      .then(r => { if (r?.dialSortOrder != null) setDialSortOrderState(r.dialSortOrder); })
      .catch(() => {});
  }, [matchArchetypeId]);

  function handleDialSelect(archetype: string, sortOrder: number) {
    setDialSortOrderState(sortOrder);
    setDialPosition(archetype, sortOrder).catch(() => {});
  }

  function toggleReveal(key: string) {
    setRevealedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleHopClick(archetype: string, sortOrder: number) {
    dialRef.current?.rotateTo(sortOrder);
    setDialSortOrderState(sortOrder);
    setRevealedKeys(prev => new Set(prev).add(slotKey(archetype, sortOrder)));
  }

  function openCompare(archetype: string, archetypeLabel: string, slot: Slot) {
    setCompareState({ open: true, archetype, archetypeLabel, slot });
  }

  function registerDialRef(_archetype: string, handle: BloomDialHandle | null) {
    dialRef.current = handle;
  }

  // ── "Worth exploring" adjacent section (Profile Part 6, issue C) ────────────
  // Clicking a chip expands that archetype's full ArchetypeSection in place
  // below the primary match, instead of ejecting to Flavor Intelligence. This
  // needs its own selection/reveal state instance — same pattern FlavorQuiz.tsx
  // uses for its two independent ArchetypeSection instances — so turning the
  // adjacent dial or revealing its panel never touches the primary section's
  // state above. One adjacent section open at a time; clicking the active chip
  // again (or its ✕) collapses it, clicking the other chip swaps it.
  const [adjacentArchetypeId, setAdjacentArchetypeId] = useState<string | null>(null);
  const [adjacentSortOrder, setAdjacentSortOrderState] = useState<number | null>(null);
  const [adjacentRevealedKeys, setAdjacentRevealedKeys] = useState<Set<string>>(new Set());
  const adjacentDialRef = useRef<BloomDialHandle | null>(null);

  const adjacentData = adjacentArchetypeId
    ? (adjacentArchetypeId === 'experimental' ? experimentalData : archetypesList.find(a => a.archetype === adjacentArchetypeId) ?? null)
    : null;

  useEffect(() => {
    if (!adjacentArchetypeId) { setAdjacentSortOrderState(null); return; }
    getDialPosition(adjacentArchetypeId)
      .then(r => { if (r?.dialSortOrder != null) setAdjacentSortOrderState(r.dialSortOrder); })
      .catch(() => {});
  }, [adjacentArchetypeId]);

  function handleAdjacentChipClick(archetype: string) {
    setAdjacentArchetypeId(prev => (prev === archetype ? null : archetype));
    setAdjacentRevealedKeys(new Set());
  }

  function handleAdjacentDialSelect(archetype: string, sortOrder: number) {
    setAdjacentSortOrderState(sortOrder);
    setDialPosition(archetype, sortOrder).catch(() => {});
  }

  function toggleAdjacentReveal(key: string) {
    setAdjacentRevealedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleAdjacentHopClick(archetype: string, sortOrder: number) {
    adjacentDialRef.current?.rotateTo(sortOrder);
    setAdjacentSortOrderState(sortOrder);
    setAdjacentRevealedKeys(prev => new Set(prev).add(slotKey(archetype, sortOrder)));
  }

  function registerAdjacentDialRef(_archetype: string, handle: BloomDialHandle | null) {
    adjacentDialRef.current = handle;
  }

  // Feedback-nudge dismissal — same localStorage convention as Home.tsx/FlavorIntelligencePage.tsx.
  useEffect(() => {
    const orderId = homepageState?.pendingFeedback?.orderId;
    if (!orderId) { setFeedbackNudgeDismissed(false); return; }
    const key = `axisBloomFeedbackDismiss_${orderId}`;
    const dismissedAt = localStorage.getItem(key);
    setFeedbackNudgeDismissed(!!dismissedAt && Date.now() - Number(dismissedAt) < FEEDBACK_NAG_SUPPRESS_DAYS * 86400000);
  }, [homepageState]);

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

  async function handleSmsToggle(value: boolean) {
    if (!profile?.hasPhone) return;
    setSavingSms(true);
    try {
      const token = await user!.getIdToken();
      await fetch('/api/users/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ smsOptIn: value }),
      });
      setSmsOptIn(value);
      setProfile(p => p ? { ...p, smsOptIn: value } : p);
    } catch { /* silent */ } finally { setSavingSms(false); }
  }

  async function handleSavePhone(e: React.FormEvent) {
    e.preventDefault();
    setSavingPhone(true);
    setPhoneError('');
    try {
      const token = await user!.getIdToken();
      const res = await fetch('/api/users/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phoneNumber: phoneInput }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save phone number');
      // Enables the SMS toggle immediately, no reload — mirror what the
      // backend just wrote rather than refetching the whole profile.
      setProfile(p => p ? { ...p, hasPhone: true, phoneNumber: phoneInput } : p);
      setEditingPhone(false);
      setPhoneInput('');
    } catch (err: any) {
      setPhoneError(err.message ?? 'Failed to save phone number');
    } finally {
      setSavingPhone(false);
    }
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
    return <div className="w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center"><p className="text-[#a33726] text-sm uppercase tracking-widest">Loading...</p></div>;
  }

  const pastOrders = profile?.orders ?? [];
  const displayName = profile?.firstName
    ? `${profile.firstName}${profile.lastName ? ' ' + profile.lastName : ''}`
    : (user?.displayName ?? user?.email ?? '');

  const inputClass = "w-full text-left text-base tracking-wide transition-all duration-300 py-2.5 rounded-none border-b border-[#a33726]/30 bg-transparent focus:outline-none focus:border-[#ee5974] text-[#a33726] placeholder-[#a33726]/40";
  const labelClass = "block text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 mb-1.5 font-normal";

  const stageCode = homepageState?.stageCode ?? null;
  // Guard (Part 1): the archetype box renders off the archetype itself, never off
  // stageCode alone — if a stage implies quiz-taken but archetype resolves null
  // (data drift), fall back to the NEW_NO_QUIZ empty-state presentation.
  const showFullLayout = homepageStateLoaded && stageCode !== 'NEW_NO_QUIZ' && !!homepageState?.archetype;
  const showEmptyState = homepageStateLoaded && !showFullLayout;

  function renderStageNote() {
    if (stageCode === 'QUIZ_TAKEN_FRESH_NO_ORDER' || stageCode === 'QUIZ_TAKEN_SETTLED_NO_ORDER') {
      return <p className="text-sm text-[#a33726]/50 tracking-wide mt-6">You haven't tried your match yet — it's below.</p>;
    }
    if (stageCode === 'SUBSCRIBER' && homepageState?.nextDeliveryDate) {
      return <p className="text-sm text-[#a33726]/50 tracking-wide mt-6">Your next delivery: {new Date(homepageState.nextDeliveryDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</p>;
    }
    return null;
  }

  const retakeCopy = stageCode === 'QUIZ_STALE_NO_ORDER' ? 'Palates change — retake anytime' : 'Retake the quiz';

  return (
    <div className="w-full min-h-screen bg-[#f2f1ea]">
      <div className="max-w-[1400px] mx-auto px-8 md:px-16 pt-32 pb-24">

        <div className="mb-16">
          <h3 className="text-[10px] uppercase tracking-[0.3em] text-[#a33726]/60 mb-4 font-normal">
            Welcome back, {displayName}
          </h3>
          <h1 className="text-[3rem] lg:text-[4rem] text-[#a33726] leading-[1.05] font-normal tracking-tight">
            {homepageState?.archetype ? 'Your flavor memory.' : 'Trust your taste.'}
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

        <div className="flex-grow w-full">
          <AnimatePresence mode="wait">

            {/* ── Flavor Memory ── */}
            {activeTab === 'memory' && (
              <motion.div key="memory" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }} className="flex flex-col gap-12 max-w-[1400px]">
                {showEmptyState && (
                  <div className="flex flex-col items-start gap-6 py-8 max-w-2xl">
                    <Heart size={32} className="text-[#a33726]/30" strokeWidth={1} />
                    <p className="text-lg text-[#a33726]/70 tracking-wide leading-relaxed">You haven't discovered your flavor archetype yet. Take the quiz to unlock exact matches tailored to your palate.</p>
                    <Link to="/find-my-flavor" className="mt-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-[#a33726] border-b border-[#a33726]/30 pb-1 hover:border-[#a33726] hover:text-[#ee5974] transition-colors">Start the Quiz <ArrowRight size={14} /></Link>
                  </div>
                )}

                {showFullLayout && (
                  <div className="flex flex-col gap-2">
                    {/* Compact intro block — feature list only, no duplicate "Your Archetype:
                        {name}" heading (ArchetypeSection already renders the archetype name
                        as its own large heading right below). */}
                    <div className="max-w-2xl">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[#a33726]/40 mb-6">Your archetype</p>
                      <ul className="flex flex-col gap-5">
                        {(homepageState?.archetype?.features ?? []).map((f: string, i: number) => (
                          <li key={i} className="flex items-start gap-5">
                            <div className="w-[1px] h-8 shrink-0 opacity-40 mt-1" style={{ backgroundColor: '#ee5974' }} />
                            <span className="text-lg text-[#a33726]/80 leading-relaxed">{f}</span>
                          </li>
                        ))}
                      </ul>
                      {renderStageNote()}
                    </div>

                    {/* UC3 — feedback nudge. Independent of stageCode, same as Home.tsx/
                        FlavorIntelligencePage.tsx already treat it — pendingFeedback is its
                        own orthogonal flag (classifyStage() has no FIRST_ORDER_FEEDBACK_PENDING
                        branch; a subscriber or repeat customer can still have an unanswered
                        feedback ask sitting out there from an early order). Part 3: clicking it
                        now expands the pending order's form inline in the tasting journal below
                        (the journal supersedes the Past-Orders-tab detour Part 1 used). */}
                    {homepageState?.pendingFeedback && !feedbackNudgeDismissed && (
                      <div className="max-w-2xl mt-6 p-5 border border-[#a33726]/15 bg-white/40 flex items-center justify-between gap-4 flex-wrap">
                        <p className="text-sm text-[#a33726]">How was {homepageState.pendingFeedback.blendName ?? 'your last coffee'}?</p>
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => setExpandedJournalOrderId(homepageState.pendingFeedback!.orderId)}
                            className="text-[10px] uppercase tracking-[0.2em] text-[#a33726] border-b border-[#a33726]/40 pb-1 hover:border-[#ee5974] hover:text-[#ee5974] transition-colors"
                          >
                            Leave feedback
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              localStorage.setItem(`axisBloomFeedbackDismiss_${homepageState.pendingFeedback!.orderId}`, String(Date.now()));
                              setFeedbackNudgeDismissed(true);
                            }}
                            className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/40 hover:text-[#a33726] transition-colors"
                          >
                            Not now
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Full-width ArchetypeSection — same dial/position-card/reveal/cart/compare
                        flow already proven on /bloom and Find My Flavor's returning-user + results
                        screens. Pops in once matchedData resolves; the intro block above stays
                        visible in the meantime rather than the tab appearing to jump. */}
                    {matchedData && (
                      <DialArchetypeSection
                        data={matchedData}
                        index={0}
                        selectedSortOrder={dialSortOrder ?? computeDefaultSortOrder(matchedData)}
                        revealedKeys={revealedKeys}
                        onDialSelect={handleDialSelect}
                        onToggleReveal={toggleReveal}
                        onAddToCart={addToCart}
                        onHopClick={handleHopClick}
                        onCompare={openCompare}
                        userArchetype={matchArchetypeId}
                        registerDialRef={registerDialRef}
                        source="profile"
                        hideProfileLink
                        embedded
                      />
                    )}

                    {/* Horizon layer (Part 3 §1) — directly under ArchetypeSection. Part 6:
                        chips now expand the adjacent archetype in place (below) rather
                        than navigating away. */}
                    {matchArchetypeId && archetypesList.length > 0 && (
                      <div className="max-w-2xl mt-2">
                        <WorthExploring
                          matchArchetypeId={matchArchetypeId}
                          adjacency={adjacency}
                          archetypesList={archetypesList}
                          activeArchetype={adjacentArchetypeId}
                          onSelect={handleAdjacentChipClick}
                        />
                      </div>
                    )}

                    {/* Adjacent archetype — expanded in place (Part 6, issue C). Its own
                        independent dial/reveal state instance, never the primary section's
                        above. The Flavor Intelligence deep link is demoted to an escape
                        hatch here, for users who choose to leave rather than explore in place. */}
                    {adjacentData && (
                      <div className="flex flex-col gap-3">
                        <div className="flex justify-end max-w-2xl">
                          <Link
                            to={
                              adjacentData.slots.length
                                ? `/flavor-intelligence?archetype=${adjacentData.archetype}&slot=${computeDefaultSortOrder(adjacentData)}`
                                : `/flavor-intelligence?archetype=${adjacentData.archetype}`
                            }
                            className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/40 border-b border-[#a33726]/20 pb-1 hover:text-[#a33726] hover:border-[#a33726]/40 transition-colors w-fit"
                          >
                            See in Flavor Intelligence →
                          </Link>
                        </div>
                        <DialArchetypeSection
                          data={adjacentData}
                          index={1}
                          selectedSortOrder={adjacentSortOrder ?? computeDefaultSortOrder(adjacentData)}
                          revealedKeys={adjacentRevealedKeys}
                          onDialSelect={handleAdjacentDialSelect}
                          onToggleReveal={toggleAdjacentReveal}
                          onAddToCart={addToCart}
                          onHopClick={handleAdjacentHopClick}
                          onCompare={openCompare}
                          userArchetype={matchArchetypeId}
                          registerDialRef={registerAdjacentDialRef}
                          source="profile"
                          hideProfileLink
                          embedded
                        />
                      </div>
                    )}

                    {/* Memory layer (Part 3 §2/§3) — journal ~60% / journey ~40% on desktop,
                        stacked (journal first) on mobile. Nothing renders here for NEW_NO_QUIZ
                        (showFullLayout is already false for that stage). */}
                    {flavorMemory && (
                      <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 mt-6">
                        <div className="lg:col-span-3">
                          <TastingJournal
                            entries={flavorMemory.journal}
                            contributionCount={flavorMemory.contributionCount}
                            expandedOrderId={expandedJournalOrderId}
                            onExpandOrder={setExpandedJournalOrderId}
                            onFeedbackSubmitted={loadFlavorMemory}
                          />
                        </div>
                        <div className="lg:col-span-2">
                          <PalateTimeline entries={flavorMemory.journey} retakeCopy={retakeCopy} />
                        </div>
                      </div>
                    )}

                    {/* HOME_TASK_4 (§4.5 write rule 2) — the brew-profile mirror, day one. */}
                    <div className="border-t border-[#a33726]/10 pt-8 mt-6">
                      <BrewProfileMirror />
                    </div>

                    <div className="max-w-2xl flex flex-col gap-6 mt-4">
                      {/* Liam entry point — generic across stages, no stage-aware copy (decided). */}
                      <div className="border-t border-[#a33726]/10 pt-8">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-[#a33726]/40 mb-3">Coffee Sommelier</p>
                        <Link
                          to="/sommelier?entry=user_initiated"
                          className="flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-[#a33726] border-b border-[#a33726]/30 pb-1 hover:border-[#a33726] transition-colors w-fit"
                        >
                          Talk to Liam <ArrowRight size={14} />
                        </Link>
                      </div>

                      {/* Fallback retake link while flavorMemory hasn't loaded yet — once it
                          has, PalateTimeline above owns this link (Part 3 §3). */}
                      {!flavorMemory && (
                        <Link
                          to="/find-my-flavor?retake=1"
                          className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[#a33726]/40 border-b border-[#a33726]/20 pb-1 hover:text-[#a33726] hover:border-[#a33726]/40 transition-colors w-fit"
                        >
                          {retakeCopy} <ArrowRight size={12} />
                        </Link>
                      )}
                    </div>

                    <CompareOverlay
                      open={compareState.open}
                      onClose={() => setCompareState(s => ({ ...s, open: false }))}
                      left={compareState.slot ? { archetype: compareState.archetype, archetypeLabel: compareState.archetypeLabel, slot: compareState.slot } : null}
                      archetypes={archetypesList}
                    />
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Past Orders ── */}
            {activeTab === 'orders' && (
              <motion.div key="orders" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }} className="flex flex-col gap-8 max-w-2xl">
                {pastOrders.length === 0 ? (
                  <div className="flex flex-col items-start gap-6 py-8">
                    <Package size={32} className="text-[#a33726]/30" strokeWidth={1} />
                    <p className="text-lg text-[#a33726]/70 tracking-wide leading-relaxed">You haven't placed any orders yet.</p>
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

                        {feedbackOrderId === order.id ? (
                          <div className="mt-6">
                            <OrderFeedbackForm
                              orderId={order.id}
                              blendName={order.blendName}
                              coffeeId={flavorMemory?.journal.find(j => j.orderId === order.id)?.coffeeId ?? null}
                              initialRating={order.hasFeedback ? flavorMemory?.journal.find(j => j.orderId === order.id)?.rating : undefined}
                              initialExpectation={order.hasFeedback ? flavorMemory?.journal.find(j => j.orderId === order.id)?.expectation : undefined}
                              initialTastedNoteIds={order.hasFeedback ? flavorMemory?.journal.find(j => j.orderId === order.id)?.tastedNoteIds : undefined}
                              initialNote={order.hasFeedback ? flavorMemory?.journal.find(j => j.orderId === order.id)?.note : undefined}
                              onSubmitted={() => {
                                setFeedbackOrderId(null);
                                loadFlavorMemory();
                                setProfile(p => p ? {
                                  ...p,
                                  orders: p.orders.map((o: any) => o.id === order.id ? { ...o, hasFeedback: true } : o),
                                } : p);
                              }}
                            />
                          </div>
                        ) : (
                          <button
                            onClick={() => setFeedbackOrderId(order.id)}
                            className="mt-6 self-start text-[10px] uppercase tracking-[0.2em] text-[#a33726]/50 hover:text-[#a33726] transition-colors border-b border-[#a33726]/20 pb-1"
                          >
                            {order.hasFeedback ? 'Edit Feedback' : 'Leave Feedback'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Family ── */}
            {activeTab === 'family' && (
              <motion.div key="family" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }} className="max-w-2xl">
                <FamilyTab />
              </motion.div>
            )}

            {/* ── Settings ── */}
            {activeTab === 'settings' && (
              <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }} className="flex flex-col gap-10 max-w-xl">

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
                            <p className="text-sm text-[#a33726]">{addr.street}</p>
                            <p className="text-sm text-[#a33726]/70">{addr.city}, {addr.state} {addr.postal_code}</p>
                            <p className="text-sm text-[#a33726]/50">{addr.country}</p>
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

                {/* SMS opt-in + phone number (Profile Part 4) */}
                <div className="border-t border-[#a33726]/10 pt-8 flex flex-col gap-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 font-normal">Notifications</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.15em] text-[#a33726]">Text updates from Liam</p>
                      <p className="text-[10px] text-[#a33726]/50 mt-1">
                        {profile?.hasPhone
                          ? 'Receive a personal check-in from Liam after your deliveries.'
                          : 'Add a phone number to enable this.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!profile?.hasPhone || savingSms}
                      onClick={() => handleSmsToggle(!smsOptIn)}
                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-30 ${smsOptIn ? 'bg-[#a33726]' : 'bg-[#a33726]/20'}`}
                      style={{ cursor: profile?.hasPhone ? 'pointer' : 'not-allowed' }}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${smsOptIn ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {editingPhone ? (
                    <form onSubmit={handleSavePhone} className="flex flex-col gap-2 mt-1">
                      <input
                        type="tel"
                        value={phoneInput}
                        onChange={e => setPhoneInput(e.target.value)}
                        placeholder="(555) 123-4567"
                        className={inputClass}
                        autoFocus
                      />
                      {phoneError && <p className="text-xs text-red-600">{phoneError}</p>}
                      <div className="flex gap-4">
                        <button type="submit" disabled={savingPhone || !phoneInput.trim()}
                          className="text-[10px] uppercase tracking-[0.3em] text-[#a33726] border-b border-[#a33726]/40 pb-1 hover:border-[#ee5974] hover:text-[#ee5974] transition-colors disabled:opacity-30">
                          {savingPhone ? 'Saving…' : 'Save Number'}
                        </button>
                        <button type="button" onClick={() => { setEditingPhone(false); setPhoneInput(''); setPhoneError(''); }}
                          className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/40 hover:text-[#a33726] transition-colors">
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setEditingPhone(true); setPhoneInput(profile?.phoneNumber ?? ''); setPhoneError(''); }}
                      className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/50 hover:text-[#a33726] transition-colors border-b border-[#a33726]/20 pb-1 w-fit mt-1"
                    >
                      {profile?.hasPhone ? `${profile.phoneNumber} — Change` : '+ Add Phone Number'}
                    </button>
                  )}
                </div>

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
