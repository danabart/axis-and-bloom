# Quiz V7 — Three Tasks

Stack: Node/Express/TypeScript on Cloud Run, PostgreSQL on Cloud SQL.
Scoring logic: `backend/src/services/quizScoring.ts` (pure functions) + `backend/src/routes/quiz.ts` (routes). Not a Lambda.

---

## Task 1 — Seed V7 into Cloud SQL

Create `backend/src/db/seeds/quiz_v7.sql` using the idempotent pattern already in the codebase (`ON CONFLICT DO NOTHING`).

Source of truth: `backend/src/quiz/Coffee_Quiz_ScoringV7.xlsx` (Scoring Table sheet). Use exact text from the Excel — do not invent copy.

Rules:
- Insert new quiz row name='v7', set `is_active = TRUE`, flip all others to `FALSE`
- Q1–Q6 with correct `q_number` and `weight`
- Q3-C: set `is_experimental_gate = TRUE`
- Q6 (food signal, weight 0): set `resulting_archetype_id` on each answer, no `answer_archetype_score` rows
- Q1–Q5: insert `answer_archetype_score` rows using the Points column
- Look up archetype UUIDs by name — `Floral` and `Earthy` already exist in the `archetype` table

Verify after running:
```sql
SELECT q.q_number, a.answer_text, ar.name, aas.score
FROM question q
JOIN answer a ON a.question_id = q.id
LEFT JOIN answer_archetype_score aas ON aas.answer_id = a.id
LEFT JOIN archetype ar ON ar.id = aas.archetype_id
WHERE q.quiz_id = (SELECT id FROM quiz WHERE name = 'v7')
ORDER BY q.q_number, a.id;
```

---

## Task 2 — Branch Logic (backend only)

After scoring, Fruity and Chocolate & Nutty primaries get one follow-up question. Answer B reclassifies; Answer A keeps the primary.

**Modify `POST /api/quiz/score`** — add `branchQuestion` to response when primary is Fruity or CN:

```json
{
  "archetype": "Fruity",
  "branchQuestion": {
    "trigger": "Fruity",
    "question": "One last thing. When coffee is really at its best for you, which is closer?",
    "answers": [
      { "key": "A", "text": "It's complex and alive. A lot happening — I want to explore every sip.", "result": "Fruity" },
      { "key": "B", "text": "It's so light and delicate it barely feels like coffee. Almost like drinking tea.", "result": "Floral" }
    ]
  }
}
```

```json
{
  "archetype": "Chocolate & Nutty",
  "branchQuestion": {
    "trigger": "Chocolate & Nutty",
    "question": "Your profile is rich and bold. How do you like to take it?",
    "answers": [
      { "key": "A", "text": "Rich and comforting. Coffee that feels like a reward at the end of the day.", "result": "Chocolate & Nutty" },
      { "key": "B", "text": "Deep and intense. Complex, almost challenging. The more serious the better.", "result": "Earthy" }
    ]
  }
}
```

**Add `POST /api/quiz/branch`** (no auth):
- Input: `{ primaryArchetype: "Fruity", branchAnswer: "B" }`
- Output: `{ finalArchetype: "Floral" }`
- Hardcode the two rules. No DB needed.

**Modify `POST /api/quiz/results`** — accept optional `finalArchetype` field. If present, use it as the archetype to save instead of `archetype`. Store `branchAnswer` in `context_data`.

Do NOT touch the frontend.

---

## Task 3 — Fix Veto Logic and Food Signal

Three line changes. V7 renumbered questions — food signal moved from Q2 to Q6, bitterness is now Q5 (was Q6).

**`backend/src/services/quizScoring.ts`**

`findWinner` veto cascade:
```typescript
// before
for (const qNum of [6, 5, 3, 1]) {
// after
for (const qNum of [5, 4, 2, 1]) {
```

`isSecondaryClose`:
```typescript
// before
return byQ[6] === secondary || byQ[5] === secondary;
// after
return byQ[5] === secondary || byQ[4] === secondary;
```

**`backend/src/routes/quiz.ts`**

Food signal detection:
```typescript
// before
if (qNum === 2) {
// after
if (qNum === 6) {
```

Update any tests in `quizScoring.test.ts` that reference the old cascade. Run `npm test` from `backend/` — all tests should pass.

---

## Checklist

- [ ] `GET /api/quiz/questions` returns 6 V7 questions with correct text
- [ ] Q3-C has `is_experimental_gate = true`
- [ ] Q6 answers have `resulting_archetype_id` set, no `answer_archetype_score` rows
- [ ] Score with Fruity answers → response includes `branchQuestion`
- [ ] Score with CN answers → response includes `branchQuestion`
- [ ] Score with BS answers → no `branchQuestion`
- [ ] `POST /api/quiz/branch` with B → reclassifies; with A → returns primary unchanged
- [ ] `npm test` passes
- [ ] Deploy to Cloud Run, `/health/db` healthy
