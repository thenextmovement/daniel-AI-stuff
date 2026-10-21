(() => {
  const media = document.querySelector('[data-hero-media]');
  if (!media) return;
  const off = media.querySelector('.nt-hero-photo-off');
  const on = media.querySelector('.nt-hero-photo-on');
  let run = 0;
  const ready = image => image.decode().catch(() => undefined);
  async function switchOn() {
    const current = ++run;
    media.dataset.light = 'off';
    on.style.transition = 'none';
    media.classList.remove('is-light-on');
    await Promise.all([ready(off), ready(on)]);
    if (current !== run) return;
    if (!off.naturalWidth || !on.naturalWidth) { media.classList.add('is-light-on'); return; }
    // Show the real unlit photo first; the page itself never waits for the effect.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (current !== run) return;
    on.style.removeProperty('transition');
    media.dataset.lightReadyAt = String(performance.now());
    setTimeout(() => {
      if (current !== run) return;
      media.classList.add('is-light-on');
      media.dataset.light = 'on';
      media.dataset.lightOnAt = String(performance.now());
    }, 240);
  }
  switchOn();
  // A restored page is also a new visit for this visual effect.
  addEventListener('pageshow', event => { if (event.persisted) switchOn(); });
})();
