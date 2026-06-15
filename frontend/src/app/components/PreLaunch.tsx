import { useState } from 'react';
import coffeeCup from '../../design/IMAGES/lifestyle/CoffeePic15Vertical.jpg';

const BRAND = '#a33726';
const CREAM = '#f0ebe1';

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  borderBottom: `1.5px solid ${BRAND}`,
  background: 'transparent',
  padding: '14px 0',
  fontFamily: 'Arial, sans-serif',
  fontSize: '1rem',
  color: BRAND,
  outline: 'none',
};

export default function PreLaunch() {
  const [firstName, setFirstName] = useState('');
  const [email, setEmail]         = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    try {
      await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firstName, source: 'pre_launch' }),
      });
    } catch {
      // fail silently — still show confirmation
    }
    setSubmitted(true);
  };

  return (
    <>
      <style>{`
        .pl-input::placeholder {
          color: ${BRAND};
          opacity: 0.45;
          font-family: Arial, sans-serif;
        }
      `}</style>

      <div
        className="fixed inset-0 z-[9999] flex flex-col md:flex-row"
        style={{ fontFamily: 'Arial, sans-serif' }}
      >
        {/* ── Left — full-bleed photo ───────────────────────────── */}
        <div
          className="w-full h-[45vh] md:w-1/2 md:h-full"
          style={{
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <img
            src={coffeeCup}
            alt=""
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center center',
            }}
          />
        </div>

        {/* ── Right — beige ─────────────────────────────────────── */}
        <div
          className="w-full h-[55vh] md:w-1/2 md:h-full flex items-center justify-center p-10 md:p-20"
          style={{ backgroundColor: '#f2f1ea' }}
        >
          <div style={{ width: '100%' }}>

            {/* Tagline */}
            <div style={{
              fontFamily: 'Arial, sans-serif',
              fontWeight: 400,
              fontSize: '1rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              lineHeight: 1.8,
            }}>
              <p style={{ color: BRAND, margin: '0 0 10px' }}>
                Your coffee identity.
              </p>
              <span style={{
                display: 'inline-block',
                backgroundColor: '#ee5974',
                color: '#f2f1ea',
                padding: '5px 14px 7px',
              }}>
                Coming September 1.
              </span>
            </div>

            {/* Separator */}
            <div style={{ height: '1px', backgroundColor: '#a3372640', margin: '32px 0' }} />

            {/* Form / confirmation */}
            {submitted ? (
              <p style={{
                fontFamily: 'Arial, sans-serif',
                fontWeight: 400,
                color: BRAND,
                fontSize: '0.95rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}>
                You're on the list.
              </p>
            ) : (
              <form
                onSubmit={handleSubmit}
                style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}
              >
                <input
                  type="text"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  placeholder="your first name"
                  className="pl-input"
                  style={inputStyle}
                />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your email"
                  required
                  className="pl-input"
                  style={inputStyle}
                />
                <button
                  type="submit"
                  style={{
                    background: 'none',
                    border: 'none',
                    fontFamily: 'Arial, sans-serif',
                    fontWeight: 400,
                    fontSize: '0.95rem',
                    color: BRAND,
                    letterSpacing: '0.15em',
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
    </>
  );
}
