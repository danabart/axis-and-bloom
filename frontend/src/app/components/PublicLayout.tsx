import { Outlet, useLocation } from 'react-router';
import Navigation from './Navigation';
import Footer from './Footer';
import NewsletterModal from './NewsletterModal';

export default function PublicLayout() {
  const { pathname } = useLocation();
  // These pages render Footer inside TasteFinderSection (behind the curtain reveal)
  const footerInPage = pathname === '/' || pathname === '/about';

  return (
    <div className="flex flex-col min-h-screen">
      <Navigation />
      <main className="flex-grow">
        <Outlet />
      </main>
      {!footerInPage && <Footer />}
      <NewsletterModal />
    </div>
  );
}
