import type {Draft,Preview} from "../dhl-preview.js";
export type Confirmation={previewId:string;version:number;offerId:string;pickup?:{readyByTime:string;closeTime:string}};
export function mountPreview(root:HTMLElement,confirm:(args:Confirmation)=>Promise<unknown>,update?:(args:{draft:Draft;previous?:{previewId:string;version:number}})=>Promise<Preview>){
 const doc=root.ownerDocument;let preview:Preview|undefined;let selected="";let busy=false;let editing=false;let expiredTimer:ReturnType<typeof setTimeout>|undefined;
 const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,cls?:string)=>{
  const n=doc.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;
 };
 const status=el("p","","status");status.setAttribute("role","status");
 const button=el("button","Auswahl testweise bestätigen – keine Buchung","confirm-preview");button.type="button";button.disabled=true;
 const pickupEnabled=el("input");pickupEnabled.type="checkbox";pickupEnabled.checked=true;
 const ready=el("select"),close=el("select");ready.setAttribute("aria-label","Abholzeit von");close.setAttribute("aria-label","Abholzeit bis");
 for(let hour=0;hour<24;hour++)for(const minute of ["00","30"]){const time=String(hour).padStart(2,"0")+":"+minute;for(const select of [ready,close]){const option=el("option",time);option.value=time;select.append(option);}}
 const pickupDate=el("p","Zuerst einen Versandtarif auswählen.","hint");
 const pickupHint=el("p","Wunschfenster am Absenderort · noch nicht von DHL geprüft.","hint");
 const updateButton=()=>{button.disabled=busy||editing||!selected||!preview||Date.now()>=preview.expiresAt||(pickupEnabled.checked&&ready.value>=close.value);};
 const updatePickup=()=>{ready.disabled=close.disabled=!pickupEnabled.checked;pickupHint.textContent=pickupEnabled.checked?(ready.value>=close.value?"Bitte eine Endzeit nach der Startzeit wählen.":"Wunschfenster · noch nicht von DHL geprüft. Bei geänderter Startzeit Tarife im Chat neu abfragen."):"Keine zusätzliche Abholung vorgesehen – etwa wenn der Fahrer ohnehin kommt.";updateButton();};
 for(const field of [ready,close,pickupEnabled])field.addEventListener("change",updatePickup);
 const dateText=(value?:string)=>value?new Intl.DateTimeFormat("de-DE",{weekday:"short",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Berlin"}).format(new Date(value)):"Keine Lieferprognose";
 const deliveryParts=(value?:string)=>{
  if(!value)return {day:"Termin offen",time:"Keine Prognose"};
  const local=!/(Z|[+-]\d{2}:\d{2})$/.test(value);const date=new Date(local?value+"Z":value);
  const zone=local?"UTC":"Europe/Berlin";
  const day=new Intl.DateTimeFormat("de-DE",{weekday:"long",day:"2-digit",month:"2-digit",timeZone:zone}).format(date);
  const time=new Intl.DateTimeFormat("de-DE",{hour:"2-digit",minute:"2-digit",timeZone:zone}).format(date);
  return {day,time:time==="23:59"?"Tagesende":"bis "+time+" Uhr"};
 };
 function addEditor(section:HTMLElement,kind:"receiver"|"parcels",p:Preview){
  if(!update)return;
  const edit=el("button","✎","edit-button");edit.type="button";edit.setAttribute("aria-label",kind==="receiver"?"Lieferadresse bearbeiten":"Paketdaten bearbeiten");edit.title=edit.getAttribute("aria-label")!;
  section.querySelector("h2")!.append(edit);
  edit.addEventListener("click",()=>{
   if(editing||busy)return;editing=true;selected="";updateButton();
   root.querySelectorAll<HTMLInputElement>('input[name="offer"]').forEach(r=>{r.checked=false;r.disabled=true;});
   const form=el("form",undefined,"edit-form");const fields=new Map<string,HTMLInputElement>();
   const field=(key:string,label:string,value:string,type="text",required=true)=>{
    const wrapper=el("label",label);const input=el("input");input.name=key;input.type=type;input.value=value;input.required=required;
    if(type==="number"){input.min="0.01";input.max="3000";input.step="any";}else input.maxLength=150;
    wrapper.append(input);form.append(wrapper);fields.set(key,input);return input;
   };
   if(kind==="receiver"){
    const a=p.draft.receiver;field("name","Name",a.name);field("company","Firma",a.company??"","text",false);
    a.addressLines.concat(Array(Math.max(0,3-a.addressLines.length)).fill("")).forEach((line,i)=>field("line"+i,i===0?"Straße und Hausnummer":"Adresszusatz "+i,line,"text",i===0));
    field("postalCode","PLZ",a.postalCode);field("city","Ort",a.city);
    field("countryCode","Land (Länderwechsel bitte im Chat)",a.countryCode).readOnly=true;
    field("phone","Telefon",a.phone);field("email","E-Mail",a.email??"","email",false);
   }else p.draft.parcels.forEach((parcel,i)=>{form.append(el("h3","Paket "+(i+1)));for(const [key,label] of [["lengthCm","Länge (cm)"],["widthCm","Breite (cm)"],["heightCm","Höhe (cm)"],["weightKg","Gewicht (kg)"]] as const)field(i+"-"+key,label,String(parcel[key]),"number");});
   const actions=el("div",undefined,"edit-actions");const save=el("button","Übernehmen & Preise aktualisieren");save.type="submit";const cancel=el("button","Abbrechen");cancel.type="button";
   const error=el("p","","hint");error.setAttribute("role","alert");actions.append(save,cancel);form.append(actions,error);section.append(form);edit.disabled=true;
   cancel.addEventListener("click",()=>render(p));
   form.addEventListener("submit",async event=>{
    event.preventDefault();if(busy||!form.reportValidity())return;
    const draft=structuredClone(p.draft);const value=(key:string)=>fields.get(key)!.value.trim();
    if(kind==="receiver"){
     const a=draft.receiver;a.name=value("name");a.company=value("company")||undefined;a.addressLines=[0,1,2].map(i=>value("line"+i)).filter(Boolean);a.postalCode=value("postalCode");a.city=value("city");a.phone=value("phone");a.email=value("email")||undefined;
    }else draft.parcels.forEach((parcel,i)=>{for(const key of ["lengthCm","widthCm","heightCm","weightKg"] as const)parcel[key]=Number(value(i+"-"+key));});
    busy=true;save.disabled=true;cancel.disabled=true;updateButton();error.textContent="DHL-Tarife werden neu abgefragt …";
    try{
     const next=await update({draft,...(Date.now()<p.expiresAt?{previous:{previewId:p.id,version:p.version}}:{})});
     if(preview!==p)return;
     if(next?.mode!=="preview"||!next.draft||!Array.isArray(next.offers))throw Error("Keine aktualisierte Vorschau erhalten.");
     render(next);
    }catch(e){if(preview===p){busy=false;save.disabled=false;cancel.disabled=false;error.textContent=e instanceof Error?e.message:"Aktualisierung fehlgeschlagen. Bitte erneut versuchen.";updateButton();}}
   });
   fields.values().next().value?.focus();
  });
 }
 function render(p:Preview){
  if(expiredTimer)clearTimeout(expiredTimer);
  preview=p;selected="";busy=false;editing=false;pickupEnabled.checked=true;ready.value="16:00";close.value="18:00";pickupDate.textContent="Zuerst einen Versandtarif auswählen.";updatePickup();status.textContent="";root.replaceChildren();
  const header=el("header");header.append(el("span","NEONTRIP / VERSAND","eyebrow"),el("h1","DHL Express"),el("p","Liefertermin und Preis auswählen","subtitle"));root.append(header);
  root.append(el("p","TESTMODUS · Es wird nichts gebucht.","banner"));
  const grid=el("div",undefined,"addresses");
  for(const [label,a] of [["Lieferadresse",p.draft.receiver],["Absender",p.draft.shipper]] as const){
   const card=el("section",undefined,"card");card.append(el("h2",label));
   card.append(el("strong",a.name));if(a.company)card.append(el("div",a.company));
   for(const line of a.addressLines)card.append(el("div",line));
   card.append(el("div",a.postalCode+" "+a.city),el("div",a.countryCode),el("p",[a.phone,a.email].filter(Boolean).join(" · "),"contact"));grid.append(card);if(label==="Lieferadresse")addEditor(card,"receiver",p);
  }
  root.append(grid);
  const parcels=el("section",undefined,"card");parcels.append(el("h2","Paketdaten · "+p.draft.parcels.length+" Paket"+(p.draft.parcels.length>1?"e":"")));
  p.draft.parcels.forEach((parcel,i)=>parcels.append(el("div","Paket "+(i+1)+": "+parcel.lengthCm+" × "+parcel.widthCm+" × "+parcel.heightCm+" cm · "+parcel.weightKg+" kg","parcel")));
  parcels.append(el("p","Außenmaße und Bruttogewicht bitte prüfen. Änderungen einfach im Chat nennen.","hint"));
  if(p.draft.customsDeclarable)parcels.append(el("p","Zollsendung · Warenwert "+p.draft.declaredValue?.amount+" "+p.draft.declaredValue?.currency+" · Einfuhrabgaben zahlt der Empfänger.","hint"));
  root.append(parcels);addEditor(parcels,"parcels",p);
  const fieldset=el("fieldset");fieldset.append(el("legend","Versandangebot auswählen"));
  const offerGrid=el("div",undefined,"offer-grid");
  for(const o of [...p.offers].sort((a,b)=>a.shippingDate.localeCompare(b.shippingDate)||a.amount-b.amount)){
   const label=el("label",undefined,"offer");const input=el("input");input.type="radio";input.name="offer";input.value=o.id;
   input.addEventListener("change",()=>{selected=o.id;status.textContent="";
    const time=new Intl.DateTimeFormat("de-DE",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Berlin"}).format(new Date(o.shippingDate));
    if(!Array.from(ready.options).some(option=>option.value===time)){const option=el("option",time);option.value=time;ready.append(option);}
    ready.value=time;close.value=time<"18:00"?"18:00":"23:30";
    pickupDate.textContent="Versand / Abholung: "+dateText(o.shippingDate)+" · Preisabfrage für diese Startzeit.";updatePickup();});
   const info=el("div",undefined,"offer-info");const delivery=deliveryParts(o.deliveryDate);
   info.append(el("small","VORAUSS. ZUSTELLUNG"),el("strong",delivery.day,"delivery-day"),el("span",delivery.time,"delivery-time"),el("div","Versand: "+dateText(o.shippingDate)),el("small",o.productName));
   if(o.environment==="test")info.append(el("small","Sandbox · kein Live-Preis"));
   label.append(input,info,el("strong",new Intl.NumberFormat("de-DE",{style:"currency",currency:o.currency}).format(o.amount),"price"));offerGrid.append(label);
  }
  fieldset.append(offerGrid);
  if(!p.offers.length)fieldset.append(el("p","Noch kein bestätigtes DHL-Angebot verfügbar.","hint"));
  root.append(fieldset);
  root.append(el("p","Zustellzeiten gelten am Zielort.","hint"));
  const pickup=el("section",undefined,"card pickup");pickup.append(el("h2","Abholung · Vorschlag"));
  const toggle=el("label",undefined,"pickup-toggle");toggle.append(pickupEnabled,doc.createTextNode("Zusätzliche Abholung einplanen"));
  const times=el("div",undefined,"pickup-times");for(const [title,select] of [["Abholzeit von",ready],["Abholzeit bis",close]] as const){const label=el("label",title);label.append(select);times.append(label);}
  pickup.append(toggle,pickupDate,times,pickupHint);root.append(pickup);
  for(const warning of p.warnings)root.append(el("p",warning,"warning"));
  if(p.offers.length)root.append(el("p",p.offers[0]!.taxNote,"hint"));
  root.append(button,status,el("p","Vorschau "+p.version+" · Keine Abholung, keine Kundenmail, kein Versandlabel.","footer"));
  updateButton();expiredTimer=setTimeout(()=>{selected="";updateButton();status.textContent="Angebote abgelaufen. Bitte im Chat neu abfragen.";},Math.max(0,p.expiresAt-Date.now()));
 }
 button.addEventListener("click",async()=>{
  if(button.disabled||!preview)return;
  const current=preview;busy=true;updateButton();status.textContent="Auswahl wird geprüft …";
  try{
   const result=await confirm({previewId:current.id,version:current.version,offerId:selected,...(pickupEnabled.checked?{pickup:{readyByTime:ready.value,closeTime:close.value}}:{})});
   if(preview!==current)return;
   if(!result||typeof result!=="object"||!("booked" in result)||result.booked!==false||!("status" in result)||result.status!=="preview_confirmed")throw new Error("Testbestätigung nicht nachgewiesen.");
   status.textContent="Test bestätigt, nichts gebucht.";selected="";
  }catch(error){if(preview===current){selected="";status.textContent=error instanceof Error?error.message:"Auswahl nicht bestätigt. Bitte aktuelle Maske anfordern.";}}
  finally{if(preview===current){busy=false;updateButton();}}
 });
 return {render,dispose(){if(expiredTimer)clearTimeout(expiredTimer);root.replaceChildren();}};
}
