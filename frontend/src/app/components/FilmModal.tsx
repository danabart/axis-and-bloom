import { useEffect, useRef } from 'react';

interface Props {
  src: string;
  open: boolean;
  onClose: () => void;
}

export default function FilmModal({ src, open, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const bgVideos = document.querySelectorAll<HTMLVideoElement>('video:not(#film-modal-video)');
    bgVideos.forEach(v => v.pause());
    videoRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      // Browser autoplay policy can reject play() until a user gesture — not an error.
      bgVideos.forEach(v => { v.play().catch(() => {}); });
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Film player"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        backgroundColor: 'rgba(20,12,8,.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'absolute', top: 20, right: 28,
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'rgba(242,241,234,.8)', fontSize: 32, lineHeight: 1,
          fontFamily: 'inherit',
        }}
      >
        ×
      </button>
      <video
        id="film-modal-video"
        ref={videoRef}
        src={src}
        controls
        autoPlay
        tabIndex={0}
        onClick={e => e.stopPropagation()}
        style={{ width: '90vw', maxWidth: 1400, aspectRatio: '16/9', display: 'block', outline: 'none' }}
      />
    </div>
  );
}
