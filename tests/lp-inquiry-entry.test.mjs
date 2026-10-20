import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const products = ['neonschild', 'front-buchstaben', 'halo-buchstaben', 'leuchtkasten', 'sonderanfertigung', 'marquee', 'halo-lampe', 'gesamtkonzept'];
for (const file of ['anfrage.html', 'en/anfrage.html']) {
  const html = await readFile(new URL('../deploy/' + file, import.meta.url), 'utf8');
  const start = html.indexOf('  const urlParams = new URLSearchParams(window.location.search);');
  const end = html.indexOf('  const exitPopup =', start);
  assert.ok(start >= 0 && end > start, 'actual URL initialization block exists');
  const source = html.slice(start, end);

  function load(search) {
    const state = {currentStep: 1, data: {product: null, details: {}}};
    const selected = new Set();
    const headings = {};
    const timers = [];
    const card = {
      classList: {add: name => selected.add(name), remove: name => selected.delete(name)},
      scrollIntoView() { throw new Error('Entry must not scroll to a preselected product'); },
    };
    const context = {
      URLSearchParams, state,
      document: {
        querySelector: () => card,
        querySelectorAll: () => [card],
        getElementById: id => headings[id] ||= {},
      },
      window: {location: {search}, addEventListener: (type, fn) => { if (type === 'load') fn(); }},
      updateNav() {},
      goToStep: step => { state.currentStep = step; },
      setTimeout: fn => { timers.push(fn); },
    };
    vm.runInNewContext(source, context);
    for (const run of timers) run();
    return {state, selected, headings};
  }

  for (const product of [...products, null]) {
    test(`${file}: ${product || 'plain entry'} starts at step 1 without choosing a product`, () => {
      const {state, selected} = load(product ? '?produkt=' + product : '');
      assert.equal(state.currentStep, 1);
      assert.equal(state.data.product, null);
      assert.equal(selected.size, 0);
    });
  }

  test(`${file}: entry still preserves attribution, use case and location`, () => {
    const query = '?produkt=gesamtkonzept&utm_source=entry_test&utm_campaign=existing&nt_handoff=1&branche=messe&ort=aussen&kw=leuchtbuchstaben';
    const {state, headings} = load(query);
    assert.equal(state.data.urlSource, query);
    assert.equal(state.data.details.usecase, 'messe');
    assert.equal(state.data.details.ort, 'aussen');
    if (file === 'anfrage.html') {
      assert.equal(headings['anfrage-h1'].textContent, '3D Leuchtbuchstaben nach Maß');
    }
  });
}
