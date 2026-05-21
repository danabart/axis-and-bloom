import React, { useState, useMemo } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { saveQuizResult } from '../lib/api';

const dimensions = [
  { key: 'Chocolate & Nutty', color: '#a54c2d' },
  { key: 'Balanced & Sweet', color: '#d1ac11' },
  { key: 'Spicy & Earthy', color: '#912f2f' },
  { key: 'Floral', color: '#a34b78' },
  { key: 'Fruity', color: '#ca445f' },
  { key: 'Experimental', color: '#056c7a' },
];

const questions = [
  { id: 1, image: 'https://i.imgur.com/NQRCzNU.jpeg', text: 'What usually ruins a cup of coffee for you?', options: [{ text: 'It tastes too sour (like lemon)', effects: { chocolate: 3, balanced: 2, spicy: 1 } }, { text: 'It tastes too bitter', effects: { floral: 3, fruity: 2 } }, { text: 'It tastes too weak or tea like', effects: { chocolate: 2, spicy: 3 } }, { text: 'It tastes too burnt', effects: { floral: 2, fruity: 3 } }, { text: "I can't explain it. It just tastes wrong", effects: { chocolate: 2, balanced: 3, spicy: 1 } }] },
  { id: 2, image: 'https://i.imgur.com/ahLdfc7.jpeg', text: 'Your ideal first sip in the morning feels like:', options: [{ text: 'Smooth and comforting', effects: { chocolate: 2, balanced: 3, spicy: 1 } }, { text: 'Lively and wakes me up', effects: { floral: 2, fruity: 3 } }, { text: 'Strong and powerful', effects: { chocolate: 3, spicy: 2 } }, { text: 'The kind of smell that fills the whole room.', effects: { floral: 3, fruity: 2 } }, { text: 'Deep and grounding', effects: { chocolate: 2, spicy: 3 } }] },
  { id: 3, image: 'https://i.imgur.com/S46KQYC.jpeg', text: 'How do you usually choose coffee?', options: [{ text: 'Buy what smells good', effects: { floral: 2, fruity: 1 } }, { text: 'I like trying new coffees', effects: { experimental: 3 } }, { text: 'Look for fruity notes', effects: { floral: 1, fruity: 3 } }, { text: 'I like reading about the coffee before I buy it', effects: { experimental: 3, floral: 2, fruity: 1 } }, { text: 'Stick to same one', effects: { balanced: 3 } }, { text: 'Look for dark roast/strong', effects: { chocolate: 3, balanced: 1, spicy: 2 } }] },
  { id: 4, image: 'https://i.imgur.com/VVeubpF.jpeg', text: "What's the worst thing coffee can do?", options: [{ text: 'Feel thin and unsatisfying', effects: { chocolate: 3, spicy: 2 } }, { text: 'Feel dull and lifeless', effects: { floral: 2, fruity: 3 } }, { text: 'Feel sharp and harsh', effects: { chocolate: 2, spicy: 3 } }, { text: 'Smell flat or uninviting', effects: { floral: 3, fruity: 2 } }, { text: 'Feel out of balance', effects: { chocolate: 2, balanced: 3, spicy: 1 } }] },
  { id: 5, image: 'https://i.imgur.com/77RUAkw.jpeg', text: 'If coffee could come with a free bite, what would you pick?', options: [{ text: 'Dark chocolate / brownie', effects: { chocolate: 3, spicy: 2 } }, { text: 'Berry tart / fruit bowl', effects: { floral: 2, fruity: 3 } }, { text: 'Honey pastry / caramel cookie', effects: { chocolate: 2, balanced: 3, spicy: 1 } }, { text: 'Gingerbread / molasses cake', effects: { chocolate: 2, spicy: 3 } }, { text: 'Lemon madeleine / citrus cake', effects: { floral: 3, fruity: 2 } }] },
  { id: 6, image: 'https://i.imgur.com/LDfgl2h.jpeg', text: 'How do you usually like your coffee adjusted?', options: [{ text: 'I drink it black', effects: { floral: 3, fruity: 2 } }, { text: 'I like it creamy and smooth', effects: { chocolate: 3, balanced: 2, spicy: 1 } }, { text: 'I add something to cut the bitterness', effects: { chocolate: 2, spicy: 3 } }, { text: 'I like flavored or dessert-style coffee', effects: { chocolate: 2, balanced: 3, spicy: 1 } }, { text: 'Just a touch of sweetness to brighten it', effects: { floral: 2, fruity: 3 } }] },
  { id: 7, image: 'https://i.imgur.com/5hMlFFL.jpeg', text: 'How much effort do you want to put into coffee?', options: [{ text: "I don't want to think about it", effects: { chocolate: 1, balanced: 3 } }, { text: "I don't mind a little effort", effects: { experimental: 1 } }, { text: 'I like learning about coffee', effects: { experimental: 2, floral: 2, fruity: 1 } }, { text: 'I like playing with different coffees', effects: { experimental: 3, floral: 2, fruity: 1 } }, { text: 'I just want a safe, easy choice', effects: { chocolate: 3, balanced: 2 } }] },
  { id: 8, image: 'https://i.imgur.com/k2KrVf1.jpeg', text: 'What is your favorite brew method?', options: [{ text: 'Espresso machine', effects: { chocolate: 2, balanced: 3, spicy: 1 } }, { text: 'Pour-over (V60/Chemex)', effects: { floral: 2, fruity: 3 } }, { text: 'Drip machine', effects: { chocolate: 3, balanced: 2 } }, { text: 'French press', effects: { chocolate: 2, spicy: 3 } }, { text: 'Pod machine (Nespresso/Keurig)', effects: { chocolate: 2, balanced: 3, spicy: 1 } }] },
  { id: 9, image: 'https://i.imgur.com/Ka0Uged.jpeg', text: 'How easily can you explain why you disliked a coffee?', options: [{ text: 'Very clearly', effects: { experimental: 3 } }, { text: 'Somewhat', effects: { experimental: 2 } }, { text: "Not really, I just know", effects: { experimental: 1 } }, { text: "I don't think about it", effects: { experimental: 0 } }] },
  { id: 10, image: 'https://i.imgur.com/3NAnXgR.jpeg', text: 'When coffee is perfect, how do you feel?', options: [{ text: 'Warm and satisfied', effects: { chocolate: 3, balanced: 2, spicy: 1 } }, { text: 'Energized and alive', effects: { floral: 2, fruity: 3 } }, { text: 'Focused and clear', effects: { balanced: 2, floral: 3, fruity: 1 } }, { text: 'Grounded and strong', effects: { chocolate: 2, spicy: 3 } }, { text: 'Calm and content', effects: { chocolate: 2, balanced: 3, spicy: 1 } }] },
  { id: 11, image: 'https://i.imgur.com/sGZlLtT.jpeg', text: 'Which smells most inviting to you?', options: [{ text: 'Cocoa/toffee split', effects: { chocolate: 3, balanced: 2, spicy: 1 } }, { text: 'Caramel/Honey', effects: { chocolate: 2, balanced: 3, floral: 1 } }, { text: 'Fresh and floral (like jasmine)', effects: { floral: 3, fruity: 2 } }, { text: 'Berry-like', effects: { floral: 2, fruity: 3 } }, { text: 'Warm spices, like cinnamon or wood', effects: { chocolate: 2, spicy: 3 } }] },
  { id: 12, image: 'https://i.imgur.com/3WOJLhq.jpeg', text: 'When you drink coffee, how should it feel in your mouth?', options: [{ text: 'Silky and very smooth', effects: { chocolate: 2, balanced: 3, floral: 1 } }, { text: 'Light and almost tea-like', effects: { floral: 3, fruity: 2 } }, { text: 'Thick and heavy', effects: { chocolate: 2, spicy: 3 } }, { text: 'Clean but slightly crisp', effects: { floral: 2, fruity: 3 } }, { text: 'Smooth with a bit of structure', effects: { chocolate: 3, spicy: 2 } }] },
  { id: 13, image: 'https://i.imgur.com/I25LiTt.jpeg', text: 'After you swallow, what kind of finish do you enjoy?', options: [{ text: 'It fades quickly and cleanly', effects: { floral: 3, fruity: 2 } }, { text: 'A gentle lingering sweetness', effects: { chocolate: 2, balanced: 3, spicy: 1 } }, { text: 'A long, deep finish that stays', effects: { chocolate: 2, spicy: 3 } }, { text: 'A bright snap that disappears', effects: { floral: 2, fruity: 3 } }, { text: 'A smooth cocoa finish that lingers', effects: { chocolate: 3, balanced: 2, spicy: 1 } }] },
  { id: 14, image: 'https://i.imgur.com/GruXSw0.jpeg', text: 'How do you feel about a bold, slightly bitter edge?', options: [{ text: 'I enjoy a bold, slightly bitter edge', effects: { chocolate: 5 } }, { text: "I'm fine with a little bitterness", effects: {} }, { text: 'I prefer smooth and low bitterness', effects: { balanced: 5 } }, { text: "I don't like bitterness at all", effects: { fruity: 5 } }, { text: 'It depends — only if balanced', effects: {} }] },
  { id: 15, image: 'https://i.imgur.com/GruXSw0.jpeg', text: 'Decaf Preference', options: [{ text: 'Regular', effects: {} }, { text: 'Decaf', effects: {} }, { text: 'Both are fine', effects: {} }] },
];

const INITIAL_PROFILE = { floral: 0, fruity: 0, balanced: 0, chocolate: 0, spicy: 0, experimental: 0 };
type ProfileType = typeof INITIAL_PROFILE;

const ARCHETYPES = [
  { id: 'floral', name: 'Floral', color: '#a34b78', description: 'A delicate and aromatic profile with notes of jasmine, bergamot, and a tea-like body.', features: ['You prefer delicate aromatics over heavy roasts', 'You enjoy a light, tea-like body', 'You appreciate a bright, clean finish'], coffees: [{ id: 'c1', name: 'Ethiopia Yirgacheffe', flavor: 'Jasmine, Peach, Honey', match: '98%' }, { id: 'c2', name: 'Colombia Gesha', flavor: 'Bergamot, Black Tea, Floral', match: '92%' }], matchScore: (p: ProfileType) => p.floral },
  { id: 'fruity', name: 'Fruity', color: '#ca445f', description: 'A vibrant and juicy profile bursting with berry and stone fruit notes.', features: ['You prefer juicy acidity and bright notes', 'You enjoy vibrant fruit-forward flavors', 'You appreciate a crisp, clean finish'], coffees: [{ id: 'c3', name: 'Kenya Guji', flavor: 'Blueberry, Peach, Rose', match: '96%' }, { id: 'c4', name: 'Costa Rica Pink Bourbon', flavor: 'Strawberry, Watermelon', match: '89%' }], matchScore: (p: ProfileType) => p.fruity },
  { id: 'balanced', name: 'Balanced & Sweet', color: '#d1ac11', description: 'A round, smooth, and comforting profile with gentle sweetness.', features: ['You prefer lower acidity and round body', 'You enjoy caramelized and nutty sweetness', 'You are less sensitive to roast intensity'], coffees: [{ id: 'c5', name: 'Brazil Los Santos', flavor: 'Milk Chocolate, Caramel, Peanut', match: '99%' }, { id: 'c6', name: 'Guatemala Honey', flavor: 'Brown Sugar, Red Apple, Pecan', match: '94%' }], matchScore: (p: ProfileType) => p.balanced },
  { id: 'chocolate', name: 'Chocolate & Nutty', color: '#a54c2d', description: 'A rich and comforting profile with deep cocoa notes and roasted nuts.', features: ['You prefer a bold and comforting cup', 'You enjoy deep cocoa and roasted nut flavors', 'You appreciate a heavy, satisfying body'], coffees: [{ id: 'c7', name: 'Sumatra Mandheling', flavor: 'Dark Chocolate, Cedar, Walnut', match: '97%' }, { id: 'c8', name: 'Mexico Cerrado', flavor: 'Cocoa Nibs, Hazelnut, Molasses', match: '91%' }], matchScore: (p: ProfileType) => p.chocolate },
  { id: 'spicy', name: 'Spicy and Earthy', color: '#912f2f', description: 'A complex and savory profile with warming spices and woody notes.', features: ['You prefer a complex, savory depth', 'You enjoy warming spices and earthy notes', 'You appreciate a thick, structured finish'], coffees: [{ id: 'c9', name: 'India Chiapas', flavor: 'Cinnamon, Tobacco, Dark Cocoa', match: '95%' }, { id: 'c10', name: 'Papua New Guinea', flavor: 'Clove, Earth, Molasses', match: '88%' }], matchScore: (p: ProfileType) => p.spicy },
  { id: 'experimental', name: 'Experimental', color: '#056c7a', description: 'A wild and unexpected profile with unique fermentation flavors.', features: ['You prefer unique, unexpected flavor profiles', 'You enjoy wild fermentation and intense fruit', 'You appreciate complex, lively acidity'], coffees: [{ id: 'c11', name: 'Colombia Anaerobic', flavor: 'Mango, Rum, Passionfruit', match: '98%' }, { id: 'c12', name: 'Ethiopia Natural', flavor: 'Papaya, Wine, Strawberry', match: '93%' }], matchScore: (p: ProfileType) => p.experimental },
];

export default function FlavorQuiz() {
  const [hasStarted, setHasStarted] = useState(false);
  const [userName, setUserName] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [isComplete, setIsComplete] = useState(false);
  const { user } = useAuth();

  React.useEffect(() => {
    const savedName = sessionStorage.getItem('axisBloomCustomerName');
    if (savedName) { setUserName(savedName); setHasStarted(true); sessionStorage.removeItem('axisBloomCustomerName'); }
  }, []);

  const currentProfile = useMemo(() => {
    const profile = { ...INITIAL_PROFILE };
    Object.entries(answers).forEach(([qIdx, optIdx]) => {
      const option = questions[parseInt(qIdx)].options[optIdx];
      if (option?.effects) Object.entries(option.effects).forEach(([dim, val]) => { profile[dim as keyof ProfileType] += val as number; });
    });
    (Object.keys(profile) as Array<keyof ProfileType>).forEach(k => { profile[k] = Math.max(5, Math.min(100, profile[k])); });
    return profile;
  }, [answers]);

  const matchedArchetype = useMemo(() => ARCHETYPES.reduce((best, cur) => cur.matchScore(currentProfile) > best.matchScore(currentProfile) ? cur : best, ARCHETYPES[0]), [currentProfile]);

  const handleNext = () => {
    if (currentStep < questions.length - 1) { setCurrentStep(p => p + 1); }
    else {
      setIsComplete(true);
      const decafAnswer = answers[14];
      const decaf = decafAnswer === 1;
      if (user) {
        saveQuizResult({ archetype: matchedArchetype.id, scores: currentProfile, answers, decaf }).catch(console.error);
      }
    }
  };

  if (!hasStarted) {
    return (
      <div className="relative w-full min-h-screen bg-[#f2f1ea] flex overflow-hidden" style={{ fontFamily: '"Genova", sans-serif' }}>
        <div className="absolute inset-0"><img src="https://i.imgur.com/3NAnXgR.jpeg" alt="" className="w-full h-full object-cover" /></div>
        <div className="relative z-10 w-full p-8 pt-16 md:p-16 lg:p-24 flex flex-col justify-start items-start">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.7 }} className="w-full max-w-[480px] flex flex-col items-start">
            <h1 className="text-[2.5rem] lg:text-[3.5rem] text-[#ee5974] leading-[1.05] font-normal tracking-tight mb-8">Whose palate are we profiling today?</h1>
            <div className="w-full flex flex-col gap-8 mt-2">
              <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Enter your name" className="w-full text-left text-[1.25rem] tracking-wide py-3 rounded-none border-b border-[#a33726]/30 bg-transparent focus:outline-none focus:border-[#ee5974] text-[#a33726] placeholder-[#a33726]/40" onKeyDown={(e) => { if (e.key === 'Enter' && userName.trim()) setHasStarted(true); }} />
              <button onClick={() => setHasStarted(true)} disabled={!userName.trim()} className={`text-[10px] uppercase tracking-[0.3em] font-medium transition-all pb-1 border-b ${!userName.trim() ? 'text-[#a33726] opacity-30 border-transparent cursor-not-allowed' : 'text-[#a33726] border-[#a33726]/40 hover:border-[#ee5974] hover:text-[#ee5974]'}`}>Begin Profile</button>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  if (!isComplete) {
    const question = questions[currentStep];
    return (
      <div className="w-full min-h-screen flex flex-col lg:flex-row bg-[#f2f1ea]" style={{ fontFamily: '"Genova", sans-serif' }}>
        <div className="w-full lg:w-1/2 h-[40vh] lg:h-screen relative overflow-hidden bg-[#1a1a1a]">
          <AnimatePresence mode="wait">
            <motion.div key={currentStep} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1.2 }} className="absolute inset-0">
              <img src={question.image} alt={question.text} className="w-full h-full object-cover" />
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="w-full lg:w-1/2 min-h-[60vh] lg:h-screen bg-[#f2f1ea] px-12 py-16 lg:p-24 flex flex-col justify-center relative overflow-y-auto">
          <div className="w-full max-w-[480px] flex flex-col justify-center mx-auto lg:ml-[15%]">
            <AnimatePresence mode="wait">
              <motion.div key={currentStep} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.7 }} className="flex flex-col">
                <div className="text-[10px] uppercase tracking-[0.3em] text-[#a33726]/40 mb-4">{currentStep + 1} / {questions.length}</div>
                <h1 className="text-[2.5rem] lg:text-[3.5rem] text-[#ee5974] leading-[1.1] font-normal tracking-tight mb-16">{question.text}</h1>
                <div className="flex flex-col gap-4 w-full">
                  {question.options.map((option, idx) => {
                    const isSelected = answers[currentStep] === idx;
                    return (
                      <button key={idx} onClick={() => setAnswers(prev => ({ ...prev, [currentStep]: idx }))}
                        className={`w-full text-left text-[1.1rem] lg:text-[1.25rem] tracking-wide transition-all duration-500 px-8 py-5 rounded-[2.5rem] border-[1px] ${isSelected ? 'text-[#ee5974] border-[#ee5974]' : 'text-[#a33726] border-[#a33726]/20 opacity-70 hover:opacity-100 hover:border-[#ee5974]/50 hover:text-[#ee5974]'}`}>
                        {option.text.toLowerCase()}.
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </AnimatePresence>
            <div className="mt-16 flex flex-col items-start w-full">
              <button onClick={handleNext} disabled={answers[currentStep] === undefined}
                className={`text-[10px] uppercase tracking-[0.3em] font-medium transition-all pb-1 border-b ${answers[currentStep] === undefined ? 'text-[#a33726] opacity-20 border-transparent cursor-not-allowed' : 'text-[#a33726] border-[#a33726]/30 hover:border-[#ee5974] hover:text-[#ee5974]'}`}>
                Next Question
              </button>
              {!user && <Link to="/sign-in" className="text-[11px] uppercase tracking-[0.1em] text-[#a33726] opacity-40 hover:opacity-100 transition-opacity mt-8 font-medium">Sign in to save progress</Link>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen flex flex-col lg:flex-row bg-[#f2f1ea]" style={{ fontFamily: '"Genova", sans-serif' }}>
      <div className="w-full lg:w-1/2 h-[40vh] lg:h-screen fixed lg:sticky top-0 left-0 overflow-hidden bg-[#1a1a1a]">
        <img src={matchedArchetype.coffees[0] ? 'https://i.imgur.com/3WOJLhq.jpeg' : ''} alt="" className="w-full h-full object-cover" />
      </div>
      <div className="w-full lg:w-1/2 min-h-[60vh] lg:min-h-screen bg-[#f2f1ea] px-8 py-16 md:px-16 lg:p-24 flex flex-col items-start relative ml-auto z-10 overflow-y-auto">
        <div className="w-full max-w-[480px] flex flex-col mx-auto lg:mx-0">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.2 }} className="w-full">
            <h3 className="text-[10px] uppercase tracking-[0.3em] mb-4 font-medium" style={{ color: matchedArchetype.color }}>{userName.trim() ? `${userName}'s Profile` : 'Your Profile'}</h3>
            <h1 className="text-[3.5rem] lg:text-[4rem] leading-[1.05] font-normal tracking-tight mb-12" style={{ color: matchedArchetype.color }}>{matchedArchetype.name}</h1>

            <div className="mb-16 w-full">
              <h2 className="text-2xl text-[#a33726] font-normal mb-8">Why this matches you</h2>
              <ul className="flex flex-col gap-6 mb-8">
                {matchedArchetype.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-5">
                    <div className="w-[1px] h-8 shrink-0 opacity-40 mt-1" style={{ backgroundColor: matchedArchetype.color }} />
                    <span className="text-lg text-[#a33726]/80 font-light leading-relaxed">{f}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="w-full h-[1px] bg-[#a33726]/10 mb-16" />

            <div className="mb-16 w-full">
              <h2 className="text-2xl text-[#a33726] font-normal mb-8">Coffees selected for you</h2>
              <div className="flex flex-col gap-4">
                {matchedArchetype.coffees.map((coffee, i) => (
                  <div key={i} className="flex flex-row items-center gap-6 p-4 border border-[#a33726]/20 bg-white/40 hover:bg-white/70 transition-colors">
                    <div className="flex flex-col flex-1 py-2">
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="text-lg text-[#a33726] font-medium">{coffee.name}</h4>
                        <span className="text-[10px] font-bold px-2 py-1 bg-[#a33726]/10 text-[#a33726] rounded-sm">{coffee.match} Match</span>
                      </div>
                      <p className="text-sm text-[#a33726]/70 mb-5 font-light">{coffee.flavor}</p>
                      <Link to="/shop" className="text-[10px] uppercase tracking-[0.2em] font-medium text-[#a33726] hover:text-[#ee5974] transition-colors w-fit border-b border-[#a33726]/30 hover:border-[#ee5974] pb-0.5">Get this coffee</Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#a33726]/[0.03] border border-[#a33726]/10 p-10 flex flex-col items-center text-center mt-8 w-full">
              <h3 className="text-xl text-[#a33726] mb-3">Want us to remember your taste?</h3>
              <p className="text-[15px] text-[#a33726]/60 mb-8 font-light max-w-sm">Save your profile to quickly find your favorite coffees next time.</p>
              {user ? (
                <p className="text-sm text-[#ee5974]">Profile saved! Check your account.</p>
              ) : (
                <Link to="/sign-in" className="w-full max-w-[280px] py-4 text-center text-[10px] font-medium uppercase tracking-[0.2em] text-[#f2f1ea] bg-[#a33726] hover:bg-[#ee5974] transition-colors mb-6">Save my taste profile</Link>
              )}
              <button onClick={() => { setIsComplete(false); setCurrentStep(0); setAnswers({}); }} className="text-[10px] uppercase tracking-[0.2em] text-[#a33726]/50 hover:text-[#ee5974] transition-colors border-b border-transparent hover:border-[#ee5974] pb-0.5 mt-4">Retake Taste Finder</button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
