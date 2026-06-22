import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { saveQuizResult, getUserProfile } from '../lib/api';

// ─── Archetype asset imports ──────────────────────────────────────────────────

import wallpaperFloral       from '../../design/IMAGES/archetypes/Floral.jpg';
import wallpaperFruity       from '../../design/IMAGES/archetypes/Fruity.jpg';
import wallpaperBalanced     from '../../design/IMAGES/archetypes/Balanced-&-Sweet.jpg';
import wallpaperChocolate    from '../../design/IMAGES/archetypes/Chocolate-&-Nutty.jpg';
import wallpaperEarthy       from '../../design/IMAGES/archetypes/Spicy-&-Earthy.jpg';
import wallpaperExperimental from '../../design/IMAGES/archetypes/Experimental.jpg';

import bagFloral          from '../../design/IMAGES/bags/new bags mock up/FLORAL transp.png';
import bagFruity          from '../../design/IMAGES/bags/new bags mock up/FRUITY transp.png';
import bagBalanced        from '../../design/IMAGES/bags/new bags mock up/BALANCED & SWEET transp.png';
import bagChocolate       from '../../design/IMAGES/bags/new bags mock up/CHOCOLATE & NUTTY transp.png';
import bagEarthy          from '../../design/IMAGES/bags/new bags mock up/SPICY & EARTHY transp.png';
import bagExperimental    from '../../design/IMAGES/bags/new bags mock up/EXPERIMENTAL transp.png';

// ─── API types ────────────────────────────────────────────────────────────────

interface ApiAnswer {
  id: string;
  text: string;
  archetype_id: string | null;
  archetype_name: string | null;
}

interface ApiQuestion {
  question_id: string;
  q_number: number;
  q_text: string;
  answers: ApiAnswer[];
}

interface ScoreResult {
  archetype: string;
  archetypeId: string | null;
  scores: Record<string, number>;
  experimental: boolean;
  secondaryArchetype: string | null;
  foodSignal: string | null;
  confidence: string;
  recommendationMode: string;
}

interface BranchAnswer {
  id: string;
  text: string;
  archetypeId: string;
  archetypeName: string;
}

interface BranchQuestion {
  questionId: string;
  questionText: string;
  answers: BranchAnswer[];
}

// ─── Static question images (keyed by q_number) ───────────────────────────────

const QUESTION_IMAGES: Record<number, string> = {
  1: 'https://i.imgur.com/NQRCzNU.jpeg',
  2: 'https://i.imgur.com/k2KrVf1.jpeg',
  3: 'https://i.imgur.com/ahLdfc7.jpeg',
  4: 'https://i.imgur.com/S46KQYC.jpeg',
};

// ─── Archetype key + name→key mapping ────────────────────────────────────────

type ArchetypeKey = 'floral' | 'fruity' | 'balanced' | 'chocolate' | 'earthy' | 'experimental';

// Handles all variants the backend might return — full name, key, or casing differences
const ARCHETYPE_NAME_TO_KEY: Record<string, ArchetypeKey> = {
  'Floral':            'floral',
  'floral':            'floral',
  'Fruity':            'fruity',
  'fruity':            'fruity',
  'Balanced & Sweet':  'balanced',
  'Balanced and Sweet':'balanced',
  'balanced':          'balanced',
  'Chocolate & Nutty': 'chocolate',
  'Chocolate and Nutty':'chocolate',
  'chocolate':         'chocolate',
  'Earthy':            'earthy',
  'earthy':            'earthy',
  'Spicy & Earthy':    'earthy',
  'Spicy and Earthy':  'earthy',
  'spicy':             'earthy',
  'Experimental':      'experimental',
  'experimental':      'experimental',
};

// ─── Archetypes data ──────────────────────────────────────────────────────────

const ARCHETYPES: Record<ArchetypeKey, {
  name: string;
  color: string;
  wallpaper: string;
  bag: string;
  shortDescription: string;
  whyMatches: string[];
  coffees: { name: string; flavor: string; match: string }[];
}> = {
  floral: {
    name: 'Floral',
    color: '#a34b78',
    wallpaper: wallpaperFloral,
    bag: bagFloral,
    shortDescription: 'Light, elegant, and aromatic. Floral coffees feel lifted, delicate, and quietly expressive, with notes that can suggest jasmine, citrus, tea, and soft sweetness.',
    whyMatches: [
      'You are drawn to coffees that feel bright, graceful, and aromatic.',
      'You may enjoy delicate cups with a tea-like clarity.',
      'You appreciate subtlety, fragrance, and a lighter sensory experience.',
    ],
    coffees: [
      { name: 'Ethiopia Yirgacheffe', flavor: 'Jasmine, Bergamot, Lemon Zest', match: '98%' },
      { name: 'Ethiopia Guji Washed', flavor: 'Rose, Peach, White Tea',         match: '92%' },
    ],
  },
  fruity: {
    name: 'Fruity',
    color: '#ca445f',
    wallpaper: wallpaperFruity,
    bag: bagFruity,
    shortDescription: 'Juicy, lively, and expressive. Fruity coffees bring brightness and movement to the cup, often with notes of berries, ripe fruit, citrus, or tropical sweetness.',
    whyMatches: [
      'You are drawn to coffees that feel vibrant, juicy, and full of energy.',
      'You may enjoy fruit-forward flavors and a brighter cup.',
      'You like coffees that feel expressive, playful, and alive.',
    ],
    coffees: [
      { name: 'Kenya Guji',              flavor: 'Blueberry, Peach, Rose',           match: '96%' },
      { name: 'Costa Rica Pink Bourbon', flavor: 'Strawberry, Watermelon, Hibiscus', match: '89%' },
    ],
  },
  balanced: {
    name: 'Balanced & Sweet',
    color: '#d1ac11',
    wallpaper: wallpaperBalanced,
    bag: bagBalanced,
    shortDescription: 'Smooth, round, and comforting. Balanced & Sweet coffees are soft and approachable, often bringing caramel, honey, gentle fruit, and an easy sweetness.',
    whyMatches: [
      'You are drawn to coffees that feel smooth, sweet, and easy to love.',
      'You may prefer a cup with balance rather than extremes.',
      'You appreciate comfort, softness, and a clean finish.',
    ],
    coffees: [
      { name: 'Brazil Los Santos',       flavor: 'Milk Chocolate, Caramel, Peanut', match: '99%' },
      { name: 'Guatemala Honey Process', flavor: 'Brown Sugar, Red Apple, Pecan',   match: '94%' },
    ],
  },
  chocolate: {
    name: 'Chocolate & Nutty',
    color: '#a54c2d',
    wallpaper: wallpaperChocolate,
    bag: bagChocolate,
    shortDescription: 'Rich, familiar, and grounding. Chocolate & Nutty coffees feel classic and satisfying, with notes of cocoa, roasted nuts, and a deeper comforting presence.',
    whyMatches: [
      'You are drawn to coffees that feel warm, bold, and comforting.',
      'You may enjoy cocoa, roasted nut, and classic coffee flavors.',
      'You appreciate a cup that feels grounding, full, and satisfying.',
    ],
    coffees: [
      { name: 'Sumatra Mandheling', flavor: 'Dark Chocolate, Cedar, Walnut',      match: '97%' },
      { name: 'Mexico Cerrado',     flavor: 'Cocoa Nibs, Hazelnut, Molasses',     match: '91%' },
    ],
  },
  earthy: {
    name: 'Spicy & Earthy',
    color: '#912f2f',
    wallpaper: wallpaperEarthy,
    bag: bagEarthy,
    shortDescription: 'Warm, deep, and complex. Spicy & Earthy coffees bring a more grounded sensory world, with notes that may suggest spice, wood, herbs, smoke, or lingering depth.',
    whyMatches: [
      'You are drawn to coffees with depth, warmth, and character.',
      'You may enjoy earthy, spicy, rustic, or more unusual flavor notes.',
      'You appreciate coffees that feel bold, layered, and memorable.',
    ],
    coffees: [
      { name: 'Sumatra Wet-Hulled', flavor: 'Dark Earth, Cedar, Tobacco',          match: '96%' },
      { name: 'Yemen Mocha',        flavor: 'Dark Chocolate, Dried Fig, Cardamom', match: '91%' },
    ],
  },
  experimental: {
    name: 'Experimental',
    color: '#056c7a',
    wallpaper: wallpaperExperimental,
    bag: bagExperimental,
    shortDescription: 'Unexpected, wild, and expressive. Experimental coffees are for curious palates, bringing unusual processing, surprising flavor, and a sense of discovery.',
    whyMatches: [
      'You are drawn to coffees that feel different, surprising, and adventurous.',
      'You may enjoy unusual flavor notes and less predictable cups.',
      'You appreciate discovery, experimentation, and sensory play.',
    ],
    coffees: [
      { name: 'Colombia Anaerobic Natural', flavor: 'Fermented Mango, Passionfruit, Wine', match: '95%' },
      { name: 'Ethiopia Carbonic Maceration', flavor: 'Kombucha, Hibiscus, Blueberry',     match: '88%' },
    ],
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function FlavorQuiz() {
  const [hasStarted, setHasStarted]     = useState(false);
  const [userName, setUserName]         = useState('');
  const [currentStep, setCurrentStep]   = useState(0);
  const [answers, setAnswers]           = useState<Record<number, number>>({});
  const [selectedIds, setSelectedIds]   = useState<Record<number, string>>({});
  const [isComplete, setIsComplete]     = useState(false);
  const [isScoring, setIsScoring]       = useState(false);
  const [archetypeKey, setArchetypeKey] = useState<ArchetypeKey>('balanced');
  const [scoreError, setScoreError]     = useState(false);

  // Branch state
  const [scoreData, setScoreData]               = useState<ScoreResult | null>(null);
  const [showBranch, setShowBranch]             = useState(false);
  const [branchQuestion, setBranchQuestion]     = useState<BranchQuestion | null>(null);
  const [selectedBranchAnswerId, setSelectedBranchAnswerId] = useState<string | null>(null);

  // API state
  const [questions, setQuestions] = useState<ApiQuestion[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Returning user state
  const [userProfile, setUserProfile]       = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Reveal state (result page curtain)
  const [revealProgress, setRevealProgress] = useState(0);
  const [revealForced, setRevealForced]     = useState(false);
  const revealContainerRef = useRef<HTMLDivElement>(null);

  const displayProgress = revealForced ? 1 : revealProgress;

  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/quiz/questions')
      .then(r => r.json())
      .then(data => {
        if (data.questions?.length) setQuestions(data.questions);
        else setLoadError(true);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    setProfileLoading(true);
    getUserProfile()
      .then(p => {
        setUserProfile(p);
        if (!p?.archetype && (p?.firstName || user.displayName)) {
          const name = p?.firstName ?? user.displayName ?? '';
          setUserName(name);
          setHasStarted(true);
        }
      })
      .catch(() => {})
      .finally(() => setProfileLoading(false));
  }, [user]);

  useEffect(() => {
    const savedName = sessionStorage.getItem('axisBloomCustomerName');
    if (savedName) {
      setUserName(savedName);
      setHasStarted(true);
      sessionStorage.removeItem('axisBloomCustomerName');
    }
  }, []);

  // Scroll to top when result is ready so the reveal starts clean
  useEffect(() => {
    if (isComplete) {
      window.scrollTo({ top: 0 });
      setRevealProgress(0);
      setRevealForced(false);
    }
  }, [isComplete]);

  // Scroll-driven reveal — active only on the result page
  useEffect(() => {
    if (!isComplete) return;

    // Respect prefers-reduced-motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRevealForced(true);
      return;
    }

    const onScroll = () => {
      const el = revealContainerRef.current;
      if (!el) return;
      const scrolled = -el.getBoundingClientRect().top;
      const total    = Math.max(1, el.offsetHeight - window.innerHeight);
      setRevealProgress(Math.max(0, Math.min(1, scrolled / total)));
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [isComplete]);

  const archetype = ARCHETYPES[archetypeKey];

  const handleNext = async () => {
    if (currentStep < questions.length - 1) {
      setCurrentStep(p => p + 1);
      return;
    }

    setIsScoring(true);
    setScoreError(false);
    try {
      const answerIds = Object.values(selectedIds);

      const scoreRes = await fetch('/api/quiz/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answerIds }),
      });
      if (!scoreRes.ok) throw new Error('Score request failed');
      const score: ScoreResult = await scoreRes.json();
      setScoreData(score);

      const key = ARCHETYPE_NAME_TO_KEY[score.archetype] ?? 'balanced';
      setArchetypeKey(key);

      if (score.archetypeId) {
        const branchRes = await fetch(`/api/quiz/branch?archetypeId=${score.archetypeId}`);
        if (branchRes.ok) {
          const { branchQuestion: bq } = await branchRes.json();
          if (bq) {
            setBranchQuestion(bq);
            setShowBranch(true);
            return;
          }
        }
      }

      if (user) {
        saveQuizResult({ archetype: score.archetype, scores: score.scores, answers, decaf: false })
          .catch(console.error);
      }
      setIsComplete(true);
    } catch (err) {
      console.error('[quiz/score]', err);
      setScoreError(true);
    } finally {
      setIsScoring(false);
    }
  };

  const handleBranchContinue = () => {
    if (!selectedBranchAnswerId || !scoreData || !branchQuestion) return;

    const selected = branchQuestion.answers.find(a => a.id === selectedBranchAnswerId);
    const finalArchetypeName = selected?.archetypeName ?? scoreData.archetype;
    const newKey = ARCHETYPE_NAME_TO_KEY[finalArchetypeName] ?? archetypeKey;
    setArchetypeKey(newKey);

    if (user) {
      saveQuizResult({ archetype: finalArchetypeName, scores: scoreData.scores, answers, decaf: false })
        .catch(console.error);
    }

    setShowBranch(false);
    setIsComplete(true);
  };

  const handleRetake = () => {
    window.scrollTo({ top: 0 });
    setIsComplete(false);
    setShowBranch(false);
    setBranchQuestion(null);
    setSelectedBranchAnswerId(null);
    setScoreData(null);
    setCurrentStep(0);
    setAnswers({});
    setSelectedIds({});
    setScoreError(false);
    setArchetypeKey('balanced');
    setRevealProgress(0);
    setRevealForced(false);
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="relative w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center">
        <p className="text-[#a33726]/50 text-sm uppercase tracking-[0.2em]">Loading…</p>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (loadError || !questions.length) {
    return (
      <div className="relative w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center">
        <p className="text-[#a33726]/70 text-sm uppercase tracking-[0.2em]">
          Quiz unavailable. Please try again later.
        </p>
      </div>
    );
  }

  // ── Returning user ───────────────────────────────────────────────────────────
  if (user && !hasStarted && (profileLoading || userProfile?.archetype)) {
    if (profileLoading) {
      return (
        <div className="relative w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center">
          <p className="text-[#a33726]/50 text-sm uppercase tracking-[0.2em]">Loading…</p>
        </div>
      );
    }

    const existingArchetype = userProfile?.archetype;
    const firstName = userProfile?.firstName ?? user.displayName?.split(' ')[0] ?? 'there';
    const archetypeColor = existingArchetype?.color ?? '#a33726';
    const lastQuizDate = userProfile?.lastQuizDate
      ? new Date(userProfile.lastQuizDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null;

    const navItems = [
      { label: 'Retake the quiz',              action: () => { setUserName(firstName); setHasStarted(true); } },
      { label: 'Talk to our coffee sommelier', href: '/' },
      { label: 'View my profile',              href: '/profile' },
      { label: 'Explore our coffees',          href: '/coffees' },
    ];

    return (
      <div className="relative w-full min-h-screen bg-[#f2f1ea] flex flex-col lg:flex-row overflow-hidden">
        <div className="w-full lg:w-1/2 h-[50vh] lg:h-screen relative overflow-hidden flex flex-col">
          <div className="absolute inset-0">
            <img src="https://i.imgur.com/3NAnXgR.jpeg" alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/25" />
          </div>
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7 }}
            className="relative z-10 h-full flex flex-col justify-end p-8 md:p-12 lg:p-16"
          >
            <p className="text-[10px] uppercase tracking-[0.3em] mb-8 font-normal text-white/60">
              Welcome back, {firstName}
            </p>
            <div className="flex flex-col w-full max-w-[360px]">
              {navItems.map(item =>
                item.href ? (
                  <Link
                    key={item.label}
                    to={item.href}
                    className="flex items-center justify-between group text-[0.95rem] font-light tracking-wide py-4 border-b border-white/10 hover:border-white/30 text-white/75 hover:text-white transition-all duration-300"
                  >
                    <span>{item.label}</span>
                    <ArrowRight size={14} className="opacity-30 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                  </Link>
                ) : (
                  <button
                    key={item.label}
                    onClick={item.action}
                    className="flex items-center justify-between group text-[0.95rem] font-light tracking-wide py-4 border-b border-white/10 hover:border-white/30 text-white/75 hover:text-white transition-all duration-300 w-full text-left"
                  >
                    <span>{item.label}</span>
                    <ArrowRight size={14} className="opacity-30 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                  </button>
                )
              )}
            </div>
          </motion.div>
        </div>

        <div className="w-full lg:w-1/2 min-h-[50vh] lg:h-screen bg-[#f2f1ea] flex items-center">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="w-full px-8 py-12 md:px-12 lg:px-20 max-w-[520px] mx-auto lg:mx-0"
          >
            <p className="text-[10px] uppercase tracking-[0.3em] mb-10 text-[#a33726]/30">
              Your coffee profile
            </p>
            <p className="text-[0.85rem] font-light tracking-wide text-[#a33726]/50 mb-2">
              Your primary profile is
            </p>
            <h1
              className="text-[3rem] lg:text-[3.5rem] leading-[1.05] font-normal tracking-tight mb-5"
              style={{ color: archetypeColor }}
            >
              {existingArchetype?.name ?? '—'}
            </h1>
            {existingArchetype?.description && (
              <p className="text-base font-light leading-relaxed text-[#a33726]/60 mb-10">
                {existingArchetype.description}
              </p>
            )}
            {lastQuizDate && (
              <div className="border-t border-[#a33726]/10 pt-8 flex flex-col gap-1">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/30">Last quiz taken</p>
                <p className="text-[0.95rem] font-light text-[#a33726]/60">{lastQuizDate}</p>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    );
  }

  // ── Name screen ──────────────────────────────────────────────────────────────
  if (!hasStarted) {
    return (
      <div className="relative w-full min-h-screen bg-[#f2f1ea] flex overflow-hidden">
        <div className="absolute inset-0">
          <img src="https://i.imgur.com/3NAnXgR.jpeg" alt="" className="w-full h-full object-cover" />
        </div>
        <div
          className="relative z-10 w-full flex flex-col justify-start"
          style={{
            paddingTop: 'clamp(80px, 11vh, 120px)',
            paddingLeft: 'clamp(48px, 7vw, 112px)',
            paddingRight: 'clamp(48px, 7vw, 112px)',
          }}
        >
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7 }}
            style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}
          >
            <h1 style={{
              fontSize: 'clamp(2.8rem, 4.2vw, 4.2rem)',
              color: '#ee5974',
              lineHeight: 1.08,
              fontWeight: 400,
              margin: '0 0 clamp(28px, 4vh, 40px)',
              letterSpacing: '-0.01em',
            }}>
              Whose palate are we<br />profiling today?
            </h1>

            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Enter your name"
              style={{
                width: '100%',
                maxWidth: 400,
                fontSize: '1.05rem',
                padding: '0 0 12px',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid rgba(154,41,24,0.3)',
                borderRadius: 0,
                outline: 'none',
                color: '#9a2918',
                fontFamily: 'inherit',
                letterSpacing: '0.02em',
                marginBottom: 'clamp(20px, 3vh, 28px)',
              }}
              className="placeholder-[#a33726]/40 focus:border-[#ee5974]"
              onKeyDown={(e) => { if (e.key === 'Enter' && userName.trim()) setHasStarted(true); }}
            />

            <button
              onClick={() => setHasStarted(true)}
              disabled={!userName.trim()}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: userName.trim() ? '1px solid rgba(154,41,24,0.4)' : '1px solid transparent',
                padding: '0 0 3px',
                cursor: userName.trim() ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                fontSize: '0.72rem',
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
                color: '#9a2918',
                opacity: userName.trim() ? 1 : 0.3,
                transition: 'opacity 0.2s, color 0.2s',
                marginBottom: 18,
              }}
            >
              Begin Profile
            </button>

            <a
              href="/sign-in"
              style={{
                fontFamily: 'inherit',
                fontSize: '0.68rem',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: '#9a2918',
                opacity: 0.45,
                textDecoration: 'none',
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')}
            >
              Already have a profile? Sign in →
            </a>
          </motion.div>
        </div>
      </div>
    );
  }

  // ── Question screen ──────────────────────────────────────────────────────────
  if (!isComplete && !showBranch) {
    const question = questions[currentStep];
    const image    = QUESTION_IMAGES[question.q_number] ?? QUESTION_IMAGES[1];

    return (
      <div className="w-full min-h-screen flex flex-col lg:flex-row bg-[#f2f1ea]">
        <div className="w-full lg:w-1/2 h-[40vh] lg:h-screen relative overflow-hidden bg-[#1a1a1a]">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.2 }}
              className="absolute inset-0"
            >
              <img src={image} alt={question.q_text} className="w-full h-full object-cover" />
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="w-full lg:w-1/2 min-h-[60vh] lg:h-screen bg-[#f2f1ea] px-12 py-16 lg:p-24 flex flex-col justify-center relative overflow-y-auto">
          <div className="w-full max-w-[480px] flex flex-col justify-center mx-auto lg:ml-[15%]">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.7 }}
                className="flex flex-col"
              >
                <div className="text-[10px] uppercase tracking-[0.3em] text-[#a33726]/40 mb-6">
                  {currentStep + 1} / {questions.length}
                </div>
                <h1 className="text-[2rem] lg:text-[2.8rem] text-[#ee5974] leading-[1.15] font-normal tracking-tight mb-12">
                  {question.q_text}
                </h1>
                <div className="flex flex-col gap-4 w-full">
                  {question.answers.map((answer, idx) => {
                    const isSelected = answers[currentStep] === idx;
                    return (
                      <button
                        key={answer.id}
                        onClick={() => {
                          setAnswers(prev => ({ ...prev, [currentStep]: idx }));
                          setSelectedIds(prev => ({ ...prev, [currentStep]: answer.id }));
                        }}
                        className={`w-full text-left text-[1.05rem] lg:text-[1.15rem] tracking-wide transition-all duration-500 px-8 py-5 rounded-[2.5rem] border-[1px] ${
                          isSelected
                            ? 'text-[#ee5974] border-[#ee5974]'
                            : 'text-[#a33726] border-[#a33726]/20 opacity-70 hover:opacity-100 hover:border-[#ee5974]/50 hover:text-[#ee5974]'
                        }`}
                      >
                        {answer.text}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </AnimatePresence>

            <div className="mt-16 flex flex-col items-start w-full gap-6">
              <div className="flex items-center gap-8">
                {currentStep > 0 && (
                  <button
                    onClick={() => setCurrentStep(p => p - 1)}
                    className="text-[10px] uppercase tracking-[0.3em] font-normal text-[#a33726] opacity-35 hover:opacity-70 transition-opacity"
                  >
                    ← Back
                  </button>
                )}
                <button
                  onClick={handleNext}
                  disabled={answers[currentStep] === undefined || isScoring}
                  className={`text-[10px] uppercase tracking-[0.3em] font-normal transition-all pb-1 border-b ${
                    answers[currentStep] === undefined || isScoring
                      ? 'text-[#a33726] opacity-20 border-transparent cursor-not-allowed'
                      : 'text-[#a33726] border-[#a33726]/30 hover:border-[#ee5974] hover:text-[#ee5974]'
                  }`}
                >
                  {isScoring ? 'Finding your profile…' : currentStep < questions.length - 1 ? 'Next Question' : 'See My Profile'}
                </button>
              </div>
              {scoreError && (
                <p className="text-[11px] text-[#ee5974]">
                  Something went wrong. Please try again.
                </p>
              )}
              {!user && (
                <Link
                  to="/sign-in"
                  className="text-[11px] uppercase tracking-[0.1em] text-[#a33726] opacity-40 hover:opacity-100 transition-opacity font-normal"
                >
                  Sign in to save progress
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Branch screen ────────────────────────────────────────────────────────────
  if (showBranch && branchQuestion) {
    return (
      <div className="w-full min-h-screen flex flex-col lg:flex-row bg-[#f2f1ea]">
        <div className="w-full lg:w-1/2 h-[40vh] lg:h-screen relative overflow-hidden bg-[#1a1a1a]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.2 }}
            className="absolute inset-0"
          >
            <img src="https://i.imgur.com/3WOJLhq.jpeg" alt="" className="w-full h-full object-cover" />
          </motion.div>
        </div>

        <div className="w-full lg:w-1/2 min-h-[60vh] lg:h-screen bg-[#f2f1ea] px-12 py-16 lg:p-24 flex flex-col justify-center relative overflow-y-auto">
          <div className="w-full max-w-[480px] flex flex-col justify-center mx-auto lg:ml-[15%]">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              className="flex flex-col"
            >
              <div className="text-[10px] uppercase tracking-[0.3em] text-[#a33726]/40 mb-6">
                One last thing
              </div>
              <h1 className="text-[2rem] lg:text-[2.8rem] text-[#ee5974] leading-[1.15] font-normal tracking-tight mb-12">
                {branchQuestion.questionText}
              </h1>
              <div className="flex flex-col gap-4 w-full">
                {branchQuestion.answers.map((answer) => (
                  <button
                    key={answer.id}
                    onClick={() => setSelectedBranchAnswerId(answer.id)}
                    className={`w-full text-left text-[1.05rem] lg:text-[1.15rem] tracking-wide transition-all duration-500 px-8 py-5 rounded-[2.5rem] border-[1px] ${
                      selectedBranchAnswerId === answer.id
                        ? 'text-[#ee5974] border-[#ee5974]'
                        : 'text-[#a33726] border-[#a33726]/20 opacity-70 hover:opacity-100 hover:border-[#ee5974]/50 hover:text-[#ee5974]'
                    }`}
                  >
                    {answer.text}
                  </button>
                ))}
              </div>
            </motion.div>

            <div className="mt-16 flex flex-col items-start w-full">
              <button
                onClick={handleBranchContinue}
                disabled={selectedBranchAnswerId === null}
                className={`text-[10px] uppercase tracking-[0.3em] font-normal transition-all pb-1 border-b ${
                  selectedBranchAnswerId === null
                    ? 'text-[#a33726] opacity-20 border-transparent cursor-not-allowed'
                    : 'text-[#a33726] border-[#a33726]/30 hover:border-[#ee5974] hover:text-[#ee5974]'
                }`}
              >
                See My Profile
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Results screen ───────────────────────────────────────────────────────────

  const curtainTransition = revealForced
    ? 'transform 0.95s cubic-bezier(0.16, 1, 0.3, 1)'
    : 'transform 0.12s ease-out';

  const contentVisible = displayProgress > 0.55;

  return (
    <div style={{ backgroundColor: '#f2f1ea', minHeight: '100vh' }}>

      {/* ── SECTION 1: REVEAL HERO ──────────────────────────────────────────── */}
      {/* 200vh container — sticky inner reveals as user scrolls through extra 100vh */}
      <div ref={revealContainerRef} style={{ position: 'relative', height: '200vh' }}>
        <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>

          {/* REVEALED LAYER — bag + archetype copy */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'row',
            backgroundColor: '#f2f1ea',
          }}>
            {/* Left: coffee bag */}
            <div style={{
              width: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 clamp(20px, 3vw, 48px)',
            }}>
              <img
                src={archetype.bag}
                alt={archetype.name}
                style={{
                  maxHeight: '74vh',
                  maxWidth: '100%',
                  width: 'auto',
                  objectFit: 'contain',
                  display: 'block',
                  opacity: contentVisible ? 1 : 0,
                  transform: contentVisible ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(12px)',
                  transition: 'opacity 0.8s ease, transform 0.8s ease',
                }}
              />
            </div>

            {/* Right: profile text */}
            <div style={{
              width: '50%',
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              padding: '0 clamp(32px, 5vw, 72px) 0 0',
              opacity: contentVisible ? 1 : 0,
              transform: contentVisible ? 'translateY(0)' : 'translateY(16px)',
              transition: 'opacity 0.8s ease 0.1s, transform 0.8s ease 0.1s',
            }}>
              <p style={{
                fontSize: '0.62rem', letterSpacing: '0.3em', textTransform: 'uppercase',
                color: archetype.color, margin: '0 0 14px', opacity: 0.75,
              }}>
                YOUR PROFILE{userName.trim() ? ` · ${userName}` : ''}
              </p>
              <p style={{
                fontSize: 'clamp(0.8rem, 1vw, 0.92rem)',
                color: '#9a2918', opacity: 0.55, margin: '0 0 6px', letterSpacing: '0.02em',
              }}>
                Your palate points to
              </p>
              <h1 style={{
                fontSize: 'clamp(2.2rem, 3.6vw, 3.8rem)',
                color: archetype.color, lineHeight: 1.0, fontWeight: 400,
                margin: '0 0 22px', letterSpacing: '-0.01em',
              }}>
                {archetype.name}
              </h1>
              <p style={{
                fontSize: 'clamp(0.85rem, 1vw, 0.95rem)',
                color: '#9a2918', opacity: 0.6, lineHeight: 1.82,
                margin: '0 0 36px', maxWidth: 380,
              }}>
                {archetype.shortDescription}
              </p>
              <a
                href="#coffees"
                onClick={(e) => { e.preventDefault(); document.getElementById('coffees')?.scrollIntoView({ behavior: 'smooth' }); }}
                style={{
                  fontSize: '0.7rem', letterSpacing: '0.22em', textTransform: 'uppercase',
                  color: archetype.color, textDecoration: 'none',
                  borderBottom: `1px solid ${archetype.color}55`, paddingBottom: 3,
                  width: 'fit-content', cursor: 'pointer',
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = archetype.color)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = `${archetype.color}55`)}
              >
                See your coffees →
              </a>
            </div>
          </div>

          {/* CURTAIN — wallpaper slides left as revealProgress increases */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            transform: `translateX(${-(displayProgress * 100)}%)`,
            transition: curtainTransition,
            willChange: 'transform',
            overflow: 'hidden',
          }}>
            <img
              src={archetype.wallpaper}
              alt=""
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover', objectPosition: 'center',
                display: 'block',
              }}
            />
            {/* Gradient overlay for text readability */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to top, rgba(12,8,6,0.55) 0%, rgba(12,8,6,0.12) 55%, rgba(12,8,6,0.2) 100%)',
            }} />

            {/* Curtain text content */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.0, delay: 0.4 }}
              style={{
                position: 'absolute',
                bottom: 'clamp(48px, 8vh, 88px)',
                left: 'clamp(48px, 7vw, 96px)',
              }}
            >
              <p style={{
                fontSize: '0.62rem', letterSpacing: '0.28em', textTransform: 'uppercase',
                color: 'rgba(242,241,234,0.5)', margin: '0 0 18px',
              }}>
                {userName.trim() ? `${userName} · ` : ''}Your result
              </p>
              <p style={{
                fontSize: 'clamp(1.5rem, 2.8vw, 2.6rem)',
                color: '#f2f1ea', fontWeight: 400, lineHeight: 1.18,
                margin: '0 0 40px', maxWidth: 520,
              }}>
                Your palate has a direction.
              </p>

              {/* Scroll hint — desktop */}
              <p className="hidden md:block" style={{
                fontSize: '0.6rem', letterSpacing: '0.22em', textTransform: 'uppercase',
                color: 'rgba(242,241,234,0.38)', margin: 0,
              }}>
                Scroll to reveal
              </p>

              {/* Reveal button — mobile fallback */}
              <button
                className="block md:hidden"
                onClick={() => setRevealForced(true)}
                style={{
                  background: 'none',
                  border: '1px solid rgba(242,241,234,0.35)',
                  padding: '11px 22px',
                  color: '#f2f1ea',
                  fontFamily: 'inherit',
                  fontSize: '0.65rem',
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s',
                }}
              >
                Reveal my archetype →
              </button>
            </motion.div>
          </div>

        </div>
      </div>{/* /reveal hero */}

      {/* ── SECTION 2: WHY THIS MATCHES YOU ────────────────────────────────── */}
      <section style={{
        backgroundColor: '#e5e5da',
        padding: 'clamp(72px, 10vw, 112px) clamp(32px, 6vw, 96px)',
      }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.8 }}
          >
            <p style={{
              fontSize: '0.62rem', letterSpacing: '0.28em', textTransform: 'uppercase',
              color: archetype.color, margin: '0 0 12px', opacity: 0.8,
            }}>
              {archetype.name}
            </p>
            <h2 style={{
              fontSize: 'clamp(1.6rem, 2.8vw, 2.4rem)',
              color: '#9a2918', fontWeight: 400, lineHeight: 1.15,
              margin: '0 0 clamp(40px, 6vw, 64px)',
            }}>
              Why this matches you
            </h2>
          </motion.div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            {archetype.whyMatches.map((line, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.7, delay: i * 0.12 }}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}
              >
                <div style={{
                  width: 1, height: 32, flexShrink: 0, marginTop: 4,
                  backgroundColor: archetype.color, opacity: 0.45,
                }} />
                <p style={{
                  fontSize: 'clamp(0.92rem, 1.2vw, 1.05rem)',
                  color: '#9a2918', opacity: 0.75, lineHeight: 1.75,
                  margin: 0, fontWeight: 400,
                }}>
                  {line}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 3: COFFEES SELECTED FOR YOU ────────────────────────────── */}
      <section
        id="coffees"
        style={{
          backgroundColor: '#f2f1ea',
          padding: 'clamp(72px, 10vw, 112px) clamp(32px, 6vw, 96px)',
        }}
      >
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.8 }}
            style={{ marginBottom: 'clamp(40px, 6vw, 56px)' }}
          >
            <p style={{
              fontSize: '0.62rem', letterSpacing: '0.28em', textTransform: 'uppercase',
              color: archetype.color, margin: '0 0 12px', opacity: 0.8,
            }}>
              The Collection
            </p>
            <h2 style={{
              fontSize: 'clamp(1.6rem, 2.8vw, 2.4rem)',
              color: '#9a2918', fontWeight: 400, lineHeight: 1.15, margin: 0,
            }}>
              Coffees selected for you
            </h2>
          </motion.div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {archetype.coffees.map((coffee, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.7, delay: i * 0.1 }}
                style={{
                  backgroundColor: '#ebebe3',
                  padding: 'clamp(24px, 3vw, 36px) clamp(24px, 3vw, 40px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 24,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: 1, minWidth: 200 }}>
                  <p style={{
                    fontSize: '0.58rem', letterSpacing: '0.2em', textTransform: 'uppercase',
                    color: archetype.color, margin: '0 0 8px', opacity: 0.7,
                  }}>
                    {coffee.match} Match
                  </p>
                  <h3 style={{
                    fontSize: 'clamp(1rem, 1.4vw, 1.2rem)',
                    color: '#9a2918', fontWeight: 400, margin: '0 0 6px', lineHeight: 1.2,
                  }}>
                    {coffee.name}
                  </h3>
                  <p style={{
                    fontSize: 'clamp(0.78rem, 0.9vw, 0.85rem)',
                    color: '#9a2918', opacity: 0.55, margin: 0, lineHeight: 1.6,
                  }}>
                    {coffee.flavor}
                  </p>
                </div>
                <Link
                  to="/shop"
                  style={{
                    fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
                    color: archetype.color, textDecoration: 'none',
                    borderBottom: `1px solid ${archetype.color}50`, paddingBottom: 3,
                    flexShrink: 0, whiteSpace: 'nowrap',
                    transition: 'border-color 0.2s',
                  }}
                >
                  Get this coffee →
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 4: CLOSING CTA ──────────────────────────────────────────── */}
      <section style={{
        backgroundColor: '#deded1',
        padding: 'clamp(64px, 9vw, 96px) clamp(32px, 6vw, 96px)',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.8 }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}
          >
            {/* Save prompt for logged-out users */}
            {!user && (
              <>
                <p style={{
                  fontSize: 'clamp(0.88rem, 1.1vw, 0.98rem)',
                  color: '#9a2918', opacity: 0.65, margin: 0, lineHeight: 1.75,
                }}>
                  Save your profile to find your coffees faster next time.
                </p>
                <Link
                  to="/sign-in"
                  style={{
                    fontSize: '0.7rem', letterSpacing: '0.22em', textTransform: 'uppercase',
                    color: '#f2f1ea', backgroundColor: '#9a2918',
                    textDecoration: 'none', padding: '13px 28px',
                    transition: 'background-color 0.2s',
                    marginBottom: 8,
                  }}
                >
                  Save my taste profile
                </Link>
              </>
            )}
            {user && (
              <p style={{
                fontSize: '0.82rem', color: archetype.color, margin: 0, letterSpacing: '0.04em',
              }}>
                Your profile has been saved.
              </p>
            )}

            {/* Divider */}
            <div style={{ width: 1, height: 40, backgroundColor: 'rgba(154,41,24,0.2)', margin: '8px 0' }} />

            <p style={{
              fontSize: 'clamp(0.88rem, 1.1vw, 0.98rem)',
              color: '#9a2918', opacity: 0.55, margin: 0,
            }}>
              Want to explore another direction?
            </p>
            <Link
              to="/coffees"
              style={{
                fontSize: '0.7rem', letterSpacing: '0.22em', textTransform: 'uppercase',
                color: '#9a2918', textDecoration: 'none',
                borderBottom: '1px solid rgba(154,41,24,0.35)', paddingBottom: 3,
              }}
            >
              Meet all archetypes →
            </Link>

            <button
              onClick={handleRetake}
              style={{
                marginTop: 8,
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: '0.65rem', letterSpacing: '0.18em', textTransform: 'uppercase',
                color: '#9a2918', opacity: 0.38, transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.38')}
            >
              Retake the quiz
            </button>
          </motion.div>
        </div>
      </section>

    </div>
  );
}
