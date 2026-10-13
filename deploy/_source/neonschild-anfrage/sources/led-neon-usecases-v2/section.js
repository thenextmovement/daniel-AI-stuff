export default function init(root) {
 if (root.dataset.initialized) return () => {};
 root.dataset.initialized = 'true';
 const scenes = [...root.querySelectorAll('.nt-usecases__scene')];
 const previous = root.querySelector('.nt-usecases__scene-prev');
 const next = root.querySelector('.nt-usecases__scene-next');
 const caption = root.querySelector('.nt-usecases__scene-name');
 const announce = root.querySelector('.nt-usecases__announcement');
 const lightDock = root.querySelector('.nt-usecases__light-dock');
 const lightToggle = root.querySelector('.nt-usecases__light-toggle');
 const lightLabel = root.querySelector('.nt-usecases__light-label');
 const motionToggle = root.querySelector('.nt-usecases__motion-toggle');
 const motion = matchMedia('(prefers-reduced-motion: reduce)');
 const desktop = matchMedia('(min-width:1001px)');
 let visible = true;
 let active = 0, lightTimer, rotationTimer, warmupTimer, manualPause = false, paused = motion.matches, request = 0, disposed = false;
 const listeners = [];
 function on(target, event, handler) {
  target.addEventListener(event, handler);
  listeners.push(() => target.removeEventListener(event, handler));
 }
 function paintControl() {
  root.classList.toggle('is-motion-paused', paused);
  const lit = scenes[active].classList.contains('is-lit');
  lightToggle?.setAttribute('aria-checked', String(lit));
  if (lightLabel) lightLabel.textContent = lit ? 'Licht an' : 'Licht aus';
  if (motionToggle) {
   const label = paused ? 'Automatischen Bildwechsel fortsetzen' : 'Automatischen Bildwechsel pausieren';
   motionToggle.setAttribute('aria-label', label);
   motionToggle.title = label;
   motionToggle.hidden = motion.matches;
  }
 }
 function loadScene(index) {
  scenes[index].querySelectorAll('source[data-srcset]').forEach(source => {
   source.srcset = source.dataset.srcset;
   delete source.dataset.srcset;
  });
  return Promise.all([...scenes[index].querySelectorAll('img')].map(image => {
   if (image.dataset.srcset) {
    image.srcset = image.dataset.srcset;
    delete image.dataset.srcset;
   }
   if (image.dataset.src) {
    image.src = image.dataset.src;
    delete image.dataset.src;
   }
   return image.decode();
  }));
 }
 function stopTimers() {
  clearTimeout(lightTimer);
  clearTimeout(rotationTimer);
  clearTimeout(warmupTimer);
 }
 function scheduleRotation() {
  clearTimeout(rotationTimer);
  clearTimeout(warmupTimer);
  if (visible && !disposed && !paused && !motion.matches && !document.hidden) {
   // Warm only the next pair, after the first paint has settled.
   warmupTimer = setTimeout(() => loadScene((active + 1) % scenes.length).catch(() => {}), 1600);
   rotationTimer = setTimeout(() => show((active + 1) % scenes.length), 7000);
  }
 }
 function lightAfterDelay() {
  clearTimeout(lightTimer);
  if (disposed || document.hidden || !visible) return;
  const index = active;
  const illuminate = () => {
   if (!disposed && active === index) {
    scenes[index].classList.add('is-lit');
    paintControl();
   }
  };
  if (motion.matches || paused) { illuminate(); return; }
  lightTimer = setTimeout(() => {
   if (!document.hidden) illuminate();
  }, 1000);
 }
 async function show(index, manual = false) {
  const token = ++request;
  clearTimeout(lightTimer);
  clearTimeout(rotationTimer);
  try {
   await loadScene(index);
  } catch {
   if (disposed || token !== request) return;
   if (manual) announce.textContent = 'Dieses Motiv konnte nicht geladen werden.';
   if (!scenes[active].classList.contains('is-lit')) lightAfterDelay();
   scheduleRotation();
   return;
  }
  if (disposed || token !== request || document.hidden || !visible) return;
  scenes[index].classList.remove('is-lit');
  scenes.forEach((scene, i) => {
   scene.classList.toggle('is-leaving', i !== index && scene.classList.contains('is-active') && desktop.matches && !motion.matches);
   scene.classList.toggle('is-active', i === index);
  });
  active = index;
  paintControl();
  caption.textContent = scenes[index].dataset.scene;
  if (manual) announce.textContent = caption.textContent + ' ausgewählt.';
  lightAfterDelay();
  scheduleRotation();
 }
 function selectScene(direction) {
  manualPause = paused = true;
  stopTimers();
  paintControl();
  show((active + direction + scenes.length) % scenes.length, true);
 }
 if (previous) on(previous, 'click', () => selectScene(-1));
 if (next) on(next, 'click', () => selectScene(1));
 if (lightToggle) on(lightToggle, 'click', () => {
  // Freeze this exact scene before comparing its registered on/off pair.
  request++;
  stopTimers();
  manualPause = paused = true;
  scenes[active].classList.toggle('is-lit');
  paintControl();
 });
 if (motionToggle) on(motionToggle, 'click', () => {
  request++;
  stopTimers();
  manualPause = !paused;
  paused = manualPause || motion.matches;
  paintControl();
  if (!paused) {
   if (!scenes[active].classList.contains('is-lit')) lightAfterDelay();
   scheduleRotation();
  }
 });
 if (lightDock) lightDock.hidden = false;
 scenes.forEach(scene => on(scene, 'transitionend', event => {
  if (event.target === scene && event.propertyName === 'opacity' && !scene.classList.contains('is-active')) scene.classList.remove('is-leaving');
 }));
 on(document, 'visibilitychange', () => {
  request++;
  stopTimers();
  root.classList.toggle('is-page-hidden', document.hidden);
  if (!document.hidden && !manualPause) { if (!scenes[active].classList.contains('is-lit')) lightAfterDelay(); scheduleRotation(); }
 });
 on(motion, 'change', () => {paused = manualPause || motion.matches; paintControl(); if (!manualPause) lightAfterDelay(); scheduleRotation();});
 const observer = new IntersectionObserver(entries => {
  visible = entries[0].isIntersecting;
  root.classList.toggle('is-offscreen', !visible);
  if (!visible) { request++; stopTimers(); }
  else if (!manualPause) {
   if (!scenes[active].classList.contains('is-lit')) lightAfterDelay();
   scheduleRotation();
  }
 }, { threshold: 0 });
 observer.observe(root);
 root.dataset.experienceReady = 'true';
 paintControl();
 show(active);
 return () => {
  disposed = true;
  request++;
  stopTimers();
  observer.disconnect();
  delete root.dataset.experienceReady;
  listeners.forEach(remove => remove());
  scenes.forEach(scene => scene.classList.remove('is-lit', 'is-leaving'));
  root.classList.remove('is-page-hidden', 'is-motion-paused', 'is-offscreen');
  delete root.dataset.initialized;
 };
}
