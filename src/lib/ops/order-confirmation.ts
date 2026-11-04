import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';

export const ORDER_CONFIRMATION_NOTE = 'Die Produktions- und Grundarbeiten an Ihrem Auftrag beginnen bereits mit der Auftragserteilung. Die angegebene Lieferzeit beginnt mit Zahlungseingang. Bei späterer Zahlung kann sich der voraussichtliche Liefertermin entsprechend verschieben.';
export type OrderConfirmationInput = {
  reference: string; offerNumber?: string | null; acceptedAt: string;
  billingAddress: Record<string, unknown>; deliveryAddress: Record<string, unknown>;
  customerName?: string | null; customerCompany?: string | null;
  items: {title:string;description:string;quantity:number;unitPrice:number|null;total:number|null}[];
  subtotal:number|null;tax:number|null;total:number|null;currency:string;delivery:string;
  paymentTerms?:string; taxLabel?:string;
};
const clean = (value:unknown) => String(value??'').replace(/<br\s*\/?\s*>/gi,'; ').replace(/<[^>]*>/g,'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim();
function address(value:Record<string,unknown>) {
  return [value.company,value.name||[value.firstName||value.first_name,value.lastName||value.last_name].filter(Boolean).join(' '),value.address1||value.street,value.address2,[value.zip||value.postalCode,value.city].filter(Boolean).join(' '),value.country].map(clean).filter(Boolean);
}
export async function renderOrderConfirmation(input:OrderConfirmationInput):Promise<Uint8Array> {
  const doc=await PDFDocument.create();
  const date=new Date(input.acceptedAt); if(Number.isNaN(date.getTime())) throw new Error('order_confirmation_date_invalid');
  doc.setTitle(`Auftragsbestätigung ${input.reference}`);doc.setAuthor('NEONTRIP / DARA NOVA GmbH');
  doc.setCreationDate(date);doc.setModificationDate(date);
  const regular=await doc.embedFont(StandardFonts.Helvetica), bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const logo=await doc.embedPng(await readFile(path.join(process.cwd(),'public/assets/logo_schwarz_neontrip.png')));
  const ink=rgb(.125,.137,.153),gray=rgb(.38,.40,.42),rule=rgb(.85,.86,.87);
  let page:PDFPage;let y=0;
  const safe=(value:unknown)=>Array.from(clean(value)).map(char=>{try{regular.encodeText(char);return char;}catch{return char==='\u202f'?' ':'-';}}).join('');
  const text=(value:unknown,x:number,at:number,size=9.3,font:PDFFont=regular,color=ink)=>page.drawText(safe(value),{x,y:at,size,font,color});
  const right=(value:unknown,x:number,at:number,size=9.3,font:PDFFont=regular)=>{const s=safe(value);text(s,x-font.widthOfTextAtSize(s,size),at,size,font);};
  const line=(at:number)=>page.drawLine({start:{x:48,y:at},end:{x:547.28,y:at},color:rule,thickness:.5});
  const wrap=(value:unknown,width:number,size=9.3,font:PDFFont=regular)=>{
    const lines:string[]=[];let current='';
    for(const word of safe(value).split(' ').filter(Boolean)) {
      const next=current?current+' '+word:word;
      if(font.widthOfTextAtSize(next,size)<=width) {current=next;continue;}
      if(current)lines.push(current);current='';
      for(const char of word){if(font.widthOfTextAtSize(current+char,size)>width&&current){lines.push(current);current='';}current+=char;}
    }
    if(current)lines.push(current);return lines;
  };
  const newPage=()=>{
    page=doc.addPage([595.28,841.89]);
    page.drawImage(logo,{x:48,y:788,width:145,height:145*logo.height/logo.width});
    right('DARA NOVA GmbH · Bilker Allee 29 · 40219 Düsseldorf',547.28,801,8);
    right('info@neontrip.de · 0211 54257240 · neontrip.de',547.28,788,8);line(774);
    text('Auftragsbestätigung',48,740,21,bold);
    line(65);text('DARA NOVA GmbH · Sitz: Düsseldorf · Geschäftsführer: Daniel Klesse',48,51,7.3,regular,gray);
    text('Amtsgericht Düsseldorf · HRB 101352 · USt-IdNr.: DE362152329',48,40,7.3,regular,gray);
    right(`Seite ${doc.getPageCount()}`,547.28,40,7.3);y=710;
  };
  const ensure=(height:number)=>{if(y-height<82)newPage();};
  const paragraph=(value:unknown,size=9.3,leading=13,font=regular)=>{for(const s of wrap(value,499.28,size,font)){ensure(leading);text(s,48,y,size,font);y-=leading;}};
  const cash=(value:number|null)=>value===null?'–':new Intl.NumberFormat('de-DE',{style:'currency',currency:input.currency}).format(value);
  const dateLabel=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric'}).format(date);
  newPage();
  text('AUFTRAGGEBER / RECHNUNGSANSCHRIFT',48,y,8.3,regular,gray);text('LIEFERANSCHRIFT',308,y,8.3,regular,gray);y-=18;
  const billing=address(input.billingAddress),delivery=address(input.deliveryAddress);
  if(!billing.length)billing.push(...[input.customerCompany,input.customerName].filter(Boolean) as string[]);
  const left=billing.flatMap(s=>wrap(s,240)),rightLines=(delivery.length?delivery:billing).flatMap(s=>wrap(s,239));
  for(let i=0;i<Math.max(left.length,rightLines.length);i++){ensure(13);text(left[i]||'',48,y);text(rightLines[i]||'',308,y);y-=13;}
  y-=14;text(`Bestellung: ${input.reference}`,48,y,9.3,bold);text(`Bestelldatum: ${dateLabel}`,308,y);y-=16;
  if(input.offerNumber)text(`Angebotsbezug: ${input.offerNumber}`,48,y);
  text(`Ausstellungsdatum: ${dateLabel}`,308,y);y-=26;
  paragraph(`Vielen Dank für Ihren Auftrag. Hiermit bestätigen wir Ihren verbindlich erteilten Auftrag${input.offerNumber?` gemäß dem angenommenen Angebot ${input.offerNumber}`:''}.`);y-=12;
  const itemsHeader=()=>{ensure(32);page.drawRectangle({x:48,y:y-10,width:499.28,height:23,color:rgb(.95,.956,.96)});text('Pos.',54,y,8.3,regular,gray);text('Artikel / Ausführung',86,y,8.3,regular,gray);right('Menge',388,y,8.3);right('Einzel netto',466,y,8.3);right('Gesamt netto',541,y,8.3);y-=28;};
  itemsHeader();
  for(const [i,item] of input.items.entries()) {
    const title=wrap(item.title,249,9.1,bold),details=wrap(item.description,249,8.3);
    if(y-Math.min(60,(title.length+details.length)*11.3+16)<82){newPage();itemsHeader();}
    text(i+1,54,y);right(item.quantity,388,y);right(cash(item.unitPrice),466,y,9);right(cash(item.total),541,y,9);
    for(const [s,font,size] of [...title.map(s=>[s,bold,9.1] as const),...details.map(s=>[s,regular,8.3] as const)]) {
      if(y-11.3<82){newPage();itemsHeader();}text(s,86,y,size,font);y-=11.3;
    }
    y-=8;line(y);y-=15;
  }
  ensure(72);
  for(const [label,value,strong] of [['Gesamt netto',input.subtotal,false],[input.taxLabel||'Umsatzsteuer',input.tax,false],['Auftragswert brutto',input.total,true]] as const){if(strong)line(y+12);text(label,54,y,9.3,strong?bold:regular);right(cash(value),541,y,9.3,strong?bold:regular);y-=19;}
  y-=8;ensure(55);paragraph('Lieferung',9.3,14,bold);paragraph(input.delivery||'Gemäß gewählter Lieferung.',8.3,11.3);y-=9;
  ensure(55);paragraph('Zahlungsbedingungen',9.3,14,bold);paragraph(input.paymentTerms||'100 % Vorkasse. Der Gesamtbetrag ist fällig, sofern nicht per E-Mail abweichende Zahlungsbedingungen vereinbart wurden.',8.3,11.3);
  y-=14;ensure(wrap(ORDER_CONFIRMATION_NOTE,499.28,8.3).length*11.3);paragraph(ORDER_CONFIRMATION_NOTE,8.3,11.3);
  return doc.save({useObjectStreams:false});
}

const record=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const number=(value:unknown):number|null=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
export function orderConfirmationFileName(reference:string) {
  return `auftragsbestaetigung-${reference.replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-|-$/g,'')||'auftrag'}.pdf`;
}
export function orderConfirmationFromSnapshot(snapshot:Record<string,unknown>,fallback:{reference:string;offerNumber?:string|null;acceptedAt:string;currency:string;customerName?:string|null;customerCompany?:string|null;subtotal?:number|null;total?:number|null;fallbackItems?:OrderConfirmationInput['items']}):OrderConfirmationInput {
  const offer=record(snapshot.offer),totals=record(snapshot.totals),delivery=record(snapshot.delivery);
  const rawItems=Array.isArray(snapshot.lineItems)?snapshot.lineItems.map(record):[];
  const items=rawItems.length?rawItems.map((item,index)=>{
    const quantity=number(item.normalizedQuantity)??number(item.quantity)??1;
    const unitPrice=number(item.unitPriceNet);
    return {title:clean(item.title||item.name)||`Position ${index+1}`,description:clean(String(item.description||'').replace(/\r?\n/g,' · ')),quantity,unitPrice,total:number(item.lineNet)??(unitPrice===null?null:Math.round(unitPrice*quantity*100)/100)};
  }):fallback.fallbackItems||[];
  const deliveryItem=rawItems.find(item=>/liefer|shipping|versand/i.test(String(item.section||'')))||rawItems.find(item=>/standardversand|standardlieferung|expressversand|eilauftrag/i.test(String(item.title||'')));
  const selectedLabel=clean(delivery.label||delivery.method||deliveryItem?.title);
  const days=number(delivery.requestedDays)??number(delivery.days);
  const selectedDate=clean(delivery.requestedDate);
  let dateLabel='';if(/^\d{4}-\d{2}-\d{2}/.test(selectedDate)){const d=new Date(selectedDate.slice(0,10)+'T12:00:00Z');if(!Number.isNaN(d.getTime()))dateLabel=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric'}).format(d);}
  const subtotal=number(totals.subtotalNet)??fallback.subtotal??null,tax=number(totals.vatAmount)??number(totals.taxAmount),total=number(totals.totalGross)??fallback.total??null;
  const rate=totals.taxExempt===true?0:number(totals.vatRate)??number(totals.vatPercent)??number(totals.originalVatRate)??number(offer.vatRate);
  return {...fallback,offerNumber:fallback.offerNumber||offer.offerNumber||null,
    billingAddress:record(snapshot.billingAddress),deliveryAddress:record(snapshot.deliveryAddress),items,subtotal,tax,total,
    taxLabel:rate!==null?`Umsatzsteuer ${rate<=1?rate*100:rate} %`:'Umsatzsteuer',
    delivery:[selectedLabel,days&&days>0&&!/Werktage|Arbeitstage/i.test(selectedLabel)?`ca. ${days} Werktage`:null].filter(Boolean).join(', ')+(dateLabel?`. Gewählter Termin: ${dateLabel}.`:''),
  };
}

export function orderConfirmationFromBillingCase(c: import('./billing/repository').BillingCaseRow, sale?:Record<string,any>|null) {
  const snapshot=record(sale?.offer_snapshot);
  const input=orderConfirmationFromSnapshot({...snapshot,
    billingAddress:c.billing_address,deliveryAddress:c.delivery_address,
    lineItems:c.line_items.map(value=>{const item=record(value);return {...item,description:item.description||snapshot.lineItems?.find((s:any)=>s.title===item.title)?.description||''};}),
    totals:{...record(snapshot.totals),...c.totals,taxExempt:c.tax_exempt,subtotalNet:c.subtotal_net_cents/100,vatAmount:c.vat_cents/100,totalGross:c.total_gross_cents/100},
  },{reference:c.shopify_order_name,offerNumber:sale?.offer_number,acceptedAt:snapshot.acceptedAt||record(snapshot.offer).acceptedAt||sale?.created_at||c.created_at,currency:c.currency,customerName:String(c.customer.name||''),customerCompany:String(c.customer.company||'')});
  if(c.payment_method==='KAUF_AUF_RECHNUNG')input.paymentTerms=`Kauf auf Rechnung${c.payment_terms_days?`, Zahlungsziel ${c.payment_terms_days} Tage`:''}. Es gelten die schriftlich vereinbarten Zahlungsbedingungen.`;
  if(c.paid_at)input.paymentTerms='Der Gesamtbetrag ist vollständig bezahlt. Es ist keine weitere Zahlung erforderlich.';
  return input;
}
