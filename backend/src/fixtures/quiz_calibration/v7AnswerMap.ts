// Quiz v7 answer id -> [q_number, archetype it scores]. The ids are generated at seed time (they are not in
// schema.sql), so this map was derived from the Hoboken Crawl calibration fixture: it is the unique
// assignment whose weighted sums reproduce all 37 recorded score maps (quizScoring.test.ts re-proves that).
// Q6 entries are the treat (foodSignal), not scored. The Q3 'Fruity' answer is the experimental gate.
// Offline use only (tests, scripts/quizRecalibrate.ts). The live path reads the database (quizScorer.ts).
import type { ByQ, Scores } from '../../services/quizScoring.js';

const CN = 'Chocolate & Nutty';
const BS = 'Balanced';
const FR = 'Fruity';

export const V7_ANSWERS: Record<string, [number, string]> = {
  '7bb70325-9f4b-42f1-8e23-c09e7bc1aeba': [1, BS],
  'e8983de7-f940-4844-a524-ee194fefa652': [1, FR],
  '9b6ed7dc-cea0-4616-b75c-f57efd7222fa': [1, CN],
  'b155b352-60f4-4080-b273-989aec4a6c3b': [2, BS],
  '5508a85e-bf39-47bf-b449-9e2918f4a66c': [2, CN],
  '199047bd-ec01-4312-b137-7b0635dc2a7a': [2, FR],
  '04efe599-cc94-4ae3-a5c4-58af912e6fce': [3, BS],
  'a3dd85c7-8599-4acc-ab0c-c322e5376199': [3, FR],
  '3097eb82-eabe-4bfb-9ec4-87d543d12199': [3, CN],
  '1739b585-ce54-40cf-b0cd-a93c57ef94f3': [4, BS],
  'd91047b2-8f76-4266-8e34-86cd376a4464': [4, CN],
  '98fe11b7-e7cc-42e0-813d-b491d48447a3': [4, FR],
  'd22e21b5-84e6-43af-bf43-7a87a5fafabc': [5, BS],
  '84a495fc-897a-4126-b169-60c4c4788d83': [5, CN],
  '9512f80b-08f6-482d-82a7-469d68b83e0d': [5, FR],
  '685108d8-ab46-41f4-919d-d9bf541b04da': [6, CN],
  'fbbc7d10-78b4-49c4-b70f-d6562f90ea7b': [6, BS],
  'a1b6cdc8-29a6-41ad-9c34-d839b62e86e3': [6, FR],
};

export const V7_WEIGHTS: Record<number, number> = { 1: 1, 2: 2, 3: 1, 4: 2, 5: 3 };
export const V7_GATE_ANSWER_ID = 'a3dd85c7-8599-4acc-ab0c-c322e5376199';

export interface RebuiltScoring {
  scores: Scores;
  byQ: ByQ;
  foodSignal: string | null;
  experimental: boolean;
}

// Rebuild what scoreAnswerIds() reads from the database. Throws on an id that is not a v7 answer.
export function rebuildV7Scoring(answerIds: string[]): RebuiltScoring {
  const scores: Scores = {};
  const byQ: ByQ = {};
  let foodSignal: string | null = null;
  for (const id of answerIds) {
    const entry = V7_ANSWERS[id];
    if (!entry) throw new Error(`Unknown v7 answer id: ${id}`);
    const [q, arch] = entry;
    if (q === 6) { foodSignal = arch; continue; }
    scores[arch] = (scores[arch] ?? 0) + V7_WEIGHTS[q];
    byQ[q] = arch;
  }
  return { scores, byQ, foodSignal, experimental: answerIds.includes(V7_GATE_ANSWER_ID) };
}
