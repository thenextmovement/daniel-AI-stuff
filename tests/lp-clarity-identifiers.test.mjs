import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../deploy/assets/js/nt-clarity-identifiers.js', import.meta.url), 'utf8');
const granted = () => ({ hasResponse: true, consent: { statistics: true, marketing: false } });

function run({ consent = granted(), jar = new Map(), blocked = false, queued = false,
  pathname = '/logo/', noCrypto = false } = {}) {
  const listeners = new Map();
  const calls = [];
  const writes = [];
  let now = 100000;
  const window = {
    Cookiebot: consent,
    crypto: noCrypto ? undefined : webcrypto,
    location: { hostname: 'anfrage.neontrip.de', protocol: 'https:', pathname,
      search: '?email=private@example.test&gclid=private', hash: '#private' },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    }
  };
  if (!queued) window.clarity = (...args) => { calls.push(args); };
  const document = {
    get cookie() {
      if (blocked) throw new Error('storage blocked');
      return Array.from(jar, ([key, value]) => key + '=' + value).join('; ');
    },
    set cookie(value) {
      writes.push(value);
      if (blocked) throw new Error('storage blocked');
      const [pair, ...attrs] = value.split(';');
      const [key, content] = pair.split('=');
      if (attrs.includes('Max-Age=0')) jar.delete(key);
      else jar.set(key, content);
    }
  };
  const context = vm.createContext({ window, document, Uint8Array, Date: { now: () => now } });
  vm.runInContext(source, context);
  return {
    window, calls, writes, jar, listeners,
    identify: () => calls.filter(([name]) => name === 'identify'),
    emit: name => (listeners.get(name) || []).forEach(fn => fn()),
    advance: ms => { now += ms; },
    rerun: () => vm.runInContext(source, context)
  };
}

test('absent, unresolved, rejected and marketing-only consent never create or identify visitors', () => {
  for (const consent of [null, { hasResponse: false, consent: { statistics: true } },
    { hasResponse: true, consent: { statistics: false, marketing: true } }]) {
    const state = run({ consent });
    state.emit('CookiebotOnConsentReady');
    state.emit('pointerdown');
    assert.equal(state.jar.size, 0);
    assert.equal(state.identify().length, 0);
    assert.equal(state.writes.some(write => !write.includes('Max-Age=0')), false);
  }
});

test('statistics consent sets consentv2 before identify with random IDs and a path-only page', () => {
  const state = run();
  assert.deepEqual(JSON.parse(JSON.stringify(state.calls[0])), ['consentv2', {
    analytics_Storage: 'granted', ad_Storage: 'denied'
  }]);
  const [command, visitor, session, page] = state.identify()[0];
  assert.equal(command, 'identify');
  assert.match(visitor, /^ntv_[a-f0-9]{32}$/);
  assert.match(session, /^nts_[a-f0-9]{32}$/);
  assert.equal(page, 'neontrip:/logo');
  assert.equal(state.identify()[0].length, 4);
  assert.doesNotMatch(JSON.stringify(state.calls), /private|email|gclid/);
  for (const cookie of state.writes) {
    assert.match(cookie, /;Path=\/;Max-Age=\d+;SameSite=Lax;Domain=neontrip.de;Secure$/);
  }
});

test('restored consent and duplicate lifecycle events identify only once per page', () => {
  const state = run();
  state.emit('CookiebotOnConsentReady');
  state.emit('CookiebotOnAccept');
  state.emit('pageshow');
  state.advance(61000);
  state.emit('scroll');
  state.rerun();
  assert.equal(state.identify().length, 1);
  assert.equal(state.listeners.get('CookiebotOnAccept').length, 1);
});

test('later consent creates a compatible queue before the existing Clarity loader is ready', () => {
  const state = run({ consent: null, queued: true });
  assert.equal(state.window.clarity, undefined);
  state.window.Cookiebot = granted();
  state.emit('CookiebotOnAccept');
  assert.deepEqual(Array.from(state.window.clarity.q, args => args[0]), ['consentv2', 'identify']);
});

test('navigation retains visitor and session but changes page; URL aliases normalize', () => {
  const first = run();
  const next = run({ jar: first.jar, pathname: '/en/anfrage.html' });
  assert.equal(first.identify()[0][1], next.identify()[0][1]);
  assert.equal(first.identify()[0][2], next.identify()[0][2]);
  assert.equal(next.identify()[0][3], 'neontrip:/en/anfrage');
  assert.equal(run({ pathname: '/logo/index.html' }).identify()[0][3], 'neontrip:/logo');
  assert.equal(run({ pathname: '/' }).identify()[0][3], 'neontrip:/');
});

test('unresolved consent preserves stored migration IDs without reading or sending them', () => {
  const first = run();
  const next = run({ jar: first.jar, consent: { hasResponse: false, consent: { statistics: false } } });
  assert.equal(next.writes.length, 0);
  assert.equal(next.identify().length, 0);
  next.window.Cookiebot = granted();
  next.emit('CookiebotOnConsentReady');
  assert.equal(next.identify()[0][1], first.identify()[0][1]);
});

test('withdrawal clears both IDs, denies analytics, and reconsent starts fresh', () => {
  const state = run();
  const first = state.identify()[0];
  state.window.Cookiebot.consent.statistics = false;
  state.emit('CookiebotOnDecline');
  assert.equal(state.jar.size, 0);
  assert.equal(state.calls.at(-1)[1].analytics_Storage, 'denied');
  state.emit('keydown');
  assert.equal(state.identify().length, 1);
  state.window.Cookiebot.consent.statistics = true;
  state.emit('CookiebotOnAccept');
  assert.notEqual(state.identify()[1][1], first[1]);
  assert.notEqual(state.identify()[1][2], first[2]);
});

test('a 30-minute expired session rotates on activity while keeping the visitor', () => {
  const state = run();
  const first = state.identify()[0];
  // Browser expiry removes the session cookie; the browser check covers Max-Age.
  state.jar.delete('nt_clarity_session');
  state.advance(1801000);
  state.emit('pointerdown');
  const next = state.identify()[1];
  assert.equal(next[1], first[1]);
  assert.notEqual(next[2], first[2]);
  assert.ok(state.writes.some(write => write.includes('Max-Age=1800')));
});

test('marketing changes only synchronize consent, never duplicate identify', () => {
  const state = run();
  state.window.Cookiebot.consent.marketing = true;
  state.emit('CookiebotOnAccept');
  assert.equal(state.calls.at(-1)[1].ad_Storage, 'granted');
  assert.equal(state.identify().length, 1);
});

test('blocked storage and unavailable crypto do not throw or identify unstable visitors', () => {
  assert.equal(run({ blocked: true }).identify().length, 0);
  assert.equal(run({ noCrypto: true }).identify().length, 0);
});

test('malformed stored values are replaced, never passed to Clarity', () => {
  const jar = new Map([['nt_clarity_visitor', 'private@example.test'], ['nt_clarity_session', 'invalid']]);
  const state = run({ jar });
  assert.match(state.identify()[0][1], /^ntv_[a-f0-9]{32}$/);
  assert.doesNotMatch(JSON.stringify(state.calls), /private@example/);
});

test('all 14 tracked pages and the source template load the same version exactly once', async () => {
  const version = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const files = ['deploy/_source/layouts/base.html', 'deploy/anfrage.html', 'deploy/en/anfrage.html'];
  const configDir = new URL('../deploy/_source/configs/', import.meta.url);
  for (const name of await readdir(configDir)) {
    if (!name.endsWith('.json')) continue;
    const config = JSON.parse(await readFile(new URL(name, configDir), 'utf8'));
    files.push('deploy/' + (config.output_dir || config.slug) + '/' + (config.output_file || 'index.html'));
  }
  assert.equal(files.length, 15);
  for (const file of files) {
    const html = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    const tag = '<script defer data-cookieconsent="ignore" src="/assets/js/nt-clarity-identifiers.js?v=' + version + '"></script>';
    assert.equal(html.split(tag).length - 1, 1, file);
    assert.equal(html.split('"vvb78gxiwp"').length - 1, 1, file + ' keeps the existing loader');
  }
});
