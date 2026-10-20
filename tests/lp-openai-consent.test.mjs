import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
const root=new URL('../deploy/',import.meta.url);
const source=readFileSync(new URL('assets/js/nt-openai-ads.js',root),'utf8');
const id='b63f4598-65cb-4c6d-a676-29805c809880';
const receipt={ok:true,accepted:true,persisted:true,contact_saved:true,client_submit_id:id,lead_request_id:id,request_row_id:id,customer_id:id};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function run(consent,options={}){
 const events=new Map(),scripts=[],commands=[],cookies=[];
 const stored=options.stored||new Map();
 const storage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
 const document={readyState:'complete',head:{appendChild:s=>scripts.push(s)},createElement:()=>({dataset:{},remove(){}}),addEventListener:(n,f)=>events.set('document:'+n,f),querySelectorAll:()=>[]};
 Object.defineProperty(document,'cookie',{set:value=>cookies.push(value),get:()=>''});
 const window={Cookiebot:consent,location:new URL(options.url||'https://anfrage.neontrip.de/configurator/'),document,sessionStorage:storage,localStorage:storage,crypto:options.crypto,addEventListener:(n,f)=>events.set(n,f)};
 window.window=window;
 const context=vm.createContext({...window,window,document,URL,Map,Set,TextEncoder,Uint8Array});
 vm.runInContext(source,context);
 return {window,scripts,commands,cookies,stored,api:window.ntOpenAiAds,emit(n){events.get(n)?.();},load(){window.oaiq=(...args)=>commands.push(args);scripts[0].onload();},rerun(){vm.runInContext(source,context)},measures(){return commands.filter(c=>c[0]==='measure')},click(href){const link={href,getAttribute:()=>href};events.get('document:click')({target:{closest:()=>link}});return link.href;}};
}
const grant=()=>({hasResponse:true,consent:{marketing:true}});
const deny=()=>({hasResponse:true,consent:{marketing:false}});
test('unknown/restoring selection loads nothing and never deletes an existing click cookie',()=>{
 const s=run({hasResponse:false,consent:{marketing:false}});s.emit('CookiebotOnConsentReady');assert.equal(s.scripts.length,0);assert.equal(s.cookies.length,0);
 s.window.Cookiebot=grant();s.emit('CookiebotOnConsentReady');s.load();assert.equal(s.commands[0][0],'consent');assert.equal(s.commands[0][1],true);assert.equal(s.commands.some(c=>c[0]==='consent'&&c[1]===false),false);
});
test('persisted rejection loads no SDK, sends no events and clears old reference cookies',()=>{const s=run(deny());assert.equal(s.scripts.length,0);assert.equal(s.api.lead(id),false);assert.ok(s.cookies.some(c=>c.startsWith('__oppref=')));});
test('grant initializes exactly once despite duplicate script/event execution',()=>{const s=run(grant());s.rerun();s.load();s.emit('CookiebotOnAccept');s.emit('CookiebotOnConsentReady');assert.equal(s.scripts.length,1);assert.equal(s.commands.filter(c=>c[0]==='init'&&c[1].pixelId).length,1);assert.equal(s.commands[1][1].pixelId,'6GqgnrdSPjJSGdthY89B9Y');});
test('confirmed success before delayed SDK load is retained and emits one lead',()=>{const s=run(grant());assert.equal(s.api.confirmedLead(receipt),true);s.api.confirmedLead(receipt);assert.equal(s.measures().length,0);s.load();assert.equal(s.measures().length,1);assert.equal(s.measures()[0][3].event_id,id);});
test('withdrawal during delayed SDK load cancels pending leads permanently',()=>{const s=run(grant());s.api.confirmedLead(receipt);s.window.Cookiebot=deny();s.emit('CookiebotOnDecline');s.load();assert.equal(s.measures().length,0);s.window.Cookiebot=grant();s.emit('CookiebotOnAccept');assert.equal(s.measures().length,0);});
test('loaded SDK is immediately revoked, including withdrawn hasResponse',()=>{const s=run(grant());s.load();s.window.Cookiebot.hasResponse=false;s.emit('CookiebotOnConsentReady');assert.equal(s.commands.at(-1)[0],'consent');assert.equal(s.commands.at(-1)[1],false);assert.equal(s.api.confirmedLead(receipt),false);});
test('unconsented success is never replayed after grant',()=>{const s=run(deny());s.api.confirmedLead(receipt);s.window.Cookiebot=grant();s.emit('CookiebotOnAccept');s.load();assert.equal(s.measures().length,0);});
test('confirmed receipt must match all persistence fields; drafts/carts/clicks do not count',()=>{const s=run(grant());s.load();for(const field of ['ok','accepted','persisted','contact_saved','request_row_id','customer_id','client_submit_id','lead_request_id'])assert.equal(s.api.confirmedLead({...receipt,[field]:false}),false,field);for(const r of [null,{}, {ok:true,saved:true},{ok:true,sent:true},{...receipt,alreadyConfirmed:true}])assert.equal(s.api.confirmedLead(r),false);assert.equal(s.measures().length,0);});
test('same receipt deduplicates through repeated handlers and reload',()=>{const s=run(grant());s.load();s.api.confirmedLead(receipt);s.api.lead(id);assert.equal(s.measures().length,1);const reload=run(grant(),{stored:s.stored});reload.load();assert.equal(reload.api.lead(id),false);assert.equal(reload.measures().length,0);});
test('withdrawal while hashing prevents both matching data and lead dispatch',async()=>{let resolve;const crypto={subtle:{digest:()=>new Promise(r=>resolve=r)}};const s=run(grant(),{crypto});s.load();s.api.lead(id,'test@example.invalid');s.window.Cookiebot=deny();s.emit('CookiebotOnDecline');resolve(new Uint8Array(32).buffer);await tick();assert.equal(s.measures().length,0);assert.equal(s.commands.some(c=>c[0]==='init'&&c[1].user),false);});
test('matching data uses normalized SHA-256 only',async()=>{const s=run(grant(),{crypto:webcrypto});s.load();s.api.lead(id,' TEST@EXAMPLE.INVALID ');for(let i=0;i<20&&!s.measures().length;i++)await tick();assert.equal(s.measures().length,1);const user=s.commands.find(c=>c[0]==='init'&&c[1].user);assert.match(user[1].user.email_sha256,/^[0-9a-f]{64}$/);assert.ok(!JSON.stringify(s.commands).includes('EXAMPLE'));});
test('SDK failure cannot throw into form success',()=>{const s=run(grant());assert.doesNotThrow(()=>{s.api.confirmedLead(receipt);s.scripts[0].onerror();});assert.equal(s.measures().length,0);});
test('preview hosts cannot emit production events',()=>{for(const url of ['http://localhost:8768/','https://preview.neontrip-lp.pages.dev/']){const s=run(grant(),{url});assert.equal(s.scripts.length,0);assert.equal(s.api.lead(id),false);}});
test('reference forwarding preserves an incoming opaque value without inventing one',()=>{
 // Isolated URL fixture only: no requests are sent with this value.
 const s=run(undefined,{url:'https://anfrage.neontrip.de/?oppref=opaque%2Bfixture%2Funchanged'});
 assert.equal(s.click('/configurator/?utm_source=test#look'),'https://anfrage.neontrip.de/configurator/?utm_source=test&oppref=opaque%2Bfixture%2Funchanged#look');
 assert.equal(s.click('https://external.invalid/'),'https://external.invalid/');assert.equal(run(grant()).click('/configurator/'),'/configurator/');
 s.window.Cookiebot=deny();assert.equal(s.click('/configurator/'),'/configurator/');
});
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name==='_source'?[]:e.isDirectory()?walk(new URL(e.name+'/',dir)):e.name.endsWith('.html')?[new URL(e.name,dir)]:[]);}
test('all public HTML has exactly one shared loader and a Cookiebot loader',()=>{for(const file of walk(root)){const html=readFileSync(file,'utf8');assert.equal(html.split('nt-openai-ads.js').length-1,1,file.pathname);assert.ok(html.includes('consent.cookiebot.com/uc.js'),file.pathname);assert.ok(!html.includes('oaiq.min.js'),file.pathname);}});
test('configurator calls only at the existing confirmed inquiry boundary',()=>{const js=readFileSync(new URL('configurator/configurator.js',root),'utf8');assert.equal(js.split('ntOpenAiAds').length-1,1);assert.match(js,/const receipt=await quoteClient\.submit\([\s\S]+ntOpenAiAds\?\.confirmedLead\(receipt/);});
