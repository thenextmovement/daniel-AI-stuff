(() => {
  const root = document.querySelector('.nt-proof');
  if (!root) return;
  const rail = root.querySelector('.nt-proof__videos');
  const originals = [...rail.querySelectorAll('.nt-proof__video')];
  const mobile = matchMedia('(max-width: 600px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let loopReady = false;
  // Only build the desktop loop when the section approaches the viewport.
  const ensureLoop = () => {
    if (loopReady || mobile.matches) return;
    loopReady = true;
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
  };
  let cycle = 0;
  let visible = false;
  let paused = reducedMotion.matches;
  let pointerDown = false;
  let resumeAt = 0;
  let lastTime = 0;
  let remainder = 0;
  let frame = 0;
  const position = () => {
    if (mobile.matches || !loopReady) { cycle = 0; rail.scrollLeft = 0; return; }
    const step = originals[0].getBoundingClientRect().width + parseFloat(getComputedStyle(rail).gap);
    cycle = step * originals.length;
    rail.scrollLeft = 2 * cycle + 3 * step + originals[0].offsetWidth / 2 - rail.clientWidth / 2;
  };
  const normalize = () => {
    if (mobile.matches || !cycle || rail.contains(document.activeElement)) return;
    if (rail.scrollLeft < cycle) rail.scrollLeft += cycle;
    if (rail.scrollLeft >= 3 * cycle) rail.scrollLeft -= cycle;
  };
  const tick = (time) => {
    const delta = lastTime ? Math.min(time - lastTime, 64) : 0;
    lastTime = time;
    if (!paused && !pointerDown && time > resumeAt && !rail.matches(':hover') &&
        !rail.contains(document.activeElement) && !root.querySelector('dialog[open]')) {
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
    if (visible && loopReady && !document.hidden && !paused && !mobile.matches) frame = requestAnimationFrame(tick);
  };
  let nearby = false;
  mobile.addEventListener('change', () => { if (nearby) ensureLoop(); position(); schedule(); });
  reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; schedule(); });
  rail.addEventListener('scroll', normalize, {passive: true});
  rail.addEventListener('pointerdown', () => { pointerDown = true; }, {passive: true});
  window.addEventListener('pointerup', () => { pointerDown = false; resumeAt = performance.now() + 2000; }, {passive: true});
  window.addEventListener('pointercancel', () => { pointerDown = false; }, {passive: true});
  rail.addEventListener('wheel', () => { resumeAt = performance.now() + 2000; }, {passive: true});
  document.addEventListener('visibilitychange', schedule);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); }).observe(rail);
  new IntersectionObserver(([entry]) => {
    nearby = entry.isIntersecting;
    if (nearby && !loopReady && !mobile.matches) { ensureLoop(); position(); schedule(); }
  }, {rootMargin: '600px 0px'}).observe(root);
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
  const external = root.querySelector('.nt-proof__external');
  const poster = root.querySelector('.nt-proof__consent img');
  const title = root.querySelector('#nt-proof-dialog-title');
  let activeButton;

  const openVideo = (event) => {
      const button = event.target.closest('[data-video-dialog], .nt-inquiry__video');
      if (!button) return;
      event.preventDefault();
      activeButton = button;
      const { video, title: name } = button.dataset;
      poster.src = button.querySelector('img').currentSrc || button.querySelector('img').src;
      poster.alt = `Vorschaubild ${name}`;
      title.textContent = name;
      external.href = `https://www.youtube.com/watch?v=${video}`;
      player.replaceChildren();
      player.hidden = true;
      consent.hidden = false;
      dialog.classList.remove('is-playing');
      dialog.showModal();
      close.focus();
  };
  rail.addEventListener('click', openVideo);
  document.querySelectorAll('.nt-inquiry__video').forEach(button => button.addEventListener('click', openVideo));

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
