import { useRef, useEffect, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Link, useNavigate } from 'react-router';
import { TasteFinderSection } from './TasteFinderSection';
import OrderFeedbackForm from './OrderFeedbackForm';
import { useAuth } from '../context/AuthContext';
import { getHomepageState } from '../lib/api';

// Mirrors FEEDBACK_NAG_SUPPRESS_DAYS in backend/src/services/userLifecycle.ts —
// how long the feedback nudge stays hidden after a user dismisses it.
const FEEDBACK_NAG_SUPPRESS_DAYS = 14;

interface HomepageState {
  stageCode: string;
  archetype: { name: string; id: string; color: string; features: string[] } | null;
  daysSinceQuiz: number | null;
  pendingFeedback: { orderId: string; blendName: string | null } | null;
  usualBlend: { id: string; name: string } | null;
  nextDeliveryDate: string | null;
}
import placeholderVideo from '../../design/IMAGES/videos/PlaceHolder01.mp4'
import heroVideo from '../../design/IMAGES/videos/PlaceHolder10.mp4'

// ─── Collection: archetype photos (default) ───────────────────────────────────
import photoFloral      from '../../design/IMAGES/photos/june2026/WEBCUTFloralJun20.png'
import photoFruity      from '../../design/IMAGES/photos/june2026/WEBCUTFruityJun03.png'
import photoBalanced    from '../../design/IMAGES/photos/june2026/WEBCUTBalanced&SweetJun07.png'
import photoChocolate   from '../../design/IMAGES/photos/june2026/WEBCUTChocolate&NuttyJun05.png'
import photoEarthy      from '../../design/IMAGES/photos/june2026/WEBCUTSpicy&EarthyJun05.png'
import photoExperimental from '../../design/IMAGES/photos/june2026/WEBCUTExperimentalJun5.png'

// ─── Collection: archetype bags (hover) ──────────────────────────────────────
import bagFloral        from '../../design/IMAGES/bags/new bags mock up/FLORAL transp.png'
import bagFruity        from '../../design/IMAGES/bags/new bags mock up/FRUITY transp.png'
import bagBalanced      from '../../design/IMAGES/bags/new bags mock up/BALANCED & SWEET transp.png'
import bagChocolate     from '../../design/IMAGES/bags/new bags mock up/CHOCOLATE & NUTTY transp.png'
import bagEarthy        from '../../design/IMAGES/bags/new bags mock up/SPICY & EARTHY transp.png'
import bagExperimental  from '../../design/IMAGES/bags/new bags mock up/EXPERIMENTAL transp.png'

// ─── Data ────────────────────────────────────────────────────────────────────

const bags = [
  { photo: photoFloral,       bag: bagFloral,       num: '01', name: 'Floral',             color: '#a34b78' },
  { photo: photoFruity,       bag: bagFruity,       num: '02', name: 'Fruity',              color: '#ca445f' },
  { photo: photoBalanced,     bag: bagBalanced,     num: '03', name: 'Balanced & Sweet',    color: '#d1ac11' },
  { photo: photoChocolate,    bag: bagChocolate,    num: '04', name: 'Chocolate & Nutty',   color: '#a54c2d' },
  { photo: photoEarthy,       bag: bagEarthy,       num: '05', name: 'Spicy & Earthy',      color: '#912f2f' },
  { photo: photoExperimental, bag: bagExperimental, num: '06', name: 'Experimental',        color: '#056c7a' },
];

const FLAVOR_DIMS = ['Sweetness', 'Acidity', 'Bitterness', 'Body', 'Fruit', 'Spice'];
const FLAVOR_CARDS = [
  { name: 'Floral',            num: '01', color: '#a34b78', dark: false, desc: 'Light, elegant, and aromatic. Hints of jasmine, citrus, and a tea-like clarity.',                                     tags: 'Fragrant, bright, delicate, clean',  bars: [60, 80, 30, 40, 70, 20] },
  { name: 'Fruity',            num: '02', color: '#ca445f', dark: false, desc: 'Juicy and lively with notes of berries and ripe fruit.',                                                               tags: 'Sweet, vibrant, expressive, lively', bars: [70, 90, 30, 50, 100, 20] },
  { name: 'Balanced & Sweet',  num: '03', color: '#d1ac11', dark: true,  desc: 'Round, smooth, and comforting. Notes of caramel, honey, and soft fruit.',                                             tags: 'Smooth, sweet, harmonious, easy',    bars: [90, 50, 40, 70, 50, 20] },
  { name: 'Chocolate & Nutty', num: '04', color: '#a54c2d', dark: false, desc: 'Deep and satisfying with cocoa, roasted nuts, and a rich presence.',                                                  tags: 'Rich, grounded, full, comforting',   bars: [70, 30, 70, 90, 20, 30] },
  { name: 'Spicy & Earthy',    num: '05', color: '#912f2f', dark: false, desc: 'Warm and bold with hints of spice, wood, and lingering depth.',                                                       tags: 'Warm, deep, bold, lasting',          bars: [50, 30, 80, 90, 20, 90] },
  { name: 'Experimental',      num: '06', color: '#056c7a', dark: false, desc: 'Ever-changing and wonderfully unconventional. A rotating selection of boundary-pushing coffees, always unique.',      tags: 'Wild, unique, surprising',           bars: [50, 70, 50, 60, 70, 60] },
];

const WEDGE_PATTERN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44'%3E%3Cpath d='M8 36 L14 10 L20 36 Z' fill='%23f2f1ea' fill-opacity='0.12'/%3E%3Cpath d='M26 10 L32 36 L38 10 Z' fill='%23f2f1ea' fill-opacity='0.12'/%3E%3C/svg%3E\")";

type CinToken = { text: string; highlight?: boolean };
const CINEMATIC_WORDS: CinToken[] = [
  { text: 'Coffee' }, { text: 'is' }, { text: 'never' }, { text: 'just' }, { text: 'flavor.' },
  { text: 'It' }, { text: 'is' }, { text: 'morning,' }, { text: 'memory,', highlight: true },
  { text: 'temperature,' }, { text: 'texture,' }, { text: 'time.' },
];

const QUOTES = [
  { before: 'Coffee should feel like ', word: 'home', after: ', even when everything else is moving.' },
  { before: 'The first cup is the only ', word: 'quiet', after: ' I get all day.' },
  { before: 'I never knew my taste had a ', word: 'name', after: ' until someone asked.' },
  { before: 'Sunday coffee is a ', word: 'ceremony', after: '. Weekday coffee is a promise.' },
  { before: "It tastes like my grandmother's ", word: 'kitchen', after: ' in December.' },
  { before: "I don't drink coffee to wake up. I wake up to ", word: 'drink coffee', after: '.' },
];

// ─── Shared animation preset ─────────────────────────────────────────────────

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 } as const,
  viewport: { once: true, amount: 0.25 },
  transition: { duration: 0.85, delay, ease: [0.16, 1, 0.3, 1] as const },
});

// ─── Component ───────────────────────────────────────────────────────────────

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const heroVideoRef      = useRef<HTMLVideoElement>(null);
  const cinematicVideoRef = useRef<HTMLVideoElement>(null);
  const [hoveredBag, setHoveredBag] = useState<number | null>(null);
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);
  const [activeIdx, setActiveIdx]   = useState(0);
  const [paused, setPaused]         = useState(false);
  const prefersReducedMotion        = useReducedMotion();
  const [visitorName, setVisitorName] = useState(() => localStorage.getItem('axisbloom.name') || '');
  const cinematicTextRef = useRef<HTMLParagraphElement>(null);
  const [cinematicVisible, setCinematicVisible] = useState(false);
  const [visibleCards, setVisibleCards] = useState<Set<number>>(new Set());
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [homepageState, setHomepageState]               = useState<HomepageState | null>(null);
  const [homepageStateLoading, setHomepageStateLoading] = useState(false);
  const [feedbackDismissed, setFeedbackDismissed]        = useState(false);

  useEffect(() => {
    if (!user) { setHomepageState(null); return; }
    setHomepageStateLoading(true);
    getHomepageState()
      .then(setHomepageState)
      .catch(() => setHomepageState(null))
      .finally(() => setHomepageStateLoading(false));
  }, [user]);

  useEffect(() => {
    const orderId = homepageState?.pendingFeedback?.orderId;
    if (orderId) {
      const key = `axisBloomFeedbackDismiss_${orderId}`;
      const dismissedAt = localStorage.getItem(key);
      const suppressed = !!dismissedAt && Date.now() - Number(dismissedAt) < FEEDBACK_NAG_SUPPRESS_DAYS * 86400000;
      setFeedbackDismissed(suppressed);
    } else {
      setFeedbackDismissed(false);
    }
  }, [homepageState]);

  useEffect(() => {
    if (prefersReducedMotion || paused) return;
    const id = setInterval(() => setActiveIdx(i => (i + 1) % QUOTES.length), 5000);
    return () => clearInterval(id);
  }, [paused, prefersReducedMotion]);

  useEffect(() => {
    // rAF-based loop: fires every frame (~60fps) so we catch the end before any black frame
    const attachLoop = (ref: React.RefObject<HTMLVideoElement | null>) => {
      const video = ref.current;
      if (!video) return () => {};
      let rafId: number;
      const tick = () => {
        if (video.duration && video.currentTime >= video.duration - 0.5) {
          video.currentTime = 0.05; // skip black first frame; cut end 500ms early
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    };
    const cleanHero      = attachLoop(heroVideoRef);
    const cleanCinematic = attachLoop(cinematicVideoRef);
    return () => { cleanHero(); cleanCinematic(); };
  }, []);

  useEffect(() => {
    const el = cinematicTextRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setCinematicVisible(true); io.disconnect(); } },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const refs = cardRefs.current;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            const i = Number((e.target as HTMLElement).dataset.cardIdx);
            setVisibleCards(prev => new Set([...prev, i]));
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    refs.forEach((el, i) => { if (el) { el.dataset.cardIdx = String(i); io.observe(el); } });
    return () => io.disconnect();
  }, []);

  const handleProfileStart = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get('name');
    if (name) {
      sessionStorage.setItem('axisBloomCustomerName', name.toString());
      navigate('/find-my-flavor');
    }
  };

  const ctaHeadlineStyle: CSSProperties = { fontSize: 'clamp(2rem, 3.6vw, 3.6rem)', fontWeight: 400, color: '#9a2918', lineHeight: 1.15, margin: 0 };
  const ctaPrimaryLinkStyle: CSSProperties = { marginTop: 22, fontSize: '0.88rem', fontWeight: 400, color: '#9a2918', letterSpacing: '0.22em', textTransform: 'uppercase', textDecoration: 'none', borderBottom: '1px solid rgba(154,41,24,0.32)', paddingBottom: 3 };
  const ctaSecondaryLinkStyle: CSSProperties = { marginTop: 14, fontSize: '0.72rem', fontWeight: 400, color: '#9a2918', letterSpacing: '0.14em', textTransform: 'uppercase', textDecoration: 'none', opacity: 0.5, borderBottom: '1px solid rgba(154,41,24,0.25)', paddingBottom: 2 };

  // Section 2's right column — the direct fix for the screenshots (Dana's bug report):
  // a signed-in user must never see the anonymous name-capture form, and the CTA
  // must reflect where they actually are (UC0-UC4 in WHAT_WE_BUILT.md).
  //
  // Pending feedback is layered independently of stageCode — a subscriber or
  // repeat customer can still have an unanswered feedback ask sitting out there
  // from an early order. It renders above the stage-specific CTA, not instead of it
  // (see 2_CLAUDE_CODE_PROMPT_LIFECYCLE_FEEDBACK_FIX.md).
  function renderSignedInCTA() {
    if (homepageStateLoading || !homepageState) return null;
    const { stageCode, archetype, pendingFeedback, usualBlend, nextDeliveryDate } = homepageState;

    const feedbackNudge = pendingFeedback && !feedbackDismissed ? (
      <div style={{ marginBottom: 32, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '100%' }}>
        <p style={ctaHeadlineStyle}>How was<br />{pendingFeedback.blendName ?? 'your coffee'}?</p>
        <div style={{ marginTop: 24, width: '100%', maxWidth: 400 }}>
          <OrderFeedbackForm
            orderId={pendingFeedback.orderId}
            blendName={pendingFeedback.blendName}
            onSubmitted={() => setFeedbackDismissed(true)}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(`axisBloomFeedbackDismiss_${pendingFeedback.orderId}`, String(Date.now()));
            setFeedbackDismissed(true);
          }}
          style={{ ...ctaSecondaryLinkStyle, background: 'none', border: 'none', cursor: 'pointer', borderBottom: ctaSecondaryLinkStyle.borderBottom }}
        >
          Not now
        </button>
      </div>
    ) : null;

    return (
      <>
        {feedbackNudge}
        {renderStageCTA(stageCode, archetype, usualBlend, nextDeliveryDate)}
      </>
    );
  }

  function renderStageCTA(
    stageCode: string,
    archetype: HomepageState['archetype'],
    usualBlend: HomepageState['usualBlend'],
    nextDeliveryDate: HomepageState['nextDeliveryDate']
  ) {
    if (stageCode === 'NEW_NO_QUIZ') {
      return (
        <>
          <p style={ctaHeadlineStyle}>Ready to find<br />your flavor?</p>
          <Link to="/find-my-flavor" style={ctaPrimaryLinkStyle}>TAKE THE QUIZ →</Link>
        </>
      );
    }

    if (stageCode === 'QUIZ_TAKEN_FRESH_NO_ORDER' || stageCode === 'QUIZ_TAKEN_SETTLED_NO_ORDER' || stageCode === 'QUIZ_STALE_NO_ORDER') {
      return (
        <>
          <p style={ctaHeadlineStyle}>You're a {archetype?.name ?? 'match'} —<br />shop your matches.</p>
          <Link to="/shop" style={ctaPrimaryLinkStyle}>SHOP YOUR MATCHES →</Link>
          {stageCode === 'QUIZ_TAKEN_SETTLED_NO_ORDER' && (
            <Link to="/find-my-flavor" style={ctaSecondaryLinkStyle}>Retake the quiz →</Link>
          )}
          {stageCode === 'QUIZ_STALE_NO_ORDER' && (
            <Link to="/find-my-flavor" style={ctaSecondaryLinkStyle}>Palates change — retake anytime →</Link>
          )}
        </>
      );
    }

    if (stageCode === 'SUBSCRIBER') {
      return (
        <>
          <p style={ctaHeadlineStyle}>Your subscription<br />is on track.</p>
          {nextDeliveryDate && (
            <p style={{ marginTop: 12, fontSize: '0.85rem', color: '#9a2918', opacity: 0.65 }}>
              Next shipment: {new Date(nextDeliveryDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
            </p>
          )}
          <Link to="/profile" style={ctaPrimaryLinkStyle}>MANAGE SUBSCRIPTION →</Link>
        </>
      );
    }

    if (stageCode === 'REORDER_DUE') {
      return (
        <>
          <p style={ctaHeadlineStyle}>Ready for more<br />{usualBlend?.name ?? 'your usual'}?</p>
          <Link to="/shop" style={ctaPrimaryLinkStyle}>REORDER →</Link>
        </>
      );
    }

    if (stageCode === 'LAPSED_SINGLE_ORDER') {
      return (
        <>
          <p style={ctaHeadlineStyle}>New arrivals since<br />your last order.</p>
          <Link to="/shop" style={ctaPrimaryLinkStyle}>SEE WHAT'S NEW →</Link>
        </>
      );
    }

    // ACTIVE_REPEAT_USER and any other fallback
    return (
      <>
        <p style={ctaHeadlineStyle}>Welcome back.</p>
        <Link to="/shop" style={ctaPrimaryLinkStyle}>SHOP AGAIN →</Link>
      </>
    );
  }

  return (
    <div style={{ backgroundColor: '#f2f1ea' }}>

      {/* ━━━ 1. HERO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*
        To swap in real brand video: replace <source src="..."> and update poster={}
      */}
      <section style={{ position: 'relative', height: '92vh', minHeight: 480, overflow: 'hidden', backgroundColor: '#1a1208' }}>
        <video
          ref={heroVideoRef}
          autoPlay muted playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 50%', display: 'block', transform: 'scale(1.06)' }}
        >
          <source src={heroVideo} type="video/mp4" />
        </video>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(20,12,8,0) 40%, rgba(20,12,8,0.62) 100%)' }} />

        <div style={{ position: 'absolute', left: 40, bottom: 64, maxWidth: 560, zIndex: 2 }}>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            style={{ fontSize: 'clamp(32px, 4.2vw, 52px)', fontWeight: 400, lineHeight: 1.15, color: '#f2f1ea', margin: '0 0 28px' }}
          >
            Coffee, <span style={{ backgroundColor: '#ee5974', color: '#f2f1ea', padding: '1px 10px' }}>matched</span> to your personal flavor.
          </motion.h1>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}
            style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}
          >
            <Link
              to="/find-my-flavor"
              style={{ display: 'inline-block', backgroundColor: '#9a2918', color: '#f2f1ea', padding: '14px 28px', fontSize: '0.75rem', letterSpacing: '0.14em', textTransform: 'uppercase', textDecoration: 'none', fontFamily: "'Lato', Arial, sans-serif" }}
            >
              Find my flavor →
            </Link>
            <Link
              to="/flavor-intelligence"
              style={{ fontSize: '0.69rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(242,241,234,0.9)', textDecoration: 'none', borderBottom: '1px solid rgba(242,241,234,0.5)', paddingBottom: 2, fontFamily: "'Lato', Arial, sans-serif" }}
            >
              Explore coffees
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ━━━ 2. IN THEIR WORDS + PROFILE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ display: 'grid', gridTemplateColumns: '1.15fr 1px 1fr', backgroundColor: '#f2f1ea', minHeight: 480 }}>

        {/* LEFT: rotating quote */}
        <div
          style={{ padding: 'clamp(56px,8vw,90px) clamp(32px,5vw,56px)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#9a2918' }}>In their words</span>

          <div style={{ minHeight: '10rem', position: 'relative', margin: '32px 0' }}>
            <AnimatePresence mode="wait">
              <motion.p
                key={activeIdx}
                initial={prefersReducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={prefersReducedMotion ? false : { opacity: 0 }}
                transition={{ duration: 0.3 }}
                aria-live="polite"
                style={{ fontSize: 'clamp(24px,2.4vw,30px)', fontWeight: 400, color: '#45474a', lineHeight: 1.4, maxWidth: 480, margin: 0, position: 'absolute', top: 0, left: 0 }}
              >
                {QUOTES[activeIdx].before}
                <span style={{ backgroundColor: '#ee5974', color: '#f2f1ea', padding: '1px 8px' }}>{QUOTES[activeIdx].word}</span>
                {QUOTES[activeIdx].after}
              </motion.p>
            </AnimatePresence>
          </div>

          {/* Tick counter */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9 }} aria-hidden="true">
            {QUOTES.map((_, i) => (
              <div key={i} style={{ width: 1, height: i === activeIdx ? 18 : 9, backgroundColor: i === activeIdx ? '#9a2918' : '#c5c7c8', transition: 'all 0.3s ease' }} />
            ))}
          </div>
        </div>

        {/* Axis divider */}
        <div style={{ backgroundColor: '#c5c7c8' }} />

        {/* RIGHT: profile */}
        <div style={{ padding: 'clamp(56px,8vw,90px) clamp(32px,5vw,56px)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {!user ? (
            <>
              <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#9a2918', marginBottom: 18 }}>Your profile</span>
              <h2 style={{ fontSize: 'clamp(24px,2.4vw,30px)', fontWeight: 400, lineHeight: 1.25, color: '#9a2918', margin: '0 0 36px' }}>
                Whose palate are we profiling today?
              </h2>
              <style>{`#profile-name::placeholder { color: #7b7f80; }`}</style>
              <input
                id="profile-name"
                type="text"
                placeholder="Your name"
                autoComplete="given-name"
                value={visitorName}
                onChange={e => { setVisitorName(e.target.value); localStorage.setItem('axisbloom.name', e.target.value); }}
                style={{ width: '100%', maxWidth: 360, background: 'transparent', border: 'none', borderBottom: '1px solid #9a2918', borderRadius: 0, outline: 'none', fontSize: 18, color: '#45474a', padding: '10px 0' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 32 }}>
                <Link
                  to={visitorName.trim() ? `/find-my-flavor` : '#'}
                  onClick={() => { if (visitorName.trim()) sessionStorage.setItem('axisBloomCustomerName', visitorName.trim()); }}
                  style={{ display: 'inline-block', backgroundColor: '#9a2918', color: '#f2f1ea', padding: '14px 28px', fontSize: '0.75rem', letterSpacing: '0.14em', textTransform: 'uppercase', textDecoration: 'none' }}
                >
                  Begin profile →
                </Link>
                <Link to="/sign-in" style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#45474a', textDecoration: 'none', borderBottom: '1px solid #45474a', paddingBottom: 2 }}>
                  Member? Sign in
                </Link>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {renderSignedInCTA()}
            </div>
          )}
        </div>

      </section>

      {/* ━━━ 3. COFFEE COLLECTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', paddingTop: 'clamp(80px, 10vw, 120px)' }}>
        {/* Header — keep horizontal padding */}
        <div style={{ padding: '0 clamp(32px, 6vw, 96px)', marginBottom: 'clamp(40px, 5vw, 64px)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
          <motion.div {...fadeUp(0)}>
            <p style={{ fontFamily: "'Lato', Arial, sans-serif", fontSize: '0.68rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 10px' }}>The Collection</p>
            <h2 style={{ fontFamily: "'Lato', Arial, sans-serif", fontSize: 'clamp(1.8rem, 3vw, 2.8rem)', fontWeight: 400, color: '#9a2918', margin: 0, lineHeight: 1.1 }}>Find your bag.</h2>
          </motion.div>
          <Link
            to="/shop"
            style={{ fontFamily: "'Lato', Arial, sans-serif", fontSize: '0.78rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9a2918', textDecoration: 'none', borderBottom: '1px solid rgba(154,41,24,0.35)', paddingBottom: 4, alignSelf: 'flex-end' }}
          >
            Shop all coffees →
          </Link>
        </div>
        {/* Full-width grid — no padding, no gap, edge to edge */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' }}>
          {bags.map((item, i) => (
            <motion.div
              key={i}
              {...fadeUp(i * 0.08)}
              style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
              tabIndex={0}
              onMouseEnter={() => setHoveredBag(i)}
              onMouseLeave={() => setHoveredBag(null)}
              onFocus={() => setHoveredBag(i)}
              onBlur={() => setHoveredBag(null)}
            >
              {/* 3px archetype-color bar */}
              <div style={{ height: 3, backgroundColor: item.color, flexShrink: 0 }} />
              <div style={{ aspectRatio: '3 / 4.6', position: 'relative', overflow: 'hidden' }}>
                {/* Photo */}
                <div style={{ position: 'absolute', inset: 0, opacity: hoveredBag === i ? 0 : 1, transition: 'opacity 0.3s ease' }}>
                  <img src={item.photo} alt={`${item.name} archetype`} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }} />
                </div>
                {/* Bag on full archetype-color field */}
                <div style={{
                  position: 'absolute', inset: 0, backgroundColor: item.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: hoveredBag === i ? 1 : 0, transition: 'opacity 0.3s ease',
                }}>
                  <img src={item.bag} alt="" aria-hidden="true" style={{ width: '72%', height: '84%', objectFit: 'contain', display: 'block' }} />
                </div>
              </div>
              {/* Two-line label */}
              <div style={{ textAlign: 'center', padding: '14px 6px 0' }}>
                <span style={{ display: 'block', fontSize: 12, letterSpacing: '0.14em', color: item.color, lineHeight: 1.3 }}>No. {item.num}</span>
                <span style={{ display: 'block', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#45474a', whiteSpace: 'nowrap', lineHeight: 1.3, marginTop: 3 }}>{item.name}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ━━━ 4. CINEMATIC VIDEO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ position: 'relative', height: '90vh', overflow: 'hidden', backgroundColor: '#201812', display: 'flex', alignItems: 'flex-end' }}>
        <video
          ref={cinematicVideoRef}
          autoPlay muted playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%', display: 'block', transform: 'scale(1.06)' }}
        >
          <source src={placeholderVideo} type="video/mp4" />
        </video>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(16,10,6,0) 45%, rgba(16,10,6,0.6) 100%)' }} />
        <p
          ref={cinematicTextRef}
          style={{
            position: 'relative', zIndex: 2,
            padding: '0 clamp(32px,6vw,64px) clamp(56px,8vh,80px)',
            fontSize: 'clamp(28px,3.6vw,46px)', fontWeight: 400, color: '#f2f1ea',
            margin: 0, maxWidth: 900, lineHeight: 1.3,
          }}
        >
          {CINEMATIC_WORDS.map((tok, i) => {
            const visible = prefersReducedMotion || cinematicVisible;
            const delay = prefersReducedMotion ? 0 : i * 90;
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  marginRight: tok.highlight ? '0.15em' : '0.28em',
                  ...(tok.highlight ? { backgroundColor: '#ee5974', color: '#f2f1ea', padding: '0 7px 2px' } : {}),
                  opacity: visible ? 1 : 0,
                  transform: visible ? 'translateY(0)' : 'translateY(12px)',
                  transition: visible
                    ? `opacity 0.55s ${delay}ms cubic-bezier(.22,1,.36,1), transform 0.55s ${delay}ms cubic-bezier(.22,1,.36,1)`
                    : 'none',
                }}
              >
                {tok.text}
              </span>
            );
          })}
        </p>
      </section>

      {/* ━━━ 5. FLAVOR MAP — archetype cards ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(56px, 8vw, 88px) clamp(24px, 4vw, 64px)' }}>
        <motion.div {...fadeUp(0)} style={{ marginBottom: 'clamp(28px, 4vw, 44px)' }}>
          <p style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 12px' }}>
            The Flavor Map
          </p>
          <h2 style={{ fontSize: 'clamp(1.5rem, 2.2vw, 2.2rem)', fontWeight: 400, color: '#9a2918', lineHeight: 1.15, margin: 0 }}>
            Every palate has a direction.
          </h2>
        </motion.div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, overflowX: 'auto' }}>
          {FLAVOR_CARDS.map((card, i) => {
            const textColor = card.dark ? '#3a3c3e' : '#f2f1ea';
            const trackBg = card.dark ? 'rgba(58,60,62,.22)' : 'rgba(242,241,234,.25)';
            const dividerColor = card.dark ? 'rgba(58,60,62,.4)' : 'rgba(242,241,234,.4)';
            const cardVisible = visibleCards.has(i);
            return (
              <div
                key={card.num}
                ref={el => { cardRefs.current[i] = el; }}
                onMouseEnter={() => setHoveredCard(i)}
                onMouseLeave={() => setHoveredCard(null)}
                style={{
                  position: 'relative', minHeight: 400,
                  backgroundColor: card.color,
                  display: 'flex', flexDirection: 'column',
                  padding: '26px 20px', boxSizing: 'border-box', overflow: 'hidden',
                  color: textColor,
                }}
              >
                {/* Tone-on-tone wedge pattern (hover) */}
                <div style={{
                  position: 'absolute', inset: 0, backgroundImage: WEDGE_PATTERN,
                  opacity: hoveredCard === i ? 1 : 0, transition: 'opacity 0.5s ease', pointerEvents: 'none',
                }} />
                <span style={{ fontSize: 11, letterSpacing: '0.14em', opacity: 0.8 }}>{card.num}</span>
                <h3 style={{ fontSize: 20, fontWeight: 400, margin: '10px 0 12px', lineHeight: 1.2 }}>{card.name}</h3>
                <p style={{ fontSize: 13, lineHeight: 1.55, opacity: 0.94, margin: 0 }}>{card.desc}</p>

                {/* Flavor bars */}
                <div style={{ marginTop: 'auto', marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {FLAVOR_DIMS.map((dim, j) => (
                    <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', width: 58, opacity: 0.75, flexShrink: 0 }}>{dim}</span>
                      <div style={{ flex: 1, height: 3, backgroundColor: trackBg }}>
                        <div style={{
                          height: '100%',
                          width: cardVisible ? `${card.bars[j]}%` : '0%',
                          backgroundColor: 'currentColor',
                          transition: cardVisible ? `width 0.7s ${j * 60}ms cubic-bezier(.22,1,.36,1)` : 'none',
                        }} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tags */}
                <p style={{
                  fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                  borderTop: `1px solid ${dividerColor}`, paddingTop: 12, margin: 0, opacity: 0.9,
                }}>{card.tags}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ━━━ 6. TASTE FINDER (curtain animation) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <TasteFinderSection visitorName={visitorName} />

    </div>
  );
}
