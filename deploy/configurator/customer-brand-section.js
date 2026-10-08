// Existing landing-page customer-video-proof module, scoped to this section.
(() => {
  const root = document.querySelector('#config-customers.nt-proof');
  if (!root) return;
  const rail = root.querySelector('.nt-proof__videos');
  const originals = [...rail.querySelectorAll('.nt-proof__video')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  // Repeated sets keep the viewport filled through either loop boundary.
  for (let set = 0; set < 2; set++) {
    const before = document.createDocumentFragment();
    const after = document.createDocumentFragment();
    originals.forEach((card) => {
      for (const fragment of [before, after]) {
        const copy = card.cloneNode(true);
        copy.dataset.repeat = 'true';
        copy.setAttribute('aria-hidden', 'true');
        copy.tabIndex = -1;
        fragment.append(copy);
      }
    });
    rail.prepend(before);
    rail.append(after);
  }
  let cycle = 0;
  let visible = false;
  let paused = reducedMotion.matches;
  let pointerDown = false;
  let lastTime = 0;
  let remainder = 0;
  let frame = 0;
  const position = () => {
    const step = originals[0].getBoundingClientRect().width + parseFloat(getComputedStyle(rail).gap);
    cycle = step * originals.length;
    rail.scrollLeft = 2 * cycle + 3 * step + originals[0].offsetWidth / 2 - rail.clientWidth / 2;
  };
  const normalize = () => {
    if (!cycle || rail.matches(':focus-visible') || rail.querySelector(':focus-visible')) return;
    if (rail.scrollLeft < cycle) rail.scrollLeft += cycle;
    if (rail.scrollLeft >= 3 * cycle) rail.scrollLeft -= cycle;
  };
  const tick = (time) => {
    const delta = lastTime ? Math.min(time - lastTime, 64) : 0;
    lastTime = time;
    if (!paused && !pointerDown && !rail.matches(':focus-visible') &&
        !rail.querySelector(':focus-visible') && !root.querySelector('dialog[open]')) {
      remainder += delta * 0.018;
      const pixels = Math.floor(remainder);
      remainder -= pixels;
      rail.scrollLeft += pixels;
      normalize();
    }
    frame = requestAnimationFrame(tick);
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    lastTime = 0;
    if (visible && !document.hidden && !paused) frame = requestAnimationFrame(tick);
  };
  reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; schedule(); });
  rail.addEventListener('scroll', normalize, {passive: true});
  rail.addEventListener('pointerdown', () => { pointerDown = true; }, {passive: true});
  window.addEventListener('pointerup', () => { pointerDown = false; }, {passive: true});
  window.addEventListener('pointercancel', () => { pointerDown = false; }, {passive: true});
  document.addEventListener('visibilitychange', schedule);
  // Prepare images before entry; animate only while the rail is actually visible.
  const preloadRail = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    rail.querySelectorAll('img[loading="lazy"]').forEach(image => { image.loading = 'eager'; });
    preloadRail.disconnect();
  }, {rootMargin: '200px 0px'});
  preloadRail.observe(rail);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); }).observe(rail);
  new ResizeObserver(position).observe(rail);
  position();
  // Fewer logos at once keep the header compact. Rotate only while visible.
  const brands = root.querySelector('.nt-proof__brands');
  const brandGroups = [...brands.querySelectorAll('.nt-proof__brand-group')];
  let brandIndex = 0;
  let brandsVisible = false;
  let brandTimer;
  const scheduleBrands = () => {
    clearTimeout(brandTimer);
    if (!brandsVisible || document.hidden || reducedMotion.matches) return;
    brandTimer = setTimeout(() => {
      brandGroups[brandIndex].classList.remove('is-active');
      brandGroups[brandIndex].setAttribute('aria-hidden', 'true');
      brandIndex = (brandIndex + 1) % brandGroups.length;
      brandGroups[brandIndex].classList.add('is-active');
      brandGroups[brandIndex].removeAttribute('aria-hidden');
      scheduleBrands();
    }, 4000);
  };
  new IntersectionObserver(([entry]) => {
    brandsVisible = entry.isIntersecting;
    scheduleBrands();
  }, {threshold: .5}).observe(brands);
  document.addEventListener('visibilitychange', scheduleBrands);
  reducedMotion.addEventListener('change', scheduleBrands);
  const dialog = root.querySelector('.nt-proof__dialog');
  const consent = root.querySelector('.nt-proof__consent');
  const player = root.querySelector('.nt-proof__player');
  const close = root.querySelector('.nt-proof__close');
  const load = root.querySelector('.nt-proof__load');
  let external = root.querySelector('.nt-proof__external');
  const poster = root.querySelector('.nt-proof__consent img');
  const title = root.querySelector('#nt-proof-dialog-title');
  let activeButton;

  [...root.querySelectorAll('button.nt-proof__video')].forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      activeButton = button;
      const { video, title: name } = button.dataset;
      const image = button.querySelector('img');
      poster.src = image.dataset.deferredSrc || image.src;
      poster.alt = `Vorschaubild ${name}`;
      title.textContent = name;
      if(external.tagName!=='A'){const link=document.createElement('a');link.className=external.className;link.textContent=external.textContent;link.target='_blank';link.rel='noopener noreferrer';external.replaceWith(link);external=link;}
      external.href = `https://www.youtube.com/watch?v=${video}`;
      player.replaceChildren();
      player.hidden = true;
      consent.hidden = false;
      dialog.classList.remove('is-playing');
      dialog.showModal();
      close.focus();
    });
  });

  load.addEventListener('click', () => {
    if (!activeButton) return;
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${activeButton.dataset.video}?autoplay=1&rel=0&playsinline=1`;
    iframe.title = activeButton.dataset.title;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    player.replaceChildren(iframe);
    consent.hidden = true;
    player.hidden = false;
    dialog.classList.add('is-playing');
    close.focus();
  });

  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    player.replaceChildren();
    const original = originals.find((card) => card.dataset.video === activeButton?.dataset.video);
    if (activeButton?.matches('.nt-inquiry__video')) activeButton.focus({preventScroll: true});
    else original?.focus();
    activeButton = undefined;
  });
})();
