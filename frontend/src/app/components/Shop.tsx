import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Filter } from 'lucide-react';
import { Link } from 'react-router';
import { TasteFinderSection } from './TasteFinderSection';

const getArchetypeColor = (name: string) => {
  const map: Record<string, string> = {
    'Floral': '#a34b78', 'Fruity': '#ca445f', 'Balanced & Sweet': '#d1ac11',
    'Chocolate & Nutty': '#a54c2d', 'Spicy & Earthy': '#912f2f', 'Experimental': '#056c7a',
  };
  return map[name] ?? '#a33726';
};

const coffees = [
  { id: 1, name: 'Ethiopia Yirgacheffe', archetype: 'Floral', price: '$22', notes: 'Jasmine, Lemon, Bergamot', description: 'A delicate, tea-like profile with overwhelming aromatic clarity.', roast: 'Light', brew: 'Pour Over' },
  { id: 2, name: 'Colombia El Paraiso', archetype: 'Fruity', price: '$24', notes: 'Strawberry, Peach, Rose', description: 'Vibrant and juicy, defined by an intense berry sweetness.', roast: 'Light-Medium', brew: 'Aeropress' },
  { id: 3, name: 'Guatemala Antigua', archetype: 'Balanced & Sweet', price: '$20', notes: 'Caramel, Milk Chocolate, Red Apple', description: 'A comforting daily drinker with perfect harmony and a lingering finish.', roast: 'Medium', brew: 'Drip / Espresso' },
  { id: 4, name: 'Brazil Cerrado', archetype: 'Chocolate & Nutty', price: '$19', notes: 'Dark Chocolate, Almond, Molasses', description: 'Rich, grounded, and deeply satisfying. A classic profile elevated.', roast: 'Medium-Dark', brew: 'Espresso' },
  { id: 5, name: 'Sumatra Mandheling', archetype: 'Spicy & Earthy', price: '$21', notes: 'Cedar, Clove, Dark Cocoa', description: 'Bold and syrupy, characterized by its warm spice and full body.', roast: 'Dark', brew: 'French Press' },
  { id: 6, name: 'Costa Rica Anaerobic', archetype: 'Experimental', price: '$28', notes: 'Cinnamon, Tropical Fruit, Rum', description: 'A wild, unconventional cup pushing the boundaries of flavor.', roast: 'Light', brew: 'V60' },
];

const categories = [
  { id: 'archetypes', label: 'Archetype Coffees' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'gifts', label: 'Gifts' },
  { id: 'discovery', label: 'Discovery Sets' },
];

const scrollToSection = (id: string) => {
  const el = document.getElementById(id);
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: 'smooth' });
};

const FlavorBars = ({ archetype }: { archetype: string }) => {
  const color = getArchetypeColor(archetype);
  return (
    <div className="flex gap-1 items-end h-3 mt-1 opacity-80">
      {[2, 10, 6, 12].map((h, i) => <div key={i} className="w-[3px] rounded-sm" style={{ height: `${h}px`, backgroundColor: color }} />)}
    </div>
  );
};

export default function Shop() {
  const [scrolled, setScrolled] = useState(false);

  React.useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', fn);
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <div className="w-full min-h-screen bg-[#f2f1ea] text-[#a33726]">
      <section className="pt-40 pb-20 px-6 md:px-12 lg:px-24 max-w-[1400px] mx-auto text-center flex flex-col items-center">
        <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} className="text-5xl md:text-7xl text-[#ee5974] font-normal tracking-tight mb-6">SHOP COFFEE</motion.h1>
        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.1 }} className="text-lg md:text-xl text-[#838686] font-light max-w-2xl leading-relaxed mb-10">
          Browse archetype coffees, personalized subscriptions, gifts, and discovery sets.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.2 }} className="flex flex-col sm:flex-row gap-4">
          <Link to="/find-my-flavor" className="bg-[#ee5974] text-[#f2f1ea] px-8 py-4 text-xs uppercase tracking-[0.2em] hover:opacity-80 transition-opacity text-center">Find My Flavor</Link>
          <button onClick={() => scrollToSection('archetypes')} className="border border-[#838686] text-[#838686] px-8 py-4 text-xs uppercase tracking-[0.2em] hover:bg-[#838686] hover:text-[#f2f1ea] transition-colors text-center">Shop All</button>
        </motion.div>
      </section>

      <div className={`sticky top-[80px] z-40 bg-[#f2f1ea] transition-all duration-300 border-y ${scrolled ? 'border-[#a8462c]/10 py-4 shadow-sm' : 'border-transparent py-6'}`}>
        <div className="max-w-[1400px] mx-auto px-6 md:px-12 lg:px-24 flex gap-8 overflow-x-auto items-center">
          {categories.map((cat) => (
            <button key={cat.id} onClick={() => scrollToSection(cat.id)} className="whitespace-nowrap text-xs md:text-sm uppercase tracking-[0.15em] text-[#838686] hover:text-[#a33726] transition-colors">{cat.label}</button>
          ))}
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 md:px-12 lg:px-24 pb-32">
        <section id="archetypes" className="pt-24 lg:pt-32">
          <div className="mb-12 border-b border-[#a8462c]/10 pb-4 flex justify-between items-end">
            <div>
              <h2 className="text-2xl md:text-3xl text-[#a33726] font-normal tracking-tight">Archetype Coffees</h2>
              <p className="text-[#838686] text-sm mt-2 font-light">Each coffee belongs to a clear sensory identity.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-16">
            {coffees.map((coffee) => (
              <div key={coffee.id} className="group flex flex-col h-full">
                <div className="aspect-[4/5] mb-6 overflow-hidden flex items-center justify-center p-8" style={{ backgroundColor: getArchetypeColor(coffee.archetype) + '22' }}>
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: getArchetypeColor(coffee.archetype) }}>
                      <span className="text-white text-xs uppercase tracking-widest">{coffee.archetype[0]}</span>
                    </div>
                    <p className="text-sm" style={{ color: getArchetypeColor(coffee.archetype) }}>{coffee.archetype}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs uppercase tracking-[0.2em] font-normal" style={{ color: getArchetypeColor(coffee.archetype) }}>{coffee.archetype}</span>
                  <FlavorBars archetype={coffee.archetype} />
                </div>
                <h3 className="text-2xl text-[#a33726] mb-2">{coffee.name}</h3>
                <p className="text-sm text-[#838686] font-light mb-4">{coffee.description}</p>
                <div className="grid grid-cols-2 gap-4 border-t border-b border-[#a8462c]/10 py-4 mb-6">
                  <div><div className="text-[9px] uppercase tracking-widest text-[#838686] mb-1">Roast</div><div className="text-xs text-[#a33726]">{coffee.roast}</div></div>
                  <div><div className="text-[9px] uppercase tracking-widest text-[#838686] mb-1">Best For</div><div className="text-xs text-[#a33726]">{coffee.brew}</div></div>
                  <div className="col-span-2"><div className="text-[9px] uppercase tracking-widest text-[#838686] mb-1">Tasting Notes</div><div className="text-xs text-[#a33726] italic">{coffee.notes}</div></div>
                </div>
                <div className="flex items-center justify-between mt-auto pt-2">
                  <span className="text-lg">{coffee.price}</span>
                  <button className="text-xs uppercase tracking-widest text-[#a33726] hover:text-[#a8462c] transition-colors flex items-center gap-2">Choose <ArrowRight size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="subscriptions" className="pt-24 lg:pt-32">
          <div className="mb-12 border-b border-[#a8462c]/10 pb-4">
            <h2 className="text-2xl md:text-3xl text-[#a33726] font-normal tracking-tight">Personalized Subscriptions</h2>
            <p className="text-[#838686] text-sm mt-2 font-light">Coffee matched to your profile, delivered on your schedule.</p>
          </div>
          <div className="flex flex-col lg:flex-row bg-[#e5e5da] min-h-[400px]">
            <div className="w-full lg:w-1/2 p-10 md:p-16 flex flex-col justify-center">
              <div className="text-[10px] uppercase tracking-widest text-[#a33726] mb-4">The Axis & Bloom Ritual</div>
              <h3 className="text-3xl md:text-4xl text-[#a33726] mb-6">Signature Subscription</h3>
              <p className="text-[#a33726] font-light leading-relaxed mb-10 max-w-md">A recurring delivery tailored to your taste. Stick with your matched archetype or explore nearby flavor families over time.</p>
              <div className="flex items-center gap-6">
                <div className="text-2xl text-[#a33726]">From $18 <span className="text-sm text-[#838686] font-light">/ bag</span></div>
                <button className="bg-[#a33726] text-white px-8 py-3 text-xs uppercase tracking-[0.15em] hover:bg-[#8e2e1f] transition-colors">Build Your Ritual</button>
              </div>
            </div>
          </div>
        </section>

        <section id="gifts" className="pt-24 lg:pt-32">
          <div className="mb-12 border-b border-[#a8462c]/10 pb-4">
            <h2 className="text-2xl md:text-3xl text-[#a33726] font-normal tracking-tight">Gifts</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="group cursor-pointer">
              <div className="aspect-[4/3] overflow-hidden mb-6 bg-[#e5e5da] flex items-center justify-center">
                <span className="text-[#a33726] text-4xl font-light">Gift Box</span>
              </div>
              <h3 className="text-2xl text-[#a33726] mb-2">Chosen for You Gift Box</h3>
              <p className="text-[#838686] font-light text-sm mb-4 max-w-sm">Two coffees selected through our flavor system, an archetype card, and a personalized message.</p>
              <div className="flex justify-between items-center border-t border-[#a8462c]/10 pt-4">
                <span className="text-lg">$55</span>
                <span className="text-xs uppercase tracking-widest text-[#a33726]">View Gift</span>
              </div>
            </div>
          </div>
        </section>

        <section id="discovery" className="pt-24 lg:pt-32">
          <div className="mb-12 border-b border-[#a8462c]/10 pb-4">
            <h2 className="text-2xl md:text-3xl text-[#a33726] font-normal tracking-tight">Discovery Sets</h2>
          </div>
          <div className="relative h-[400px] flex items-center justify-center group cursor-pointer overflow-hidden bg-[#e5e5da]">
            <div className="text-center bg-white p-10 md:p-16 max-w-lg shadow-xl">
              <div className="text-[10px] uppercase tracking-widest text-[#a33726] mb-3">Tasting Flight</div>
              <h3 className="text-3xl text-[#a33726] mb-4">The Spectrum Set</h3>
              <p className="text-[#838686] font-light text-sm mb-6 leading-relaxed">Four 100g sample bags representing a journey across our archetype wheel.</p>
              <div className="flex items-center justify-center gap-6">
                <span className="text-xl">$38</span>
                <button className="border border-[#a33726] text-[#a33726] px-6 py-3 text-xs uppercase tracking-[0.1em] hover:bg-[#a33726] hover:text-white transition-colors">Add to Cart</button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <TasteFinderSection />
    </div>
  );
}
