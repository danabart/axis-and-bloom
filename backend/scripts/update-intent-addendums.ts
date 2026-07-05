// One-time script: push updated intent systemPromptAddendum values to Firestore config/sommelier
// Run: npx ts-node --esm scripts/update-intent-addendums.ts
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID!,
    privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
  }),
  databaseId: 'axis-bloom-fs',
});

const db = getFirestore();

const addendums: Record<string, { systemPromptAddendum: string; conversationGoal: string; label: string }> = {
  PROFILE_AMBIGUOUS: {
    label: 'Discovering your profile',
    conversationGoal: 'Understand taste through dialogue before recommending. Hold off on a recommendation until turn 3 or later.',
    systemPromptAddendum: "This customer's profile isn't clear yet. Hold off on a recommendation for the first two turns. Ask one specific, grounded question about how they drink coffee or what they like in food — something answerable in a few words. Let the picture build from their answers, not from a list of your questions.",
  },
  RECOMMENDATION_MISS: {
    label: 'Finding a better match',
    conversationGoal: "Open a new direction. Do not revisit what didn't work. Exclude previously negatively-rated coffees.",
    systemPromptAddendum: "A previous recommendation didn't land. Don't reference it or ask the customer to explain what went wrong. Open a new direction with one question that moves away from what they had — lighter, darker, or different in some specific way. Never re-recommend a coffee they have already rated negatively.",
  },
  TASTE_EVOLUTION: {
    label: 'Recalibrating your taste',
    conversationGoal: "Start from where they are now. Do not ask about or reference the change.",
    systemPromptAddendum: "This customer's taste profile shifted since their last quiz. Don't mention the change or ask them to explain it. Start fresh from where they are now. You may reference their previous direction only to anchor a contrast: \"You were in the fruity range before — want to move toward something different, or stay nearby?\"",
  },
  DISCOVERY_SEEKER: {
    label: 'Going somewhere unexpected',
    conversationGoal: "Lead with contrast. Do not default to the primary archetype.",
    systemPromptAddendum: "This customer chose the adventurous path — they want contrast, not comfort. Lead with what's unusual or unexpected. Frame coffees by what makes them different, not by archetype match. Don't play it safe.",
  },
  CONVERSION: {
    label: 'Taking the first step',
    conversationGoal: "Give one clear recommendation. Answer questions. No urgency.",
    systemPromptAddendum: "This customer knows what they like but hasn't ordered yet. Give one clear recommendation. Answer any questions about the coffee, the process, or what to expect. No urgency, no push — just a clear next step if they want it.",
  },
  EXPLORATION: {
    label: 'Exploring together',
    conversationGoal: "Follow their lead. Let the direction emerge.",
    systemPromptAddendum: "This customer came to explore with no specific goal. Follow their lead. Don't push toward a recommendation — they may just want to talk about coffee. Let the direction emerge from what they say.",
  },
};

async function main() {
  const configRef = db.doc('config/sommelier');
  const updates: Record<string, unknown> = {};
  for (const [intent, fields] of Object.entries(addendums)) {
    updates[`intents.${intent}.label`] = fields.label;
    updates[`intents.${intent}.conversationGoal`] = fields.conversationGoal;
    updates[`intents.${intent}.systemPromptAddendum`] = fields.systemPromptAddendum;
  }
  await configRef.update(updates);
  console.log('config/sommelier intent addendums updated.');
}

main().catch(console.error);
