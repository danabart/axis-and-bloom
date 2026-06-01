import React, { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { saveQuizResult } from '../lib/api';

// ─── API types ────────────────────────────────────────────────────────────────

interface ApiAnswer {
  id: string;
  text: string;
  archetype_id: string | null;
  archetype_name: string | null; // e.g. 'Chocolate & Nutty' | 'Balanced & Sweet' | 'Fruity & Complex' | null
}

interface ApiQuestion {
  question_id: string;
  q_number: number;
  q_text: string;
  answers: ApiAnswer[];
}

// ─── Static question images (keyed by q_number) ───────────────────────────────
// Images are managed in the frontend; questions & answers come from the DB.

const QUESTION_IMAGES: Record<number, string> = {
  1: 'https://i.imgur.com/NQRCzNU.jpeg',
  2: 'https://i.imgur.com/k2KrVf1.jpeg',
  3: 'https://i.imgur.com/ahLdfc7.jpeg',
  4: 'https://i.imgur.com/S46KQYC.jpeg',
};

// ─── Archetype short-key helpers ──────────────────────────────────────────────

type Archetype = 'chocolate' | 'balanced' | 'fruity';

const ARCHETYPE_NAME_TO_KEY: Record<string, Archetype> = {
  'Chocolate & Nutty': 'chocolate',
  'Balanced & Sweet':  'balanced',
  'Fruity':            'fruity',
};

// ─── Archetypes display data ──────────────────────────────────────────────────

const ARCHETYPES = {
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
      { name: 'Kenya Guji',              flavor: 'Blueberry, Peach, Rose',             match: '96%' },
      { name: 'Costa Rica Pink Bourbon', flavor: 'Strawberry, Watermelon, Hibiscus',   match: '89%' },
    ],
  },
};

// ─── Scoring ──────────────────────────────────────────────────────────────────
// Scoring is done entirely on the backend via POST /api/quiz/score.
// The frontend collects selected answer UUIDs and sends them to the server.

// ─── Component ────────────────────────────────────────────────────────────────

export default function FlavorQuiz() {
  const [hasStarted, setHasStarted]     = useState(false);
  const [userName, setUserName]         = useState('');
  const [currentStep, setCurrentStep]   = useState(0);
  const [answers, setAnswers]           = useState<Record<number, number>>({});    // step → option index (for UI selection highlight)
  const [selectedIds, setSelectedIds]   = useState<Record<number, string>>({});   // step → answer UUID (sent to /api/quiz/score)
  const [isComplete, setIsComplete]     = useState(false);
  const [isScoring, setIsScoring]       = useState(false);
  const [archetypeKey, setArchetypeKey] = useState<Archetype>('balanced');
  const [scoreError, setScoreError]     = useState(false);

  // API state
  const [questions, setQuestions] = useState<ApiQuestion[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(false);

  const { user } = useAuth();

  // Fetch questions from backend on mount
  useEffect(() => {
    fetch('/api/quiz/questions')
      .then(r => r.json())
      .then(data => {
        if (data.questions?.length) {
          setQuestions(data.questions);
        } else {
          setLoadError(true);
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  // Pick up name pre-filled from another page (e.g. homepage)
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

    // Last question — send answer IDs to backend for scoring
    setIsScoring(true);
    try {
      const answerIds = Object.values(selectedIds);
      const res = await fetch('/api/quiz/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answerIds }),
      });

      if (!res.ok) throw new Error('Score request failed');

      const { archetype: archetypeName, scores } = await res.json();
      const key = ARCHETYPE_NAME_TO_KEY[archetypeName] ?? 'balanced';
      setArchetypeKey(key);
      setIsComplete(true);

      // Save to DB if signed in
      if (user) {
        saveQuizResult({ archetype: archetypeName, scores, answers, decaf: false })
          .catch(console.error);
      }
    } catch (err) {
      console.error('[quiz/score]', err);
      setScoreError(true);
    } finally {
      setIsScoring(false);
    }
  };

  // ── Loading state ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="relative w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center"
       
      >
        <p className="text-[#a33726]/50 text-sm uppercase tracking-[0.2em]">Loading…</p>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────────
  if (loadError || !questions.length) {
    return (
      <div
        className="relative w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center"
       
      >
        <p className="text-[#a33726]/70 text-sm uppercase tracking-[0.2em]">
          Quiz unavailable. Please try again later.
        </p>
      </div>
    );
  }

  // ── Name screen ──────────────────────────────────────────────────────────────
  if (!hasStarted) {
    return (
      <div
        className="relative w-full min-h-screen bg-[#f2f1ea] flex overflow-hidden"
       
      >
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
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  // ── Question screen ──────────────────────────────────────────────────────────
  if (!isComplete) {
    const question = questions[currentStep];
    const image    = QUESTION_IMAGES[question.q_number] ?? QUESTION_IMAGES[1];

    return (
      <div
        className="w-full min-h-screen flex flex-col lg:flex-row bg-[#f2f1ea]"
       
      >
        {/* Left — photo */}
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

        {/* Right — question */}
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

  // ── Results screen ───────────────────────────────────────────────────────────
  return (
    <div
      className="w-full min-h-screen flex flex-col lg:flex-row bg-[#f2f1ea]"
     
    >
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
            <p className="text-lg text-[#a33726]/70 font-light leading-relaxed mb-12 font-sans">
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
                onClick={() => { setIsComplete(false); setCurrentStep(0); setAnswers({}); setSelectedIds({}); setScoreError(false); setArchetypeKey('balanced'); }}
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
