import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { usePrelaunchGated } from '../lib/prelaunch';
import { saveQuizResult, getUserProfile, getDialPosition, setDialPosition, logQuizFunnelEvent, subscribeNewsletter } from '../lib/api';
import { getActiveCampaign, CAMPAIGNS } from '../lib/campaign';
import { trackEvent, trackLead } from '../lib/analytics';
import { reportError } from '../lib/errorReporter';
import { PostQuizEmailGate } from './PostQuizEmailGate';
import { ShareMatchRow } from './ShareMatchRow';
import { computeDefaultSortOrder } from './bloom/ArchetypeSection';
import { DialArchetypeSection } from './bloom/DialArchetypeSection';
import { FloatingCart } from './bloom/FloatingCart';
import { QUIET_LINK_CLASS } from './bloom/RevealedPanel';
import { FAMILY_LINES } from './bloom/matchCopy';
import { CompareOverlay } from './bloom/CompareOverlay';
import { useAdjacentArchetype } from './bloom/useAdjacentArchetype';
import { resolveLandingSortOrder } from './bloom/doorConfig';
import { useArchetypeAdjacency } from './coffee-info/archetypeAdjacency';
import WorthExploring from './profile/WorthExploring';
import Navigation from './Navigation';
import { Btn, Caps } from './chrome';
import { Scene, StatusScene, ProgressBar, QuestionScene, ExitConfirm, EntryBody, type SceneImage } from './quiz/QuizScenes';
import { numberWord } from './bloom/useDialSlot';
import type { BloomDialHandle } from './BloomDialWidget';
import type { ArchetypeData, DoorTarget, Slot } from './bloom/types';

const RUST = '#a33726';

// Name screen, signed in (Checkout UX 1): the screen stays so a customer can
// profile someone in the household; it must not read like being signed out.
const signedInNameScreenLine = (email: string | null) =>
  `Signed in as ${email} · profiling yourself or someone in your household`;

// ─── Archetype asset imports ──────────────────────────────────────────────────

import { archetypeAssets, patternAssets, cardAssets, quizAssets, quizResultAssets, quizSceneAssets, optimizedAsset } from '../../design/assets';
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

const patternTissue  = patternAssets.experimental.src;
const patternSpicy   = patternAssets['spicy-earthy'].src;

// Website 7A (2026-11-06): option B's scene photos. The entry photo is a registry
// key (falls back to the current quiz photo until raw/quiz/scene-entry.jpg is
// uploaded); a question's photo is data (quiz_question.image_asset_key), and a
// question with none, or whose upload is not in yet, shows the entry photo's fallback.
const ENTRY_IMAGE: SceneImage = { asset: quizSceneAssets.entry, fallback: quizAssets.coffeeLarge };
const sceneImageOf = (key: string | null | undefined): SceneImage =>
  key ? { asset: optimizedAsset(key), fallback: quizAssets.coffeeLarge } : ENTRY_IMAGE;
// The handoff's auto-advance after a pick (build.py: 420 ms).
const AUTO_ADVANCE_MS = 420;

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
  /** Website 7A: the scene photo's registry path (null → the entry photo) */
  image_asset_key?: string | null;
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
  // Interpretation v2.1 (informational: the backend recomputes them server-side on save).
  secondaryPath: 'near-tie' | 'gate-backed' | 'food-led' | 'runner-up' | 'none';
  pairConfidence: 'high' | 'medium' | 'low';
  exploreArchetype: string | null;
  exploreReason: string | null;
  primaryMargin: number;
  interpretationVersion: string;
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
  imageAssetKey?: string | null;
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
      <a href="/" className={QUIET_LINK_CLASS} style={{ fontFamily: 'inherit', pointerEvents: 'auto' }}>
        AXIS &amp; BLOOM
      </a>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', pointerEvents: 'auto' }}>
        {!user && (
          <a href="/sign-in" className={QUIET_LINK_CLASS} style={{ fontFamily: 'inherit' }}>
            SAVE PROGRESS
          </a>
        )}
        <button
          onClick={() => navigate('/')}
          className={QUIET_LINK_CLASS}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
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
          color: 'var(--ab-paper)', // Website 7A: token
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

// ─── Archetype key + name→key mapping ────────────────────────────────────────

type ArchetypeKey = 'floral' | 'fruity' | 'balanced' | 'chocolate' | 'earthy' | 'experimental';

const ARCHETYPE_NAME_TO_KEY: Record<string, ArchetypeKey> = {
  'Floral':            'floral',
  'floral':            'floral',
  'Fruity':            'fruity',
  'fruity':            'fruity',
  'Balanced':          'balanced',
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
    name: 'Balanced',
    color: '#d1ac11',
    wallpaper: wallpaperBalanced,
    bag: bagBalanced,
    shortDescription: 'Smooth, round, and comforting. Balanced coffees are soft and approachable, often bringing caramel, honey, gentle fruit, and an easy sweetness.',
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

  // Pre-Launch Gate — /find-my-flavor is itself always open, but the results
  // and returning-user screens' ArchetypeSection surfaces (Add to Cart, Liam/
  // flavor-intelligence links, floating cart) stay hidden until launch.
  const prelaunchGated = usePrelaunchGated();

  // Step 02 (B1): per-quiz-session key for first-party funnel logging
  // (quiz_start / quiz_complete), in-memory only — new on every mount/retake.
  const sessionKeyRef = useRef<string>();
  if (!sessionKeyRef.current) sessionKeyRef.current = crypto.randomUUID();
  const quizStartFiredRef = useRef(false);

  // Quiz Remove AI Call (Change 2a-bis) — the six main-quiz answer UUIDs POSTed
  // to /api/quiz/score, held here so all four saveQuizResult call sites (not
  // just handleNext, where they're computed) can reach the same value.
  const answerIdsRef = useRef<string[]>([]);

  const [hasStarted, setHasStarted]       = useState(() => isPreview);
  const [userName, setUserName]           = useState('');
  const [currentStep, setCurrentStep]     = useState(0);
  const [isWrapping, setIsWrapping]       = useState(false);
  const [resultHeroShown, setResultHeroShown] = useState(() => isPreview);
  const [answers, setAnswers]             = useState<Record<number, number>>({});
  const [selectedIds, setSelectedIds]   = useState<Record<number, string>>({});
  const [isComplete, setIsComplete]     = useState(() => isPreview);
  const [isScoring, setIsScoring]       = useState(false);
  // Quiz Resync Fix, 2026-09-25 — no placeholder archetype: null means "no
  // score yet", full stop. Every reader below must handle null explicitly.
  const [archetypeKey, setArchetypeKey] = useState<ArchetypeKey | null>(() => previewKey ?? null);
  const [scoreError, setScoreError]     = useState(false);
  // True only once a real score (or branch/tie resolution) has landed in
  // *this* mount — resets on retake and never implicitly true on load, so
  // the resync effects below can never fire from the pre-score placeholder
  // state again. Belt-and-braces alongside archetypeKey being nullable.
  const [scoredThisSession, setScoredThisSession] = useState(false);

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
  // Part 24 — accordion: at most one of the primary/adjacent blocks unfolded
  // at a time on this screen. Independent from the results screen's below.
  const [matchedOpenBlock, setMatchedOpenBlock] = useState<'primary' | 'adjacent' | null>(null);

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
  // Part 24 — accordion for the results screen, independent from matchedOpenBlock above.
  const [resultsOpenBlock, setResultsOpenBlock] = useState<'primary' | 'adjacent' | null>(null);
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

  const { user, hasLiamAccess } = useAuth();
  // Part 21 fix (live QA / Dana, 2026-08-09) — the quiz route deliberately
  // skips PublicLayout ("own minimal chrome, no public nav/footer/cart"),
  // which meant Add to Cart silently updated the shared CartContext with
  // zero visible confirmation anywhere on this page — functionally working,
  // but indistinguishable from broken. Rendering the same FloatingCart used
  // everywhere else (not a bespoke quiz-only cart UI) restores the
  // confirmation without reversing the "no persistent nav/footer" decision —
  // just cart, still keeping the page otherwise as bare as it was.
  const { addToCart, cart, cartOpen, toggleCartOpen, removeFromCart, checkout } = useCart();
  const navigate = useNavigate();

  // Extracted so the error screen's retry button can re-run it. Checks r.ok
  // explicitly: a non-2xx (e.g. an App Check 401) used to parse its JSON error
  // body, find no questions, and only incidentally land on the error state.
  const loadQuestions = () => {
    setLoadError(false);
    setLoading(true);
    fetch('/api/quiz/questions')
      .then(r => {
        if (!r.ok) throw new Error(`quiz questions request failed: HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (data.questions?.length) setQuestions(data.questions);
        else setLoadError(true);
      })
      .catch(err => { reportError('[FlavorQuiz/questions]', err); setLoadError(true); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadQuestions(); }, []);

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
      .catch(err => reportError('[FlavorQuiz/prefill-profile]', err))
      .finally(() => { setProfileLoading(false); setProfileFetchDone(true); });
  }, [user]);

  // Find My Flavor Part 3: refresh the signed-in user's profile (specifically
  // matchedArchetypeId, which feeds the compatibility badge as `userArchetype`)
  // right after a quiz result is saved. Without this, userProfile only ever
  // refetches once per `user` reference — never after a same-session quiz
  // retake — so a freshly-scored archetype's own compatibility badge could
  // read against the *previous* match (real repro: retook Balanced ->
  // Floral, the one authored adjacency pair, and saw "Worth exploring" instead
  // of "In your wheelhouse" on Floral's own just-scored section, self-healing
  // only after a full page reload — confirmed a pure stale-state bug, not a
  // backend race, since the reload immediately showed the correct badge).
  function refreshUserProfile() {
    if (!user) return;
    getUserProfile().then(setUserProfile).catch(err => reportError('[FlavorQuiz/refresh-profile]', err));
  }

  // Archetype catalogue for the embedded ArchetypeSection — used by the returning-user
  // screen (signed-in only) and the just-scored results screen below. The latter is
  // reached by guests too (most quiz-takers), so this fetch must NOT be gated on `user`
  // (Find My Flavor Part 2 — this was the exact bug: previously `if (!user) return`).
  useEffect(() => {
    fetch('/api/coffees/archetypes')
      .then(r => r.json())
      .then((data: ArchetypeData[]) => setArchetypesList(data))
      .catch(err => reportError('[FlavorQuiz/archetypes]', err));

    // Experimental is excluded from GET /archetypes (it's a category, not one of the
    // 5 real archetypes — see coffees.ts) and presented via its own endpoint, same as
    // /bloom (BloomPage.tsx) does.
    fetch('/api/coffees/experimental')
      .then(r => r.json())
      .then((data: ArchetypeData) => setExperimentalData(data))
      .catch(err => reportError('[FlavorQuiz/experimental]', err));
  }, []);

  const matchedArchetypeId = userProfile?.archetype?.id ?? null;
  const matchedData = matchedArchetypeId
    ? archetypesList.find(a => a.archetype === matchedArchetypeId) ?? null
    : null;

  // This screen's just-scored archetype, looked up by archetype_enum rather than
  // reused from `matchedData` — `matchedData` is the signed-in user's previously
  // *saved* profile match, which may lag behind (or not exist for) what they just
  // scored on this attempt, and is never populated for guests at all.
  const resultsArchetypeEnum = archetypeKey ? ARCHETYPE_KEY_TO_ENUM[archetypeKey] : null;
  const resultsArchetypeData = !resultsArchetypeEnum
    ? null
    : resultsArchetypeEnum === 'experimental'
      ? experimentalData
      : archetypesList.find(a => a.archetype === resultsArchetypeEnum) ?? null;

  // Step 07 (A3): the 5-archetype share canon excludes Experimental (it's a category,
  // not one of the 5 archetypes with a public /match page) — underscore-to-hyphen
  // matches archetypeAssets' ARCHETYPE_SLUGS convention (chocolate_nutty -> chocolate-nutty).
  const shareSlug = !resultsArchetypeEnum || archetypeKey === 'experimental' ? null : resultsArchetypeEnum.replace('_', '-');

  // Pre-set the dial to the signed-in user's saved position for this archetype (mirrors BloomPage.tsx Phase D).
  useEffect(() => {
    if (!user || !matchedData) return;
    getDialPosition(matchedData.archetype)
      .then(r => { if (r?.dialSortOrder != null) setMatchedSortOrder(r.dialSortOrder); })
      .catch(err => reportError('[FlavorQuiz/dial-position-read]', err));
  }, [user, matchedData?.archetype]);

  function handleMatchedDialSelect(archetype: string, dialSortOrder: number) {
    setMatchedSortOrder(dialSortOrder);
    // Fire-and-forget by design, same as Profile.tsx's dial handler — the
    // dial already moved optimistically via local state above.
    if (user) setDialPosition(archetype, dialSortOrder).catch(err => reportError('[FlavorQuiz/dial-position-write]', err));
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
      .catch(err => reportError('[FlavorQuiz/dial-position-read]', err));
  }, [user, resultsArchetypeData?.archetype]);

  function handleResultsDialSelect(archetype: string, dialSortOrder: number) {
    setResultsSortOrder(dialSortOrder);
    if (user) setDialPosition(archetype, dialSortOrder).catch(err => reportError('[FlavorQuiz/dial-position-write]', err));
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
    // localStorage unavailable (private/incognito browsing, blocked storage) — not
    // an error, just means this browser never remembers a recognized guest.
    try { return localStorage.getItem(POST_QUIZ_EMAIL_KEY); } catch { return null; }
  });
  const emailGateUnlocked = (!!user && !user.isAnonymous) || !!postQuizEmail;
  const signedInSubscribeFiredRef = useRef<string | null>(null); // last archetype synced
  const recognizedGuestSyncedRef = useRef<string | null>(null); // last archetype synced, avoids re-firing every render
  const [showSignedInConsentNote, setShowSignedInConsentNote] = useState(false);
  // Pre-Launch Reveal-in-Inbox — true only for the render(s) right after a
  // LIVE submit this mount (not one loaded from localStorage on mount/reload),
  // so the sealed confirmation shows the address unmasked exactly once, then
  // masked on any later reload — same distinction acceptance criteria 2 vs 3 draw.
  const [sealedJustSubmitted, setSealedJustSubmitted] = useState(false);
  // Signed-in real accounts always show their own (already-known) address
  // unmasked — masking is only for the guest reload case, per spec §2.
  const sealedEmail = (user && !user.isAnonymous)
    ? (userProfile?.email ?? user.email ?? '')
    : (postQuizEmail ? (sealedJustSubmitted ? postQuizEmail : maskEmail(postQuizEmail)) : '');

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
    if (!archetypeKey) return; // gate only ever renders post-score — belt and braces
    // localStorage unavailable (private/incognito browsing, blocked storage) — not
    // an error; the guest just won't be recognized as returning next time.
    try { localStorage.setItem(POST_QUIZ_EMAIL_KEY, submittedEmail); } catch {}
    setPostQuizEmail(submittedEmail);
    const name = ARCHETYPES[archetypeKey].name;
    // Quiz Resync Fix, Part A5 — PostQuizEmailGate already POSTed this exact
    // subscribe call itself (see its handleSubmit) before calling onSuccess.
    // Mark it synced now so the resync effect below, which also depends on
    // postQuizEmail and is about to re-run because we just set it, sees
    // recognizedGuestSyncedRef.current === name and skips — otherwise it
    // double-fires the same subscribe call ~200ms later (the "two calls per
    // signup" pattern the audit found).
    recognizedGuestSyncedRef.current = name;
    trackEvent('EmailSubmitted', { archetype: name });
    trackLead({ archetype: name });
    const activeCampaign = getActiveCampaign();
    logQuizFunnelEvent(sessionKeyRef.current!, 'email_submitted', name, activeCampaign ? { campaign: activeCampaign.slug, vid: activeCampaign.vid } : undefined).catch(err => reportError('[FlavorQuiz/funnel-event]', err));
  }

  // Recognized guest (local flag from a previous submit) or a retake in the same
  // session — resync the subscriber row to the current archetype, silently, no
  // card, no repeat ask, no analytics event (they already submitted once).
  useEffect(() => {
    // Quiz Resync Fix, Part A1/A2 — must not fire from the pre-score
    // placeholder state (page load, retake-in-progress, anonymous→signed-in
    // transition before a new score exists). archetypeKey is nullable now,
    // so this null check is redundant with scoredThisSession in practice,
    // but kept as an explicit second guard per the brief.
    if (!scoredThisSession) return;
    if (!archetypeKey || !resultsArchetypeData || (user && !user.isAnonymous) || !postQuizEmail) return;
    const name = ARCHETYPES[archetypeKey].name;
    if (recognizedGuestSyncedRef.current === name) return;
    recognizedGuestSyncedRef.current = name;
    const activeCampaignResync = getActiveCampaign();
    subscribeNewsletter({
      email: postQuizEmail,
      source: 'post_quiz',
      archetype: name,
      experimental: archetypeKey === 'experimental',
      confidence: scoreData?.foodSignalAlignment,
      quizSessionKey: sessionKeyRef.current,
      ...(activeCampaignResync ? { campaign: activeCampaignResync.slug, campaignVid: activeCampaignResync.vid } : {}),
    }).catch(err => reportError('[FlavorQuiz/resync-guest-subscriber]', err));
  }, [user, postQuizEmail, resultsArchetypeData, archetypeKey, scoredThisSession]);

  // Signed-in users: never see the card. Auto-subscribe (source post_quiz) with a
  // one-line consent note shown once — only when they weren't already a subscriber;
  // an existing subscriber's row is just silently resynced to the new archetype.
  useEffect(() => {
    // Quiz Resync Fix, Part A1/A2 — same guard as the guest effect above.
    if (!scoredThisSession) return;
    if (!user || user.isAnonymous || !archetypeKey || !resultsArchetypeData || !userProfile || !profileFetchDone) return;
    const name = ARCHETYPES[archetypeKey].name;
    if (signedInSubscribeFiredRef.current === name) return;
    signedInSubscribeFiredRef.current = name;
    const wasAlreadySubscribed = userProfile.isNewsletterSubscriber === true;
    const activeCampaignSignedIn = getActiveCampaign();
    subscribeNewsletter({
      email: userProfile.email ?? user.email ?? '',
      firstName: userProfile.firstName ?? undefined,
      source: 'post_quiz',
      archetype: name,
      experimental: archetypeKey === 'experimental',
      confidence: scoreData?.foodSignalAlignment,
      quizSessionKey: sessionKeyRef.current,
      ...(activeCampaignSignedIn ? { campaign: activeCampaignSignedIn.slug, campaignVid: activeCampaignSignedIn.vid } : {}),
    }).then(() => {
      if (!wasAlreadySubscribed) {
        trackEvent('EmailSubmitted', { archetype: name });
        trackLead({ archetype: name });
        logQuizFunnelEvent(sessionKeyRef.current!, 'email_submitted', name, activeCampaignSignedIn ? { campaign: activeCampaignSignedIn.slug, vid: activeCampaignSignedIn.vid } : undefined).catch(err => reportError('[FlavorQuiz/funnel-event]', err));
        setShowSignedInConsentNote(true);
      }
    }).catch(err => reportError('[FlavorQuiz/signed-in-subscribe]', err));
  }, [user, userProfile, profileFetchDone, resultsArchetypeData, archetypeKey, scoredThisSession]);

  // Bug fix (Find My Flavor Part 2, Bug 1): preload the scored archetype's wallpaper
  // as soon as it's known (archetypeKey is set well before isComplete/the results
  // screen mounts — including during the branch question's async round trip), so by
  // the time the curtain renders the ~1MB JPG is already cached and there's no pop-in
  // even on a slow connection. Pairs with the opaque backgroundColor fallback on the
  // curtain div itself below, which covers the case this doesn't (a cold cache).
  useEffect(() => {
    const src = archetypeKey ? ARCHETYPES[archetypeKey]?.wallpaper : undefined;
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

  // Campaign fast-start (2026-09-10) — a direct campaign-link arrival
  // (?campaign=<key of CAMPAIGNS>, e.g. an Instagram/Facebook bio link) skips the
  // anonymous entry screen straight to question 1, same state transition as the
  // axisBloomCustomerName effect above (setHasStarted(true), name left '' — collected
  // at the end on the email card instead, via its existing initialFirstName prop).
  // Never touches userName itself, so if the sessionStorage effect above also fires
  // (arrives with both a stored name AND a campaign param — not expected in practice,
  // /crawl's own URL never carries ?campaign=), its real name naturally wins either way.
  // Recognized returning users must still see "Welcome back" (Decision 2) — waits for
  // profileFetchDone before deciding for a signed-in visitor, same pattern as the
  // ?retake=1 handler below; a guest is decided immediately.
  const campaignFastStartHandledRef = useRef(false);
  useEffect(() => {
    if (campaignFastStartHandledRef.current) return;
    const campaignParam = searchParams.get('campaign');
    if (!campaignParam || !(campaignParam in CAMPAIGNS)) return; // no/unknown campaign — today's entry screen renders normally
    if (user && !profileFetchDone) return; // signed-in — wait for the profile fetch to actually resolve

    campaignFastStartHandledRef.current = true;
    if (user && userProfile?.archetype) return; // recognized returning user — let "Welcome back" render instead
    setHasStarted(true);
  }, [searchParams, user, profileFetchDone, userProfile]);

  // Scroll to top when result becomes visible (e.g. ?result= preview shortcut)
  useEffect(() => {
    if (isComplete) window.scrollTo({ top: 0 });
  }, [isComplete]);

  // After papers part, move focus to the hero heading (§6 a11y)
  useEffect(() => {
    if (resultHeroShown) heroHeadingRef.current?.focus();
  }, [resultHeroShown]);

  // Only dereferenced (archetype!.x) in JSX that renders inside isComplete —
  // isComplete only ever becomes true after archetypeKey has been set from a
  // real score (see the WrapOverlay/onShowResult wiring below), so archetype
  // is never actually undefined where it's read. Null before that.
  const archetype = archetypeKey ? ARCHETYPES[archetypeKey] : null;

  // The scoring result carries the full picture (secondary archetype, food signal,
  // recommendation mode, experimental flag). Every save path must send all of it —
  // the backend stores it in quiz_session.context_data and the Firestore mirror, and
  // previously fell through to defaults because the frontend only sent four fields.
  function buildQuizResultPayload(
    score: ScoreResult,
    finalArchetype: string,
    branchedFrom: string | null = null,
    branchAnswerId: string | null = null,
  ) {
    return {
      archetype:           finalArchetype,
      scores:              score.scores,
      answers,
      answerIds:           answerIdsRef.current, // raw quiz_answer UUIDs — makes the session replayable
      decaf:               false,
      branchedFrom,
      // Interpretation v2.2: the branch answer picked (null when no branch was shown). The server stores it on
      // the session and derives the Bloom Dial match from it; the screen still shows finalArchetype.
      branchAnswerId,
      // On a real reclassification (branchedFrom non-null) the branch parent is the
      // user's most relevant second flavor — it was their single highest scorer and
      // the archetype they refined away from. The scored runner-up is intentionally
      // demoted; it stays derivable from `scores`, which is persisted in full.
      // Decided 2026-08-11 — do not "fix" this back to score.secondaryArchetype.
      secondaryArchetype:  branchedFrom ?? score.secondaryArchetype,
      foodSignal:          score.foodSignal,
      foodSignalAlignment: score.foodSignalAlignment,
      recommendationMode:  score.recommendationMode,
      experimental:        score.experimental,
      // Interpretation v2.1, informational: brief 2 recomputes server-side from answerIds.
      secondaryPath:         score.secondaryPath,
      pairConfidence:        score.pairConfidence,
      exploreArchetype:      score.exploreArchetype,
      exploreReason:         score.exploreReason,
      primaryMargin:         score.primaryMargin,
      interpretationVersion: score.interpretationVersion,
    };
  }

  const handleNext = async () => {
    if (currentStep < questions.length - 1) {
      setCurrentStep(p => p + 1);
      return;
    }

    setIsScoring(true);
    setScoreError(false);
    try {
      const answerIds = Object.values(selectedIds);
      answerIdsRef.current = answerIds;

      const scoreRes = await fetch('/api/quiz/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answerIds }),
      });
      if (!scoreRes.ok) throw new Error('Score request failed');
      const score: ScoreResult = await scoreRes.json();
      setScoreData(score);

      trackEvent('QuizComplete', { archetype: score.archetype });
      const activeCampaignComplete = getActiveCampaign();
      logQuizFunnelEvent(sessionKeyRef.current!, 'quiz_complete', score.archetype, activeCampaignComplete ? { campaign: activeCampaignComplete.slug, vid: activeCampaignComplete.vid } : undefined).catch(err => reportError('[FlavorQuiz/funnel-event]', err));

      // Quiz Resync Fix Part A3 — an unrecognized archetype name from the
      // server is now an explicit failure (scoreError), never a silent
      // 'balanced' guess that could show the wrong card.
      const key = ARCHETYPE_NAME_TO_KEY[score.archetype];
      if (!key) {
        reportError('[FlavorQuiz/unknown-archetype]', new Error(`Unknown archetype name from server: ${score.archetype}`));
        setScoreError(true);
        return;
      }
      setArchetypeKey(key);
      setScoredThisSession(true);

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

      // Quiz Resync Fix Part A4 — no branch question for this archetype, so
      // score.archetype is the final, on-screen result: log it on its own
      // funnel row so the funnel has the true on-screen archetype even when
      // nothing branches (quiz_complete stays the pre-branch score, unchanged).
      const activeCampaignFinal = getActiveCampaign();
      logQuizFunnelEvent(sessionKeyRef.current!, 'quiz_final', score.archetype, activeCampaignFinal ? { campaign: activeCampaignFinal.slug, vid: activeCampaignFinal.vid } : undefined).catch(err => reportError('[FlavorQuiz/funnel-event]', err));

      if (user) {
        saveQuizResult(buildQuizResultPayload(score, score.archetype))
          .then(refreshUserProfile)
          // Fire-and-forget: the results screen already shows the real,
          // independently-computed archetype match regardless of whether
          // this persistence call succeeds — no "saved" claim is made here
          // for this to falsify. Upgraded from console.error (invisible in
          // prod) to reportError so a real save failure actually reaches
          // Cloud Logging instead of only a browser devtools panel no one
          // is watching.
          .catch(err => reportError('[FlavorQuiz/save-quiz-result]', err));
      }
      setIsWrapping(true);
    } catch (err) {
      console.error('[quiz/score]', err);
      reportError('[FlavorQuiz/score]', err);
      setScoreError(true);
    } finally {
      setIsScoring(false);
    }
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
    // Quiz Resync Fix Part A3 — no placeholder archetype; null until the
    // retaken quiz actually scores. Part A1 — scoredThisSession resets too.
    setArchetypeKey(null);
    setScoredThisSession(false);
    sessionKeyRef.current = crypto.randomUUID();
    quizStartFiredRef.current = false;
    answerIdsRef.current = [];
  };

  // ── Website 7A: "Exit ×" returns to the entry scene; with answers given it asks
  //    first, in the design's own dialog (never window.confirm).
  const [exitAsk, setExitAsk] = useState(false);

  // ── Auto-advance: always hold the latest handleNext in a ref so the AUTO_ADVANCE_MS (420 ms)
  //    timer fires against fresh state rather than a stale closure capture.
  const autoAdvanceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNextRef   = useRef(handleNext);
  handleNextRef.current = handleNext;

  const handleAnswerSelect = (answerId: string, answerIdx: number) => {
    if (currentStep === 0 && !quizStartFiredRef.current) {
      quizStartFiredRef.current = true;
      trackEvent('QuizStart');
      const activeCampaignStart = getActiveCampaign();
      logQuizFunnelEvent(sessionKeyRef.current!, 'quiz_start', undefined, activeCampaignStart ? { campaign: activeCampaignStart.slug, vid: activeCampaignStart.vid } : undefined).catch(err => reportError('[FlavorQuiz/funnel-event]', err));
    }
    setAnswers(prev => ({ ...prev, [currentStep]: answerIdx }));
    setSelectedIds(prev => ({ ...prev, [currentStep]: answerId }));
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    autoAdvanceRef.current = setTimeout(() => handleNextRef.current(), AUTO_ADVANCE_MS);
  };

  function exitToEntry() {
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    setExitAsk(false);
    handleRetake();
    setHasStarted(false);
  }
  function requestExit() {
    const answered = Object.keys(selectedIds).length > 0 || !!selectedBranchAnswerId || showTieInterstitial;
    if (answered) setExitAsk(true); else exitToEntry();
  }

  const handleBranchAnswerSelect = (answerId: string) => {
    setSelectedBranchAnswerId(answerId);
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    autoAdvanceRef.current = setTimeout(() => {
      if (!scoreData || !branchQuestion) return;
      const selected = branchQuestion.answers.find(a => a.id === answerId);
      const finalArchetypeName = selected?.archetypeName ?? scoreData.archetype;
      // Quiz Resync Fix Part A3 — explicit failure, not a silent fallback to
      // the previous (pre-branch) archetypeKey. (The Continue-button twin of
      // this handler, handleBranchContinue, was removed 2026-10-09: dead since
      // the 2026-07-18 rebuild dropped its button.)
      const newKey = ARCHETYPE_NAME_TO_KEY[finalArchetypeName];
      if (!newKey) {
        reportError('[FlavorQuiz/unknown-archetype]', new Error(`Unknown archetype name from branch: ${finalArchetypeName}`));
        setScoreError(true);
        setShowBranch(false);
        return;
      }
      setArchetypeKey(newKey);
      setScoredThisSession(true);

      // Quiz Resync Fix Part A4 — the post-branch, on-screen result, on its own row.
      const activeCampaignFinalAuto = getActiveCampaign();
      logQuizFunnelEvent(sessionKeyRef.current!, 'quiz_final', finalArchetypeName, activeCampaignFinalAuto ? { campaign: activeCampaignFinalAuto.slug, vid: activeCampaignFinalAuto.vid } : undefined).catch(err => reportError('[FlavorQuiz/funnel-event]', err));

      if (user) {
        // Every Balanced-branch answer resolves to Balanced, so branchedFrom stays null there and the screen
        // shows Balanced; the picked answer still travels as branchAnswerId (Prompt 4B).
        const branchedFrom = finalArchetypeName !== scoreData.archetype ? scoreData.archetype : null;
        saveQuizResult(buildQuizResultPayload(scoreData, finalArchetypeName, branchedFrom, answerId))
          .then(refreshUserProfile)
          // Fire-and-forget: the results screen already shows the real,
          // independently-computed archetype match regardless of whether
          // this persistence call succeeds — no "saved" claim is made here
          // for this to falsify. Upgraded from console.error (invisible in
          // prod) to reportError so a real save failure actually reaches
          // Cloud Logging instead of only a browser devtools panel no one
          // is watching.
          .catch(err => reportError('[FlavorQuiz/save-quiz-result]', err));
      }
      setShowBranch(false);
      setIsWrapping(true);
    }, AUTO_ADVANCE_MS);
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
  // Website 7A: both on the entry photo, the site header floating over it.
  if (loading && !isPreview) {
    return <StatusScene image={ENTRY_IMAGE} header={<Navigation tone="paper" floating />} title="Loading…" />;
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if ((loadError || !questions.length) && !isPreview) {
    return (
      <StatusScene image={ENTRY_IMAGE} header={<Navigation tone="paper" floating />} title="We couldn’t load the quiz.">
        <div className="qz-efoot"><Btn tone="paper" onClick={loadQuestions}>Try again</Btn></div>
      </StatusScene>
    );
  }

  // ── Returning user ───────────────────────────────────────────────────────────
  if (!isPreview && user && !hasStarted && (profileLoading || userProfile?.archetype)) {
    if (profileLoading) {
      return <StatusScene image={ENTRY_IMAGE} header={<Navigation tone="paper" floating />} title="Loading…" />;
    }

    const existingArchetype = userProfile?.archetype;
    const firstName = userProfile?.firstName ?? user.displayName?.split(' ')[0] ?? 'there';

    // Pre-Launch Reveal-in-Inbox §2 — a returning visitor reloading this
    // screen would otherwise see "Your primary profile is [archetype]" and
    // the full folded dial block, breaking the inbox-only seal for anyone
    // who already finished. Confirmation-style state instead; retake stays
    // (same handler the full screen's own "Retake the quiz" item uses below).
    // Website 7A: drawn on the entry photo; logic unchanged.
    if (prelaunchGated) {
      return (
        <Scene image={ENTRY_IMAGE} label="Welcome back" testId="quiz-returning-sealed">
          <Navigation tone="paper" floating />
          <div className="ab-wrap qz-in">
            <div className="qz-entry">
              <Caps weight={400}>Welcome back, {firstName}</Caps>
              <h1 className="qz-eh">Your match is waiting.</h1>
              <p className="qz-ep">Check the inbox you signed up with, or find it any time on your profile.</p>
              <div className="qz-efoot">
                <Btn tone="paper" onClick={() => { handleRetake(); setUserName(firstName); setHasStarted(true); }}>Retake the quiz</Btn>
                <Link to="/profile" className="ab-caps qz-ulink" style={{ fontWeight: 400 }}>Your flavor profile →</Link>
              </div>
            </div>
          </div>
        </Scene>
      );
    }

    const archetypeColor = existingArchetype?.color ?? '#a33726';
    const lastQuizDate = userProfile?.lastQuizDate
      ? new Date(userProfile.lastQuizDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null;

    // Part 22 §4 — the "More you can do" link row, one quiet uppercase row
    // (wrapping), replacing the old stranded nav column. Labels match the
    // prompt's own §4 item 4 list verbatim (previously longer/differently
    // worded — "Talk to our coffee sommelier" -> "Talk to Liam", etc.); hrefs/
    // actions unchanged from before this pass.
    // Pre-Launch Gate: "Talk to Liam" and "Flavor intelligence" both point at
    // hidden routes while gated — omitted rather than shown, same rule as the
    // trimmed nav ("never show a door we won't open").
    const navItems = [
      { label: 'Retake the quiz',      action: () => { handleRetake(); setUserName(firstName); setHasStarted(true); } },
      // Liam access & cost brief (2026-10-01): also only for subscribers/admins.
      ...(prelaunchGated || !hasLiamAccess ? [] : [{ label: 'Talk to Liam',         href: '/sommelier?entry=user_initiated' }]),
      { label: 'Your flavor profile',  href: '/profile' },
      ...(prelaunchGated ? [] : [{ label: 'Flavor intelligence',  href: '/flavor-intelligence' }]),
      { label: 'Create a household party', href: '/profile?tab=family' },
    ];

    return (
      <div className="relative w-full min-h-screen qz-below" data-testid="quiz-returning">
        {/* Website 7A — the welcome on the entry photo (Welcome back, the saved
            archetype, retake); what followed it stays below, unchanged. */}
        <Scene image={ENTRY_IMAGE} label="Welcome back">
          <Navigation tone="paper" floating />
          <div className="ab-wrap qz-in">
            <div className="qz-entry">
              <Caps weight={400}>Welcome back, {firstName}</Caps>
              <p className="qz-ep" style={{ margin: 0 }}>Your primary profile is</p>
              <h1 className="qz-eh" data-testid="quiz-returning-archetype">{existingArchetype?.name ?? '—'}</h1>
              {existingArchetype?.description && <p className="qz-ep">{existingArchetype.description}</p>}
              <div className="qz-efoot">
                <Btn tone="paper" onClick={() => { handleRetake(); setUserName(firstName); setHasStarted(true); }}>Retake the quiz</Btn>
                {lastQuizDate && <Caps weight={400}>Last quiz · {lastQuizDate}</Caps>}
              </div>
            </div>
          </div>
        </Scene>
        {/* Part 22 — one ~760px centered column, as before. */}
        <div className="px-6 md:px-10 pt-16 pb-20">
          <div className="max-w-[760px] mx-auto">

            {/* 2 — the folded block, breaking out past the column on unfold. */}
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
                folded
                unfoldMode="breakout"
                showBreakoutHeader={false}
                ceremonyTag="YOUR SPOT · FROM YOUR QUIZ"
                prelaunch={prelaunchGated}
                onOpenChange={open => setMatchedOpenBlock(prev => open ? 'primary' : (prev === 'primary' ? null : prev))}
                forceFold={matchedOpenBlock === 'adjacent'}
              />
            )}

            <hr className="border-0 border-t border-[#deded1] my-[34px]" />

            {/* 3 — Worth Exploring + adjacent-archetype section (Part 17 §F),
                same mechanism as Profile.tsx: cross-archetype hop chips on
                this screen have somewhere to land instead of doing nothing.
                Part 24: folded + breakout like the primary block above, and
                accordion-linked to it via matchedOpenBlock. */}
            {matchedArchetypeId && archetypesList.length > 0 && (
              <WorthExploring
                matchArchetypeId={matchedArchetypeId}
                adjacency={adjacency}
                archetypesList={archetypesList}
                activeArchetype={matchedAdjacent.adjacentArchetypeId}
                onSelect={matchedAdjacent.handleChipClick}
              />
            )}
            {matchedAdjacent.adjacentData && (
              <div ref={matchedAdjacent.sectionRef} className="mt-6">
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
                  prelaunch={prelaunchGated}
                  folded
                  unfoldMode="breakout"
                  onOpenChange={open => setMatchedOpenBlock(prev => open ? 'adjacent' : (prev === 'adjacent' ? null : prev))}
                  forceFold={matchedOpenBlock === 'primary'}
                />
              </div>
            )}

            <hr className="border-0 border-t border-[#deded1] my-[34px]" />

            {/* 4 — "More you can do": one quiet uppercase link row, wrapping. */}
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/40 mb-4">More you can do</p>
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              {navItems.map(item =>
                item.href ? (
                  <Link
                    key={item.label}
                    to={item.href}
                    className="text-[10px] uppercase tracking-[0.2em] text-[#a33726] opacity-85 hover:opacity-100 transition-opacity"
                  >
                    {item.label} →
                  </Link>
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    onClick={item.action}
                    className="text-[10px] uppercase tracking-[0.2em] text-[#a33726] opacity-85 hover:opacity-100 transition-opacity"
                  >
                    {item.label} →
                  </button>
                )
              )}
            </div>

          </div>
        </div>

        <CompareOverlay
          open={compareState.open}
          onClose={() => setCompareState(s => ({ ...s, open: false }))}
          left={compareState.slot ? { archetype: compareState.archetype, archetypeLabel: compareState.archetypeLabel, slot: compareState.slot } : null}
          archetypes={archetypesList}
        />
        {!prelaunchGated && (
          <FloatingCart
            items={cart}
            open={cartOpen}
            onToggle={toggleCartOpen}
            onRemove={removeFromCart}
            onCheckout={checkout}
            isSignedIn={!!user}
          />
        )}
      </div>
    );
  }

  // ── Name screen (door) ───────────────────────────────────────────────────────
  // Website 7A: option B's entry scene. The name is optional (Begin is always
  // enabled); the question count comes from the payload (D15).
  if (!hasStarted) {
    return (
      <Scene image={ENTRY_IMAGE} label="Find my flavor" testId="quiz-entry-scene">
        <Navigation tone="paper" floating />
        <EntryBody
          leadCount={numberWord(questions.length)}
          name={userName}
          onName={setUserName}
          onBegin={() => setHasStarted(true)}
          signedInLine={user && !user.isAnonymous ? signedInNameScreenLine(user.email) : null}
          showSignIn={!user || user.isAnonymous}
        />
      </Scene>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Single return — quiz and result phases share the same render tree so the
  // WrapOverlay (a fixed sibling) stays mounted across the question→result switch.

  // Computed on every render, including every pre-score question screen now
  // that archetypeKey starts null — guarded so it never crashes there. Only
  // actually consumed by WrapOverlay once isWrapping is true, which (per the
  // wiring below) never happens until a real score has set archetypeKey.
  const nightScanSrc = archetypeKey ? quizResultAssets[QUIZ_KEY_TO_SLUG[archetypeKey]].src : undefined;
  const isOnQuestion = !isComplete && !showBranch && !showTieInterstitial;
  const isOnBranch   = !isComplete && showBranch && !!branchQuestion;
  const isOnTie      = showTieInterstitial && !!scoreData;

  const currentQ     = isOnQuestion && currentStep < questions.length ? questions[currentStep] : null;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  // Website 7A: the progress bar that replaces the header while questions run.
  const progressBar = (done: number, extra: string | null = null) => (
    <ProgressBar name={userName.trim()} total={questions.length} done={done} extra={extra} showSave={!user} onExit={requestExit} />
  );
  // The tie's "See my primary result", unchanged (moved out of the JSX only).
  const seeTiePrimary = () => {
    setShowTieInterstitial(false);
    // Quiz Resync Fix Part A4 — archetypeKey was already set to the primary
    // score in handleNext, before the tie interstitial showed; this is that
    // same no-branch final result, just reached via the tie path.
    const activeCampaignFinalTie = getActiveCampaign();
    logQuizFunnelEvent(sessionKeyRef.current!, 'quiz_final', scoreData!.archetype, activeCampaignFinalTie ? { campaign: activeCampaignFinalTie.slug, vid: activeCampaignFinalTie.vid } : undefined).catch(err => reportError('[FlavorQuiz/funnel-event]', err));
    if (user) {
      saveQuizResult(buildQuizResultPayload(scoreData!, scoreData!.archetype))
        .then(refreshUserProfile).catch(err => reportError('[FlavorQuiz/save-quiz-result]', err));
    }
    setIsWrapping(true);
  };

  const archetypeNameMapTie: Record<string, string> = {
    floral: 'Floral', fruity: 'Fruity', balanced: 'Balanced',
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
      {/* ── Question phase (Website 7A: option B's question scene) ───────────── */}
      {isOnQuestion && currentQ && (
        <QuestionScene
          key={`q-${currentStep}`}
          image={sceneImageOf(currentQ.image_asset_key)}
          bar={progressBar(currentStep + 1)}
          counter={<>{pad2(currentStep + 1)} <span style={{ opacity: 0.6 }}>/ {pad2(questions.length)}</span></>}
          question={currentQ.q_text}
          answers={currentQ.answers.map(a => ({ id: a.id, text: a.text }))}
          selectedId={selectedIds[currentStep] ?? null}
          onSelect={handleAnswerSelect}
          onBack={currentStep > 0 ? () => { if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current); setCurrentStep(p => p - 1); } : null}
          status={isScoring
            ? <Caps weight={400}>Finding your profile…</Caps>
            : scoreError
              ? <span style={{ display: 'inline-flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Caps weight={400}>Something went wrong.</Caps>
                  <button type="button" className="ab-caps qz-ulink" onClick={() => handleNextRef.current()}>Try again</button>
                </span>
              : null}
          testId="quiz-question"
        />
      )}

      {/* ── Branch: scene N+1, "One more" without renumbering ─────────────────── */}
      {isOnBranch && (
        <QuestionScene
          key="branch"
          image={sceneImageOf(branchQuestion!.imageAssetKey)}
          bar={progressBar(questions.length, 'One more')}
          counter="One more"
          question={branchQuestion!.questionText}
          answers={branchQuestion!.answers.map(a => ({ id: a.id, text: a.text }))}
          selectedId={selectedBranchAnswerId}
          onSelect={id => handleBranchAnswerSelect(id)}
          onBack={null}
          testId="quiz-branch"
        />
      )}

      {/* ── Tie ───────────────────────────────────────────────────────────────── */}
      {isOnTie && (
        <Scene image={ENTRY_IMAGE} label="A perfect tie" testId="quiz-tie">
          {progressBar(questions.length)}
          <div className="ab-wrap qz-in">
            <div className="qz-entry">
              <Caps weight={400}>A perfect tie</Caps>
              <h2 className="qz-eh" style={{ maxWidth: '14ch' }}>
                {tiedNames.length === 2 ? <>{tiedNames[0]} &amp; {tiedNames[1]}</> : tiedNames.join(' · ')}
              </h2>
              <p className="qz-ep">
                {prelaunchGated
                  ? 'Your palate sits at the edge of two worlds.'
                  : 'Your palate sits at the edge of two worlds. Liam, our coffee sommelier, can help you find exactly where you land.'}
              </p>
              <div className="qz-efoot">
                {/* /sommelier is a hidden route while gated — omitted, same rule as every other Liam entry point. */}
                {!prelaunchGated && hasLiamAccess && (
                  <Btn tone="paper" onClick={() => { window.location.href = `/sommelier?entry=quiz_tie&tied=${encodeURIComponent(tiedParam)}`; }}>Talk to Liam</Btn>
                )}
                <button type="button" className="ab-caps qz-ulink" onClick={seeTiePrimary}>See my primary result</button>
              </div>
            </div>
          </div>
        </Scene>
      )}

      {exitAsk && <ExitConfirm onLeave={exitToEntry} onStay={() => setExitAsk(false)} />}

      {/* ── Result screen ────────────────────────────────────────────────────── */}
      {isComplete && (
        <div>
          <QuizHeader />

          {prelaunchGated ? (
            /* Pre-Launch Reveal-in-Inbox — sealed ending. No Section 1 reveal
               (no archetype name/wallpaper/color), no Sections 2-3: the email
               card (or, once unlocked, a confirmation) IS the entire screen.
               Reused verbatim once the flag flips off / under ?preview=true —
               see the unchanged branch below. */
            <section style={{ background: 'var(--ab-paper)', minHeight: 'calc(100dvh - 52px)', display: 'flex', alignItems: 'center', padding: 'clamp(72px,10vh,120px) clamp(20px,5vw,40px) 90px' }}>
              {emailGateUnlocked ? (
                <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'left' }}>
                  <h2 style={{ fontSize: 'clamp(28px,3vw,42px)', fontWeight: 400, color: 'var(--ab-ink)', lineHeight: 1.25, margin: '0 0 14px', letterSpacing: '-0.01em' }}>
                    It's on its way to {sealedEmail}. Open it to meet your match.
                  </h2>
                  <p style={{ fontSize: 13, color: 'rgba(26,26,26,0.45)', letterSpacing: '.06em', margin: 0 }}>
                    You're on the first-access list for this fall.
                  </p>
                </div>
              ) : (
                <PostQuizEmailGate
                  archetypeName={archetype!.name}
                  archetypeColor={RUST}
                  experimental={archetypeKey === 'experimental'}
                  confidence={scoreData?.foodSignalAlignment}
                  sessionKey={sessionKeyRef.current!}
                  onSuccess={email => { setSealedJustSubmitted(true); handleGateSuccess(email); }}
                  sealed
                  initialFirstName={userName}
                />
              )}
            </section>
          ) : (
            <>
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
                      background: `color-mix(in srgb, ${archetype!.color} 82%, #f2f1ea)`,
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
                    {archetype!.name}.
                  </h1>
                  <p style={{ maxWidth: 560, margin: '0 auto', fontSize: 15.5, lineHeight: 1.7, color: 'rgba(242,241,234,.88)', padding: '0 clamp(20px,5vw,32px)', ...stagger('.7s') }}>
                    {archetype!.shortDescription}
                  </p>
                </div>
                {/* Scroll cue */}
                <div aria-hidden="true" style={{
                  position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)',
                  width: 1, height: 26, zIndex: 2,
                  background: `color-mix(in srgb, ${archetype!.color} 70%, #f2f1ea)`,
                }} />
              </section>

              {/* Share row — available before gate unlock, hidden for Experimental (no share page) */}
              <ShareMatchRow archetypeName={archetype!.name} shareSlug={shareSlug} />

              {/* Gate / post-hero. Part 24 — the archetype block(s) below now unfold
                  in breakout mode, whose 40/60 + centering math assumes a plain,
                  unpadded ~760px column (Part 22's own column, same pattern as
                  Find My Flavor returning's px-6/max-w-[760px] split above). This
                  screen never had that wrapper — its DialArchetypeSection mounts
                  rendered at the full page width, which the old inline unfold
                  papered over (fixed 480px card, self-centered via flexbox) but
                  breakout's width:100% reading column does not: caught live as a
                  match card stretched edge-to-edge across a wide monitor. */}
              {emailGateUnlocked ? (
                <>
                <div className="px-6 md:px-10 pb-20">
                <div className="max-w-[760px] mx-auto">
                  <GateStatusNote
                    showSignedInConsentNote={showSignedInConsentNote}
                    guestMaskedEmail={!user && postQuizEmail ? maskEmail(postQuizEmail) : null}
                  />
                  {resultsArchetypeData && (
                    <>
                      {/* Part 21 §3.1 — new result header, above the folded block:
                          micro "Your match" -> archetype name large -> family
                          line (matchCopy.ts). Distinct from the cinematic
                          night-scan hero above (that's the reveal moment); this
                          is the block's own header, bridging into commerce. */}
                      <div style={{ textAlign: 'center', margin: '0 auto', padding: '0 20px 34px', maxWidth: 680 }}>
                        <p style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#7b7f80', marginBottom: 12 }}>
                          Your match
                        </p>
                        <p style={{ fontSize: 'clamp(40px, 7vw, 60px)', fontWeight: 500, color: '#a02c1c', letterSpacing: '-0.01em', lineHeight: 0.95, margin: 0 }}>
                          {resultsArchetypeData.archetypeLabel.toUpperCase()}
                        </p>
                        <p style={{ fontSize: 15.5, fontWeight: 300, color: '#45474a', marginTop: 14 }}>
                          {FAMILY_LINES[resultsArchetypeEnum!] ?? `That's your family — ${resultsArchetypeData.archetypeLabel.toLowerCase()}, through and through.`}
                        </p>
                      </div>
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
                        folded
                        unfoldMode="breakout"
                        showBreakoutHeader={false}
                        ceremonyTag="YOUR SPOT · FROM YOUR QUIZ"
                        prelaunch={prelaunchGated}
                        onOpenChange={open => setResultsOpenBlock(prev => open ? 'primary' : (prev === 'primary' ? null : prev))}
                        forceFold={resultsOpenBlock === 'adjacent'}
                      />
                    </>
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
                        prelaunch={prelaunchGated}
                        folded
                        unfoldMode="breakout"
                        onOpenChange={open => setResultsOpenBlock(prev => open ? 'adjacent' : (prev === 'adjacent' ? null : prev))}
                        forceFold={resultsOpenBlock === 'primary'}
                      />
                    </div>
                  )}

                  {/* Way out of the results: where the profile lives, and home. Signed-in
                      users get both; anonymous users' profile path is the email gate above. */}
                  <nav aria-label="Next steps" className="flex flex-wrap justify-center gap-x-9 gap-y-3 mt-14">
                    {user && !user.isAnonymous && (
                      <Link to="/profile" className={QUIET_LINK_CLASS}>Your flavor profile →</Link>
                    )}
                    <Link to="/" className={QUIET_LINK_CLASS}>Back to home →</Link>
                  </nav>
                </div>
                </div>
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
                    archetypeName={archetype!.name}
                    archetypeColor={archetype!.color}
                    experimental={archetypeKey === 'experimental'}
                    confidence={scoreData?.foodSignalAlignment}
                    sessionKey={sessionKeyRef.current!}
                    onSuccess={handleGateSuccess}
                    initialFirstName={userName}
                  />
                </section>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Wrap overlay — fixed, stays mounted across question→result switch ──
           heroImageSrc uses ! — isWrapping is never true before archetypeKey
           is set for real, see nightScanSrc above. */}
      {isWrapping && (
        <WrapOverlay
          name={userName}
          heroImageSrc={nightScanSrc!}
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

      {!prelaunchGated && (
        <FloatingCart
          items={cart}
          open={cartOpen}
          onToggle={toggleCartOpen}
          onRemove={removeFromCart}
          onCheckout={checkout}
          isSignedIn={!!user}
        />
      )}
    </>
  );
}
