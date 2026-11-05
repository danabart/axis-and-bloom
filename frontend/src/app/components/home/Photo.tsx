import { useEffect, useState } from 'react';

// Website 3 (2026-11-05). A registry photo that falls back to an existing one
// until Camila uploads the new original (Task 0.5; the image pipeline writes
// optimized/… from raw/…). Swapping the bucket object needs no deploy.

export interface RegistryImage { src: string; mobileSrc: string }

export function Photo({ asset, fallback, alt, sizes, className, style, loading = 'lazy' }: {
  asset: RegistryImage;
  fallback: RegistryImage;
  alt: string;
  sizes: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: 'lazy' | 'eager';
}) {
  const [failed, setFailed] = useState(false);
  const img = failed ? fallback : asset;
  return (
    <img
      src={img.src}
      srcSet={`${img.mobileSrc} 800w, ${img.src} 1600w`}
      sizes={sizes}
      alt={alt}
      loading={loading}
      className={className}
      style={style}
      onError={() => { if (!failed) setFailed(true); }}
    />
  );
}

/** The first URL in `candidates` that loads as an image (for a video poster, which has no onError). */
export function useFirstLoadable(candidates: string[]): string {
  const key = candidates.join('|');
  const [chosen, setChosen] = useState(candidates[0]);
  useEffect(() => {
    let cancelled = false;
    const list = key.split('|');
    const tryAt = (i: number) => {
      if (i >= list.length) return;
      const probe = new Image();
      probe.onload = () => { if (!cancelled) setChosen(list[i]); };
      probe.onerror = () => tryAt(i + 1);
      probe.src = list[i];
    };
    tryAt(0);
    return () => { cancelled = true; };
  }, [key]);
  return chosen;
}
