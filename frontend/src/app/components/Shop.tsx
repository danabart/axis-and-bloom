import React from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { TasteFinderSection } from './TasteFinderSection';

// ─── Bags ─────────────────────────────────────────────────────────────────────
import bagFloral       from '../../design/IMAGES/bags/new bags mock up/FLORAL transp.png';
import bagFruity       from '../../design/IMAGES/bags/new bags mock up/FRUITY transp.png';
import bagBalanced     from '../../design/IMAGES/bags/new bags mock up/BALANCED & SWEET transp.png';
import bagChocolate    from '../../design/IMAGES/bags/new bags mock up/CHOCOLATE & NUTTY transp.png';
import bagEarthy       from '../../design/IMAGES/bags/new bags mock up/SPICY & EARTHY transp.png';
import bagExperimental from '../../design/IMAGES/bags/new bags mock up/EXPERIMENTAL transp.png';

// ─── Photos — none repeated from Home collection section ──────────────────────
import floralHero from '../../design/IMAGES/photos/june2026/WEBCUTFloralJun01.png';
import floralSm1  from '../../design/IMAGES/photos/june2026/WEBCUTFloralJun08.png';
import floralSm2  from '../../design/IMAGES/photos/june2026/WEBCUTFloralJun14.png';

import fruityHero from '../../design/IMAGES/photos/june2026/WEBCUTFruityJun01.png';
import fruitySm1  from '../../design/IMAGES/photos/june2026/WEBCUTFruityJun05.png';
import fruitySm2  from '../../design/IMAGES/photos/june2026/WEBCUTFruityJun06.png';

import balancedHero from '../../design/IMAGES/photos/june2026/WEBCUTBalanced&SweetJun02.png';
import balancedSm1  from '../../design/IMAGES/photos/june2026/WEBCUTBalanced&SweetJun04.png';
import balancedSm2  from '../../design/IMAGES/photos/june2026/WEBCUTBalanced&SweetJun09.png';

import chocolateHero from '../../design/IMAGES/photos/june2026/WEBCUTChocolate&NuttyJun02.png';
import chocolateSm1  from '../../design/IMAGES/photos/june2026/WEBCUTChocolate&NuttyJun08.png';
import chocolateSm2  from '../../design/IMAGES/photos/june2026/WEBCUTChocolate&NuttyJun10.png';

import earthyHero from '../../design/IMAGES/photos/june2026/WEBCUTSpicy&EarthyJun04.png';
import earthySm1  from '../../design/IMAGES/photos/june2026/WEBCUTSpicy&EarthyJun07.png';
import earthySm2  from '../../design/IMAGES/photos/june2026/WEBCUTSpicy&EarthyJun11.png';

import expHero from '../../design/IMAGES/photos/june2026/WEBCUTExperimentalJun2.png';
import expSm1  from '../../design/IMAGES/photos/june2026/WEBCUTExperimentalJun7.png';
import expSm2  from '../../design/IMAGES/photos/june2026/WEBCUTExperimentalJun10.png';

// ─── Data ─────────────────────────────────────────────────────────────────────

const ARCHETYPES = [
  {
    id: 'floral', num: '01', name: 'Floral', color: '#a34b78',
    descriptor: 'Light · Delicate · Aromatic',
    coffee: 'Ethiopia Yirgacheffe',
    notes: 'Jasmine, Bergamot, Lemon Zest',
    roast: 'Light', brew: 'Pour Over', price: '$22',
    bag: bagFloral, hero: floralHero, sm1: floralSm1, sm2: floralSm2,
  },
  {
    id: 'fruity', num: '02', name: 'Fruity', color: '#ca445f',
    descriptor: 'Vibrant · Juicy · Expressive',
    coffee: 'Colombia El Paraiso',
    notes: 'Strawberry, Peach, Hibiscus',
    roast: 'Light-Medium', brew: 'Aeropress', price: '$24',
    bag: bagFruity, hero: fruityHero, sm1: fruitySm1, sm2: fruitySm2,
  },
  {
    id: 'balanced', num: '03', name: 'Balanced & Sweet', color: '#d1ac11',
    descriptor: 'Smooth · Round · Comforting',
    coffee: 'Guatemala Antigua',
    notes: 'Caramel, Milk Chocolate, Red Apple',
    roast: 'Medium', brew: 'Drip / Espresso', price: '$20',
    bag: bagBalanced, hero: balancedHero, sm1: balancedSm1, sm2: balancedSm2,
  },
  {
    id: 'chocolate', num: '04', name: 'Chocolate & Nutty', color: '#a54c2d',
    descriptor: 'Rich · Grounded · Satisfying',
    coffee: 'Brazil Cerrado',
    notes: 'Dark Chocolate, Almond, Molasses',
    roast: 'Medium-Dark', brew: 'Espresso', price: '$19',
    bag: bagChocolate, hero: chocolateHero, sm1: chocolateSm1, sm2: chocolateSm2,
  },
  {
    id: 'earthy', num: '05', name: 'Spicy & Earthy', color: '#912f2f',
    descriptor: 'Warm · Deep · Lasting',
    coffee: 'Sumatra Mandheling',
    notes: 'Cedar, Clove, Dark Cocoa',
    roast: 'Dark', brew: 'French Press', price: '$21',
    bag: bagEarthy, hero: earthyHero, sm1: earthySm1, sm2: earthySm2,
  },
  {
    id: 'experimental', num: '06', name: 'Experimental', color: '#056c7a',
    descriptor: 'Wild · Unexpected · Always Changing',
    coffee: 'Costa Rica Anaerobic',
    notes: 'Cinnamon, Tropical Fruit, Rum',
    roast: 'Light', brew: 'V60', price: '$28',
    bag: bagExperimental, hero: expHero, sm1: expSm1, sm2: expSm2,
  },
] as const;

// ─── ArchetypeSection ──────────────────────────────────────────────────────────

function ArchetypeSection({ arch, index }: { arch: typeof ARCHETYPES[number]; index: number }) {
  const flip = index % 2 !== 0;

  const imgHover = (e: React.MouseEvent<HTMLImageElement>, scale: string) => {
    e.currentTarget.style.transform = `scale(${scale})`;
  };

  return (
    <motion.section
      id={arch.id}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.06 }}
      transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
      style={{
        borderTop: '1px solid rgba(154,41,24,0.08)',
        padding: 'clamp(52px, 7vh, 92px) clamp(32px, 6vw, 96px)',
      }}
    >
      {/* Header strip */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 'clamp(28px, 4vh, 52px)',
      }}>
        <span style={{
          fontSize: '0.49rem', letterSpacing: '0.38em', textTransform: 'uppercase',
          color: arch.color, opacity: 0.52,
        }}>
          No. {arch.num}
        </span>
        <span style={{
          fontSize: '0.49rem', letterSpacing: '0.26em', textTransform: 'uppercase',
          color: arch.color, opacity: 0.40,
        }}>
          {arch.descriptor}
        </span>
      </div>

      {/* Main body */}
      <div style={{
        display: 'flex',
        flexDirection: flip ? 'row-reverse' : 'row',
        gap: 'clamp(24px, 3.5vw, 56px)',
        height: 'clamp(460px, 68vh, 740px)',
      }}>

        {/* ── Photo column (58%) ── */}
        <div style={{ flex: '0 0 58%', display: 'flex', flexDirection: 'column', gap: 5, overflow: 'hidden' }}>
          {/* Hero photo — 64% of column height */}
          <div style={{ flex: '0 0 64%', overflow: 'hidden' }}>
            <img
              src={arch.hero}
              alt={arch.name}
              style={{
                width: '100%', height: '100%',
                objectFit: 'cover', objectPosition: 'center',
                display: 'block',
                transition: 'transform 0.9s cubic-bezier(0.16,1,0.3,1)',
              }}
              onMouseEnter={e => imgHover(e, '1.03')}
              onMouseLeave={e => imgHover(e, '1')}
            />
          </div>
          {/* Two small photos — remaining 36% */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, overflow: 'hidden' }}>
            <div style={{ overflow: 'hidden' }}>
              <img
                src={arch.sm1} alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform 0.9s cubic-bezier(0.16,1,0.3,1)' }}
                onMouseEnter={e => imgHover(e, '1.05')}
                onMouseLeave={e => imgHover(e, '1')}
              />
            </div>
            <div style={{ overflow: 'hidden' }}>
              <img
                src={arch.sm2} alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform 0.9s cubic-bezier(0.16,1,0.3,1)' }}
                onMouseEnter={e => imgHover(e, '1.05')}
                onMouseLeave={e => imgHover(e, '1')}
              />
            </div>
          </div>
        </div>

        {/* ── Info + bag column ── */}
        <div style={{
          flex: 1,
          display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between',
          overflow: 'hidden',
        }}>

          {/* Archetype name */}
          <h2 style={{
            fontSize: 'clamp(2.6rem, 4.2vw, 5.8rem)',
            color: arch.color,
            fontWeight: 400,
            lineHeight: 0.93,
            margin: 0,
            letterSpacing: '-0.025em',
          }}>
            {arch.name}
          </h2>

          {/* Bag — centered, vertically fills remaining space */}
          <div style={{
            flex: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'clamp(10px, 1.5vh, 20px) 0',
          }}>
            <img
              src={arch.bag}
              alt={`${arch.name} bag`}
              style={{
                maxHeight: 'clamp(170px, 30vh, 360px)',
                maxWidth: '88%',
                objectFit: 'contain',
                display: 'block',
                filter: 'drop-shadow(0 18px 44px rgba(0,0,0,0.09))',
                transition: 'transform 0.5s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.03)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            />
          </div>

          {/* Coffee details */}
          <div style={{ borderTop: '1px solid rgba(154,41,24,0.08)', paddingTop: 'clamp(14px, 2vh, 24px)' }}>
            <h3 style={{
              fontSize: 'clamp(0.96rem, 1.3vw, 1.35rem)',
              color: '#9a2918', fontWeight: 400,
              margin: '0 0 5px', letterSpacing: '0.01em',
            }}>
              {arch.coffee}
            </h3>
            <p style={{
              fontSize: 'clamp(0.70rem, 0.80vw, 0.78rem)',
              color: 'rgba(154,41,24,0.44)',
              margin: '0 0 clamp(12px, 1.8vh, 20px)',
              letterSpacing: '0.04em',
            }}>
              {arch.notes}
            </p>
            <div style={{ display: 'flex', gap: 28, marginBottom: 'clamp(14px, 2vh, 24px)' }}>
              <div>
                <p style={{ fontSize: '0.43rem', letterSpacing: '0.30em', textTransform: 'uppercase', color: 'rgba(154,41,24,0.36)', margin: '0 0 3px' }}>Roast</p>
                <p style={{ fontSize: '0.70rem', color: '#9a2918', margin: 0 }}>{arch.roast}</p>
              </div>
              <div>
                <p style={{ fontSize: '0.43rem', letterSpacing: '0.30em', textTransform: 'uppercase', color: 'rgba(154,41,24,0.36)', margin: '0 0 3px' }}>Best for</p>
                <p style={{ fontSize: '0.70rem', color: '#9a2918', margin: 0 }}>{arch.brew}</p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <span style={{ fontSize: 'clamp(1.15rem, 1.5vw, 1.5rem)', color: '#9a2918', fontWeight: 400 }}>
                {arch.price}
              </span>
              <button
                style={{
                  background: arch.color, border: 'none',
                  color: '#f2f1ea',
                  padding: '10px 20px',
                  fontSize: '0.50rem', letterSpacing: '0.28em', textTransform: 'uppercase',
                  fontFamily: 'inherit', cursor: 'pointer',
                  transition: 'opacity 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.78'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
              >
                Shop This Bag
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Shop() {
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div style={{ backgroundColor: '#f2f1ea', minHeight: '100vh' }}>

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <section style={{
        padding: 'clamp(100px, 14vh, 160px) clamp(32px, 6vw, 96px) clamp(52px, 7vh, 80px)',
      }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.95 }}
        >
          <p style={{
            fontSize: '0.50rem', letterSpacing: '0.38em', textTransform: 'uppercase',
            color: 'rgba(154,41,24,0.40)', margin: '0 0 16px',
          }}>
            The Collection
          </p>
          <h1 style={{
            fontSize: 'clamp(3.2rem, 6.5vw, 8.5rem)',
            color: '#9a2918', fontWeight: 400,
            lineHeight: 0.92, margin: '0 0 clamp(28px, 4vh, 48px)',
            letterSpacing: '-0.03em',
          }}>
            Six worlds.<br />One is yours.
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <Link
              to="/find-my-flavor"
              style={{
                fontSize: '0.54rem', letterSpacing: '0.28em', textTransform: 'uppercase',
                color: '#f2f1ea', backgroundColor: '#9a2918',
                textDecoration: 'none', padding: '13px 26px',
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.78'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
            >
              Find My Archetype
            </Link>
            <span style={{
              fontSize: '0.50rem', letterSpacing: '0.26em', textTransform: 'uppercase',
              color: 'rgba(154,41,24,0.36)',
            }}>
              or scroll to explore
            </span>
          </div>
        </motion.div>
      </section>

      {/* ── Sticky archetype nav ──────────────────────────────────────────────── */}
      <div style={{
        position: 'sticky', top: 80, zIndex: 40,
        backgroundColor: '#f2f1ea',
        borderTop: '1px solid rgba(154,41,24,0.07)',
        borderBottom: '1px solid rgba(154,41,24,0.07)',
        padding: 'clamp(10px, 1.4vh, 16px) clamp(32px, 6vw, 96px)',
        display: 'flex', gap: 'clamp(14px, 2.5vw, 40px)',
        overflowX: 'auto',
      }}>
        {ARCHETYPES.map(arch => (
          <button
            key={arch.id}
            onClick={() => scrollTo(arch.id)}
            style={{
              background: 'none', border: 'none',
              fontFamily: 'inherit',
              fontSize: '0.48rem', letterSpacing: '0.28em', textTransform: 'uppercase',
              color: arch.color, opacity: 0.50,
              cursor: 'pointer', whiteSpace: 'nowrap',
              padding: '2px 0',
              transition: 'opacity 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '0.50'; }}
          >
            {arch.num} · {arch.name}
          </button>
        ))}
      </div>

      {/* ── Six archetype sections ─────────────────────────────────────────────── */}
      {ARCHETYPES.map((arch, i) => (
        <ArchetypeSection key={arch.id} arch={arch} index={i} />
      ))}

      {/* ── Subscription strip ───────────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.25 }}
        transition={{ duration: 0.9 }}
        style={{
          borderTop: '1px solid rgba(154,41,24,0.08)',
          padding: 'clamp(72px, 10vh, 120px) clamp(32px, 6vw, 96px)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'flex-start',
        }}
      >
        <p style={{
          fontSize: '0.50rem', letterSpacing: '0.38em', textTransform: 'uppercase',
          color: 'rgba(154,41,24,0.40)', margin: '0 0 16px',
        }}>
          The Ritual
        </p>
        <h2 style={{
          fontSize: 'clamp(2.2rem, 4vw, 5.2rem)',
          color: '#9a2918', fontWeight: 400,
          lineHeight: 1.0, margin: '0 0 clamp(14px, 2vh, 22px)',
          letterSpacing: '-0.02em',
        }}>
          Your archetype,<br />every month.
        </h2>
        <p style={{
          fontSize: 'clamp(0.78rem, 0.92vw, 0.92rem)',
          color: 'rgba(154,41,24,0.44)',
          margin: '0 0 clamp(32px, 4.5vh, 52px)',
          lineHeight: 1.75, maxWidth: 460,
        }}>
          A recurring delivery matched to your taste. Stick with your archetype or let it evolve over time.
        </p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 20 }}>
          <button
            style={{
              background: '#9a2918', border: 'none', color: '#f2f1ea',
              padding: '14px 30px',
              fontSize: '0.52rem', letterSpacing: '0.28em', textTransform: 'uppercase',
              fontFamily: 'inherit', cursor: 'pointer', transition: 'opacity 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.78'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            Build My Ritual
          </button>
          <span style={{
            fontSize: '0.48rem', letterSpacing: '0.20em', textTransform: 'uppercase',
            color: 'rgba(154,41,24,0.28)',
          }}>
            From $18 per bag
          </span>
        </div>
      </motion.section>

      <TasteFinderSection />
    </div>
  );
}
