/**
 * End-to-end test: cupping score entry flow
 * Usage: node test-score-entry.mjs <email> <password>
 *
 * Tests: auth → sessions → session coffees → dimensions →
 *        cupping-notes → POST score → GET score back → verify
 */

const [,, EMAIL, PASSWORD] = process.argv;
if (!EMAIL || !PASSWORD) {
  console.error('Usage: node test-score-entry.mjs <email> <password>');
  process.exit(1);
}

const FIREBASE_API_KEY = 'AIzaSyAoaeU75ATPBw99gUO9gjsc_2jCI3Z7CQA';
const BACKEND          = 'https://axis-bloom-backend-oiub7eumya-uc.a.run.app';

let PASS = 0, FAIL = 0;

function ok(label, val) {
  console.log(`  ✅ ${label}${val !== undefined ? ': ' + JSON.stringify(val) : ''}`);
  PASS++;
}
function fail(label, detail) {
  console.error(`  ❌ ${label}: ${detail}`);
  FAIL++;
}
function section(title) { console.log(`\n── ${title} ──`); }

// ── 1. Firebase sign-in ───────────────────────────────────────────────────────
section('Auth');
const authRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
  }
);
const authData = await authRes.json();
if (!authData.idToken) {
  console.error('❌ Firebase sign-in failed:', authData.error?.message);
  process.exit(1);
}
const token = authData.idToken;
ok('Signed in as', authData.email);

const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function get(path) {
  const r = await fetch(`${BACKEND}${path}`, { headers: H });
  return { status: r.status, body: await r.json() };
}
async function post(path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
async function del(path) {
  const r = await fetch(`${BACKEND}${path}`, { method: 'DELETE', headers: H });
  return { status: r.status, body: await r.json() };
}

// ── 2. Profile — confirm isAdmin ──────────────────────────────────────────────
section('Profile');
const profile = await get('/api/users/profile');
if (profile.body.isAdmin) ok('isAdmin', true);
else { fail('isAdmin check', 'user is not admin — grant role first'); process.exit(1); }

// ── 3. Dimensions ─────────────────────────────────────────────────────────────
section('Dimensions');
const dims = await get('/api/admin/dimensions');
if (dims.status === 200) ok('GET /api/admin/dimensions', `${dims.body.length} rows`);
else fail('GET /api/admin/dimensions', dims.status);

const numericDims = dims.body.filter(d => d.is_numeric);
const textDims    = dims.body.filter(d => !d.is_numeric);
if (numericDims.length === 7) ok('Numeric dimensions', 7);
else fail('Numeric dimensions count', `expected 7, got ${numericDims.length}`);
if (textDims.length === 5) ok('Free-text dimensions', 5);
else fail('Free-text dimensions count', `expected 5, got ${textDims.length}`);

// ── 4. Cupping notes ──────────────────────────────────────────────────────────
section('Cupping Notes');
const notes = await get('/api/admin/cupping-notes');
if (notes.status === 200) ok('GET /api/admin/cupping-notes', `${notes.body.length} descriptors`);
else fail('GET /api/admin/cupping-notes', notes.status);
if (notes.body.length === 84) ok('SCA descriptor count', 84);
else fail('SCA descriptor count', `expected 84, got ${notes.body.length}`);

// ── 5. Sessions ───────────────────────────────────────────────────────────────
section('Sessions');
const sessions = await get('/api/admin/sessions');
if (sessions.status === 200) ok('GET /api/admin/sessions', `${sessions.body.length} sessions`);
else { fail('GET /api/admin/sessions', sessions.status); process.exit(1); }

// Create a test session if none exist
let sessionId;
let testSessionCreated = false;
if (sessions.body.length === 0) {
  const newSession = await post('/api/admin/sessions', {
    session_date: new Date().toISOString().split('T')[0],
    brew_method: 'cupping',
    location: 'Test',
    session_notes: 'automated test session',
  });
  if (newSession.status === 201) {
    ok('Created test session', newSession.body.id);
    sessionId = newSession.body.id;
    testSessionCreated = true;
  } else fail('Create test session', JSON.stringify(newSession.body));
} else {
  sessionId = sessions.body[0].id;
  ok('Using existing session', sessionId);
}

// ── 6. Session coffees ────────────────────────────────────────────────────────
section('Session Coffees');
const scRes = await get(`/api/admin/sessions/${sessionId}/coffees`);
if (scRes.status === 200) ok(`GET /api/admin/sessions/${sessionId}/coffees`, `${scRes.body.length} coffees`);
else fail('GET session coffees', scRes.status);

// Link a coffee if session has none
let sessionCoffeeId;
let testLinkCreated = false;
if (scRes.body.length === 0) {
  const allCoffees = await get('/api/admin/coffees');
  if (!allCoffees.body.length) {
    fail('Need at least one coffee in the catalogue', 'add a coffee first');
    process.exit(1);
  }
  const linkRes = await post(`/api/admin/sessions/${sessionId}/coffees`, {
    coffee_id: allCoffees.body[0].id,
  });
  if (linkRes.status === 201) {
    ok('Linked coffee to session', `session_coffee_id: ${linkRes.body.id}`);
    sessionCoffeeId = linkRes.body.id;
    testLinkCreated = true;
  } else fail('Link coffee', JSON.stringify(linkRes.body));
} else {
  sessionCoffeeId = scRes.body[0].session_coffee_id;
  ok('Using existing session_coffee', sessionCoffeeId);
}

// ── 7. POST score ─────────────────────────────────────────────────────────────
section('Score Entry');
const sweetnessDim  = dims.body.find(d => d.name === 'Sweetness');
const acidityDim    = dims.body.find(d => d.name === 'Acidity');
const bitternesssDim = dims.body.find(d => d.name === 'Bitterness');
const fragranceDim  = dims.body.find(d => d.name === 'Fragrance');

const blueberryNote = notes.body.find(n => n.descriptor === 'Blueberry');
const cherryNote    = notes.body.find(n => n.descriptor === 'Cherry');

const scorePayload = {
  session_coffee_id: sessionCoffeeId,
  taster_name: 'test_automated',
  is_merged: false,
  overall_notes: 'Automated test score — safe to delete',
  values: {
    ...(sweetnessDim   && { [sweetnessDim.id]:   { value_min: 7, value_max: 9, notes: 'honeyed' } }),
    ...(acidityDim     && { [acidityDim.id]:      { value_min: 6, value_max: 8 } }),
    ...(bitternesssDim && { [bitternesssDim.id]:  { value_min: 2, value_max: 3 } }),
    ...(fragranceDim   && { [fragranceDim.id]:    { notes: 'floral, citrus blossom' } }),
  },
  descriptors: [
    ...(blueberryNote ? [{ cupping_note_id: blueberryNote.id, intensity: 8 }] : []),
    ...(cherryNote    ? [{ cupping_note_id: cherryNote.id,    intensity: 5 }] : []),
  ],
};

const scoreRes = await post('/api/admin/scores', scorePayload);
if (scoreRes.status === 201) ok('POST /api/admin/scores', `score id: ${scoreRes.body.id}`);
else { fail('POST /api/admin/scores', JSON.stringify(scoreRes.body)); process.exit(1); }

const scoreId = scoreRes.body.id;

// ── 8. GET score back — verify round-trip ─────────────────────────────────────
section('Round-trip Verification');
const readBack = await get(`/api/admin/scores/session-coffee/${sessionCoffeeId}`);
if (readBack.status === 200) ok('GET /api/admin/scores/session-coffee/:id', 'ok');
else { fail('GET score back', readBack.status); }

const savedScore = readBack.body.scores.find(s => s.taster_name === 'test_automated');
if (savedScore) ok('Score row found', `id: ${savedScore.id}`);
else fail('Score row not found in response', JSON.stringify(readBack.body.scores));

const savedValues = readBack.body.values.filter(v => v.cupping_score_id === savedScore?.id);
if (savedValues.length >= 1) ok('Dimension values saved', `${savedValues.length} rows`);
else fail('No dimension values found', JSON.stringify(savedValues));

const sweetVal = savedValues.find(v => sweetnessDim && v.dimension_id === sweetnessDim.id);
if (sweetVal?.value_min == 7 && sweetVal?.value_max == 9) ok('Sweetness value_min/max', '7–9');
else fail('Sweetness value mismatch', JSON.stringify(sweetVal));

const savedDescs = readBack.body.descriptors.filter(d => d.cupping_score_id === savedScore?.id);
if (savedDescs.length === 2) ok('Descriptors saved', '2 rows');
else fail('Descriptor count mismatch', `expected 2, got ${savedDescs.length}`);

const blueSaved = savedDescs.find(d => blueberryNote && d.cupping_note_id === blueberryNote.id);
if (blueSaved?.intensity == 8) ok('Blueberry intensity', 8);
else fail('Blueberry intensity mismatch', JSON.stringify(blueSaved));

// ── 9. Upsert test (save again — should update, not duplicate) ────────────────
section('Upsert');
const upsertRes = await post('/api/admin/scores', {
  ...scorePayload,
  overall_notes: 'Updated by upsert test',
  descriptors: blueberryNote ? [{ cupping_note_id: blueberryNote.id, intensity: 12 }] : [],
});
if (upsertRes.status === 201) ok('Upsert returned 201', `id: ${upsertRes.body.id}`);
else fail('Upsert failed', JSON.stringify(upsertRes.body));

if (upsertRes.body.id === scoreId) ok('Same score id (updated, not duplicated)', scoreId);
else fail('Score id changed on upsert', `${scoreId} → ${upsertRes.body.id}`);

const afterUpsert = await get(`/api/admin/scores/session-coffee/${sessionCoffeeId}`);
const upsertedScore = afterUpsert.body.scores.find(s => s.taster_name === 'test_automated');
if (upsertedScore?.overall_notes === 'Updated by upsert test') ok('overall_notes updated', 'ok');
else fail('overall_notes not updated', upsertedScore?.overall_notes);

const upsertedDescs = afterUpsert.body.descriptors.filter(d => d.cupping_score_id === scoreId);
if (upsertedDescs.length === 1) ok('Descriptors replaced (not appended)', '1 descriptor');
else fail('Descriptor count after upsert', `expected 1, got ${upsertedDescs.length}`);
const upsertBlue = upsertedDescs.find(d => blueberryNote && d.cupping_note_id === blueberryNote.id);
if (upsertBlue?.intensity == 12) ok('Blueberry intensity updated to 12', 'ok');
else fail('Blueberry intensity after upsert', JSON.stringify(upsertBlue));

// ── 10. Cleanup — remove test data ────────────────────────────────────────────
section('Cleanup');
// Delete the cupping score (cascades to cupping_score_values + cupping_score_descriptors)
if (scoreId) {
  const delScore = await del(`/api/admin/scores/${scoreId}`);
  if (delScore.body.ok) ok('Deleted test cupping score (+ values + descriptors)', scoreId);
  else fail('Delete test score', JSON.stringify(delScore.body));
}
if (testLinkCreated && sessionCoffeeId) {
  const delLink = await del(`/api/admin/sessions/${sessionId}/coffees/${sessionCoffeeId}`);
  if (delLink.body.ok) ok('Removed test session_coffee link', 'ok');
  else fail('Remove test link', JSON.stringify(delLink.body));
}
if (testSessionCreated && sessionId) {
  const delSession = await del(`/api/admin/sessions/${sessionId}`);
  if (delSession.status === 200 || delSession.status === 404) ok('Removed test session', 'ok');
  // Not a hard fail if session delete not implemented — sessions are cheap
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Passed: ${PASS}  Failed: ${FAIL}`);
if (FAIL === 0) console.log('✅ All tests passed — score entry flow is working end-to-end.');
else console.log(`⚠️  ${FAIL} test(s) failed — see above for details.`);
