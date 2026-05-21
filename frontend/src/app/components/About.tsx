import { motion } from 'motion/react';
import { TasteFinderSection } from './TasteFinderSection';

export default function About() {
  return (
    <div className="w-full bg-[#f2f1ea]" style={{ fontFamily: 'Geneva, sans-serif' }}>
      <div className="h-screen relative overflow-hidden">
        <div className="absolute inset-0 flex">
          <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} transition={{ duration: 1.2, ease: [0.6, 0.05, 0.01, 0.9] }} className="w-1/2 relative" style={{ backgroundColor: '#a33726' }} />
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 1.2, ease: [0.6, 0.05, 0.01, 0.9] }} className="w-1/2 relative" style={{ backgroundColor: '#E5E5DA' }} />
        </div>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 pt-16">
          <motion.div initial={{ scale: 0, rotate: -45, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ duration: 1.2, ease: [0.34, 1.56, 0.64, 1], delay: 1.2 }}
            className="flex items-center justify-center">
            <span className="text-[20rem] font-bold leading-none" style={{ color: '#f2f1ea', opacity: 0.3 }}>&</span>
          </motion.div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-8 md:px-16 py-32">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.8 }} className="mb-32">
          <p className="uppercase tracking-widest text-sm mb-4" style={{ color: '#b15643' }}>The Team</p>
          <h2 className="text-5xl md:text-7xl font-normal leading-tight" style={{ color: '#b15643' }}>The<br />founders</h2>
          <p className="text-xl md:text-2xl mt-8 font-light" style={{ color: '#b15643' }}>Two perspectives, one vision</p>
        </motion.div>

        <div className="flex flex-col md:flex-row items-center gap-16 md:gap-32 mb-48">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.8 }} className="w-full md:w-1/2">
            <img src="https://i.imgur.com/N0h2Psq.jpeg" alt="Dana" className="w-full h-[600px] object-cover object-top" />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.8, delay: 0.2 }} className="w-full md:w-1/2">
            <h3 className="text-4xl md:text-5xl mb-2" style={{ color: '#b15643' }}>Dana</h3>
            <p className="uppercase tracking-widest text-sm mb-8" style={{ color: '#ee5974' }}>Axis</p>
            <div className="space-y-6 text-lg font-light leading-relaxed" style={{ color: '#838686' }}>
              <p>Data architect and engineer by training, Dana brings structure, precision, and systematic thinking to Axis & Bloom.</p>
              <p>Her work forms the backbone of the Flavor Intelligence framework — the method that organizes coffee into clear taste families and makes personalized matching possible.</p>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="w-full bg-[#E5E5DA] py-32 md:py-48 px-8 md:px-16">
        <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row gap-16 md:gap-32">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.8 }} className="w-full md:w-1/3">
            <p className="uppercase tracking-widest text-sm mb-4" style={{ color: '#b15643' }}>Our Story</p>
            <h2 className="text-5xl md:text-7xl font-normal leading-tight" style={{ color: '#b15643' }}>About Axis<br />& Bloom</h2>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.8, delay: 0.2 }} className="w-full md:w-2/3 max-w-3xl">
            <div className="space-y-8 text-xl font-light leading-relaxed" style={{ color: '#838686' }}>
              <p>For many people, describing why they like a certain coffee is surprisingly difficult. Axis & Bloom began by addressing this gap — building a Flavor Intelligence framework that organizes coffee into clear taste families.</p>
              <p>Our intention is simple: to make choosing coffee feel natural and personal.</p>
              <p className="text-2xl" style={{ color: '#b15643' }}>Axis provides the method. Bloom provides the experience.</p>
            </div>
          </motion.div>
        </div>
      </div>

      <TasteFinderSection />
    </div>
  );
}
