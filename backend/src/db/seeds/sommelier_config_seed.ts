import { firestoreDb, FieldValue } from '../../services/firebase-admin.js';

// Canonical default shape for `config/sommelier`. Used to seed a fresh environment
// AND as the seed side of the config-drift comparison (HOME_TASK_1) — the admin
// portal's live document is the source of truth; this object is a starting point,
// never applied automatically once the document exists (see seedSommelierConfig below).
export const DEFAULT_SOMMELIER_CONFIG = {
    confidenceWeights: {
      quizStability:       0.30,
      behavioralValidation: 0.40,
      dataDepth:           0.20,
      feedbackAlignment:   0.10,
    },

    confidenceThresholds: {
      medium: 0.40,
      high:   0.70,
    },

    sessionLimits: {
      maxTurns: 8,
    },

    tokenEconomy: {
      signupBonus:     20,
      orderBonus:      10,
      costPerTurn:     1,
      purchaseEnabled: false,
      gatingEnabled:   false,
    },

    modelRouting: {
      sonnetKeywords: [
        'compare', 'difference', 'explain', 'why', 'confused',
        'not sure', "don't understand", 'what do you mean',
        'help me understand', 'which is better', 'how does',
      ],
      sonnetMinMessageWords: 100,
      expertiseModelOverride: null,
    },

    ragLimits: {
      maxCoffees: 6,
    },

    // HOME_TASK_2 (§4.1) — seed topics. Keyword rules first; the Haiku classifier
    // graduates in later if the topicLog shows keywords failing. `matching`/`other`
    // both resolve to today's matching-mode behavior — only the five knowledge
    // topics below switch a turn into expertise mode.
    topics: {
      brewing: {
        mode: 'expertise',
        keywords: [
          'brew', 'brewing', 'v60', 'pour over', 'pour-over', 'french press',
          'aeropress', 'chemex', 'drip', 'grind size', 'coarse', 'fine grind',
          'ratio', 'bloom time', 'extraction', 'water temperature', 'how long',
        ],
      },
      equipment: {
        mode: 'expertise',
        keywords: [
          'grinder', 'burr grinder', 'scale', 'kettle', 'gooseneck',
          'espresso machine', 'filter paper', 'filters', 'which grinder',
          'what grinder', 'upgrade my setup', 'new grinder',
        ],
      },
      origins_process: {
        mode: 'expertise',
        keywords: [
          'where does this come from', 'origin', 'region', 'farm', 'co-op',
          'process', 'washed process', 'natural process', 'honey process',
          'altitude', 'varietal', 'harvest',
        ],
      },
      my_coffee: {
        mode: 'expertise',
        keywords: [
          'this bag', 'my bag', 'my coffee', 'this coffee i have',
          'the coffee i ordered', 'my current coffee', 'what i have now',
        ],
      },
      caffeine_decaf: {
        mode: 'expertise',
        keywords: [
          'caffeine', 'decaf', 'decaffeinated', 'how much caffeine',
          'pregnant', 'pregnancy', 'kids', 'children', 'medication',
        ],
      },
      matching: {
        mode: 'matching',
        keywords: [
          'recommend', 'suggest', 'which coffee should i', 'what should i try',
          'help me pick', 'help me choose',
        ],
      },
      other: {
        mode: 'matching',
        keywords: [],
      },
    },

    topicRouter: {
      // Checked in this order when more than one topic's keywords match —
      // sensitive/narrow domains first (caffeine before the broader brewing net).
      priority: [
        'caffeine_decaf', 'origins_process', 'equipment', 'my_coffee',
        'brewing', 'matching', 'other',
      ],
      stickyDecayTurns: 2,
    },

    // HOME_TASK_2 (§4.2) — response contracts as config, not hard-coded strings.
    responseContracts: {
      matching: {
        maxTokens: 200,
      },
      expertise: {
        maxTokens: 500,
        lengthInstruction:
          'Answer as short as fully answers the question — up to about 200 words when it genuinely needs that much. Never pad, never lecture past what was actually asked.',
        numbersCarveout:
          'Numbers, ratios, times, and temperatures are always allowed — 1:16 and 94°C are the answer, not jargon. What stays banned is the technical register: words like "percolation," "extraction yield," "TDS."',
      },
    },

    // HOME_TASK_2 (§4.6) — the frozen catalog block has no business in a
    // knowledge-dominant turn. No "current coffee" concept is tracked yet
    // (arrives with brew cards, HOME_TASK_6), so the only real option today is
    // omit; this flag exists so admin can flip it back off instantly if shrinking
    // the catalog ever turns out to hurt something, no deploy required.
    contextAssembly: {
      omitCatalogInExpertiseMode: true,
    },

    // HOME_TASK_3 (§4.8) — the invisible guard layer. Every threshold here is
    // set where a real customer never feels it; these exist for the operator,
    // not the customer, and matter more now that nothing is visibly priced (§5).
    guards: {
      dailyTurnCap: 60,
      monthlySpendCeilingUsd: 5,
      // Planning estimates, not real Anthropic billing figures — tune these
      // against actual invoices once there's a month of real usage data.
      modelCostPerTurnUsd: {
        'claude-haiku-4-5-20251001': 0.002,
        'claude-sonnet-4-6': 0.02,
      },
      anomalyMultiplier: 3,
      rateLimits: {
        perIpPerMinute: 30,
        perAccountPerMinute: 15,
      },
    },

    // HOME_TASK_4 (§4.5, §3.5) — Phase 1 brew-profile field whitelist. Every
    // field here must change a sentence Liam can say (§3.5's own rule) — the
    // culture/background/timing fields from the full self-serve list arrive
    // in Task 10, not here.
    brewProfile: {
      fields: {
        brew_methods: {
          type: 'array',
          allowedValues: ['v60', 'french_press', 'espresso', 'moka', 'aeropress', 'cold_brew', 'drip', 'other'],
          maxLength: 8,
        },
        grinder: {
          type: 'enum',
          allowedValues: ['none', 'blade', 'burr_hand', 'burr_electric', 'unknown_type'],
        },
        takes_it: {
          type: 'enum',
          allowedValues: ['black', 'milk', 'sugar', 'milk_and_sugar'],
        },
        decaf_constraint: {
          type: 'bool',
        },
        aversions: {
          type: 'array_freeform',
          maxLength: 10,
          maxItemLength: 40,
        },
      },
      staleAfterDays: 120,
    },

    evaluatorRulePriority: [
      'DISCOVERY_SEEKER',
      'PROFILE_AMBIGUOUS',
      'TASTE_EVOLUTION',
      'RECOMMENDATION_MISS',
      'CONVERSION',
      'EXPLORATION',
    ],

    timeWindows: {
      negativeFeedbackLookback:  60,
      orderOutcome7Day:          7,
      orderOutcome30Day:         30,
      returnVisitWindow:         30,
      sessionResumeWindowHours:  24,
    },

    intents: {
      PROFILE_AMBIGUOUS: {
        active:              true,
        label:               'Discovering your profile',
        conversationGoal:    'Understand taste through dialogue before recommending. Hold off on a recommendation until turn 3 or later.',
        systemPromptAddendum: 'This customer\'s profile isn\'t clear yet. Hold off on a recommendation for the first two turns. Ask one specific, grounded question about how they drink coffee or what they like in food — something answerable in a few words. Let the picture build from their answers, not from a list of your questions. If the conversation surfaces real doubt about their archetype, end your reply with <<action:retake_quiz>>. If recent dial activity is included in your context, you may reference it naturally to ground a direction — e.g. "I see you saved a bolder spot recently" — only if it\'s actually present, never invented.',
        ragFocus:            'archetype_range',
        maxTurns:            8,
      },
      RECOMMENDATION_MISS: {
        active:              true,
        label:               'Finding a better match',
        conversationGoal:    'Open a new direction. Do not revisit what didn\'t work. Exclude previously negatively-rated coffees.',
        systemPromptAddendum: 'A previous recommendation didn\'t land. Don\'t reference it or ask the customer to explain what went wrong. Open a new direction with one question that moves away from what they had — lighter, darker, or different in some specific way. Never re-recommend a coffee they have already rated negatively. If the fix is a different position within their existing archetype rather than a new direction entirely, end your reply with <<action:open_dial>>.',
        ragFocus:            'alternatives',
        maxTurns:            8,
      },
      TASTE_EVOLUTION: {
        active:              true,
        label:               'Recalibrating your taste',
        conversationGoal:    'Start from where they are now. Do not ask about or reference the change.',
        systemPromptAddendum: 'This customer\'s taste profile shifted since their last quiz. Don\'t mention the change or ask them to explain it. Start fresh from where they are now. You may reference their previous direction only to anchor a contrast: "You were in the fruity range before — want to move toward something different, or stay nearby?" If you conclude their taste has genuinely shifted enough to warrant a fresh read, end your reply with <<action:retake_quiz>>.',
        ragFocus:            'evolution_bridge',
        maxTurns:            8,
      },
      DISCOVERY_SEEKER: {
        active:              true,
        label:               'Going somewhere unexpected',
        conversationGoal:    'Lead with contrast. Do not default to the primary archetype.',
        systemPromptAddendum: 'This customer chose the adventurous path — they want contrast, not comfort. Lead with what\'s unusual or unexpected. Frame coffees by what makes them different, not by archetype match. Don\'t play it safe.',
        ragFocus:            'discovery',
        maxTurns:            8,
      },
      CONVERSION: {
        active:              true,
        label:               'Taking the first step',
        conversationGoal:    'Give one clear recommendation. Answer questions. No urgency.',
        systemPromptAddendum: 'This customer knows what they like but hasn\'t ordered yet. Give one clear recommendation. Answer any questions about the coffee, the process, or what to expect. No urgency, no push — just a clear next step if they want it.',
        ragFocus:            'exact_match',
        maxTurns:            8,
      },
      EXPLORATION: {
        active:              true,
        label:               'Exploring together',
        conversationGoal:    'Follow their lead. Let the direction emerge.',
        systemPromptAddendum: 'This customer came to explore with no specific goal. Follow their lead. Don\'t push toward a recommendation — they may just want to talk about coffee. Let the direction emerge from what they say. If the conversation lands on a bolder or lighter position within their archetype, you may end your reply with <<action:open_dial>>. If recent dial activity is included in your context, you may reference it naturally — e.g. "I see you saved a bolder spot recently" — only if it\'s actually present, never invented.',
        ragFocus:            'curated_mix',
        maxTurns:            8,
      },
    },

    confidenceComponents: {
      quizStability: {
        active:      true,
        label:       'Quiz Stability',
        description: 'How consistent has the archetype been across quiz retakes?',
      },
      behavioralValidation: {
        active:      true,
        label:       'Behavioral Validation',
        description: 'Are orders confirming the archetype?',
      },
      dataDepth: {
        active:      true,
        label:       'Data Depth',
        description: 'Volume of total interactions (quizzes + orders + feedback).',
      },
      feedbackAlignment: {
        active:      true,
        label:       'Feedback Alignment',
        description: 'Is feedback consistent with the archetype?',
      },
    },
};

export async function seedSommelierConfig(): Promise<void> {
  const configRef = firestoreDb.doc('config/sommelier');
  const snap = await configRef.get();
  if (snap.exists) return;

  await configRef.set({
    ...DEFAULT_SOMMELIER_CONFIG,
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.log('[sommelierConfig] Seeded config/sommelier');
}

export async function seedSommelierCentroids(): Promise<void> {
  const centroidsRef = firestoreDb.doc('config/sommelierCentroids');
  const snap = await centroidsRef.get();
  if (snap.exists) return;

  const emptyIntent = { centroid: new Array(13).fill(0), sampleCount: 0, updatedAt: FieldValue.serverTimestamp() };
  await centroidsRef.set({
    DISCOVERY_SEEKER:   emptyIntent,
    PROFILE_AMBIGUOUS:  emptyIntent,
    TASTE_EVOLUTION:    emptyIntent,
    RECOMMENDATION_MISS: emptyIntent,
    CONVERSION:         emptyIntent,
    EXPLORATION:        emptyIntent,
    computedAt:         FieldValue.serverTimestamp(),
  });

  console.log('[sommelierConfig] Seeded config/sommelierCentroids');
}
