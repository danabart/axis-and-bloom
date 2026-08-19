/**
 * Resend integration test — renders the real quiz-complete template
 * (backend/src/features/marketing/templates/quizCompleteEmail.ts) and sends it.
 *
 * Usage:
 *   node test-resend.mjs <api_key> <to-email> [firstName] [archetype]
 *   node test-resend.mjs <api_key> <to-email> --all
 *
 * --all sends all six archetype variants + the no-archetype fallback + a
 * no-first-name case to the given address (8 sends total). Prints the Resend
 * message id per send.
 *
 * Get api_key from:
 * https://console.cloud.google.com/security/secret-manager?project=axis-and-bloom-prod
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const [, , API_KEY, TO_EMAIL, ...rest] = process.argv;

if (!API_KEY || !TO_EMAIL) {
  console.error('Usage: node test-resend.mjs <api_key> <to-email> [firstName] [archetype]');
  console.error('       node test-resend.mjs <api_key> <to-email> --all');
  process.exit(1);
}

const ALL = rest.includes('--all');
const [firstNameArg, archetypeArg] = rest.filter(a => a !== '--all');

// ── Load the real template renderer (TypeScript) via tsx's programmatic ESM API,
// resolved from backend/node_modules so this script needs no dependencies of its
// own — same "real code, not a reimplementation" intent as the render step below. ─
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, 'backend');
const backendRequire = createRequire(path.join(backendDir, 'package.json'));
const { register } = await import(pathToFileURL(backendRequire.resolve('tsx/esm/api')).href);
register();
const { renderQuizCompleteEmail } = await import(
  pathToFileURL(path.join(backendDir, 'src/features/marketing/templates/quizCompleteEmail.ts')).href
);

const RESEND_FROM = process.env.RESEND_FROM || 'Axis & Bloom <hello@axisandbloomcoffee.com>';
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || 'hello@axisandbloomcoffee.com';

async function send(label, firstName, archetypeSlug) {
  const { subject, html, text } = renderQuizCompleteEmail(firstName, archetypeSlug);

  // Acceptance check: zero merge-tag remnants in the rendered HTML.
  const remnants = html.match(/\*\|[^|]*\|\*/g);
  if (remnants) {
    console.log(`  ⚠️  ${label}: merge-tag remnants found — ${remnants.join(', ')}`);
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ from: RESEND_FROM, to: TO_EMAIL, reply_to: RESEND_REPLY_TO, subject, html, text }),
  });

  let body;
  try {
    body = await res.json();
  } catch {
    body = {};
  }

  if (res.ok) {
    console.log(`  ✅ ${label} — message id: ${body.id}`);
  } else {
    console.log(`  ❌ ${label} — ${res.status} ${res.statusText}: ${body.message ?? JSON.stringify(body)}`);
  }
}

console.log('\n── Resend config ──────────────────────────────');
console.log('API key (last 6):', '...' + API_KEY.slice(-6));
console.log('From:', RESEND_FROM);
console.log('To:', TO_EMAIL);

if (ALL) {
  console.log('\n── Sending all six archetype variants + fallback + no-first-name case ──');
  const ARCHETYPES = ['floral', 'fruity', 'balanced', 'chocolate', 'earthy', 'experimental'];
  for (const slug of ARCHETYPES) {
    await send(slug, 'Test', slug);
  }
  await send('fallback (no archetype)', 'Test', null);
  await send('no first name', null, 'floral');
} else {
  const firstName = firstNameArg || null;
  const archetype = archetypeArg || null;
  console.log('\n── Sending single test email ──');
  await send(archetype ?? 'fallback (no archetype)', firstName, archetype);
}
