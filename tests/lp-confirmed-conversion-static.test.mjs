import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const generatedPages = [
  'deploy/index.html',
  'deploy/en/index.html',
  'deploy/firmenlogo-beleuchtet/index.html',
  'deploy/firmenschilder/index.html',
  'deploy/led-schriftzuege/index.html',
  'deploy/leuchtbuchstaben/index.html',
  'deploy/leuchtkaesten/index.html',
  'deploy/leuchtreklame/index.html',
  'deploy/logo/index.html',
  'deploy/messe-event/index.html',
  'deploy/neon-schild-personalisieren/index.html',
  'deploy/neon-schilder/index.html',
];

test('all generated landing pages require a persisted receipt and pass the submit ID to Ads', async () => {
  for (const path of generatedPages) {
    const html = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(html, /ntRequirePersistedReceipt/, path);
    assert.match(html, /transaction_id/, path);
    assert.doesNotMatch(html, /queued:\s*true/, path);
  }
});

test('standalone DE and EN wizards pass the stable submit ID as Google transaction ID', async () => {
  for (const path of ['deploy/anfrage.html', 'deploy/en/anfrage.html']) {
    const html = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(html, /convData\.transaction_id\s*=\s*submitId/, path);
    assert.match(html, /result\.submit_id/, path);
  }
});

test('the retired v2 route redirects to the canonical tracked landing page', async () => {
  const redirects = await readFile(new URL('../deploy/_redirects', import.meta.url), 'utf8');
  assert.match(redirects, /^\/neon-schilder-v2\s+\/neon-schilder\/\s+301$/m);
  assert.match(redirects, /^\/neon-schilder-v2\/\*\s+\/neon-schilder\/\s+301$/m);
});
