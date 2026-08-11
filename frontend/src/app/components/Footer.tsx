import { Link } from 'react-router';
import { brandAssets } from '../../design/assets'
import { usePrelaunchGated } from '../lib/prelaunch';

const logoMark = brandAssets.logoQuarter1

export default function Footer() {
  const gated = usePrelaunchGated();
  // Flavor Intelligence is a hidden route while gated — omit the link
  // entirely rather than leaving it live ("never show a door we won't open").
  const exploreLinks = [
    { to: '/find-my-flavor', label: 'Find my flavor' },
    ...(gated ? [] : [{ to: '/flavor-intelligence', label: 'Flavor Intelligence' }]),
  ];

  return (
    <footer style={{ backgroundColor: '#f2f1ea', borderTop: '1px solid rgba(154,41,24,0.1)' }}>
      <div style={{ padding: 'clamp(28px, 3.5vw, 44px) clamp(24px, 5vw, 64px) clamp(16px, 2vw, 24px)', maxWidth: 1200, margin: '0 auto' }}>

        {/* Top row: brand + nav columns */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'clamp(20px, 4vw, 48px)', marginBottom: 'clamp(20px, 3vw, 32px)' }}>

          {/* Brand */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <img src={logoMark} alt="" style={{ height: 16, width: 'auto' }} />
              <span style={{ fontFamily: "'Lato', Arial, sans-serif", color: '#9a2918', fontSize: 16, letterSpacing: '0.1em', fontWeight: 400 }}>AXIS & BLOOM</span>
            </div>
            <p style={{ fontFamily: "'Lato', Arial, sans-serif", fontSize: '0.875rem', color: '#7b7f80', lineHeight: 1.7, margin: 0, maxWidth: 260 }}>
              Coffee matched to your personal flavor. Discover what feels like you.
            </p>
          </div>

          {/* Explore */}
          <div>
            <p style={{ fontFamily: "'Lato', Arial, sans-serif", fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 16px', opacity: 0.6 }}>Explore</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {exploreLinks.map(l => (
                <Link key={l.to} to={l.to} style={{ fontFamily: "'Lato', Arial, sans-serif", fontSize: '0.875rem', color: '#9a2918', textDecoration: 'none', opacity: 0.75 }} className="hover:opacity-100 transition-opacity">
                  {l.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Company */}
          <div>
            <p style={{ fontFamily: "'Lato', Arial, sans-serif", fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 16px', opacity: 0.6 }}>Company</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { href: '#contact', label: 'Contact' },
                { href: '#instagram', label: 'Instagram' },
              ].map(l => (
                l.to
                  ? <Link key={l.to} to={l.to} style={{ fontFamily: "'Lato', Arial, sans-serif", fontSize: '0.875rem', color: '#9a2918', textDecoration: 'none', opacity: 0.75 }} className="hover:opacity-100 transition-opacity">{l.label}</Link>
                  : <a key={l.href} href={l.href} style={{ fontFamily: "'Lato', Arial, sans-serif", fontSize: '0.875rem', color: '#9a2918', textDecoration: 'none', opacity: 0.75 }} className="hover:opacity-100 transition-opacity">{l.label}</a>
              ))}
            </div>
          </div>

        </div>

        {/* Bottom: copyright + legal */}
        <div style={{ borderTop: '1px solid rgba(154,41,24,0.1)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontFamily: "'Lato', Arial, sans-serif", fontSize: '0.75rem', color: '#7b7f80', letterSpacing: '0.04em' }}>
            © 2026 Axis & Bloom
          </span>
          <div style={{ display: 'flex', gap: 24 }}>
            {[{ to: '/privacy', label: 'Privacy' }, { to: '/terms', label: 'Terms' }].map(l => (
              <Link key={l.to} to={l.to} style={{ fontFamily: "'Lato', Arial, sans-serif", fontSize: '0.75rem', color: '#7b7f80', textDecoration: 'none', opacity: 0.7 }} className="hover:opacity-100 transition-opacity">
                {l.label}
              </Link>
            ))}
          </div>
        </div>

      </div>
    </footer>
  );
}
