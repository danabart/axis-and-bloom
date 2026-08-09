// The Match Ending & The Folded Dial (Part 21), Section 5 — approved starting
// copy, explicitly flagged for Dana/Camila to tune later. Kept as one small
// exported map (not inlined per call site) so a future copy pass is a
// one-file edit, not a grep-and-replace across FlavorQuiz.tsx.
//
// Family lines: shown in the quiz results screen's new result header
// (§3.1), one per archetype. Positive register throughout — no hedging, no
// apology, per the prompt's own instruction.
export const FAMILY_LINES: Record<string, string> = {
  fruity: "That's your family — bright, juicy, alive.",
  floral: "That's your family — delicate, fragrant, luminous.",
  balanced_sweet: "That's your family — warm, honeyed, steady.",
  chocolate_nutty: "That's your family — rich, rounded, comforting.",
  earthy: "That's your family — deep, grounded, bold.",
  experimental: "That's your family — curious, surprising, untamed.",
};
