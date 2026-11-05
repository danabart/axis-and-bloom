import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import FilmModal from './FilmModal';
import OrderFeedbackForm from './OrderFeedbackForm';
import CompanyGiftRedemption from './CompanyGiftRedemption';
import { Wrap, Caps, Titled, Btn, ArrowIcon } from './chrome';
import { Photo, useFirstLoadable } from './home/Photo';
import Voices from './home/Voices';
import LiamThread from './home/LiamThread';
import HomeDialArt from './home/HomeDialArt';
import './home/home.css';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { usePrelaunchGated } from '../lib/prelaunch';
import { getHomepageState, getHomeContent, getArchetypes, setDialPosition, type HomeContent } from '../lib/api';
import { reportError } from '../lib/errorReporter';
import { formatCalendarDate } from '../lib/calendarDate';
import { formatPrice, type ArchetypeData, type CartItem } from './bloom/types';
import { ARCHETYPE_VISUALS } from './bloom/bloomVisuals';
import { archetypeAssets, homeAssets, quizAssets, lifestyleAssets, videoAssets, type ArchetypeSlug } from '../../design/assets';

// Website 3 (2026-11-05) — the handoff homepage on the new chrome.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_3_HOME.md
// Look: source/homepage-data/index.html (home/home.css). Behaviour kept from the
// previous Home: lifecycle CTA (renderSignedInCTA / renderStageCTA), the order
// feedback nudge with its 14-day "Not now", Company Gift redemption, the
// visitor-name hand-off to the quiz, FilmModal, pause-off-screen + the rAF loop
// fix on the film. Every number, word triple, quote, coffee name and price on
// this page comes from the API (G2.1, G4.2, D10, D13, D15).

// Mirrors FEEDBACK_NAG_SUPPRESS_DAYS in backend/src/services/userLifecycle.ts —
// how long the feedback nudge stays hidden after a user dismisses it.
const FEEDBACK_NAG_SUPPRESS_DAYS = 14;

/** The quiz reads this key on entry (FlavorQuiz.tsx) to prefill the name and skip its entry screen. */
export const QUIZ_NAME_SESSION_KEY = 'axisBloomCustomerName';
/** Remembered between visits (the old Home and TasteFinderSection read it). */
export const VISITOR_NAME_KEY = 'axisbloom.name';

/** archetype enum code → asset registry slug (the registry predates the enum). */
const SLUG_BY_CODE: Record<string, ArchetypeSlug> = {
  floral: 'floral', fruity: 'fruity', balanced_sweet: 'balanced-sweet',
  chocolate_nutty: 'chocolate-nutty', earthy: 'spicy-earthy', experimental: 'experimental',
};

function familyPhoto(code: string) {
  const slug = SLUG_BY_CODE[code];
  if (!slug) return null;
  const asset = slug === 'experimental' ? archetypeAssets.experimental.hero : homeAssets.family[slug];
  return { asset, fallback: archetypeAssets[slug].hero };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// The Liam example (08) is about Fruity, as drawn; its words come from the
// archetype payload by code, and the coffee is Fruity's gentle end (first slot).
const LIAM_EXAMPLE = { family: 'fruity', neighbor: 'floral' } as const;

export interface HomepageState {
  stageCode: string;
  archetype: { name: string; id: string; color: string; features: string[] } | null;
  daysSinceQuiz: number | null;
  pendingFeedback: { orderId: string; blendName: string | null; coffeeId: number | null } | null;
  usualBlend: { id: string; name: string } | null;
  nextDeliveryDate: string | null;
}

function readStorage(store: 'local' | 'session', key: string): string {
  try { return (store === 'local' ? localStorage : sessionStorage).getItem(key) ?? ''; } catch { return ''; }
}
function writeStorage(store: 'local' | 'session', key: string, value: string) {
  try {
    const s = store === 'local' ? localStorage : sessionStorage;
    if (value) s.setItem(key, value); else s.removeItem(key);
  } catch { /* storage blocked (private mode): the quiz asks for the name itself */ }
}

export default function Home() {
  const { user, isGuest, hasLiamAccess } = useAuth();
  const { addToCart } = useCart();
  const gated = usePrelaunchGated();
  const signedOut = !user || isGuest;

  const [content, setContent] = useState<HomeContent | null>(null);
  const [archetypes, setArchetypes] = useState<ArchetypeData[] | null>(null);

  useEffect(() => {
    getHomeContent().then(setContent).catch(err => reportError('[Home/content]', err));
    getArchetypes().then(setArchetypes).catch(err => reportError('[Home/archetypes]', err));
  }, []);

  // ── lifecycle state (unchanged from the previous Home) ─────────────────────
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
      .catch(err => { reportError('[Home/homepage-state]', err); setHomepageState(null); })
      .finally(() => setHomepageStateLoading(false));
  };

  useEffect(refreshHomepageState, [user]);

  useEffect(() => {
    const orderId = homepageState?.pendingFeedback?.orderId;
    if (orderId) {
      const dismissedAt = readStorage('local', `axisBloomFeedbackDismiss_${orderId}`);
      const suppressed = !!dismissedAt && Date.now() - Number(dismissedAt) < FEEDBACK_NAG_SUPPRESS_DAYS * 86400000;
      setFeedbackDismissed(suppressed);
    } else {
      setFeedbackDismissed(false);
    }
  }, [homepageState]);

  // ── visitor name → the quiz ────────────────────────────────────────────────
  // Task 0: the quiz reads only the session key, which used to be written on
  // the button click alone; both keys are now written as the name is typed.
  const [visitorName, setVisitorName] = useState(() => readStorage('local', VISITOR_NAME_KEY));
  const handleNameChange = (val: string) => {
    setVisitorName(val);
    writeStorage('local', VISITOR_NAME_KEY, val);
    writeStorage('session', QUIZ_NAME_SESSION_KEY, val.trim());
  };
  const handOffName = () => writeStorage('session', QUIZ_NAME_SESSION_KEY, visitorName.trim());

  // ── film (09): pause off-screen, rAF loop fix, FilmModal ───────────────────
  const [filmModalOpen, setFilmModalOpen] = useState(false);
  const [loopPaused, setLoopPaused] = useState(false);
  const loopPausedRef = useRef(false);
  const filmRef = useRef<HTMLVideoElement>(null);
  const poster = useFirstLoadable([homeAssets.heroPoster, videoAssets.homeHeroPoster.src]);

  useEffect(() => {
    const v = filmRef.current;
    if (!v) return;
    // rAF loop for clean video looping (avoids the black-frame tail)
    let raf = 0;
    const tick = () => {
      if (v.duration && v.currentTime >= v.duration - 0.5) v.currentTime = 0.05;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Pause when off-screen. .catch(() => {}): autoplay policy can reject
    // play() until a user gesture, or the element can unmount mid-call.
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(([e]) => {
        if (e.isIntersecting && !loopPausedRef.current) v.play().catch(() => {});
        else v.pause();
      }, { threshold: 0.05 });
      io.observe(v);
    }
    return () => { cancelAnimationFrame(raf); io?.disconnect(); };
  }, []);

  const toggleLoop = () => {
    const v = filmRef.current;
    const next = !loopPausedRef.current;
    loopPausedRef.current = next;
    setLoopPaused(next);
    if (!v) return;
    if (next) v.pause(); else v.play().catch(() => {});
  };

  // ── data derived for the sections ──────────────────────────────────────────
  const families = (archetypes ?? []).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const facts = content?.facts ?? null;
  const n = facts?.questions ?? null;
  const featured = content?.featured ?? null;
  const featuredFamily = featured ? families.find(f => f.archetype === featured.card.archetype) : undefined;
  const featuredPhoto = featured ? familyPhoto(featured.card.archetype) : null;

  const liamFamily = families.find(f => f.archetype === LIAM_EXAMPLE.family);
  const liamNeighbor = families.find(f => f.archetype === LIAM_EXAMPLE.neighbor);
  const gentleEnd = liamFamily?.slots.slice().sort((a, b) => a.dialSortOrder - b.dialSortOrder)[0]?.platformName ?? null;
  const liamExample = liamFamily && liamNeighbor ? {
    question: `Why ${liamFamily.archetypeLabel} and not ${liamNeighbor.archetypeLabel}?`,
    answer: `Your answers leaned toward ripe, juicy moments over fragrant ones. On the dial that places you at the gentle end of ${liamFamily.archetypeLabel}`
      + (gentleEnd ? `, next to ${gentleEnd}.` : '.')
      + ` Want to see the ${liamNeighbor.archetypeLabel} neighbor side by side?`,
    suggestions: [`Show me the ${liamNeighbor.archetypeLabel} neighbor`, 'How should I brew it?'],
  } : null;

  // Talk to Liam: hidden while gated; signed-out visitors go through sign-in;
  // signed-in customers without Liam access do not see it.
  const liamHref = gated ? null : signedOut ? '/sign-in?redirect=/sommelier' : hasLiamAccess ? '/sommelier' : null;

  function handleFeaturedAdd() {
    if (!featured?.price || !featured.card.platformName) return;
    const { card, price } = featured;
    const item: CartItem = {
      kind: 'dial',
      archetype: card.archetype,
      archetypeLabel: card.archetypeLabel,
      dialSortOrder: card.dialSortOrder,
      weightOz: price.weightOz,
      platformName: card.platformName!,
      retailPriceCents: price.retailPriceCents,
      qty: 1,
    };
    addToCart(item);
    // The same dial-event sync the dial card performs (ArchetypeSection / DialArchetypeSection).
    if (user) {
      setDialPosition(card.archetype, card.dialSortOrder, {
        trigger: 'add_to_cart', source: 'home', coffeeId: card.coffeeId ?? null,
      }).catch(err => reportError('[Home/add-to-cart-dial-sync]', err));
    }
  }

  // ── 03: signed-in / lifecycle CTA (same texts as the previous Home) ────────
  function renderFeedbackNudge() {
    const pf = homepageState?.pendingFeedback;
    if (!pf || feedbackDismissed) return null;
    return (
      <div className="hm-nudge" data-testid="home-feedback-nudge">
        <OrderFeedbackForm
          orderId={pf.orderId}
          blendName={pf.blendName}
          coffeeId={pf.coffeeId}
          onSubmitted={() => setFeedbackDismissed(true)}
        />
        <button
          type="button"
          className="hm-textbtn ab-caps"
          style={{ fontWeight: 400 }}
          onClick={() => {
            writeStorage('local', `axisBloomFeedbackDismiss_${pf.orderId}`, String(Date.now()));
            setFeedbackDismissed(true);
          }}
        >
          Not now
        </button>
      </div>
    );
  }

  function renderStageCTA(state: HomepageState) {
    const { stageCode, archetype, usualBlend, nextDeliveryDate } = state;
    const secondary = (to: string, label: string) => <Link to={to} className="hm-ulink ab-caps">{label}</Link>;
    if (stageCode === 'QUIZ_TAKEN_FRESH_NO_ORDER' || stageCode === 'QUIZ_TAKEN_SETTLED_NO_ORDER' || stageCode === 'QUIZ_STALE_NO_ORDER') {
      return (
        <>
          <h2 className="hm-h2">You're a {archetype?.name ?? 'match'} — shop your matches.</h2>
          <div className="hm-secondary">
            <Btn to="/shop" style={{ alignSelf: 'flex-start' }}>Shop your matches</Btn>
            {stageCode === 'QUIZ_TAKEN_SETTLED_NO_ORDER' && secondary('/find-my-flavor', 'Retake the quiz')}
            {stageCode === 'QUIZ_STALE_NO_ORDER' && secondary('/find-my-flavor', 'Palates change — retake anytime')}
          </div>
        </>
      );
    }
    if (stageCode === 'SUBSCRIBER') {
      return (
        <>
          <h2 className="hm-h2">Your subscription is on track.</h2>
          {nextDeliveryDate && (
            <p className="hm-lead">Next shipment: {formatCalendarDate(nextDeliveryDate, { month: 'long', day: 'numeric' })}</p>
          )}
          <Btn to="/profile" style={{ alignSelf: 'flex-start' }}>Manage subscription</Btn>
        </>
      );
    }
    if (stageCode === 'REORDER_DUE') {
      return (
        <>
          <h2 className="hm-h2">Ready for more {usualBlend?.name ?? 'your usual'}?</h2>
          <Btn to="/shop" style={{ alignSelf: 'flex-start' }}>Reorder</Btn>
        </>
      );
    }
    if (stageCode === 'LAPSED_SINGLE_ORDER') {
      return (
        <>
          <h2 className="hm-h2">New arrivals since your last order.</h2>
          <Btn to="/shop" style={{ alignSelf: 'flex-start' }}>See what's new</Btn>
        </>
      );
    }
    // ACTIVE_REPEAT_USER and any other fallback
    return (
      <>
        <h2 className="hm-h2">Welcome back.</h2>
        <Btn to="/shop" style={{ alignSelf: 'flex-start' }}>Shop again</Btn>
      </>
    );
  }

  /** The design's own 03 content: name field + quiz button (signed out, guests, NEW_NO_QUIZ). */
  function renderQuizInvite() {
    return (
      <>
        <Titled style={{ fontWeight: 600, alignSelf: 'flex-start' }}>Find my flavor</Titled>
        <h2 className="hm-h2">Ready to see your shape?</h2>
        <p className="hm-lead">
          {n !== null ? `${n} questions` : 'A few questions'} about moments, reactions and familiar foods. On the other side: your family of taste, your place on the dial, and the coffees that share it.
        </p>
        <form
          onSubmit={e => e.preventDefault()}
          style={{ display: 'flex', flexDirection: 'column', gap: 26, paddingTop: 8 }}
        >
          <div className="hm-field">
            <label htmlFor="home-first-name" className="ab-caps" style={{ fontWeight: 600 }}>Your first name</label>
            <input
              id="home-first-name"
              type="text"
              autoComplete="given-name"
              value={visitorName}
              onChange={e => handleNameChange(e.target.value)}
            />
          </div>
          <div className="hm-actions">
            <Btn to="/find-my-flavor" onClick={handOffName}>
              {n !== null ? `Take the ${n}-question quiz` : 'Take the quiz'}
            </Btn>
            {signedOut && (
              <Caps weight={400}>Have a profile? <Link to="/sign-in" className="hm-ulink">Sign in</Link></Caps>
            )}
          </div>
        </form>
      </>
    );
  }

  function renderSection03() {
    // Same branch as the previous Home: the anonymous form unless there is a
    // homepage state to speak to (a guest with no state still sees the form).
    const showInvite = !user || (user.isAnonymous && !homepageState);
    if (showInvite) return renderQuizInvite();
    if (homepageStateLoading || !homepageState) return null;
    return (
      <>
        {renderFeedbackNudge()}
        {homepageState.stageCode === 'NEW_NO_QUIZ' ? renderQuizInvite() : renderStageCTA(homepageState)}
      </>
    );
  }

  const balancedPhoto = familyPhoto('balanced_sweet')!;

  return (
    <div className="hm">
      <FilmModal src={videoAssets.homeHero} open={filmModalOpen} onClose={() => setFilmModalOpen(false)} />

      {/* ━━━ 01 FAMILIES ━━━ (the header floats over this band: PublicLayout) */}
      <section id="top" aria-label="Shop by family of taste" className="hm-fams">
        {families.map(f => {
          const photo = familyPhoto(f.archetype);
          const color = ARCHETYPE_VISUALS[f.archetype]?.color;
          return (
            <Link
              key={f.archetype}
              to={gated ? '/find-my-flavor' : `/shop#${f.archetype}`}
              className="hm-fam"
              style={{ background: color }}
              data-testid="home-family"
            >
              {photo && <Photo asset={photo.asset} fallback={photo.fallback} alt="" sizes="(max-width: 900px) 62vw, 20vw" className="hm-fam-photo" />}
              <span className="hm-fam-tint" aria-hidden="true" style={{ background: color }} />
              <span className="hm-fam-top">
                {f.sortOrder != null && <span className="hm-fam-num">{pad2(f.sortOrder)} —</span>}
                <span className="hm-fam-name">{f.archetypeLabel}</span>
              </span>
              <span className="hm-fam-bottom">
                <span className="hm-fam-rule" aria-hidden="true" />
                {f.customerWords && (
                  <span className="hm-fam-words">{f.customerWords.map(w => <span key={w}>{w}</span>)}</span>
                )}
                <span className="hm-fam-shop">Explore {f.archetypeLabel} <ArrowIcon /></span>
              </span>
            </Link>
          );
        })}
      </section>

      {/* ━━━ 02 MENU ROW ━━━ */}
      <Wrap as="section" aria-label="Menu" className="hm-menu-sec">
        <nav className="hm-menu" aria-label="Primary">
          {!gated && <Link to="/the-axis">The Axis <ArrowIcon strokeWidth={1} /></Link>}
          {!gated && <Link to="/bloom">The Bloom <ArrowIcon strokeWidth={1} /></Link>}
          <Link to="/find-my-flavor" onClick={handOffName}>Find My Flavor <ArrowIcon strokeWidth={1} /></Link>
        </nav>
      </Wrap>

      {/* ━━━ 03 FIND MY FLAVOR (+ lifecycle CTA, feedback nudge) ━━━ */}
      <Wrap as="section" id="quiz" aria-label="Find my flavor" style={{ paddingBottom: 'clamp(64px, 8vw, 128px)' }}>
        <div className="hm-fmf">
          <figure className="hm-figure">
            <div className="hm-mat">
              <Photo asset={balancedPhoto.asset} fallback={balancedPhoto.fallback} alt="" sizes="(max-width: 900px) 100vw, 40vw" style={{ aspectRatio: '1158 / 1384' }} />
            </div>
          </figure>
          <div className="hm-col" data-testid="home-section-03">
            {renderSection03()}
          </div>
        </div>
      </Wrap>

      {/* ━━━ COMPANY GIFT CODE REDEMPTION (directly under 03) ━━━ */}
      <Wrap className="hm-gift">
        <CompanyGiftRedemption onRedeemed={refreshHomepageState} />
      </Wrap>

      {/* ━━━ 03b WHY ━━━ */}
      <Wrap as="section" id="why" aria-label="Why we do this" style={{ paddingBottom: 'clamp(48px, 6vw, 88px)' }}>
        <div className="hm-whyg">
          <Titled style={{ fontWeight: 600, justifySelf: 'start' }}>Why we do this</Titled>
          <div className="hm-why-body">
            <h2 className="hm-why-h">Ask someone their favorite tea and they answer in a word. Ask about coffee and the room goes quiet.</h2>
            <p className="hm-why-p">Choosing coffee is hard. In a store you buy on a bag, a name, a roast level — none of which says how it will taste to you. Most people can’t name what they like, and many can’t say why one coffee disappointed and another didn’t.</p>
            <p className="hm-why-p">So we do the work on your side. We study taste and habits, we curate coffees from roasters across the US who source from all over the world, and we cup every one of them into our families of taste. Your match is the result.</p>
          </div>
        </div>
      </Wrap>

      {/* ━━━ 04 IN NUMBERS ━━━ */}
      {facts && (
        <section aria-label="In numbers" className="hm-facts" data-testid="home-facts">
          <div className="hm-fact" tabIndex={0}>
            <span className="hm-fact-n">{pad2(facts.questions)}</span>
            <Caps>Questions</Caps>
            <span className="hm-fact-more">About moments, reactions and familiar foods you already know.</span>
          </div>
          <div className="hm-fact" tabIndex={0}>
            <span className="hm-fact-n">{pad2(facts.dimensions)}</span>
            <Caps>Cupped dimensions</Caps>
            <span className="hm-fact-more">
              Every coffee scored{facts.scaleMin != null && facts.scaleMax != null ? ` ${facts.scaleMin} to ${facts.scaleMax},` : ''} {facts.dimensions} ways, and checked against the roaster’s notes.
            </span>
          </div>
          <div className="hm-fact" tabIndex={0}>
            <span className="hm-fact-n">{pad2(facts.families)}</span>
            <Caps>Families of taste</Caps>
            <span className="hm-fact-more">
              {families.length > 0 ? `${families.map(f => f.archetypeLabel).join(', ')}. ` : ''}You belong to one.
            </span>
          </div>
          <div className="hm-fact" tabIndex={0}>
            <span className="hm-fact-n">01</span>
            <Caps>Shape that is yours</Caps>
            <span className="hm-fact-more">Your place on the dial, sharper with every bag you tell us about.</span>
          </div>
        </section>
      )}

      {/* ━━━ 05 KNOW WHAT YOU LIKE ━━━ */}
      <Wrap as="section" id="shop" aria-label="Know what you like" className="hm-know-sec">
        <div className="hm-know">
          <div className="hm-col">
            <Titled style={{ fontWeight: 600, alignSelf: 'flex-start' }}>Know what you like?</Titled>
            <h2 className="hm-h2">Skip the quiz.<br />Go straight to the coffee.</h2>
            <p className="hm-lead">
              {facts ? `${facts.families} families` : 'Our families'}, a handful of coffees in each. Every one cupped on {facts ? `${facts.dimensions} dimensions` : 'every dimension'}, from partner roasteries.
            </p>
            {!gated && <Btn to="/shop" style={{ alignSelf: 'flex-start' }}>Shop all coffees</Btn>}
          </div>
          {featured && !gated && (
            <figure className="hm-figure" style={{ gap: 18 }} data-testid="home-featured">
              {featuredPhoto && (
                <div className="hm-mat" style={{ maxWidth: '100%' }}>
                  <Photo asset={featuredPhoto.asset} fallback={featuredPhoto.fallback} alt="" sizes="(max-width: 900px) 100vw, 55vw" style={{ aspectRatio: '5 / 4' }} />
                </div>
              )}
              <figcaption style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="hm-feat-row ab-caps">
                  <span>This week</span>
                  <span style={{ fontWeight: 400 }}>
                    {featuredFamily?.sortOrder != null ? `${pad2(featuredFamily.sortOrder)} — ` : ''}{featured.card.archetypeLabel}
                  </span>
                </div>
                <div className="hm-feat-title">
                  {featured.card.platformName && <span className="hm-feat-name">{featured.card.platformName}</span>}
                  {featured.card.signatureNotes && featured.card.signatureNotes.length > 0 && (
                    <Caps weight={400}>{featured.card.signatureNotes.join(' · ')}</Caps>
                  )}
                </div>
                {featured.price && featured.card.platformName && (
                  <div className="hm-feat-buy ab-caps">
                    <span style={{ fontWeight: 400 }}>{featured.price.weightOz} oz whole bean · {formatPrice(featured.price.retailPriceCents)}</span>
                    <button type="button" className="hm-ulink" onClick={handleFeaturedAdd}>Add to cart ↗</button>
                  </div>
                )}
              </figcaption>
            </figure>
          )}
        </div>
      </Wrap>

      {/* ━━━ 06 VOICES ━━━ */}
      {content && <Voices quotes={content.quotes} />}

      {/* ━━━ 07 THE AXIS ━━━ */}
      <section id="axis" aria-label="The Axis" className="hm-fot">
        <div className="hm-fot-rule" />
        <div className="hm-fot-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Titled style={{ fontWeight: 600, alignSelf: 'flex-start' }}>The Axis</Titled>
            <h2 className="hm-fot-h">How your shape gets drawn.</h2>
          </div>
          {!gated && <Btn to="/the-axis">The Axis</Btn>}
        </div>
        <div className="hm-fcards">
          <div className="hm-fcard is-dark">
            <Photo asset={homeAssets.axisQuiz} fallback={quizAssets.pic1} alt="" sizes="(max-width: 900px) 100vw, 33vw" className="hm-step-img" style={{ objectPosition: '50% 40%' }} />
            <Caps style={{ fontWeight: 600 }}>01 / The quiz</Caps>
            <span className="hm-fcard-name">{n !== null ? `Answer ${n} questions` : 'Answer a few questions'}</span>
            <p className="hm-step-p">Moments, reactions and familiar foods: things you already know about yourself. That is the whole point.</p>
            <span className="hm-fcard-foot"><Caps>About three minutes</Caps></span>
          </div>
          <div className="hm-fcard">
            <Photo asset={homeAssets.axisCupping} fallback={lifestyleAssets.coffee15} alt="" sizes="(max-width: 900px) 100vw, 33vw" className="hm-step-img" />
            <Caps style={{ fontWeight: 600 }}>02 / The cupping</Caps>
            <span className="hm-fcard-name">We cup every coffee</span>
            <p className="hm-step-p">
              Each bag is scored on {facts ? `${facts.dimensions} dimensions` : 'every dimension'}{facts && facts.scaleMin != null && facts.scaleMax != null ? `, ${facts.scaleMin} to ${facts.scaleMax},` : ''} and reconciled with the roaster’s own notes. Every session stays on record, and every score comes from the cup.
            </p>
            {facts && (
              <span className="hm-fcard-foot">
                <Caps>{facts.dimensions} dimensions{facts.scaleMin != null && facts.scaleMax != null ? ` · ${facts.scaleMin}–${facts.scaleMax}` : ''}</Caps>
              </span>
            )}
          </div>
          <div className="hm-fcard hm-fcard-dial">
            <HomeDialArt className="hm-dialart" />
            <Caps style={{ fontWeight: 600 }}>03 / The dial</Caps>
            <span className="hm-fcard-name">Your bloom lands on the dial</span>
            <p className="hm-step-p">Your shape is placed beside the coffees that share it. Order one, tell us what you thought, and the shape sharpens with every bag.</p>
            <span className="hm-fcard-foot"><Caps>Sharper with every bag</Caps></span>
          </div>
        </div>
        <div className="hm-fot-foot">
          <p>{n !== null ? `${n} questions` : 'A few questions'} about moments you know.<br />Your match is a shape drawn from your answers.</p>
        </div>
      </section>

      {/* ━━━ 08 LIAM ━━━ */}
      <Wrap as="section" id="liam" aria-label="Liam, your sommelier" className="hm-liam-sec">
        <div className="hm-liamg">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(22px, 2.6vw, 36px)' }}>
            <Titled style={{ fontWeight: 600, alignSelf: 'flex-start' }}>Liam · your AI sommelier</Titled>
            <h2 className="hm-h2">Liam reads the same evidence you do.</h2>
            <p className="hm-lead" style={{ maxWidth: '42ch' }}>
              Ask why you matched, what to try next, or how to brew the bag that just arrived. Liam answers from the cupping record and your own orders. Every answer stands on what the data shows.
            </p>
            {liamHref && <Btn to={liamHref} style={{ alignSelf: 'flex-start' }}>Talk to Liam</Btn>}
          </div>
          {liamExample && <LiamThread {...liamExample} />}
        </div>
      </Wrap>

      {/* ━━━ 09 FILM ━━━ */}
      <section id="film" aria-label="The film" className="hm-film">
        <video ref={filmRef} autoPlay muted loop playsInline preload="metadata" poster={poster} aria-label="Film: Axis & Bloom loop">
          <source src={videoAssets.homeLoop} type="video/mp4" />
          <source src={videoAssets.homeHero} type="video/mp4" />
        </video>
        <div className="hm-film-scrim" aria-hidden="true" />
        <div className="hm-film-over">
          <div className="hm-film-row">
            <div className="hm-film-col">
              <Caps style={{ fontWeight: 600 }}>Axis &amp; Bloom — Coffee, personalized</Caps>
              <h1 className="hm-hero-h"><span>Where coffee</span><span>meets AI.</span></h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
                <Btn to="/find-my-flavor" tone="paper" onClick={handOffName}>Find my flavor</Btn>
              </div>
            </div>
            <div className="hm-icon-btns">
              <button type="button" className="hm-icon-btn" aria-label="Watch the film with sound" onClick={() => setFilmModalOpen(true)}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2l9 5-9 5z" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
              </button>
              <button type="button" className="hm-icon-btn" aria-label={loopPaused ? 'Play the loop' : 'Pause the loop'} aria-pressed={loopPaused} onClick={toggleLoop}>
                {loopPaused
                  ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2l9 5-9 5z" fill="currentColor" /></svg>
                  : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2v10M11 2v10" stroke="currentColor" strokeWidth="1.6" /></svg>}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
