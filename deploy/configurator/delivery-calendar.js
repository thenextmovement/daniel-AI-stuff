import {roundGrossPrice} from './pricing.js?v=20261007-tablet-accessories1-factor26';
// NEON-only delivery selection. Source: Offers origin/main lib/pricing/delivery.ts
// and lib/delivery-date.ts; verified against origin/main 9a894c87 on 2026-10-06.
// Daniel approved unchanged Offers fees on 2026-10-06; no online fee discount.
// Online date range is 2–15 weekdays, or 7–15 for RGB/outdoor. No provider calls.
export const DELIVERY_RESTRICTION_NOTE='RGB- und Außenschilder können wir frühestens in 7 Werktagen liefern. Wenn du dein Schild schneller brauchst, wähle feste Leuchtfarben ohne RGB und den Innenbereich.';
export function minimumDeliveryBusinessDays(designs=[]){
  return designs.some(design=>design?.outdoor===true||design?.lightMode==='rgb')?7:2;
}
export const DELIVERY_TIERS = Object.freeze([
  [2,.35,550],[3,.32,450],[4,.28,200],[5,.24,175],[6,.20,150],
  [7,.18,125],[8,.15,100],[9,.125,80],[10,.10,60],[11,.07,40],
  [12,.05,25],[13,.035,15],[14,.025,10],[15,0,0]
].map(([businessDays,rate,minimum])=>Object.freeze({businessDays,rate,minimum})));
const currency = new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2});
const fullDate = new Intl.DateTimeFormat('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
let nextId = 0;

function tierFor(days){
  const tier=DELIVERY_TIERS.find(t=>t.businessDays===days);
  if(!tier)throw new RangeError('Lieferzeit muss 2 bis 15 Werktage betragen.');
  return tier;
}
export function getDeliveryQuote(businessDays,signNet){
  const {rate,minimum}=tierFor(businessDays);
  const priceReady=typeof signNet==='number'&&Number.isFinite(signNet)&&signNet>0;
  const minimumNet=minimum;
  const feeNet=Math.round(Math.max(minimum,priceReady?signNet*rate:0));
  const feeGross=roundGrossPrice(feeNet*1.19);
  return {businessDays,feeNet,feeGross,minimumNet,priceReady,label:`${priceReady?'':'ab '}${currency.format(feeGross)} inkl. MwSt.`};
}
function berlinDate(now){
  if(!(now instanceof Date)&&typeof now!=='number')throw new TypeError('Ungültiger Ausgangszeitpunkt.');
  const date=new Date(now);
  if(!Number.isFinite(date.getTime()))throw new RangeError('Ungültiger Ausgangszeitpunkt.');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));
  return new Date(Date.UTC(+parts.year,+parts.month-1,+parts.day,12));
}
function iso(date){return date.toISOString().slice(0,10);}
function parseIso(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new RangeError('Ungültiges Lieferdatum.');
  const date=new Date(`${value}T12:00:00Z`);
  if(!Number.isFinite(date.getTime())||iso(date)!==value)throw new RangeError('Ungültiges Lieferdatum.');
  return date;
}
export function deliveryDateIsoForBusinessDays(days,now=Date.now()){
  tierFor(days);
  const date=berlinDate(now);
  let elapsed=0;
  while(elapsed<days){date.setUTCDate(date.getUTCDate()+1);if(date.getUTCDay()!==0&&date.getUTCDay()!==6)elapsed++;}
  return iso(date);
}
export function buildDeliveryOptions({signNet,designs=[],now=Date.now()}={}){
  const minimum=minimumDeliveryBusinessDays(designs);
  return DELIVERY_TIERS.map(({businessDays})=>({dateIso:deliveryDateIsoForBusinessDays(businessDays,now),...getDeliveryQuote(businessDays,signNet),available:businessDays>=minimum}));
}
export function deliveryOptionForDate(dateIso,context={}){
  parseIso(dateIso);
  return buildDeliveryOptions(context).find(option=>option.available&&option.dateIso===dateIso)??null;
}
export function deliveryTierLabel(days){
  if(days<=5)return 'Eilauftrag';
  if(days<=10)return 'Express';
  if(days<15)return 'Priorisiert';
  return 'Standard';
}
const shortDate=new Intl.DateTimeFormat('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',timeZone:'UTC'});
const checkIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>';

/** Offers-style date cards. Context prices are local previews, never a reservation.
 * Only onContinue commits a choice; closing the dialog leaves the cart unchanged.
 */
export function initDeliveryCalendar(host,{getContext=()=>({}),onSelect=()=>{},onContinue=()=>{},previewOnly=false}={}){
  if(!host||typeof host.addEventListener!=='function')throw new TypeError('Kalender-Element fehlt.');
  const id=`nt-delivery-${++nextId}`;
  let options=[],selectedDate=null,context={},destroyed=false;
  host.classList.add('delivery-calendar');
  const getSelection=()=>{const selected=options.find(o=>o.available&&o.dateIso===selectedDate);return selected?{...selected}:null;};
  function render(focusDate){
    const selected=getSelection(),priceReady=options.every(o=>o.priceReady);
    const subtotal=Number.isFinite(context.subtotalGross)?context.subtotalGross:null;
    const total=selected&&priceReady&&subtotal!==null?currency.format(Math.round((subtotal+selected.feeGross)*100)/100):selected?'Entwurf prüfen':'Termin wählen';
    host.innerHTML=`<div class="delivery-calendar-heading"><div><p class="delivery-calendar-eyebrow">Versand und Liefertermin</p><h3 id="${id}-title">Wunschtermin wählen</h3></div><span class="delivery-calendar-tag">${previewOnly?'Für Ihren aktuellen Entwurf':'Für Ihren gesamten Warenkorb'}</span></div>
      <p class="delivery-calendar-intro">Je früher der Termin, desto höher die Priorität. Wochenenden werden übersprungen; ab 15 Werktagen ist die Standardlieferung innerhalb Deutschlands gratis.</p>
      ${minimumDeliveryBusinessDays(context.designs)===7?`<p class="delivery-calendar-restriction" role="status"><strong>Früheste Lieferung: 7 Werktage</strong><br>${DELIVERY_RESTRICTION_NOTE} Das gilt für den gesamten Warenkorb.</p>`:''}
      <div class="delivery-calendar-options" role="group" aria-labelledby="${id}-title">${options.map(option=>{
        const active=option.dateIso===selectedDate,isFree=option.feeNet===0;
        return `<button type="button" class="delivery-calendar-day" data-date="${option.dateIso}" ${option.available?'':'disabled'} aria-pressed="${active}" aria-label="${fullDate.format(parseIso(option.dateIso))}, ${option.businessDays} Werktage, ${option.available?option.label:'nicht verfügbar: RGB und Außen ab 7 Werktagen'}"><span class="delivery-day-top"><span>${option.businessDays} Werktage</span>${active?checkIcon:''}</span><span class="delivery-day-date">${shortDate.format(parseIso(option.dateIso))}</span><span class="delivery-day-fee ${isFree?'is-free':option.feeNet>=350?'is-urgent':''}">${option.available?`${option.priceReady?'':'ab '}${isFree?'Gratis':'+ '+currency.format(option.feeGross)}`:'Nicht verfügbar'}</span><span class="delivery-day-tier">${option.available?deliveryTierLabel(option.businessDays):'RGB / Außen: ab Tag 7'}</span></button>`;
      }).join('')}</div>
      <p class="delivery-calendar-unit">Aufpreise inkl. 19 % MwSt. für Lieferung innerhalb Deutschlands. Pfeiltasten wechseln zwischen Terminen.</p>
      <div class="delivery-calendar-summary"><div class="delivery-calendar-choice" aria-live="polite" aria-atomic="true"><p class="delivery-calendar-eyebrow">${selected?'Ihr gewählter Liefertermin':'Ihre Auswahl'}</p><p class="delivery-calendar-selected-date">${selected?fullDate.format(parseIso(selected.dateIso)):'Welcher Tag passt zu Ihnen?'}</p><p class="delivery-calendar-duration">${selected?`${deliveryTierLabel(selected.businessDays)} · ${selected.businessDays} Werktage · ${selected.feeNet===0?'ohne Aufpreis':'+ '+currency.format(selected.feeGross)}`:(previewOnly?'Wählen Sie einen Termin für die Kostenvorschau.':'Ein gemeinsamer Termin für alle Schilder.')}</p></div><div class="delivery-calendar-checkout"><span>Gesamt inkl. Lieferung</span><strong class="delivery-calendar-price" aria-live="polite">${total}</strong>${previewOnly?'':`<button type="button" class="delivery-calendar-continue" data-continue ${selected&&priceReady?'':'disabled'}>Liefertermin übernehmen</button>`}</div></div>
      <p class="delivery-calendar-note">Voraussichtliche Termine ab dem Tag nach der Bestellung. Feiertage und aktuelle Verfügbarkeit sind noch nicht berücksichtigt. Die Auswahl reserviert noch keinen Termin.${previewOnly?' Ihren Liefertermin übernehmen Sie später im Warenkorb.':''}</p>`;
    if(focusDate)host.querySelector(`[data-date="${focusDate}"]`)?.focus();
  }
  function refresh({resetSelection=false}={}){
    if(destroyed)return;
    const before=getSelection();context=getContext()||{};
    options=buildDeliveryOptions(context);
    if(resetSelection)selectedDate=context.selectedDate||null;
    else if(!selectedDate&&options.some(o=>o.available&&o.dateIso===context.selectedDate))selectedDate=context.selectedDate;
    if(!options.some(o=>o.available&&o.dateIso===selectedDate))selectedDate=null;
    const focused=host.ownerDocument.activeElement?.dataset?.date;
    render(focused);
    const after=getSelection();
    if(before&&JSON.stringify(before)!==JSON.stringify(after))onSelect(after);
  }
  function select(dateIso,{focus=false}={}){
    if(destroyed)return false;
    try{parseIso(dateIso);}catch{return false;}
    if(!options.some(o=>o.available&&o.dateIso===dateIso))return false;
    selectedDate=dateIso;render(focus?dateIso:null);onSelect(getSelection());return true;
  }
  function click(event){
    const button=event.target.closest('button');if(!button||!host.contains(button)||button.disabled)return;
    if(button.dataset.date){select(button.dataset.date,{focus:true});return;}
    if(button.hasAttribute('data-continue')){
      refresh();const selection=getSelection();if(selection?.priceReady)onContinue(selection);
    }
  }
  function keydown(event){
    const current=event.target.closest('[data-date]');if(!current)return;
    const available=options.filter(o=>o.available),index=available.findIndex(o=>o.dateIso===current.dataset.date);
    const columns=getComputedStyle(host.querySelector('.delivery-calendar-options')).gridTemplateColumns.split(' ').length;
    let next;
    if(event.key==='ArrowRight')next=index+1;
    else if(event.key==='ArrowLeft')next=index-1;
    else if(event.key==='ArrowDown')next=index+columns;
    else if(event.key==='ArrowUp')next=index-columns;
    else if(event.key==='Home')next=0;else if(event.key==='End')next=available.length-1;else return;
    event.preventDefault();const option=available[next];if(option)host.querySelector(`[data-date="${option.dateIso}"]`)?.focus();
  }
  host.addEventListener('click',click);host.addEventListener('keydown',keydown);refresh({resetSelection:true});
  return {refresh,getSelection,select,destroy(){destroyed=true;host.removeEventListener('click',click);host.removeEventListener('keydown',keydown);host.replaceChildren();host.classList.remove('delivery-calendar');}};
}
