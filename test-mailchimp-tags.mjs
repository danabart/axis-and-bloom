/**
 * Mailchimp tag round-trip test (Step 05 / C1 sibling to test-mailchimp.mjs).
 * Usage: node test-mailchimp-tags.mjs <api_key> <list_id> <email>
 *
 * Upserts a test member with the ARCHETYPE merge field, applies the same tags the real
 * sync applies for a post-quiz signup, then reads the member back and confirms both the
 * merge field and every tag actually landed.
 *
 * Get api_key and list_id from:
 * https://console.cloud.google.com/security/secret-manager?project=axis-and-bloom-prod
 */

import crypto from 'crypto';

const [,, MC_API_KEY, MC_LIST_ID, email = 'test@example.com'] = process.argv;

if (!MC_API_KEY || !MC_LIST_ID) {
  console.error('Usage: node test-mailchimp-tags.mjs <api_key> <list_id> <email>');
  process.exit(1);
}

const MC_DC = MC_API_KEY.split('-')[1];
const hash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
const memberUrl = `https://${MC_DC}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}/members/${hash}`;
const tagsUrl = `${memberUrl}/tags`;
const headers = {
  'Content-Type': 'application/json',
  Authorization: `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}`,
};
const testTags = ['source:post_quiz', 'archetype:Floral', 'quiz-completed'];

console.log('\n── Mailchimp tag round-trip test ─────────────');
console.log('Datacenter:', MC_DC);
console.log('List ID:', MC_LIST_ID);
console.log('Email:', email);
console.log('Tags to apply:', testTags.join(', '));

try {
  console.log('\n1. Ensuring ARCHETYPE merge field exists...');
  const mergeFieldsUrl = `https://${MC_DC}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}/merge-fields`;
  const existingFields = await fetch(`${mergeFieldsUrl}?count=100`, { headers });
  const existingBody = await existingFields.json();
  const hasArchetype = (existingBody.merge_fields ?? []).some(f => f.tag === 'ARCHETYPE');
  if (hasArchetype) {
    console.log('✅ ARCHETYPE merge field already exists');
  } else {
    const createRes = await fetch(mergeFieldsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tag: 'ARCHETYPE', name: 'Archetype', type: 'text', required: false }),
    });
    if (!createRes.ok) {
      console.log('❌ FAILED — merge field create', createRes.status, await createRes.text());
      process.exit(1);
    }
    console.log('✅ ARCHETYPE merge field created');
  }

  console.log('\n2. Upserting member with ARCHETYPE merge field...');
  const upsertRes = await fetch(memberUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      email_address: email,
      status_if_new: 'subscribed',
      status: 'subscribed',
      merge_fields: { FNAME: 'Test', ARCHETYPE: 'Floral' },
    }),
  });
  if (!upsertRes.ok) {
    console.log('❌ FAILED — member upsert', upsertRes.status, await upsertRes.text());
    process.exit(1);
  }
  console.log('✅ member upserted');

  console.log('\n3. Applying tags...');
  const tagRes = await fetch(tagsUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tags: testTags.map(name => ({ name, status: 'active' })) }),
  });
  if (!tagRes.ok) {
    console.log('❌ FAILED — tag apply', tagRes.status, await tagRes.text());
    process.exit(1);
  }
  console.log('✅ tags submitted');

  console.log('\n4. Reading member back to verify...');
  const readRes = await fetch(`${memberUrl}?fields=merge_fields,tags`, { headers });
  const body = await readRes.json();
  if (!readRes.ok) {
    console.log('❌ FAILED — read-back', readRes.status, body);
    process.exit(1);
  }

  const gotArchetype = body.merge_fields?.ARCHETYPE;
  const gotTags = (body.tags ?? []).map(t => t.name);
  const missingTags = testTags.filter(t => !gotTags.includes(t));

  console.log('  ARCHETYPE merge field:', gotArchetype);
  console.log('  Tags present:', gotTags.join(', '));

  if (gotArchetype === 'Floral' && missingTags.length === 0) {
    console.log('\n✅ SUCCESS — round trip confirmed (merge field + all tags present)');
  } else {
    console.log('\n❌ FAILED — round trip mismatch');
    if (gotArchetype !== 'Floral') console.log('  ARCHETYPE expected "Floral", got', gotArchetype);
    if (missingTags.length) console.log('  Missing tags:', missingTags.join(', '));
    process.exit(1);
  }
} catch (err) {
  console.error('❌ Network error:', err.message);
  process.exit(1);
}
