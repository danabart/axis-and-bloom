import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { saveQuizResult, getUserProfile } from '../lib/api';

const RUST = '#a33726';

// ─── Logo / dial asset ───────────────────────────────────────────────────────

import logoLinesSvg from '../../design/LOGO/LogoLines.svg';

// ─── Archetype asset imports ──────────────────────────────────────────────────

import wallpaperFloral       from '../../design/IMAGES/archetypes/Floral.jpg';
import wallpaperFruity       from '../../design/IMAGES/archetypes/Fruity.jpg';
import wallpaperBalanced     from '../../design/IMAGES/archetypes/Balanced-&-Sweet.jpg';
import wallpaperChocolate    from '../../design/IMAGES/archetypes/Chocolate&NUTTY.svg';
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

// ─── Static question images (keyed by q_number) ───────────────────────────────

const QUESTION_IMAGES: Record<number, string> = {
  1: 'https://i.imgur.com/NQRCzNU.jpeg',
  2: 'https://i.imgur.com/k2KrVf1.jpeg',
  3: 'https://i.imgur.com/ahLdfc7.jpeg',
  4: 'https://i.imgur.com/S46KQYC.jpeg',
};

// ─── Archetype key + name→key mapping ────────────────────────────────────────

type ArchetypeKey = 'floral' | 'fruity' | 'balanced' | 'chocolate' | 'earthy' | 'experimental';

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
      { name: 'Colombia Anaerobic Natural',   flavor: 'Fermented Mango, Passionfruit, Wine', match: '95%' },
      { name: 'Ethiopia Carbonic Maceration', flavor: 'Kombucha, Hibiscus, Blueberry',       match: '88%' },
    ],
  },
};

// ─── Body levels — Chocolate & Nutty, Body dimension ─────────────────────────

const BODY_LEVELS = [
  {
    id: 'gentle',
    label: 'Gentle',
    description: 'Lighter and more delicate in body.',
    coffee: 'Guatemala Huehuetenango',
    bestBrew: 'Pour Over',
    alsoBrew: 'Drip Coffee',
  },
  {
    id: 'rounded',
    label: 'Rounded',
    description: 'Smooth and balanced.',
    coffee: 'Brazil Los Santos',
    bestBrew: 'Drip Coffee',
    alsoBrew: 'Cold Brew',
  },
  {
    id: 'structured',
    label: 'Structured',
    description: 'More defined and grounded.',
    coffee: '6-Bean Espresso Blend',
    bestBrew: 'Espresso',
    alsoBrew: 'French Press',
  },
  {
    id: 'full',
    label: 'Full',
    description: 'Richer and more substantial.',
    coffee: 'Sumatra Mandheling',
    bestBrew: 'French Press',
    alsoBrew: 'Drip Coffee',
  },
  {
    id: 'deep',
    label: 'Deep',
    description: 'Dense, weighty, and lingering.',
    coffee: 'Bali Kintamani',
    bestBrew: 'French Press',
    alsoBrew: 'Cold Brew',
  },
] as const;

type BodyLevel = typeof BODY_LEVELS[number];

const N_BODY = BODY_LEVELS.length;   // 5
const SNAP_DEG = 360 / N_BODY;       // 72°

// ─── BloomDial ────────────────────────────────────────────────────────────────

function BloomDial({ onReveal }: { onReveal: (level: BodyLevel) => void }) {
  const [dialAngle, setDialAngle]     = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [isDragging, setIsDragging]   = useState(false);
  const [isSnapping, setIsSnapping]   = useState(false);

  const wheelRef     = useRef<HTMLDivElement>(null);
  const dialAngleRef = useRef(0);
  const dragRef      = useRef({ startPA: 0, startDA: 0, active: false });
  const snapTimeout  = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const snapped = Math.round(n / SNAP_DEG) * SNAP_DEG % 360;
    const idx     = Math.round(n / SNAP_DEG) % N_BODY;
    dialAngleRef.current = snapped;
    setDialAngle(snapped);
    setSelectedIdx(idx);
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

  const level = selectedIdx !== null ? BODY_LEVELS[selectedIdx] : null;

  const wheelT = reducedMotion ? 'none'
    : isDragging ? 'none'
    : isSnapping ? 'transform 0.35s cubic-bezier(0.34, 1.4, 0.64, 1)'
    : 'transform 0.08s ease-out';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', width: '100%', height: '100%',
      padding: 'clamp(24px, 4vh, 52px) clamp(20px, 3vw, 48px)',
    }}>

      {/* Eyebrow */}
      <p style={{
        fontSize: '0.50rem', letterSpacing: '0.34em', textTransform: 'uppercase',
        color: '#a54c2d', opacity: 0.45, margin: '0 0 10px', textAlign: 'center',
      }}>
        YOUR BLOOM DIAL
      </p>

      {/* Heading */}
      <p style={{
        fontSize: 'clamp(0.80rem, 0.96vw, 0.96rem)',
        color: '#a54c2d', margin: '0 0 8px', lineHeight: 1.3,
        textAlign: 'center', fontWeight: 400,
      }}>
        Personalize your Chocolate &amp; Nutty match
      </p>

      {/* Supporting line */}
      <p style={{
        fontSize: 'clamp(0.63rem, 0.74vw, 0.73rem)',
        color: '#9a2918', opacity: 0.36, margin: '0 0 16px', lineHeight: 1.65,
        textAlign: 'center', maxWidth: 'clamp(220px, 26vw, 360px)',
      }}>
        Adjust the body of your match to find the expression that feels most like you.
      </p>

      {/* Dimension label */}
      <p style={{
        fontSize: '0.48rem', letterSpacing: '0.30em', textTransform: 'uppercase',
        color: '#a54c2d', opacity: 0.38, margin: '0 0 20px', textAlign: 'center',
      }}>
        DIMENSION: BODY
      </p>

      {/* Dial + fixed indicator */}
      <div style={{ position: 'relative', marginBottom: 20 }}>
        {/* Fixed pointer chevron */}
        <div style={{
          position: 'absolute', top: -15, left: '50%',
          transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: '8px solid #a54c2d',
          zIndex: 2,
        }} />

        {/* Rotating logo */}
        <div
          ref={wheelRef}
          style={{
            width: 'clamp(220px, 24vw, 360px)',
            height: 'clamp(220px, 24vw, 360px)',
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

      {/* Level label + description */}
      <div style={{ textAlign: 'center', minHeight: 54, marginBottom: 22 }}>
        {level ? (
          <>
            <p style={{
              fontSize: '0.68rem', letterSpacing: '0.22em', textTransform: 'uppercase',
              color: '#a54c2d', margin: '0 0 5px',
            }}>
              {level.label}
            </p>
            <p style={{
              fontSize: 'clamp(0.68rem, 0.80vw, 0.78rem)',
              color: '#9a2918', opacity: 0.46, lineHeight: 1.6, margin: 0,
              maxWidth: 'clamp(190px, 22vw, 320px)',
            }}>
              {level.description}
            </p>
          </>
        ) : (
          <p style={{
            fontSize: '0.55rem', letterSpacing: '0.20em', textTransform: 'uppercase',
            color: '#9a2918', opacity: 0.24, margin: 0,
          }}>
            Drag to explore
          </p>
        )}
      </div>

      {/* Reveal button */}
      <button
        onClick={() => level && onReveal(level)}
        disabled={!level}
        style={{
          background: level ? '#a54c2d' : 'transparent',
          border: `1px solid ${level ? '#a54c2d' : 'rgba(165,76,45,0.18)'}`,
          color: level ? '#f2f1ea' : 'rgba(165,76,45,0.22)',
          padding: '13px 26px',
          fontFamily: 'inherit',
          fontSize: '0.54rem',
          letterSpacing: '0.28em',
          textTransform: 'uppercase',
          cursor: level ? 'pointer' : 'not-allowed',
          transition: 'opacity 0.2s',
        }}
        onMouseEnter={e => { if (level) e.currentTarget.style.opacity = '0.80'; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
      >
        SEE YOUR PERSONALIZED COFFEE
      </button>
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
  const [showTieInterstitial, setShowTieInterstitial] = useState(false);

  // API state
  const [questions, setQuestions] = useState<ApiQuestion[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Returning user state
  const [userProfile, setUserProfile]       = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Reveal state (curtain)
  const [revealProgress, setRevealProgress] = useState(0);
  const [revealForced, setRevealForced]     = useState(false);
  const revealContainerRef = useRef<HTMLDivElement>(null);

  // Coffee reveal (from Bloom Dial)
  const [revealedLevel, setRevealedLevel] = useState<BodyLevel | null>(null);

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
      setRevealedLevel(null);
    }
  }, [isComplete]);

  // Scroll-driven reveal — active only on the result page
  useEffect(() => {
    if (!isComplete) return;

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

      // Tie detected — show interstitial before branch or result
      if (score.tieDetected && score.tiedArchetypes.length >= 2) {
        setShowTieInterstitial(true);
        return;
      }

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
    setShowTieInterstitial(false);
    setArchetypeKey('balanced');
    setRevealProgress(0);
    setRevealForced(false);
    setRevealedLevel(null);
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

  // ── Tie interstitial ─────────────────────────────────────────────────────────
  if (showTieInterstitial && scoreData) {
    const archetypeNameMap: Record<string, string> = {
      floral: 'Floral', fruity: 'Fruity', balanced: 'Balanced & Sweet',
      chocolate: 'Chocolate & Nutty', spicy: 'Spicy & Earthy', experimental: 'Experimental',
    };
    const tiedNames = (scoreData.tiedArchetypes ?? [])
      .map((k) => archetypeNameMap[k.toLowerCase()] ?? k);

    const tiedParam = (scoreData.tiedArchetypes ?? []).join(',');

    return (
      <div className="relative w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-[#a33726] mb-3">A perfect tie</p>
            <h2 className="text-3xl font-thin text-stone-800 leading-snug">
              {tiedNames.length === 2
                ? <>{tiedNames[0]} <span className="text-stone-400">&</span> {tiedNames[1]}</>
                : tiedNames.join(' · ')}
            </h2>
            <p className="text-stone-500 mt-4 text-sm leading-relaxed">
              Your palate sits at the edge of two worlds. Liam, our coffee sommelier, can help you find exactly where you land.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => {
                window.location.href = `/sommelier?entry=quiz_tie&tied=${encodeURIComponent(tiedParam)}`;
              }}
              className="w-full py-3 rounded-lg text-white text-sm tracking-wide"
              style={{ backgroundColor: RUST }}
            >
              Talk to Liam →
            </button>
            <button
              onClick={() => {
                setShowTieInterstitial(false);
                if (user) {
                  saveQuizResult({ archetype: scoreData.archetype, scores: scoreData.scores, answers, decaf: false })
                    .catch(console.error);
                }
                setIsComplete(true);
              }}
              className="w-full py-3 rounded-lg text-sm text-stone-600 border border-stone-200 hover:bg-stone-100"
            >
              See my primary result
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ── Results screen ───────────────────────────────────────────────────────────
  //
  // 200vh scroll container · 100vh sticky
  // Curtain = full-screen wallpaper that slides up as user scrolls (translateY 0→-100%)
  // After curtain clears: Bloom Dial (left) + Bag + archetype text (right) — stable, no further scroll
  //

  const curtainProgress = revealForced ? 1 : revealProgress;
  const curtainY        = curtainProgress * 100;
  const curtainTextAlpha = Math.max(0, 1 - curtainProgress * 5);
  const curtainTransition = revealForced
    ? 'transform 1.1s cubic-bezier(0.16, 1, 0.3, 1)'
    : 'none';

  return (
    <div style={{ backgroundColor: '#f2f1ea', minHeight: '100vh' }}>

      {/* ── Scroll container (200vh) ─────────────────────────────────────────── */}
      <div ref={revealContainerRef} style={{ position: 'relative', height: '200vh' }}>
        <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>

          {/* ── BASE LAYER — reveal layout ──────────────────────────────────── */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundColor: '#f2f1ea',
            display: 'flex',
          }}>

            {/* Left column — Bloom Dial */}
            <div style={{
              width: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRight: '1px solid rgba(165,76,45,0.07)',
            }}>
              {archetypeKey === 'chocolate' ? (
                <BloomDial onReveal={setRevealedLevel} />
              ) : (
                // Placeholder for other archetypes — shows archetype description
                <div style={{
                  padding: 'clamp(32px, 5vw, 72px)',
                  maxWidth: 420,
                }}>
                  <p style={{
                    fontSize: '0.50rem', letterSpacing: '0.32em', textTransform: 'uppercase',
                    color: archetype.color, opacity: 0.5, margin: '0 0 16px',
                  }}>
                    YOUR PROFILE
                  </p>
                  <p style={{
                    fontSize: 'clamp(0.72rem, 0.84vw, 0.82rem)',
                    color: '#9a2918', opacity: 0.48, lineHeight: 1.75, margin: 0,
                  }}>
                    {archetype.shortDescription}
                  </p>
                </div>
              )}
            </div>

            {/* Right column — Bag + archetype text + coffee reveal */}
            <div style={{
              width: '50%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              paddingTop: 'clamp(32px, 5vh, 60px)',
              paddingBottom: 'clamp(32px, 5vh, 60px)',
              paddingLeft: 'clamp(16px, 2vw, 32px)',
              paddingRight: 'clamp(40px, 6vw, 88px)',
            }}>

              {/* Archetype label */}
              <div style={{ textAlign: 'center', marginBottom: 'clamp(14px, 2vh, 22px)' }}>
                <p style={{
                  fontSize: '0.48rem', letterSpacing: '0.32em', textTransform: 'uppercase',
                  color: archetype.color, opacity: 0.50, margin: '0 0 7px',
                }}>
                  YOUR COFFEE ARCHETYPE
                </p>
                <h1 style={{
                  fontSize: 'clamp(1.5rem, 2.2vw, 2.6rem)',
                  color: archetype.color, fontWeight: 400,
                  lineHeight: 1.0, margin: 0, letterSpacing: '-0.01em',
                }}>
                  {archetype.name}
                </h1>
              </div>

              {/* Bag */}
              <img
                src={archetype.bag}
                alt={archetype.name}
                style={{
                  maxHeight: revealedLevel
                    ? 'clamp(180px, 36vh, 42vh)'
                    : 'clamp(260px, 58vh, 64vh)',
                  maxWidth: '100%',
                  width: 'auto',
                  objectFit: 'contain',
                  display: 'block',
                  transition: 'max-height 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />

              {/* Coffee reveal panel — fades in after dial CTA */}
              <div style={{
                width: '100%',
                maxWidth: 360,
                overflow: 'hidden',
                maxHeight: revealedLevel ? 240 : 0,
                opacity: revealedLevel ? 1 : 0,
                transition: 'max-height 0.7s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.5s ease 0.25s',
                textAlign: 'center',
                marginTop: revealedLevel ? 'clamp(14px, 2.2vh, 22px)' : 0,
              }}>
                {revealedLevel && (
                  <>
                    <p style={{
                      fontSize: '0.46rem', letterSpacing: '0.30em', textTransform: 'uppercase',
                      color: archetype.color, opacity: 0.45, margin: '0 0 6px',
                    }}>
                      YOUR MATCH
                    </p>
                    <p style={{
                      fontSize: 'clamp(1.0rem, 1.4vw, 1.5rem)',
                      color: archetype.color, fontWeight: 400,
                      margin: '0 0 12px', letterSpacing: '-0.01em',
                    }}>
                      {revealedLevel.coffee}
                    </p>
                    <p style={{
                      fontSize: '0.58rem', color: '#9a2918', opacity: 0.42,
                      margin: '0 0 3px', letterSpacing: '0.04em',
                    }}>
                      Best for: {revealedLevel.bestBrew}
                    </p>
                    <p style={{
                      fontSize: '0.56rem', color: '#9a2918', opacity: 0.32,
                      margin: '0 0 20px', letterSpacing: '0.04em',
                    }}>
                      Also great for: {revealedLevel.alsoBrew}
                    </p>
                    <button
                      onClick={() => { window.location.href = '/shop'; }}
                      style={{
                        background: archetype.color,
                        border: 'none',
                        color: '#f2f1ea',
                        padding: '13px 28px',
                        fontFamily: 'inherit',
                        fontSize: '0.54rem',
                        letterSpacing: '0.28em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                        transition: 'opacity 0.2s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '0.80'; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                    >
                      BUY THIS COFFEE
                    </button>
                  </>
                )}
              </div>

            </div>
          </div>

          {/* ── CURTAIN LAYER — full-screen wallpaper, slides up on scroll ──── */}
          <div style={{
            position: 'absolute',
            top: 0, left: 0,
            width: '100%', height: '100%',
            transform: `translateY(-${curtainY}%)`,
            transition: curtainTransition,
            zIndex: 10,
            willChange: 'transform',
          }}>

            {/*
              Wallpaper — flex overflow:hidden forces the SVG to fill without
              distorting. minWidth/minHeight 100% makes the image at least as
              large as the container on every axis; auto width/height preserves
              the viewBox aspect ratio; overflow:hidden crops the excess.
              This is aspect-ratio-safe regardless of container dimensions.
            */}
            <div style={{
              position: 'absolute',
              top: 0, left: 0,
              width: '100%', height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              pointerEvents: 'none',
            }}>
              <img
                src={archetype.wallpaper}
                alt=""
                draggable={false}
                style={{
                  minWidth: '100%',
                  minHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  flexShrink: 0,
                }}
              />
            </div>

            {/* Gradient — darkens bottom for text legibility */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to top, rgba(10,6,4,0.62) 0%, rgba(10,6,4,0.08) 52%, rgba(10,6,4,0) 100%)',
            }} />

            {/* Curtain text — lower-left, fades as curtain lifts */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.3 }}
              style={{
                position: 'absolute',
                bottom: 'clamp(44px, 7.5vh, 80px)',
                left: 'clamp(44px, 5.5vw, 76px)',
                opacity: curtainTextAlpha,
                transition: 'opacity 0.15s ease',
                pointerEvents: curtainTextAlpha < 0.05 ? 'none' : 'auto',
                zIndex: 2,
              }}
            >
              <p style={{
                fontSize: '0.50rem', letterSpacing: '0.32em', textTransform: 'uppercase',
                color: 'rgba(242,241,234,0.58)', margin: '0 0 9px',
              }}>
                YOUR RESULT
              </p>

              {/* Desktop: scroll prompt */}
              <p className="hidden md:block" style={{
                fontSize: '0.46rem', letterSpacing: '0.26em', textTransform: 'uppercase',
                color: 'rgba(242,241,234,0.30)', margin: 0,
              }}>
                SCROLL TO REVEAL
              </p>

              {/* Mobile: tap button */}
              <button
                className="block md:hidden"
                onClick={() => setRevealForced(true)}
                style={{
                  background: 'none',
                  border: '1px solid rgba(242,241,234,0.32)',
                  padding: '10px 20px',
                  color: 'rgba(242,241,234,0.75)',
                  fontFamily: 'inherit',
                  fontSize: '0.58rem',
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  marginTop: 2,
                }}
              >
                TAP TO REVEAL
              </button>
            </motion.div>
          </div>

        </div>
      </div>

    </div>
  );
}
