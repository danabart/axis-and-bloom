import { motion } from 'motion/react';
import { ArrowDown } from 'lucide-react';
import { Link } from 'react-router';
import { TasteFinderSection } from './TasteFinderSection';

export default function HowItWorks() {
  return (
    <div className="w-full bg-[#f2f1ea]" style={{ fontFamily: '"Genova", sans-serif' }}>
      <div className="w-full min-h-screen flex flex-col md:flex-row relative z-10">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1, duration: 1 }} className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 hidden md:flex flex-col items-center gap-2 text-[#838686]">
          <span className="uppercase text-xs tracking-[0.2em]">Scroll</span>
          <ArrowDown className="w-4 h-4 animate-bounce" />
        </motion.div>

        <div className="w-full md:w-1/2 h-[50vh] md:h-screen relative overflow-hidden flex items-center justify-center" style={{ backgroundColor: '#f2f1ea' }}>
          <div className="absolute top-[35%] md:top-[30%] right-6 md:right-12 lg:right-20 flex flex-row items-center gap-4 sm:gap-6 md:gap-8 lg:gap-10 z-10">
            <div className="flex flex-col items-start">
              <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} className="text-[4rem] sm:text-[5rem] md:text-[7rem] lg:text-[10rem] text-[#838686] font-normal uppercase leading-[0.8] tracking-tighter">
                Axis
              </motion.h1>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.3 }} className="text-base sm:text-xl md:text-2xl lg:text-3xl text-[#ee5974] font-normal uppercase mt-3 md:mt-6 tracking-[0.2em] md:tracking-[0.25em]">
                The Method
              </motion.p>
            </div>
          </div>
        </div>

        <div className="w-full md:w-1/2 h-[50vh] md:h-screen relative overflow-hidden flex items-center justify-center" style={{ backgroundColor: '#e5e5da' }}>
          <div className="absolute top-[45%] md:top-[50%] left-6 md:left-12 lg:left-20 flex flex-col items-start z-10">
            <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.1, ease: [0.16, 1, 0.3, 1] }} className="text-[4rem] sm:text-[5rem] md:text-[7rem] lg:text-[10rem] text-[#ee5974] font-normal uppercase leading-[0.8] tracking-tighter">
              &amp; Bloom
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.4 }} className="text-base sm:text-xl md:text-2xl lg:text-3xl text-[#838686] font-normal uppercase mt-3 md:mt-6 tracking-[0.2em] md:tracking-[0.25em]">
              The Experience
            </motion.p>
          </div>
        </div>
      </div>

      <div className="w-full bg-[#f2f1ea] px-8 md:px-16 lg:px-24 xl:px-32 pt-24 md:pt-40 pb-32 md:pb-48 relative border-t border-[#a8462c]/10">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 1 }} className="max-w-5xl mb-24 md:mb-32">
          <h3 className="text-xl md:text-2xl text-[#ee5974] tracking-wide font-normal uppercase mb-3">FLAVOR PROFILES</h3>
          <h2 className="text-4xl md:text-5xl text-[#a8462c] font-normal mb-5 leading-none">Meet your coffee archetype</h2>
          <div className="text-xl md:text-2xl text-[#a8462c] font-normal leading-[1.3]">
            <p>We organize our coffees into flavor archetypes:</p>
            <p>clear taste families that reflect how coffee feels in the cup.</p>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8 max-w-[1400px]">
          {[
            { id: '01', name: 'Floral', color: '#a34b78', description: 'Light, elegant, and aromatic. Hints of jasmine, citrus, and a tea-like clarity.', descriptors: 'Fragrant, Bright, Delicate, Clean' },
            { id: '02', name: 'Fruity', color: '#ca445f', description: 'Juicy and lively with notes of berries and ripe fruit.', descriptors: 'Sweet, Vibrant, Expressive, Lively' },
            { id: '03', name: 'Balanced & Sweet', color: '#d1ac11', description: 'Round, smooth, and comforting. Notes of caramel, honey, and soft fruit.', descriptors: 'Smooth, Sweet, Harmonious, Easy' },
            { id: '04', name: 'Chocolate & Nutty', color: '#a54c2d', description: 'Deep and satisfying with cocoa, roasted nuts, and a rich presence.', descriptors: 'Rich, Grounded, Full, Comforting' },
            { id: '05', name: 'Spicy & Earthy', color: '#912f2f', description: 'Warm and bold with hints of spice, wood, and lingering depth.', descriptors: 'Warm, Deep, Bold, Lasting' },
            { id: '06', name: 'Experimental', color: '#056c7a', description: 'Ever-changing and wonderfully unconventional. A rotating selection of boundary-pushing coffees.', descriptors: 'Wild, Unique, Surprising' },
          ].map((archetype, idx) => (
            <motion.div key={archetype.id} initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-50px' }} transition={{ duration: 0.8, delay: idx * 0.1 }}
              className="w-full flex flex-col justify-between p-8 md:p-10 lg:p-12 relative overflow-hidden aspect-square md:aspect-auto md:min-h-[400px] lg:min-h-[480px]"
              style={{ backgroundColor: archetype.color }}>
              <div className="z-10 text-[#f2f1ea]">
                <h4 className="text-3xl md:text-4xl font-normal leading-tight">
                  <span className="block opacity-60 text-lg md:text-xl mb-1 md:mb-2 tracking-wide">{archetype.id} —</span>
                  {archetype.name}
                </h4>
              </div>
              <div className="z-10 flex flex-col gap-4 mt-8 md:mt-12 text-[#f2f1ea]">
                <p className="text-base md:text-lg leading-[1.3] font-normal opacity-95 max-w-[90%]">{archetype.description}</p>
                <div className="text-[10px] md:text-xs uppercase tracking-[0.15em] opacity-80 pt-4 border-t border-white/20 mt-auto">{archetype.descriptors}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <TasteFinderSection />
    </div>
  );
}
