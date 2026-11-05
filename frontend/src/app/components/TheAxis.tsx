import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Wrap, Caps, Titled, Btn } from './chrome';
import { Photo } from './home/Photo';
import { OriginList, FamilyBands, FamilyList, FamilyWheel, ReadersPanel, Accordion, type FamilyLook } from './axis/AxisParts';
import { ARCHETYPE_VISUALS } from './bloom/bloomVisuals';
import { fieldLook } from './bloom/dial/archetypeConfig';
import { numberWord } from './bloom/useDialSlot';
import { formatCalendarDate } from '../lib/calendarDate';
import { widow } from '../lib/widow';
import { reportError } from '../lib/errorReporter';
import { axisAssets, lifestyleAssets } from '../../design/assets';
import type { ArchetypeData } from './bloom/types';
import './axis/axis.css';

// ── The Axis (Website 6, 2026-11-05) ──────────────────────────────────────────
// The handoff page (source/axis/build.py): intro + chapter nav, hero with the
// origin list, 01 Origin, 02 Place, 03 Network, 04 Readers, Start here. The world
// map, the scroll stages and the bag handoff animation are retired (D7).
//
// Copy is THE_AXIS_PAGE_COPY_V2.md (approved), except the three G4.4 rewrites
// listed in CLOSING_REPORT_6.md (Part C). Competitive-safety rule (unchanged,
// THE_AXIS_REDESIGN_STRATEGY.md): no numeric scales, dimension names, formulas,
// table names, real coffee names or quiz/adjacency logic on this page. Every
// number shown is the payload's: region counts, family counts, the stats line,
// the last-tightened date (GET /api/axis/stats), the family count and words
// (GET /api/coffees/archetypes). S1 (Dana, 2026-11-05): the bands and the 02 list
// show each family's three words.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_6_THE_AXIS.md

export interface AxisStats {
  archetypes: { key: string; name: string; coffeeCount: number }[];
  experimentalCount: number;
  bloomNotesThisMonth: number;
  positionsRefinedThisQuarter: number;
  lastTightenedAt: string | null;
  originRegions: { label: string; coffeeCount: number }[];
}

const INK = '#ba4c38';
const CHAPTERS = [
  { id: 'origin', num: '01', label: 'Where the data begins' },
  { id: 'place', num: '02', label: 'How a coffee earns its place' },
  { id: 'network', num: '03', label: 'No coffee is an island' },
  { id: 'readers', num: '04', label: 'One map, many readers' },
] as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function TheAxis() {
  const [searchParams] = useSearchParams();
  const [stats, setStats] = useState<AxisStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [archetypes, setArchetypes] = useState<ArchetypeData[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [current, setCurrent] = useState<string>(CHAPTERS[0].id);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/axis/stats')
      .then(r => { if (!r.ok) throw new Error(`stats ${r.status}`); return r.json(); })
      .then((data: AxisStats) => { if (!cancelled) setStats(data); })
      .catch(err => { if (!cancelled) { reportError('[TheAxis/stats]', err); setStatsError(true); } });
    fetch('/api/coffees/archetypes')
      .then(r => { if (!r.ok) throw new Error(`archetypes ${r.status}`); return r.json(); })
      .then((data: ArchetypeData[]) => { if (!cancelled) setArchetypes(data); })
      .catch(err => { if (!cancelled) reportError('[TheAxis/archetypes]', err); });
    return () => { cancelled = true; };
  }, []);

  // The five families, in sort_order, with their colour and three words.
  const families: FamilyLook[] = useMemo(() => [...archetypes]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .filter(a => ARCHETYPE_VISUALS[a.archetype])
    .map(a => ({
      code: a.archetype,
      label: a.archetypeLabel,
      color: ARCHETYPE_VISUALS[a.archetype].color,
      ink: ARCHETYPE_VISUALS[a.archetype].plateInk,
      // text on white (the 02 list): the family colour, except Balanced's yellow, which takes its accent (Website 5's override)
      accent: fieldLook(a.archetype)?.accent ?? ARCHETYPE_VISUALS[a.archetype].color,
      words: a.customerWords ?? null,
    })), [archetypes]);

  // ?archetype= focus (profile links): pre-highlights that family's band and opens chapter 02.
  const focusParam = searchParams.get('archetype');
  const focus = families.some(f => f.code === focusParam) ? focusParam : null;
  const hot = hover ?? focus;
  useEffect(() => {
    if (!focus) return;
    requestAnimationFrame(() => document.getElementById('place')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [focus]);

  // Scroll-spy: the chapter nav marks the chapter in view.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setCurrent(visible.target.id);
    }, { rootMargin: '-35% 0px -55% 0px' });
    CHAPTERS.forEach(c => { const el = document.getElementById(c.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);

  const regions = stats?.originRegions ?? [];
  const wheelFamilies = families.map(f => ({ ...f, count: stats?.archetypes.find(a => a.key === f.code)?.coffeeCount ?? 0 }));
  const lastTightened = stats?.lastTightenedAt
    ? formatCalendarDate(stats.lastTightenedAt, { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="ax-page">
      <Wrap as="section" id="top" aria-label="The Axis">
        <div className="ax-intro">
          <Titled>The Axis</Titled>
          <nav className="ax-chap-nav ab-caps" aria-label="Chapters" data-testid="chapter-nav">
            {CHAPTERS.map(c => (
              <a key={c.id} href={`#${c.id}`} className={current === c.id ? 'on' : undefined} aria-current={current === c.id ? 'true' : undefined}>
                <b>{c.num}</b>{c.label}
              </a>
            ))}
          </nav>
        </div>
      </Wrap>

      <section className="ax-hero" aria-label="Introduction">
        <Wrap>
          <div className={`ax-hero-g${regions.length ? '' : ' solo'}`}>
            <div className="ax-text">
              <h1 className="ax-h1">{widow('Every cup you love has a location. Here’s how it earns one.')}</h1>
              <p className="ax-lead">{widow('This is a window into our system: the same living map our recommendations, our sommelier, and your profile all read.')}</p>
              <p className="ax-lead">{widow('Here is the work behind every cup we suggest: how a coffee goes from a roaster’s description to a measured place on a map, how that map connects every coffee to its neighbors, and how it quietly gets more accurate every time someone tells us what they actually tasted.')}</p>
              <a href="#origin" className="ab-caps ax-ulink" style={{ alignSelf: 'flex-start' }}>↓ Follow the journey</a>
            </div>
            {regions.length > 0 && <div className="ax-hero-map"><OriginList regions={regions} /></div>}
          </div>
          <div className="ax-hero-foot ab-caps">
            {lastTightened && !statsError
              ? <span style={{ fontWeight: 400 }} data-testid="last-tightened">Map last tightened {lastTightened}.</span>
              : <span />}
            <a href="#origin" className="ax-ulink" style={{ fontWeight: 400 }}>01 — Where the data begins</a>
          </div>
        </Wrap>
      </section>

      <section className="ax-chap" id="origin" aria-label="Two streams meet at a coordinate.">
        <Wrap className="ax-cg">
          <div className="ax-text">
            <span className="ax-num" aria-hidden="true">01</span>
            <Titled style={{ alignSelf: 'flex-start' }}>Where the data begins</Titled>
            <h2 className="ax-h2">{widow('Two streams meet at a coordinate.')}</h2>
            <p className="ax-p">{widow('Every coffee arrives with a story: where it grew, how it was processed, how it was roasted, what the roaster tastes in it. We keep all of it — it’s the beginning of the data, and it matters.')}</p>
            <p className="ax-p">{widow('But we don’t stop there, because a story can’t tell you whether you will love what’s in the bag. So we taste. In structured cupping sessions, we measure each coffee across the same sensory dimensions, the same way, every time. The story tells us where a coffee came from. The cupping tells us where it is.')}</p>
            <Accordion question="How do we know our numbers mean anything?">
              {widow('Our tasting vocabulary and intensity method are built on the same published standards the specialty industry uses to train professional tasters: the World Coffee Research Sensory Lexicon and the SCA’s descriptive assessment approach, calibrated to coffee. We didn’t invent a private language — we adopted a shared one, so our measurements stay honest and comparable.')}
            </Accordion>
            <blockquote className="ax-quote">“{widow('Origin is where the data starts. It was never the destination.')}”</blockquote>
          </div>
          <div className="ax-panel">
            <div className="ax-streams">
              <figure>
                <Photo asset={axisAssets.story} fallback={lifestyleAssets.coffee15Vertical} alt="Coffee beans and dried orange slices on a black ground" sizes="(max-width: 900px) 45vw, 25vw" />
                <figcaption className="ab-caps">The story</figcaption>
              </figure>
              <span className="ax-meet" aria-hidden="true"><i /><b /><i /></span>
              <figure>
                <Photo asset={axisAssets.bowl} fallback={lifestyleAssets.coffee15} alt="A cupping bowl on a dark table" sizes="(max-width: 900px) 45vw, 25vw" />
                <figcaption className="ab-caps">The cupping</figcaption>
              </figure>
            </div>
            <Caps as="div" weight={400} className="ax-panel-cap">From farm to first measurement.</Caps>
          </div>
        </Wrap>
      </section>

      <section className="ax-chap" id="place" aria-label="How a coffee earns its place.">
        <Wrap className="ax-cg flip">
          <div className="ax-text">
            <span className="ax-num" aria-hidden="true">02</span>
            <Titled style={{ alignSelf: 'flex-start' }}>From impressions to coordinates</Titled>
            <h2 className="ax-h2">{widow('How a coffee earns its place.')}</h2>
            <p className="ax-p">
              {widow(`Raw tasting data is noisy — a cloud of impressions. Structure turns it into a place: every coffee is assigned to one of ${families.length ? numberWord(families.length).toLowerCase() : 'our'} sensory archetypes, and given a position within it.`)}
            </p>
            <FamilyList families={families} hot={hot} onHot={setHover} />
            <p className="ax-p">{widow('A position is not a poetic note. It’s a claim we can check — and we do. New coffees enter the map with an honest label: provisional. As cuppings and drinker feedback accumulate, the position hardens. We’d rather tell you a coordinate is young than pretend it was born perfect.')}</p>
            <Accordion question="What does ‘provisional’ mean?">
              {widow('Every position carries a confidence level based on how much evidence supports it. More cuppings, more Bloom Notes, more signal — higher confidence. You’ll see this honesty elsewhere on the site too; it’s how a measured system behaves.')}
            </Accordion>
          </div>
          <div className="ax-panel"><FamilyBands families={families} hot={hot} onHot={setHover} /></div>
        </Wrap>
      </section>

      <section className="ax-chap" id="network" aria-label="No coffee is an island.">
        <Wrap className="ax-cg">
          <div className="ax-text">
            <span className="ax-num" aria-hidden="true">03</span>
            <Titled style={{ alignSelf: 'flex-start' }}>The network beneath the shelf</Titled>
            <h2 className="ax-h2">{widow('No coffee is an island.')}</h2>
            <p className="ax-p">{widow('A shelf is a list. A map has neighbors. Every coffee on The Axis is connected to the coffees nearest it in taste — a step brighter, a step deeper, a step softer. Archetypes touch where real sensory bridges exist: some fruity coffees lean floral; some chocolatey coffees shade into earth.')}</p>
            <p className="ax-p">{widow('This is why you never fall off the map. Whatever you’re drinking, there is always a next step that makes sense — a small move, not a leap of faith.')}</p>
            <p className="ax-p">
              And scattered across the regions, you’ll find coffees flagged <b>Experimental</b> — {widow('unusual, seasonal, hard to place. They’re not a separate world. Each one lives near its kin (an experimental with floral notes sits near Floral) and is exactly one hop away when you’re feeling curious.')}
            </p>
            <p className="ax-note">{widow('The Axis is your direction: the profile you naturally return to. The Bloom is what unfolds within it — the small surprises, variations, and new expressions that keep coffee interesting.')}</p>
          </div>
          <div className="ax-panel">
            {stats && <FamilyWheel families={wheelFamilies} experimentalCount={stats.experimentalCount} ink={INK} />}
          </div>
        </Wrap>
      </section>

      <section className="ax-chap" id="readers" aria-label="One map. Many readers.">
        <Wrap className="ax-cg flip">
          <div className="ax-text">
            <span className="ax-num" aria-hidden="true">04</span>
            <Titled style={{ alignSelf: 'flex-start' }}>Where AI reads the map</Titled>
            <h2 className="ax-h2">{widow('One map. Many readers.')}</h2>
            <p className="ax-p">
              Everything you meet as a customer reads this same map. The quiz places you on it. Recommendations are the coffees nearest your position. And when you talk to <b>Liam</b>, {widow('our AI sommelier, he isn’t improvising — before he says a word, he reads the map: your taste profile, the coffees near it, and the paths between them.')}
            </p>
            <p className="ax-p">{widow('That’s AI working from a map. Liam can’t recommend a coffee we haven’t measured, and he doesn’t guess your taste — he reads it.')}</p>
            <p className="ax-p">{widow('We’ll be plain about the rest, too: AI helps us build the map, not just read it. As cupping data accumulates, AI suggests where a coffee’s position should move, and audits the map’s logic. Humans taste; AI keeps the bookkeeping honest.')}</p>
            <Accordion question="What Liam can and can’t see">
              {widow('Liam sees your taste profile and the measured map. He doesn’t see anything we haven’t measured, and he never invents a coffee. If he suggests a step, that step exists.')}
            </Accordion>
            {stats && !statsError && (
              <Caps as="p" weight={400} className="ax-stats" data-testid="stats-line" style={{ margin: 0 }}>
                {plural(stats.bloomNotesThisMonth, 'Bloom Note', 'Bloom Notes')} this month · {plural(stats.positionsRefinedThisQuarter, 'position', 'positions')} refined this quarter
              </Caps>
            )}
          </div>
          <div className="ax-panel"><ReadersPanel ink={INK} labels={['Quiz', 'Profile', 'Liam']} /></div>
        </Wrap>
      </section>

      <section className="ax-start" id="quiz" aria-label="Start here">
        <Wrap className="ax-cg">
          <div className="ax-text">
            <Titled style={{ alignSelf: 'flex-start' }}>Start here</Titled>
            <h2 className="ax-h2">{widow('Find your place on the map.')}</h2>
            <p className="ax-p">{widow('Three minutes. A few questions about how you experience flavor — not what you know about coffee. The result is your position on The Axis, and every recommendation flows from it.')}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', marginTop: 6 }}>
              <Btn to="/find-my-flavor">Take the Flavor Quiz</Btn>
              <Caps weight={400}>Free to take. No commitment.</Caps>
            </div>
          </div>
          <figure className="ax-frame">
            <Photo asset={axisAssets.start} fallback={lifestyleAssets.family} alt="A glass cup of coffee beans set down on a painted crosswalk" sizes="(max-width: 900px) 100vw, 55vw" />
          </figure>
        </Wrap>
      </section>
    </div>
  );
}
