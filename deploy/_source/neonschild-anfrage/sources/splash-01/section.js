/* Load with defer, after the splash stylesheet. One run per document entry. */
(() => {
  const overlay = document.querySelector('[data-nt-splash]');
  if (!overlay) return;
  const content = document.querySelector('[data-nt-splash-content]');
  // The overlay must sit outside the page wrapper that becomes temporarily inert.
  if (!content || content.contains(overlay)) { overlay.remove(); return; }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const previousFocus = document.activeElement;
  const previousInert = content.inert;
  const htmlStyle = document.documentElement.style;
  const oldOverflow = htmlStyle.getPropertyValue('overflow');
  const oldPriority = htmlStyle.getPropertyPriority('overflow');
  let finished = false;
  let timer;
  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const focusWasInSplash = overlay.contains(document.activeElement);
    overlay.remove();
    content.inert = previousInert;
    if (oldOverflow) htmlStyle.setProperty('overflow', oldOverflow, oldPriority);
    else htmlStyle.removeProperty('overflow');
    removeEventListener('keydown', onKey);
    removeEventListener('pagehide', finish);
    reduced.removeEventListener('change', onReducedMotion);
    if (focusWasInSplash && previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
  }
  function onKey(event) { if (event.key === 'Escape') finish(); }
  function onReducedMotion() { if (reduced.matches) finish(); }
  addEventListener('keydown', onKey);
  addEventListener('pagehide', finish, {once:true});
  reduced.addEventListener('change', onReducedMotion);
  content.inert = true;
  htmlStyle.setProperty('overflow', 'hidden');
  overlay.hidden = false;
  overlay.setAttribute('data-active', '');
  overlay.focus({preventScroll:true});
  timer = setTimeout(finish, reduced.matches ? 180 : 1500);
})();
