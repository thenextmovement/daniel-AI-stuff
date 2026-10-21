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
const pageSource = await readFile(
  new URL('../deploy/_source/layouts/base.html', import.meta.url),
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

function loadValidatorWithInput(lang = 'de') {
  const elementsById = new Map();

  class Element {
    constructor(tagName) {
      this.tagName = String(tagName).toUpperCase();
      this.attributes = new Map();
      this.children = [];
      this.dataset = {};
      this.listeners = new Map();
      this.parentElement = null;
      this.placeholder = '';
      this.style = { cssText: '', borderColor: '', display: '' };
      this.validationMessage = '';
      this.value = '';
      this._id = '';
      this._textContent = '';
    }

    set id(value) {
      if (this._id) elementsById.delete(this._id);
      this._id = String(value || '');
      if (this._id) elementsById.set(this._id, this);
    }

    get id() { return this._id; }

    set textContent(value) {
      this._textContent = String(value || '');
      for (const child of this.children) child.parentElement = null;
      this.children = [];
    }

    get textContent() {
      return this._textContent + this.children.map((child) => child.textContent).join('');
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === 'id') this.id = value;
    }

    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    removeAttribute(name) { this.attributes.delete(name); }

    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    insertAdjacentElement(position, child) {
      assert.equal(position, 'afterend');
      const siblings = this.parentElement.children;
      child.parentElement = this.parentElement;
      siblings.splice(siblings.indexOf(this) + 1, 0, child);
      return child;
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }

    dispatch(type) {
      for (const listener of this.listeners.get(type) || []) listener({ target: this });
    }

    dispatchEvent(event) { this.dispatch(event.type); }

    setCustomValidity(message) { this.validationMessage = String(message || ''); }
    focus() { this.focusCount = (this.focusCount || 0) + 1; }

    remove() {
      if (this.parentElement) {
        const siblings = this.parentElement.children;
        const index = siblings.indexOf(this);
        if (index >= 0) siblings.splice(index, 1);
      }
      if (this.id) elementsById.delete(this.id);
      this.parentElement = null;
    }
  }

  const parent = new Element('div');
  const input = new Element('input');
  input.id = 'email';
  input.placeholder = 'E-Mail';
  parent.appendChild(input);

  const document = {
    readyState: 'complete',
    documentElement: { lang },
    addEventListener() {},
    querySelectorAll() { return [input]; },
    getElementById(id) { return elementsById.get(id) || null; },
    createElement(tagName) { return new Element(tagName); },
  };
  const context = { Set, URL, Event, console, document };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'nt-business-email.js' });
  return { document, input, parent, validator: context.ntBusinessEmail };
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

test('obvious suffix typos suggest a correction without guessing a company or mailbox', () => {
  const validator = loadValidator();
  for (const [wrong, correct] of [
    ['hin@websitebamar.comn', 'hin@websitebamar.com'],
    ['Max.Sales+messe@sub.firma.cmo', 'Max.Sales+messe@sub.firma.com'],
    ['info@büro.dee', 'info@xn--bro-hoa.de'],
    ['info@firma.nett', 'info@firma.net'],
    ['info@firma.ogr', 'info@firma.org'],
  ]) {
    const result = validator.inspect(wrong);
    assert.equal(result.valid, true, wrong);
    assert.equal(result.reason, 'domain_typo', wrong);
    assert.equal(result.suggestion, correct, wrong);
    assert.equal(result.email, wrong.replace('büro', 'xn--bro-hoa'), 'submitted email retains the typo');
    assert.equal(validator.isValid(wrong), true, 'suggestion must not block submit');
  }
  for (const ending of ['co', 'io', 'dev', 'agency', 'technology', 'museum', 'com', 'de', 'cm', 'om', 'cam']) {
    assert.equal(validator.isValid('Sales+tag@unbekannte-firma.' + ending), true, ending);
  }
  assert.equal(validator.isValid('hni@websitebamar.com'), true, 'do not guess mailbox spelling');
});

test('every advisory suffix can pass the existing server validator without accepting its correction', () => {
  const context = { Set, URL };
  const start = serverSource.indexOf('const BLOCKED_PERSONAL_EMAIL_DOMAINS = new Set([');
  const end = serverSource.indexOf('function cleanQualificationValue(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(serverSource.slice(start, end) + '\nthis.inspect = inspectBusinessEmail;', context);
  const validator = loadValidator();
  for (const [suffixes, correction] of [
    [['comn', 'comm', 'cmo', 'con', 'comnn', 'ccom', 'cmom', 'coml', 'comk', 'ocm', 'copm', 'cpm', 'vom'], 'com'],
    [['dee', 'dde', 'deee'], 'de'],
    [['nte', 'nett'], 'net'],
    [['ogr'], 'org'],
  ]) {
    for (const suffix of suffixes) {
      const original = 'Sales+tag@firma.' + suffix;
      const result = validator.inspect(original);
      assert.equal(result.valid, true, original);
      assert.equal(result.email, original);
      assert.equal(result.suggestion, 'Sales+tag@firma.' + correction);
      const server = context.inspect(result.email);
      assert.equal(server.valid, true, original);
      assert.equal(server.normalized, original, 'server must not silently accept the suggested correction');
    }
  }
});

test('correction needs an explicit click, preserves accessibility hints and clears stale suggestions', () => {
  for (const lang of ['de', 'en']) {
    const { document, input, validator } = loadValidatorWithInput(lang);
    input.setAttribute('aria-describedby', 'privacy-note');
    input.value = 'hin@websitebamar.comn';
    input.dispatch('input');
    assert.ok(document.getElementById('email-business-error'), 'hint appears before blur');
    assert.equal(validator.validateInput(input, { focus: true }), true);
    assert.equal(input.value, 'hin@websitebamar.comn');
    assert.equal(input.validationMessage, '');
    assert.equal(input.getAttribute('aria-invalid'), null);
    assert.equal(input.style.borderColor, '');
    assert.equal(input.focusCount || 0, 0, 'advisory does not steal submit focus');
    assert.equal(document.getElementById('email-business-error-fallback'), null);
    const message = document.getElementById('email-business-error');
    assert.equal(message.getAttribute('role'), 'status');
    assert.equal(message.getAttribute('data-nt-business-email-hint'), 'true');
    assert.equal(message.getAttribute('data-nt-business-email-error'), null);
    const button = message.children[0];
    input.dispatch('blur');
    assert.equal(message.children[0], button, 'blur must not replace the correction button during a click');
    assert.equal(message.getAttribute('data-clarity-mask'), 'true');
    assert.equal(input.getAttribute('aria-describedby'), 'privacy-note email-business-error');
    message.children[0].dispatch('click');
    assert.equal(input.value, 'hin@websitebamar.com');
    assert.equal(input.validationMessage, '');
    assert.equal(input.getAttribute('aria-describedby'), 'privacy-note');

    input.value = 'first@firma.comn';
    validator.validateInput(input);
    const stale = document.getElementById('email-business-error').children[0];
    input.value = 'second@firma.de';
    input.dispatch('input');
    stale.dispatch('click');
    assert.equal(input.value, 'second@firma.de');
    assert.equal(document.getElementById('email-business-error'), null);
  }
});

test('personal email stays allowed only on explicitly opted-in configurator fields', () => {
  const { input, validator } = loadValidatorWithInput();
  input.value = 'person@gmail.com';
  assert.equal(validator.validateInput(input), false);
  input.setAttribute('data-nt-email-personal', 'allow');
  assert.equal(validator.validateInput(input), true);
  input.value = 'person@gmail.comn';
  assert.equal(validator.validateInput(input), true);
  assert.equal(validator.isValid('person@gmail.com'), false, 'B2B public API unchanged');
});

test('switching between errors and optional suggestions clears only the obsolete state', () => {
  const { document, input, validator } = loadValidatorWithInput();
  for (const value of ['person@gmail.com', 'not-an-email']) {
    input.value = value;
    assert.equal(validator.validateInput(input), false);
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.ok(input.validationMessage);
    input.value = 'person@firma.comn';
    input.dispatch('input');
    assert.equal(validator.validateInput(input), true);
    assert.equal(input.validationMessage, '');
    assert.equal(input.getAttribute('aria-invalid'), null);
    assert.equal(document.getElementById('email-business-error').getAttribute('role'), 'status');
    assert.equal(document.getElementById('email-business-error-fallback'), null);
  }
});

test('business-email error renders one localized mail fallback and clears on valid input', () => {
  const cases = [
    {
      lang: 'de',
      error: 'Bitte verwenden Sie Ihre geschäftliche E-Mail-Adresse, z. B. name@unternehmen.de.',
      fallbackPrefix: 'Keine Firmen-E-Mail? ',
      fallbackLink: 'Anfrage direkt per E-Mail senden',
    },
    {
      lang: 'en',
      error: 'Please use a business email address, e.g. name@company.com.',
      fallbackPrefix: 'No business email? ',
      fallbackLink: 'Send your request directly by email',
    },
  ];

  for (const expected of cases) {
    const { document, input, parent, validator } = loadValidatorWithInput(expected.lang);
    input.value = 'person@gmail.com';
    assert.equal(validator.validateInput(input), false);
    assert.equal(validator.validateInput(input), false);

    const errors = parent.children.filter((element) => element.getAttribute('data-nt-business-email-error') === 'true');
    const fallbacks = parent.children.filter((element) => element.getAttribute('data-nt-business-email-fallback') === 'true');
    assert.equal(errors.length, 1, expected.lang + ' renders one error');
    assert.equal(errors[0].textContent, expected.error);
    assert.equal(fallbacks.length, 1, expected.lang + ' renders one fallback');
    assert.equal(fallbacks[0].children[0].textContent, expected.fallbackPrefix);
    assert.equal(fallbacks[0].children[1].textContent, expected.fallbackLink);
    assert.equal(fallbacks[0].children[1].href, 'mailto:support@neontrip.de');
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(input.getAttribute('aria-describedby'), 'email-business-error email-business-error-fallback');
    assert.equal(input.validationMessage, expected.error);

    const link = fallbacks[0].children[1];
    input.dispatch('change');
    input.dispatch('blur');
    assert.equal(fallbacks[0].children[1], link,
      expected.lang + ' keeps the link pressed before blur available for the first click');
    assert.equal(link.parentElement, fallbacks[0]);

    input.value = 'sales@neontrip.de';
    input.dispatch('input');
    assert.equal(document.getElementById('email-business-error'), null);
    assert.equal(document.getElementById('email-business-error-fallback'), null);
    assert.equal(parent.children.length, 1, expected.lang + ' clears error and fallback');
    assert.equal(input.getAttribute('aria-invalid'), null);
    assert.equal(input.validationMessage, '');
  }
});

test('business-email mail fallback cannot emit a lead conversion', () => {
  assert.doesNotMatch(source, /\boaiq\b|\bgtag\b|lead_created|generate_lead/);
  assert.match(
    pageSource,
    /rawHref\.startsWith\('mailto:'\)/,
    'global attribution decorator must leave mail links untouched'
  );
  assert.match(
    pageSource,
    /\.then\(function\(result\)\s*\{\s*(?:phase = 'receipt';\s*)?return window\.ntRequirePersistedReceipt\(result, submitId\);\s*\}\)/,
    'lead flow must require a persisted server receipt before resolving'
  );
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
