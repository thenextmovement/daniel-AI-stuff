// NEONTRIP CRO v1. Only bounded metadata, explicit statistics consent and production.
// The browser argument is injectable for offline tests; no runtime preview bypass.
export const CRO_VERSION = 'cro_v1';
export const SECTIONS = new Set('hero projects events products benefits reviews testimonials_mobile faq references contact header footer gallery editor cart how_it_works ar budget brands mounting express final_cta other_signs customer_photos form inquiry instagram'.split(' '));
export const CTAS = new Set('header_request footer_request products_request benefits_request faq_request references_request contact_request gallery_request hero_request sticky_request editor_add_to_cart review_add_to_cart sticky_add_to_cart cart_checkout cart_quote final_configure editor_next_format editor_next_accessories hero_express_request process_request express_request inquiry_next_design inquiry_next_contact inquiry_submit inquiry_back inquiry_step_location inquiry_step_design inquiry_step_contact contact_submit product_front_request product_halo_request product_lightbox_request product_blade_request'.split(' '));
export const FORMS = new Set('hero_mobile hero_desktop contact quick_request multi_step configurator_quote inquiry_wizard neonschild_inquiry neonschild_contact'.split(' '));
export const INQUIRY_STEPS = ['location','design','contact'];
const STEPS = new Set(['look','format','accessories']);
const FEATURES = {budget:['started','results','empty','applied','error'],save:['started','saved','error'],compare:['opened','error'],ar:['requested','ready','launch_requested','error']};
const STAGES = new Set(['calculation','checkout','quote','form','save','budget','ar','compare','font_catalog','font_upload','size','options','cart']);
// Fixed categories only: never text, filenames, upload IDs or raw exception messages.
const CHOICES = {
  font_source:['bundled','catalog','uploaded'],
  color:'warm_white white lemon_yellow golden_yellow orange light_red red pink cotton_candy deep_pink purple deep_blue electric_blue ice_blue mint green deep_green'.split(' '),
  light_mode:['static','rgb'],usage:['indoor','outdoor'],
  backing:['contour','rectangle','square','freestanding'],
  finish:['clear','solid','uv-print','mirror-gold','mirror-silver'],
  size:['width','height'],font_library:['neon','free','upload'],
  accessory:['wall-mount','premium-white','dimmer','hanging-kit','adhesive-kit','table-stand','extraCable2m'],
  delivery:['standard','express']
};
const CODES = new Set(['network','persistence_unconfirmed','storage','validation','unavailable']);
const COMMERCE = new Set(['add_to_cart','begin_checkout']);
const FUNNEL = new Set(['configurator_engaged','add_to_cart','configurator_delivery_opened','begin_checkout','configurator_checkout_ready']);
const LANDINGS = new Set(['/','/leuchtreklame','/neon-schilder','/leuchtbuchstaben','/firmenschilder','/logo','/led-schriftzuege','/firmenlogo-beleuchtet','/neonschild/anfrage']);
const CONFIGURATORS = new Set(['/configurator',...['cafe-kaffee','empfang-bewegraum','hochzeit-forever-together','studio-im-gespraech','wunschname-emma','zuhause-stay-golden'].flatMap(slug => ['/configurator/neon-' + slug, '/configurator/neon-' + slug + '.html'])]);
const ORIGIN_KEY = 'nt_cro_origin_v1', LEADS_KEY = 'nt_cro_leads_v1';
const TTL = 30 * 60 * 1000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function croPath(path = '/') {
  const normalized = path.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/';
  return normalized === '/neonschild/anfrage.html' ? '/neonschild/anfrage' : normalized;
}
export function croPageType(path) {
  const p = croPath(path);
  if (p === '/anfrage' || p === '/anfrage.html') return 'form';
  if (CONFIGURATORS.has(p)) return 'configurator';
  return LANDINGS.has(p) ? 'landing' : null;
}
function safe(fn, fallback = false) {
  return (...args) => { try { return fn(...args); } catch { return fallback; } };
}
export function createCroTracker(browser = globalThis, pageType = croPageType(browser.location?.pathname)) {
  let step = null, inquiryStep = null, ready = false, pending = null;
  let forms = new WeakMap();
  const sent = new Set(), leads = new Set();
  const enabled = () => ['landing','form','configurator'].includes(pageType) &&
    browser.location?.hostname === 'anfrage.neontrip.de' &&
    !(pageType === 'configurator' && (browser.location.hash || '').startsWith('#design=')) &&
    browser.Cookiebot?.hasResponse === true && browser.Cookiebot.consent?.statistics === true;
  const layout = () => browser.matchMedia?.('(max-width:760px)').matches ? 'mobile_compact' : 'desktop_grouped';
  const currentPath = () => croPath(browser.location?.pathname);
  function read(key) { try { return JSON.parse(browser.sessionStorage?.getItem(key) || 'null'); } catch { return null; } }
  function write(key, value) { try { browser.sessionStorage?.setItem(key, JSON.stringify(value)); } catch {} }
  function cleanOrigin(value) {
    if (!value || !Number.isFinite(value.at) || Date.now() - value.at > TTL || Date.now() < value.at) return null;
    if (!croPageType(value.origin_page_path) || !SECTIONS.has(value.origin_section_id) ||
        !(CTAS.has(value.origin_cta_id) || value.origin_cta_id === 'none')) return null;
    return {origin_page_path:croPath(value.origin_page_path),origin_section_id:value.origin_section_id,origin_cta_id:value.origin_cta_id,at:value.at};
  }
  function context(form) {
    if (forms.has(form)) return forms.get(form);
    const inherited = pageType === 'form' ? cleanOrigin(read(ORIGIN_KEY)) : null;
    const value = cleanOrigin(pending) || inherited || {
      origin_page_path:currentPath(), origin_section_id:SECTIONS.has(form?.dataset?.croSection) ? form.dataset.croSection : (pageType === 'configurator' ? 'cart' : 'form'),
      origin_cta_id:'none',at:Date.now()
    };
    return {...value,form_id:form?.dataset?.croForm};
  }
  function deliver(name, params, clarityName) {
    if (!enabled()) return false;
    const payload = {send_to:'G-NEEVFC08VX',page_type:pageType,measurement_version:CRO_VERSION,ui_layout:layout(),...params};
    let measured = false;
    try { if (typeof browser.gtag === 'function') { browser.gtag('event',name,payload); measured = true; } } catch {}
    try {
      // Cookiebot may release the Clarity bootstrap after this module. Reuse its
      // standard queue so consented initial events/tags survive that load order.
      browser.clarity = browser.clarity || function() { (browser.clarity.q = browser.clarity.q || []).push(arguments); };
      if (typeof browser.clarity === 'function') { browser.clarity('event',clarityName || name); measured = true; }
    } catch {}
    return measured;
  }
  function importOrigin() {
    if (pageType !== 'form' || !enabled() || !browser.location.hash?.startsWith('#nt_cro=')) return;
    try {
      const origin = cleanOrigin(JSON.parse(decodeURIComponent(browser.location.hash.slice(8))));
      if (origin) {pending = origin;write(ORIGIN_KEY,origin);}
      // Fragment metadata never enters the request URL and is removed after consent.
      browser.history?.replaceState(browser.history.state,'',browser.location.pathname + (browser.location.search || ''));
    } catch {}
  }
  function inquiryUrl(raw) {
    try {
      const url = new URL(raw,browser.location.href);
      if (url.origin !== browser.location.origin || !/^\/anfrage(?:\.html)?\/?$/.test(url.pathname) || (url.hash && !url.hash.startsWith('#nt_cro='))) return raw;
      if (url.hash.startsWith('#nt_cro=')) url.hash = '';
      if (!enabled()) return url.href;
      const origin = cleanOrigin(pending);
      if (!origin) return url.href;
      url.hash = 'nt_cro=' + encodeURIComponent(JSON.stringify(origin));
      return url.href;
    } catch {return raw;}
  }
  function pageReady() {
    if (!enabled() || browser.document?.visibilityState === 'hidden' || ready) return false;
    importOrigin();
    if (!deliver('cro_page_ready',{},'nt_' + (pageType === 'form' ? 'form' : pageType) + '_ready')) return false;
    ready = true;
    try {
      browser.clarity?.('set','measurement_version',CRO_VERSION);
      browser.clarity?.('set','page_type',pageType);
      browser.clarity?.('set','ui_layout',layout());
    } catch {}
    return true;
  }
  function formEvent(formId,outcome) {
    // Keep the existing cross-page funnel, plus separate the two forms on this page.
    const prefix = {neonschild_inquiry:'nt_inquiry',neonschild_contact:'nt_contact'}[formId];
    try { if (prefix) browser.clarity?.('event',prefix + '_' + outcome); } catch {}
  }
  function emit(name, data = {}, key) {
    if (!enabled()) return false;
    if (FUNNEL.has(name)) {
      const dedup = name + ':' + (key ?? name);
      if (sent.has(dedup)) return false;
      const payload = {};
      if (COMMERCE.has(name)) {
        const quantity = data.quantity ?? 1;
        if (!Number.isInteger(quantity) || quantity < 1) return false;
        payload.items = [{item_id:'neontrip-led-text',item_name:'LED-Neon-Schriftzug',quantity}];
      }
      if (!deliver(name,payload)) return false;
      sent.add(dedup);return true;
    }
    if (name === 'section_view' || name === 'cta_view' || name === 'cta_click') {
      if (!SECTIONS.has(data.section_id)) return false;
      const isCta = name !== 'section_view';
      if (isCta && !CTAS.has(data.cta_id)) return false;
      const dedup = name + ':' + (isCta ? data.cta_id : data.section_id);
      if (name !== 'cta_click' && sent.has(dedup)) return false;
      const params = {section_id:data.section_id};
      if (isCta) params.cta_id = data.cta_id;
      if (name !== 'cta_click') params.exposure_method = data.exposure_method === 'interaction' ? 'interaction' : 'visibility';
      // Preserve the old popup label without accepting arbitrary button text.
      if (name === 'cta_click' && ['home','neon-schilder','leuchtreklame','leuchtbuchstaben','firmenschilder','logo','led-schriftzuege','firmenlogo-beleuchtet'].includes(data.product)) {
        Object.assign(params,{event_category:'engagement',event_label:'anfrage_' + data.product,value:50});
      }
      const clarityName = name === 'section_view' ? 'nt_section_' + data.section_id : 'nt_' + name + '_' + data.cta_id;
      if (!deliver(name,params,clarityName)) return false;
      if (name !== 'cta_click') sent.add(dedup);
      return true;
    }
    if (name === 'configurator_choice') {
      if (pageType !== 'configurator' || !CHOICES[data.choice_id]?.includes(data.choice_value)) return false;
      const params = {choice_id:data.choice_id,choice_value:data.choice_value};
      if (!deliver(name,params,'nt_choice_' + data.choice_id)) return false;
      try { browser.clarity?.('set','config_' + data.choice_id,data.choice_value); } catch {}
      return true;
    }
    if (name === 'configurator_step_view') {
      if (!STEPS.has(data.step_id) || step === data.step_id) return false;
      const previous = step || 'none';
      if (!deliver(name,{step_id:data.step_id,from_step:previous},'nt_step_' + data.step_id)) return false;
      step = data.step_id; return true;
    }
    if (name === 'lead_form_step_view') {
      if (currentPath() !== '/neonschild/anfrage' || data.form_id !== 'neonschild_inquiry' ||
          !INQUIRY_STEPS.includes(data.step_id) || inquiryStep === data.step_id) return false;
      if (!deliver(name,{form_id:data.form_id,step_id:data.step_id,from_step:inquiryStep || 'none'},'nt_inquiry_step_' + data.step_id)) return false;
      inquiryStep = data.step_id; return true;
    }
    if (name === 'configurator_feature') {
      if (!FEATURES[data.feature_id]?.includes(data.feature_outcome)) return false;
      const dedup = key ? name + ':' + data.feature_id + ':' + data.feature_outcome + ':' + key : null;
      if (dedup && sent.has(dedup)) return false;
      const result = deliver(name,{feature_id:data.feature_id,feature_outcome:data.feature_outcome},'nt_' + data.feature_id + '_' + data.feature_outcome);
      if (result && dedup) sent.add(dedup);
      return result;
    }
    if (name === 'journey_error') {
      if (!STAGES.has(data.error_stage) || !CODES.has(data.error_code)) return false;
      const dedup = key ? name + ':' + data.error_stage + ':' + data.error_code + ':' + key : null;
      if (dedup && sent.has(dedup)) return false;
      const result = deliver(name,{error_stage:data.error_stage,error_code:data.error_code,...(STEPS.has(data.step_id) ? {step_id:data.step_id} : {})},'nt_' + data.error_stage + '_error');
      if (result) try {browser.clarity?.('set','error_stage',data.error_stage);browser.clarity?.('set','error_code',data.error_code);} catch {}
      if (result && dedup) sent.add(dedup);
      return result;
    }
    return false;
  }
  function startForm(form) {
    if (!enabled() || !FORMS.has(form?.dataset?.croForm) || forms.has(form)) return false;
    importOrigin();
    const value = context(form);
    const {at,...params} = value;
    if (!deliver('lead_form_start',params,value.form_id === 'configurator_quote' ? 'nt_quote_form_started' : 'nt_lead_form_started')) return false;
    formEvent(value.form_id,'form_started');
    forms.set(form,value);pending = null;
    return true;
  }
  function lead(form, receipt) {
    if (!enabled() || !FORMS.has(form?.dataset?.croForm) || receipt?.alreadyConfirmed) return false;
    const id = receipt?.submit_id || receipt?.client_submit_id || receipt?.lead_request_id;
    if (!UUID.test(id || '')) return false;
    const stored = read(LEADS_KEY);
    if (leads.has(id) || (Array.isArray(stored) && stored.includes(id))) return false;
    const confirmed = receipt.ok === true && receipt.accepted === true && receipt.persisted === true &&
      receipt.contact_saved === true && receipt.lead_request_id === id &&
      UUID.test(receipt.request_row_id || '') && UUID.test(receipt.customer_id || '');
    const status = confirmed ? (receipt.recovery === true ? 'contact_only' : 'confirmed') : null;
    if (!status) return false;
    const {at,...origin} = context(form);
    const outcome = status === 'confirmed' ? (origin.form_id === 'configurator_quote' ? 'nt_quote_confirmed' : 'nt_lead_confirmed') : 'nt_contact_only';
    if (!deliver('generate_lead',{currency:'EUR',value:280,...origin,lead_status:status},outcome)) return false;
    formEvent(origin.form_id,status);
    leads.add(id);
    write(LEADS_KEY,[...new Set([...(Array.isArray(stored) ? stored.filter(v => UUID.test(v)) : []),id])].slice(-100));
    forms.delete(form);pending = null;
    try { browser.sessionStorage?.removeItem(ORIGIN_KEY); } catch {}
    return true;
  }
  return {
    enabled:safe(enabled), inquiryUrl, pageReady:safe(pageReady), emit:safe(emit), startForm:safe(startForm), lead:safe(lead),
    rememberOrigin:safe((sectionId,ctaId) => {
      if (!enabled() || !SECTIONS.has(sectionId) || !CTAS.has(ctaId)) return false;
      pending = {origin_page_path:currentPath(),origin_section_id:sectionId,origin_cta_id:ctaId,at:Date.now()};
      write(ORIGIN_KEY,pending); return true;
    }),
    forget:safe(() => {
      pending = null; forms = new WeakMap(); step = null; inquiryStep = null;
      try { browser.sessionStorage?.removeItem(ORIGIN_KEY);browser.sessionStorage?.removeItem(LEADS_KEY); } catch {}
    }),
    choice:safe((id,value) => emit('configurator_choice',{choice_id:id,choice_value:value})),
    feature:safe((id,outcome,key) => emit('configurator_feature',{feature_id:id,feature_outcome:outcome},key)),
    error:safe((stage,error,key) => {
      const code = error?.code === 'validation' ? 'validation' : /persist|receipt/i.test(error?.code || '') ? 'persistence_unconfirmed' :
        /network|fetch/i.test(error?.code || '') || error?.name === 'TypeError' ? 'network' :
        /storage/i.test(error?.code || '') || stage === 'save' ? 'storage' : 'unavailable';
      return emit('journey_error',{error_stage:stage,error_code:code},key);
    })
  };
}
