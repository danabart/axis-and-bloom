// Roastery portal (2026-10-05) — every sentence the partner page says, in one
// block for Camila's review. Where a question is unchanged from her mockup the
// copy is the mockup's; the lines marked NEW / CHANGED are drafts for her to
// review. Positive register, no em dashes (the FROM / TO footer lockup and the
// `01 —` card numbers are graphic elements and stay).
export const COPY = {
  // CHANGED: the mockup said "from your website" and "place each coffee on our
  // Bloom Dial". The lineup is now listed from our records and the answers feed
  // the flavor wheel and the imagery.
  lede: {
    before: 'We listed your lineup and prefilled what we found; correct anything that is off. Your answers do two things: they help us map each coffee to the flavor wheel, and they shape how we present it, since every coffee gets its own imagery. ',
    bold: 'The 1 to 5 scales are relative to your own lineup:',
    after: ' 1 is your gentlest coffee on that scale, 5 your most intense. There are no wrong answers.',
  },
  // CHANGED: the notes hint (words first, then the wheel pick).
  // CHANGED (part 3): "Your official tasting notes" -> "Your bag notes".
  notesLabel: 'Your bag notes',
  notesHint: 'Your words first, the leading note on top. Then pick the closest match on the flavor wheel.',
  notePlaceholder: 'Blueberry, cream, milk chocolate',
  // Unchanged from the mockup.
  bloomDialLabel: 'If you had to place this coffee in our Bloom Dial, where would it bloom?',
  bloomDialHint: 'pick the family it belongs to first; we will refine it with you',
  experimentalWarning: 'Only for the truly rare: mushroom-infused, aged in a whisky barrel, a process almost nobody has tasted. Unusual is not enough; it has to surprise.',
  dimensionsHelp: 'Relative to your own lineup. 1 is your gentlest coffee on that scale, 5 your most intense.',
  // CHANGED (part 3): "Most dominant dimension" -> "What leads in the cup?".
  dominantLabel: 'What leads in the cup?',
  dominantHint: 'the one thing people notice first',
  brewNotesLabel: 'Anything we should know about brewing it?',
  brewNotesPlaceholder: 'Grind a touch finer than you\'d expect. Shines at 94°C.',
  expectedLabel: 'Expected availability',
  expectedHint: 'if seasonal',
  expectedPlaceholder: 'Through March',
  cousinLabel: 'Closest cousin in your lineup',
  changesLabel: 'What changes between them',
  changesHint: 'a few words',
  anythingElsePlaceholder: 'Awards, the story of the lot, what you love about it. Optional, and welcome.',
  saveCoffee: 'SAVE COFFEE',
  originLabel: 'Origin',
  originHint: 'region, producer if single origin',
  // NEW: usage line above the footer.
  usage: 'We use your notes to describe each coffee to our customers under the Axis & Bloom name.',
  // NEW: the who screen.
  whoTitle: 'Who is filling this in?',
  whoHint: 'So we know who to thank, and who to ask if we have a question.',
  // NEW or CHANGED short state words (thin and gray, per brief 48 section 9).
  // ── part 3 (2026-10-06). Lines marked NEW are drafts for Camila's review. ──
  // CHANGED: section 04 question and legend (was "How is it best enjoyed?" / "Best brewing method").
  milkLabel: 'Does it hold up in milk?',
  whereItShines: 'Where it shines',
  // NEW: section 01 questions.
  blendComponentsLabel: 'Components',
  blendComponentsHint: 'origins, rough shares if you share them',
  blendRotationLabel: 'Does the recipe change during the year?',
  caffeineLabel: 'Caffeine',
  decafProcessLabel: 'Decaf process',
  additivesLabel: 'Is anything added to this coffee?',
  additivesHint: 'fruit, spices, yeast cultures, flavoring, during processing or after roasting',
  additivesDetailLabel: 'What is added',
  certificationsLabel: 'Certifications',
  // NEW: once per lineup.
  bestSellersLabel: 'Which of these do you sell most?',
  bestSellersHint: 'Pick up to three, in order. Tap again to remove one.',
  yes: 'Yes',
  no: 'No',
  saveAndNext: 'Save and open the next coffee',
  inactiveTitle: 'This link is not active',
  inactiveBody: 'Please ask your Axis & Bloom contact for a fresh one.',
  notStarted: 'Not started',
  prefillTag: { roaster_site: 'from your site', catalog: 'from our records' } as Record<string, string>,
  sameAsLineup: 'same as your lineup',
  lineupHeading: 'About your lineup',
  lineupHint: 'Asked once for the whole lineup. Any single coffee can still answer differently for itself.',
  noticeLabel: 'Typical notice before a coffee becomes unavailable',
  similarLabel: 'When one runs out, can you usually offer a similar profile?',
  yourCoffees: 'Your coffees',
  addCoffee: '+ A coffee not listed',
  addCoffeeLabel: 'Coffee name',
} as const;
