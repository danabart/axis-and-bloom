import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router';
import { trackPageView } from './lib/analytics';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import PreLaunch from './components/PreLaunch';
import PublicLayout from './components/PublicLayout';
import Home from './components/Home';
import HowItWorks from './components/HowItWorks';
import FlavorQuiz from './components/FlavorQuiz';
import About from './components/About';
import Shop from './components/Shop';
import SignIn from './components/SignIn';
import Profile from './components/Profile';
import AdminRoute from './components/admin/AdminRoute';
import AdminLayout from './components/admin/AdminLayout';
import AdminDashboard from './components/admin/AdminDashboard';
import AdminCoffees from './components/admin/AdminCoffees';
import AdminSessions from './components/admin/AdminSessions';
import AdminFlavorWheel from './components/admin/AdminFlavorWheel';
import AdminRoasters from './components/admin/AdminRoasters';
import AdminCupping from './components/admin/AdminCupping';
import AdminDial from './components/admin/AdminDial';
import AdminInventory from './components/admin/AdminInventory';
import AdminSommelierConfig from './components/admin/AdminSommelierConfig';
import AdminIntentEditor from './components/admin/AdminIntentEditor';
import AdminSommelierFlow from './components/admin/AdminSommelierFlow';
import AdminAIOps from './components/admin/AdminAIOps';
import AdminSystemHealth from './components/admin/AdminSystemHealth';
import AdminCompanyGifts from './components/admin/AdminCompanyGifts';
import AdminQrDoor from './components/admin/AdminQrDoor';
import FlavorIntelligencePage from './components/FlavorIntelligencePage';
import CoffeesRedirect from './components/CoffeesRedirect';
import BloomPage from './components/BloomPage';
import CoffeeStoryPage from './components/CoffeeStoryPage';
import QrDoor from './components/QrDoor';
import JoinHousehold from './components/JoinHousehold';
import TheAxis from './components/TheAxis';
import Sommelier from './components/Sommelier';
import RequireAuth from './components/RequireAuth';
import PrelaunchGate from './components/PrelaunchGate';
import Privacy from './components/Privacy';
import Terms from './components/Terms';
import ConsentBanner from './components/ConsentBanner';
import { usePrelaunchGated } from './lib/prelaunch';

// GA4/Pixel config disables automatic page views (this is an SPA) — fire one on every
// route change instead, including the initial load, from inside the Router.
function AnalyticsRouteTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location.pathname, location.search]);
  return null;
}

function HomeOrPrelaunch() {
  const gated = usePrelaunchGated();
  if (gated) return <PreLaunch />;
  return <Home />;
}

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <BrowserRouter>
          <AnalyticsRouteTracker />
          <ConsentBanner />
          <Routes>
            {/* ── Admin portal — own layout, no public nav/footer ── */}
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <AdminLayout />
                </AdminRoute>
              }
            >
              <Route index element={<AdminDashboard />} />
              <Route path="coffees"    element={<AdminCoffees />} />
              <Route path="inventory" element={<AdminInventory />} />
              <Route path="sessions" element={<AdminSessions />} />
              <Route path="flavor-wheel" element={<AdminFlavorWheel />} />
              <Route path="roasters" element={<AdminRoasters />} />
              <Route path="cupping" element={<AdminCupping />} />
              <Route path="dial" element={<AdminDial />} />
              <Route path="qr-door" element={<AdminQrDoor />} />
              <Route path="sommelier/config"  element={<AdminSommelierConfig />} />
              <Route path="sommelier/intents" element={<AdminIntentEditor />} />
              <Route path="sommelier/flow"    element={<AdminSommelierFlow />} />
              <Route path="ai-ops" element={<AdminAIOps />} />
              <Route path="system-health" element={<AdminSystemHealth />} />
              <Route path="company-gifts" element={<AdminCompanyGifts />} />
            </Route>

            {/* ── Quiz — own minimal chrome, no public nav/footer/cart ── */}
            <Route path="/find-my-flavor" element={<FlavorQuiz />} />

            {/* ── Public site — shared nav + footer. Routes not in
                 lib/prelaunch.ts's PRELAUNCH_OPEN_ROUTES are wrapped in
                 <PrelaunchGate>, which redirects to the curtain at "/" while
                 VITE_PRELAUNCH_MODE is on and the session hasn't bypassed it. ── */}
            <Route element={<PublicLayout />}>
              <Route path="/" element={<HomeOrPrelaunch />} />
              <Route path="/how-it-works" element={<PrelaunchGate><HowItWorks /></PrelaunchGate>} />
              {/* Live deviation from the original spec (Dana, mid-execution): /about
                  is an old, admin-only-linked page not used on the live site — closed
                  like everything else, not kept open as the written prompt listed it. */}
              <Route path="/about" element={<PrelaunchGate><About /></PrelaunchGate>} />
              <Route path="/shop" element={<PrelaunchGate><Shop /></PrelaunchGate>} />
              <Route path="/sign-in" element={<SignIn />} />
              <Route
                path="/profile"
                element={
                  <RequireAuth>
                    <Profile />
                  </RequireAuth>
                }
              />
              <Route path="/flavor-intelligence" element={<PrelaunchGate><FlavorIntelligencePage /></PrelaunchGate>} />
              <Route path="/coffees" element={<PrelaunchGate><CoffeesRedirect /></PrelaunchGate>} />
              <Route path="/bloom" element={<PrelaunchGate><BloomPage /></PrelaunchGate>} />
              <Route path="/coffee/:id/story" element={<PrelaunchGate><CoffeeStoryPage /></PrelaunchGate>} />
              <Route path="/b/:token" element={<QrDoor />} />
              <Route
                path="/sommelier"
                element={
                  <PrelaunchGate>
                    <RequireAuth>
                      <Sommelier />
                    </RequireAuth>
                  </PrelaunchGate>
                }
              />
              <Route path="/join-household" element={<PrelaunchGate><JoinHousehold /></PrelaunchGate>} />
              {/* Live deviation from the original spec (Dana, mid-execution): /the-axis
                  is closed too, not kept open as the written prompt listed it. */}
              <Route path="/the-axis" element={<PrelaunchGate><TheAxis /></PrelaunchGate>} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </CartProvider>
    </AuthProvider>
  );
}
