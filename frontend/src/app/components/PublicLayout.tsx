import { Outlet, useLocation, useSearchParams } from 'react-router';
import Navigation from './Navigation';
import Footer from './Footer';
import NewsletterModal from './NewsletterModal';

const PRELAUNCH = import.meta.env.VITE_PRELAUNCH_MODE === 'true';

export default function PublicLayout() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();

  // Mirror the preview-bypass logic from HomeOrPrelaunch
  const fromUrl = searchParams.get('preview') === 'true';
  if (fromUrl) sessionStorage.setItem('abPreview', 'true');
  const bypassed = fromUrl || sessionStorage.getItem('abPreview') === 'true';

  // When the pre-launch page is active, suppress nav and footer entirely
  // so nothing is visible beneath the fixed full-screen overlay
  const isPreLaunchPage = PRELAUNCH && pathname === '/' && !bypassed;

  // These pages render Footer inside TasteFinderSection (behind the curtain reveal)
  const footerInPage = pathname === '/' || pathname === '/about';

  // Quiz result page is a dedicated full-screen experience — no nav, footer, or modal
  const isQuizPage = pathname === '/find-my-flavor';

  if (isPreLaunchPage || isQuizPage) {
    return <Outlet />;
  }

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
