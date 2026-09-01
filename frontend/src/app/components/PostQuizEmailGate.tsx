import React, { useState } from 'react';
import { subscribeNewsletter } from '../lib/api';
import { reportError } from '../lib/errorReporter';
import { getActiveCampaign } from '../lib/campaign';

const BRAND = '#a33726';
const ACCENT = '#ee5974';
const INK   = '#1a1a1a';
const GRAY  = 'rgba(26,26,26,0.45)';

interface Props {
  archetypeName: string;
  archetypeColor: string;
  experimental?: boolean;
  confidence?: string;
  sessionKey: string;
  onSuccess: (email: string) => void;
  /** Pre-Launch Reveal-in-Inbox — sealed-flow copy: before Oct 1 the match
   * isn't shown on screen at all, so the ask is framed around inbox delivery
   * rather than "see why this is you." Default false (today's copy, byte-
   * identical). Doesn't change `archetypeColor`'s own behavior — the caller
   * passes a neutral color while sealed (see FlavorQuiz.tsx). */
  sealed?: boolean;
}

export function PostQuizEmailGate({ archetypeName, archetypeColor, experimental, confidence, sessionKey, onSuccess, sealed = false }: Props) {
  const [firstName, setFirstName] = useState('');
  const [email, setEmail]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState(false);

  const trimmedFirstName = firstName.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !trimmedFirstName || submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      const activeCampaign = getActiveCampaign();
      await subscribeNewsletter({
        email,
        firstName: trimmedFirstName,
        source: 'post_quiz',
        archetype: archetypeName,
        experimental,
        confidence,
        quizSessionKey: sessionKey,
        ...(activeCampaign ? { campaign: activeCampaign.slug, campaignVid: activeCampaign.vid } : {}),
      });
      onSuccess(email);
    } catch (err) {
      reportError('[PostQuizEmailGate/subscribe]', err);
      setError(true);
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'left' }}>
      <h2 style={{
        fontSize: 'clamp(30px,3.2vw,46px)', fontWeight: 400,
        color: BRAND, lineHeight: 1.2,
        margin: '0 0 14px', letterSpacing: '-0.01em',
      }}>
        {sealed ? 'Your match is in. Where should we send it?' : 'Where should we send your match?'}
      </h2>
      <p style={{
        fontSize: 15, color: INK, opacity: 0.65, lineHeight: 1.65,
        maxWidth: 480, margin: '0 0 40px',
      }}>
        {sealed
          ? 'Your archetype, the why behind it, and your matched coffees — plus first access October 1.'
          : 'See why this is you — and meet the coffees chosen for your taste. Then make it entirely yours with the Bloom Dial. First access when doors open October 1.'}
      </p>

      {/* Parcel address block */}
      <div style={{ marginBottom: 32 }}>
        <p style={{
          fontSize: 13, letterSpacing: '.22em', textTransform: 'uppercase',
          color: GRAY, margin: '0 0 10px', fontWeight: 400,
        }}>
          FROM: AXIS &amp; BLOOM —
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 28 }}>
            <span style={{
              fontSize: 15, letterSpacing: '.14em',
              textTransform: 'uppercase', color: INK, flexShrink: 0,
              fontWeight: 400,
            }}>
              TO:
            </span>
            <div style={{ flex: 1 }}>
              <input
                type="text"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="Your first name"
                required
                autoComplete="given-name"
                disabled={submitting}
                style={{
                  width: '100%', border: 'none', borderBottom: `2px solid ${archetypeColor}`,
                  background: 'transparent',
                  padding: '6px 4px 8px',
                  fontSize: 'clamp(18px,1.8vw,24px)',
                  color: INK, outline: 'none', fontFamily: 'inherit',
                  marginBottom: 14,
                }}
              />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                autoComplete="email"
                disabled={submitting}
                style={{
                  width: '100%', border: 'none', borderBottom: `2px solid ${archetypeColor}`,
                  background: 'transparent',
                  padding: '6px 4px 8px',
                  fontSize: 'clamp(18px,1.8vw,24px)',
                  color: INK, outline: 'none', fontFamily: 'inherit',
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{
              background: BRAND, color: '#f2f1ea',
              border: 'none', padding: '15px 32px',
              fontSize: '0.70rem', letterSpacing: '.22em', textTransform: 'uppercase',
              cursor: submitting ? 'default' : 'pointer',
              opacity: submitting ? 0.6 : 1,
              fontFamily: 'inherit',
            }}
          >
            {submitting ? 'Sending…' : sealed ? 'SEND MY MATCH →' : 'SHOW ME WHY →'}
          </button>

          {error && (
            <p style={{ fontSize: '0.78rem', color: ACCENT, margin: '14px 0 0' }}>
              Something went wrong — please try again.
            </p>
          )}
        </form>
      </div>

      <p style={{ fontSize: 11.5, color: GRAY, letterSpacing: '.06em', margin: 0 }}>
        Your archetype card will be waiting.
      </p>
    </div>
  );
}
