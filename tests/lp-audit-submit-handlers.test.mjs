import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = process.env.LP_SITE_ROOT || new URL('../deploy/', import.meta.url).pathname;

// Extract the actual shipped callbacks, including nested callbacks and HTML strings.
function callback(html, marker) {
  const start = html.indexOf(marker);
  assert.ok(start >= 0, marker);
  const from = start + marker.length;
  let quote = '', escaped = false, depth = 0;
  const brace = html.indexOf('{', from);
  for (let i = brace; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return html.slice(from, i + 1);
  }
  throw new Error('Unclosed callback: ' + marker);
}

for (const slug of ['messe-event', 'leuchtkaesten', 'en']) {
  const html = await readFile(resolve(root, slug, 'index.html'), 'utf8');
  const variants = [
    ['mobile', 'form.onsubmit = ', 'form', 'hero_form_mobile'],
    ['contact', "kontaktForm.addEventListener('submit', ", 'kontaktForm', 'kontakt_form'],
  ];
  if (html.includes('id="hero-form-desktop"')) {
    variants.push(['desktop', "heroFormD.addEventListener('submit', ", 'heroFormD', 'hero_form_desktop']);
  }
  for (const [variant, marker, variable, expectedName] of variants) {
    const source = callback(html, marker);
    for (const filled of [false, true]) {
      test(`${slug}/${variant}: ${filled ? 'autofilled trap' : 'normal request'} reaches intake; rejection retains fields and enables retry`, async () => {
        const data = new FormData();
        data.set('name', 'Local QA');
        data.set('email', 'local@example.test');
        data.set('telefon', '000000000');
        data.set('website', filled ? 'autofilled.example' : '');
        const button = {innerHTML: 'Send', disabled: false};
        const form = {
          innerHTML: 'original form controls',
          querySelector: selector => selector === 'button[type="submit"]'
            ? button : {value: 'local value', focus() {}, style: {}},
        };
        const failure = new Error('HTTP 502 | persistence_unconfirmed');
        let calls = 0, reports = 0, banners = 0;
        const context = {
          [variable]: form, heroCurrentStep: 3, setTimeout,
          FormData: function() {return data;},
          window: {
            ntRequireContactFields: () => true,
            ntSubmitForm: (actualForm, payload, name) => {
              calls++;
              assert.equal(actualForm, form);
              assert.equal(payload, data);
              assert.equal(name, expectedName);
              return Promise.reject(failure);
            },
            ntReportSubmitFailure: (name, error) => {
              reports++; assert.equal(name, expectedName); assert.equal(error, failure);
            },
            ntShowFailureBanner: (actualForm, error) => {
              banners++; assert.equal(actualForm, form); assert.equal(error, failure);
            },
          },
        };
        const run = vm.runInNewContext('(' + source + ')', context);
        await run({preventDefault() {}});
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(calls, 1, 'must reach the existing guarded intake path');
        assert.equal(reports, 1, 'must invoke existing failure reporting');
        assert.equal(banners, 1, 'must show the error associated with this attempt');
        assert.equal(button.disabled, false, 'a deliberate retry remains possible');
        assert.equal(button.innerHTML, 'Send');
        assert.equal(form.innerHTML, 'original form controls');
      });
    }
  }
}
