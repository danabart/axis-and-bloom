import { useState } from 'react';
import logoUrl from '../../design/LOGO/LogoLines.svg';

const BRAND = '#a33726';

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  borderBottom: `1px solid ${BRAND}`,
  background: 'transparent',
  padding: '12px 0',
  fontFamily: 'Genova, sans-serif',
  fontSize: '0.9rem',
  color: BRAND,
  outline: 'none',
};

export default function PreLaunch() {
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
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
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex' }}
      className="flex-col md:flex-row"
    >
      {/* Left half — logo */}
      <div
        className="w-full h-1/2 md:w-1/2 md:h-full flex items-center justify-center"
        style={{ backgroundColor: '#f0ebe1', borderRight: '1px solid #a3372620', borderBottom: '1px solid #a3372620' }}
      >
        <img
          src={logoUrl}
          alt="Axis & Bloom"
          style={{ maxWidth: '280px', width: '100%' }}
        />
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

          {/* Form */}
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
                type="text"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="your first name"
                style={inputStyle}
              />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your email"
                required
                style={inputStyle}
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
