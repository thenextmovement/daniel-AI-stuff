import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(
  new URL('../deploy/assets/js/nt-business-email.js', import.meta.url),
  'utf8'
);
const serverSource = await readFile(
  new URL('../functions/api/c.js', import.meta.url),
  'utf8'
);

function loadValidator(lang = 'de') {
  const context = {
    Set,
    URL,
    console,
    document: {
      readyState: 'complete',
      documentElement: { lang },
      addEventListener() {},
      querySelectorAll() { return []; },
      getElementById() { return null; },
      createElement() { throw new Error('not needed for inspection tests'); },
    },
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'nt-business-email.js' });
  return context.ntBusinessEmail;
}

test('client business-email validator accepts company-owned domains', () => {
  const validator = loadValidator();
  const accepted = [
    'sales@neontrip.de',
    'max.mustermann+messe@sub.firma.de',
    'Name@COMPANY.COM',
    'projekt@büro.de',
  ];
  for (const email of accepted) assert.equal(validator.isValid(email), true, email);
});

test('client business-email validator rejects personal, disposable and malformed domains', () => {
  const validator = loadValidator('en');
  const rejected = [
    '',
    'not-an-email',
    'name@gmail.com',
    'name@sub.gmail.com',
    'name@mail.de',
    'name@pm.me',
    'name@mailinator.com',
    'name@company.test',
    'name@localhost',
    'name@company',
    'name@company.com/path',
    'name@company.com:443',
  ];
  for (const email of rejected) assert.equal(validator.isValid(email), false, email);
});

test('client and server use the same blocked provider-domain set', () => {
  function extractDomains(value, marker) {
    const start = value.indexOf(marker);
    assert.ok(start >= 0, marker);
    const block = value.slice(start, value.indexOf(']);', start));
    return Array.from(block.matchAll(/["']([a-z0-9.-]+)["']/g), (match) => match[1]).sort();
  }
  assert.deepEqual(
    extractDomains(source, 'var blockedDomains = new Set(['),
    extractDomains(serverSource, 'const BLOCKED_PERSONAL_EMAIL_DOMAINS = new Set([')
  );
});
