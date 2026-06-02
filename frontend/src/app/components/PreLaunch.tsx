import { useState } from 'react';

const BRAND = '#a33726';

export default function PreLaunch() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    try {
      await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'pre_launch' }),
      });
    } catch {
      // fail silently — still show confirmation
    }
    setSubmitted(true);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex' }}
      className="flex-col md:flex-row"
    >
      {/* Left half — logo */}
      <div
        className="w-full h-1/2 md:w-1/2 md:h-full flex items-center justify-center"
        style={{ backgroundColor: '#f0ebe1', borderRight: '1px solid #a3372620', borderBottom: '1px solid #a3372620' }}
      >
        <svg
          viewBox="0 0 180 140"
          xmlns="http://www.w3.org/2000/svg"
          className="w-48 md:w-64"
          aria-label="Axis & Bloom"
        >
          {/* AXIS */}
          <text
            x="90" y="38"
            textAnchor="middle"
            fontFamily="Genova, sans-serif"
            fontWeight="100"
            fontSize="18"
            fill={BRAND}
            letterSpacing="10"
          >
            AXIS
          </text>

          {/* thin rule above & */}
          <line x1="55" y1="48" x2="125" y2="48" stroke={BRAND} strokeWidth="0.5" opacity="0.4" />

          {/* & */}
          <text
            x="90" y="92"
            textAnchor="middle"
            fontFamily="Genova, sans-serif"
            fontWeight="100"
            fontSize="58"
            fill={BRAND}
            opacity="0.85"
          >
            &amp;
          </text>

          {/* thin rule below & */}
          <line x1="55" y1="102" x2="125" y2="102" stroke={BRAND} strokeWidth="0.5" opacity="0.4" />

          {/* BLOOM */}
          <text
            x="90" y="122"
            textAnchor="middle"
            fontFamily="Genova, sans-serif"
            fontWeight="100"
            fontSize="18"
            fill={BRAND}
            letterSpacing="8"
          >
            BLOOM
          </text>
        </svg>
      </div>

      {/* Right half — content */}
      <div
        className="w-full h-1/2 md:w-1/2 md:h-full flex items-center justify-center px-10 md:px-16"
        style={{ backgroundColor: '#f0ebe1' }}
      >
        <div style={{ width: '100%', maxWidth: '320px' }}>

          {/* Headline */}
          <p style={{
            fontFamily: 'Genova, sans-serif',
            fontWeight: 400,
            color: BRAND,
            fontSize: '1.1rem',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            lineHeight: 1.6,
            margin: 0,
          }}>
            Your coffee identity.<br />Coming September 1.
          </p>

          {/* Thin separator */}
          <div style={{ height: '1px', backgroundColor: '#a3372630', margin: '2rem 0' }} />

          {/* Email form */}
          {submitted ? (
            <p style={{
              fontFamily: 'Genova, sans-serif',
              fontWeight: 400,
              color: BRAND,
              fontSize: '0.85rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}>
              You're on the list.
            </p>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your email"
                required
                style={{
                  width: '100%',
                  border: 'none',
                  borderBottom: `1px solid ${BRAND}`,
                  background: 'transparent',
                  padding: '12px 0',
                  fontFamily: 'Genova, sans-serif',
                  fontSize: '0.9rem',
                  color: BRAND,
                  outline: 'none',
                }}
                onFocus={e => (e.target.style.borderBottomColor = BRAND)}
              />
              <button
                type="submit"
                style={{
                  background: 'none',
                  border: 'none',
                  fontFamily: 'Genova, sans-serif',
                  fontWeight: 400,
                  fontSize: '0.85rem',
                  color: BRAND,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  padding: 0,
                  textAlign: 'left',
                  transition: 'opacity 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.6')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                JOIN →
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
