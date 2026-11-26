import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Isolated component preview: all API responses are mocked. No provider or database access.
const temp=await mkdtemp(join(tmpdir(),'placetel-handoff-'));
let browser,server;
try {
 const output=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{PlacetelCallButton}from'./src/app/ops/voice-copilot/placetel-call-button';createRoot(document.getElementById('root')).render(<PlacetelCallButton customerId="test-customer" requestId="test-request" dialNumber="+493023125000" disabled={false} onCallChange={()=>{}} onNoteTarget={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:temp,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 const js=output.outputFiles.find(f=>f.path.endsWith('.js')).text;
 const css=output.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'';
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'application/javascript':'text/html');res.end(req.url==='/bundle.js'?js:`<!doctype html><style>${css}</style><div id="root"></div><script src="/bundle.js"></script>`);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true});
 for(const scenario of ['slow','fast','cancel','failure','expired']){
  const page=await browser.newPage();
  // Model browser transient activation after the asynchronous preparation.
  await page.addInitScript(active=>Object.defineProperty(navigator,'userActivation',{value:{isActive:active}}),scenario==='fast');
  const cdp=await page.context().newCDPSession(page);await cdp.send('Page.enable');
  const handoffs=[];cdp.on('Page.frameRequestedNavigation',e=>{if(e.url.startsWith('tel:'))handoffs.push(e.url)});
  let pending,requests=0;
  await page.route('**/api/ops/voice-phone/**',async route=>{
   if(route.request().url().includes('/status'))return route.fulfill({json:{endedAt:null}});
   requests++;await new Promise(r=>pending=r);
   await route.fulfill({status:scenario==='failure'?503:200,json:scenario==='failure'?{ok:false,error:'Test: Vorbereitung fehlgeschlagen'}:{ok:true,callId:'test-call',direct:true,state:'accepted',dialedPhone:'+493023125000',expiresAt:scenario==='expired'?1:Date.now()+90000}});
  });
  await page.goto(url);
  await page.getByRole('button',{name:'Mit Placetel-Softphone anrufen',exact:true}).click();
  await page.getByRole('button',{name:'Anrufen',exact:true}).click();
  await page.getByRole('button',{name:'Wird vorbereitet …',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').isVisible(),true,'preparation must remain visible');
  if(scenario==='cancel')await page.getByRole('button',{name:'Abbrechen',exact:true}).click();
  pending();
  if(['slow','expired'].includes(scenario)){
   const open=page.getByRole('dialog').getByRole('button',{name:'Placetel jetzt öffnen',exact:true});await open.waitFor();
   assert.equal(handoffs.length,0);
   await open.click();
   if(scenario==='slow')await page.getByText('Öffnen der Telefon-App angefordert.',{exact:false}).last().waitFor();
   else await page.getByText('Die Vorbereitung ist abgelaufen.',{exact:false}).last().waitFor();
   assert.equal(await page.getByRole('dialog').isVisible(),false);
  }else if(scenario==='fast')await page.getByText('Öffnen der Telefon-App angefordert.',{exact:false}).last().waitFor();
  else if(scenario==='failure')await page.getByRole('dialog').getByText('Test: Vorbereitung fehlgeschlagen').waitFor();
  else {await page.getByRole('button',{name:'Placetel-Softphone öffnen',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').isVisible(),false);}
  assert.equal(requests,1,'handoff must not create a second preparation');
  assert.equal(handoffs.length,['slow','fast'].includes(scenario)?1:0,scenario);
  if(handoffs.length)assert.equal(handoffs[0],'tel:+493023125000');
  console.log('PASS',scenario);await page.close();
 }
} finally {await browser?.close();if(server)await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
