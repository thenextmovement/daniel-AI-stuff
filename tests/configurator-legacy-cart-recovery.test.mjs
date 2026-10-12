import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {chromium,webkit}=createRequire(import.meta.url)('playwright');
const root=fileURLToPath(new URL('../deploy/',import.meta.url));
const origin='https://neontrip-cart-test.invalid';
const readCart=page=>page.evaluate(async()=>{
 const {readAsset}=await import('/configurator/draft-store.js');
 return readAsset('neontrip-local-cart-v1');
});

for(const [name,engine] of Object.entries({chromium,webkit}))test(`${name}: legacy mixed cart requires explicit replacement and preserves item identity`,{timeout:60000},async()=>{
 const browser=await engine.launch({headless:true});let checkoutRequests=0;
 try{
  const context=await browser.newContext({viewport:name==='webkit'?{width:390,height:844}:{width:1440,height:1000},isMobile:name==='webkit',hasTouch:name==='webkit',serviceWorkers:'block'});
  await context.addInitScript(()=>localStorage.setItem('neontrip-entry-help-dismissed-v1','1'));
  // Every byte comes from the local deploy folder; no provider or analytics call can leave this context.
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.startsWith('/api/')&&url.pathname.includes('/checkout'))checkoutRequests++;
   if(url.origin!==origin||route.request().method()!=='GET')return route.abort();
   const pathname=url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname;
   const file=resolve(root,'.'+decodeURIComponent(pathname));
   if(!file.startsWith(root))return route.abort();
   try{
    const body=await readFile(file);
    const contentType={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.ttf':'font/ttf','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg'}[extname(file)]||'application/octet-stream';
    await route.fulfill({body,contentType});
   }catch{await route.abort();}
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);
  await page.goto(origin+'/configurator/');
  await page.locator('#sign-text').fill('Hallo Welt');
  await page.waitForFunction(()=>!document.querySelector('#page-add-to-cart').disabled);
  await page.locator('[data-group="2"]').click();
  await page.locator('#next-step').click();
  await page.waitForFunction(()=>document.querySelector('#cart-dialog').open&&document.querySelector('#header-cart-count').textContent==='1');
  const current=await readCart(page);
  assert.equal(current.items[0].design.rasterVersion,2);
  assert.equal(current.items[0].snapshot.rasterVersion,2);
  const legacy=structuredClone(current.items[0]);legacy.id='legacy-saved-draft';legacy.quantity=3;
  delete legacy.design.rasterVersion;delete legacy.snapshot.rasterVersion;
  const neighbor=structuredClone(current.items[0]);neighbor.id='current-saved-draft';neighbor.quantity=2;
  const mixed={...current,editingId:null,items:[legacy,neighbor]};
  await page.evaluate(async cart=>{
   const {saveAsset}=await import('/configurator/draft-store.js');await saveAsset('neontrip-local-cart-v1',cart);
  },mixed);
  await page.reload();
  await page.locator('#header-cart').click();
  await page.waitForFunction(()=>document.querySelector('#cart-items').children.length===2);
  const primary=page.locator('#cart-delivery-open');
  assert.equal(await primary.textContent(),'Entwurf aktualisieren');assert.equal(await primary.isEnabled(),true);
  assert.match(await page.locator('[data-item-id="legacy-saved-draft"] .cart-draft-update-note').textContent(),/Bisheriger Preisstand/);
  assert.equal(await page.locator('[data-cart-action="edit"][data-item-id="current-saved-draft"]').textContent(),'Bearbeiten');
  await page.waitForFunction(()=>document.querySelector('#cart-total-label').textContent.startsWith('Bisherige'));
  assert.deepEqual((await readCart(page)).items,mixed.items,'opening the cart does not upgrade stored snapshots');

  await primary.click();
  await page.waitForFunction(()=>!document.querySelector('#cart-dialog').open&&document.body.dataset.activeGroup==='2');
  assert.equal(await page.locator('#next-step-label').textContent(),'Änderungen übernehmen');
  assert.match(await page.locator('#cart-add-status').textContent(),/Bisher .* pro Schild.*Erst mit „Änderungen übernehmen“/);
  await page.locator('#header-cart').click();
  assert.deepEqual((await readCart(page)).items,mixed.items,'leaving the editor without applying retains both original positions');
  assert.equal(await primary.textContent(),'Entwurf aktualisieren');

  await primary.click();
  await page.waitForFunction(()=>!document.querySelector('#cart-dialog').open&&document.body.dataset.activeGroup==='2');
  await page.locator('#next-step').click();
  await page.waitForFunction(()=>document.querySelector('#cart-dialog').open&&document.querySelector('#cart-delivery-open').textContent==='Liefertermin wählen');
  const after=await readCart(page);
  assert.equal(after.items.length,2);assert.equal(after.items[0].id,legacy.id);assert.equal(after.items[0].quantity,3);
  assert.equal(after.items[0].design.rasterVersion,2);assert.equal(after.items[0].snapshot.rasterVersion,2);
  assert.deepEqual(after.items[0].design.accessoryQuantities,legacy.design.accessoryQuantities);
  assert.deepEqual(after.items[1],neighbor,'already-current neighboring position remains byte-for-byte unchanged');
  assert.equal(checkoutRequests,0,'recovery never prepares an external checkout');
 }finally{await browser.close();}
});
