import {createCroTracker,croPageType,croPath,CTAS,SECTIONS,INQUIRY_STEPS} from './nt-cro.js?v=20261022-choices1';

const LP_SECTIONS = {hero:'hero',projekte:'projects',events:'events',anfrage:'products',vorteile:'benefits',bewertungen:'reviews',faq:'faq',kunden:'references',kontakt:'contact'};
const NEONSCHILD_SECTIONS = {'led-neon-start':'hero',vorteile:'benefits',projekte:'projects',anfrage:'inquiry',ablauf:'how_it_works','material-montage':'mounting',kundenstimmen:'reviews',express:'express',faq:'faq',produkte:'products',instagram:'instagram',kontakt:'contact'};
const CONFIG_SECTIONS = {'config-how-it-works':'how_it_works','config-ar':'ar','config-budget':'budget','config-customers':'brands','config-product':'mounting','config-delivery-info':'express','schriftzug-faq':'faq','config-other-signs':'other_signs','config-customer-photos':'customer_photos'};
const FORM_IDS = {'hero-form':'hero_mobile','hero-form-desktop':'hero_desktop','kontakt-form':'contact','quick-anfrage-form':'quick_request','quick-form':'quick_request','multi-step-form':'multi_step','anfrage-form':'multi_step','quote-form':'configurator_quote','nt-inquiry-form':'neonschild_inquiry','nt-classic-form':'neonschild_contact'};
const SECTION_CTAS = {hero:'hero_request',products:'products_request',benefits:'benefits_request',faq:'faq_request',references:'references_request',contact:'contact_request',how_it_works:'process_request',express:'express_request'};
const PRODUCT_CTAS = {'front-buchstaben':'product_front_request','halo-buchstaben':'product_halo_request',leuchtkasten:'product_lightbox_request',ausstecker:'product_blade_request'};
const CONFIG_CTAS = {'add-to-cart':['editor_add_to_cart','editor'],'review-add-to-cart':['review_add_to_cart','editor'],'page-add-to-cart':['sticky_add_to_cart','editor'],'cart-pay':['cart_checkout','cart'],'prepare-checkout':['cart_checkout','cart'],'cart-request-quote':['cart_quote','cart'],'config-final-action':['final_configure','final_cta']};

export function initCroPage(browser = globalThis) {
  if (browser.ntCro) return browser.ntCro;
  const doc = browser.document, pageType = croPageType(browser.location?.pathname);
  if (!doc || !pageType) return null;
  const tracker = createCroTracker(browser,pageType);
  browser.ntCro = tracker;
  // Reuse the existing navigation helper for scripted new-tab inquiry buttons.
  if (typeof browser.ntAppendTrackingParams === 'function') {
    const append = browser.ntAppendTrackingParams;
    browser.ntAppendTrackingParams = function(...args) {return tracker.inquiryUrl(append.apply(this,args));};
  }
  const neonschild = croPath(browser.location.pathname) === '/neonschild/anfrage';
  const sections = pageType === 'configurator' ? CONFIG_SECTIONS : neonschild ? NEONSCHILD_SECTIONS : LP_SECTIONS;
  for (const [id,value] of Object.entries(sections)) {
    const node = doc.getElementById(id);
    if (node) node.dataset.croSection = value;
  }
  if (pageType === 'configurator') {
    doc.querySelector('.editor')?.setAttribute('data-cro-section','editor');
    doc.getElementById('config-final-action')?.parentElement?.setAttribute('data-cro-section','final_cta');
  }
  for (const form of doc.querySelectorAll('form')) {
    const id = FORM_IDS[form.id];
    if (id) {
      form.dataset.croForm = id;
      form.dataset.croSection = pageType === 'configurator' ? 'cart' : form.closest('section')?.dataset.croSection || 'form';
    }
  }
  // The standalone wizard has no <form>; its existing root owns the attempt.
  const wizard = pageType === 'form' ? doc.querySelector('main') : null;
  if (wizard) {wizard.dataset.croForm = 'inquiry_wizard';wizard.dataset.croSection = 'form';}
  function markCta(node,id,section) {
    if (!node || !CTAS.has(id) || !SECTIONS.has(section)) return;
    node.dataset.croCta = id;node.dataset.croSectionId = section;
  }
  for (const [id,[cta,section]] of Object.entries(CONFIG_CTAS)) markCta(doc.getElementById(id),cta,section);
  if (pageType === 'landing') {
    for (const node of doc.querySelectorAll('a,button')) {
      const href = node.getAttribute('href') || '', handler = node.getAttribute('onclick') || '';
      let inquiryLink = false;
      try {const url = new URL(href,browser.location.href);inquiryLink = url.origin === browser.location.origin && /^\/anfrage(?:\.html)?\/?$/.test(url.pathname);} catch {}
      const inlineInquiry = neonschild && (href === '#anfrage' || (href === '#express' && !!node.closest('#led-neon-start')));
      if (!handler.includes('openFormPopup(') && !inquiryLink && !inlineInquiry) continue;
      const inHeader = !!node.closest('header'), inGallery = !!node.closest('[role=dialog],dialog,#projectGalleryModal,#lightbox');
      const section = inHeader ? 'header' : node.closest(neonschild ? '.nt-site-footer' : 'footer') ? 'footer' : inGallery ? 'gallery' : node.closest('[data-cro-section]')?.dataset.croSection || 'gallery';
      markCta(node,neonschild && href === '#express' ? 'hero_express_request' : inHeader ? 'header_request' : section === 'footer' ? 'footer_request' : SECTION_CTAS[section] || 'gallery_request',section);
      const product = handler.match(/openFormPopup\(['"]([a-z-]+)['"]/)?.[1];
      if (product) node.dataset.croProduct = product;
      if (neonschild && section === 'products' && PRODUCT_CTAS[product]) markCta(node,PRODUCT_CTAS[product],section);
    }
    for (const node of doc.querySelectorAll('header .header-cta[href="#hero"],a.mobile-nav-link[href="#hero"]')) markCta(node,'header_request','header');
    markCta(doc.getElementById('pgm-cta'),'gallery_request','gallery');
    markCta(doc.getElementById('lightbox-cta'),'gallery_request','gallery');
    for (const sticky of doc.querySelectorAll('#contact-sticky a[href="#hero"],#mobile-sticky-cta a[href="#hero"]')) markCta(sticky,'sticky_request','hero');
    doc.querySelector('section.md\\:hidden h2')?.closest('section')?.setAttribute('data-cro-section','testimonials_mobile');
  }
  const inquiryForm = neonschild ? doc.getElementById('nt-inquiry-form') : null;
  if (inquiryForm) {
    markCta(doc.getElementById('nt-inquiry-back'),'inquiry_back','inquiry');
    markCta(doc.getElementById('nt-inquiry-edit-location'),'inquiry_step_location','inquiry');
    for (const node of inquiryForm.querySelectorAll('[data-step-button]')) {
      markCta(node,'inquiry_step_' + INQUIRY_STEPS[Number(node.dataset.stepButton)],'inquiry');
    }
    markCta(doc.querySelector('#nt-classic-form [type=submit]'),'contact_submit','contact');
  }
  const dwell = new Map();
  let timer = null, frame = null, enabledBefore = false;
  const viewed = new Set();
  function regionVisible(node, section = false) {
    if (!node?.isConnected || doc.visibilityState === 'hidden' || node.closest('[hidden],[inert]')) return false;
    const css = browser.getComputedStyle(node);
    if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
    const r = node.getBoundingClientRect();
    const h = section ? Math.min(r.height,160) : r.height;
    if (r.width <= 0 || h <= 0) return false;
    const left = Math.max(0,r.left), top = Math.max(0,r.top);
    const right = Math.min(browser.innerWidth,r.right), bottom = Math.min(browser.innerHeight,r.top+h);
    if (Math.max(0,right-left)*Math.max(0,bottom-top)/(r.width*h) < .5) return false;
    const hit = doc.elementFromPoint((left+right)/2,(top+bottom)/2);
    return !!hit && (node === hit || node.contains(hit));
  }
  function targets() {
    const result = [];
    for (const node of doc.querySelectorAll('[data-cro-section]')) {
      if (node.hasAttribute('data-cro-form')) continue;
      const marker = [...node.querySelectorAll('h1,h2')].find(el => el.getBoundingClientRect().height > 0) || node;
      result.push({node:marker,name:'section_view',key:'section:' + node.dataset.croSection,data:{section_id:node.dataset.croSection},section:true});
    }
    for (const node of doc.querySelectorAll('[data-cro-cta]')) result.push({
      node,name:'cta_view',key:'cta:' + node.dataset.croCta,
      data:{cta_id:node.dataset.croCta,section_id:node.dataset.croSectionId}
    });
    return result;
  }
  function currentStep() {
    const group = Number(doc.body.dataset.activeGroup || 0);
    return group === 2 ? 'accessories' : group === 1 ? 'format' : 'look';
  }
  function scan() {
    frame = null;browser.clearTimeout(timer);timer = null;
    const active = tracker.enabled();
    if (!active) {
      dwell.clear();
      if (enabledBefore) tracker.forget();
      enabledBefore = false; return;
    }
    enabledBefore = true;
    tracker.pageReady();
    const now = Date.now(), visible = new Map();
    for (const target of targets()) {
      if (viewed.has(target.key) || !regionVisible(target.node,target.section)) continue;
      visible.set(target.key,target);
    }
    for (const key of dwell.keys()) if (!visible.has(key)) dwell.delete(key);
    let next = Infinity;
    for (const [key,target] of visible) {
      const since = dwell.get(key) ?? now;
      dwell.set(key,since);
      if (now-since >= 1000) {
        if (tracker.emit(target.name,target.data)) viewed.add(key);
        dwell.delete(key);
      } else next = Math.min(next,1000-(now-since));
    }
    if (pageType === 'configurator') {
      const panel = doc.querySelector('.editor-panels > :not([hidden])');
      const visibleControl = panel && [...panel.querySelectorAll('h1,h2,label,input,button')].some(el => regionVisible(el));
      if (visibleControl) tracker.emit('configurator_step_view',{step_id:currentStep()});
    }
    if (inquiryForm) {
      const panel = inquiryForm.querySelector('.step-panel[data-step]:not([hidden]):not([inert])');
      const visibleControl = panel && [...panel.querySelectorAll('h3,label,input,button')].some(el => regionVisible(el));
      if (visibleControl) tracker.emit('lead_form_step_view',{form_id:'neonschild_inquiry',step_id:INQUIRY_STEPS[Number(panel.dataset.step)]});
    }
    if (Number.isFinite(next)) timer = browser.setTimeout(scan,next+20);
  }
  const schedule = () => {
    if (frame === null) frame = browser.requestAnimationFrame(() => {try {scan();} catch {}});
  };
  function refreshCta() {
    if (inquiryForm) {
      const step = Number(inquiryForm.querySelector('[data-step-button][aria-current=step]')?.dataset.stepButton);
      markCta(doc.getElementById('nt-inquiry-next'),['inquiry_next_design','inquiry_next_contact','inquiry_submit'][step],'inquiry');
    }
    const next = doc.getElementById('next-step');
    if (pageType !== 'configurator' || !next) return;
    const group = Number(doc.body.dataset.activeGroup || 0);
    if (group === 2) markCta(next,'editor_add_to_cart','editor');
    else {
      // Intermediate size/font/color controls are step navigation, not duplicate CTAs.
      delete next.dataset.croCta;delete next.dataset.croSectionId;
    }
  }
  doc.addEventListener('click',event => {
    try {
      if (!event.isTrusted) return;
      refreshCta();
      const node = event.target.closest('[data-cro-cta]');
      if (node && !node.disabled && !node.closest('[inert]')) {
        const data = {cta_id:node.dataset.croCta,section_id:node.dataset.croSectionId,product:node.dataset.croProduct};
        tracker.emit('cta_view',{...data,exposure_method:'interaction'});
        tracker.emit('cta_click',data);
        if (data.cta_id.endsWith('_request') || data.cta_id === 'cart_quote') tracker.rememberOrigin(data.section_id,data.cta_id);
        if (node.matches('a[href]')) node.href = tracker.inquiryUrl(node.href);
      }
      if (wizard && event.target.closest('[data-product],[data-design]')) tracker.startForm(wizard);
      browser.requestAnimationFrame(() => {refreshCta();schedule();});
    } catch {}
  },true);
  for (const name of ['input','change']) doc.addEventListener(name,event => {
    if (event.isTrusted) tracker.startForm(event.target.closest('[data-cro-form]'));
  },true);
  doc.addEventListener('submit',event => {
    if (event.isTrusted && event.target.checkValidity?.()) tracker.startForm(event.target);
  },true);
  for (const name of ['scroll','resize']) browser.addEventListener(name,schedule,{passive:true});
  for (const name of ['CookiebotOnAccept','CookiebotOnDecline','CookiebotOnConsentReady']) browser.addEventListener(name,schedule);
  doc.addEventListener('visibilitychange',schedule);
  // Observe only visibility-affecting containers; never the expensive SVG renderer.
  if (browser.MutationObserver) {
    const observer = new browser.MutationObserver(() => {refreshCta();schedule();});
    for (const node of [doc.body,...doc.querySelectorAll('dialog,.editor-panels > *'),...(inquiryForm?.querySelectorAll('.step-panel,[data-step-button]') || [])]) {
      observer.observe(node,{attributes:true,attributeFilter:['data-active-group','hidden','open','inert','aria-current']});
    }
    const expressWidget = neonschild && doc.querySelector('#express [data-widget]');
    if (expressWidget) observer.observe(expressWidget,{childList:true,attributes:true,attributeFilter:['hidden']});
  }
  refreshCta();schedule();
  return tracker;
}
if (typeof window !== 'undefined') {
  const start = () => {try {initCroPage(window);} catch {}};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
}
