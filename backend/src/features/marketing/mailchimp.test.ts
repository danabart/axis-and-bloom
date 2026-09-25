// Quiz Resync Fix Part E2 (e) — pure unit test, no network, no env, no DB:
// computeTagUpdates is the whole replace-not-add computation extracted from
// setMemberTags for exactly this purpose.
import { describe, it, expect } from 'vitest';
import { computeTagUpdates } from './mailchimp.js';

describe('computeTagUpdates', () => {
  it('sets the new archetype tag active and inactivates the one it replaces', () => {
    const result = computeTagUpdates(
      ['archetype:earthy', 'source:post_quiz', 'quiz-completed'],
      ['archetype:balanced', 'source:newsletter'],
    );
    expect(result).toEqual(expect.arrayContaining([
      { name: 'archetype:earthy', status: 'active' },
      { name: 'source:post_quiz', status: 'active' },
      { name: 'quiz-completed', status: 'active' },
      { name: 'archetype:balanced', status: 'inactive' },
    ]));
    expect(result).toHaveLength(4);
  });

  it('inactivates every other archetype:* tag, not just one, if a member somehow carries more than one', () => {
    const result = computeTagUpdates(
      ['archetype:earthy'],
      ['archetype:balanced', 'archetype:chocolate', 'source:post_quiz'],
    );
    const inactive = result.filter(t => t.status === 'inactive').map(t => t.name);
    expect(inactive.sort()).toEqual(['archetype:balanced', 'archetype:chocolate']);
  });

  it('does not touch non-archetype tags even though they are add-only (never inactivated)', () => {
    const result = computeTagUpdates(
      ['archetype:earthy', 'campaign:hoboken-crawl-2026'],
      ['source:newsletter', 'experimental'],
    );
    expect(result.some(t => t.name === 'source:newsletter')).toBe(false);
    expect(result.some(t => t.name === 'experimental')).toBe(false);
  });

  it('re-setting the same archetype tag does not inactivate itself', () => {
    const result = computeTagUpdates(['archetype:balanced'], ['archetype:balanced']);
    expect(result).toEqual([{ name: 'archetype:balanced', status: 'active' }]);
  });

  it('no new tags and nothing to inactivate → empty update list', () => {
    expect(computeTagUpdates([], ['source:newsletter'])).toEqual([]);
  });

  it('no archetype tag among the new tags → current archetype tags are left alone (never inactivated by a non-archetype sync)', () => {
    const result = computeTagUpdates(['source:footer'], ['archetype:fruity']);
    expect(result).toEqual([{ name: 'source:footer', status: 'active' }]);
  });
});
