// Existing NEONTRIP intake: same durable request ID on an explicit retry.
// Prices in the description are a configurator estimate, never authority to bill.
const ENDPOINT='https://anfrage.neontrip.de/api/c';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RECEIPT_UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function contactFields(contact){
 const first=String(contact.firstName||'').trim(),last=String(contact.lastName||'').trim(),email=String(contact.email||'').trim();
 if(!first||!last||first.length>80||last.length>80||/[\r\n]/.test(first+last)||email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Bitte Vorname, Nachname und eine gültige E-Mail-Adresse eingeben.');
 return {first,last,email};
}
export function confirmedQuoteReceipt(data,id){
 return !!data&&data.ok===true&&data.accepted===true&&data.persisted===true&&data.contact_saved===true&&data.client_submit_id===id&&data.lead_request_id===id&&RECEIPT_UUID.test(data.request_row_id||'')&&RECEIPT_UUID.test(data.customer_id||'');
}
export function createQuoteClient({readAttempt,saveAttempt,claimAttempt,fetchImpl=fetch,cryptoImpl=crypto}){
 let pending=false;
 return {async submit({contact,description,previews=[],usage='innen',delivery='Termin noch offen',size='',color=''}){
  if(pending)throw new Error('Die Anfrage wird bereits übertragen.');
  const person=contactFields(contact);
  if(typeof description!=='string'||!description.trim()||description.length>50000)throw new Error('Der Warenkorb ist für die Anfrage zu umfangreich. Bitte die Entwürfe in kleineren Gruppen anfragen.');
  if(previews.length>20||previews.some(blob=>!(blob instanceof Blob)||blob.type!=='image/png'||blob.size>25*1024*1024))throw new Error('Die Entwurfsvorschau konnte nicht angehängt werden. Bitte den Entwurf erneut prüfen.');
  pending=true;
  try{
   const canonical=JSON.stringify({person,description,usage,delivery,size,color});
   const hash=Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(canonical))),b=>b.toString(16).padStart(2,'0')).join('');
   const key='neontrip-quote-request-v1:'+hash;
   let attempt;try{attempt=await readAttempt(key);}catch{throw new Error('Die Anfragekennung kann nicht gespeichert werden. Bitte diesen Tab geöffnet lassen; es wurde nichts gesendet.');}
   if(!UUID.test(attempt?.id||'')){
    attempt={id:cryptoImpl.randomUUID()};
    try{attempt=await claimAttempt(key,attempt);if(!UUID.test(attempt?.id||''))throw new Error('invalid claim');}catch{throw new Error('Die Anfragekennung kann nicht gespeichert werden. Es wurde nichts gesendet.');}
   }
   if(confirmedQuoteReceipt(attempt.receipt,attempt.id))return {...attempt.receipt,alreadyConfirmed:true};
   const form=new FormData();
   for(const [key,value] of Object.entries({source:'configurator_offer',form_id:'neontrip-configurator',name:person.first+' '+person.last,first_name:person.first,last_name:person.last,email:person.email,produkt:'LED Neonschild',nachricht:description,groesse:size,farbe:color,ort:usage,zeit:delivery,request_id:attempt.id,nt_client_submit_id:attempt.id}))if(key!=='zeit'||delivery!=='Termin noch offen')form.append(key,value);
   previews.forEach((blob,i)=>form.append('datei',blob,`NEONTRIP-Entwurf-${i+1}.png`));
   let response,data;
   try{response=await fetchImpl(ENDPOINT,{method:'POST',headers:{'X-Client-Submit-Id':attempt.id},body:form,signal:AbortSignal.timeout(25000)});data=await response.json();}
   catch{throw new Error('Der Eingang konnte nicht bestätigt werden. Bitte nicht mehrfach absenden. Bei einem erneuten Versuch verwenden wir dieselbe Anfragekennung.');}
   if(!response.ok||!confirmedQuoteReceipt(data,attempt.id))throw new Error('Der Eingang wurde noch nicht verbindlich bestätigt. Dein Warenkorb bleibt erhalten. Bitte später erneut versuchen; die Anfragekennung bleibt gleich.');
   try{await saveAttempt(key,{id:attempt.id,receipt:data});}catch{/* Server receipt proves acceptance; never turn it into a failed send. */}
   return data;
  }finally{pending=false;}
 }};
}
