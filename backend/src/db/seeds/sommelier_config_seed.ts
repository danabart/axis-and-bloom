import { firestoreDb, FieldValue } from '../../services/firebase-admin.js';

export async function seedSommelierConfig(): Promise<void> {
  const configRef = firestoreDb.doc('config/sommelier');
  const snap = await configRef.get();
  if (snap.exists) return;

  await configRef.set({
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
    },

    modelRouting: {
      sonnetKeywords: [
        'compare', 'difference', 'explain', 'why', 'confused',
        'not sure', "don't understand", 'what do you mean',
        'help me understand', 'which is better', 'how does',
      ],
      sonnetMinMessageWords: 100,
    },

    ragLimits: {
      maxCoffees: 6,
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
