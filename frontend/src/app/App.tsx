import { BrowserRouter, Routes, Route } from 'react-router';
import { AuthProvider } from './context/AuthContext';
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

export default function App() {
  return (
    <AuthProvider>
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
            <Route path="coffees" element={<AdminCoffees />} />
            <Route path="sessions" element={<AdminSessions />} />
            <Route path="flavor-wheel" element={<AdminFlavorWheel />} />
          </Route>

          {/* ── Public site — shared nav + footer ── */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="/find-my-flavor" element={<FlavorQuiz />} />
            <Route path="/about" element={<About />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
