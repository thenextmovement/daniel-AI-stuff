/* NEONTRIP — Main JS */
(function () {
  // ── Attribution Tracking ──
  // Captures paid-click IDs, UTM params, landing URL and referrer.
  // Auto-injects into all forms on the page before submission.
  (function initAttributionTracking() {
    var COOKIE_NAME = '_neontrip_gclid';
    var COOKIE_DAYS = 90;
    var STORAGE_PREFIX = 'nt_attr_';
    var KEYS = ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

    var params = new URLSearchParams(window.location.search);

    function setStored(key, value) {
      if (!value) return;
      try {
        localStorage.setItem(STORAGE_PREFIX + key, value);
        sessionStorage.setItem(STORAGE_PREFIX + key, value);
      } catch (e) {}
      if (key === 'gclid') {
        var expires = new Date(Date.now() + COOKIE_DAYS * 864e5).toUTCString();
        document.cookie = COOKIE_NAME + '=' + encodeURIComponent(value) + ';expires=' + expires + ';path=/;SameSite=Lax';
      }
    }

    function getStored(key) {
      try {
        return sessionStorage.getItem(STORAGE_PREFIX + key) || localStorage.getItem(STORAGE_PREFIX + key) || '';
      } catch (e) {
        return '';
      }
    }

    KEYS.forEach(function (key) {
      setStored(key, params.get(key));
    });

    try {
      if (!localStorage.getItem(STORAGE_PREFIX + 'landing_page_url')) {
        localStorage.setItem(STORAGE_PREFIX + 'landing_page_url', window.location.href);
      }
      if (document.referrer && !localStorage.getItem(STORAGE_PREFIX + 'referrer')) {
        localStorage.setItem(STORAGE_PREFIX + 'referrer', document.referrer);
      }
      sessionStorage.setItem(STORAGE_PREFIX + 'landing_page_url', window.location.href);
      if (document.referrer) sessionStorage.setItem(STORAGE_PREFIX + 'referrer', document.referrer);
    } catch (e) {}

    var gclid = params.get('gclid');
    if (gclid) {
      var expires = new Date(Date.now() + COOKIE_DAYS * 864e5).toUTCString();
      document.cookie = COOKIE_NAME + '=' + encodeURIComponent(gclid) + ';expires=' + expires + ';path=/;SameSite=Lax';
    }

    // Read gclid from cookie (fallback if not in current URL)
    function getStoredGclid() {
      var match = document.cookie.match(new RegExp('(?:^|; )' + COOKIE_NAME + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    }

    function addHidden(form, name, value) {
      if (!value || form.querySelector('input[name="' + name + '"]')) return;
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }

    function injectAttributionFields() {
      var storedGclid = getStoredGclid();
      document.querySelectorAll('form').forEach(function (form) {
        KEYS.forEach(function (key) {
          addHidden(form, key, getStored(key));
        });
        addHidden(form, 'gclid', storedGclid);
        addHidden(form, 'landing_page_url', getStored('landing_page_url') || window.location.href);
        addHidden(form, 'referrer', getStored('referrer') || document.referrer || '');
        addHidden(form, '_landing_page_url', getStored('landing_page_url') || window.location.href);
        addHidden(form, '_referrer', getStored('referrer') || document.referrer || '');
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectAttributionFields);
    } else {
      injectAttributionFields();
    }

    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      injectAttributionFields();
    }, true);
  })();
  // Mobile menu toggle
  var toggle = document.querySelector('.header__toggle');
  var mobileNav = document.querySelector('.mobile-nav');

  if (toggle && mobileNav) {
    function toggleMenu() {
      var isOpen = toggle.classList.toggle('active');
      mobileNav.classList.toggle('active');
      mobileNav.setAttribute('aria-hidden', !isOpen);
      toggle.setAttribute('aria-expanded', isOpen);
      toggle.setAttribute('aria-label', isOpen ? 'Menü schließen' : 'Menü öffnen');
      document.body.style.overflow = isOpen ? 'hidden' : '';
    }

    toggle.addEventListener('click', toggleMenu);
    toggle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleMenu();
      }
    });

    // Close on link click
    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        toggle.classList.remove('active');
        mobileNav.classList.remove('active');
        mobileNav.setAttribute('aria-hidden', 'true');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Menü öffnen');
        document.body.style.overflow = '';
      });
    });
  }

  // Set current year
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
})();
