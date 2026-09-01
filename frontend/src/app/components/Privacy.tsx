const RED = '#9a2918';
const BODY = 'rgba(0,0,0,0.62)';

const section: React.CSSProperties = { marginTop: '2.25rem' };
const h2: React.CSSProperties = { fontSize: '1.2rem', fontWeight: 500, color: RED, margin: '0 0 0.75rem' };
const p: React.CSSProperties = { fontSize: '0.95rem', color: BODY, lineHeight: 1.75, margin: '0 0 0.9rem', maxWidth: 680 };
const li: React.CSSProperties = { fontSize: '0.95rem', color: BODY, lineHeight: 1.75, marginBottom: '0.4rem' };

// Step 03 (B2) — baseline privacy policy. Plain-language, not a legal document;
// see launch/30_compliance/03_B2_compliance_pack.md's own note — a professional
// review of this text is a standing manual step (launch/GAPS.md #21) before ad spend scales.
export default function Privacy() {
  return (
    <div style={{ fontFamily: "'Lato', Arial, sans-serif", backgroundColor: '#f2f1ea', minHeight: '100vh' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 'clamp(72px, 10vw, 108px) clamp(24px, 6vw, 32px) clamp(64px, 8vw, 96px)' }}>
        <p style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', margin: '0 0 10px' }}>
          Legal
        </p>
        <h1 style={{ fontSize: 'clamp(2rem, 4.5vw, 2.6rem)', fontWeight: 400, color: RED, margin: '0 0 8px', lineHeight: 1.15 }}>
          Privacy Policy
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'rgba(0,0,0,0.4)', margin: 0 }}>
          Last updated July 2026. Plain-language summary — not a substitute for legal advice.
        </p>

        <div style={section}>
          <p style={p}>
            Axis &amp; Bloom matches you to coffee based on how you experience flavor. Doing that well means
            we collect some information about you. This page explains what we collect, why, and how to
            reach us if you'd like something changed or deleted.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Your quiz answers and taste profile</h2>
          <p style={p}>
            When you take the Find My Flavor quiz, we store your answers and the archetype they resolve to
            (e.g. Fruity, Floral, Earthy). This is the core of how the site personalizes what it shows and
            recommends to you — your matched archetype, the coffees suggested for you, and, if you chat with
            our AI sommelier Liam, the context he uses to talk about your taste. If you create an account,
            your taste profile is linked to it; if you take the quiz as a guest, it's tied to an anonymous
            session identifier instead.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Account and order data</h2>
          <p style={p}>If you create an account or place an order, we store:</p>
          <ul style={{ margin: '0 0 0.9rem', paddingLeft: '1.25rem' }}>
            <li style={li}>Basic account info (name, email) and your saved taste profile</li>
            <li style={li}>Order history and shipping address, so we can fulfill and track deliveries</li>
            <li style={li}>Feedback you give us about a coffee — through the site, a post-delivery text
              message, or a conversation with Liam — used to refine future recommendations</li>
            <li style={li}>Conversations with Liam, our AI sommelier (built on Anthropic's Claude), which we
              use to answer you and to improve recommendation quality</li>
          </ul>
          <p style={p}>
            Post-delivery text messages are opt-in and tied to an order — reply STOP at any time to end them.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Newsletter</h2>
          <p style={p}>
            If you give us your email — through a popup, the footer, or after taking the quiz — we add you to
            our mailing list via <strong>Mailchimp</strong>, our email service provider, who processes your
            email address and name on our behalf to send the messages you signed up for. You can unsubscribe
            from any email we send, at any time, using the link at the bottom of it.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Analytics and advertising</h2>
          <p style={p}>
            With your consent (see the cookie banner), we use <strong>Google Analytics (GA4)</strong> to
            understand how visitors use the site, and the <strong>Meta Pixel</strong> to measure and improve
            our ads on Facebook and Instagram. Both receive standard technical data about your visit (pages
            viewed, device type, approximate location) — never your quiz answers or taste profile. If you
            choose "essential only," neither loads, and no data is sent to Google or Meta.
          </p>
          <p style={p}>
            Separately, we log anonymous, first-party events about quiz progress (started, completed, email
            submitted) to our own database, regardless of your cookie choice — this is how we measure our own
            funnel and isn't shared with any outside company.
          </p>
          <p style={p}>
            If you arrive from an event landing page (like a QR code at a partner event), we store a
            randomly-generated, anonymous visitor key on your device to connect that visit to a later quiz
            completion or signup, along with basic landing details (referring page, campaign). It isn't tied to
            your name or email unless you separately give us those.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Cookies</h2>
          <p style={p}>
            We use a small amount of local browser storage to remember your cookie choice and, if you're
            signed in, to keep you logged in. Analytics and advertising cookies (GA4, Meta Pixel) are set
            only after you accept them in the banner.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Deleting your data</h2>
          <p style={p}>
            To request a copy of your data, correct it, or have it deleted, email us at{' '}
            <a href="mailto:hello@axisandbloomcoffee.com" style={{ color: RED }}>hello@axisandbloomcoffee.com</a>.
            We'll respond and complete reasonable requests within 30 days.
          </p>
        </div>
      </div>
    </div>
  );
}
