const RED = '#9a2918';
const BODY = 'rgba(0,0,0,0.62)';

const section: React.CSSProperties = { marginTop: '2.25rem' };
const h2: React.CSSProperties = { fontSize: '1.2rem', fontWeight: 500, color: RED, margin: '0 0 0.75rem' };
const p: React.CSSProperties = { fontSize: '0.95rem', color: BODY, lineHeight: 1.75, margin: '0 0 0.9rem', maxWidth: 680 };
const calloutCard: React.CSSProperties = {
  background: '#f2f1ea', border: '0.5px solid rgba(154,41,24,0.15)', borderLeft: `2.5px solid ${RED}`,
  borderRadius: 8, padding: '1.1rem 1.25rem', maxWidth: 680,
};

// Step 03 (B2) — baseline terms. The Right Match Promise section is a placeholder;
// final wording lands out of the Aug 8, 2026 pricing workshop (launch/30_compliance/README.md).
export default function Terms() {
  return (
    <div style={{ fontFamily: "'Lato', Arial, sans-serif", backgroundColor: '#f2f1ea', minHeight: '100vh' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 'clamp(72px, 10vw, 108px) clamp(24px, 6vw, 32px) clamp(64px, 8vw, 96px)' }}>
        <p style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', margin: '0 0 10px' }}>
          Legal
        </p>
        <h1 style={{ fontSize: 'clamp(2rem, 4.5vw, 2.6rem)', fontWeight: 400, color: RED, margin: '0 0 8px', lineHeight: 1.15 }}>
          Terms of Service
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'rgba(0,0,0,0.4)', margin: 0 }}>
          Last updated July 2026. Plain-language summary — not a substitute for legal advice.
        </p>

        <div style={section}>
          <p style={p}>
            By using axisandbloomcoffee.com or placing an order, you're agreeing to the terms below. We've
            kept them short on purpose — if anything here is unclear, email us and we'll explain.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Orders and payment</h2>
          <p style={p}>
            Prices shown at checkout are the prices you'll be charged. We reserve the right to correct
            obvious pricing errors before an order ships. Subscriptions renew on the schedule you choose and
            can be paused, changed, or cancelled from your account at any time before the next billing date.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Shipping and delivery</h2>
          <p style={p}>
            We ship to the address on file at the time of your order. Delivery windows are estimates from our
            roastery partners, not guarantees — we'll let you know if something's running unusually late.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>The Right Match Promise</h2>
          <div style={calloutCard}>
            <p style={{ ...p, margin: 0, fontStyle: 'italic' }}>
              Placeholder — final wording pending the Aug 8, 2026 pricing workshop. Baseline shape agreed so
              far: if your first order isn't the right match, we'll replace it once with a different coffee
              from your archetype, at no additional cost. One replacement bag per customer, per first order
              only. Exact eligibility window and request process to be finalized.
            </p>
          </div>
        </div>

        <div style={section}>
          <h2 style={h2}>Your account</h2>
          <p style={p}>
            You're responsible for keeping your account credentials secure and for the accuracy of the
            information you give us. We may suspend an account used for fraud, abuse, or in violation of
            these terms.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Our content and recommendations</h2>
          <p style={p}>
            Coffee matches, tasting notes, and Liam's suggestions are generated from our own data and, in
            part, AI — they're guidance, not a guarantee you'll love every bag. The site, its design, and its
            content belong to Axis &amp; Bloom and may not be reproduced without permission.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Changes</h2>
          <p style={p}>
            We may update these terms as the business evolves. Meaningful changes will be reflected here with
            an updated date; continued use of the site after a change means you accept the update.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>Questions</h2>
          <p style={p}>
            Reach us at{' '}
            <a href="mailto:hello@axisandbloomcoffee.com" style={{ color: RED }}>hello@axisandbloomcoffee.com</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
