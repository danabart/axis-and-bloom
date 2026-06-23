/**
 * Quick Mailchimp integration test.
 * Usage: node test-mailchimp.mjs <api_key> <list_id> <email>
 *
 * Get api_key and list_id from:
 * https://console.cloud.google.com/security/secret-manager?project=axis-and-bloom-prod
 */

import crypto from 'crypto';

const [,, MC_API_KEY, MC_LIST_ID, email = 'test@example.com'] = process.argv;

if (!MC_API_KEY || !MC_LIST_ID) {
  console.error('Usage: node test-mailchimp.mjs <api_key> <list_id> <email>');
  process.exit(1);
}

const MC_DC = MC_API_KEY.split('-').at(-1);
console.log('\n── Mailchimp config ──────────────────────────');
console.log('API key (last 6):', '...' + MC_API_KEY.slice(-6));
console.log('Datacenter:', MC_DC);
console.log('List ID:', MC_LIST_ID);
console.log('Email:', email);

const hash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
const url  = `https://${MC_DC}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}/members/${hash}`;
console.log('URL:', url);

console.log('\n── Calling Mailchimp API ─────────────────────');
try {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}`,
    },
    body: JSON.stringify({
      email_address: email,
      status_if_new: 'subscribed',
      status: 'subscribed',
      merge_fields: { FNAME: 'Test' },
    }),
  });

  const body = await res.json();

  if (res.ok) {
    console.log('✅ SUCCESS — contact upserted');
    console.log('  Status:', body.status);
    console.log('  Email:', body.email_address);
    console.log('  ID:', body.id);
  } else {
    console.log('❌ FAILED —', res.status, res.statusText);
    console.log('  Error:', body.title);
    console.log('  Detail:', body.detail);
    if (body.errors?.length) {
      body.errors.forEach(e => console.log('  Field error:', e.field, '—', e.message));
    }
  }
} catch (err) {
  console.error('❌ Network error:', err.message);
}
