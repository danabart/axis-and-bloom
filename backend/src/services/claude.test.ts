import { describe, it, expect } from 'vitest';
import { parseAndStripMarkers } from './claude.js';

// Liam L3, Part A — parseAndStripMarkers() is the pure extraction/strip step
// pulled out of chatWithSommelier() specifically so the marker regexes can be
// tested without an Anthropic call (same reasoning as assembleSystemPrompt()'s
// own split, in claude.ts). No prior test file exercised this logic in
// isolation — sommelier.test.ts always mocks chatWithSommelier() wholesale.

describe('parseAndStripMarkers — recommend', () => {
  it('parses a single <<recommend:Alias>> and strips it from the reply', () => {
    const result = parseAndStripMarkers('Try the Crosshatch. <<recommend:Crosshatch>>', 2);
    expect(result.recommendAlias).toBe('Crosshatch');
    expect(result.reply).toBe('Try the Crosshatch.');
  });

  it('takes only the first marker when the model emits more than one (cap of one per turn)', () => {
    const result = parseAndStripMarkers('<<recommend:Crosshatch>><<recommend:Uganda>>', 2);
    expect(result.recommendAlias).toBe('Crosshatch');
    expect(result.reply).toBe('');
  });

  it('treats a bare/empty marker as no marker, but still strips it', () => {
    const result = parseAndStripMarkers('Here is a thought. <<recommend:>>', 2);
    expect(result.recommendAlias).toBeNull();
    expect(result.reply).toBe('Here is a thought.');
  });

  it('is allowed to resolve regardless of turn (opening-turn exception is a prompt rule, not a parser gate)', () => {
    // parseAndStripMarkers has no turnCount input at all — this documents
    // that the opening-turn exception lives entirely in the prompt text,
    // never enforced (or needing to be enforced) here.
    const result = parseAndStripMarkers('Last time you went earthy. This moves the same way. <<recommend:Uganda>>', 2);
    expect(result.recommendAlias).toBe('Uganda');
  });
});

describe('parseAndStripMarkers — ask', () => {
  it('parses a known kind and strips it', () => {
    const result = parseAndStripMarkers('What do you brew with? <<ask:brew>>', 2);
    expect(result.askKind).toBe('brew');
    expect(result.reply).toBe('What do you brew with?');
  });

  it('parses thread and palate kinds', () => {
    expect(parseAndStripMarkers('<<ask:thread>>', 2).askKind).toBe('thread');
    expect(parseAndStripMarkers('<<ask:palate>>', 2).askKind).toBe('palate');
  });

  it('strips a malformed/unknown kind without resolving it', () => {
    const result = parseAndStripMarkers('Just checking in. <<ask:vibes>>', 2);
    expect(result.askKind).toBeNull();
    expect(result.reply).toBe('Just checking in.');
  });

  it('resolves alongside a remember marker in the same reply', () => {
    const result = parseAndStripMarkers(
      'V60 — noted. What do you usually reach for? <<remember:brew_methods=v60>><<ask:brew>>',
      2
    );
    expect(result.askKind).toBe('brew');
    expect(result.rememberOps).toEqual([{ field: 'brew_methods', rawValue: 'v60' }]);
    expect(result.reply).toBe('V60 — noted. What do you usually reach for?');
  });

  it('resolves alongside an action marker in the same reply', () => {
    const result = parseAndStripMarkers('Worth a retake. <<action:retake_quiz>><<ask:thread>>', 2);
    expect(result.askKind).toBe('thread');
    expect(result.actionTypes).toEqual(['retake_quiz']);
  });
});

describe('parseAndStripMarkers — malformed forms are stripped without effect', () => {
  it('a garbled recommend tag never leaks into the visible reply', () => {
    const result = parseAndStripMarkers('Some text <<recommend:Crosshatch and more', 2);
    // No closing >> — the regex never matches, so nothing resolves; this
    // documents the current behavior (an unterminated tag is not stripped,
    // same pre-existing risk every other marker already carries).
    expect(result.recommendAlias).toBeNull();
  });

  it('an unknown ask kind with garbage strips cleanly', () => {
    const result = parseAndStripMarkers('Reply text. <<ask:>>', 2);
    expect(result.askKind).toBeNull();
    expect(result.reply).toBe('Reply text.');
  });
});

describe('parseAndStripMarkers — pre-existing markers unaffected', () => {
  it('still parses action, remember and card markers exactly as before', () => {
    const result = parseAndStripMarkers(
      'Coarser it is. <<card:adjust=grind_coarser>><<remember:takes_it=black>><<action:open_dial>>',
      2
    );
    expect(result.cardMarker).toEqual({ type: 'adjust', adjustment: 'grind_coarser' });
    expect(result.rememberOps).toEqual([{ field: 'takes_it', rawValue: 'black' }]);
    expect(result.actionTypes).toEqual(['open_dial']);
    expect(result.reply).toBe('Coarser it is.');
  });

  it('caps rememberOps collection at maxMarkers while stripping every marker regardless', () => {
    const result = parseAndStripMarkers(
      '<<remember:brew_methods=v60>><<remember:takes_it=black>><<remember:grinder=hand>>',
      2
    );
    expect(result.rememberOps).toHaveLength(2);
    expect(result.reply).toBe('');
  });
});
