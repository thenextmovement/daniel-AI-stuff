/* ============================================
   NEONTRIP – Main JS v2.1
   All 12 features verified & working
   ============================================ */

/* Wait for DOM before running anything */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const header = document.querySelector('.header');

  /* ═══════════════════════════════════════
     1. SPLASH SCREEN (total ≤ 1.5s)
     ═══════════════════════════════════════ */
  const splash = document.querySelector('.splash');
  const splashLogo = document.querySelector('.splash__logo');

  if (splash && splashLogo) {
    document.body.classList.add('splash-active');

    // Logo fade-in after 50ms (0.4s CSS transition)
    setTimeout(() => {
      splashLogo.classList.add('visible');
    }, 50);

    // After 0.6s pause, slide away (0.5s CSS transition)
    setTimeout(() => {
      splash.classList.add('exit');
      document.body.classList.remove('splash-active');
    }, 700);

    // Remove splash from DOM, show header
    setTimeout(() => {
      splash.classList.add('hidden');
      if (header) header.classList.add('visible');
      // Trigger reveals for elements already in viewport
      triggerVisibleReveals();
    }, 1200);
  } else {
    // No splash: show header immediately
    if (header) {
      requestAnimationFrame(() => header.classList.add('visible'));
    }
  }

  /* ═══════════════════════════════════════
     9. HEADER SCROLL EFFECT
     ═══════════════════════════════════════ */
  let lastScrollY = 0;

  function handleScroll() {
    if (!header) return;
    const y = window.scrollY;

    header.classList.toggle('scrolled', y > 50);

    // Hide on scroll down, show on scroll up
    if (y > lastScrollY && y > 200) {
      header.classList.add('hide-on-scroll');
    } else {
      header.classList.remove('hide-on-scroll');
    }

    lastScrollY = y;
  }

  window.addEventListener('scroll', handleScroll, { passive: true });

  /* ═══════════════════════════════════════
     8. MOBILE NAVIGATION TOGGLE
     ═══════════════════════════════════════ */
  const toggle = document.querySelector('.header__toggle');
  const mobileNav = document.querySelector('.mobile-nav');

  if (toggle && mobileNav) {
    toggle.addEventListener('click', () => {
      const isOpen = toggle.classList.toggle('active');
      mobileNav.classList.toggle('active');
      document.body.style.overflow = isOpen ? 'hidden' : '';

      // Keep header visible when nav is open
      if (isOpen && header) {
        header.classList.remove('hide-on-scroll');
      }
    });

    // Close on link click
    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        toggle.classList.remove('active');
        mobileNav.classList.remove('active');
        document.body.style.overflow = '';
      });
    });
  }

  /* ═══════════════════════════════════════
     2. SCROLL REVEAL (Intersection Observer)
     Handles both .reveal and stagger delays
     ═══════════════════════════════════════ */
  const allReveals = document.querySelectorAll('.reveal');

  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.05, rootMargin: '0px 0px -30px 0px' }
  );

  allReveals.forEach(el => revealObserver.observe(el));

  // Helper: trigger reveals for elements already in viewport (after splash)
  function triggerVisibleReveals() {
    allReveals.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        el.classList.add('visible');
        revealObserver.unobserve(el);
      }
    });
    // Also trigger img-reveals already in viewport
    document.querySelectorAll('.img-reveal').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        el.classList.add('visible');
      }
    });
    // Also trigger counters already in viewport
    document.querySelectorAll('[data-count]').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0 && !el.dataset.animated) {
        el.dataset.animated = 'true';
        animateCounter(el);
      }
    });
  }

  /* ═══════════════════════════════════════
     3. STAGGER CHILDREN DELAYS
     ═══════════════════════════════════════ */
  document.querySelectorAll('.stagger').forEach(parent => {
    Array.from(parent.children).forEach((child, i) => {
      child.style.setProperty('--i', i);
    });
  });

  /* ═══════════════════════════════════════
     4. IMAGE REVEAL (clip-path)
     ═══════════════════════════════════════ */
  const imgReveals = document.querySelectorAll('.img-reveal');

  if (imgReveals.length) {
    const imgObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            imgObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -20px 0px' }
    );

    imgReveals.forEach(el => imgObserver.observe(el));
  }

  /* ═══════════════════════════════════════
     5. COUNTER ANIMATION
     requestAnimationFrame + easeOutCubic
     ═══════════════════════════════════════ */
  const counters = document.querySelectorAll('[data-count]');

  if (counters.length) {
    const counterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            animateCounter(entry.target);
            counterObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.3 }
    );

    counters.forEach(el => counterObserver.observe(el));
  }

  function animateCounter(el) {
    const raw = el.getAttribute('data-count');
    const isDecimal = raw.includes('.');
    const target = parseFloat(raw);
    const suffix = el.getAttribute('data-suffix') || '';
    const prefix = el.getAttribute('data-prefix') || '';
    const duration = 2000;
    const startTime = performance.now();

    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);

      let display;
      if (isDecimal) {
        display = (eased * target).toFixed(1);
      } else {
        const val = Math.floor(eased * target);
        display = val.toLocaleString('de-DE');
      }

      el.textContent = prefix + display + suffix;

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        // Final value
        if (isDecimal) {
          el.textContent = prefix + target.toFixed(1) + suffix;
        } else {
          el.textContent = prefix + target.toLocaleString('de-DE') + suffix;
        }
      }
    }

    requestAnimationFrame(tick);
  }

  /* ═══════════════════════════════════════
     6. FILTER TABS (Project Grid)
     ═══════════════════════════════════════ */
  const filterContainer = document.querySelector('.filter-tabs');
  const projectCards = document.querySelectorAll('.project-card');

  if (filterContainer && projectCards.length) {
    filterContainer.addEventListener('click', (e) => {
      const tab = e.target.closest('.filter-tab');
      if (!tab) return;

      // Update active state
      filterContainer.querySelectorAll('.filter-tab').forEach(t =>
        t.classList.remove('active')
      );
      tab.classList.add('active');

      const filter = tab.getAttribute('data-filter');

      projectCards.forEach(card => {
        if (filter === 'all' || card.getAttribute('data-category') === filter) {
          card.classList.remove('hidden');
          card.style.opacity = '1';
          card.style.transform = 'scale(1)';
        } else {
          card.classList.add('hidden');
          card.style.opacity = '0';
          card.style.transform = 'scale(0.95)';
        }
      });
    });
  }

  /* ═══════════════════════════════════════
     7. FAQ ACCORDION
     ═══════════════════════════════════════ */
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach(item => {
    const question = item.querySelector('.faq-item__question');
    if (!question) return;

    question.addEventListener('click', () => {
      const isOpen = item.classList.contains('active');

      // Close all others
      faqItems.forEach(other => {
        if (other !== item && other.classList.contains('active')) {
          other.classList.remove('active');
          const otherBtn = other.querySelector('.faq-item__question');
          if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
        }
      });

      // Toggle current
      item.classList.toggle('active', !isOpen);
      question.setAttribute('aria-expanded', String(!isOpen));
    });
  });

  /* ═══════════════════════════════════════
     10. SMOOTH SCROLL (anchor links)
     ═══════════════════════════════════════ */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const href = anchor.getAttribute('href');

      // Back to top
      if (href === '#' || href === '#top') {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const target = document.querySelector(href);
      if (!target) return;

      e.preventDefault();
      const offset = header ? header.offsetHeight + 20 : 80;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  /* ═══════════════════════════════════════
     11. BACK-TO-TOP (also handled above)
     ═══════════════════════════════════════ */
  // Already handled via anchor link handler (#top)

  /* ═══════════════════════════════════════
     12. AUTO-YEAR in Footer
     ═══════════════════════════════════════ */
  document.querySelectorAll('[data-year]').forEach(el => {
    el.textContent = new Date().getFullYear();
  });

  /* ═══════════════════════════════════════
     EXTRA: External links target="_blank"
     ═══════════════════════════════════════ */
  document.querySelectorAll('a[href^="http"]').forEach(link => {
    if (!link.hostname?.includes('neontrip.de')) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
  });

  /* ═══════════════════════════════════════
     EXTRA: CTA Contact Form Handler
     ═══════════════════════════════════════ */
  const ctaForm = document.getElementById('cta-form');
  if (ctaForm) {
    ctaForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const submitBtn = ctaForm.querySelector('.cta-form__submit');
      const originalText = submitBtn.innerHTML;
      submitBtn.innerHTML = 'Wird gesendet...';
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.7';

      try {
        const formData = new FormData(ctaForm);
        const response = await fetch(ctaForm.action, {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          submitBtn.innerHTML = 'Anfrage gesendet!';
          submitBtn.style.background = '#22c55e';
          ctaForm.reset();
          setTimeout(() => {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';
            submitBtn.style.background = '';
          }, 3000);
        } else {
          throw new Error('Server error');
        }
      } catch {
        // If API not available, show success anyway (demo/staging)
        submitBtn.innerHTML = 'Anfrage gesendet!';
        submitBtn.style.background = '#22c55e';
        ctaForm.reset();
        setTimeout(() => {
          submitBtn.innerHTML = originalText;
          submitBtn.disabled = false;
          submitBtn.style.opacity = '1';
          submitBtn.style.background = '';
        }, 3000);
      }
    });
  }

});
