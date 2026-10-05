// Roastery portal (2026-10-05) — the small shared pieces: chips, 1 to 5 scale
// dots, the prefilled tag, date helpers. Every chip and dot is a real <button>
// with a role and aria-checked / aria-pressed, keyboard operable (Tab, Space,
// Enter); single-select groups are radiogroups and arrow keys move within them.
// Nothing here knows a vocabulary: options always arrive as props.

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { LookupOption } from './types';

export function Chip({ on, onClick, children, role = 'radio', disabled, small, className = '' }: {
  on: boolean; onClick: () => void; children: ReactNode;
  role?: 'radio' | 'checkbox'; disabled?: boolean; small?: boolean; className?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      disabled={disabled}
      className={`chip${on ? ' on' : ''}${small ? ' sm' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Arrow keys move focus between the radios of a group (Tab still reaches each). */
function onGroupKeys(e: KeyboardEvent<HTMLDivElement>) {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
  if (!keys.includes(e.key)) return;
  const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (i === -1) return;
  e.preventDefault();
  const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
  buttons[next].focus();
}

/** A labelled group of chips. A fieldset + legend: the label is a real label. */
export function Field({ legend, hint, tag, children }: { legend: ReactNode; hint?: string; tag?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="f">
      <legend className="lab">{legend}{hint ? <small>{hint}</small> : null}{tag}</legend>
      {children}
    </fieldset>
  );
}

/** Single select: radios; clicking the selected one clears it (nothing is required). */
export function SingleChips({ options, value, onChange, disabledValue }: {
  options: LookupOption[]; value: string | null; onChange: (v: string | null) => void; disabledValue?: string | null;
}) {
  return (
    <div className="chips" role="radiogroup" onKeyDown={onGroupKeys}>
      {options.map(o => (
        <Chip key={o.value} on={value === o.value} disabled={disabledValue === o.value} onClick={() => onChange(value === o.value ? null : o.value)}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

export function MultiChips({ options, values, onChange }: {
  options: LookupOption[]; values: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <div className="chips" role="group">
      {options.map(o => {
        const on = values.includes(o.value);
        return (
          <Chip key={o.value} role="checkbox" on={on} onClick={() => onChange(on ? values.filter(v => v !== o.value) : [...values, o.value])}>
            {o.label}
          </Chip>
        );
      })}
    </div>
  );
}

/** The 1 to 5 dots, 30px each on one line, with the end labels either side. */
export function Scale({ label, low, high, value, onChange, id }: {
  label: string; low: string; high: string; value: number | undefined; onChange: (v: number | undefined) => void; id: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="dim">
      <span className="lab" id={`${id}-lab`}>{label}</span>
      <div className="scale">
        <span className="sl" aria-hidden="true">{low}</span>
        <div className="dots" role="radiogroup" aria-labelledby={`${id}-lab`} ref={ref} onKeyDown={onGroupKeys}>
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} of 5${n === 1 ? `, ${low}` : n === 5 ? `, ${high}` : ''}`}
              className={`dot${value === n ? ' on' : ''}`}
              onClick={() => onChange(value === n ? undefined : n)}
            >
              {n}
            </button>
          ))}
        </div>
        <span className="sl r" aria-hidden="true">{high}</span>
      </div>
    </div>
  );
}

export function SrcTag({ text }: { text: string | null }) {
  return text ? <em className="src">{text}</em> : null;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return formatWhen(iso);
}
