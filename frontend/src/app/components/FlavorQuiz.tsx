import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { saveQuizResult, getUserProfile, getDialPosition, setDialPosition, logQuizFunnelEvent, subscribeNewsletter } from '../lib/api';
import { trackEvent, trackLead } from '../lib/analytics';
import { PostQuizEmailGate } from './PostQuizEmailGate';
import { ArchetypeSection, computeDefaultSortOrder } from './bloom/ArchetypeSection';
import { CompareOverlay } from './bloom/CompareOverlay';
import type { BloomDialHandle } from './BloomDialWidget';
import type { ArchetypeData, Slot } from './bloom/types';
import { slotKey } from './bloom/types';

const RUST = '#a33726';

// ─── Archetype asset imports ──────────────────────────────────────────────────

import { archetypeAssets, patternAssets, quizAssets } from '../../design/assets';

const wallpaperFloral       = archetypeAssets.floral.wallpaper.src;
const wallpaperFruity       = archetypeAssets.fruity.wallpaper.src;
const wallpaperBalanced     = archetypeAssets['balanced-sweet'].wallpaper.src;
const wallpaperChocolate    = archetypeAssets['chocolate-nutty'].wallpaper.src;
const wallpaperEarthy       = archetypeAssets['spicy-earthy'].wallpaper.src;
const wallpaperExperimental = archetypeAssets.experimental.wallpaper.src;

const bagFloral          = archetypeAssets.floral.bag.src;
const bagFruity          = archetypeAssets.fruity.bag.src;
const bagBalanced        = archetypeAssets['balanced-sweet'].bag.src;
const bagChocolate       = archetypeAssets['chocolate-nutty'].bag.src;
const bagEarthy          = archetypeAssets['spicy-earthy'].bag.src;
const bagExperimental    = archetypeAssets.experimental.bag.src;

const coffeePic10   = quizAssets.coffeeLarge.src;
const patternTissue = patternAssets.experimental.src;
const patternSheet  = patternAssets['balanced-sweet'].src;
const patternLeafL  = patternAssets['spicy-earthy'].src;
const patternLeafR  = patternAssets.fruity.src;
const q1Photo = quizAssets.pic1.src;
const q2Photo = quizAssets.pic2.src;
const q3Photo = quizAssets.pic3.src;
const q4Photo = quizAssets.pic4.src;
const q5Photo = quizAssets.pic5.src;
const q6Photo = quizAssets.pic6.src;

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

// ─── Minimal quiz chrome ──────────────────────────────────────────────────────

function QuizHeader() {
  const { user } = useAuth();
  const navigate = useNavigate();
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 clamp(20px, 3.5vw, 48px)',
      height: 52,
      pointerEvents: 'none',
    }}>
      <a href="/" style={{
        fontFamily: 'inherit', fontSize: '0.52rem', letterSpacing: '0.28em',
        textTransform: 'uppercase', color: '#9a2918', opacity: 0.6,
        textDecoration: 'none', pointerEvents: 'auto',
      }}>
        AXIS &amp; BLOOM
      </a>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', pointerEvents: 'auto' }}>
        {!user && (
          <a href="/sign-in" style={{
            fontFamily: 'inherit', fontSize: '0.50rem', letterSpacing: '0.24em',
            textTransform: 'uppercase', color: '#9a2918', opacity: 0.40,
            textDecoration: 'none',
          }}>
            SAVE PROGRESS
          </a>
        )}
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            fontFamily: 'inherit', fontSize: '0.50rem', letterSpacing: '0.24em',
            textTransform: 'uppercase', color: '#9a2918', opacity: 0.45,
          }}
        >
          EXIT ×
        </button>
      </div>
    </div>
  );
}

// ─── Step 04 (A2): quiet status line above the unlocked sections ─────────────
// Either the signed-in one-line consent note (shown once, only when they weren't
// already a subscriber) or the recognized-guest masked-email line — never both.

function GateStatusNote({ showSignedInConsentNote, guestMaskedEmail }: {
  showSignedInConsentNote: boolean;
  guestMaskedEmail: string | null;
}) {
  if (!showSignedInConsentNote && !guestMaskedEmail) return null;
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 24px 0', textAlign: 'center' }}>
      <p style={{
        fontFamily: "'Lato', Arial, sans-serif",
        fontSize: '0.78rem',
        color: '#838686',
        margin: 0,
      }}>
        {guestMaskedEmail
          ? `Your match is on its way to ${guestMaskedEmail}.`
          : "You're on the list — we'll follow up with more on your match. Unsubscribe anytime."}
      </p>
    </div>
  );
}

// ─── Step 04b (FIX 1): free Section 1 reveal — curtain, name, bag, one-line
// description. Renders unconditionally as soon as the archetype is known (no
// wait on the archetypesList fetch that gates Sections 2-3), above the email
// gate. Restores the "gift-unwrap" identity moment the step-04 deploy had
// accidentally removed from the wrap-sequence results path (the path every
// real quiz completion takes) by wrapping the whole reveal in the email gate.

function Section1Reveal({ name, wallpaper, bag, description }: {
  name: string;
  wallpaper: string;
  bag: string;
  description: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: 'relative',
        minHeight: '64vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center',
        padding: 'clamp(48px, 8vh, 96px) clamp(24px, 5vw, 64px)',
        backgroundColor: '#0a0604',
        backgroundImage: `url(${wallpaper})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to top, rgba(10,6,4,0.66) 0%, rgba(10,6,4,0.28) 60%, rgba(10,6,4,0.12) 100%)',
      }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <img
          src={bag}
          alt={`${name} bag`}
          width={140} height={175}
          style={{ maxWidth: 140, width: '100%', margin: '0 auto 24px', display: 'block', filter: 'drop-shadow(0 18px 44px rgba(0,0,0,0.4))' }}
        />
        <p style={{
          fontSize: '0.5rem', letterSpacing: '0.32em', textTransform: 'uppercase',
          color: 'rgba(242,241,234,0.6)', margin: '0 0 9px',
        }}>
          YOUR COFFEE ARCHETYPE
        </p>
        <h1 style={{
          fontSize: 'clamp(2.4rem, 4.4vw, 4.6rem)', color: '#f2f1ea', fontWeight: 400,
          lineHeight: 1.0, margin: '0 0 20px', letterSpacing: '-0.01em',
        }}>
          {name}
        </h1>
        <p style={{
          fontSize: 'clamp(0.82rem, 0.95vw, 0.95rem)', color: 'rgba(242,241,234,0.82)',
          lineHeight: 1.75, margin: '0 auto', maxWidth: 480,
        }}>
          {description}
        </p>
      </div>
    </motion.div>
  );
}

// ─── Ruler-tick progress ──────────────────────────────────────────────────────

function ProgressTicks({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 44 }}>
      {Array.from({ length: total }, (_, i) => {
        const isCurrent = i === current - 1;
        const isDone    = i < current - 1;
        return (
          <div key={i} style={{
            width: 1,
            height: isCurrent ? 18 : 9,
            backgroundColor: isCurrent ? '#9a2918' : isDone ? '#a94936' : '#c5c7c8',
            transition: 'all 0.3s ease',
          }} />
        );
      })}
    </div>
  );
}

// ─── Wrap sequence (papers close → text → papers part) ───────────────────────

function WrapSequence({ name, onComplete }: { name: string; onComplete: () => void }) {
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [tissueIn, setTissueIn]   = useState(false);
  const [sheetIn,  setSheetIn]    = useState(false);
  const [leafRIn,  setLeafRIn]    = useState(false);
  const [leafLIn,  setLeafLIn]    = useState(false);
  const [wrapLine, setWrapLine]   = useState('');
  const [showText, setShowText]   = useState(false);

  useEffect(() => {
    const label = name ? `Wrapping ${name}'s profile…` : 'Wrapping your profile…';

    if (reducedMotion) {
      setTissueIn(true); setSheetIn(true); setLeafRIn(true); setLeafLIn(true);
      const timers = [
        setTimeout(() => { setWrapLine(label); setShowText(true); }, 300),
        setTimeout(() => setWrapLine('Choosing your coffee…'), 900),
        setTimeout(() => setShowText(false), 1400),
        setTimeout(() => { setTissueIn(false); setSheetIn(false); setLeafRIn(false); setLeafLIn(false); }, 1700),
        setTimeout(onComplete, 1900),
      ];
      return () => timers.forEach(clearTimeout);
    }

    const t = (ms: number, fn: () => void) => setTimeout(fn, ms);
    const timers = [
      t(100,  () => setTissueIn(true)),
      t(650,  () => setSheetIn(true)),
      t(1200, () => setLeafRIn(true)),
      t(1450, () => setLeafLIn(true)),
      t(2500, () => { setWrapLine(label); setShowText(true); }),
      t(4000, () => setWrapLine('Choosing your coffee…')),
      t(5400, () => setShowText(false)),
      t(5800, () => setLeafLIn(false)),
      t(6060, () => setLeafRIn(false)),
      t(6500, () => setSheetIn(false)),
      t(6950, () => setTissueIn(false)),
      t(8100, onComplete),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const tx = reducedMotion ? 'opacity 0.4s ease' : 'transform 1s cubic-bezier(.22,1,.36,1)';
  const op = (v: boolean) => reducedMotion ? (v ? 1 : 0) : 1;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, overflow: 'hidden' }}>
      {/* tissue — experimental, rises from bottom */}
      <div style={{
        position: 'absolute', top: '-4%', bottom: 0, left: 0, right: 0,
        backgroundImage: `url(${patternTissue})`, backgroundSize: '1250px', backgroundPosition: '60% 40%',
        transform: tissueIn ? 'translateY(0)' : 'translateY(112%)',
        opacity: op(tissueIn), transition: tx, willChange: 'transform',
      }} />
      {/* sheet — balanced, slightly offset */}
      <div style={{
        position: 'absolute', top: '-5%', bottom: 0, left: 0, right: 0,
        backgroundImage: `url(${patternSheet})`, backgroundSize: '1250px', backgroundPosition: '40% 15%',
        transform: sheetIn ? 'translate(0,0)' : 'translate(-6%,114%)',
        opacity: op(sheetIn), transition: tx, willChange: 'transform',
      }} />
      {/* right leaf — fruity */}
      <div style={{
        position: 'absolute', top: '-6%', bottom: '-6%', right: '-4%', width: '60%',
        backgroundImage: `url(${patternLeafR})`, backgroundSize: '1250px', backgroundPosition: '78% 62%',
        clipPath: 'polygon(7% 0,100% 0,100% 100%,0 100%)',
        boxShadow: '-14px 0 34px -10px rgba(20,12,8,.4)',
        transform: leafRIn ? 'translate(0,0) rotate(0deg)' : 'translate(116%,-22%) rotate(12deg)',
        opacity: op(leafRIn), transition: tx, willChange: 'transform',
      }} />
      {/* left leaf — spicy */}
      <div style={{
        position: 'absolute', top: '-6%', bottom: '-6%', left: '-4%', width: '62%',
        backgroundImage: `url(${patternLeafL})`, backgroundSize: '1250px', backgroundPosition: '12% 30%',
        clipPath: 'polygon(0 0,100% 0,93% 100%,0 100%)',
        boxShadow: '14px 0 34px -10px rgba(20,12,8,.45)',
        transform: leafLIn ? 'translate(0,0) rotate(0deg)' : 'translate(-118%,-26%) rotate(-13deg)',
        opacity: op(leafLIn), transition: tx, willChange: 'transform',
      }} />
      {/* wrap text */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 5,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: showText ? 1 : 0, transition: 'opacity 0.5s ease', pointerEvents: 'none',
      }}>
        <p style={{
          color: '#f2f1ea', fontSize: 'clamp(20px,2vw,28px)',
          letterSpacing: '0.04em', textShadow: '0 2px 14px rgba(0,0,0,.35)',
          fontFamily: 'inherit',
        }}>
          {wrapLine}
        </p>
      </div>
    </div>
  );
}

// ─── Pink keyword per question (one word gets the highlight device) ───────────

const Q_HIGHLIGHTS: Record<number, string> = {
  1: 'relationship',
  2: 'good',
  3: 'reaction',
  4: 'bother',
  5: 'honest',
  6: 'grab',
};

const BRANCH_HIGHLIGHT = 'best';

function highlightQuestion(text: string, keyword: string): React.ReactNode {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ background: '#ee5974', color: '#f2f1ea', padding: '1px 8px' }}>
        {text.slice(idx, idx + keyword.length)}
      </span>
      {text.slice(idx + keyword.length)}
    </>
  );
}

// ─── Static question images (keyed by q_number) ───────────────────────────────

const QUESTION_IMAGES: Record<number, string> = {
  1: q1Photo,
  2: q2Photo,
  3: q3Photo,
  4: q4Photo,
  5: q5Photo,
  6: q6Photo,
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

// This quiz's local ArchetypeKey ('balanced'/'chocolate'/'earthy') is a shorthand
// that predates the archetype_enum used by /api/coffees/archetypes and everywhere
// else server-side ('balanced_sweet'/'chocolate_nutty'/'earthy') — see the same
// naming mismatch already documented and fixed in backend/src/routes/users.ts.
// Needed to look up this screen's just-scored archetype in that endpoint's data.
const ARCHETYPE_KEY_TO_ENUM: Record<ArchetypeKey, string> = {
  floral: 'floral',
  fruity: 'fruity',
  balanced: 'balanced_sweet',
  chocolate: 'chocolate_nutty',
  earthy: 'earthy',
  experimental: 'experimental',
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
    name: 'Earthy',
    color: '#912f2f',
    wallpaper: wallpaperEarthy,
    bag: bagEarthy,
    shortDescription: 'Warm, deep, and complex. Earthy coffees bring a more grounded sensory world, with notes that may suggest spice, wood, herbs, smoke, or lingering depth.',
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function FlavorQuiz() {
  // ── Preview shortcut: /find-my-flavor?result=floral (or any archetype key) ──
  const [searchParams] = useSearchParams();
  const _previewParam  = searchParams.get('result') ?? '';
  const isPreview      = _previewParam in ARCHETYPES;
  const previewKey     = isPreview ? (_previewParam as ArchetypeKey) : null;

  // Step 02 (B1): per-quiz-session key for first-party funnel logging
  // (quiz_start / quiz_complete), in-memory only — new on every mount/retake.
  const sessionKeyRef = useRef<string>();
  if (!sessionKeyRef.current) sessionKeyRef.current = crypto.randomUUID();
  const quizStartFiredRef = useRef(false);

  const [hasStarted, setHasStarted]     = useState(() => isPreview);
  const [userName, setUserName]         = useState('');
  const [currentStep, setCurrentStep]   = useState(0);
  const [isWrapping, setIsWrapping]     = useState(false);
  const fromWrapRef                     = useRef(false);
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

  // Returning-user screen — embedded ArchetypeSection (Find My Flavor Part 1)
  const [archetypesList, setArchetypesList]     = useState<ArchetypeData[]>([]);
  const [experimentalData, setExperimentalData] = useState<ArchetypeData | null>(null);
  const [matchedSortOrder, setMatchedSortOrder] = useState<number | null>(null);
  const [revealedKeys, setRevealedKeys]         = useState<Set<string>>(new Set());
  const matchedDialRef = useRef<BloomDialHandle | null>(null);
  const [compareState, setCompareState] = useState<{ open: boolean; archetype: string; archetypeLabel: string; slot: Slot | null }>({
    open: false, archetype: '', archetypeLabel: '', slot: null,
  });

  // Just-scored results screen — separate ArchetypeSection instance/state from the
  // returning-user screen above (Find My Flavor Part 2). Kept independent per the
  // spec's own caution, even though the two screens are unlikely to both be mounted
  // at once today.
  const [resultsSortOrder, setResultsSortOrder] = useState<number | null>(null);
  const [resultsRevealedKeys, setResultsRevealedKeys] = useState<Set<string>>(new Set());
  const resultsDialRef = useRef<BloomDialHandle | null>(null);
  const [resultsCompareState, setResultsCompareState] = useState<{ open: boolean; archetype: string; archetypeLabel: string; slot: Slot | null }>({
    open: false, archetype: '', archetypeLabel: '', slot: null,
  });

  const { user } = useAuth();
  const { addToCart } = useCart();
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

  // profileFetchDone (Profile Part 1's ?retake=1 handler needs this): distinct
  // from profileLoading, whose *initial* value is already `false` before this
  // effect's own `setProfileLoading(true)` has been committed — a same-tick
  // reader (another effect scheduled in this same render pass) sees the stale
  // pre-fetch `false` and misreads it as "already loaded". profileFetchDone
  // starts `false` and only ever flips true once, after the fetch truly settles.
  const [profileFetchDone, setProfileFetchDone] = useState(false);
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
      .finally(() => { setProfileLoading(false); setProfileFetchDone(true); });
  }, [user]);

  // Find My Flavor Part 3: refresh the signed-in user's profile (specifically
  // matchedArchetypeId, which feeds the compatibility badge as `userArchetype`)
  // right after a quiz result is saved. Without this, userProfile only ever
  // refetches once per `user` reference — never after a same-session quiz
  // retake — so a freshly-scored archetype's own compatibility badge could
  // read against the *previous* match (real repro: retook Balanced & Sweet ->
  // Floral, the one authored adjacency pair, and saw "Worth exploring" instead
  // of "In your wheelhouse" on Floral's own just-scored section, self-healing
  // only after a full page reload — confirmed a pure stale-state bug, not a
  // backend race, since the reload immediately showed the correct badge).
  function refreshUserProfile() {
    if (!user) return;
    getUserProfile().then(setUserProfile).catch(() => {});
  }

  // Archetype catalogue for the embedded ArchetypeSection — used by the returning-user
  // screen (signed-in only) and the just-scored results screen below. The latter is
  // reached by guests too (most quiz-takers), so this fetch must NOT be gated on `user`
  // (Find My Flavor Part 2 — this was the exact bug: previously `if (!user) return`).
  useEffect(() => {
    fetch('/api/coffees/archetypes')
      .then(r => r.json())
      .then((data: ArchetypeData[]) => setArchetypesList(data))
      .catch(() => {});

    // Experimental is excluded from GET /archetypes (it's a category, not one of the
    // 5 real archetypes — see coffees.ts) and presented via its own endpoint, same as
    // /bloom (BloomPage.tsx) does.
    fetch('/api/coffees/experimental')
      .then(r => r.json())
      .then((data: ArchetypeData) => setExperimentalData(data))
      .catch(() => {});
  }, []);

  const matchedArchetypeId = userProfile?.archetype?.id ?? null;
  const matchedData = matchedArchetypeId
    ? archetypesList.find(a => a.archetype === matchedArchetypeId) ?? null
    : null;

  // This screen's just-scored archetype, looked up by archetype_enum rather than
  // reused from `matchedData` — `matchedData` is the signed-in user's previously
  // *saved* profile match, which may lag behind (or not exist for) what they just
  // scored on this attempt, and is never populated for guests at all.
  const resultsArchetypeEnum = ARCHETYPE_KEY_TO_ENUM[archetypeKey];
  const resultsArchetypeData = resultsArchetypeEnum === 'experimental'
    ? experimentalData
    : archetypesList.find(a => a.archetype === resultsArchetypeEnum) ?? null;

  // Pre-set the dial to the signed-in user's saved position for this archetype (mirrors BloomPage.tsx Phase D).
  useEffect(() => {
    if (!user || !matchedData) return;
    getDialPosition(matchedData.archetype)
      .then(r => { if (r?.dialSortOrder != null) setMatchedSortOrder(r.dialSortOrder); })
      .catch(() => {});
  }, [user, matchedData?.archetype]);

  function handleMatchedDialSelect(archetype: string, dialSortOrder: number) {
    setMatchedSortOrder(dialSortOrder);
    if (user) setDialPosition(archetype, dialSortOrder).catch(() => {});
  }

  function toggleMatchedReveal(key: string) {
    setRevealedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleMatchedHopClick(archetype: string, dialSortOrder: number) {
    matchedDialRef.current?.rotateTo(dialSortOrder);
    setRevealedKeys(prev => new Set(prev).add(slotKey(archetype, dialSortOrder)));
  }

  function openMatchedCompare(archetype: string, archetypeLabel: string, slot: Slot) {
    setCompareState({ open: true, archetype, archetypeLabel, slot });
  }

  function registerMatchedDialRef(_archetype: string, handle: BloomDialHandle | null) {
    matchedDialRef.current = handle;
  }

  // Pre-set the results screen's dial to the signed-in user's saved position for the
  // just-scored archetype (mirrors the returning-user screen's own effect above).
  useEffect(() => {
    if (!user || !resultsArchetypeData) return;
    getDialPosition(resultsArchetypeData.archetype)
      .then(r => { if (r?.dialSortOrder != null) setResultsSortOrder(r.dialSortOrder); })
      .catch(() => {});
  }, [user, resultsArchetypeData?.archetype]);

  function handleResultsDialSelect(archetype: string, dialSortOrder: number) {
    setResultsSortOrder(dialSortOrder);
    if (user) setDialPosition(archetype, dialSortOrder).catch(() => {});
  }

  function toggleResultsReveal(key: string) {
    setResultsRevealedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleResultsHopClick(archetype: string, dialSortOrder: number) {
    resultsDialRef.current?.rotateTo(dialSortOrder);
    setResultsRevealedKeys(prev => new Set(prev).add(slotKey(archetype, dialSortOrder)));
  }

  function openResultsCompare(archetype: string, archetypeLabel: string, slot: Slot) {
    setResultsCompareState({ open: true, archetype, archetypeLabel, slot });
  }

  function registerResultsDialRef(_archetype: string, handle: BloomDialHandle | null) {
    resultsDialRef.current = handle;
  }

  // ── Step 04 (A2): firm email gate ──────────────────────────────────────────
  // Sections 2-3 (the ArchetypeSection below the curtain — dial, position card,
  // "why"/coffees in RevealedPanel) unlock only after email capture. Section 1
  // (the curtain reveal itself) always renders free, above.
  //
  // Signed-in users never see the card (email already known) — handled by the
  // effect below. Guests are recognized across visits/retakes via a local flag
  // (no server-side guest session to key off of); a fresh guest sees the card
  // exactly once per browser, with no skip link and no bypass.
  const POST_QUIZ_EMAIL_KEY = 'axisbloom.postQuizEmail';
  const [postQuizEmail, setPostQuizEmail] = useState<string | null>(() => {
    try { return localStorage.getItem(POST_QUIZ_EMAIL_KEY); } catch { return null; }
  });
  const emailGateUnlocked = !!user || !!postQuizEmail;
  const signedInSubscribeFiredRef = useRef<string | null>(null); // last archetype synced
  const recognizedGuestSyncedRef = useRef<string | null>(null); // last archetype synced, avoids re-firing every render
  const [showSignedInConsentNote, setShowSignedInConsentNote] = useState(false);

  function maskEmail(raw: string): string {
    const [userPart, domain] = raw.split('@');
    if (!domain) return raw;
    const maskUser = userPart.length <= 1 ? userPart : userPart[0] + '•'.repeat(Math.min(userPart.length - 1, 4));
    const [domainName, ...rest] = domain.split('.');
    const maskDomain = domainName.length <= 1 ? domainName : domainName[0] + '•'.repeat(Math.min(domainName.length - 1, 4));
    return `${maskUser}@${maskDomain}.${rest.join('.')}`;
  }

  // First-time guest submits the card.
  function handleGateSuccess(submittedEmail: string) {
    try { localStorage.setItem(POST_QUIZ_EMAIL_KEY, submittedEmail); } catch {}
    setPostQuizEmail(submittedEmail);
    const name = ARCHETYPES[archetypeKey].name;
    trackEvent('EmailSubmitted', { archetype: name });
    trackLead({ archetype: name });
    logQuizFunnelEvent(sessionKeyRef.current!, 'email_submitted', name).catch(() => {});
  }

  // Recognized guest (local flag from a previous submit) or a retake in the same
  // session — resync the subscriber row to the current archetype, silently, no
  // card, no repeat ask, no analytics event (they already submitted once).
  useEffect(() => {
    if (!resultsArchetypeData || user || !postQuizEmail) return;
    const name = ARCHETYPES[archetypeKey].name;
    if (recognizedGuestSyncedRef.current === name) return;
    recognizedGuestSyncedRef.current = name;
    subscribeNewsletter({
      email: postQuizEmail,
      source: 'post_quiz',
      archetype: name,
      experimental: archetypeKey === 'experimental',
      confidence: scoreData?.foodSignalAlignment,
      quizSessionKey: sessionKeyRef.current,
    }).catch(() => {});
  }, [user, postQuizEmail, resultsArchetypeData, archetypeKey]);

  // Signed-in users: never see the card. Auto-subscribe (source post_quiz) with a
  // one-line consent note shown once — only when they weren't already a subscriber;
  // an existing subscriber's row is just silently resynced to the new archetype.
  useEffect(() => {
    if (!user || !resultsArchetypeData || !userProfile || !profileFetchDone) return;
    const name = ARCHETYPES[archetypeKey].name;
    if (signedInSubscribeFiredRef.current === name) return;
    signedInSubscribeFiredRef.current = name;
    const wasAlreadySubscribed = userProfile.isNewsletterSubscriber === true;
    subscribeNewsletter({
      email: userProfile.email ?? user.email ?? '',
      firstName: userProfile.firstName ?? undefined,
      source: 'post_quiz',
      archetype: name,
      experimental: archetypeKey === 'experimental',
      confidence: scoreData?.foodSignalAlignment,
      quizSessionKey: sessionKeyRef.current,
    }).then(() => {
      if (!wasAlreadySubscribed) {
        trackEvent('EmailSubmitted', { archetype: name });
        trackLead({ archetype: name });
        logQuizFunnelEvent(sessionKeyRef.current!, 'email_submitted', name).catch(() => {});
        setShowSignedInConsentNote(true);
      }
    }).catch(() => {});
  }, [user, userProfile, profileFetchDone, resultsArchetypeData, archetypeKey]);

  // Bug fix (Find My Flavor Part 2, Bug 1): preload the scored archetype's wallpaper
  // as soon as it's known (archetypeKey is set well before isComplete/the results
  // screen mounts — including during the branch question's async round trip), so by
  // the time the curtain renders the ~1MB JPG is already cached and there's no pop-in
  // even on a slow connection. Pairs with the opaque backgroundColor fallback on the
  // curtain div itself below, which covers the case this doesn't (a cold cache).
  useEffect(() => {
    const src = ARCHETYPES[archetypeKey]?.wallpaper;
    if (src) new Image().src = src;
  }, [archetypeKey]);

  useEffect(() => {
    const savedName = sessionStorage.getItem('axisBloomCustomerName');
    if (savedName) {
      setUserName(savedName);
      setHasStarted(true);
      sessionStorage.removeItem('axisBloomCustomerName');
    }
  }, []);

  // Scroll to top when result is ready so the reveal starts clean. Kept as a safety
  // net (e.g. the `?result=` preview shortcut, which sets `isComplete` from its
  // initial state rather than via a transition below), but the real fix for Bug 1's
  // retake-flash (Find My Flavor Part 2) is `resetReveal()` below, called
  // synchronously alongside `setIsComplete(true)` so both land in the same React
  // batch/paint — relying solely on this effect meant the results screen could
  // mount and paint once with a stale (non-zero) `revealProgress` left over from a
  // previous reveal, one tick before this effect corrected it.
  useEffect(() => {
    if (isComplete) {
      window.scrollTo({ top: 0 });
      setRevealProgress(0);
      setRevealForced(false);
    }
  }, [isComplete]);

  function resetReveal() {
    window.scrollTo({ top: 0 });
    setRevealProgress(0);
    setRevealForced(false);
  }

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

      trackEvent('QuizComplete', { archetype: score.archetype });
      logQuizFunnelEvent(sessionKeyRef.current!, 'quiz_complete', score.archetype).catch(() => {});

      const key = ARCHETYPE_NAME_TO_KEY[score.archetype] ?? 'balanced';
      setArchetypeKey(key);

      // Tie detected — show interstitial before branch or result
      if (score.tieDetected && (score.tiedArchetypes ?? []).length >= 2) {
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
          .then(refreshUserProfile)
          .catch(console.error);
      }
      fromWrapRef.current = true;
      setIsWrapping(true);
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
        .then(refreshUserProfile)
        .catch(console.error);
    }

    setShowBranch(false);
    fromWrapRef.current = true;
    setIsWrapping(true);
  };

  const handleRetake = () => {
    window.scrollTo({ top: 0 });
    fromWrapRef.current = false;
    setIsWrapping(false);
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
    sessionKeyRef.current = crypto.randomUUID();
    quizStartFiredRef.current = false;
  };

  // ── Auto-advance: always hold the latest handleNext in a ref so the 750ms
  //    timer fires against fresh state rather than a stale closure capture.
  const autoAdvanceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNextRef   = useRef(handleNext);
  handleNextRef.current = handleNext;

  const handleAnswerSelect = (answerId: string, answerIdx: number) => {
    if (currentStep === 0 && !quizStartFiredRef.current) {
      quizStartFiredRef.current = true;
      trackEvent('QuizStart');
      logQuizFunnelEvent(sessionKeyRef.current!, 'quiz_start').catch(() => {});
    }
    setAnswers(prev => ({ ...prev, [currentStep]: answerIdx }));
    setSelectedIds(prev => ({ ...prev, [currentStep]: answerId }));
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    autoAdvanceRef.current = setTimeout(() => handleNextRef.current(), 750);
  };

  const handleBranchAnswerSelect = (answerId: string) => {
    setSelectedBranchAnswerId(answerId);
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    autoAdvanceRef.current = setTimeout(() => {
      if (!scoreData || !branchQuestion) return;
      const selected = branchQuestion.answers.find(a => a.id === answerId);
      const finalArchetypeName = selected?.archetypeName ?? scoreData.archetype;
      const newKey = ARCHETYPE_NAME_TO_KEY[finalArchetypeName] ?? archetypeKey;
      setArchetypeKey(newKey);
      if (user) {
        saveQuizResult({ archetype: finalArchetypeName, scores: scoreData.scores, answers, decaf: false })
          .then(refreshUserProfile)
          .catch(console.error);
      }
      setShowBranch(false);
      fromWrapRef.current = true;
      setIsWrapping(true);
    }, 750);
  };

  // Profile Part 1 — `/find-my-flavor?retake=1`: a Profile link to plain
  // /find-my-flavor would strand a matched user on the returning-user screen
  // needing a second click. Reuses exactly the same reset the returning-user
  // screen's own "Retake the quiz" nav item performs (handleRetake() + name +
  // hasStarted), rather than a parallel reset. Waits for the profile fetch to
  // resolve (the name comes from it) before deciding; a guest or unmatched user
  // makes this a no-op — they already land on the name screen/quiz naturally.
  const retakeHandledRef = useRef(false);
  useEffect(() => {
    if (retakeHandledRef.current) return;
    if (searchParams.get('retake') !== '1') return;
    if (!user) return; // guest — no-op, nothing to strip yet either
    if (!profileFetchDone) return; // wait for the profile fetch to actually resolve

    retakeHandledRef.current = true;
    if (userProfile?.archetype) {
      const firstName = userProfile?.firstName ?? user.displayName?.split(' ')[0] ?? '';
      handleRetake();
      setUserName(firstName);
      setHasStarted(true);
    }
    navigate('/find-my-flavor', { replace: true });
  }, [searchParams, user, profileFetchDone, userProfile]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading && !isPreview) {
    return (
      <div className="relative w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center">
        <QuizHeader />
        <p className="text-[#a33726]/50 text-sm uppercase tracking-[0.2em]">Loading…</p>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if ((loadError || !questions.length) && !isPreview) {
    return (
      <div className="relative w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center">
        <QuizHeader />
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
          <QuizHeader />
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
      { label: 'Retake the quiz',              action: () => { handleRetake(); setUserName(firstName); setHasStarted(true); } },
      { label: 'Talk to our coffee sommelier', href: '/sommelier?entry=user_initiated' },
      { label: 'View my profile',              href: '/profile' },
      { label: 'Explore flavor intelligence',  href: '/flavor-intelligence' },
      { label: 'Create a household party',     href: '/profile?tab=family' },
    ];

    return (
      <div className="relative w-full min-h-screen bg-[#f2f1ea]">
        <QuizHeader />
        {/* Header row — profile text + nav, side by side (roughly the old two-column
            layout). Deliberately does NOT also contain ArchetypeSection: that component's
            photo/dial/bag/card row needs the full page width to render its collapsed
            PositionCard header (title + "Reveal the full profile" affordance) without the
            two colliding — measured this directly: at a 50/50 split (720px) the card
            column shrank to ~108px; even giving the nav a fixed narrow width and the rest
            to this column (1100px available) the card's commerce area was still only
            ~140px of usable content width, and "Reveal the full profile ↓" (a non-wrapping
            ~121px span) alone consumed nearly all of it, leaving the title just ~4px to
            wrap into — letter-by-letter, reading as overlapping garbled text. Since
            PositionCard/ArchetypeSection are out of scope to edit (see the prerequisite
            doc), the fix is structural: keep the nav beside the profile text (which never
            needed much width), and let ArchetypeSection render at full width below, same
            as it does on /bloom. */}
        <div className="flex flex-col lg:flex-row lg:items-start">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7 }}
            className="w-full lg:w-1/2 px-8 pt-16 pb-8 md:px-12 lg:pl-20 lg:pr-12 max-w-[520px] mx-auto lg:mx-0"
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

          {/* Nav — restyled off-photo, dark-on-cream to match the profile text beside it. */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="w-full lg:w-1/2 px-8 py-12 md:px-12 lg:pl-12 lg:pr-20"
          >
            <p className="text-[10px] uppercase tracking-[0.3em] mb-8 font-normal text-[#a33726]/30">
              Welcome back, {firstName}
            </p>
            <div className="flex flex-col w-full max-w-[360px]">
              {navItems.map(item =>
                item.href ? (
                  <Link
                    key={item.label}
                    to={item.href}
                    className="flex items-center justify-between group text-[0.95rem] font-light tracking-wide py-4 border-b border-[#a33726]/10 hover:border-[#a33726]/30 text-[#a33726]/60 hover:text-[#a33726] transition-all duration-300"
                  >
                    <span>{item.label}</span>
                    <ArrowRight size={14} className="opacity-30 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                  </Link>
                ) : (
                  <button
                    key={item.label}
                    onClick={item.action}
                    className="flex items-center justify-between group text-[0.95rem] font-light tracking-wide py-4 border-b border-[#a33726]/10 hover:border-[#a33726]/30 text-[#a33726]/60 hover:text-[#a33726] transition-all duration-300 w-full text-left"
                  >
                    <span>{item.label}</span>
                    <ArrowRight size={14} className="opacity-30 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                  </button>
                )
              )}
            </div>
          </motion.div>
        </div>

        {matchedData && (
          <ArchetypeSection
            data={matchedData}
            index={0}
            selectedSortOrder={matchedSortOrder ?? computeDefaultSortOrder(matchedData)}
            revealedKeys={revealedKeys}
            onDialSelect={handleMatchedDialSelect}
            onToggleReveal={toggleMatchedReveal}
            onAddToCart={addToCart}
            onHopClick={handleMatchedHopClick}
            onCompare={openMatchedCompare}
            userArchetype={matchedArchetypeId}
            registerDialRef={registerMatchedDialRef}
            source="find_my_flavor_returning"
          />
        )}

        <CompareOverlay
          open={compareState.open}
          onClose={() => setCompareState(s => ({ ...s, open: false }))}
          left={compareState.slot ? { archetype: compareState.archetype, archetypeLabel: compareState.archetypeLabel, slot: compareState.slot } : null}
          archetypes={archetypesList}
        />
      </div>
    );
  }

  // ── Name screen (door) ───────────────────────────────────────────────────────
  if (!hasStarted) {
    return (
      <div style={{ position: 'relative', width: '100%', minHeight: '100vh', overflow: 'hidden', background: '#f2f1ea' }}>
        <QuizHeader />
        {/* Background photo — CoffeePic10, wide chaff, full-bleed */}
        <img
          src={coffeePic10}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
        />
        {/* Left wash */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(90deg, rgba(242,241,234,.82) 0%, rgba(242,241,234,.45) 36%, rgba(242,241,234,0) 62%)',
        }} />
        {/* Top wash — keeps chrome legible */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 70,
          background: 'linear-gradient(180deg, rgba(242,241,234,.85), rgba(242,241,234,0))',
        }} />
        {/* Content anchored at ~39% viewport height */}
        <div style={{
          position: 'absolute',
          top: '39%',
          transform: 'translateY(-50%)',
          left: 'clamp(48px, 7vw, 112px)',
          maxWidth: 560,
          zIndex: 2,
        }}>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}
          >
            <h1 style={{
              fontSize: 'clamp(2.8rem, 4.2vw, 4.2rem)',
              color: '#ee5974',
              lineHeight: 1.08,
              fontWeight: 400,
              margin: '0 0 clamp(28px, 4vh, 36px)',
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
                maxWidth: 340,
                fontSize: '1.05rem',
                padding: '9px 0',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid rgba(154,41,24,0.5)',
                borderRadius: 0,
                outline: 'none',
                color: '#45474a',
                fontFamily: 'inherit',
                letterSpacing: '0.02em',
              }}
              className="placeholder-[#7b7f80] focus:border-[#ee5974]"
              onKeyDown={(e) => { if (e.key === 'Enter' && userName.trim()) setHasStarted(true); }}
            />

            <button
              onClick={() => setHasStarted(true)}
              disabled={!userName.trim()}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: userName.trim() ? '1px solid rgba(154,41,24,0.5)' : '1px solid transparent',
                padding: '0 0 3px',
                cursor: userName.trim() ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                fontSize: '0.72rem',
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
                color: '#9a2918',
                opacity: userName.trim() ? 1 : 0.3,
                transition: 'opacity 0.2s',
                marginTop: 30,
                marginBottom: 22,
              }}
            >
              Begin Profile
            </button>

            <a
              href="/sign-in"
              style={{
                fontFamily: 'inherit',
                fontSize: '0.68rem',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: '#7b7f80',
                textDecoration: 'none',
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#9a2918')}
              onMouseLeave={e => (e.currentTarget.style.color = '#7b7f80')}
            >
              Already have a profile? Sign in →
            </a>
          </motion.div>
        </div>
      </div>
    );
  }

  // ── Question screen ──────────────────────────────────────────────────────────
  if (!isComplete && !showBranch && !isWrapping) {
    const question = questions[currentStep];
    const image    = QUESTION_IMAGES[question.q_number] ?? QUESTION_IMAGES[1];
    const kw       = Q_HIGHLIGHTS[question.q_number];

    return (
      <div className="w-full min-h-screen flex flex-col lg:flex-row" style={{ background: '#f2f1ea' }}>
        <QuizHeader />

        {/* Photo panel — 46%, framed print, full image visible */}
        <div
          className="w-full lg:w-[46%] lg:h-screen flex-shrink-0 hidden lg:flex items-center justify-center"
          style={{ background: '#f2f1ea', padding: '72px 30px 22px' }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45 }}
              style={{
                border: '1px solid #c5c7c8',
                padding: 14,
                background: '#f2f1ea',
                display: 'inline-block',
              }}
            >
              <img
                src={image}
                alt=""
                style={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 126px)', width: 'auto', height: 'auto' }}
              />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Question panel — 54%, vertically centered */}
        <div
          className="w-full lg:flex-1 min-h-[60vh] lg:h-screen bg-[#f2f1ea] flex flex-col justify-center overflow-y-auto"
          style={{ paddingTop: 72, paddingBottom: 48, paddingLeft: 'clamp(36px,5vw,80px)', paddingRight: 'clamp(36px,5vw,80px)' }}
        >
          <div style={{ maxWidth: 480 }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.5 }}
              >
                <ProgressTicks current={currentStep + 1} total={7} />

                <h1 style={{
                  fontSize: 'clamp(1.7rem, 2.4vw, 2.4rem)',
                  color: '#9a2918',
                  lineHeight: 1.2,
                  fontWeight: 400,
                  margin: '0 0 clamp(28px, 3.5vh, 44px)',
                  letterSpacing: '-0.01em',
                }}>
                  {kw ? highlightQuestion(question.q_text, kw) : question.q_text}
                </h1>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {question.answers.map((answer, idx) => {
                    const isSelected = answers[currentStep] === idx;
                    return (
                      <button
                        key={answer.id}
                        onClick={() => handleAnswerSelect(answer.id, idx)}
                        style={{
                          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                          borderBottom: '1px solid rgba(69,71,74,0.12)',
                          padding: '13px 0', textAlign: 'left',
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                          fontFamily: 'inherit',
                        }}
                      >
                        <span style={{
                          display: 'block', width: 2, height: 16, marginTop: 4, flexShrink: 0,
                          backgroundColor: isSelected ? '#9a2918' : 'rgba(69,71,74,0.18)',
                          transition: 'background-color 0.2s',
                        }} />
                        <span style={{
                          fontSize: 'clamp(0.88rem, 1.0vw, 1.0rem)',
                          lineHeight: 1.55,
                          color: isSelected ? '#9a2918' : '#45474a',
                          transition: 'color 0.2s',
                        }}>
                          {answer.text}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Back + score error */}
            <div style={{ marginTop: 'clamp(28px, 3.5vh, 44px)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {currentStep > 0 && (
                <button
                  onClick={() => {
                    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
                    setCurrentStep(p => p - 1);
                  }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    fontFamily: 'inherit', fontSize: '0.55rem', letterSpacing: '0.24em',
                    textTransform: 'uppercase', color: '#9a2918', opacity: 0.38, textAlign: 'left',
                  }}
                >
                  ← BACK
                </button>
              )}
              {isScoring && (
                <p style={{ fontSize: '0.55rem', letterSpacing: '0.20em', textTransform: 'uppercase', color: '#9a2918', opacity: 0.4 }}>
                  Finding your profile…
                </p>
              )}
              {scoreError && (
                <p style={{ fontSize: '0.75rem', color: '#ee5974' }}>
                  Something went wrong. Please try again.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Branch / silence screen ───────────────────────────────────────────────────
  if (showBranch && branchQuestion) {
    return (
      <div className="relative w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center"
           style={{ paddingTop: 72 }}>
        <QuizHeader />
        <div style={{ width: '100%', maxWidth: 560, padding: '48px clamp(32px,5vw,72px)' }}>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div style={{
              fontSize: '0.50rem', letterSpacing: '0.30em', textTransform: 'uppercase',
              color: '#9a2918', opacity: 0.40, marginBottom: 24,
            }}>
              One last thing
            </div>
            <h1 style={{
              fontSize: 'clamp(1.7rem, 2.4vw, 2.4rem)',
              color: '#9a2918', lineHeight: 1.2, fontWeight: 400,
              margin: '0 0 clamp(28px, 3.5vh, 44px)', letterSpacing: '-0.01em',
            }}>
              {highlightQuestion(branchQuestion.questionText, BRANCH_HIGHLIGHT)}
            </h1>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {branchQuestion.answers.map((answer) => {
                const isSel = selectedBranchAnswerId === answer.id;
                return (
                  <button
                    key={answer.id}
                    onClick={() => handleBranchAnswerSelect(answer.id)}
                    style={{
                      width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                      borderBottom: '1px solid rgba(69,71,74,0.12)',
                      padding: '13px 0', textAlign: 'left',
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      fontFamily: 'inherit',
                    }}
                  >
                    <span style={{
                      display: 'block', width: 2, height: 16, marginTop: 4, flexShrink: 0,
                      backgroundColor: isSel ? '#9a2918' : 'rgba(69,71,74,0.18)',
                      transition: 'background-color 0.2s',
                    }} />
                    <span style={{
                      fontSize: 'clamp(0.88rem, 1.0vw, 1.0rem)',
                      lineHeight: 1.55,
                      color: isSel ? '#9a2918' : '#45474a',
                      transition: 'color 0.2s',
                    }}>
                      {answer.text}
                    </span>
                  </button>
                );
              })}
            </div>

          </motion.div>
        </div>
      </div>
    );
  }

  // ── Tie interstitial ─────────────────────────────────────────────────────────
  if (showTieInterstitial && scoreData) {
    const archetypeNameMap: Record<string, string> = {
      floral: 'Floral', fruity: 'Fruity', balanced: 'Balanced & Sweet',
      chocolate: 'Chocolate & Nutty', spicy: 'Earthy', experimental: 'Experimental',
    };
    const tiedNames = (scoreData.tiedArchetypes ?? [])
      .map((k) => archetypeNameMap[k.toLowerCase()] ?? k);

    const tiedParam = (scoreData.tiedArchetypes ?? []).join(',');

    return (
      <div className="relative w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center px-6">
        <QuizHeader />
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
                    .then(refreshUserProfile)
                    .catch(console.error);
                }
                fromWrapRef.current = true;
                setIsWrapping(true);
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

  // ── Wrap sequence ────────────────────────────────────────────────────────────
  if (isWrapping) {
    return (
      <WrapSequence
        name={userName}
        onComplete={() => {
          setIsWrapping(false);
          resetReveal();
          setIsComplete(true);
        }}
      />
    );
  }

  // ── Results screen ───────────────────────────────────────────────────────────
  //
  // 200vh scroll container · 100vh sticky
  // Curtain = full-screen wallpaper that slides up as user scrolls (translateY 0→-100%)
  // After curtain clears: Bloom Dial (left) + Bag + archetype text (right) — stable, no further scroll
  //

  // After the wrap sequence, skip the scroll-reveal curtain — show result directly
  if (fromWrapRef.current) {
    return (
      <div style={{ backgroundColor: '#f2f1ea', minHeight: '100vh' }}>
        <QuizHeader />
        <Section1Reveal
          name={archetype.name}
          wallpaper={archetype.wallpaper}
          bag={archetype.bag}
          description={archetype.shortDescription}
        />
        {resultsArchetypeData && (
          emailGateUnlocked ? (
            <>
              <GateStatusNote
                showSignedInConsentNote={showSignedInConsentNote}
                guestMaskedEmail={!user && postQuizEmail ? maskEmail(postQuizEmail) : null}
              />
              <ArchetypeSection
                data={resultsArchetypeData}
                index={0}
                selectedSortOrder={resultsSortOrder ?? computeDefaultSortOrder(resultsArchetypeData)}
                revealedKeys={resultsRevealedKeys}
                onDialSelect={handleResultsDialSelect}
                onToggleReveal={toggleResultsReveal}
                onAddToCart={addToCart}
                onHopClick={handleResultsHopClick}
                onCompare={openResultsCompare}
                userArchetype={matchedArchetypeId}
                registerDialRef={registerResultsDialRef}
                source="find_my_flavor_results"
              />
            </>
          ) : (
            <PostQuizEmailGate
              archetypeName={archetype.name}
              archetypeColor={archetype.color}
              experimental={archetypeKey === 'experimental'}
              confidence={scoreData?.foodSignalAlignment}
              sessionKey={sessionKeyRef.current!}
              onSuccess={handleGateSuccess}
            />
          )
        )}
        {emailGateUnlocked && (
          <CompareOverlay
            open={resultsCompareState.open}
            onClose={() => setResultsCompareState(s => ({ ...s, open: false }))}
            left={resultsCompareState.slot ? { archetype: resultsCompareState.archetype, archetypeLabel: resultsCompareState.archetypeLabel, slot: resultsCompareState.slot } : null}
            archetypes={archetypesList}
          />
        )}
      </div>
    );
  }

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

          {/* ── BASE LAYER — condensed header, revealed as the curtain slides away.
               Find My Flavor Part 2, Bug 2: this used to be a 50/50 dial-placeholder/
               bag split with a chocolate-only mock dial + hardcoded "BUY THIS COFFEE"
               panel. The real interactive dial/position-card/reveal/cart flow now
               lives in the full-width ArchetypeSection rendered below the scroll
               container (in normal document flow, not clipped to this 100vh sticky
               layer — ArchetypeSection's three-column row + full RevealedPanel is far
               taller than one viewport and needs full page width, per the spec). ── */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundColor: '#f2f1ea',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: 'clamp(32px, 5vw, 72px)', textAlign: 'center',
          }}>
            <p style={{
              fontSize: '0.48rem', letterSpacing: '0.32em', textTransform: 'uppercase',
              color: archetype.color, opacity: 0.50, margin: '0 0 7px',
            }}>
              YOUR COFFEE ARCHETYPE
            </p>
            <h1 style={{
              fontSize: 'clamp(2.4rem, 4.4vw, 4.6rem)',
              color: archetype.color, fontWeight: 400,
              lineHeight: 1.0, margin: '0 0 20px', letterSpacing: '-0.01em',
            }}>
              {archetype.name}
            </h1>
            <p style={{
              fontSize: 'clamp(0.78rem, 0.92vw, 0.92rem)',
              color: '#9a2918', opacity: 0.50, lineHeight: 1.75, margin: 0,
              maxWidth: 480,
            }}>
              {archetype.shortDescription}
            </p>
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

            {archetypeKey === 'chocolate' ? (
              /* ── Chocolate curtain — cream background with brand text layout ── */
              <div style={{
                position: 'absolute', top: 0, left: 0,
                width: '100%', height: '100%',
                backgroundColor: '#f2f1ea',
              }}>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.9, delay: 0.3 }}
                  style={{
                    position: 'absolute',
                    left: 'clamp(72px, 7.5vw, 120px)',
                    top: 'clamp(160px, 27vh, 240px)',
                    opacity: curtainTextAlpha,
                    transition: 'opacity 0.15s ease',
                    pointerEvents: curtainTextAlpha < 0.05 ? 'none' : 'auto',
                  }}
                >
                  {/* from: */}
                  <p style={{
                    fontSize: 'clamp(0.95rem, 1.2vw, 1.25rem)',
                    color: '#7a2018',
                    margin: '0 0 2px',
                    fontWeight: 400,
                    fontFamily: 'inherit',
                  }}>
                    from:
                  </p>

                  {/* AXIS */}
                  <p style={{
                    fontSize: 'clamp(4rem, 7vw, 8.5rem)',
                    color: '#7a2018',
                    margin: 0,
                    lineHeight: 1.0,
                    fontWeight: 400,
                    letterSpacing: '-0.01em',
                    fontFamily: 'inherit',
                  }}>
                    AXIS
                  </p>

                  {/* & BLOOM */}
                  <p style={{
                    fontSize: 'clamp(4rem, 7vw, 8.5rem)',
                    color: '#7a2018',
                    margin: '0 0 clamp(28px, 3.5vh, 44px)',
                    lineHeight: 1.0,
                    fontWeight: 400,
                    letterSpacing: '-0.01em',
                    fontFamily: 'inherit',
                  }}>
                    &amp;{' '}
                    <span style={{ color: '#d4607a' }}>BLOOM</span>
                  </p>

                  {/* to: YOU */}
                  <p style={{
                    fontSize: 'clamp(0.95rem, 1.2vw, 1.25rem)',
                    color: '#7a2018',
                    margin: 0,
                    fontWeight: 400,
                    fontFamily: 'inherit',
                  }}>
                    to:{' '}
                    <span style={{
                      backgroundColor: '#d4607a',
                      color: '#ffffff',
                      padding: '2px 9px 3px',
                    }}>
                      YOU
                    </span>
                  </p>

                  {/* Mobile tap button */}
                  <button
                    className="block md:hidden"
                    onClick={() => setRevealForced(true)}
                    style={{
                      marginTop: 'clamp(32px, 5vh, 52px)',
                      background: 'none',
                      border: '1px solid rgba(122,32,24,0.35)',
                      padding: '10px 20px',
                      color: '#7a2018',
                      fontFamily: 'inherit',
                      fontSize: '0.58rem',
                      letterSpacing: '0.22em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                    }}
                  >
                    TAP TO REVEAL
                  </button>
                </motion.div>
              </div>
            ) : (
              /* ── Other archetypes — wallpaper image ── */
              <>
                {/* Bug 1 fix (Find My Flavor Part 2): explicit opaque backgroundColor
                    fallback — matching the gradient overlay's own base color — so
                    this div is never transparent while the ~1MB `archetype.wallpaper`
                    JPG is still downloading/decoding. Without it, the base layer
                    underneath (now the condensed header above) showed through the
                    still-loading curtain and then "popped in" opaque once the image
                    landed, reading as a reveal window dropping down to cover an
                    already-visible match. The preload effect above (keyed on
                    archetypeKey) makes this the fast path a moot point on a warm
                    cache; this backgroundColor is what makes a cold/slow one correct
                    too. */}
                <div style={{
                  position: 'absolute', top: 0, left: 0,
                  width: '100%', height: '100%',
                  backgroundColor: '#0a0604',
                  backgroundImage: `url(${archetype.wallpaper})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                  pointerEvents: 'none',
                }} />
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(to top, rgba(10,6,4,0.62) 0%, rgba(10,6,4,0.08) 52%, rgba(10,6,4,0) 100%)',
                }} />
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
                  <p className="hidden md:block" style={{
                    fontSize: '0.46rem', letterSpacing: '0.26em', textTransform: 'uppercase',
                    color: 'rgba(242,241,234,0.30)', margin: 0,
                  }}>
                    SCROLL TO REVEAL
                  </p>
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
              </>
            )}
          </div>

        </div>
      </div>

      {/* ── Full-width archetype box — the same dial, position card, reveal panel,
           add-to-cart, compare, and hop-link flow already proven on /bloom and this
           page's own returning-user screen (Find My Flavor Part 2, Bug 2). Chocolate
           & Nutty's previous special case — a local BloomDial mock with Gentle/
           Rounded/Structured/Full/Deep body-level picks, feeding a hardcoded "BUY
           THIS COFFEE" button that hard-navigated to /shop — is retired in favor of
           this, same as every other archetype already got. Flagged explicitly in the
           WHAT_WE_BUILT.md entry for this change, per the spec's instruction. ── */}
      {resultsArchetypeData && (
        emailGateUnlocked ? (
          <>
            <GateStatusNote
              showSignedInConsentNote={showSignedInConsentNote}
              guestMaskedEmail={!user && postQuizEmail ? maskEmail(postQuizEmail) : null}
            />
            <ArchetypeSection
              data={resultsArchetypeData}
              index={0}
              selectedSortOrder={resultsSortOrder ?? computeDefaultSortOrder(resultsArchetypeData)}
              revealedKeys={resultsRevealedKeys}
              onDialSelect={handleResultsDialSelect}
              onToggleReveal={toggleResultsReveal}
              onAddToCart={addToCart}
              onHopClick={handleResultsHopClick}
              onCompare={openResultsCompare}
              userArchetype={matchedArchetypeId}
              registerDialRef={registerResultsDialRef}
              source="find_my_flavor_results"
            />
          </>
        ) : (
          <PostQuizEmailGate
            archetypeName={archetype.name}
            archetypeColor={archetype.color}
            experimental={archetypeKey === 'experimental'}
            confidence={scoreData?.foodSignalAlignment}
            sessionKey={sessionKeyRef.current!}
            onSuccess={handleGateSuccess}
          />
        )
      )}

      {emailGateUnlocked && (
        <CompareOverlay
          open={resultsCompareState.open}
          onClose={() => setResultsCompareState(s => ({ ...s, open: false }))}
          left={resultsCompareState.slot ? { archetype: resultsCompareState.archetype, archetypeLabel: resultsCompareState.archetypeLabel, slot: resultsCompareState.slot } : null}
          archetypes={archetypesList}
        />
      )}

    </div>
  );
}
