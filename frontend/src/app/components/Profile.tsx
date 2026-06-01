import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Package, Heart, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getUserProfile } from '../lib/api';

type Tab = 'memory' | 'orders' | 'settings';

export default function Profile() {
  const [activeTab, setActiveTab] = useState<Tab>('memory');
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) { navigate('/sign-in'); return; }
    getUserProfile()
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [user]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  if (loading) {
    return <div className="w-full h-screen bg-[#f2f1ea] flex items-center justify-center"><p className="text-[#a33726] text-sm uppercase tracking-widest">Loading...</p></div>;
  }

  const archetype = profile?.archetype;
  const pastOrders = profile?.orders ?? [];

  return (
    <div className="w-full h-screen bg-[#f2f1ea] flex overflow-hidden">
      <div className="hidden lg:flex w-1/2 bg-[#1a1a1a] relative flex-col justify-center items-center overflow-hidden">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1080&q=80')` }} />
      </div>

      <div className="w-full lg:w-1/2 flex flex-col p-8 md:p-16 lg:p-24 relative z-10 overflow-y-auto">
        <div className="mt-16 lg:mt-8 mb-16">
          <h3 className="text-[10px] uppercase tracking-[0.3em] text-[#a33726]/60 mb-4 font-normal">
            {user ? `Welcome back, ${user.displayName ?? user.email}` : 'Your Profile'}
          </h3>
          <h1 className="text-[3rem] lg:text-[4rem] text-[#a33726] leading-[1.05] font-normal tracking-tight">
            {archetype ? 'Your flavor memory.' : 'Trust your taste.'}
          </h1>
        </div>

        <div className="flex w-full mb-12 border-b border-[#a33726]/20 relative gap-8">
          {(['memory', 'orders', 'settings'] as Tab[]).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`pb-4 text-[11px] uppercase tracking-[0.2em] font-normal transition-colors relative ${activeTab === tab ? 'text-[#ee5974]' : 'text-[#a33726]/40 hover:text-[#a33726]/70'}`}>
              {tab === 'memory' ? 'Flavor Memory' : tab === 'orders' ? 'Past Orders' : 'Settings'}
              {activeTab === tab && <motion.div layoutId="profile-tab-indicator" className="absolute bottom-0 left-0 right-0 h-[1px] bg-[#ee5974]" />}
            </button>
          ))}
        </div>

        <div className="flex-grow w-full max-w-[480px]">
          <AnimatePresence mode="wait">
            {activeTab === 'memory' && (
              <motion.div key="memory" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }} className="flex flex-col gap-12">
                {!archetype ? (
                  <div className="flex flex-col items-start gap-6 py-8">
                    <Heart size={32} className="text-[#a33726]/30" strokeWidth={1} />
                    <p className="text-lg text-[#a33726]/70 font-sans tracking-wide font-light leading-relaxed">You haven't discovered your flavor archetype yet. Take the quiz to unlock exact matches tailored to your palate.</p>
                    <Link to="/find-my-flavor" className="mt-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-[#a33726] border-b border-[#a33726]/30 pb-1 hover:border-[#a33726] hover:text-[#ee5974] transition-colors">Start the Quiz <ArrowRight size={14} /></Link>
                  </div>
                ) : (
                  <div>
                    <h2 className="text-2xl text-[#a33726] font-normal mb-8">Your Archetype: {archetype.name}</h2>
                    <ul className="flex flex-col gap-6">
                      {(archetype.features ?? []).map((f: string, i: number) => (
                        <li key={i} className="flex items-start gap-5">
                          <div className="w-[1px] h-8 shrink-0 opacity-40 mt-1" style={{ backgroundColor: '#ee5974' }} />
                          <span className="text-lg text-[#a33726]/80 font-light leading-relaxed font-sans">{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'orders' && (
              <motion.div key="orders" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }} className="flex flex-col gap-8">
                {pastOrders.length === 0 ? (
                  <div className="flex flex-col items-start gap-6 py-8">
                    <Package size={32} className="text-[#a33726]/30" strokeWidth={1} />
                    <p className="text-lg text-[#a33726]/70 font-sans tracking-wide font-light leading-relaxed">You haven't placed any orders yet.</p>
                    <Link to="/shop" className="mt-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-[#a33726] border-b border-[#a33726]/30 pb-1 hover:border-[#a33726] hover:text-[#ee5974] transition-colors">Explore the Shop <ArrowRight size={14} /></Link>
                  </div>
                ) : (
                  <div className="flex flex-col gap-8">
                    {pastOrders.map((order: any, idx: number) => (
                      <div key={idx} className="flex flex-col border border-[#a33726]/20 bg-white/40 p-6">
                        <div className="flex justify-between items-end mb-6 pb-6 border-b border-[#a33726]/10">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 mb-2 font-normal">Order {order.id}</p>
                            <p className="text-sm text-[#a33726] font-sans font-normal">{order.date}</p>
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

            {activeTab === 'settings' && (
              <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }} className="flex flex-col gap-8 font-sans">
                <div className="flex flex-col gap-2 border-b border-[#a33726]/10 pb-6">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 font-normal">Email</p>
                  <p className="text-lg text-[#a33726] font-light">{user?.email ?? '—'}</p>
                </div>
                <div className="mt-8">
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
