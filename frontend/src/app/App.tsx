import { BrowserRouter, Routes, Route } from 'react-router';
import Navigation from './components/Navigation';
import Home from './components/Home';
import HowItWorks from './components/HowItWorks';
import FlavorQuiz from './components/FlavorQuiz';
import About from './components/About';
import Shop from './components/Shop';
import SignIn from './components/SignIn';
import Profile from './components/Profile';
import Footer from './components/Footer';
import NewsletterModal from './components/NewsletterModal';
import { AuthProvider } from './context/AuthContext';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="flex flex-col min-h-screen">
          <Navigation />
          <main className="flex-grow">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/how-it-works" element={<HowItWorks />} />
              <Route path="/find-my-flavor" element={<FlavorQuiz />} />
              <Route path="/about" element={<About />} />
              <Route path="/shop" element={<Shop />} />
              <Route path="/sign-in" element={<SignIn />} />
              <Route path="/profile" element={<Profile />} />
            </Routes>
          </main>
          <Footer />
          <NewsletterModal />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
