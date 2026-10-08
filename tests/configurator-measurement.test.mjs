import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../deploy/configurator/index.html',import.meta.url),'utf8');
const code=html.match(/<script id="neontrip-google-measurement">([\s\S]*?)<\/script>/)[1];
function run(hostname='anfrage.neontrip.de',consent){
 const listeners={},scripts=[],window={addEventListener:(event,handler)=>listeners[event]=handler};
 if(consent)window.Cookiebot={consent};
 const document={createElement:()=>({dataset:{}}),head:{append:script=>scripts.push(script)}};
 vm.runInNewContext(code,{window,document,location:{hostname,origin:'https://'+hostname,pathname:'/configurator/',search:'?gclid=example&text=Private',hash:'#design-private'},Date,URLSearchParams});
 return {window,listeners,scripts,events:()=>Array.from(window.dataLayer||[],entry=>Array.from(entry))};
}
test('local and preview checks emit nothing and load no measurement scripts',()=>{
 for(const host of ['127.0.0.1','localhost','preview.pages.dev']){const r=run(host);assert.equal(r.events().length,0);assert.equal(r.scripts.length,0);}
});
test('consent defaults denied before Google configuration; no fake purchase or checkout event',()=>{
 const r=run(),events=r.events();assert.equal(events[0][0],'consent');assert.equal(events[0][1],'default');
 for(const name of ['ad_storage','ad_user_data','ad_personalization','analytics_storage'])assert.equal(events[0][2][name],'denied');
 assert.equal(events.filter(e=>e[0]==='config').length,2);assert.equal(events.filter(e=>e[0]==='event').length,0);
 assert.equal(r.scripts.filter(s=>s.id==='Cookiebot').length,1);
 for(const event of events.filter(e=>e[0]==='config'))assert.equal(event[2].page_location,'https://anfrage.neontrip.de/configurator/?gclid=example');
});
test('Cookiebot consent, selective consent and withdrawal update all Google consent signals',()=>{
 const r=run('anfrage.neontrip.de',{statistics:true,marketing:false});
 let latest=r.events().filter(e=>e[1]==='update').at(-1)[2];
 assert.equal(latest.analytics_storage,'granted');assert.equal(latest.ad_storage,'denied');
 r.window.Cookiebot.consent={statistics:true,marketing:true};r.listeners.CookiebotOnAccept();
 latest=r.events().at(-1)[2];for(const key of Object.keys(latest))assert.equal(latest[key],'granted');
 r.window.Cookiebot.consent={statistics:false,marketing:false};r.listeners.CookiebotOnDecline();
 latest=r.events().at(-1)[2];for(const key of Object.keys(latest))assert.equal(latest[key],'denied');
 assert.equal(r.scripts.some(s=>s.id==='Cookiebot'),false);
});
