import type { CSSProperties, ElementType, ReactNode, ComponentPropsWithoutRef } from 'react';
import { Link } from 'react-router';
import './chrome.css';

/**
 * Shared chrome primitives (Website 1, 2026-11-04) — thin styled wrappers over
 * the handoff's .wrap / .caps / .titled / .btn / .frame classes (chrome.css).
 * Every website page brief reuses these; no page re-implements them (G4.1).
 */

export type Tone = 'ink' | 'paper';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

type BaseProps = {
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  tone?: Tone;
} & Omit<ComponentPropsWithoutRef<'div'>, 'className' | 'style' | 'children'>;

/** .wrap — 1280px max width, 20px gutters (safe-area aware). */
export function Wrap({ as: As = 'div', className, tone, ...rest }: BaseProps) {
  return <As className={cx('ab-wrap', tone && `ab-${tone}`, className)} {...rest} />;
}

/** .caps — the 12px / .24em uppercase label. `weight` overrides the default 700. */
export function Caps({ as: As = 'span', className, tone, weight, style, ...rest }: BaseProps & { weight?: 300 | 400 | 600 | 700 }) {
  return <As className={cx('ab-caps', tone && `ab-${tone}`, className)} style={weight ? { ...style, fontWeight: weight } : style} {...rest} />;
}

/** .caps.titled — the eyebrow with the full-width 1px underline. */
export function Titled({ as: As = 'span', className, tone, ...rest }: BaseProps) {
  return <As className={cx('ab-caps', 'ab-titled', tone && `ab-${tone}`, className)} {...rest} />;
}

/** The handoff's diagonal arrow (↗), used in buttons, the menu and the newsletter field. */
export function ArrowIcon({ size = 14, strokeWidth = 1.2, className }: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false" className={className}>
      <path d="M3 15L15 3M6 3h9v9" fill="none" stroke="currentColor" strokeWidth={strokeWidth} />
    </svg>
  );
}

type BtnProps = {
  children: ReactNode;
  tone?: Tone;
  /** Internal route (react-router Link). */
  to?: string;
  /** External/anchor link. */
  href?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  /** Arrow icon slot: true (default) = ArrowIcon, false = none, or any node. */
  icon?: ReactNode | boolean;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
};

/** .btn — 56px, square, 1px border, arrow slot; hover fills with the tone. */
export function Btn({ children, tone = 'ink', to, href, onClick, type = 'button', disabled, icon = true, className, style, ...aria }: BtnProps) {
  const cls = cx('ab-btn', `ab-${tone}`, className);
  const iconNode = icon === true ? <ArrowIcon /> : icon === false ? null : icon;
  const inner = <>{children}{iconNode}</>;
  if (to) return <Link to={to} className={cls} style={style} onClick={onClick} {...aria}>{inner}</Link>;
  if (href) return <a href={href} className={cls} style={style} onClick={onClick} {...aria}>{inner}</a>;
  return <button type={type} className={cls} style={style} onClick={onClick} disabled={disabled} {...aria}>{inner}</button>;
}

/** .frame — 1px border, 8px padding photo frame. `ratio` defaults to 4/3. */
export function Frame({ src, alt, ratio, caption, className, style, tone }: {
  src: string; alt: string; ratio?: string; caption?: ReactNode; className?: string; style?: CSSProperties; tone?: Tone;
}) {
  const s = ratio ? ({ ...style, ['--ab-frame-ratio' as string]: ratio } as CSSProperties) : style;
  return (
    <figure className={cx('ab-frame', tone && `ab-${tone}`, className)} style={s}>
      <img src={src} alt={alt} loading="lazy" />
      {caption && <figcaption className="ab-caps" style={{ fontWeight: 400, paddingTop: 10 }}>{caption}</figcaption>}
    </figure>
  );
}
