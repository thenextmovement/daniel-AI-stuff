import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const croSource=readFileSync(new URL('../deploy/js/nt-cro.js',import.meta.url),'utf8');
const {createCroTracker}=await import('data:text/javascript;base64,'+Buffer.from(croSource).toString('base64'));
const source=readFileSync(new URL('../deploy/configurator/configurator.js',import.meta.url),'utf8');
function setup({consent=true,hostname='anfrage.neontrip.de',hash='',path='/configurator/'}={}){
 const calls=[];
 const browser={location:{hostname,pathname:path,hash},Cookiebot:{hasResponse:true,consent:{statistics:consent}},matchMedia:()=>({matches:false}),gtag:(...args)=>calls.push(['ga4',...args]),clarity:(...args)=>calls.push(['clarity',...args])};
 return {browser,calls,tracker:createCroTracker(browser)};
}
test('accepted choice produces one event per destination and a bounded Clarity filter tag',()=>{
 const h=setup();assert.equal(h.tracker.choice('color','warm_white'),true);
 assert.deepEqual(h.calls.filter(c=>c[0]==='clarity'),[['clarity','event','nt_choice_color'],['clarity','set','config_color','warm_white']]);
 const event=h.calls.find(c=>c[0]==='ga4');assert.equal(event[2],'configurator_choice');assert.equal(event[3].choice_value,'warm_white');
});
test('customer text, filename, upload IDs and unknown choices never enter events or tags',()=>{
 const h=setup();for(const [key,value] of [['font_source','SecretCustomer.ttf'],['text','Private design'],['font_source','upload-12345'],['color','a@example.com']])assert.equal(h.tracker.choice(key,value),false);
 assert.deepEqual(h.calls,[]);
 h.tracker.emit('configurator_choice',{choice_id:'font_source',choice_value:'uploaded',text:'Private design',filename:'SecretCustomer.ttf'});
 assert.doesNotMatch(JSON.stringify(h.calls),/Private design|SecretCustomer/);
});
test('no consent, private design links, preview host and other page types reject choices',()=>{
 for(const opts of [{consent:false},{hostname:'localhost'},{hash:'#design=private'},{path:'/logo/'}]){const h=setup(opts);assert.equal(h.tracker.choice('backing','contour'),false);assert.deepEqual(h.calls,[]);}
});
test('withdrawal immediately stops choice events and tags',()=>{
 const h=setup();h.tracker.choice('usage','outdoor');h.browser.Cookiebot.consent.statistics=false;
 const count=h.calls.length;assert.equal(h.tracker.choice('usage','indoor'),false);assert.equal(h.calls.length,count);
});
test('error codes are bounded, same attempt deduplicates and raw error text is excluded',()=>{
 const h=setup();const error={code:'validation',message:'SecretCustomer.ttf failed'};
 assert.equal(h.tracker.error('font_upload',error,'attempt1'),true);assert.equal(h.tracker.error('font_upload',error,'attempt1'),false);
 assert.equal(h.calls.find(c=>c[0]==='ga4')[3].error_code,'validation');assert.ok(h.calls.some(c=>c[0]==='clarity'&&c[1]==='set'&&c[2]==='error_code'&&c[3]==='validation'));assert.doesNotMatch(JSON.stringify(h.calls),/SecretCustomer/);
 assert.equal(h.tracker.error('font_upload',error,'attempt2'),true);
});
test('existing cart and checkout funnel deduplication stays unchanged',()=>{
 const h=setup();assert.equal(h.tracker.emit('add_to_cart',{quantity:2},'item1'),true);assert.equal(h.tracker.emit('add_to_cart',{quantity:2},'item1'),false);
 assert.equal(h.tracker.emit('configurator_checkout_ready',{},'checkout1'),true);assert.equal(h.tracker.emit('configurator_checkout_ready',{},'checkout1'),false);
 assert.equal(h.calls.filter(c=>c[0]==='clarity'&&c[1]==='event').length,2);
});
test('uploaded font labels are masked before content changes and catalog labels can be visible',()=>{
 const nodes=Array.from({length:5},()=>({dataset:{clarityUnmask:'true'}}));
 const fn=source.slice(source.indexOf('function protectSelectedFont(){'),source.indexOf('// First real editor interaction'));
 const context=vm.createContext({state:{fontId:'upload-123',fontSource:null},document:{querySelectorAll:()=>nodes}});
 vm.runInContext(fn+';protectSelectedFont()',context);
 for(const n of nodes){assert.equal(n.dataset.clarityMask,'true');assert.equal(n.dataset.clarityUnmask,undefined);}
 context.state.fontId='Alexa';vm.runInContext('protectSelectedFont()',context);
 for(const n of nodes){assert.equal(n.dataset.clarityUnmask,'true');assert.equal(n.dataset.clarityMask,undefined);}
});
