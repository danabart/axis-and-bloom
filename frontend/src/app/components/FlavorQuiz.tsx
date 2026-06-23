import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { saveQuizResult, getUserProfile } from '../lib/api';

// ─── Logo / dial asset ───────────────────────────────────────────────────────

import logoLinesSvg from '../../design/LOGO/LogoLines.svg';

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
  foodSignalAlignment: string;
  recommendationMode: string;
  tieDetected: boolean;
  tiedArchetypes: string[];
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

interface BloomDialOption {
  id: string;
  label: string;
  description: string;
  coffeeMapping: string;
  role: string;
  bestBrew: string;
  alsoBeautifulAs: string;
  additionalSupportedMethods: string[];
}

interface BloomDialConfig {
  archetype: string;
  color: string;
  options: BloomDialOption[];
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

// ─── Bloom Dial config ────────────────────────────────────────────────────────

const BLOOM_DIAL_CHOCOLATE: BloomDialConfig = {
  archetype: 'Chocolate & Nutty',
  color: '#a54c2d',
  options: [
    {
      id: 'good-morning',
      label: 'Good Morning',
      description: 'Easygoing, polished, and made for a gentle start.',
      coffeeMapping: 'Guatemala',
      role: 'Soft / Classic Bridge',
      bestBrew: 'Pour Over',
      alsoBeautifulAs: 'Drip Coffee',
      additionalSupportedMethods: ['Espresso', 'French Press'],
    },
    {
      id: 'theres-no-place-like-home',
      label: "There's No Place Like Home",
      description: 'Familiar, grounding, and deeply reassuring.',
      coffeeMapping: 'Brazil',
      role: 'Classic Chocolate & Nutty',
      bestBrew: 'Drip Coffee',
      alsoBeautifulAs: 'Cold Brew',
      additionalSupportedMethods: ['French Press', 'Milk Drinks', 'Espresso'],
    },
    {
      id: 'working-late',
      label: 'Working Late',
      description: 'Focused, full, and made to carry you through.',
      coffeeMapping: '6Bean Blend / Espresso',
      role: 'Dark & Toasted / Espresso-oriented',
      bestBrew: 'Espresso',
      alsoBeautifulAs: 'Milk Drinks',
      additionalSupportedMethods: ['French Press'],
    },
    {
      id: 'deep-roots',
      label: 'Deep Roots',
      description: 'Grounded, layered, and a little more adventurous.',
      coffeeMapping: 'Bali',
      role: 'Deep / Earthy crossover',
      bestBrew: 'French Press',
      alsoBeautifulAs: 'Drip Coffee',
      additionalSupportedMethods: ['Cold Brew', 'Milk Drinks'],
    },
  ],
};

// ─── BloomDial ────────────────────────────────────────────────────────────────

function BloomDial({ visible }: { visible: boolean }) {
  const [dialAngle, setDialAngle]     = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [isDragging, setIsDragging]   = useState(false);
  const [isSnapping, setIsSnapping]   = useState(false);

  const wheelRef      = useRef<HTMLDivElement>(null);
  const dialAngleRef  = useRef(0);
  const dragRef       = useRef({ startPA: 0, startDA: 0, active: false });
  const snapTimeout   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => () => { if (snapTimeout.current) clearTimeout(snapTimeout.current); }, []);

  const pointerAngle = (clientX: number, clientY: number): number => {
    const el = wheelRef.current;
    if (!el) return 0;
    const { left, top, width, height } = el.getBoundingClientRect();
    return Math.atan2(clientY - (top + height / 2), clientX - (left + width / 2)) * (180 / Math.PI) + 90;
  };

  const snapAndSelect = (rawAngle: number) => {
    const n       = ((rawAngle % 360) + 360) % 360;
    const snapped = Math.round(n / 90) * 90 % 360;
    dialAngleRef.current = snapped;
    setDialAngle(snapped);
    setSelectedIdx(Math.round(n / 90) % 4);
    if (!reducedMotion) {
      setIsSnapping(true);
      if (snapTimeout.current) clearTimeout(snapTimeout.current);
      snapTimeout.current = setTimeout(() => setIsSnapping(false), 400);
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startPA: pointerAngle(e.clientX, e.clientY), startDA: dialAngleRef.current, active: true };
    setIsDragging(true);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    dragRef.current = { startPA: pointerAngle(t.clientX, t.clientY), startDA: dialAngleRef.current, active: true };
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;
    const move = (cx: number, cy: number) => {
      if (!dragRef.current.active) return;
      let delta = pointerAngle(cx, cy) - dragRef.current.startPA;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      const a = dragRef.current.startDA + delta;
      dialAngleRef.current = a;
      setDialAngle(a);
    };
    const end = () => {
      dragRef.current.active = false;
      setIsDragging(false);
      snapAndSelect(dialAngleRef.current);
    };
    const onMM = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onTM = (e: TouchEvent) => { const t = e.touches[0]; move(t.clientX, t.clientY); };
    window.addEventListener('mousemove', onMM);
    window.addEventListener('mouseup', end);
    window.addEventListener('touchmove', onTM, { passive: false });
    window.addEventListener('touchend', end);
    return () => {
      window.removeEventListener('mousemove', onMM);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchmove', onTM);
      window.removeEventListener('touchend', end);
    };
  }, [isDragging]);

  const opt = selectedIdx !== null ? BLOOM_DIAL_CHOCOLATE.options[selectedIdx] : null;

  const wheelT = reducedMotion ? 'none'
    : isDragging  ? 'none'
    : isSnapping  ? 'transform 0.35s cubic-bezier(0.34, 1.4, 0.64, 1)'
    : 'transform 0.08s ease-out';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      width: '100%',
      opacity: visible ? 1 : 0,
      transition: visible ? 'opacity 0.6s ease 0.5s' : 'none',
    }}>
      {/* Eyebrow */}
      <p style={{
        fontSize: '0.52rem', letterSpacing: '0.32em', textTransform: 'uppercase',
        color: '#9a2918', opacity: 0.5, margin: '0 0 10px', textAlign: 'center',
      }}>
        YOUR BLOOM DIAL
      </p>

      {/* Main line — "Personalize" highlighted in strong pink */}
      <p style={{
        fontSize: 'clamp(0.72rem, 0.88vw, 0.88rem)',
        color: '#9a2918', margin: '0 0 8px', lineHeight: 1.35, textAlign: 'center',
      }}>
        <span style={{ backgroundColor: '#ee5974', color: '#deded1', padding: '1px 6px' }}>
          Personalize
        </span>
        {' '}your coffee archetype.
      </p>

      {/* Supporting copy */}
      <p style={{
        fontSize: 'clamp(0.6rem, 0.7vw, 0.66rem)',
        color: '#9a2918', opacity: 0.38, margin: '0 0 20px',
        lineHeight: 1.6, textAlign: 'center',
      }}>
        Choose the expression of Chocolate&nbsp;&amp;&nbsp;Nutty<br />
        that feels most like you right now.
      </p>

      {/* Dial + fixed indicator */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        {/* Fixed pointer — sits above the rotating logo */}
        <div style={{
          position: 'absolute', top: -12, left: '50%',
          transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: '4px solid transparent',
          borderRight: '4px solid transparent',
          borderTop: '7px solid #ee5974',
          zIndex: 2,
        }} />

        {/* Rotating logo */}
        <div
          ref={wheelRef}
          style={{
            width: 'clamp(130px, 14vw, 188px)',
            height: 'clamp(130px, 14vw, 188px)',
            cursor: isDragging ? 'grabbing' : 'grab',
            transform: `rotate(${dialAngle}deg)`,
            transition: wheelT,
            userSelect: 'none',
            touchAction: 'none',
          }}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
        >
          <img
            src={logoLinesSvg}
            alt=""
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }}
          />
        </div>
      </div>

      {/* Selected option label */}
      <div style={{ textAlign: 'center', minHeight: 52 }}>
        {opt ? (
          <>
            <p style={{
              fontSize: '0.56rem', letterSpacing: '0.22em', textTransform: 'uppercase',
              color: '#ee5974', margin: '0 0 4px',
            }}>
              {opt.label}
            </p>
            <p style={{
              fontSize: 'clamp(0.64rem, 0.74vw, 0.70rem)',
              color: '#9a2918', opacity: 0.5, lineHeight: 1.55, margin: 0,
              maxWidth: 'clamp(160px, 18vw, 240px)',
            }}>
              {opt.description}
            </p>
          </>
        ) : (
          <p style={{
            fontSize: '0.54rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: '#9a2918', opacity: 0.22, margin: 0,
          }}>
            Drag to explore
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FlavorQuiz() {
  // ── Preview shortcut: /find-my-flavor?result=floral (or any archetype key) ──
  const [searchParams] = useSearchParams();
  const _previewParam  = searchParams.get('result') ?? '';
  const isPreview      = _previewParam in ARCHETYPES;
  const previewKey     = isPreview ? (_previewParam as ArchetypeKey) : null;

  const [hasStarted, setHasStarted]     = useState(() => isPreview);
  const [userName, setUserName]         = useState('');
  const [currentStep, setCurrentStep]   = useState(0);
  const [answers, setAnswers]           = useState<Record<number, number>>({});
  const [selectedIds, setSelectedIds]   = useState<Record<number, string>>({});
  const [isComplete, setIsComplete]     = useState(() => isPreview);
  const [isScoring, setIsScoring]       = useState(false);
  const [archetypeKey, setArchetypeKey] = useState<ArchetypeKey>(() => previewKey ?? 'balanced');
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

  // Scroll-to-fine-tune hint — fades in after the reveal settles
  const [showScrollHint, setShowScrollHint] = useState(false);
  const scrollHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const settled = isComplete && displayProgress > 0.8;
    if (!settled) {
      setShowScrollHint(false);
      if (scrollHintTimer.current) { clearTimeout(scrollHintTimer.current); scrollHintTimer.current = null; }
      return;
    }
    if (!scrollHintTimer.current) {
      scrollHintTimer.current = setTimeout(() => { setShowScrollHint(true); scrollHintTimer.current = null; }, 1800);
    }
  }, [isComplete, displayProgress]);

  useEffect(() => () => { if (scrollHintTimer.current) clearTimeout(scrollHintTimer.current); }, []);

  // Screen 2 — Bloom Dial section visibility
  const screen2Ref = useRef<HTMLDivElement>(null);
  const [screen2Visible, setScreen2Visible] = useState(false);

  useEffect(() => {
    if (!isComplete) return;
    const el = screen2Ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setScreen2Visible(true); observer.disconnect(); } },
      { threshold: 0.08 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isComplete]);

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
    setShowScrollHint(false);
    setScreen2Visible(false);
    if (scrollHintTimer.current) { clearTimeout(scrollHintTimer.current); scrollHintTimer.current = null; }
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading && !isPreview) {
    return (
      <div className="relative w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center">
        <p className="text-[#a33726]/50 text-sm uppercase tracking-[0.2em]">Loading…</p>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if ((loadError || !questions.length) && !isPreview) {
    return (
      <div className="relative w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center">
        <p className="text-[#a33726]/70 text-sm uppercase tracking-[0.2em]">
          Quiz unavailable. Please try again later.
        </p>
      </div>
    );
  }

  // ── Returning user ───────────────────────────────────────────────────────────
  if (!isPreview && user && !hasStarted && (profileLoading || userProfile?.archetype)) {
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
  //
  // 220vh container · 100vh sticky · 120vh scrollable
  //   0.00–0.15  intro: full wallpaper + hint copy
  //   0.15–0.65  curtain narrows 100% → 16.67% (1/6 of viewport)
  //   0.65–0.80  brief hold at 1/6 stripe
  //   0.80–1.00  settled
  //
  const INTRO_END = 0.15;
  const OPEN_END  = 0.65;
  const FINAL_W   = 12.5; // 1/8 of viewport width

  const eff = revealForced ? 1 : revealProgress;

  // How far through the opening animation (0 → 1)
  const openProgress = eff <= INTRO_END
    ? 0
    : Math.min(1, (eff - INTRO_END) / (OPEN_END - INTRO_END));

  // Curtain viewport narrows: 100% → 12.5%
  const curtainWidth = FINAL_W + (100 - FINAL_W) * (1 - openProgress);

  // Bag + text fade in as curtain approaches its final position
  const contentVisible = openProgress > 0.6;

  // Intro text fades from the first moment of scroll, gone by eff=0.25
  // (curtain is still ~82vw wide at that point — text is gone well before 70vw)
  const curtainTextAlpha = Math.max(0, 1 - eff / 0.25);

  const curtainTransition = revealForced
    ? 'width 1.1s cubic-bezier(0.16, 1, 0.3, 1)'
    : 'width 0.12s ease-out';

  return (
    <div style={{ backgroundColor: '#f2f1ea', minHeight: '100vh' }}>

      {/* ── SCREEN 1: ARCHETYPE REVEAL ──────────────────────────────────────── */}
      {/*
        220vh container · 100vh sticky · 120vh scrollable
        0.00–0.15  intro: full wallpaper curtain + hint copy
        0.15–0.65  curtain narrows 100% → 12.5% (1/8 vw)
        0.65–0.80  brief hold at stripe
        0.80–1.00  settled → scroll hint fades in after 1.8s
        Layout: 12.5% wallpaper stripe | 24% text | flex:1 bag hero
      */}
      <div ref={revealContainerRef} style={{ position: 'relative', height: '220vh' }}>
        <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>

          {/*
            BASE LAYER — Screen 1: text left · bag hero right
            | 12.5% stripe spacer | 1px seam | ~24% text | flex:1 bag |
          */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundColor: '#f2f1ea',
            display: 'flex',
            alignItems: 'stretch',
          }}>

            {/* 1/8 spacer — sits beneath the wallpaper strip */}
            <div style={{ width: '12.5%', flexShrink: 0 }} />

            {/* Thin seam at the stripe boundary */}
            <div style={{ width: 1, flexShrink: 0, alignSelf: 'stretch', backgroundColor: 'rgba(154,41,24,0.06)' }} />

            {/* Text column — left of bag, between stripe and bag */}
            <div style={{
              width: '24%',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '0 clamp(16px, 2.5vw, 40px)',
              opacity: contentVisible ? 1 : 0,
              transform: contentVisible ? 'translateY(0)' : 'translateY(16px)',
              transition: 'opacity 0.9s ease 0.22s, transform 0.9s ease 0.22s',
            }}>
              <p style={{
                fontSize: '0.52rem', letterSpacing: '0.32em', textTransform: 'uppercase',
                color: archetype.color, margin: '0 0 18px', opacity: 0.6,
              }}>
                YOUR PROFILE{userName.trim() ? ` · ${userName}` : ''}
              </p>
              <p style={{
                fontSize: 'clamp(0.68rem, 0.78vw, 0.76rem)',
                color: '#9a2918', opacity: 0.4, margin: '0 0 6px', letterSpacing: '0.01em',
              }}>
                Your palate points to
              </p>
              <h1 style={{
                fontSize: 'clamp(2.2rem, 3.2vw, 4.2rem)',
                color: archetype.color, lineHeight: 0.92, fontWeight: 400,
                margin: '0 0 22px', letterSpacing: '-0.02em',
              }}>
                {archetype.name}
              </h1>
              <p style={{
                fontSize: 'clamp(0.72rem, 0.82vw, 0.80rem)',
                color: '#9a2918', opacity: 0.50, lineHeight: 1.78,
                margin: '0 0 30px',
              }}>
                {archetype.shortDescription}
              </p>
              <Link
                to="/coffees"
                style={{
                  display: 'inline-block',
                  fontSize: '0.60rem', letterSpacing: '0.24em', textTransform: 'uppercase',
                  color: '#f2f1ea', backgroundColor: archetype.color,
                  textDecoration: 'none',
                  padding: '12px 22px',
                  width: 'fit-content',
                  transition: 'opacity 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.82')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                See your coffees →
              </Link>
            </div>

            {/* Bag — fills remaining right space, hero treatment */}
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'clamp(24px, 4vh, 60px) clamp(32px, 4vw, 80px)',
            }}>
              <img
                src={archetype.bag}
                alt={archetype.name}
                style={{
                  maxHeight: 'clamp(380px, 84vh, 88vh)',
                  maxWidth: '100%',
                  width: 'auto',
                  objectFit: 'contain',
                  display: 'block',
                  opacity: contentVisible ? 1 : 0,
                  transform: contentVisible ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.97)',
                  transition: 'opacity 1.1s ease 0.1s, transform 1.1s ease 0.1s',
                }}
              />
            </div>
          </div>

          {/*
            CURTAIN VIEWPORT — only the wrapper width animates (100% → 12.5%).
            The wallpaper art layer is fixed at 100vw × 100vh and is NEVER resized.
            The wrapper clips it via overflow:hidden — like gift wrap being peeled back.
            background-size: cover on the fixed 100vw×100vh layer; the curtain clipping
            reveals the left 1/8 of that image as the stripe.
          */}
          <div style={{
            position: 'absolute',
            top: 0, left: 0, bottom: 0,
            width: `${curtainWidth}%`,
            zIndex: 10,
            overflow: 'hidden',
            transition: curtainTransition,
          }}>
            {/* Wallpaper art — fixed 100vw × 100vh; cover-scales the full image. Curtain clips it. */}
            <div style={{
              position: 'absolute',
              top: 0, left: 0,
              width: '100vw',
              height: '100vh',
              backgroundImage: `url(${archetype.wallpaper})`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
              backgroundSize: 'cover',
            }} />

            {/* Dark gradient — also fixed so it doesn't change as wrapper narrows */}
            <div style={{
              position: 'absolute',
              top: 0, left: 0,
              width: '100vw',
              height: '100vh',
              background: 'linear-gradient(to top, rgba(10,6,4,0.55) 0%, rgba(10,6,4,0.06) 55%, rgba(10,6,4,0.1) 100%)',
            }} />

            {/* Intro text — fades from first scroll; gone by eff=0.25 (~82vw curtain) */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.0, delay: 0.4 }}
              style={{
                position: 'absolute',
                bottom: 'clamp(48px, 8vh, 88px)',
                left: 'clamp(48px, 6vw, 88px)',
                opacity: curtainTextAlpha,
                pointerEvents: curtainTextAlpha < 0.05 ? 'none' : 'auto',
                transition: 'opacity 0.2s ease',
              }}
            >
              <p style={{
                fontSize: '0.6rem', letterSpacing: '0.28em', textTransform: 'uppercase',
                color: 'rgba(242,241,234,0.5)', margin: '0 0 18px',
              }}>
                {userName.trim() ? `${userName}, your result` : 'Your result'}
              </p>
              <p style={{
                fontSize: 'clamp(1.4rem, 2.4vw, 2.2rem)',
                color: '#f2f1ea', fontWeight: 400, lineHeight: 1.2,
                margin: '0 0 40px', maxWidth: 420,
              }}>
                Your palate has a direction.
              </p>

              <p className="hidden md:block" style={{
                fontSize: '0.58rem', letterSpacing: '0.22em', textTransform: 'uppercase',
                color: 'rgba(242,241,234,0.35)', margin: 0,
              }}>
                Scroll to reveal
              </p>

              <button
                className="block md:hidden"
                onClick={() => setRevealForced(true)}
                style={{
                  background: 'none',
                  border: '1px solid rgba(242,241,234,0.35)',
                  padding: '11px 22px',
                  color: '#f2f1ea', fontFamily: 'inherit',
                  fontSize: '0.65rem', letterSpacing: '0.22em',
                  textTransform: 'uppercase', cursor: 'pointer',
                }}
              >
                Reveal my archetype →
              </button>
            </motion.div>
          </div>

          {/* Scroll-to-fine-tune hint */}
          {archetypeKey === 'chocolate' && (
            <div style={{
              position: 'absolute',
              bottom: 'clamp(18px, 3.5vh, 36px)', left: 0, right: 0,
              display: 'flex', justifyContent: 'center',
              zIndex: 15,
              opacity: showScrollHint ? 1 : 0,
              transition: 'opacity 1.4s ease',
              pointerEvents: 'none',
            }}>
              <p style={{
                fontSize: '0.48rem', letterSpacing: '0.3em', textTransform: 'uppercase',
                color: '#9a2918', opacity: 0.38, margin: 0,
              }}>
                SCROLL TO FINE-TUNE ↓
              </p>
            </div>
          )}

        </div>
      </div>

      {/* ── SCREEN 2: BLOOM DIAL ─────────────────────────────────────────────── */}
      {archetypeKey === 'chocolate' && (
        <div
          ref={screen2Ref}
          style={{
            minHeight: '100vh',
            backgroundColor: '#f2f1ea',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'clamp(48px, 8vh, 80px) clamp(24px, 6vw, 60px)',
            opacity: screen2Visible ? 1 : 0,
            transform: screen2Visible ? 'translateY(0)' : 'translateY(24px)',
            transition: 'opacity 0.7s ease, transform 0.7s ease',
          }}
        >
          <BloomDial visible={true} />
        </div>
      )}

    </div>
  );
}
