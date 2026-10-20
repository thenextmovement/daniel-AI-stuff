/* NEONTRIP OpenAI measurement. One owner for Cookiebot consent and confirmed leads. */
(function (w, d) {
  'use strict';
  if (w.ntOpenAiAds) return;
  var production = w.location.hostname === 'anfrage.neontrip.de';
  var initialized = false, loading = false, ready = false, epoch = 0;
  var pending = new Map(), sent = new Set();
  var storageKey = 'nt_openai_leads_v1';
  var uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

  function allowed() {
    var cb = w.Cookiebot;
    return !!(production && cb && cb.hasResponse === true && cb.consent && cb.consent.marketing === true);
  }
  function rejected() {
    var cb = w.Cookiebot;
    return !!(cb && cb.hasResponse === true && cb.consent && cb.consent.marketing !== true);
  }
  function forgetAttribution() {
    // No false reset while Cookiebot is restoring an existing selection.
    ['__oppref', '__obref'].forEach(function (name) {
      ['', ';domain=' + w.location.hostname, ';domain=.neontrip.de'].forEach(function (domain) {
        d.cookie = name + '=;Max-Age=0;path=/;SameSite=Lax' + domain;
      });
    });
    ['sessionStorage', 'localStorage'].forEach(function (store) {
      try {
        ['nt_oppref', 'nt_attr_oppref', storageKey].forEach(function (key) { w[store].removeItem(key); });
      } catch (_) {}
    });
  }
  function remembered(id) {
    if (sent.has(id) || pending.has(id)) return true;
    try { return JSON.parse(w.sessionStorage.getItem(storageKey) || '[]').includes(id); }
    catch (_) { return false; }
  }
  function remember(id) {
    sent.add(id);
    try {
      var ids = JSON.parse(w.sessionStorage.getItem(storageKey) || '[]');
      w.sessionStorage.setItem(storageKey, JSON.stringify(Array.from(new Set(ids.concat(id))).slice(-200)));
    } catch (_) {}
  }
  function flush() {
    if (!ready || !initialized || !allowed()) return;
    pending.forEach(function (entry, id) {
      if (!entry.hashed || entry.epoch !== epoch) return;
      pending.delete(id);
      try {
        if (entry.hash) w.oaiq('init', { user: { email_sha256: entry.hash } });
        // Consent can change while the SDK or email hash is loading.
        if (!allowed() || entry.epoch !== epoch) return;
        w.oaiq('measure', 'lead_created', { type: 'customer_action' }, { event_id: id });
        remember(id);
      } catch (_) {}
    });
  }
  function sync() {
    try {
      if (!production) return;
      if (!allowed()) {
        epoch += 1;
        pending.clear();
        if (ready && typeof w.oaiq === 'function') w.oaiq('consent', false);
        if (initialized || loading || rejected()) forgetAttribution();
        return;
      }
      if (ready) {
        w.oaiq('consent', true);
        if (!initialized) {
          w.oaiq('init', { pixelId: '6GqgnrdSPjJSGdthY89B9Y' });
          initialized = true;
        }
        flush();
      } else if (!loading) {
        loading = true;
        // Queue no init or measurement before onload: withdrawal must win a slow SDK race.
        if (!w.oaiq) {
          var q = function () { q.q.push(arguments); };
          q.q = [];
          w.oaiq = q;
        }
        var script = d.createElement('script');
        script.async = true;
        script.dataset.cookieconsent = 'ignore';
        script.src = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';
        script.onload = function () { ready = true; sync(); };
        script.onerror = function () { pending.clear(); loading = false; script.remove(); };
        d.head.appendChild(script);
      }
    } catch (_) { pending.clear(); }
  }
  function lead(id, email) {
    try {
      if (!uuid.test(id || '') || !allowed() || remembered(id)) return false;
      var entry = { epoch: epoch, hashed: false, hash: '' };
      pending.set(id, entry);
      var value = String(email || '').trim().toLowerCase();
      function finish(hash) {
        if (pending.get(id) !== entry || entry.epoch !== epoch || !allowed()) return;
        entry.hash = hash; entry.hashed = true; flush();
      }
      if (value && w.crypto && w.crypto.subtle && typeof TextEncoder === 'function') {
        w.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then(function (buffer) {
          finish(Array.from(new Uint8Array(buffer), function (b) { return b.toString(16).padStart(2, '0'); }).join(''));
        }).catch(function () { finish(''); });
      } else finish('');
      sync();
      return true;
    } catch (_) { return false; }
  }
  function confirmedLead(receipt, email) {
    if (!receipt || receipt.alreadyConfirmed || receipt.ok !== true || receipt.accepted !== true ||
        receipt.persisted !== true || receipt.contact_saved !== true ||
        !uuid.test(receipt.client_submit_id || '') || receipt.client_submit_id !== receipt.lead_request_id ||
        !uuid.test(receipt.request_row_id || '') || !uuid.test(receipt.customer_id || '')) return false;
    return lead(receipt.client_submit_id, email);
  }
  // Forward only a reference actually present in this URL; the SDK owns its cookie.
  // Preserve its raw query encoding, and do not decorate after an explicit denial.
  var rawReference = w.location.search.match(/(?:^\?|&)oppref=([^&]+)/);
  function decorate(link) {
    try {
      if (!rawReference || rejected() || !link) return;
      var raw = link.getAttribute('href');
      if (!raw || raw[0] === '#') return;
      var url = new URL(raw, w.location.href);
      if (url.origin !== w.location.origin || url.searchParams.has('oppref')) return;
      url.search += (url.search ? '&' : '?') + 'oppref=' + rawReference[1];
      link.href = url.href;
    } catch (_) {}
  }
  w.ntOpenAiAds = { lead: lead, confirmedLead: confirmedLead, syncConsent: sync };
  ['CookiebotOnConsentReady', 'CookiebotOnAccept', 'CookiebotOnDecline'].forEach(function (name) {
    w.addEventListener(name, sync);
  });
  d.addEventListener('click', function (event) {
    decorate(event.target.closest && event.target.closest('a[href]'));
  }, true);
  function links() { d.querySelectorAll('a[href]').forEach(decorate); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', links, { once: true });
  else links();
  sync();
})(window, document);
