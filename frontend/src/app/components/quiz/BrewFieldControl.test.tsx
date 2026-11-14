// Usual Drink 1 follow-up (2026-11-14) — the chips picker: one value as chips.
// Fixture values only; the real ones come from the API.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import BrewFieldControl from './BrewFieldControl';
import type { BrewOptionField } from '../../lib/api';

afterEach(cleanup);

const field: BrewOptionField = {
  code: 'f', label: 'F', prompt: 'How do you feel?', type: 'enum', picker: 'chips', maxItems: null, maxItemLen: null,
  values: ['happy', 'bolder', 'gentler', 'different'].map(c => ({ code: c, label: c.toUpperCase(), aliases: [], pinned: false, acceptsWords: false })),
  displayLabels: {},
};

function draw(draft: string | null) {
  const onChange = vi.fn();
  render(<BrewFieldControl field={field} draft={draft} words="" onChange={onChange} onWords={() => {}} copy={{}} />);
  return onChange;
}

describe('BrewFieldControl, chips picker', () => {
  it('renders every value as a chip, no select', () => {
    draw(null);
    expect(screen.getByRole('group', { name: 'How do you feel?' })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['HAPPY', 'BOLDER', 'GENTLER', 'DIFFERENT']);
  });
  it('picking a chip sends that one code; only the picked chip is pressed', () => {
    const onChange = draw('bolder');
    expect(screen.getByTestId('brew-field-f-option-bolder').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('brew-field-f-option-happy').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('brew-field-f-option-gentler'));
    expect(onChange).toHaveBeenCalledWith('gentler');
  });
  it('picking the picked chip again clears it', () => {
    const onChange = draw('bolder');
    fireEvent.click(screen.getByTestId('brew-field-f-option-bolder'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
