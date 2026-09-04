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

    setCustomValidity(message) { this.validationMessage = String(message || ''); }
    focus() {}

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
  const context = { Set, URL, console, document };
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
    /\.then\(function\(result\) \{ return window\.ntRequirePersistedReceipt\(result, submitId\); \}\)/,
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
