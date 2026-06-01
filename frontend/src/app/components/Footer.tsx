export default function Footer() {
  return (
    <footer className="w-full relative mt-auto">
      <div className="relative z-10 py-5 px-12" style={{ backgroundColor: '#f2f1ea', borderTop: '1px solid rgba(163,55,38,0.15)' }}>
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-wrap justify-center gap-8 text-sm items-center" style={{ color: '#9a2918' }}>
            <span className="font-semibold text-xs uppercase tracking-wider">© 2026 Axis & Bloom</span>
            <a href="/about" className="hover:opacity-80 transition-opacity">About</a>
            <a href="#contact" className="hover:opacity-80 transition-opacity">Contact</a>
            <a href="#privacy" className="hover:opacity-80 transition-opacity">Privacy Policy</a>
            <a href="#terms" className="hover:opacity-80 transition-opacity">Terms</a>
          </div>
          <div className="flex gap-6 items-center">
            <a href="#instagram" className="hover:opacity-80 transition-opacity" aria-label="Instagram">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9a2918" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
