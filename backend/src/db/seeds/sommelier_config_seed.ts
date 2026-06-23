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
        conversationGoal:    'Understand the user\'s taste through dialogue before recommending. Do not recommend a coffee until turn 3 or later.',
        systemPromptAddendum: 'This user\'s quiz signals were ambiguous — their profile is not yet clear. Do not recommend a coffee in your first two turns. Ask about specific things they enjoy in food and drink, or how they usually take their coffee. Build a picture before suggesting anything.',
        ragFocus:            'archetype_range',
        maxTurns:            8,
      },
      RECOMMENDATION_MISS: {
        active:              true,
        label:               'Finding a better match',
        conversationGoal:    'Understand what didn\'t work, then find an alternative. Exclude previously negatively-rated coffees.',
        systemPromptAddendum: 'A previous recommendation did not resonate with this user. Acknowledge this gently. Ask what specifically felt off: flavor, body, intensity, context? Exclude any coffee they have already rated negatively.',
        ragFocus:            'alternatives',
        maxTurns:            8,
      },
      TASTE_EVOLUTION: {
        active:              true,
        label:               'Recalibrating your taste',
        conversationGoal:    'Explore what changed since the last quiz, then recalibrate toward the updated profile.',
        systemPromptAddendum: 'This user\'s taste profile changed since their last quiz. Explore what may have changed: a new coffee experience, travel, a different time of day they drink? Understand the evolution before making any recommendation.',
        ragFocus:            'evolution_bridge',
        maxTurns:            8,
      },
      DISCOVERY_SEEKER: {
        active:              true,
        label:               'Going somewhere unexpected',
        conversationGoal:    'Push toward something genuinely unexpected. Do not default to the user\'s primary archetype.',
        systemPromptAddendum: 'This user explicitly chose the adventurous option in their quiz — they want to be surprised. Do not play it safe. Lead with contrast, unusual processing methods, unexpected flavor combinations. Frame coffees by what makes them unusual, not how closely they match the user\'s archetype.',
        ragFocus:            'discovery',
        maxTurns:            8,
      },
      CONVERSION: {
        active:              true,
        label:               'Taking the first step',
        conversationGoal:    'Remove hesitation and help the user place their first order. Answer questions. Do not sell.',
        systemPromptAddendum: 'This user has a clear flavor profile but has not ordered yet. Be practical and reassuring. Offer to answer any questions about the coffee, process, or what to expect. Do not be pushy.',
        ragFocus:            'exact_match',
        maxTurns:            8,
      },
      EXPLORATION: {
        active:              true,
        label:               'Exploring together',
        conversationGoal:    'Open-ended discovery. Let the user lead.',
        systemPromptAddendum: 'This user came to explore without a specific prompt. Be curious and open. Don\'t assume they want a recommendation — they may just want to talk about coffee. Follow their lead.',
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
