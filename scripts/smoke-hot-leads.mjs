import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date());
const lead={canSchedule:true,id:'22222222-2222-4222-8222-222222222222',customerId:'11111111-1111-4111-8111-111111111111',requestId:'33333333-3333-4333-8333-333333333333',displayName:'Testkontakt',company:null,email:'test@example.invalid',phone:'+4930123456',requestTitle:'Synthetische Anfrage',requestCreatedAt:today+'T09:00:00Z',amount:2584.93,currency:'EUR',segment:'B2B',sourceAt:today+'T09:00:00Z',offerNumber:'TEST-123',reasons:['Heute','Angebot erstellt'],priority:55,revision:0,dueDate:null};
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});let state=null;const writes=[];page.on("pageerror",e=>console.error(e.message));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/hot-leads')){
    if(req.method()==='PATCH'){const body=req.postDataJSON();writes.push(body);state=body;return route.fulfill({json:{ok:true,state:{revision:writes.length}}});}
    return route.fulfill({json:{ok:true,results:url.searchParams.has('customerIds')||!state?[lead]:[],nextOffset:null,total:state?0:1,today}});
   }
   if(url.pathname.endsWith('/context'))return route.fulfill({json:{ok:true,results:[lead],nextOffset:null}});
   return route.fulfill({json:{ok:true,results:[],calls:[],team:[],identity:null}});
  });
  await page.goto('http://127.0.0.1:44222/ops/voice-copilot');
  await page.getByRole('button',{name:'Hot-Leads',exact:true}).click();
  await page.waitForTimeout(1500); await page.screenshot({path:'/tmp/hot-leads-populated-'+width+'.png',fullPage:true}); await page.getByRole('button',{name:'Nicht erreicht',exact:true}).click();
  await page.getByText('Ignoriert. Dieser Eintrag ist aus der Liste entfernt.',{exact:true}).waitFor();
  assert.equal(writes[0].status,'ignored');
  await page.getByRole('button',{name:'Morgen wieder in Hot-Leads aufnehmen'}).click();
  await page.getByText(/Wiedervorlage gespeichert/).waitFor();
  assert.equal(writes[1].status,'scheduled');assert.equal(writes[1].revision,1);assert.ok(writes[1].dueDate>today);
  state=null;await page.getByRole('region',{name:'Hot-Leads'}).getByRole('button',{name:'Aktualisieren',exact:true}).click();
  await page.getByLabel('Wiedervorlage verschieben').click();
  await page.getByRole('button',{name:'Auf nächste Woche verschieben'}).click();
  await page.getByText(/Wiedervorlage gespeichert/).waitFor();assert.equal(writes[2].status,'scheduled');
  state=null;await page.getByRole('region',{name:'Hot-Leads'}).getByRole('button',{name:'Aktualisieren',exact:true}).click();
  await page.getByLabel('Wiedervorlage verschieben').click();
  await page.getByRole('button',{name:'Datum wählen',exact:true}).click();
  await page.getByLabel('Ein Datum wählen').fill('2027-02-01');
  await page.getByRole('button',{name:'Verschieben',exact:true}).click();
  await page.getByText(/Wiedervorlage gespeichert/).waitFor();assert.equal(writes[3].dueDate,'2027-02-01');
  await page.getByRole('button',{name:'Verzeichnis',exact:true}).click();
  assert.equal(await page.getByLabel('Wiedervorlage verschieben').count(),0);
  assert.equal(writes.length,4);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false);
  await page.screenshot({path:'/tmp/hot-leads-'+width+'.png',fullPage:true});
  console.log('PASS desktop/mobile',width,'ignore, tomorrow, week, custom date, persistent revision and no overflow');
  await page.close();
 }
}finally{await browser.close();}
