import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date());
const base={canSchedule:true,id:'22222222-2222-4222-8222-222222222222',customerId:'11111111-1111-4111-8111-111111111111',requestId:'33333333-3333-4333-8333-333333333333',displayName:'Testkontakt',company:null,email:'test@example.invalid',phone:'+4930123456',requestTitle:'Synthetische Anfrage',firstSentAt:'2026-11-20T12:00:00Z',requestCreatedAt:today+'T09:00:00Z',amount:2584.93,currency:'EUR',segment:'B2B',sourceAt:today+'T09:00:00Z',offerNumber:'TEST-123',reasons:['Erstes Angebot gesendet'],priority:55,revision:0,dueDate:today,stage:2,indicators:['not_reached','open','open'],overdueDays:2,needsPlanning:false,dueAt:null,listStatus:null,score:{level:'hot',score:64,label:'Heiß'},capturedAt:new Date().toISOString()};
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({locale:"de-DE",viewport:{width,height:1000}});let lead={...base};const writes=[];const errors=[];const queries=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/hot-leads')){
    queries.push(url.search);
    if(req.method()==='PATCH'){const body=req.postDataJSON();writes.push(body);lead={...lead,listStatus:body.status,revision:lead.revision+1};if(body.status==='reached')lead={...lead,stage:3,indicators:['not_reached','reached','open'],needsPlanning:true};return route.fulfill({json:{ok:true,state:{revision:lead.revision}}});}
    const visible=!['ignored','scheduled','no_followup'].includes(lead.listStatus);
    return route.fulfill({json:{ok:true,results:url.searchParams.has('customerIds')?[lead]:visible?[lead,...Array.from({length:12},(_,i)=>({...lead,id:lead.id+'-'+i,displayName:'Weitere Anfrage '+i}))]:[],nextOffset:null,total:visible?1:0,today}});
   }
   if(url.pathname.endsWith('/context')&&url.searchParams.has('directory'))return route.fulfill({json:{ok:true,results:[lead],nextOffset:null}});
   return route.fulfill({status:503,json:{ok:false,error:'Synthetic unavailable'}});
  });
  await page.goto(process.env.PREVIEW_URL||'http://127.0.0.1:44223/ops/voice-copilot');
  await page.getByRole('button',{name:'Hot-Leads',exact:true}).click();
  const list=page.getByRole('region',{name:'Hot-Leads'});
  await list.getByLabel('Angebots-Score 64 von 100').first().waitFor();
  assert.equal(await list.getByRole('combobox').count(),0);
  assert.equal(await list.getByText(/überfällig/).count(),0);
  await list.getByText('20.11.2026',{exact:true}).first().waitFor();
  await list.locator('summary').filter({hasText:'Score'}).click();
  assert.equal(await list.getByRole('button',{name:/absteigend|älteste zuerst/}).count(),3);
  await list.getByRole('button',{name:'Betrag · absteigend',exact:true}).click();
  await list.locator('summary').filter({hasText:'Betrag'}).waitFor();
  await list.locator('summary').filter({hasText:'Angebotsalter'}).click();
  assert.equal(await list.getByRole('button',{name:/^Bis /}).count(),8);
  await list.getByRole('button',{name:'Bis 90 Tage',exact:true}).click();
  await list.locator('summary').filter({hasText:'≤ 90 Tage'}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Hot-Leads aktualisieren"]')?.disabled);
  assert.ok(queries.some(q=>new URLSearchParams(q).get('age')==='90'));
  if(width>760){
   const sidebar=page.getByRole('complementary',{name:'Kundensuche und Team'});
   await sidebar.scrollIntoViewIfNeeded();
   const windowBefore=await page.evaluate(()=>window.scrollY);
   await sidebar.hover();await page.mouse.wheel(0,600);
   await page.waitForTimeout(350);
   assert.ok(await sidebar.evaluate(el=>el.scrollTop)>100,'Sidebar scrolls');
   assert.equal(await page.evaluate(()=>window.scrollY),windowBefore,'Page stays still');
   await sidebar.evaluate(el=>el.scrollTop=0);
  }

  assert.equal(await list.getByRole('button',{name:'Erreicht',exact:true}).count(),0);
  await page.screenshot({path:'/tmp/hot-age-cards-'+width+'.png',fullPage:true});await list.getByRole('button',{name:'Testkontakt',exact:true}).click();
  const planner=page.getByRole('region',{name:'Nächsten Anruf planen'});
  await planner.getByRole('button',{name:'Erreicht',exact:true}).waitFor({timeout:10000}).catch(async e=>{console.log(errors);console.log((await page.locator('body').innerText()).slice(-5000));throw e;});
  await planner.getByRole('button',{name:'Erreicht',exact:true}).click();
  await planner.getByText('Erreicht gespeichert.',{exact:true}).waitFor();assert.equal(writes[0].status,'reached');assert.equal(writes[0].stage,2);
  await planner.getByRole('button',{name:'+2',exact:true}).click();await planner.getByText(/Wiedervorlage:/).waitFor();assert.equal(writes[1].stage,3);assert.equal(writes[1].status,'scheduled');
  await planner.getByRole('button',{name:'Ignorieren',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(writes.length,2);
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click();assert.equal(writes.length,2);
  await planner.getByRole('button',{name:'Ignorieren',exact:true}).click();await page.getByRole('button',{name:'Ja, ignorieren',exact:true}).click();await planner.getByRole('button',{name:'Wieder in Hot-Leads aufnehmen'}).waitFor();assert.equal(writes[2].status,'ignored');
  await planner.getByRole('button',{name:'Wieder in Hot-Leads aufnehmen'}).click();await planner.getByRole('button',{name:'+7',exact:true}).waitFor();assert.equal(writes[3].status,'active');
  await planner.getByRole('button',{name:'Nicht erreicht',exact:true}).click();await planner.getByText(/Nicht erreicht gespeichert/).waitFor();assert.equal(writes[4].status,'not_reached');
  await planner.getByLabel('Datum',{exact:true}).fill('2027-02-01');await planner.getByLabel('Uhrzeit (optional)').fill('10:30');await planner.getByRole('button',{name:'Planen',exact:true}).click();await planner.getByText(/2027-02-01/).waitFor();assert.equal(writes[5].dueAt,'2027-02-01T09:30:00Z');
  await page.screenshot({path:'/tmp/hot-age-planner-'+width+'.png',fullPage:true});
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  console.log('PASS',width,'stages, score circle, date, compact filters, independent scrolling, reached, +2, ignore cancel/confirm, reactivate, missed, Berlin calendar');await page.close();
 }
}finally{await browser.close();}
