import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { saveQuizResult, getUserProfile, getDialPosition, setDialPosition, logQuizFunnelEvent, subscribeNewsletter } from '../lib/api';
import { trackEvent, trackLead } from '../lib/analytics';
import { PostQuizEmailGate } from './PostQuizEmailGate';
import { ShareMatchRow } from './ShareMatchRow';
import { computeDefaultSortOrder } from './bloom/ArchetypeSection';
import { DialArchetypeSection } from './bloom/DialArchetypeSection';
import { CompareOverlay } from './bloom/CompareOverlay';
import { useAdjacentArchetype } from './bloom/useAdjacentArchetype';
import { resolveLandingSortOrder } from './bloom/doorConfig';
import { useArchetypeAdjacency } from './coffee-info/archetypeAdjacency';
import WorthExploring from './profile/WorthExploring';
import type { BloomDialHandle } from './BloomDialWidget';
import type { ArchetypeData, DoorTarget, Slot } from './bloom/types';

const RUST = '#a33726';

// ─── Archetype asset imports ──────────────────────────────────────────────────

import { archetypeAssets, patternAssets, cardAssets, quizAssets, quizResultAssets } from '../../design/assets';
import type { ArchetypeSlug } from '../../design/assets';

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

const coffeePic10    = quizAssets.coffeeLarge.src;
const patternTissue  = patternAssets.experimental.src;
const patternSpicy   = patternAssets['spicy-earthy'].src;
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

// ─── Wrap overlay (fixed, covers living page — never a replacement) ───────────
// Papers rise/drop OVER the question/branch/tie screen. While covered, isComplete
// flips (result renders beneath). Papers then part to reveal the result hero.

function WrapOverlay({
  name, heroImageSrc, onShowResult, onStartNaming, onDone,
}: {
  name: string;
  heroImageSrc: string;
  onShowResult: () => void;
  onStartNaming: () => void;
  onDone: () => void;
}) {
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [expCover,   setExpCover]   = useState(false);
  const [spicyCover, setSpicyCover] = useState(false);
  const [expPart,    setExpPart]    = useState(false);
  const [spicyPart,  setSpicyPart]  = useState(false);
  const [showVeil,   setShowVeil]   = useState(false);
  const [wrapLine,   setWrapLine]   = useState('');
  const [showText,   setShowText]   = useState(false);
  const heroLoaded = useRef(false);

  useEffect(() => {
    // Preload result hero — the ~5s ceremony is the loading window
    const img = new Image();
    img.onload = () => { heroLoaded.current = true; };
    img.src = heroImageSrc;

    const line1 = name ? `Wrapping ${name}'s coffee…` : 'Wrapping your coffee…';
    const line2 = name ? `Choosing ${name}'s coffee…` : 'Choosing your coffee…';

    document.body.style.overflow = 'hidden';

    if (reducedMotion) {
      onShowResult();
      setShowVeil(true);
      setWrapLine(line1);
      setShowText(true);
      const timers = [
        setTimeout(() => { setShowText(false); setTimeout(() => { setWrapLine(line2); setShowText(true); }, 350); }, 1400),
        setTimeout(() => { setShowText(false); setShowVeil(false); }, 3200),
        setTimeout(() => { onStartNaming(); document.body.style.overflow = ''; onDone(); }, 3700),
      ];
      return () => { timers.forEach(clearTimeout); document.body.style.overflow = ''; };
    }

    const startParting = () => {
      setSpicyPart(true);
      setTimeout(() => setExpPart(true), 150);
    };
    const tryPart = () => {
      if (heroLoaded.current) { startParting(); return; }
      const timeout = setTimeout(startParting, 3000);
      const check = setInterval(() => { if (heroLoaded.current) { clearTimeout(timeout); clearInterval(check); startParting(); } }, 100);
    };

    const t = (ms: number, fn: () => void) => setTimeout(fn, ms);
    const timers = [
      t(600,  () => setExpCover(true)),
      t(1300, () => setSpicyCover(true)),
      t(1900, () => { onShowResult(); setShowVeil(true); setWrapLine(line1); setShowText(true); }),
      t(3500, () => { setShowText(false); setTimeout(() => { setWrapLine(line2); setShowText(true); }, 450); }),
      t(5300, () => { setShowText(false); setShowVeil(false); }),
      t(5900, tryPart),
      t(6400, onStartNaming),
      t(7100, () => { document.body.style.overflow = ''; onDone(); }),
    ];
    return () => { timers.forEach(clearTimeout); document.body.style.overflow = ''; };
  }, []);

  const ease = 'cubic-bezier(.65,0,.35,1)';
  // Experimental: starts below (top:100dvh), covers by translateY(-100dvh), exits by resetting to translateY(0)
  const expTransform   = expPart   ? 'translateY(0)'     : expCover   ? 'translateY(-100dvh)' : 'translateY(0)';
  // Spicy: starts above (top:-102dvh), covers by translateY(102dvh), exits by resetting to translateY(0)
  const spicyTransform = spicyPart ? 'translateY(0)'     : spicyCover ? 'translateY(102dvh)'  : 'translateY(0)';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, overflow: 'hidden' }}>
      <style>{`
        @keyframes wrapDot{0%,60%,100%{opacity:.25}30%{opacity:1}}
        .wrap-dot{display:inline-block;animation:wrapDot 1.4s infinite}
        .wrap-dot:nth-child(2){animation-delay:.2s}
        .wrap-dot:nth-child(3){animation-delay:.4s}
      `}</style>

      {/* Experimental — top:100dvh, rises to cover */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: '102dvh', top: '100dvh',
        backgroundImage: `url(${patternTissue})`, backgroundSize: '1250px', backgroundPosition: '60% 40%',
        transform: expTransform,
        transition: (expCover || expPart) ? `transform 1s ${ease}` : 'none',
        willChange: 'transform',
        zIndex: 1,
      }} />

      {/* Spicy & Earthy — top:-102dvh, drops to cover */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: '102dvh', top: '-102dvh',
        backgroundImage: `url(${patternSpicy})`, backgroundSize: '1250px', backgroundPosition: '12% 30%',
        transform: spicyTransform,
        transition: (spicyCover || spicyPart) ? `transform 1s ${ease}` : 'none',
        willChange: 'transform',
        zIndex: 2,
      }} />

      {/* Veil */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 3,
        background: `rgba(24,15,10,${showVeil ? '.28' : '0'})`,
        transition: 'background 0.6s',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <p style={{
          color: '#f2f1ea',
          fontSize: 'clamp(26px,3vw,40px)',
          letterSpacing: '.06em',
          fontFamily: 'inherit',
          textAlign: 'center',
          opacity: showText ? 1 : 0,
          transform: showText ? 'none' : 'translateY(10px)',
          transition: 'opacity 0.6s, transform 0.6s',
        }}>
          {wrapLine}
          <span className="wrap-dot">.</span>
          <span className="wrap-dot">.</span>
          <span className="wrap-dot">.</span>
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

// ─── Archetype card images for the wrap reveal (WEB* set from bucket) ────────

const ARCHETYPE_CARDS: Record<string, string> = {
  floral:       cardAssets.floral.src,
  fruity:       cardAssets.fruity.src,
  balanced:     cardAssets['balanced-sweet'].src,
  chocolate:    cardAssets['chocolate-nutty'].src,
  earthy:       cardAssets['spicy-earthy'].src,
  experimental: cardAssets.experimental.src,
};

// ─── Quiz ArchetypeKey → ArchetypeSlug (for result-scan lookup) ──────────────

const QUIZ_KEY_TO_SLUG: Record<ArchetypeKey, ArchetypeSlug> = {
  floral:       'floral',
  fruity:       'fruity',
  balanced:     'balanced-sweet',
  chocolate:    'chocolate-nutty',
  earthy:       'spicy-earthy',
  experimental: 'experimental',
};

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

  const [hasStarted, setHasStarted]       = useState(() => isPreview);
  const [userName, setUserName]           = useState('');
  const [currentStep, setCurrentStep]     = useState(0);
  const [isWrapping, setIsWrapping]       = useState(false);
  const [resultHeroShown, setResultHeroShown] = useState(() => isPreview);
  const [answers, setAnswers]             = useState<Record<number, number>>({});
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

  // Returning-user screen — embedded ArchetypeSection (Find My Flavor Part 1)
  const [archetypesList, setArchetypesList]     = useState<ArchetypeData[]>([]);
  const [experimentalData, setExperimentalData] = useState<ArchetypeData | null>(null);
  const [matchedSortOrder, setMatchedSortOrder] = useState<number | null>(null);
  const [revealedKeys, setRevealedKeys]         = useState<Set<string>>(new Set());
  const matchedDialRef = useRef<BloomDialHandle | null>(null);
  const [compareState, setCompareState] = useState<{ open: boolean; archetype: string; archetypeLabel: string; slot: Slot | null }>({
    open: false, archetype: '', archetypeLabel: '', slot: null,
  });
  // Part 17 §F — "Worth exploring" adjacent-archetype section for this screen,
  // same mechanism as Profile.tsx's. Independent hook instance from the results
  // screen's below, matching this file's existing per-screen state isolation.
  const matchedAdjacent = useAdjacentArchetype(archetypesList, experimentalData);

  // Just-scored results screen — separate ArchetypeSection instance/state from the
  // returning-user screen above (Find My Flavor Part 2). Kept independent per the
  // spec's own caution, even though the two screens are unlikely to both be mounted
  // at once today.
  const [resultsSortOrder, setResultsSortOrder] = useState<number | null>(null);
  const [resultsRevealedKeys, setResultsRevealedKeys] = useState<Set<string>>(new Set());
  const resultsDialRef = useRef<BloomDialHandle | null>(null);
  const heroHeadingRef = useRef<HTMLHeadingElement>(null);
  const [resultsCompareState, setResultsCompareState] = useState<{ open: boolean; archetype: string; archetypeLabel: string; slot: Slot | null }>({
    open: false, archetype: '', archetypeLabel: '', slot: null,
  });
  // Part 17 §F — same idea as matchedAdjacent above, independent instance for
  // this screen.
  const resultsAdjacent = useAdjacentArchetype(archetypesList, experimentalData);
  const adjacency = useArchetypeAdjacency();

  // Part 19 §A — doors route through the same open-target-section mechanism
  // as Worth Exploring, same as Profile.tsx. Shared lookup (archetypesList/
  // experimentalData are shared across both screens); one handler per screen
  // since each has its own adjacent-section hook instance.
  function findArchetypeData(archetype: string): ArchetypeData | null {
    return archetype === 'experimental' ? experimentalData : archetypesList.find(a => a.archetype === archetype) ?? null;
  }
  function handleMatchedDoorClick(_fromArchetype: string, edge: 'left' | 'right', target: DoorTarget) {
    const targetData = findArchetypeData(target.archetype);
    if (!targetData) return;
    matchedAdjacent.openAtPosition(target.archetype, resolveLandingSortOrder(edge, targetData));
  }
  function handleResultsDoorClick(_fromArchetype: string, edge: 'left' | 'right', target: DoorTarget) {
    const targetData = findArchetypeData(target.archetype);
    if (!targetData) return;
    resultsAdjacent.openAtPosition(target.archetype, resolveLandingSortOrder(edge, targetData));
  }

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

  // Step 07 (A3): the 5-archetype share canon excludes Experimental (it's a category,
  // not one of the 5 archetypes with a public /match page) — underscore-to-hyphen
  // matches archetypeAssets' ARCHETYPE_SLUGS convention (chocolate_nutty -> chocolate-nutty).
  const shareSlug = archetypeKey === 'experimental' ? null : resultsArchetypeEnum.replace('_', '-');

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
  const emailGateUnlocked = (!!user && !user.isAnonymous) || !!postQuizEmail;
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
    if (!resultsArchetypeData || (user && !user.isAnonymous) || !postQuizEmail) return;
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
    if (!user || user.isAnonymous || !resultsArchetypeData || !userProfile || !profileFetchDone) return;
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

  // Scroll to top when result becomes visible (e.g. ?result= preview shortcut)
  useEffect(() => {
    if (isComplete) window.scrollTo({ top: 0 });
  }, [isComplete]);

  // After papers part, move focus to the hero heading (§6 a11y)
  useEffect(() => {
    if (resultHeroShown) heroHeadingRef.current?.focus();
  }, [resultHeroShown]);

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
    setIsWrapping(true);
  };

  const handleRetake = () => {
    window.scrollTo({ top: 0 });
    document.body.style.overflow = '';
    setIsWrapping(false);
    setResultHeroShown(false);
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
          <DialArchetypeSection
            data={matchedData}
            index={0}
            selectedSortOrder={matchedSortOrder ?? computeDefaultSortOrder(matchedData)}
            revealedKeys={revealedKeys}
            onDialSelect={handleMatchedDialSelect}
            onToggleReveal={toggleMatchedReveal}
            onAddToCart={addToCart}
            onCompare={openMatchedCompare}
            userArchetype={matchedArchetypeId}
            registerDialRef={registerMatchedDialRef}
            source="find_my_flavor_returning"
            embedded
            onDoorClick={handleMatchedDoorClick}
          />
        )}

        {/* Part 17 §F — Worth Exploring + adjacent-archetype section, same
            mechanism as Profile.tsx: cross-archetype hop chips on this screen
            now have somewhere to land instead of doing nothing. */}
        {matchedArchetypeId && archetypesList.length > 0 && (
          <div className="max-w-2xl mx-auto px-6 mt-2">
            <WorthExploring
              matchArchetypeId={matchedArchetypeId}
              adjacency={adjacency}
              archetypesList={archetypesList}
              activeArchetype={matchedAdjacent.adjacentArchetypeId}
              onSelect={matchedAdjacent.handleChipClick}
            />
          </div>
        )}
        {matchedAdjacent.adjacentData && (
          <div ref={matchedAdjacent.sectionRef}>
            <DialArchetypeSection
              data={matchedAdjacent.adjacentData}
              index={1}
              selectedSortOrder={matchedAdjacent.adjacentSortOrder ?? computeDefaultSortOrder(matchedAdjacent.adjacentData)}
              revealedKeys={matchedAdjacent.adjacentRevealedKeys}
              onDialSelect={matchedAdjacent.handleDialSelect}
              onToggleReveal={matchedAdjacent.toggleReveal}
              onAddToCart={addToCart}
              onCompare={openMatchedCompare}
              userArchetype={matchedArchetypeId}
              registerDialRef={matchedAdjacent.registerDialRef}
              source="find_my_flavor_returning"
              embedded
              onDoorClick={handleMatchedDoorClick}
            />
          </div>
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Single return — quiz and result phases share the same render tree so the
  // WrapOverlay (a fixed sibling) stays mounted across the question→result switch.

  const nightScanSrc = quizResultAssets[QUIZ_KEY_TO_SLUG[archetypeKey]].src;
  const isOnQuestion = !isComplete && !showBranch && !showTieInterstitial;
  const isOnBranch   = !isComplete && showBranch && !!branchQuestion;
  const isOnTie      = showTieInterstitial && !!scoreData;

  const currentQ     = isOnQuestion && currentStep < questions.length ? questions[currentStep] : null;
  const currentImage = currentQ ? (QUESTION_IMAGES[currentQ.q_number] ?? QUESTION_IMAGES[1]) : null;
  const currentKw    = currentQ ? Q_HIGHLIGHTS[currentQ.q_number] : undefined;

  const archetypeNameMapTie: Record<string, string> = {
    floral: 'Floral', fruity: 'Fruity', balanced: 'Balanced & Sweet',
    chocolate: 'Chocolate & Nutty', spicy: 'Earthy', experimental: 'Experimental',
  };
  const tiedNames = isOnTie ? (scoreData!.tiedArchetypes ?? []).map(k => archetypeNameMapTie[k.toLowerCase()] ?? k) : [];
  const tiedParam = isOnTie ? (scoreData!.tiedArchetypes ?? []).join(',') : '';

  // CSS helper for the result hero naming stagger
  const stagger = (delay: string) => ({
    opacity:    resultHeroShown ? 1 : 0,
    transform:  resultHeroShown ? 'none' : 'translateY(12px)',
    transition: `opacity 0.7s ease ${delay}, transform 0.7s ease ${delay}`,
  });

  return (
    <>
      {/* ── Question phase ──────────────────────────────────────────────────── */}
      {isOnQuestion && currentQ && (
        <div className="w-full min-h-screen flex flex-col lg:flex-row" style={{ background: '#f2f1ea' }}>
          <QuizHeader />

          {/* Photo panel — 46%, framed print */}
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
                style={{ border: '1px solid #c5c7c8', padding: 14, background: '#f2f1ea', display: 'inline-block' }}
              >
                <img
                  src={currentImage!}
                  alt=""
                  style={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 126px)', width: 'auto', height: 'auto' }}
                />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Question panel — 54% */}
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
                    fontSize: 'clamp(1.7rem, 2.4vw, 2.4rem)', color: '#9a2918',
                    lineHeight: 1.2, fontWeight: 400,
                    margin: '0 0 clamp(28px, 3.5vh, 44px)', letterSpacing: '-0.01em',
                  }}>
                    {currentKw ? highlightQuestion(currentQ.q_text, currentKw) : currentQ.q_text}
                  </h1>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {currentQ.answers.map((answer, idx) => {
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
                            fontSize: 'clamp(0.88rem, 1.0vw, 1.0rem)', lineHeight: 1.55,
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
              <div style={{ marginTop: 'clamp(28px, 3.5vh, 44px)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {currentStep > 0 && (
                  <button
                    onClick={() => { if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current); setCurrentStep(p => p - 1); }}
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
                  <p style={{ fontSize: '0.75rem', color: '#ee5974' }}>Something went wrong. Please try again.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Branch / silence screen ──────────────────────────────────────────── */}
      {isOnBranch && (
        <div className="relative w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center" style={{ paddingTop: 72 }}>
          <QuizHeader />
          <div style={{ width: '100%', maxWidth: 560, padding: '48px clamp(32px,5vw,72px)' }}>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              <div style={{ fontSize: '0.50rem', letterSpacing: '0.30em', textTransform: 'uppercase', color: '#9a2918', opacity: 0.40, marginBottom: 24 }}>
                One last thing
              </div>
              <h1 style={{ fontSize: 'clamp(1.7rem, 2.4vw, 2.4rem)', color: '#9a2918', lineHeight: 1.2, fontWeight: 400, margin: '0 0 clamp(28px, 3.5vh, 44px)', letterSpacing: '-0.01em' }}>
                {highlightQuestion(branchQuestion!.questionText, BRANCH_HIGHLIGHT)}
              </h1>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {branchQuestion!.answers.map((answer) => {
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
                      <span style={{ display: 'block', width: 2, height: 16, marginTop: 4, flexShrink: 0, backgroundColor: isSel ? '#9a2918' : 'rgba(69,71,74,0.18)', transition: 'background-color 0.2s' }} />
                      <span style={{ fontSize: 'clamp(0.88rem, 1.0vw, 1.0rem)', lineHeight: 1.55, color: isSel ? '#9a2918' : '#45474a', transition: 'color 0.2s' }}>
                        {answer.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </div>
        </div>
      )}

      {/* ── Tie interstitial ─────────────────────────────────────────────────── */}
      {isOnTie && (
        <div className="relative w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center px-6">
          <QuizHeader />
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="max-w-md w-full text-center space-y-8">
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
                onClick={() => { window.location.href = `/sommelier?entry=quiz_tie&tied=${encodeURIComponent(tiedParam)}`; }}
                className="w-full py-3 rounded-lg text-white text-sm tracking-wide"
                style={{ backgroundColor: RUST }}
              >
                Talk to Liam →
              </button>
              <button
                onClick={() => {
                  setShowTieInterstitial(false);
                  if (user) {
                    saveQuizResult({ archetype: scoreData!.archetype, scores: scoreData!.scores, answers, decaf: false })
                      .then(refreshUserProfile).catch(console.error);
                  }
                  setIsWrapping(true);
                }}
                className="w-full py-3 rounded-lg text-sm text-stone-600 border border-stone-200 hover:bg-stone-100"
              >
                See my primary result
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Result screen ────────────────────────────────────────────────────── */}
      {isComplete && (
        <div>
          <QuizHeader />

          {/* Hero — night-scan photo, naming staggers in as papers part */}
          <section style={{ position: 'relative', height: '100dvh', background: '#141110' }}>
            <div style={{
              position: 'absolute', inset: 0,
              backgroundImage: `url(${nightScanSrc})`,
              backgroundSize: 'cover', backgroundPosition: 'center',
            }} />
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(180deg, rgba(16,12,10,.15) 30%, rgba(16,12,10,.72) 100%)',
            }} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: '11vh', textAlign: 'center', zIndex: 2 }}>
              <p style={{ fontSize: 13, letterSpacing: '.26em', textTransform: 'uppercase', color: 'rgba(242,241,234,.92)', marginBottom: 18, ...stagger('.2s') }}>
                {userName ? `${userName} —` : 'Your profile —'}
              </p>
              <p style={{ fontSize: 11, letterSpacing: '.3em', textTransform: 'uppercase', color: 'rgba(242,241,234,.6)', marginBottom: 16, ...stagger('.35s') }}>
                Your coffee archetype
              </p>
              <div
                aria-hidden="true"
                style={{
                  width: 56, height: 3, margin: '0 auto 20px',
                  background: `color-mix(in srgb, ${archetype.color} 82%, #f2f1ea)`,
                  opacity: resultHeroShown ? 1 : 0,
                  transform: resultHeroShown ? 'scaleX(1)' : 'scaleX(.3)',
                  transition: 'opacity 0.7s ease 0.45s, transform 0.7s cubic-bezier(.22,1,.36,1) 0.45s',
                }}
              />
              <h1
                ref={heroHeadingRef}
                tabIndex={-1}
                style={{
                  fontSize: 'clamp(36px,7.5vw,104px)', fontWeight: 400, lineHeight: 1.05,
                  color: '#f2f1ea', margin: '0 0 26px', outline: 'none',
                  ...stagger('.55s'),
                }}
              >
                {archetype.name}.
              </h1>
              <p style={{ maxWidth: 560, margin: '0 auto', fontSize: 15.5, lineHeight: 1.7, color: 'rgba(242,241,234,.88)', padding: '0 clamp(20px,5vw,32px)', ...stagger('.7s') }}>
                {archetype.shortDescription}
              </p>
            </div>
            {/* Scroll cue */}
            <div aria-hidden="true" style={{
              position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)',
              width: 1, height: 26, zIndex: 2,
              background: `color-mix(in srgb, ${archetype.color} 70%, #f2f1ea)`,
            }} />
          </section>

          {/* Share row — available before gate unlock, hidden for Experimental (no share page) */}
          <ShareMatchRow archetypeName={archetype.name} shareSlug={shareSlug} />

          {/* Gate / post-hero */}
          {emailGateUnlocked ? (
            <>
              <GateStatusNote
                showSignedInConsentNote={showSignedInConsentNote}
                guestMaskedEmail={!user && postQuizEmail ? maskEmail(postQuizEmail) : null}
              />
              {resultsArchetypeData && (
                <DialArchetypeSection
                  data={resultsArchetypeData}
                  index={0}
                  selectedSortOrder={resultsSortOrder ?? computeDefaultSortOrder(resultsArchetypeData)}
                  revealedKeys={resultsRevealedKeys}
                  onDialSelect={handleResultsDialSelect}
                  onToggleReveal={toggleResultsReveal}
                  onAddToCart={addToCart}
                  onCompare={openResultsCompare}
                  userArchetype={matchedArchetypeId}
                  registerDialRef={registerResultsDialRef}
                  source="find_my_flavor_results"
                  embedded
                  onDoorClick={handleResultsDoorClick}
                />
              )}

              {/* Part 17 §F — same Worth Exploring + adjacent-section mechanism as the
                  returning-user screen above and Profile.tsx. */}
              {resultsArchetypeEnum && archetypesList.length > 0 && (
                <div className="max-w-2xl mx-auto px-6 mt-2">
                  <WorthExploring
                    matchArchetypeId={resultsArchetypeEnum}
                    adjacency={adjacency}
                    archetypesList={archetypesList}
                    activeArchetype={resultsAdjacent.adjacentArchetypeId}
                    onSelect={resultsAdjacent.handleChipClick}
                  />
                </div>
              )}
              {resultsAdjacent.adjacentData && (
                <div ref={resultsAdjacent.sectionRef}>
                  <DialArchetypeSection
                    data={resultsAdjacent.adjacentData}
                    index={1}
                    selectedSortOrder={resultsAdjacent.adjacentSortOrder ?? computeDefaultSortOrder(resultsAdjacent.adjacentData)}
                    revealedKeys={resultsAdjacent.adjacentRevealedKeys}
                    onDialSelect={resultsAdjacent.handleDialSelect}
                    onToggleReveal={resultsAdjacent.toggleReveal}
                    onAddToCart={addToCart}
                    onCompare={openResultsCompare}
                    userArchetype={matchedArchetypeId}
                    registerDialRef={resultsAdjacent.registerDialRef}
                    source="find_my_flavor_results"
                    embedded
                    onDoorClick={handleResultsDoorClick}
                  />
                </div>
              )}
              <CompareOverlay
                open={resultsCompareState.open}
                onClose={() => setResultsCompareState(s => ({ ...s, open: false }))}
                left={resultsCompareState.slot ? { archetype: resultsCompareState.archetype, archetypeLabel: resultsCompareState.archetypeLabel, slot: resultsCompareState.slot } : null}
                archetypes={archetypesList}
              />
            </>
          ) : (
            <section style={{ background: '#f2f1ea', padding: 'clamp(72px,10vh,120px) clamp(20px,5vw,40px) 90px' }}>
              <PostQuizEmailGate
                archetypeName={archetype.name}
                archetypeColor={archetype.color}
                experimental={archetypeKey === 'experimental'}
                confidence={scoreData?.foodSignalAlignment}
                sessionKey={sessionKeyRef.current!}
                onSuccess={handleGateSuccess}
              />
            </section>
          )}
        </div>
      )}

      {/* ── Wrap overlay — fixed, stays mounted across question→result switch ── */}
      {isWrapping && (
        <WrapOverlay
          name={userName}
          heroImageSrc={nightScanSrc}
          onShowResult={() => setIsComplete(true)}
          onStartNaming={() => setResultHeroShown(true)}
          onDone={() => setIsWrapping(false)}
        />
      )}

      {/* Quiz layout hides the public nav/footer — a minimal legal link stands in for it. */}
      {isComplete && (
        <div style={{ padding: 'clamp(20px, 3vw, 32px)', textAlign: 'center' }}>
          <Link to="/privacy" style={{ fontFamily: "'Lato', Arial, sans-serif", fontSize: '0.7rem', color: '#7a2018', opacity: 0.45, textDecoration: 'none', marginRight: 20 }}>
            Privacy
          </Link>
          <Link to="/terms" style={{ fontFamily: "'Lato', Arial, sans-serif", fontSize: '0.7rem', color: '#7a2018', opacity: 0.45, textDecoration: 'none' }}>
            Terms
          </Link>
        </div>
      )}

    </>
  );
}
