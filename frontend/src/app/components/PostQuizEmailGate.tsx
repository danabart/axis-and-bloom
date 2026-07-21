import { useState } from 'react';
import { subscribeNewsletter } from '../lib/api';

const BRAND = '#a33726';
const ACCENT = '#ee5974';

interface Props {
  archetypeName: string;
  archetypeColor: string;
  experimental?: boolean;
  confidence?: string;
  sessionKey: string;
  onSuccess: (email: string) => void;
}

// Step 04 (A2) — firm email gate. Calm, singular, in-place: appears once between
// the free Section 1 reveal and the gated Sections 2-3, no popup, no follow-scroll,
// no skip link. Firmness comes from the absence of a bypass, not UI pressure.
export function PostQuizEmailGate({ archetypeName, archetypeColor, experimental, confidence, sessionKey, onSuccess }: Props) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      await subscribeNewsletter({
        email,
        source: 'post_quiz',
        archetype: archetypeName,
        experimental,
        confidence,
        quizSessionKey: sessionKey,
      });
      onSuccess(email);
    } catch {
      setError(true);
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      maxWidth: 480,
      margin: '0 auto',
      padding: 'clamp(32px, 5vw, 48px) clamp(24px, 4vw, 40px)',
      textAlign: 'center',
    }}>
      <h2 style={{
        fontFamily: "'Lato', Arial, sans-serif",
        fontSize: 'clamp(1.5rem, 2.4vw, 1.9rem)',
        fontWeight: 400,
        color: BRAND,
        lineHeight: 1.3,
        margin: '0 0 14px',
      }}>
        Where should we send your match?
      </h2>
      <p style={{
        fontFamily: "'Lato', Arial, sans-serif",
        fontSize: '0.9rem',
        color: BRAND,
        opacity: 0.62,
        lineHeight: 1.6,
        margin: '0 0 32px',
      }}>
        The full why, your matched coffees, and your archetype card — plus first access October 1.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Your email address"
          required
          disabled={submitting}
          style={{
            width: '100%',
            border: 'none',
            borderBottom: `1.5px solid ${BRAND}`,
            background: 'transparent',
            padding: '12px 4px',
            fontFamily: "'Lato', Arial, sans-serif",
            fontSize: '1rem',
            color: BRAND,
            outline: 'none',
            textAlign: 'center',
          }}
        />
        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%',
            background: BRAND,
            color: '#f2f1ea',
            border: 'none',
            padding: '15px 0',
            fontFamily: "'Lato', Arial, sans-serif",
            fontSize: '0.72rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            cursor: submitting ? 'default' : 'pointer',
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? 'Sending…' : 'Show My Match'}
        </button>
        {error && (
          <p style={{
            fontFamily: "'Lato', Arial, sans-serif",
            fontSize: '0.78rem',
            color: ACCENT,
            margin: 0,
          }}>
            Something went wrong — please try again.
          </p>
        )}
      </form>
    </div>
  );
}
