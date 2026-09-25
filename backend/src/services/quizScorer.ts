import { db } from '../db/client.js';
import type { ByQ, Scores } from './quizScoring.js';

export interface ScoredAnswers {
  scores: Scores;
  byQ: ByQ;
  foodSignal: string | null;
  experimental: boolean;
}

// The read shared by POST /api/quiz/score and (brief 2) the server-side interpretation. Read-only.
// `scores` is empty when no answer is scoreable; the caller decides what that means.
export async function scoreAnswerIds(answerIds: string[]): Promise<ScoredAnswers> {
  // 1. Sum weighted scores per archetype (Q2 scores too, weight 2; every v7 total sums to 9).
  const scoreResult = await db.query(
    `SELECT ar.name AS archetype_name, SUM(aas.score)::numeric AS total
     FROM quiz_answer_archetype_score aas
     JOIN coffee_archetype ar ON ar.id = aas.archetype_id
     WHERE aas.answer_id = ANY($1::uuid[])
     GROUP BY ar.name`,
    [answerIds]
  );

  const scores: Scores = {};
  for (const row of scoreResult.rows) {
    scores[row.archetype_name] = Number(row.total);
  }

  // 2. Per-answer metadata:
  //    score_archetype — from quiz_answer_archetype_score (cascade + secondary close check)
  //    result_archetype — from answer.resulting_archetype_id (food signal for Q6)
  const metaResult = await db.query(
    `SELECT
       q.q_number,
       ar_score.name  AS score_archetype,
       ar_result.name AS result_archetype
     FROM quiz_answer a
     JOIN quiz_question q ON q.id = a.question_id
     LEFT JOIN quiz_answer_archetype_score aas
           ON aas.answer_id = a.id AND aas.score > 0
     LEFT JOIN coffee_archetype ar_score  ON ar_score.id  = aas.archetype_id
     LEFT JOIN coffee_archetype ar_result ON ar_result.id = a.resulting_archetype_id
     WHERE a.id = ANY($1::uuid[])`,
    [answerIds]
  );

  // q_number → score archetype (first non-null wins)
  const byQ: ByQ = {};
  let foodSignal: string | null = null;
  for (const row of metaResult.rows) {
    const qNum = Number(row.q_number);
    if (qNum === 6) {
      foodSignal = row.result_archetype ?? null;
    } else if (!byQ[qNum] && row.score_archetype) {
      byQ[qNum] = row.score_archetype;
    }
  }

  // 3. Experimental gate.
  const expResult = await db.query(
    `SELECT 1 FROM quiz_answer WHERE id = ANY($1::uuid[]) AND is_experimental_gate = TRUE LIMIT 1`,
    [answerIds]
  );

  return { scores, byQ, foodSignal, experimental: expResult.rows.length > 0 };
}
