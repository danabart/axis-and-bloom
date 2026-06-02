import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

export default function NewsletterModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      const hasSeenModal = sessionStorage.getItem('axisBloomNewsletterSeen');
      if (!hasSeenModal) setIsOpen(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    sessionStorage.setItem('axisBloomNewsletterSeen', 'true');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'newsletter' }),
      });
    } catch {}
    setHasSubmitted(true);
    setTimeout(handleClose, 2000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-0 bg-black/20"
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-4xl bg-[#f2f1ea] border border-[#a33726] shadow-2xl flex flex-col md:flex-row overflow-hidden"
          >
            <button onClick={handleClose} className="absolute top-4 right-4 z-10 p-2 text-[#a33726] hover:bg-[#deded1] transition-colors rounded-full" aria-label="Close modal">
              <X size={20} strokeWidth={1.5} />
            </button>
            <div className="w-full md:w-1/2 h-64 md:h-auto relative bg-[#deded1]">
              <img
                src="https://images.unsplash.com/photo-1541870730196-cd1efcbf5649?w=800&q=80"
                alt="Elegant coffee"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="w-full md:w-1/2 p-10 md:p-16 flex flex-col justify-center text-[#a33726]">
              {hasSubmitted ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center text-center space-y-4">
                  <p className="text-xs uppercase tracking-[0.2em] font-normal" style={{ color: '#ee5974' }}>Welcome to the ritual</p>
                  <h2 className="text-3xl md:text-4xl">Check your inbox.</h2>
                  <p className="text-[#838686] font-light mt-4">Your 10% discount code is on its way.</p>
                </motion.div>
              ) : (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col">
                  <p className="text-xs uppercase tracking-[0.2em] font-normal mb-4" style={{ color: '#ee5974' }}>Join the Ritual</p>
                  <h2 className="text-4xl md:text-5xl leading-none mb-6">Take 10% off<br />your first order.</h2>
                  <p className="text-sm text-[#838686] font-light leading-relaxed mb-10">Sign up to receive 10% off your first bag, plus early access to new archetype releases.</p>
                  <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="Your email address"
                      required
                      className="w-full bg-transparent border-b border-[#a33726] py-3 text-sm text-[#a33726] placeholder:text-[#a33726]/50 focus:outline-none focus:border-[#ee5974] transition-colors rounded-none"
                    />
                    <button type="submit" className="w-full bg-[#a33726] text-[#f2f1ea] py-4 text-xs uppercase tracking-[0.2em] hover:bg-[#8e2e1f] transition-colors mt-4">
                      Subscribe & Save
                    </button>
                  </form>
                </motion.div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
