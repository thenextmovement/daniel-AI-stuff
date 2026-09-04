/* NEONTRIP LP Common — Attribution Capture + Video Lazy Loader + Pause Recovery */
(function () {
  'use strict';

  var keys = [
    'gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign',
    'utm_term', 'utm_content', 'kw', 'oppref', 'campaign_id', 'ad_group_id',
    'ad_id', 'ad_account_id', 'openai_ad_group_id'
  ];
  var prefixes = ['nt_attr_', 'nt_'];
  var params = new URLSearchParams(window.location.search);

  function safeGet(storage, key) {
    try { return storage.getItem(key) || ''; } catch (_) { return ''; }
  }

  function safeSet(storage, key, value) {
    if (!value) return;
    try { storage.setItem(key, value); } catch (_) {}
  }

  function safeRemove(storage, key) {
    try { storage.removeItem(key); } catch (_) {}
  }

  function getStored(key) {
    for (var i = 0; i < prefixes.length; i += 1) {
      var prefix = prefixes[i];
      var value = safeGet(sessionStorage, prefix + key) || safeGet(localStorage, prefix + key);
      if (value) return value;
    }
    return '';
  }

  function setStored(key, value) {
    prefixes.forEach(function (prefix) {
      safeSet(sessionStorage, prefix + key, value);
      safeSet(localStorage, prefix + key, value);
    });
    if (key === 'gclid' && value) {
      var expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString();
      document.cookie = '_neontrip_gclid=' + encodeURIComponent(value) + ';expires=' + expires + ';path=/;SameSite=Lax';
    }
  }

  function addHidden(form, name, value) {
    if (!value) return;
    var input = form.querySelector('input[name="' + name + '"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.appendChild(input);
    }
    input.value = value;
  }

  function getDirectValue(key) {
    var direct = params.get(key);
    if (direct) return direct;
    if (key === 'utm_campaign') return params.get('campaign_id') || '';
    if (key === 'utm_content') return params.get('ad_id') || '';
    if (key === 'utm_term') return params.get('openai_ad_group_id') || params.get('ad_group_id') || '';
    return '';
  }

  var incoming = {};
  keys.forEach(function (key) { incoming[key] = getDirectValue(key); });
  var hasIncomingAttribution = keys.some(function (key) { return Boolean(incoming[key]); });
  var internalNavigation = params.get('nt_handoff') === '1';
  try {
    internalNavigation = internalNavigation
      || (Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin);
  } catch (_) {}

  var hadStoredLandingPage = Boolean(getStored('landing_page_url'));
  if (hasIncomingAttribution) {
    keys.forEach(function (key) {
      prefixes.forEach(function (prefix) {
        safeRemove(sessionStorage, prefix + key);
        safeRemove(localStorage, prefix + key);
      });
    });
    if (!incoming.gclid && !incoming.gbraid && !incoming.wbraid) {
      document.cookie = '_neontrip_gclid=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax';
    }
    keys.forEach(function (key) { setStored(key, incoming[key]); });
  }

  var shouldStartNewAttribution = hasIncomingAttribution && !internalNavigation;
  if (shouldStartNewAttribution) {
    prefixes.forEach(function (prefix) {
      safeRemove(sessionStorage, prefix + 'landing_page_url');
      safeRemove(localStorage, prefix + 'landing_page_url');
      safeRemove(sessionStorage, prefix + 'referrer');
      safeRemove(localStorage, prefix + 'referrer');
    });
  }
  if (!hadStoredLandingPage || shouldStartNewAttribution) {
    prefixes.forEach(function (prefix) {
      safeSet(sessionStorage, prefix + 'landing_page_url', window.location.href);
      safeSet(localStorage, prefix + 'landing_page_url', window.location.href);
    });
  }
  if (document.referrer && (shouldStartNewAttribution || !getStored('referrer'))) {
    prefixes.forEach(function (prefix) {
      safeSet(sessionStorage, prefix + 'referrer', document.referrer);
      safeSet(localStorage, prefix + 'referrer', document.referrer);
    });
  }
  safeSet(sessionStorage, 'nt_current_page_url', window.location.href);

  function getValue(key) {
    return getDirectValue(key) || getStored(key);
  }

  function appendTrackingParams(url) {
    var target = new URL(url, window.location.href);
    keys.forEach(function (key) {
      var value = getValue(key);
      if (value && !target.searchParams.has(key)) target.searchParams.set(key, value);
    });
    if (target.origin === window.location.origin && /^\/anfrage(?:\.html)?\/?$/.test(target.pathname)) {
      target.searchParams.set('nt_handoff', '1');
    }
    return target.href;
  }

  function decorateTrackingLinks() {
    document.querySelectorAll('a[href]').forEach(function (link) {
      var rawHref = link.getAttribute('href');
      if (!rawHref || rawHref.indexOf('#') === 0 || rawHref.indexOf('mailto:') === 0 || rawHref.indexOf('tel:') === 0) return;
      var target = new URL(rawHref, window.location.href);
      if (target.origin === window.location.origin && /^\/anfrage(?:\.html)?\/?$/.test(target.pathname)) {
        link.href = appendTrackingParams(rawHref);
      }
    });
  }

  function inject() {
    document.querySelectorAll('form').forEach(function (form) {
      keys.forEach(function (key) { addHidden(form, key, getValue(key)); });
      var cookieMatch = document.cookie.match(/(?:^|; )_neontrip_gclid=([^;]*)/);
      if (cookieMatch && !form.querySelector('input[name="gclid"]')) addHidden(form, 'gclid', decodeURIComponent(cookieMatch[1]));
      var landingPage = getStored('landing_page_url') || window.location.href;
      var referrer = getStored('referrer') || document.referrer || '';
      addHidden(form, 'landing_page_url', landingPage);
      addHidden(form, '_landing_page_url', landingPage);
      addHidden(form, 'current_page_url', window.location.href);
      addHidden(form, 'referrer', referrer);
      addHidden(form, '_referrer', referrer);
    });
  }

  window.ntAppendTrackingParams = appendTrackingParams;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { inject(); decorateTrackingLinks(); });
  } else {
    inject();
    decorateTrackingLinks();
  }
  document.addEventListener('submit', function (event) {
    if (event.target && event.target.tagName === 'FORM') inject();
  }, true);
})();

window.addEventListener('load', function () {
  function loadVideo(id, delay) {
    setTimeout(function () {
      var video = document.getElementById(id);
      if (!video) return;
      var source = video.querySelector('source[data-src]');
      if (!source) return;
      source.src = source.getAttribute('data-src');
      video.load();
      function tryPlay() {
        video.play().then(function () { video.classList.add('video-loaded'); }).catch(function () {});
      }
      tryPlay();
      video.addEventListener('pause', function () {
        if (!document.hidden && video.readyState >= 2) setTimeout(tryPlay, 300);
      });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && video.classList.contains('video-loaded')) setTimeout(tryPlay, 500);
      });
    }, delay);
  }
  if (window.innerWidth >= 768) loadVideo('hero-video-desktop', 2000);
  else loadVideo('hero-video-mobile', 300);
});
