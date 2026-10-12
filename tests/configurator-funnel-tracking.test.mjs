import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfiguratorTracker} from '../deploy/configurator/funnel-tracking.js';

function fixture(){
 const google=[],clarity=[];
 const browser={location:{hostname:'anfrage.neontrip.de',hash:''},Cookiebot:{hasResponse:true,consent:{statistics:true,marketing:false}},gtag:(...args)=>google.push(args),clarity:(...args)=>clarity.push(args)};
 return {browser,google,clarity,track:createConfiguratorTracker(browser)};
}
test('explicit analytics consent is required; denial is not replayed after consent',()=>{
 const r=fixture();r.browser.Cookiebot.consent.statistics=false;
 assert.equal(r.track('add_to_cart'),false);assert.equal(r.google.length,0);assert.equal(r.clarity.length,0);
 r.browser.Cookiebot.consent.statistics=true;assert.equal(r.google.length,0);
 assert.equal(r.track('add_to_cart'),true);
 r.browser.Cookiebot.hasResponse=false;assert.equal(r.track('begin_checkout'),false);
 delete r.browser.Cookiebot;assert.equal(r.track('configurator_engaged'),false);
});
test('local, preview and shared-design pages cannot emit funnel events',()=>{
 for(const hostname of ['localhost','127.0.0.1','preview.pages.dev']){
  const r=fixture();r.browser.location.hostname=hostname;assert.equal(r.track('begin_checkout'),false);
 }
 const r=fixture();r.browser.location.hash='#design=private';assert.equal(r.track('begin_checkout'),false);
});
test('only allowlisted funnel events go to GA4 and Clarity; no purchase or revenue',()=>{
 const r=fixture();assert.equal(r.track('purchase'),false);assert.equal(r.track('conversion'),false);
 assert.equal(r.track('add_to_cart',{quantity:2,key:'private-cart-id',value:189,text:'PRIVATE TEXT',checkoutUrl:'PRIVATE URL'}),true);
 assert.deepEqual(r.google,[['event','add_to_cart',{send_to:'G-NEEVFC08VX',page_type:'configurator',items:[{item_id:'neontrip-led-text',item_name:'LED-Neon-Schriftzug',quantity:2}]}]]);
 assert.deepEqual(r.clarity,[['event','add_to_cart']]);
 assert.equal(JSON.stringify(r.google).includes('PRIVATE'),false);
});
test('duplicate clicks deduplicate, distinct added items remain measurable',()=>{
 const r=fixture();
 assert.equal(r.track('add_to_cart',{key:'a'}),true);assert.equal(r.track('add_to_cart',{key:'a'}),false);
 assert.equal(r.track('add_to_cart',{key:'b'}),true);
 assert.equal(r.track('begin_checkout'),true);assert.equal(r.track('begin_checkout'),false);
 assert.equal(r.track('configurator_checkout_ready',{key:'receipt-a'}),true);assert.equal(r.track('configurator_checkout_ready',{key:'receipt-a'}),false);
 assert.equal(r.google.length,4);
});
test('invalid quantity and blocked analytics never throw into the purchase flow',()=>{
 const r=fixture();for(const quantity of [0,-1,NaN,1.5])assert.equal(r.track('add_to_cart',{quantity}),false);
 r.browser.gtag=()=>{throw new Error('blocked');};r.browser.clarity=()=>{throw new Error('blocked');};
 assert.equal(r.track('begin_checkout'),false);
 delete r.browser.gtag;delete r.browser.clarity;assert.equal(r.track('begin_checkout'),false);
 r.browser.gtag=(...args)=>r.google.push(args);assert.equal(r.track('begin_checkout'),true);
 assert.equal(r.google.length,1);
});
