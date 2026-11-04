import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { renderOrderConfirmation, ORDER_CONFIRMATION_NOTE } from '../../src/lib/ops/order-confirmation';

const input = {
  reference: '#NEONT4828', offerNumber: 'A/N 16008', acceptedAt: '2026-11-03T14:31:26Z',
  billingAddress: {company:'Muster GmbH',name:'Jörg Müller',address1:'Hauptstraße 1',zip:'10115',city:'Berlin',country:'Deutschland'},
  deliveryAddress: {company:'Empfänger GmbH',address1:'Straße 2',zip:'40219',city:'Düsseldorf',country:'Deutschland'},
  items: [{title:'3D Frontlit – NORD/LB',description:'60 × 16,23 cm; Front: Blau; Leuchtfarbe: Warmweiß',quantity:1,unitPrice:519,total:519}],
  subtotal:519, tax:98.61, total:617.61, currency:'EUR', delivery:'Standardlieferung, ca. 20 Werktage. Gewählter Termin: 01.12.2026.',
};
async function textOf(bytes:Uint8Array) {
  const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf=await getDocument({data:bytes.slice(),useSystemFonts:true}).promise;
  let text=''; for(let i=1;i<=pdf.numPages;i++) {const page=await pdf.getPage(i); const content=await page.getTextContent(); text+=content.items.map((x:any)=>x.str||'').join(' ');}
  return {text,pages:pdf.numPages};
}
test('approved AB contains original logo, amounts, selected delivery and closing note on one plain page',async()=>{
  const bytes=await renderOrderConfirmation(input); const {text,pages}=await textOf(bytes);
  assert.equal(pages,1);
  for(const value of ['Auftragsbestätigung','#NEONT4828','A/N 16008','Muster GmbH','Empfänger GmbH','519,00','98,61','617,61','01.12.2026','Bilker Allee','HRB 101352','Vorkasse',ORDER_CONFIRMATION_NOTE]) assert.ok(text.includes(value),value);
  for(const value of ['Snapshot','Prüfung und Ablage','Rechnung kommt separat','abweichender Kundenwunsch','Mit der verbindlichen Annahme']) assert.ok(!text.includes(value),value);
  assert.ok(text.indexOf(ORDER_CONFIRMATION_NOTE)>text.indexOf('Zahlungsbedingungen'));
  const doc=await PDFDocument.load(bytes); assert.ok(doc.getPage(0).node.Resources()?.get(PDFName.of('XObject')));
  assert.deepEqual(await renderOrderConfirmation(input),bytes,'same source must produce stable PDF for duplicate guard');
});
test('long AB continues cleanly without dropping item descriptions or the final note',async()=>{
 const items=Array.from({length:25},(_,i)=>({...input.items[0],title:`Position ${i+1}`,description:('Sehr ausführliche gewählte Ausführung mit Größe und Montage. ').repeat(8)}));
 const {text,pages}=await textOf(await renderOrderConfirmation({...input,items}));
 assert.ok(pages>1); assert.ok(text.includes('Position 25'));assert.ok(text.includes(ORDER_CONFIRMATION_NOTE));
});
