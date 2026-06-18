import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { saveQuizResult, getUserProfile } from '../lib/api';

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

interface BranchQuestion {
  id: string;
  questionText: string;
  confirmAnswerText: string;
  reclassifyAnswerText: string;
  reclassifyArchetypeId: string;
  reclassifyArchetypeName: string;
}

// ─── Static question images (keyed by q_number) ───────────────────────────────

const QUESTION_IMAGES: Record<number, string> = {
  1: 'https://i.imgur.com/NQRCzNU.jpeg',
  2: 'https://i.imgur.com/k2KrVf1.jpeg',
  3: 'https://i.imgur.com/ahLdfc7.jpeg',
  4: 'https://i.imgur.com/S46KQYC.jpeg',
};

// ─── Archetype short-key helpers ──────────────────────────────────────────────

type ArchetypeKey = 'chocolate' | 'balanced' | 'fruity' | 'floral' | 'earthy';

const ARCHETYPE_NAME_TO_KEY: Record<string, ArchetypeKey> = {
  'Chocolate & Nutty': 'chocolate',
  'Balanced & Sweet':  'balanced',
  'Fruity':            'fruity',
  'Floral':            'floral',
  'Earthy':            'earthy',
};

// ─── Archetypes display data ──────────────────────────────────────────────────

const ARCHETYPES: Record<ArchetypeKey, {
  name: string;
  color: string;
  description: string;
  features: string[];
  coffees: { name: string; flavor: string; match: string }[];
}> = {
  chocolate: {
    name: 'Chocolate & Nutty',
    color: '#a54c2d',
    description: 'A rich, bold, and comforting profile. You know exactly what you like and you like it satisfying.',
    features: [
      'You prefer a bold and comforting cup',
      'You enjoy deep cocoa and roasted nut flavors',
      'You appreciate a heavy, satisfying body',
    ],
    coffees: [
      { name: 'Sumatra Mandheling', flavor: 'Dark Chocolate, Cedar, Walnut', match: '97%' },
      { name: 'Mexico Cerrado',     flavor: 'Cocoa Nibs, Hazelnut, Molasses', match: '91%' },
    ],
  },
  balanced: {
    name: 'Balanced & Sweet',
    color: '#d1ac11',
    description: "A smooth, round, and approachable profile. You want coffee that's easy, pleasant, and never surprising.",
    features: [
      'You prefer lower acidity and a round body',
      'You enjoy caramelized and nutty sweetness',
      'You appreciate a coffee that never gets in the way',
    ],
    coffees: [
      { name: 'Brazil Los Santos',        flavor: 'Milk Chocolate, Caramel, Peanut', match: '99%' },
      { name: 'Guatemala Honey Process',  flavor: 'Brown Sugar, Red Apple, Pecan',   match: '94%' },
    ],
  },
  fruity: {
    name: 'Fruity',
    color: '#ca445f',
    description: "A vibrant, curious, and layered profile. You're here for the experience, not just the caffeine.",
    features: [
      'You prefer bright, juicy acidity and lively notes',
      'You enjoy vibrant fruit-forward flavors',
      'You appreciate a coffee that keeps you guessing',
    ],
    coffees: [
      { name: 'Kenya Guji',              flavor: 'Blueberry, Peach, Rose',           match: '96%' },
      { name: 'Costa Rica Pink Bourbon', flavor: 'Strawberry, Watermelon, Hibiscus', match: '89%' },
    ],
  },
  floral: {
    name: 'Floral',
    color: '#7b6ca8',
    description: "A delicate, aromatic, and tea-like profile. You're drawn to brightness and floral complexity over body and bitterness.",
    features: [
      'You prefer delicate, tea-like cups with floral notes',
      'You enjoy jasmine, bergamot, and light citrus aromatics',
      'You appreciate coffees that feel light and almost ethereal',
    ],
    coffees: [
      { name: 'Ethiopia Yirgacheffe', flavor: 'Jasmine, Bergamot, Lemon Zest', match: '98%' },
      { name: 'Ethiopia Guji Washed', flavor: 'Rose, Peach, White Tea',         match: '92%' },
    ],
  },
  earthy: {
    name: 'Earthy',
    color: '#5c6b45',
    description: "A deep, complex, and grounded profile. You're drawn to coffees with weight, structure, and earthy depth.",
    features: [
      'You prefer intense, serious cups with deep roasted character',
      'You enjoy dark, mineral, and earthy flavor profiles',
      'You appreciate a coffee that feels complex and challenging',
    ],
    coffees: [
      { name: 'Sumatra Wet-Hulled', flavor: 'Dark Earth, Cedar, Tobacco',           match: '96%' },
      { name: 'Yemen Mocha',        flavor: 'Dark Chocolate, Dried Fig, Cardamom',  match: '91%' },
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
  const [scoreData, setScoreData]           = useState<ScoreResult | null>(null);
  const [showBranch, setShowBranch]         = useState(false);
  const [branchQuestion, setBranchQuestion] = useState<BranchQuestion | null>(null);
  const [branchAnswer, setBranchAnswer]     = useState<'A' | 'B' | null>(null);

  // API state
  const [questions, setQuestions] = useState<ApiQuestion[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Returning user state
  const [userProfile, setUserProfile]       = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(false);

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

      // 1. Score
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

      // 2. Check for branch question
      if (score.archetypeId) {
        const branchRes = await fetch(`/api/quiz/branch?archetypeId=${score.archetypeId}`);
        if (branchRes.ok) {
          const { branchQuestion: bq } = await branchRes.json();
          if (bq) {
            setBranchQuestion(bq);
            setShowBranch(true);
            return; // branch screen handles save + complete
          }
        }
      }

      // No branch — save and show results
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
    if (!branchAnswer || !scoreData || !branchQuestion) return;

    let finalArchetypeName = scoreData.archetype;
    if (branchAnswer === 'B') {
      finalArchetypeName = branchQuestion.reclassifyArchetypeName;
      const newKey = ARCHETYPE_NAME_TO_KEY[finalArchetypeName] ?? archetypeKey;
      setArchetypeKey(newKey);
    }

    if (user) {
      saveQuizResult({ archetype: finalArchetypeName, scores: scoreData.scores, answers, decaf: false })
        .catch(console.error);
    }

    setShowBranch(false);
    setIsComplete(true);
  };

  const handleRetake = () => {
    setIsComplete(false);
    setShowBranch(false);
    setBranchQuestion(null);
    setBranchAnswer(null);
    setScoreData(null);
    setCurrentStep(0);
    setAnswers({});
    setSelectedIds({});
    setScoreError(false);
    setArchetypeKey('balanced');
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
        <div className="relative z-10 w-full p-8 pt-16 md:p-16 lg:p-24 flex flex-col justify-start items-start">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7 }}
            className="w-full max-w-[480px] flex flex-col items-start"
          >
            <h1 className="text-[2.5rem] lg:text-[3.5rem] text-[#ee5974] leading-[1.05] font-normal tracking-tight mb-8">
              Whose palate are we profiling today?
            </h1>
            <div className="w-full flex flex-col gap-8 mt-2">
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Enter your name"
                className="w-full text-left text-[1.25rem] tracking-wide py-3 rounded-none border-b border-[#a33726]/30 bg-transparent focus:outline-none focus:border-[#ee5974] text-[#a33726] placeholder-[#a33726]/40"
                onKeyDown={(e) => { if (e.key === 'Enter' && userName.trim()) setHasStarted(true); }}
              />
              <button
                onClick={() => setHasStarted(true)}
                disabled={!userName.trim()}
                className={`text-[10px] uppercase tracking-[0.3em] font-normal transition-all pb-1 border-b ${
                  !userName.trim()
                    ? 'text-[#a33726] opacity-30 border-transparent cursor-not-allowed'
                    : 'text-[#a33726] border-[#a33726]/40 hover:border-[#ee5974] hover:text-[#ee5974]'
                }`}
              >
                Begin Profile
              </button>
              <Link
                to="/sign-in"
                className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/40 hover:text-[#a33726] transition-colors mt-6"
              >
                Already have a profile? Sign in →
              </Link>
            </div>
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

            <div className="mt-16 flex flex-col items-start w-full">
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
              {scoreError && (
                <p className="text-[11px] text-[#ee5974] mt-4">
                  Something went wrong. Please try again.
                </p>
              )}
              {!user && (
                <Link
                  to="/sign-in"
                  className="text-[11px] uppercase tracking-[0.1em] text-[#a33726] opacity-40 hover:opacity-100 transition-opacity mt-8 font-normal"
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
                {([
                  { key: 'A' as const, text: branchQuestion.confirmAnswerText },
                  { key: 'B' as const, text: branchQuestion.reclassifyAnswerText },
                ]).map(({ key, text }) => (
                  <button
                    key={key}
                    onClick={() => setBranchAnswer(key)}
                    className={`w-full text-left text-[1.05rem] lg:text-[1.15rem] tracking-wide transition-all duration-500 px-8 py-5 rounded-[2.5rem] border-[1px] ${
                      branchAnswer === key
                        ? 'text-[#ee5974] border-[#ee5974]'
                        : 'text-[#a33726] border-[#a33726]/20 opacity-70 hover:opacity-100 hover:border-[#ee5974]/50 hover:text-[#ee5974]'
                    }`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </motion.div>

            <div className="mt-16 flex flex-col items-start w-full">
              <button
                onClick={handleBranchContinue}
                disabled={branchAnswer === null}
                className={`text-[10px] uppercase tracking-[0.3em] font-normal transition-all pb-1 border-b ${
                  branchAnswer === null
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
  return (
    <div className="w-full min-h-screen flex flex-col lg:flex-row bg-[#f2f1ea]">
      <div className="w-full lg:w-1/2 h-[40vh] lg:h-screen fixed lg:sticky top-0 left-0 overflow-hidden bg-[#1a1a1a]">
        <img src="https://i.imgur.com/3WOJLhq.jpeg" alt="" className="w-full h-full object-cover" />
      </div>

      <div className="w-full lg:w-1/2 min-h-[60vh] lg:min-h-screen bg-[#f2f1ea] px-8 py-16 md:px-16 lg:p-24 flex flex-col items-start relative ml-auto z-10 overflow-y-auto">
        <div className="w-full max-w-[480px] flex flex-col mx-auto lg:mx-0">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="w-full"
          >
            <h3
              className="text-[10px] uppercase tracking-[0.3em] mb-4 font-normal"
              style={{ color: archetype.color }}
            >
              {userName.trim() ? `${userName}'s Profile` : 'Your Profile'}
            </h3>
            <h1
              className="text-[3.5rem] lg:text-[4rem] leading-[1.05] font-normal tracking-tight mb-6"
              style={{ color: archetype.color }}
            >
              {archetype.name}
            </h1>
            <p className="text-lg text-[#a33726]/70 font-light leading-relaxed mb-12">
              {archetype.description}
            </p>

            <div className="mb-16 w-full">
              <h2 className="text-2xl text-[#a33726] font-normal mb-8">Why this matches you</h2>
              <ul className="flex flex-col gap-6 mb-8">
                {archetype.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-5">
                    <div className="w-[1px] h-8 shrink-0 opacity-40 mt-1" style={{ backgroundColor: archetype.color }} />
                    <span className="text-lg text-[#a33726]/80 font-light leading-relaxed">{f}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="w-full h-[1px] bg-[#a33726]/10 mb-16" />

            <div className="mb-16 w-full">
              <h2 className="text-2xl text-[#a33726] font-normal mb-8">Coffees selected for you</h2>
              <div className="flex flex-col gap-4">
                {archetype.coffees.map((coffee, i) => (
                  <div
                    key={i}
                    className="flex flex-row items-center gap-6 p-4 border border-[#a33726]/20 bg-white/40 hover:bg-white/70 transition-colors"
                  >
                    <div className="flex flex-col flex-1 py-2">
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="text-lg text-[#a33726] font-normal">{coffee.name}</h4>
                        <span className="text-[10px] font-normal px-2 py-1 bg-[#a33726]/10 text-[#a33726] rounded-sm">
                          {coffee.match} Match
                        </span>
                      </div>
                      <p className="text-sm text-[#a33726]/70 mb-5 font-light">{coffee.flavor}</p>
                      <Link
                        to="/shop"
                        className="text-[10px] uppercase tracking-[0.2em] font-normal text-[#a33726] hover:text-[#ee5974] transition-colors w-fit border-b border-[#a33726]/30 hover:border-[#ee5974] pb-0.5"
                      >
                        Get this coffee
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#a33726]/[0.03] border border-[#a33726]/10 p-10 flex flex-col items-center text-center mt-8 w-full">
              <h3 className="text-xl text-[#a33726] mb-3">Want us to remember your taste?</h3>
              <p className="text-[15px] text-[#a33726]/60 mb-8 font-light max-w-sm">
                Save your profile to quickly find your favorite coffees next time.
              </p>
              {user ? (
                <p className="text-sm text-[#ee5974]">Profile saved! Check your account.</p>
              ) : (
                <Link
                  to="/sign-in"
                  className="w-full max-w-[280px] py-4 text-center text-[10px] font-normal uppercase tracking-[0.2em] text-[#f2f1ea] bg-[#a33726] hover:bg-[#ee5974] transition-colors mb-6"
                >
                  Save my taste profile
                </Link>
              )}
              <button
                onClick={handleRetake}
                className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/50 hover:text-[#ee5974] transition-colors border-b border-transparent hover:border-[#ee5974] pb-0.5 mt-4"
              >
                Retake Taste Finder
              </button>
            </div>

          </motion.div>
        </div>
      </div>
    </div>
  );
}
