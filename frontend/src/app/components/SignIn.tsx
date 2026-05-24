import React, { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function SignIn() {
  const [activeTab, setActiveTab] = useState<'create' | 'signin'>('create');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { signIn, signUp, signInWithGoogle, signInWithApple } = useAuth();
  const fromQuiz = searchParams.get('quiz_id');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      if (activeTab === 'create') {
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
      navigate('/profile');
    } catch (err: any) {
      setError(friendlyError(err.message ?? 'Authentication failed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) { setError('Enter your email address above first.'); return; }
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('Could not send reset email.');
      setResetSent(true);
      setError('');
    } catch (err: any) {
      setError(err.message ?? 'Could not send reset email.');
    }
  };

  // Map Firebase error codes to friendlier messages
  function friendlyError(msg: string): string {
    if (msg.includes('wrong-password') || msg.includes('invalid-credential'))
      return 'Wrong password. Try "Forgot password?" below, or sign in with Google if you created your account that way.';
    if (msg.includes('user-not-found'))
      return 'No account found with that email. Use "Create Profile" to sign up.';
    if (msg.includes('email-already-in-use'))
      return 'An account with this email already exists. Switch to "Sign In".';
    if (msg.includes('weak-password'))
      return 'Password must be at least 6 characters.';
    return msg;
  }

  const handleGoogle = async () => {
    try {
      await signInWithGoogle();
      navigate('/profile');
    } catch (err: any) {
      setError(err.message ?? 'Google sign-in failed');
    }
  };

  const handleApple = async () => {
    try {
      await signInWithApple();
      navigate('/profile');
    } catch (err: any) {
      setError(err.message ?? 'Apple sign-in failed');
    }
  };

  return (
    <div className="w-full h-screen bg-[#f2f1ea] flex overflow-hidden" style={{ fontFamily: '"Genova", sans-serif' }}>
      <div className="hidden lg:flex w-1/2 bg-[#1a1a1a] relative flex-col justify-center items-center overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://i.imgur.com/NQRCzNU.jpeg')] bg-cover bg-center" />
      </div>

      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-8 md:p-16 lg:p-24 relative z-10 overflow-y-auto">
        {fromQuiz && (
          <div className="absolute top-12 left-12">
            <Link to="/find-my-flavor" className="flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 hover:text-[#ee5974] transition-colors">
              <ArrowLeft size={14} /> Back to results
            </Link>
          </div>
        )}

        <div className="w-full max-w-[400px] flex flex-col items-start mt-12 lg:mt-0">
          <div className="mb-12">
            <h2 className="text-[3rem] lg:text-[3.5rem] text-[#ee5974] leading-[1.05] mb-4 font-normal tracking-tight">Trust your taste.</h2>
            <p className="text-lg text-[#a33726]/80 font-sans tracking-wide font-light">Sign in to save your flavor memory, re-order your favorites, and explore exact matches.</p>
          </div>

          <div className="flex w-full mb-12 border-b border-[#a33726]/20 relative">
            {(['create', 'signin'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 pb-4 text-[11px] uppercase tracking-[0.2em] font-medium transition-colors ${activeTab === tab ? 'text-[#a33726]' : 'text-[#a33726]/40 hover:text-[#a33726]/70'}`}
              >
                {tab === 'create' ? 'Create Profile' : 'Sign In'}
              </button>
            ))}
            <motion.div
              className="absolute bottom-0 h-[1px] bg-[#a33726]"
              initial={false}
              animate={{ left: activeTab === 'create' ? '0%' : '50%', width: '50%' }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
            />
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          {resetSent && <p className="text-sm text-green-700 mb-4">Password reset email sent — check your inbox (and spam folder).</p>}

          <AnimatePresence mode="wait">
            <motion.form
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              onSubmit={handleSubmit}
              className="w-full flex flex-col gap-8"
            >
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                className="w-full text-left text-[1.25rem] tracking-wide transition-all duration-500 py-3 rounded-none border-b-[1px] border-[#a33726]/30 bg-transparent focus:outline-none focus:border-[#ee5974] text-[#a33726] placeholder-[#a33726]/40"
                required
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full text-left text-[1.25rem] tracking-wide transition-all duration-500 py-3 rounded-none border-b-[1px] border-[#a33726]/30 bg-transparent focus:outline-none focus:border-[#ee5974] text-[#a33726] placeholder-[#a33726]/40"
                required
              />

              <div className="flex flex-row items-center justify-between w-full mt-4">
                <button
                  type="submit"
                  disabled={isLoading || !email || !password}
                  className={`text-[10px] uppercase tracking-[0.3em] font-medium transition-all duration-500 pb-1 border-b ${(isLoading || !email || !password) ? 'text-[#a33726] opacity-30 border-transparent cursor-not-allowed' : 'text-[#a33726] border-[#a33726]/40 hover:border-[#ee5974] hover:text-[#ee5974]'}`}
                >
                  {isLoading ? 'Processing...' : (activeTab === 'create' ? 'Save my taste profile' : 'Sign In')}
                </button>
                {activeTab === 'signin' && (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/40 hover:text-[#a33726] transition-colors"
                  >
                    Forgot password?
                  </button>
                )}
              </div>

              <div className="mt-12 flex flex-col gap-4">
                <div className="flex items-center gap-4 mb-4">
                  <div className="h-[1px] flex-1 bg-[#a33726]/10" />
                  <span className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/40 font-medium">Or continue with</span>
                  <div className="h-[1px] flex-1 bg-[#a33726]/10" />
                </div>
                <button type="button" onClick={handleGoogle} className="w-full flex items-center justify-center gap-3 py-4 border border-[#a33726]/20 bg-white/50 hover:bg-white/80 transition-colors text-[11px] uppercase tracking-[0.1em] text-[#a33726] font-medium">
                  <svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Google
                </button>
                <button type="button" onClick={handleApple} className="w-full flex items-center justify-center gap-3 py-4 border border-[#a33726]/20 bg-white/50 hover:bg-white/80 transition-colors text-[11px] uppercase tracking-[0.1em] text-[#a33726] font-medium">
                  Apple
                </button>
              </div>
            </motion.form>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
