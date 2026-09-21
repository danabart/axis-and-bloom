// Archetype rename follow-up 1 — taste_journey history survives a rename.
// mapJourneyHistory reads the live archetype rows (axisandbloom_test), so an
// entry stored under a retired display name resolves to the current label.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import { archetypeCode } from './catalogReads.js';
import { mapJourneyHistory, isSameArchetype } from './tasteJourney.js';

afterAll(async () => { await db.end(); });

describe('mapJourneyHistory', () => {
  it('renders an entry stored as "Balanced & Sweet" with the current code and label', async () => {
    const [entry] = await mapJourneyHistory([{ archetype: 'Balanced & Sweet', trigger: 'first_quiz' }]);
    expect(entry.archetype).toBe('balanced_sweet');
    expect(entry.archetypeLabel).toBe('Balanced');
    expect(entry.trigger).toBe('first_quiz');
  });

  it('maps a current-name entry the same way and normalises the trigger', async () => {
    const [entry] = await mapJourneyHistory([{ archetype: 'Balanced', trigger: 'whatever' }]);
    expect(entry.archetype).toBe('balanced_sweet');
    expect(entry.archetypeLabel).toBe('Balanced');
    expect(entry.trigger).toBe('retake');
  });

  it('passes an unrecognised name through untouched instead of dropping it', async () => {
    const [entry] = await mapJourneyHistory([{ archetype: 'Mystery Roast', trigger: 'retake' }]);
    expect(entry.archetype).toBe('mystery roast');
    expect(entry.archetypeLabel).toBe('Mystery Roast');
  });
});

describe('isSameArchetype (retake logic)', () => {
  it('counts a retake as the same archetype when stored history uses the retired name', async () => {
    const stored = await archetypeCode('Balanced & Sweet');
    const fresh = await archetypeCode('Balanced');
    expect(isSameArchetype(fresh, stored)).toBe(true);
  });

  it('is false for different archetypes, a missing current code, or an unresolved new code', () => {
    expect(isSameArchetype('fruity', 'balanced_sweet')).toBe(false);
    expect(isSameArchetype('fruity', null)).toBe(false);
    expect(isSameArchetype(null, null)).toBe(false);
  });
});
