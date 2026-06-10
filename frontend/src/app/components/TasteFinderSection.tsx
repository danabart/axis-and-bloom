import coffeePic13 from '../../design/IMAGES/lifestyle/CoffeePic13.png'

export function TasteFinderSection() {
  return (
    <section className="overflow-hidden" style={{ backgroundColor: '#f2f1ea' }}>
      <div className="flex flex-col md:flex-row md:h-[380px]">

        {/* Left: text — 42% on desktop */}
        <div
          className="w-full md:w-[42%] flex flex-col justify-center"
          style={{ padding: '32px clamp(28px, 4vw, 64px)', backgroundColor: '#f2f1ea' }}
        >
          <p style={{
            fontFamily: "'Genova', sans-serif",
            fontSize: '0.74rem',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: '#9a2918',
            margin: '0 0 16px',
          }}>
            The Taste Finder
          </p>

          <div style={{
            fontFamily: "'Genova', sans-serif",
            fontWeight: 400,
            lineHeight: 0.92,
            margin: '0 0 18px',
          }}>
            <span style={{ display: 'block', fontSize: 'clamp(2.4rem, 4.5vw, 4.5rem)', color: '#9a2918' }}>
              Which
            </span>
            <span style={{
              display: 'inline-block',
              fontSize: 'clamp(2.4rem, 4.5vw, 4.5rem)',
              backgroundColor: '#ee5974',
              color: '#f2f1ea',
              padding: '2px 12px',
              margin: '4px 0',
            }}>
              archetype
            </span>
            <span style={{ display: 'block', fontSize: 'clamp(2.4rem, 4.5vw, 4.5rem)', color: '#9a2918', marginTop: 4 }}>
              is yours?
            </span>
          </div>

          <p style={{
            fontFamily: "'Genova', sans-serif",
            fontSize: 'clamp(0.84rem, 1.1vw, 0.95rem)',
            fontWeight: 400,
            color: '#7b7f80',
            lineHeight: 1.7,
            margin: '0 0 18px',
            maxWidth: 340,
          }}>
            Our flavor system removes the guesswork — answer a few questions and find your perfect coffee match.
          </p>

          <a
            href="/find-my-flavor"
            style={{
              fontFamily: "'Genova', sans-serif",
              fontSize: '0.78rem',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#9a2918',
              textDecoration: 'none',
              borderBottom: '1px solid rgba(154,41,24,0.4)',
              paddingBottom: 3,
              width: 'fit-content',
            }}
          >
            TAKE THE QUIZ →
          </a>
        </div>

        {/* Right: chaff photo — fills remaining 58% */}
        <div className="w-full md:flex-1 relative" style={{ minHeight: 220 }}>
          <img
            src={coffeePic13}
            alt=""
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center',
              display: 'block',
            }}
          />
        </div>

      </div>
    </section>
  );
}
