import { useRef, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router';
import { TasteFinderSection } from './TasteFinderSection';
import FilmModal from './FilmModal';
import StripesDivider from './StripesDivider';
import OrderFeedbackForm from './OrderFeedbackForm';
import CompanyGiftRedemption from './CompanyGiftRedemption';
import { useAuth } from '../context/AuthContext';
import { getHomepageState } from '../lib/api';

// Mirrors FEEDBACK_NAG_SUPPRESS_DAYS in backend/src/services/userLifecycle.ts —
// how long the feedback nudge stays hidden after a user dismisses it.
const FEEDBACK_NAG_SUPPRESS_DAYS = 14;

import { archetypeAssets, homeAssets, videoAssets } from '../../design/assets';

const heroVideo    = videoAssets.homeHero;
const liamVideo    = videoAssets.homePlaceholder;

// ── §4 Collection: july_scan1 edited scans ───────────────────────────────────
// Below-the-fold thumbnail cards (~200px wide) — mobileSrc (800px cap) covers
// this comfortably at any DPR, so it's used directly rather than a full srcSet.
const scanFloral        = homeAssets.scan.floral.mobileSrc;
const scanFruity        = homeAssets.scan.fruity.mobileSrc;
const scanBalanced      = homeAssets.scan['balanced-sweet'].mobileSrc;
const scanChocolate     = homeAssets.scan['chocolate-nutty'].mobileSrc;
const scanSpicy         = homeAssets.scan['spicy-earthy'].mobileSrc;
const scanExperimental  = homeAssets.scan.experimental.mobileSrc;

// ── §4 Collection: bag hover artwork (existing PNGs, do not replace) ─────────
const bagFloral        = archetypeAssets.floral.bag.src;
const bagFruity        = archetypeAssets.fruity.bag.src;
const bagBalanced      = archetypeAssets['balanced-sweet'].bag.src;
const bagChocolate     = archetypeAssets['chocolate-nutty'].bag.src;
const bagEarthy        = archetypeAssets['spicy-earthy'].bag.src;
const bagExperimental  = archetypeAssets.experimental.bag.src;

// ── §5 Photo essay images ─────────────────────────────────────────────────────
// Kept as full {src, mobileSrc} objects (not flattened to .src) — these render
// larger than the §4 cards, so they get a real srcSet rather than a hard mobileSrc cap.
const photoEssay1 = homeAssets.photoEssay1;
const photoEssay2 = homeAssets.photoEssay2;
const photoEssay3 = homeAssets.photoEssay3;

// ── Data ─────────────────────────────────────────────────────────────────────

const COLLECTION = [
  { scan: scanFloral,       bag: bagFloral,       num: '01', name: 'Floral',            color: '#a34b78' },
  { scan: scanFruity,       bag: bagFruity,       num: '02', name: 'Fruity',             color: '#ca445f' },
  { scan: scanBalanced,     bag: bagBalanced,     num: '03', name: 'Balanced & Sweet',   color: '#d1ac11' },
  { scan: scanChocolate,    bag: bagChocolate,    num: '04', name: 'Chocolate & Nutty',  color: '#a54c2d' },
  { scan: scanSpicy,        bag: bagEarthy,       num: '05', name: 'Earthy',             color: '#912f2f' },
  { scan: scanExperimental, bag: bagExperimental, num: '06', name: 'Experimental',       color: '#056c7a' },
];

// punct = punctuation that must hug the highlighted word (no gap)
type QuoteToken = { before: string; word: string; punct: string; rest: string };
const QUOTES: QuoteToken[] = [
  { before: 'Coffee should feel like ', word: 'home',         punct: ',', rest: ' even when everything else is moving.' },
  { before: 'The first cup is the only ', word: 'quiet',      punct: '', rest: ' I get all day.' },
  { before: 'I never knew my taste had a ', word: 'name',     punct: '', rest: ' until someone asked.' },
  { before: 'Sunday coffee is a ', word: 'ceremony',          punct: '.', rest: ' Weekday coffee is a promise.' },
  { before: "It tastes like my grandmother's ", word: 'kitchen', punct: '', rest: ' in December.' },
  { before: "I don't drink coffee to wake up. I wake up to ", word: 'drink coffee', punct: '.', rest: '' },
];

type CinToken = { text: string; highlight?: boolean };
const LIAM_WORDS: CinToken[] = [
  { text: 'Coffee' }, { text: 'is' }, { text: 'never' }, { text: 'just' }, { text: 'flavor.' },
  { text: 'It' }, { text: 'is' }, { text: 'morning,' }, { text: 'memory,', highlight: true },
  { text: 'temperature,' }, { text: 'texture,' }, { text: 'time.' },
];

interface HomepageState {
  stageCode: string;
  archetype: { name: string; id: string; color: string; features: string[] } | null;
  daysSinceQuiz: number | null;
  pendingFeedback: { orderId: string; blendName: string | null; coffeeId: number | null } | null;
  usualBlend: { id: string; name: string } | null;
  nextDeliveryDate: string | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Home() {
  const { user } = useAuth();

  // Film modal
  const [filmModalOpen, setFilmModalOpen] = useState(false);

  // §4 Collection hover
  const [hoveredBag, setHoveredBag] = useState<number | null>(null);

  // §7 Voices rotation
  const [activeIdx, setActiveIdx]   = useState(0);
  const [paused, setPaused]         = useState(false);
  const [resetKey, setResetKey]     = useState(0);

  const prefersReducedMotion = useReducedMotion();

  // §2 Visitor name (drives §10 gift tag + bag)
  const [visitorName, setVisitorName] = useState(() => localStorage.getItem('axisbloom.name') || '');

  // §6 Liam word reveal
  const liamTextRef = useRef<HTMLParagraphElement>(null);
  const [liamVisible, setLiamVisible] = useState(false);

  // Video refs
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const liamVideoRef = useRef<HTMLVideoElement>(null);

  // Archetype data — used in §10 gift reveal
  const [homepageState, setHomepageState] = useState<HomepageState | null>(null);
  const [homepageStateLoading, setHomepageStateLoading] = useState(false);
  const [feedbackDismissed, setFeedbackDismissed] = useState(false);

  const refreshHomepageState = () => {
    // `user` is truthy for anonymous guests too (guest identity bootstrap in
    // AuthContext) — this already covers them, no `isAnonymous` check needed here.
    if (!user) { setHomepageState(null); return; }
    setHomepageStateLoading(true);
    getHomepageState()
      .then(setHomepageState)
      .catch(() => setHomepageState(null))
      .finally(() => setHomepageStateLoading(false));
  };

  useEffect(refreshHomepageState, [user]);

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

  // §7 Quote auto-rotation
  useEffect(() => {
    if (prefersReducedMotion || paused) return;
    const id = setInterval(() => setActiveIdx(i => (i + 1) % QUOTES.length), 5000);
    return () => clearInterval(id);
  }, [paused, prefersReducedMotion, resetKey]);

  // rAF loop for clean video looping (avoids black-frame tail)
  useEffect(() => {
    const attach = (ref: React.RefObject<HTMLVideoElement | null>) => {
      const v = ref.current;
      if (!v) return () => {};
      let raf: number;
      const tick = () => {
        if (v.duration && v.currentTime >= v.duration - 0.5) v.currentTime = 0.05;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    };
    const c1 = attach(heroVideoRef);
    const c2 = attach(liamVideoRef);
    return () => { c1(); c2(); };
  }, []);

  // Pause videos when off-screen
  useEffect(() => {
    const observe = (ref: React.RefObject<HTMLVideoElement | null>) => {
      const v = ref.current;
      if (!v) return () => {};
      const io = new IntersectionObserver(
        ([e]) => { e.isIntersecting ? v.play().catch(() => {}) : v.pause(); },
        { threshold: 0.05 }
      );
      io.observe(v);
      return () => io.disconnect();
    };
    const d1 = observe(heroVideoRef);
    const d2 = observe(liamVideoRef);
    return () => { d1(); d2(); };
  }, []);

  // §6 Liam word reveal
  useEffect(() => {
    const el = liamTextRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setLiamVisible(true); io.disconnect(); } },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const handleNameChange = (val: string) => {
    setVisitorName(val);
    localStorage.setItem('axisbloom.name', val);
  };

  // §2 signed-in CTA — headline styled to match the anonymous headline above it
  const q2Headline: React.CSSProperties = {
    fontSize: 'clamp(26px,3.2vw,42px)', fontWeight: 400, color: '#9a2918',
    lineHeight: 1.2, margin: '0 0 20px', maxWidth: 600,
  };
  const q2Body: React.CSSProperties = {
    fontSize: 16, color: '#45474a', margin: '0 0 24px', fontFamily: "'Lato', Arial, sans-serif",
  };
  const q2Primary: React.CSSProperties = {
    display: 'inline-block', backgroundColor: '#9a2918', color: '#f2f1ea',
    padding: '14px 32px', fontSize: '0.75rem', letterSpacing: '0.14em',
    textTransform: 'uppercase', textDecoration: 'none', fontFamily: "'Lato', Arial, sans-serif",
  };
  const q2Secondary: React.CSSProperties = {
    fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
    color: '#45474a', textDecoration: 'none', opacity: 0.55,
    fontFamily: "'Lato', Arial, sans-serif",
  };

  function renderSignedInCTA() {
    if (homepageStateLoading || !homepageState) return null;
    const { stageCode, archetype, pendingFeedback, usualBlend, nextDeliveryDate } = homepageState;

    const feedbackNudge = pendingFeedback && !feedbackDismissed ? (
      <div style={{ width: '100%', maxWidth: 420, margin: '0 0 36px', textAlign: 'left' }}>
        <OrderFeedbackForm
          orderId={pendingFeedback.orderId}
          blendName={pendingFeedback.blendName}
          coffeeId={pendingFeedback.coffeeId}
          onSubmitted={() => setFeedbackDismissed(true)}
        />
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(`axisBloomFeedbackDismiss_${pendingFeedback.orderId}`, String(Date.now()));
            setFeedbackDismissed(true);
          }}
          style={{ ...q2Secondary, background: 'none', border: 'none', cursor: 'pointer', marginTop: 10, display: 'inline-block' }}
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
          <h2 style={q2Headline}>Ready to find your flavor?</h2>
          <Link to="/find-my-flavor" style={q2Primary}>Take the quiz →</Link>
        </>
      );
    }
    if (stageCode === 'QUIZ_TAKEN_FRESH_NO_ORDER' || stageCode === 'QUIZ_TAKEN_SETTLED_NO_ORDER' || stageCode === 'QUIZ_STALE_NO_ORDER') {
      return (
        <>
          <h2 style={q2Headline}>You're a {archetype?.name ?? 'match'} — shop your matches.</h2>
          <Link to="/shop" style={q2Primary}>Shop your matches →</Link>
          <div style={{ marginTop: 16 }}>
            {stageCode === 'QUIZ_TAKEN_SETTLED_NO_ORDER' && <Link to="/find-my-flavor" style={q2Secondary}>Retake the quiz →</Link>}
            {stageCode === 'QUIZ_STALE_NO_ORDER' && <Link to="/find-my-flavor" style={q2Secondary}>Palates change — retake anytime →</Link>}
          </div>
        </>
      );
    }
    if (stageCode === 'SUBSCRIBER') {
      return (
        <>
          <h2 style={q2Headline}>Your subscription is on track.</h2>
          {nextDeliveryDate && (
            <p style={q2Body}>Next shipment: {new Date(nextDeliveryDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</p>
          )}
          <Link to="/profile" style={q2Primary}>Manage subscription →</Link>
        </>
      );
    }
    if (stageCode === 'REORDER_DUE') {
      return (
        <>
          <h2 style={q2Headline}>Ready for more {usualBlend?.name ?? 'your usual'}?</h2>
          <Link to="/shop" style={q2Primary}>Reorder →</Link>
        </>
      );
    }
    if (stageCode === 'LAPSED_SINGLE_ORDER') {
      return (
        <>
          <h2 style={q2Headline}>New arrivals since your last order.</h2>
          <Link to="/shop" style={q2Primary}>See what's new →</Link>
        </>
      );
    }
    // ACTIVE_REPEAT_USER and any other fallback
    return (
      <>
        <h2 style={q2Headline}>Welcome back.</h2>
        <Link to="/shop" style={q2Primary}>Shop again →</Link>
      </>
    );
  }

  return (
    <div style={{ backgroundColor: '#f2f1ea' }}>

      <FilmModal
        src={heroVideo}
        open={filmModalOpen}
        onClose={() => setFilmModalOpen(false)}
      />

      {/* ━━━ §1 FILM HERO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section data-hero style={{ position: 'relative', height: '90vh', minHeight: 480, overflow: 'hidden', backgroundColor: '#141110' }}>
        <video
          ref={heroVideoRef}
          autoPlay muted loop playsInline preload="metadata"
          poster={videoAssets.homeHeroPoster.src}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        >
          <source src={heroVideo} type="video/mp4" />
        </video>

        {/* Bottom scrim */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 55%, rgba(20,12,8,.55))', pointerEvents: 'none' }} />

        {/* Bottom-left title */}
        <p style={{
          position: 'absolute', left: 'clamp(24px,5vw,64px)', bottom: 80, zIndex: 2, margin: 0,
          fontSize: 'clamp(22px,2.8vw,30px)', color: 'rgba(242,241,234,.7)', fontWeight: 400,
        }}>
          Do you hear me?
        </p>

        {/* WATCH pill — centered */}
        <button
          onClick={() => setFilmModalOpen(true)}
          aria-label="Watch the film with sound"
          style={{
            position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)',
            zIndex: 2, background: 'none', border: '1px solid rgba(242,241,234,.55)',
            color: '#f2f1ea', fontFamily: "'Lato', Arial, sans-serif",
            fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase',
            padding: '11px 28px', cursor: 'pointer',
          }}
        >
          Watch
        </button>
      </section>

      {/* ━━━ §2 THE QUESTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{
        backgroundColor: '#f2f1ea',
        padding: 'clamp(80px,12vw,140px) clamp(32px,6vw,80px)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      }}>
        {(!user || (user.isAnonymous && !homepageState)) ? (
          <>
            <h2 style={{
              fontSize: 'clamp(26px,3.2vw,42px)', fontWeight: 400, color: '#9a2918',
              lineHeight: 1.2, margin: '0 0 40px', maxWidth: 600,
            }}>
              Whose palate are we profiling today?
            </h2>
            <div style={{ width: '100%', maxWidth: 360 }}>
              <style>{`#q-name::placeholder { color: #7b7f80; text-align: center; }`}</style>
              <input
                id="q-name"
                type="text"
                placeholder="Your name"
                autoComplete="given-name"
                value={visitorName}
                onChange={e => handleNameChange(e.target.value)}
                style={{
                  width: '100%', background: 'transparent', border: 'none',
                  borderBottom: '1px solid #9a2918', borderRadius: 0, outline: 'none',
                  fontSize: 18, color: '#45474a', padding: '10px 0', textAlign: 'center',
                  fontFamily: "'Lato', Arial, sans-serif",
                }}
              />
              <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <Link
                  to="/find-my-flavor"
                  onClick={e => {
                    if (!visitorName.trim()) { e.preventDefault(); return; }
                    sessionStorage.setItem('axisBloomCustomerName', visitorName.trim());
                  }}
                  style={{
                    display: 'inline-block', backgroundColor: '#9a2918', color: '#f2f1ea',
                    padding: '14px 32px', fontSize: '0.75rem', letterSpacing: '0.14em',
                    textTransform: 'uppercase', textDecoration: 'none', fontFamily: "'Lato', Arial, sans-serif",
                  }}
                >
                  Begin →
                </Link>
                <Link to="/sign-in" style={{
                  fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: '#45474a', textDecoration: 'none', opacity: 0.55,
                  fontFamily: "'Lato', Arial, sans-serif",
                }}>
                  Sign in
                </Link>
              </div>
            </div>
          </>
        ) : (
          <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {renderSignedInCTA()}
          </div>
        )}
      </section>

      {/* ━━━ COMPANY GIFT CODE REDEMPTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{
        backgroundColor: '#f2f1ea',
        borderTop: '1px solid rgba(154,41,24,0.12)', borderBottom: '1px solid rgba(154,41,24,0.12)',
        padding: '18px clamp(32px,5vw,56px)',
        display: 'flex', justifyContent: 'center',
      }}>
        <CompanyGiftRedemption onRedeemed={refreshHomepageState} />
      </section>

      {/* ━━━ §3 PULL QUOTE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{
        backgroundColor: '#ebebe3',
        borderTop: '1px solid #c5c7c8', borderBottom: '1px solid #c5c7c8',
        padding: 'clamp(64px,9vw,100px) clamp(32px,6vw,80px)',
        textAlign: 'center',
      }}>
        <p style={{
          fontSize: 'clamp(30px,3.4vw,48px)', fontWeight: 400, color: '#45474a',
          lineHeight: 1.3, maxWidth: 800, margin: '0 auto',
        }}>
          The best gift is{' '}
          <span style={{ backgroundColor: '#ee5974', color: '#f2f1ea', padding: '1px 9px' }}>time</span>
          . And sometimes, time begins with coffee.
        </p>
      </section>

      <StripesDivider />

      {/* ━━━ §4 COLLECTION — "Find your bag." ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', paddingTop: 'clamp(80px,10vw,120px)', paddingBottom: 112, isolation: 'isolate' }}>
        <div style={{ padding: '0 clamp(32px,6vw,96px)', marginBottom: 'clamp(40px,5vw,64px)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <p style={{ fontSize: '0.68rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 10px' }}>The Collection</p>
            <h2 style={{ fontSize: 'clamp(1.8rem,3vw,2.8rem)', fontWeight: 400, color: '#9a2918', margin: 0, lineHeight: 1.1 }}>Find your bag.</h2>
          </div>
          <Link to="/shop" style={{ fontSize: '0.78rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9a2918', textDecoration: 'none', borderBottom: '1px solid rgba(154,41,24,.35)', paddingBottom: 4, alignSelf: 'flex-end' }}>
            Shop all coffees →
          </Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '6px' }}>
          {COLLECTION.map((item, i) => (
            <div
              key={i}
              style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
              onMouseEnter={() => setHoveredBag(i)}
              onMouseLeave={() => setHoveredBag(null)}
              onFocus={() => setHoveredBag(i)}
              onBlur={() => setHoveredBag(null)}
              tabIndex={0}
            >
              <div style={{ height: 3, backgroundColor: item.color, flexShrink: 0 }} />
              <div style={{ aspectRatio: '3/4.6', position: 'relative', overflow: 'hidden', backgroundColor: '#141110' }}>
                <div style={{ position: 'absolute', inset: 0, opacity: hoveredBag === i ? 0 : 1, transition: 'opacity 0.3s ease' }}>
                  <img src={item.scan} alt={`${item.name} archetype`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }} />
                </div>
                <div style={{ position: 'absolute', inset: 0, backgroundColor: item.color, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: hoveredBag === i ? 1 : 0, transition: 'opacity 0.3s ease' }}>
                  <img src={item.bag} alt="" aria-hidden="true" loading="lazy" style={{ width: '72%', height: '84%', objectFit: 'contain', display: 'block' }} />
                </div>
              </div>
              <div style={{ textAlign: 'center', padding: '14px 6px 0' }}>
                <span style={{ display: 'block', fontSize: 12, letterSpacing: '0.14em', color: item.color, lineHeight: 1.3 }}>No. {item.num}</span>
                <span style={{ display: 'block', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#45474a', lineHeight: 1.3, marginTop: 3 }}>{item.name}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ━━━ §5 PHOTO ESSAY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(80px,10vw,120px) clamp(32px,6vw,80px)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'clamp(48px,6vw,72px)', flexWrap: 'wrap', gap: 16 }}>
          <h2 style={{ fontSize: 'clamp(24px,3vw,40px)', fontWeight: 400, color: '#45474a', margin: 0 }}>The first quiet hour.</h2>
          <Link to="/essays" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9a2918', textDecoration: 'none', borderBottom: '1px solid rgba(154,41,24,.35)', paddingBottom: 3, alignSelf: 'flex-end' }}>
            See all photographs →
          </Link>
        </div>
        <div style={{ display: 'flex', gap: 'clamp(16px,2vw,28px)', alignItems: 'flex-start' }}>
          {[
            { asset: photoEssay1, caption: 'Earthy · Jun 03, 2026', offset: 0 },
            { asset: photoEssay2, caption: 'Fruity · Jun 02, 2026', offset: 44 },
            { asset: photoEssay3, caption: 'Floral · Jun 06, 2026', offset: 88 },
          ].map((img, i) => (
            <div key={i} style={{ flex: 1, marginTop: img.offset }}>
              <div style={{ border: '1px solid #c5c7c8', padding: 14, backgroundColor: '#f2f1ea' }}>
                <img
                  src={img.asset.src}
                  srcSet={`${img.asset.mobileSrc} 800w, ${img.asset.src} 1200w`}
                  sizes="(max-width: 768px) 100vw, 33vw"
                  loading="lazy"
                  alt=""
                  width={1200}
                  height={1500}
                  style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block' }}
                />
              </div>
              {/* TODO: Camila writes final captions */}
              <p style={{ fontSize: 11, color: '#7b7f80', marginTop: 10, letterSpacing: '0.06em', margin: '10px 0 0' }}>{img.caption}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ━━━ §6 LIAM — video band with word reveal ━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ position: 'relative', height: 'clamp(56vh,62vh,65vh)', overflow: 'hidden', backgroundColor: '#201812', display: 'flex', alignItems: 'flex-end' }}>
        <video
          ref={liamVideoRef}
          // No autoPlay attribute (unlike the hero video): the below-the-fold
          // IntersectionObserver already calls .play() on scroll-into-view (below) —
          // autoplay-on-mount would force the browser to fetch immediately regardless
          // of preload="none", defeating the point of deferring this video.
          muted loop playsInline preload="none"
          poster={videoAssets.homePlaceholderPoster.src}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%', display: 'block' }}
        >
          <source src={liamVideo} type="video/mp4" />
        </video>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(16,10,6,0) 45%, rgba(16,10,6,.65) 100%)' }} />
        <p
          ref={liamTextRef}
          style={{
            position: 'relative', zIndex: 2,
            padding: '0 clamp(32px,6vw,64px) clamp(48px,7vh,72px)',
            fontSize: 'clamp(28px,3.6vw,46px)', fontWeight: 400, color: '#f2f1ea',
            margin: 0, maxWidth: 900, lineHeight: 1.3,
          }}
        >
          {LIAM_WORDS.map((tok, i) => {
            const visible = prefersReducedMotion || liamVisible;
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

      {/* ━━━ §7 VOICES — centered rotating quotes ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section
        style={{ backgroundColor: '#f2f1ea', padding: 'clamp(72px,10vw,120px) clamp(32px,6vw,80px)', textAlign: 'center' }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <span style={{ display: 'block', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#9a2918', marginBottom: 28 }}>In their words</span>

        <div style={{ minHeight: '7rem', position: 'relative', marginBottom: 28 }}>
          <AnimatePresence mode="wait">
            <motion.p
              key={activeIdx}
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={prefersReducedMotion ? false : { opacity: 0 }}
              transition={{ duration: 0.2 }}
              aria-live="polite"
              style={{
                fontSize: 'clamp(26px,2.6vw,36px)', fontWeight: 400, color: '#45474a',
                lineHeight: 1.35, maxWidth: 680, margin: '0 auto',
                position: 'absolute', left: '50%', transform: 'translateX(-50%)', width: '100%',
              }}
            >
              {QUOTES[activeIdx].before}
              <span style={{ backgroundColor: '#ee5974', color: '#f2f1ea', padding: '1px 8px' }}>{QUOTES[activeIdx].word}</span>{QUOTES[activeIdx].punct}{QUOTES[activeIdx].rest}
            </motion.p>
          </AnimatePresence>
        </div>

        <div role="group" aria-label="Quote navigation" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 0 }}>
          {QUOTES.map((_, i) => (
            <button
              key={i}
              aria-label={`Quote ${i + 1} of ${QUOTES.length}`}
              onClick={() => { setActiveIdx(i); setResetKey(k => k + 1); }}
              style={{ width: 24, height: 32, padding: 0, margin: 0, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9a2918]"
            >
              <div style={{
                width: 1, height: i === activeIdx ? 18 : 9,
                backgroundColor: i === activeIdx ? '#9a2918' : '#c5c7c8',
                transition: 'height 0.3s ease, background-color 0.3s ease',
                pointerEvents: 'none',
              }} />
            </button>
          ))}
        </div>
      </section>

      <StripesDivider />

      {/* ━━━ §8 THE MONTHS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(80px,10vw,120px) clamp(32px,6vw,80px)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 'clamp(8px,1.5vw,16px)' }}>
          {/* JULY 26 — clickable poster, opens film modal */}
          {/* TODO: replace dark placeholder with poster-july26.jpg once extracted */}
          <button
            onClick={() => setFilmModalOpen(true)}
            aria-label="Watch July 26 film"
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              display: 'flex', flexDirection: 'column', textAlign: 'left',
            }}
          >
            <div style={{ position: 'relative', aspectRatio: '3/4', backgroundColor: '#141110', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(20,12,8,0) 55%, rgba(20,12,8,.7) 100%)' }} />
              <div style={{ position: 'absolute', bottom: 20, left: 20, right: 20 }}>
                <p style={{ fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', color: 'rgba(242,241,234,.6)', margin: '0 0 6px' }}>The Collection</p>
                <p style={{ fontSize: 'clamp(18px,2.2vw,28px)', fontWeight: 400, color: '#f2f1ea', margin: 0, lineHeight: 1.15 }}>July 26</p>
                <p style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'rgba(242,241,234,.5)', margin: '8px 0 0' }}>Play ▶</p>
              </div>
            </div>
          </button>

          {/* Coming months — not clickable */}
          {['August', 'September', 'October'].map(month => (
            <div key={month} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ aspectRatio: '3/4', backgroundColor: '#ebebe3', border: '1px solid #c5c7c8', display: 'flex', alignItems: 'flex-end', padding: 20 }}>
                <p style={{ fontSize: 'clamp(14px,1.6vw,20px)', fontWeight: 400, color: '#7b7f80', margin: 0, lineHeight: 1.2 }}>{month}</p>
              </div>
            </div>
          ))}
        </div>
        <p style={{ textAlign: 'center', fontSize: 13, color: '#7b7f80', marginTop: 28, letterSpacing: '0.1em' }}>A new one, every month.</p>
      </section>

      {/* ━━━ §9 HOW IT WORKS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', borderTop: '1px solid #c5c7c8', padding: 'clamp(80px,10vw,120px) clamp(32px,6vw,80px)' }}>
        <p style={{ textAlign: 'center', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 clamp(48px,6vw,72px)' }}>How it works</p>
        <div style={{ display: 'flex', gap: 'clamp(32px,5vw,64px)', justifyContent: 'center', flexWrap: 'wrap' }}>
          {[
            { num: '01', text: 'Tell us how you taste. A short quiz maps your palate to one of six flavor archetypes.' },
            { num: '02', text: 'We match you to coffees that fit. Every bag in our collection aligns with how you actually taste.' },
            { num: '03', text: 'Your first delivery arrives. Taste it, tell us how it landed, and we refine from there.' },
          ].map(step => (
            <div key={step.num} style={{ flex: '1', minWidth: 220, maxWidth: 320, textAlign: 'center' }}>
              <span style={{ display: 'block', fontSize: 28, fontWeight: 400, color: '#9a2918', letterSpacing: '0.05em', marginBottom: 20 }}>{step.num}</span>
              <p style={{ fontSize: 15, color: '#45474a', lineHeight: 1.65, margin: 0 }}>{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ━━━ §10 THE GIFT (unwrap + footer) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <TasteFinderSection
        visitorName={visitorName}
        archetype={homepageState?.archetype}
      />

    </div>
  );
}
