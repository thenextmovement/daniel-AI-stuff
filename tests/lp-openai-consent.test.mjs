import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const pages = ['index.html', 'en/index.html', 'firmenlogo-beleuchtet/index.html',
  'firmenschilder/index.html', 'led-schriftzuege/index.html', 'leuchtbuchstaben/index.html',
  'leuchtkaesten/index.html', 'leuchtreklame/index.html', 'logo/index.html',
  'messe-event/index.html', 'neon-schild-personalisieren/index.html', 'neon-schilder/index.html',
  'anfrage.html', 'en/anfrage.html'];

function run(source, consent) {
  const listeners = new Map();
  let loads = 0;
  const window = {
    Cookiebot: consent,
    addEventListener(name, callback) { listeners.set(name, callback); },
  };
  const document = {
    createElement() { return {}; },
    getElementsByTagName() { return [{ parentNode: { insertBefore() { loads += 1; } } }]; },
  };
  window.window = window;
  window.document = document;
  vm.runInNewContext(source, window);
  return {
    window,
    emit(name) { listeners.get(name)(); },
    get loads() { return loads; },
    get commands() { return Array.from(window.oaiq?.q || [], args => Array.from(args)); },
  };
}

for (const page of pages) {
  const html = await readFile(new URL('../deploy/' + page, import.meta.url), 'utf8');
  const source = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g), m => m[1])
    .find(script => script.includes('https://bzrcdn.openai.com/sdk/oaiq.min.js'));
  assert.ok(source, page + ' pixel setup exists');

  test(page + ': existing marketing consent never receives a destructive false reset', () => {
    const state = run(source, { hasResponse: true, consent: { marketing: true } });
    assert.equal(state.loads, 1);
    assert.deepEqual(state.commands[0], ['consent', true]);
    assert.equal(state.commands[1][0], 'init');
    assert.equal(state.commands[1][1].pixelId, '6GqgnrdSPjJSGdthY89B9Y');
    assert.equal(state.commands.some(([name, value]) => name === 'consent' && value === false), false);
  });

  test(page + ': waits for restored consent instead of treating default values as rejection', () => {
    const state = run(source, { hasResponse: false, consent: { marketing: false } });
    assert.equal(state.loads, 0);
    assert.equal(state.commands.length, 0);
    state.window.Cookiebot = { hasResponse: true, consent: { marketing: true } };
    state.emit('CookiebotOnConsentReady');
    state.emit('CookiebotOnAccept');
    assert.deepEqual(state.commands[0], ['consent', true]);
    assert.equal(state.commands.filter(([name]) => name === 'init').length, 1);
    assert.equal(state.loads, 1);
  });

  test(page + ': absent or unanswered consent neither loads nor initializes the pixel', () => {
    const state = run(source, undefined);
    state.emit('CookiebotOnConsentReady');
    state.window.Cookiebot = { hasResponse: false, consent: { marketing: false } };
    state.emit('CookiebotOnConsentReady');
    assert.equal(state.loads, 0);
    assert.equal(state.commands.length, 0);
  });

  test(page + ': confirmed rejection sets denied consent before initialization', () => {
    const state = run(source, { hasResponse: true, consent: { marketing: false } });
    assert.deepEqual(state.commands[0], ['consent', false]);
    assert.equal(state.commands[1][0], 'init');
    state.emit('CookiebotOnDecline');
    assert.equal(state.commands.filter(([name]) => name === 'init').length, 1);
    assert.equal(state.commands.some(([name]) => name === 'measure'), false);
  });

  test(page + ': revocation and withdrawal revoke an already initialized pixel', () => {
    const state = run(source, { hasResponse: true, consent: { marketing: true } });
    state.window.Cookiebot.consent.marketing = false;
    state.emit('CookiebotOnDecline');
    assert.deepEqual(state.commands.at(-1), ['consent', false]);
    state.window.Cookiebot.consent.marketing = true;
    state.emit('CookiebotOnAccept');
    assert.deepEqual(state.commands.at(-1), ['consent', true]);
    state.window.Cookiebot.hasResponse = false;
    state.emit('CookiebotOnConsentReady');
    assert.deepEqual(state.commands.at(-1), ['consent', false]);
    assert.equal(state.loads, 1);
    assert.equal(state.commands.filter(([name]) => name === 'init').length, 1);
  });
}
