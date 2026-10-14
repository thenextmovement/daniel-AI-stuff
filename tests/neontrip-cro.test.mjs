import test from 'node:test';
import assert from 'node:assert/strict';
import {createCroTracker,croPageType,croPath} from '../deploy/js/nt-cro.js';
import {readFile} from 'node:fs/promises';

const id = '00000000-0000-4000-8000-000000000001';
function fixture(pathname='/neon-schilder/') {
  const google=[],clarity=[],store=new Map(),storageCalls=[];
  const browser={
    location:{hostname:'anfrage.neontrip.de',origin:'https://anfrage.neontrip.de',href:'https://anfrage.neontrip.de'+pathname,pathname,hash:''},
    document:{visibilityState:'visible'},
    Cookiebot:{hasResponse:true,consent:{statistics:true,marketing:false}},
    matchMedia:()=>({matches:false}),
    gtag:(...args)=>google.push(args),clarity:(...args)=>clarity.push(args),
    sessionStorage:{
      getItem:k=>{storageCalls.push(['read',k]);return store.get(k) || null;},
      setItem:(k,v)=>{storageCalls.push(['write',k]);store.set(k,v);},
      removeItem:k=>store.delete(k)
    }
  };
  return {browser,google,clarity,store,storageCalls,track:createCroTracker(browser)};
}
const form=(type='hero_desktop')=>({dataset:{croForm:type,croSection:'hero'}});
const receipt=(overrides={})=>({ok:true,accepted:true,persisted:true,contact_saved:true,submit_id:id,lead_request_id:id,request_row_id:id,customer_id:id,...overrides});
const events=r=>r.google.map(v=>v[1]);
test('production and page scope are explicit; no preview, shared-design or other-brand tracking',()=>{
  assert.equal(croPageType('/en/'),null);assert.equal(croPageType('/configurator/neon-private-name.html'),null);assert.equal(croPageType('/leuchtkaesten/'),null);
  assert.equal(croPageType('/configurator/neon-cafe-kaffee.html'),'configurator');
  for (const host of ['localhost','127.0.0.1','neontrip.de','example.pages.dev']) {
    const r=fixture();r.browser.location.hostname=host;
    assert.equal(r.track.pageReady(),false);assert.equal(r.google.length,0);
  }
  const r=fixture('/configurator/');r.browser.location.hash='#design=PRIVATE';
  assert.equal(r.track.pageReady(),false);
});
test('consent gates events and storage; past clicks are not replayed',()=>{
  const r=fixture();r.browser.Cookiebot.consent.statistics=false;
  r.track.pageReady();r.track.rememberOrigin('benefits','benefits_request');
  r.track.startForm(form());r.track.lead(form(),receipt());
  assert.equal(r.google.length,0);assert.equal(r.storageCalls.length,0);
  r.browser.Cookiebot.consent.statistics=true;r.track.pageReady();
  assert.deepEqual(events(r),['cro_page_ready']);
  r.browser.Cookiebot.hasResponse=false;assert.equal(r.track.startForm(form()),false);
});
test('page readiness waits for visibility and is once per document',()=>{
  const r=fixture();r.browser.document.visibilityState='hidden';assert.equal(r.track.pageReady(),false);
  r.browser.document.visibilityState='visible';assert.equal(r.track.pageReady(),true);
  assert.equal(r.track.pageReady(),false);
});
test('consented initial events survive Clarity loading after the CRO module',()=>{
  const r=fixture();delete r.browser.clarity;
  r.browser.Cookiebot.consent.statistics=false;
  r.track.pageReady();assert.equal(r.browser.clarity,undefined);
  r.browser.Cookiebot.consent.statistics=true;
  r.track.pageReady();r.track.pageReady();
  assert.equal(typeof r.browser.clarity,'function');
  const queued=r.browser.clarity.q.map(args=>Array.from(args));
  assert.deepEqual(queued,[['event','nt_landing_ready'],['set','measurement_version','cro_v1'],['set','page_type','landing'],['set','ui_layout','desktop_grouped']]);
  assert.deepEqual(events(r),['cro_page_ready']);
  // The existing consent-controlled bootstrap reuses this standard Clarity queue.
  const original=r.browser.clarity;
  r.browser.clarity=r.browser.clarity||function(){};
  assert.equal(r.browser.clarity,original);
});
test('view uniqueness differs from intentional repeated clicks',()=>{
  const r=fixture(),data={section_id:'benefits',cta_id:'benefits_request'};
  assert.equal(r.track.emit('section_view',data),true);assert.equal(r.track.emit('section_view',data),false);
  assert.equal(r.track.emit('cta_view',data),true);assert.equal(r.track.emit('cta_view',data),false);
  assert.equal(r.track.emit('cta_click',data),true);assert.equal(r.track.emit('cta_click',data),true);
  assert.deepEqual(events(r),['section_view','cta_view','cta_click','cta_click']);
});
test('bounded metadata excludes private content, unknown events and arbitrary IDs',()=>{
  const r=fixture('/configurator/');
  r.track.emit('purchase',{value:100});r.track.emit('cta_click',{cta_id:'PRIVATE',section_id:'editor'});
  r.track.emit('configurator_feature',{feature_id:'ar',feature_outcome:'object_placed'});
  assert.equal(r.google.length,0);
  r.track.emit('configurator_feature',{feature_id:'save',feature_outcome:'saved',text:'PRIVATE',customer:'PRIVATE',url:'PRIVATE'});
  assert.equal(JSON.stringify(r.google).includes('PRIVATE'),false);
  assert.deepEqual(r.clarity,[['event','nt_save_saved']]);
});
test('logical steps preserve backtracking and ignore duplicate rerenders',()=>{
  const r=fixture('/configurator/');
  for(const step_id of ['look','look','format','format','look','accessories'])r.track.emit('configurator_step_view',{step_id});
  assert.deepEqual(r.google.map(v=>[v[2].from_step,v[2].step_id]),[['none','look'],['look','format'],['format','look'],['look','accessories']]);
  r.browser.matchMedia=()=>({matches:true});r.track.emit('configurator_step_view',{step_id:'format'});
  assert.equal(r.google.at(-1)[2].ui_layout,'mobile_compact');
});
test('form origin freezes at first intentional start, not later CTA activity',()=>{
  const r=fixture(),f=form();
  r.track.rememberOrigin('benefits','benefits_request');
  assert.equal(r.track.startForm(f),true);assert.equal(r.track.startForm(f),false);
  r.track.rememberOrigin('faq','faq_request');
  assert.equal(r.track.lead(f,receipt()),true);
  const result=r.google.at(-1)[2];
  assert.equal(result.origin_cta_id,'benefits_request');assert.equal(result.origin_section_id,'benefits');
  assert.equal(result.lead_status,'confirmed');assert.equal(result.origin_page_path,'/neon-schilder');
  assert.equal(JSON.stringify(r.google).includes(id),false);
});
test('same-tab origin survives navigation, expires after 30 minutes and never changes advertising attribution',()=>{
  const r=fixture();r.store.set('nt_attr_gclid','PRIVATE_GCLID');r.track.rememberOrigin('benefits','benefits_request');
  r.browser.location.pathname='/anfrage';const next=createCroTracker(r.browser);next.startForm(form('inquiry_wizard'));
  assert.equal(r.google.at(-1)[2].origin_page_path,'/neon-schilder');
  const saved=JSON.parse(r.store.get('nt_cro_origin_v1'));saved.at-=31*60000;r.store.set('nt_cro_origin_v1',JSON.stringify(saved));
  const later=createCroTracker(r.browser);later.startForm(form('inquiry_wizard'));
  assert.equal(r.google.at(-1)[2].origin_cta_id,'none');assert.equal(r.store.get('nt_attr_gclid'),'PRIVATE_GCLID');
  assert.equal(JSON.stringify(r.google).includes('PRIVATE_GCLID'),false);
});
test('invalid stored origins are not sent',()=>{
  const r=fixture('/anfrage');
  r.store.set('nt_cro_origin_v1',JSON.stringify({at:Date.now(),origin_page_path:'https://evil.example/private',origin_section_id:'PRIVATE',origin_cta_id:'PRIVATE'}));
  r.track.startForm(form('inquiry_wizard'));
  assert.equal(r.google.at(-1)[2].origin_cta_id,'none');
  assert.equal(JSON.stringify(r.google).includes('PRIVATE'),false);
});
test('receipt validation distinguishes confirmed, contact-only and unconfirmed',()=>{
  for (const bad of [{persisted:false},{accepted:false},{contact_saved:false},{lead_request_id:'bad'},{request_row_id:'bad'},{persisted:false,recovery:true}]) {
    const r=fixture();assert.equal(r.track.lead(form(),receipt(bad)),false);assert.equal(r.google.length,0);
  }
  const r=fixture();assert.equal(r.track.lead(form(),receipt({recovery:true})),true);
  assert.equal(r.google.at(-1)[2].lead_status,'contact_only');assert.equal(r.clarity.at(-1)[1],'nt_contact_only');
});
test('duplicate callback, reload and alreadyConfirmed receipt do not count another lead',()=>{
  const r=fixture('/configurator/'),f=form('configurator_quote');
  assert.equal(r.track.lead(f,receipt()),true);assert.equal(r.track.lead(f,receipt()),false);
  assert.equal(createCroTracker(r.browser).lead(f,receipt()),false);
  const fresh=fixture('/configurator/');assert.equal(fresh.track.lead(f,receipt({alreadyConfirmed:true})),false);
  assert.equal(r.clarity.at(-1)[1],'nt_quote_confirmed');
});
test('withdrawal clears pending origin and form metadata',()=>{
  const r=fixture(),f=form();r.track.rememberOrigin('benefits','benefits_request');r.track.startForm(f);
  r.browser.Cookiebot.consent.statistics=false;r.track.forget();assert.equal(r.store.size,0);
  assert.equal(r.track.lead(f,receipt()),false);
  r.browser.Cookiebot.consent.statistics=true;r.track.startForm(f);
  assert.equal(r.google.at(-1)[2].origin_cta_id,'none');
});
test('error categories are bounded, deduplicated per attempt and contain no message',()=>{
  const r=fixture('/configurator/');
  r.track.error('checkout',{name:'TypeError',message:'PRIVATE'},'attempt1');
  r.track.error('checkout',{name:'TypeError',message:'PRIVATE'},'attempt1');
  r.track.error('checkout',{code:'receipt_unconfirmed',message:'PRIVATE'},'attempt2');
  assert.equal(r.google.length,2);assert.equal(r.google[0][2].error_code,'network');
  assert.equal(r.google[1][2].error_code,'persistence_unconfirmed');assert.equal(JSON.stringify(r.google).includes('PRIVATE'),false);
});
test('blocked analytics and storage never throw into a purchase or submission',()=>{
  const r=fixture();r.browser.gtag=()=>{throw Error('blocked');};r.browser.clarity=()=>{throw Error('blocked');};
  Object.defineProperty(r.browser,'sessionStorage',{get(){throw Error('blocked');}});
  for (const fn of [()=>r.track.pageReady(),()=>r.track.rememberOrigin('hero','hero_request'),()=>r.track.startForm(form()),()=>r.track.lead(form(),receipt()),()=>r.track.error('form',{})]) assert.doesNotThrow(fn);
  r.browser.gtag=(...args)=>r.google.push(args);
  assert.equal(r.track.lead(form(),receipt()),true);
});

test('new-tab inquiry handoff preserves campaign parameters and imports only consented bounded origin',()=>{
  const r=fixture();r.track.rememberOrigin('footer','footer_request');
  const link=r.track.inquiryUrl('/anfrage.html?produkt=neonschild&utm_source=google&gclid=TEST');
  const url=new URL(link);assert.equal(url.search,'?produkt=neonschild&utm_source=google&gclid=TEST');
  assert.equal(url.hash.startsWith('#nt_cro='),true);
  const next=fixture('/anfrage.html');next.browser.location.hash=url.hash;next.browser.location.search=url.search;
  const replaced=[];next.browser.history={state:null,replaceState:(...args)=>{replaced.push(args);next.browser.location.hash='';}};
  next.browser.Cookiebot.consent.statistics=false;assert.equal(next.track.startForm(form('inquiry_wizard')),false);assert.equal(next.store.size,0);
  next.browser.Cookiebot.consent.statistics=true;next.track.pageReady();next.track.startForm(form('inquiry_wizard'));
  assert.equal(next.google.at(-1)[2].origin_page_path,'/neon-schilder');assert.equal(next.google.at(-1)[2].origin_cta_id,'footer_request');
  assert.equal(replaced[0][2],'/anfrage.html'+url.search);
  r.track.rememberOrigin('benefits','benefits_request');assert.equal(JSON.parse(decodeURIComponent(new URL(r.track.inquiryUrl(link)).hash.slice(8))).origin_cta_id,'benefits_request');
  r.browser.Cookiebot.consent.statistics=false;assert.equal(new URL(r.track.inquiryUrl(link)).hash,'');
  assert.equal(r.track.inquiryUrl('https://other.example/anfrage.html'),'https://other.example/anfrage.html');
  assert.equal(r.track.inquiryUrl('/anfrage.html#existing'),'/anfrage.html#existing');
});
test('invalid form section metadata never escapes the bounded origin contract',()=>{
  const r=fixture(),f=form();f.dataset.croSection='PRIVATE';r.track.startForm(f);
  assert.equal(r.google.at(-1)[2].origin_section_id,'form');assert.equal(JSON.stringify(r.google).includes('PRIVATE'),false);
});

test('multiple AR failure callbacks count once per request, while explicit retry counts again',()=>{
  const r=fixture('/configurator/');
  r.track.feature('ar','error',1);r.track.feature('ar','error',1);r.track.feature('ar','error',2);
  assert.equal(r.google.length,2);assert.equal(r.google[0][2].feature_outcome,'error');
});

test('advertised landing aliases share bounded origin; unrelated routes remain excluded',()=>{
  for (const path of ['/neonschild/anfrage','/neonschild/anfrage/','/neonschild/anfrage.html']) {
    assert.equal(croPageType(path),'landing');assert.equal(croPath(path),'/neonschild/anfrage');
    const r=fixture(path);r.track.rememberOrigin('hero','hero_request');r.track.startForm(form('neonschild_inquiry'));
    assert.equal(r.google.at(-1)[2].origin_page_path,'/neonschild/anfrage');
  }
  for (const path of ['/neonschild','/neonschild/other','/neonschild/anfrage-old.html']) assert.equal(croPageType(path),null);
});

test('inquiry steps require consent and the real page; repeated renders are ignored, returns retained',()=>{
  const r=fixture('/neonschild/anfrage'),data={form_id:'neonschild_inquiry'};
  r.browser.Cookiebot.consent.statistics=false;
  assert.equal(r.track.emit('lead_form_step_view',{...data,step_id:'location'}),false);
  r.browser.Cookiebot.consent.statistics=true;
  for (const step_id of ['location','location','design','contact','design','complete','PRIVATE']) r.track.emit('lead_form_step_view',{...data,step_id,content:'PRIVATE'});
  assert.deepEqual(r.google.map(v=>[v[2].from_step,v[2].step_id]),[['none','location'],['location','design'],['design','contact'],['contact','design']]);
  assert.equal(JSON.stringify(r.google).includes('PRIVATE'),false);
  assert.equal(r.track.emit('lead_form_step_view',{form_id:'neonschild_contact',step_id:'contact'}),false);
  assert.equal(fixture().track.emit('lead_form_step_view',{...data,step_id:'location'}),false);
  assert.equal(events(r).includes('generate_lead'),false);
});

test('both new forms reuse receipt validation, frozen CTA origin and lead deduplication',()=>{
  for (const type of ['neonschild_inquiry','neonschild_contact']) {
    const r=fixture('/neonschild/anfrage.html'),f=form(type);
    r.track.rememberOrigin('express','express_request');r.track.startForm(f);r.track.startForm(f);
    r.track.rememberOrigin('faq','faq_request');
    assert.equal(r.track.lead(f,receipt({persisted:false})),false);
    assert.equal(r.track.lead(f,receipt()),true);assert.equal(r.track.lead(f,receipt()),false);
    assert.deepEqual(events(r),['lead_form_start','generate_lead']);
    assert.equal(r.google.at(-1)[2].form_id,type);
    assert.equal(r.google.at(-1)[2].origin_cta_id,'express_request');
    assert.equal(r.google.at(-1)[2].origin_page_path,'/neonschild/anfrage');
    const prefix=type==='neonschild_inquiry'?'nt_inquiry':'nt_contact';
    assert.deepEqual(r.clarity,[['event','nt_lead_form_started'],['event',prefix+'_form_started'],['event','nt_lead_confirmed'],['event',prefix+'_confirmed']]);
  }
});

test('express draft and contact recovery cannot appear as confirmed full inquiries',()=>{
  const r=fixture('/neonschild/anfrage');
  r.track.emit('cta_click',{section_id:'express',cta_id:'express_request'});
  assert.equal(r.track.startForm(form('express_draft')),false);
  assert.equal(events(r).includes('generate_lead'),false);
  r.track.lead(form('neonschild_contact'),receipt({recovery:true}));
  assert.equal(r.google.at(-1)[2].lead_status,'contact_only');
  assert.deepEqual(r.clarity.slice(-2),[['event','nt_contact_only'],['event','nt_contact_contact_only']]);
  assert.equal(JSON.stringify(r.clarity).includes('confirmed'),false);
});

test('generated advertised page includes CRO exactly once and retains the canonical receipt transport',async()=>{
  const html=await readFile(new URL('../deploy/neonschild/anfrage.html',import.meta.url),'utf8');
  assert.equal((html.match(/src="\/js\/nt-cro-page\.js\?/g)||[]).length,1);
  assert.match(html,/data-cookieconsent="ignore" src="\/js\/nt-cro-page\.js/);
  const integration=await readFile(new URL('../deploy/assets/neonschild-anfrage/20261013-v1/live-integration.js',import.meta.url),'utf8');
  assert.match(integration,/ntCro\?\.startForm/);assert.match(integration,/ntCro\?\.lead/);assert.match(integration,/ntRequirePersistedReceipt/);
  assert.match(html,/id="nt-inquiry-form"/);assert.match(html,/id="nt-classic-form"/);
});
