import { BrowserRouter, Routes, Route, useSearchParams } from 'react-router';
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
import AdminCompanyGifts from './components/admin/AdminCompanyGifts';
import FlavorIntelligencePage from './components/FlavorIntelligencePage';
import CoffeesRedirect from './components/CoffeesRedirect';
import BloomPage from './components/BloomPage';
import JoinHousehold from './components/JoinHousehold';
import TheAxis from './components/TheAxis';
import Sommelier from './components/Sommelier';
import RequireAuth from './components/RequireAuth';

const PRELAUNCH = import.meta.env.VITE_PRELAUNCH_MODE === 'true';

function HomeOrPrelaunch() {
  const [searchParams] = useSearchParams();
  const fromUrl = searchParams.get('preview') === 'true';
  if (fromUrl) sessionStorage.setItem('abPreview', 'true');
  const bypassed = fromUrl || sessionStorage.getItem('abPreview') === 'true';
  if (PRELAUNCH && !bypassed) return <PreLaunch />;
  return <Home />;
}

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <BrowserRouter>
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
              <Route path="sommelier/config"  element={<AdminSommelierConfig />} />
              <Route path="sommelier/intents" element={<AdminIntentEditor />} />
              <Route path="sommelier/flow"    element={<AdminSommelierFlow />} />
              <Route path="company-gifts" element={<AdminCompanyGifts />} />
            </Route>

            {/* ── Public site — shared nav + footer ── */}
            <Route element={<PublicLayout />}>
              <Route path="/" element={<HomeOrPrelaunch />} />
              <Route path="/how-it-works" element={<HowItWorks />} />
              <Route path="/find-my-flavor" element={<FlavorQuiz />} />
              <Route path="/about" element={<About />} />
              <Route path="/shop" element={<Shop />} />
              <Route path="/sign-in" element={<SignIn />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/flavor-intelligence" element={<FlavorIntelligencePage />} />
              <Route path="/coffees" element={<CoffeesRedirect />} />
              <Route path="/bloom" element={<BloomPage />} />
              <Route
                path="/sommelier"
                element={
                  <RequireAuth>
                    <Sommelier />
                  </RequireAuth>
                }
              />
              <Route path="/join-household" element={<JoinHousehold />} />
              <Route path="/the-axis" element={<TheAxis />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </CartProvider>
    </AuthProvider>
  );
}
