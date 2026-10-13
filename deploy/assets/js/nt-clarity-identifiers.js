/* NEONTRIP Clarity identifiers. Cookiebot remains the statistics consent authority. */
(function (window, document) {
  'use strict';
  if (window.__ntClarityIdentifiers) return;
  window.__ntClarityIdentifiers = true;

  var visitorCookie = 'nt_clarity_visitor';
  var sessionCookie = 'nt_clarity_session';
  var hostname = window.location.hostname;
  var domain = /(^|\.)neontrip\.de$/.test(hostname) ? ';Domain=neontrip.de' : '';
  var secure = window.location.protocol === 'https:' ? ';Secure' : '';
  var lastIdentity = '';
  var lastConsent = '';
  var lastActivity = 0;
  var hadConsent = false;

  function readCookie(name) {
    try {
      var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
      return match ? match[1] : '';
    } catch (_) { return ''; }
  }

  function writeCookie(name, value, seconds) {
    try {
      document.cookie = name + '=' + value + ';Path=/;Max-Age=' + seconds + ';SameSite=Lax' + domain + secure;
    } catch (_) { /* Blocked storage must never break the page or form. */ }
  }

  function clearIdentifiers() {
    writeCookie(visitorCookie, '', 0);
    writeCookie(sessionCookie, '', 0);
    lastIdentity = '';
    lastActivity = 0;
  }

  function randomId(prefix) {
    if (!window.crypto || !window.crypto.getRandomValues) return '';
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return prefix + Array.from(bytes, function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function storedId(name, prefix, lifetime, refresh) {
    var id = readCookie(name);
    if (!new RegExp('^' + prefix + '[0-9a-f]{32}$').test(id)) {
      id = randomId(prefix);
      if (!id) return '';
      writeCookie(name, id, lifetime);
    } else if (refresh) {
      writeCookie(name, id, lifetime);
    }
    // Do not send an identity that cannot survive the next page load.
    return readCookie(name) === id ? id : '';
  }

  function clarity(command, payload, session, page) {
    try {
      var result = command === 'identify'
        ? window.clarity(command, payload, session, page)
        : window.clarity(command, payload);
      if (result && typeof result.catch === 'function') {
        result.catch(function () { lastIdentity = ''; });
      }
      return true;
    } catch (_) { return false; }
  }

  function synchronize() {
    var cb = window.Cookiebot;
    if (!cb || !cb.consent) return;
    var granted = cb.hasResponse === true && cb.consent.statistics === true;
    var adsGranted = cb.hasResponse === true && cb.consent.marketing === true;
    // An unresolved banner on another subdomain must not erase shared IDs.
    // They are still never read or sent until that page has statistics consent.
    if (!granted && (cb.hasResponse === true || hadConsent)) clearIdentifiers();
    hadConsent = granted;

    // Share the existing loader's queue if consent resolves before it executes.
    if (granted && typeof window.clarity !== 'function') {
      window.clarity = function () {
        (window.clarity.q = window.clarity.q || []).push(arguments);
      };
    }
    if (typeof window.clarity !== 'function') return;
    var consentKey = String(granted) + ':' + String(adsGranted);
    if (lastConsent !== consentKey) {
      if (!clarity('consentv2', {
        analytics_Storage: granted ? 'granted' : 'denied',
        ad_Storage: adsGranted ? 'granted' : 'denied'
      })) return;
      lastConsent = consentKey;
    }
    if (!granted) return;

    var visitor = storedId(visitorCookie, 'ntv_', 31536000, false);
    var session = storedId(sessionCookie, 'nts_', 1800, true);
    if (!visitor || !session) return;
    var page = 'neontrip:' + (window.location.pathname
      .replace(/\/index\.html$/, '/')
      .replace(/\.html$/, '')
      .replace(/\/$/, '') || '/');
    var identity = visitor + '|' + session + '|' + page;
    if (lastIdentity !== identity && clarity('identify', visitor, session, page)) {
      lastIdentity = identity;
    }
    lastActivity = Date.now();
  }

  // No field contents, names, emails, URL query strings or fragments are read.
  function onActivity() {
    var cb = window.Cookiebot;
    if (!cb || cb.hasResponse !== true || !cb.consent || cb.consent.statistics !== true) return;
    if (Date.now() - lastActivity >= 60000) synchronize();
  }
  ['CookiebotOnConsentReady', 'CookiebotOnAccept', 'CookiebotOnDecline'].forEach(function (event) {
    window.addEventListener(event, synchronize);
  });
  ['pointerdown', 'keydown', 'scroll'].forEach(function (event) {
    window.addEventListener(event, onActivity, { passive: true });
  });
  window.addEventListener('pageshow', synchronize);
  synchronize();
})(window, document);
