(function (root) {
  'use strict';

  var blockedDomains = new Set([
    '10minutemail.com', 'aol.com', 'aol.de', 'discard.email', 'dispostable.com',
    'emailondeck.com', 'example.com', 'example.net', 'example.org', 'fakemail.net',
    'fastmail.com', 'freenet.de', 'getnada.com', 'gmail.com', 'gmx.at', 'gmx.ch',
    'gmx.com', 'gmx.de', 'gmx.net', 'googlemail.com', 'grr.la', 'guerrillamail.com',
    'hey.com', 'hotmail.co.uk', 'hotmail.com', 'hotmail.de', 'hotmail.fr', 'icloud.com',
    'icloud.de', 'laposte.net', 'live.com', 'live.de', 'mac.com', 'mail.com', 'mail.de', 'mail.ru',
    'mailbox.org', 'maildrop.cc', 'mailinator.com', 'me.com', 'msn.com', 'orange.fr',
    'outlook.com', 'outlook.de', 'pm.me', 'posteo.de', 'proton.me', 'protonmail.ch', 'protonmail.com',
    'rocketmail.com', 'sharklasers.com', 'spamgourmet.com', 't-online.de',
    'temp-mail.org', 'tempmail.com', 'throwawaymail.com', 'tuta.com', 'tuta.io',
    'tutanota.com', 'tutanota.de', 'web.de', 'yahoo.co.uk', 'yahoo.com', 'yahoo.de',
    'yahoo.fr', 'yandex.com', 'yandex.ru', 'ymail.com', 'yopmail.com', 'zoho.com'
  ]);

  function normalizeDomain(rawDomain) {
    var domain = String(rawDomain || '').trim().toLowerCase().replace(/\.$/, '');
    if (!domain || /[\\/?#:\[\]@]/.test(domain)) return '';
    try {
      domain = new URL('http://' + domain).hostname.toLowerCase().replace(/\.$/, '');
    } catch (_) {
      return '';
    }
    return domain;
  }

  function isBlockedDomain(domain) {
    if (!domain) return true;
    if (domain === 'localhost' || /\.(?:invalid|localhost|test)$/.test(domain)) return true;
    for (var blocked of blockedDomains) {
      if (domain === blocked || domain.endsWith('.' + blocked)) return true;
    }
    return false;
  }

  function inspect(value) {
    var email = String(value || '').trim();
    if (!email || email.length > 254 || /\s/.test(email)) return { valid: false, reason: 'format' };
    if ((email.match(/@/g) || []).length !== 1) return { valid: false, reason: 'format' };

    var parts = email.split('@');
    var local = parts[0];
    var domain = normalizeDomain(parts[1]);
    if (!local || local.length > 64 || local[0] === '.' || local[local.length - 1] === '.' || local.indexOf('..') !== -1) {
      return { valid: false, reason: 'format' };
    }
    if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return { valid: false, reason: 'format' };
    if (!domain || domain.length > 253 || domain.indexOf('.') === -1) return { valid: false, reason: 'format' };

    var labels = domain.split('.');
    for (var label of labels) {
      if (!label || label.length > 63 || !/^[a-z0-9-]+$/.test(label) || label[0] === '-' || label[label.length - 1] === '-') {
        return { valid: false, reason: 'format' };
      }
    }
    if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels[labels.length - 1])) {
      return { valid: false, reason: 'format' };
    }
    if (isBlockedDomain(domain)) return { valid: false, reason: 'personal_domain', domain: domain };
    return { valid: true, email: local + '@' + domain, domain: domain };
  }

  function copy() {
    var english = String(document.documentElement.lang || '').toLowerCase().indexOf('en') === 0;
    return english
      ? {
          error: 'Please use a business email address, e.g. name@company.com.',
          fallbackPrefix: 'No business email?',
          fallbackLink: 'Send your request directly by email'
        }
      : {
          error: 'Bitte verwenden Sie Ihre geschäftliche E-Mail-Adresse, z. B. name@unternehmen.de.',
          fallbackPrefix: 'Keine Firmen-E-Mail?',
          fallbackLink: 'Anfrage direkt per E-Mail senden'
        };
  }

  function errorId(input) {
    if (!input.id) input.id = 'nt-business-email-' + Math.random().toString(36).slice(2, 10);
    return input.id + '-business-error';
  }

  function showError(input, focus) {
    var id = errorId(input);
    var fallbackId = id + '-fallback';
    var message = document.getElementById(id);
    var fallback = document.getElementById(fallbackId);
    var labels = copy();
    if (!message) {
      message = document.createElement('p');
      message.id = id;
      message.setAttribute('data-nt-business-email-error', 'true');
      message.setAttribute('role', 'alert');
      message.style.cssText = 'margin:6px 0 0;color:#dc2626;font-size:12px;line-height:1.35;font-weight:600';
      input.insertAdjacentElement('afterend', message);
    }
    message.textContent = labels.error;
    if (!fallback) {
      fallback = document.createElement('p');
      fallback.id = fallbackId;
      fallback.setAttribute('data-nt-business-email-fallback', 'true');
      fallback.style.cssText = 'margin:5px 0 0;color:rgba(10,10,10,.5);font-size:11px;line-height:1.4;font-weight:500';
      message.insertAdjacentElement('afterend', fallback);
    }
    fallback.textContent = '';
    var fallbackPrefix = document.createElement('span');
    fallbackPrefix.textContent = labels.fallbackPrefix + ' ';
    var fallbackLink = document.createElement('a');
    fallbackLink.href = 'mailto:support@neontrip.de';
    fallbackLink.textContent = labels.fallbackLink;
    fallbackLink.style.cssText = 'color:#0A0A0A;font-weight:650;text-decoration:underline;text-decoration-color:rgba(10,10,10,.25);text-underline-offset:2px';
    fallback.appendChild(fallbackPrefix);
    fallback.appendChild(fallbackLink);
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', id + ' ' + fallbackId);
    input.setCustomValidity(labels.error);
    input.style.borderColor = '#f87171';
    if (focus) {
      try { input.focus({ preventScroll: false }); } catch (_) { input.focus(); }
    }
  }

  function clearError(input) {
    var id = input.id ? input.id + '-business-error' : '';
    var fallbackId = id ? id + '-fallback' : '';
    var message = id ? document.getElementById(id) : null;
    var fallback = fallbackId ? document.getElementById(fallbackId) : null;
    if (message) message.remove();
    if (fallback) fallback.remove();
    input.removeAttribute('aria-invalid');
    if (input.getAttribute('aria-describedby') === id + ' ' + fallbackId) input.removeAttribute('aria-describedby');
    input.setCustomValidity('');
    input.style.borderColor = '';
  }

  function validateInput(input, options) {
    if (!input) return false;
    var result = inspect(input.value);
    if (result.valid) {
      clearError(input);
      return true;
    }
    showError(input, Boolean(options && options.focus));
    return false;
  }

  function decorateInput(input) {
    if (!input || input.dataset.ntBusinessEmailReady === '1') return;
    input.dataset.ntBusinessEmailReady = '1';
    input.setAttribute('autocomplete', 'email');
    input.setAttribute('inputmode', 'email');
    if (!input.placeholder || /e-?mail/i.test(input.placeholder)) {
      input.placeholder = String(document.documentElement.lang || '').toLowerCase().indexOf('en') === 0
        ? 'name@company.com'
        : 'name@unternehmen.de';
    }
    input.addEventListener('input', function () {
      if (!String(input.value || '').trim() || inspect(input.value).valid) clearError(input);
    });
  }

  function decorateAll() {
    document.querySelectorAll('input[type="email"], input[name="email"], input#email').forEach(decorateInput);
  }

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || form.tagName !== 'FORM') return;
    var input = form.querySelector('input[type="email"], input[name="email"], input#email');
    if (!input || validateInput(input, { focus: true })) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorateAll);
  else decorateAll();

  root.ntBusinessEmail = {
    inspect: inspect,
    isValid: function (value) { return inspect(value).valid; },
    validateInput: validateInput,
    decorateAll: decorateAll
  };
})(window);
