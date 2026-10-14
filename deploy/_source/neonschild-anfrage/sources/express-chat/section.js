// Local, deterministic conversation. No AI/provider requests or data transmission.
export function berlinToday(now = new Date()) {
 const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part = type => parts.find(p => p.type === type).value;
 return `${part('year')}-${part('month')}-${part('day')}`;
}
export function parseDay(value) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
 const [y,m,d] = value.split('-').map(Number), date = new Date(Date.UTC(y,m-1,d));
 return date.getUTCFullYear()===y && date.getUTCMonth()===m-1 && date.getUTCDate()===d ? date : null;
}
const iso = date => date.toISOString().slice(0,10);
export function businessDaysBetween(start,end) {
 const from=parseDay(start),to=parseDay(end);
 if(!from || !to || to<from) return null;
 const span=Math.round((to-from)/86400000);
 let days=Math.floor(span/7)*5;
 for(let i=1;i<=span%7;i++) {const weekday=(from.getUTCDay()+i)%7;if(weekday!==0&&weekday!==6)days++}
 return days;
}
export function classifyDate(start,end) {
 const days=businessDaysBetween(start,end);
 return days===null?'invalid':days>2?'feasible':'call';
}
export function parseDateText(text,today) {
 const value=text.trim().toLocaleLowerCase('de-DE');
 const relative={heute:0,morgen:1,'übermorgen':2,uebermorgen:2};
 if(Object.hasOwn(relative,value)) {const date=parseDay(today);date.setUTCDate(date.getUTCDate()+relative[value]);return iso(date)}
 if(parseDay(value)) return value;
 const match=value.match(/^(\d{1,2})\.(\d{1,2})\.(?:(\d{4}))?$/);
 if(!match) return null;
 const day=`${match[3]||today.slice(0,4)}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
 return parseDay(day)?day:null;
}

export default function init(root) {
 if(!root || root.dataset.initialized) return;
 root.dataset.initialized='true';
 const $=selector=>root.querySelector(selector);
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
 const icon=direction=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',direction==='left'?'m14 5-7 7 7 7':direction==='right'?'m10 5 7 7-7 7':'M3 12h17m-6-6 6 6-6 6');svg.append(p);return svg};
 const button=(text,cls,callback)=>{const b=el('button',cls,text);b.type='button';if(callback)b.addEventListener('click',callback);return b};
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const assets=new URL('./',root.querySelector('.nt-express__advisor').src);
 let scenes=[["google-projects/google-019.webp", "Weiß-pinkes „Iconic Hotel“-Leuchtschild hinter einer Rezeption", "NEONTRIP Kundenprojekt", "Foto aus unserem Google-Profil", "center"], ["google-projects/google-022.webp", "Pinker Schriftzug „There is a light that never goes out“ über einem blauen Sofa", "NEONTRIP Kundenprojekt", "Foto aus unserem Google-Profil", "center"], ["google-projects/google-027.webp", "Weißer „Mayfair“-Schriftzug über Haarwaschbecken in einem Salon", "NEONTRIP Kundenprojekt", "Foto aus unserem Google-Profil", "center"], ["google-projects/google-028.webp", "Gelb-blaue leuchtende Bananenkontur über einem Laptop", "NEONTRIP Kundenprojekt", "Foto aus unserem Google-Profil", "center"]];
 let scene=0,requested=0,sceneRequest=0,outgoing=null,animation=null;
 function settle(){animation?.cancel();animation=null;outgoing?.remove();outgoing=null}
 async function showScene(index) {
  const next=(index+scenes.length)%scenes.length,token=++sceneRequest;requested=next;
  if(next===scene){$('.nt-express__gallery').removeAttribute('aria-busy');return}
  const [file,alt,caption,note,position]=scenes[next],incoming=new Image();incoming.className='nt-express__photo';incoming.alt=alt;incoming.src=new URL(file,assets).href;incoming.style.objectPosition=position;
  $('.nt-express__gallery').setAttribute('aria-busy','true');
  try{await incoming.decode()}catch{if(token===sceneRequest){requested=scene;$('.nt-express__gallery').removeAttribute('aria-busy');$('[data-announcer]').textContent='Das Bild konnte nicht geladen werden.'}return}
  if(token!==sceneRequest)return;
  settle();scene=next;const current=$('.nt-express__photo');current.before(incoming);current.className='nt-express__outgoing';current.alt='';current.setAttribute('aria-hidden','true');outgoing=current;
  $('.nt-express__caption').textContent=caption;$('.nt-express__image-note').textContent=note;$('.nt-express__counter').textContent=`${String(scene+1).padStart(2,'0')} / ${String(scenes.length).padStart(2,'0')}`;
  root.querySelectorAll('[data-scene]').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===scene)));
  $('.nt-express__gallery').removeAttribute('aria-busy');
  if(reduced.matches || document.hidden || !current.animate){settle();return}
  const a=current.animate([{opacity:1},{opacity:0}],{duration:400,easing:'ease-out',fill:'forwards'});animation=a;
  a.finished.then(()=>{if(animation===a)settle()}).catch(()=>{});
 }
 root.querySelectorAll('[data-slide]').forEach(b=>b.addEventListener('click',()=>showScene(requested+Number(b.dataset.slide))));
 root.querySelectorAll('[data-scene]').forEach(b=>b.addEventListener('click',()=>showScene(Number(b.dataset.scene))));
 $('.nt-express__gallery').addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();showScene(requested+(e.key==='ArrowRight'?1:-1))}});
 reduced.addEventListener('change',settle);
 // Load the album only when the section approaches the viewport.
 new IntersectionObserver((entries,observer)=>{
  if(!entries.some(entry=>entry.isIntersecting))return;
  observer.disconnect();
  fetch(new URL('google-projects.json',assets)).then(response=>{if(!response.ok)throw new Error('Photos unavailable');return response.json()}).then(album=>{
   if(!album.photos?.length)return;
   scenes=album.photos.filter(photo=>!['003','017','029','035','052','068','087','096'].some(id=>photo.file==='google-projects/google-'+id+'.webp')).map(photo=>[photo.file,photo.alt,'NEONTRIP Kundenprojekt','Foto aus unserem Google-Profil','center']);
   scene=-1;requested=0;showScene(0);
  }).catch(()=>{});
 },{rootMargin:'600px 0px'}).observe(root);


 const calendarHost=$('[data-calendar]');
 const thread=$('[data-thread]'),widget=$('[data-widget]'),conversation=$('.nt-express__conversation'),composer=$('.nt-express__composer'),textarea=composer.elements.message,fileInput=composer.elements.artwork,error=$('#nt-express-error');
 const dateFormat=new Intl.DateTimeFormat('de-DE',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}),monthFormat=new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric',timeZone:'UTC'});
 const pretty=value=>dateFormat.format(parseDay(value));
 const empty=()=>({date:'',artwork:'',size:'',color:'',delivery:'',email:'',phone:''});
 let draft=empty(),file=null,editing=null,displayed=parseDay(berlinToday());displayed.setUTCDate(1);
 const step=()=>editing||(!draft.date?'date':!draft.artwork?'artwork':!draft.size?'size':!draft.color?'color':!draft.delivery?'delivery':!draft.email?'contact':'review');
 const status=()=>classifyDate(berlinToday(),draft.date);
 const verdict=()=>status()==='feasible'?'Ist machbar. Der zeitliche Vorlauf passt. Die genaue Ausführung stimmen wir anhand Ihres Designs ab.':'Oh, das müssen wir telefonisch einmal besprechen. Es kommt auf Ihr Design an. Laden Sie bitte zuerst alles hoch und rufen Sie uns danach kurz an.';
 const prompts={date:'Wann benötigen Sie Ihr Leuchtschild?',artwork:'Bitte laden Sie Ihr Logo oder Wunschmotiv hoch. Falls Sie noch keine Datei haben, beschreiben Sie kurz Ihre Idee.',size:'Wie groß soll Ihr Leuchtschild ungefähr werden? Die gewünschte Breite und Höhe reichen für den Anfang.',color:'Welche Leuchtfarbe wünschen Sie? Wenn Sie noch unsicher sind, helfen wir Ihnen bei der Auswahl.',delivery:'Wohin soll das Schild geliefert werden? Bitte nennen Sie die Postleitzahl, den Ort und – falls bekannt – die Lieferadresse.',contact:'Wie kann Fabiennes Team Sie erreichen? Bitte ergänzen Sie Ihre E-Mail-Adresse und gerne Ihre Telefonnummer.'};
 function message(text,user=false) {
  const row=el('div','nt-express__message'+(user?' nt-express__message--user':'')),body=el('div','nt-express__message-body');
  if(!user){const avatar=el('img','nt-express__avatar');avatar.src=new URL('fabienne.webp',assets).href;avatar.alt='';avatar.width=33;avatar.height=33;row.append(avatar);body.append(el('span','nt-express__author','Assistenz für Fabiennes Team'))}
  body.append(el('p','nt-express__bubble',text));row.append(body);thread.append(row);
 }
 function setError(text,control=textarea){error.textContent=text;error.hidden=!text;if(text){control?.setAttribute('aria-invalid','true');control?.focus()}else root.querySelectorAll('[aria-invalid=true]').forEach(n=>n.removeAttribute('aria-invalid'))}
 function advance(key,value){draft[key]=value;editing=null;textarea.value='';setError('');render(true)}
 function chooseDate(value) {
  if(classifyDate(berlinToday(),value)==='invalid'){setError('Bitte wählen Sie heute oder einen zukünftigen Tag.');return}
  advance('date',value);
 }
 function calendar(focusDay) {
  calendarHost.replaceChildren();const box=el('div','nt-express__calendar');box.append(el('p','nt-express__calendar-title','Wählen Sie Ihren Wunsch-Liefertag'));
  const nav=el('div','nt-express__month-nav'),today=berlinToday(),current=parseDay(today),prev=button('',null,()=>{displayed.setUTCMonth(displayed.getUTCMonth()-1);calendar()}),next=button('',null,()=>{displayed.setUTCMonth(displayed.getUTCMonth()+1);calendar()});prev.setAttribute('aria-label','Vorheriger Monat');next.setAttribute('aria-label','Nächster Monat');prev.append(icon('left'));next.append(icon('right'));prev.disabled=displayed.getUTCFullYear()===current.getUTCFullYear()&&displayed.getUTCMonth()===current.getUTCMonth();nav.append(prev,el('strong','',monthFormat.format(displayed)),next);box.append(nav);
  const weekdays=el('div','nt-express__weekdays');weekdays.setAttribute('aria-hidden','true');['Mo','Di','Mi','Do','Fr','Sa','So'].forEach(d=>weekdays.append(el('span','',d)));box.append(weekdays);
  const days=el('div','nt-express__days');days.setAttribute('role','group');days.setAttribute('aria-label',monthFormat.format(displayed));
  const offset=(displayed.getUTCDay()+6)%7,total=new Date(Date.UTC(displayed.getUTCFullYear(),displayed.getUTCMonth()+1,0)).getUTCDate();
  for(let i=0;i<offset;i++){const blank=el('span');blank.setAttribute('aria-hidden','true');days.append(blank)}
  for(let d=1;d<=total;d++) {
   const value=iso(new Date(Date.UTC(displayed.getUTCFullYear(),displayed.getUTCMonth(),d))),b=button(String(d),'nt-express__day',()=>chooseDate(value));b.dataset.date=value;b.disabled=value<today;b.setAttribute('aria-label',pretty(value));b.setAttribute('aria-pressed',String(value===draft.date));if(value===today)b.setAttribute('aria-current','date');days.append(b);
  }
  days.addEventListener('keydown',e=>{
   const b=e.target.closest('[data-date]');if(!b)return;let date=parseDay(b.dataset.date);const movement={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
   if(e.key in movement)date.setUTCDate(date.getUTCDate()+movement[e.key]);
   else if(e.key==='Home')date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
   else if(e.key==='End')date.setUTCDate(date.getUTCDate()+6-(date.getUTCDay()+6)%7);
   else return;e.preventDefault();if(iso(date)<today)date=parseDay(today);displayed=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1));calendar(iso(date));
  });
  box.append(days,el('p','nt-express__calendar-note','Mehr als 2 Werktage Vorlauf: ist machbar. Kurzfristiger: bitte telefonisch abstimmen. Werktage: Montag–Freitag.'));calendarHost.append(box);
  if(focusDay)days.querySelector(`[data-date="${focusDay}"]`)?.focus({preventScroll:true});
 }
 function edit(key){editing=key==='email'||key==='phone'?'contact':key;textarea.value=['size','color','delivery'].includes(editing)?draft[editing]:'';if(editing==='date'){displayed=parseDay(draft.date);displayed.setUTCDate(1)}setError('');render(true)}
 function contactForm(){
  const form=el('form','nt-express__contact-form');form.noValidate=true;
  for(const [name,label,type,auto] of [['email','E-Mail-Adresse','email','email'],['phone','Telefonnummer (optional)','tel','tel']]){
   const wrap=el('label','nt-express__field',label),input=el('input');input.name=name;input.type=type;input.autocomplete=auto;input.required=name==='email';input.value=draft[name];input.maxLength=name==='email'?254:80;input.setAttribute('aria-describedby','nt-express-error');wrap.append(input);form.append(wrap);
  }
  const submit=el('button','nt-express__pill','Anfrage zusammenstellen');submit.type='submit';submit.append(icon());form.append(submit);
  form.addEventListener('submit',e=>{e.preventDefault();const mail=form.elements.email;if(!mail.validity.valid||!mail.value.trim()){setError('Bitte geben Sie eine gültige E-Mail-Adresse ein.',mail);return}draft.email=mail.value.trim();draft.phone=form.elements.phone.value.trim();editing=null;setError('');render(true)});widget.append(form);
 }
 const labels={date:'Wunschtermin',artwork:'Logo / Motiv',size:'Größe',color:'Leuchtfarbe',delivery:'Lieferort',email:'E-Mail',phone:'Telefon'};
 function summary(){
  const box=el('div','nt-express__summary');box.append(el('h3','','Ihr Anfrageentwurf'),el('p','','Prüfen Sie Ihre Angaben und übernehmen Sie sie in das Kontaktformular.'));
  const dl=el('dl');Object.entries(labels).forEach(([key,label])=>{const row=el('div','nt-express__summary-row');row.append(el('dt','',label),el('dd','',key==='date'?pretty(draft.date):draft[key]||'Nicht angegeben'),button('Ändern','',()=>edit(key)));dl.append(row)});box.append(dl);
  if(status()!=='feasible'){const call=el('a','nt-express__pill','Jetzt kurz anrufen');call.href='tel:+4921154257240';call.append(icon());box.append(call,el('p','nt-express__calendar-note','Bitte halten Sie Ihr Motiv und die Angaben aus Ihrer Anfrage bereit.'))}
  box.append(button('Anfrage abschließen','nt-express__pill',()=>{
    const target=document.querySelector('#nt-classic-form');
    target.elements.email.value=draft.email;target.elements.telefon.value=draft.phone;
    target.elements.nachricht.value=['Express-Anfrage',...Object.entries(labels).map(([key,label])=>`${label}: ${key==='date'?pretty(draft.date):draft[key]||'Nicht angegeben'}`)].join('\n');
    if(file){const dt=new DataTransfer();dt.items.add(file);target.querySelector('[type=file]').files=dt.files;target.querySelector('[type=file]').dispatchEvent(new Event('change',{bubbles:true}));}
    target.dispatchEvent(new Event('input',{bubbles:true}));
    target.scrollIntoView({behavior:reduced.matches?'instant':'smooth',block:'start'});target.elements.vorname.focus({preventScroll:true});
  }));
  box.lastElementChild.dataset.croCta='express_request';
  box.lastElementChild.dataset.croSectionId='express';
  box.append(button('Zusammenfassung speichern','nt-express__quick-download',download));box.lastElementChild.className='nt-express__edit';
  box.append(button('Neue Anfrage beginnen','nt-express__reset',()=>{draft=empty();editing=null;file=null;fileInput.value='';textarea.value='';displayed=parseDay(berlinToday());displayed.setUTCDate(1);setError('');render(false);conversation.scrollTop=0}));widget.append(box);
 }
 function download(){
  const text=['NEONTRIP – Express-Anfrageentwurf',...Object.entries(labels).map(([key,label])=>`${label}: ${key==='date'?pretty(draft.date):draft[key]||'Nicht angegeben'}`),'','Terminprüfung: '+(status()==='feasible'?'Mehr als zwei Werktage Vorlauf – nach Vorgabe machbar. Design persönlich abstimmen.':'Telefonische Abstimmung erforderlich.'),'Eine ausgewählte Datei wird nicht in diese Textdatei eingebettet.'].join('\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=el('a');a.href=url;a.download='NEONTRIP-Express-Anfrage.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 let busy=false,revealTimer,revision=0;
 function revealNewMessages(oldCount,focus){
  clearTimeout(revealTimer);const token=++revision,typing=$('[data-typing]');
  const fresh=[...thread.children].slice(oldCount),queue=fresh.filter(row=>!row.classList.contains('nt-express__message--user'));
  if(!queue.length||reduced.matches){typing.hidden=true;busy=false;return}
  queue.forEach(row=>row.hidden=true);busy=true;widget.hidden=true;textarea.disabled=true;$('.nt-express__send').disabled=true;fileInput.disabled=true;
  function next(){
   if(token!==revision)return;
   const row=queue.shift();
   if(!row){typing.hidden=true;widget.hidden=false;busy=false;const current=step();textarea.disabled=current==='contact'||current==='review';$('.nt-express__send').disabled=textarea.disabled;fileInput.disabled=false;requestAnimationFrame(()=>{conversation.scrollTop=conversation.scrollHeight;if(focus){if(!textarea.disabled)textarea.focus({preventScroll:true});else widget.querySelector('input')?.focus({preventScroll:true})}});return}
   row.before(typing);typing.hidden=false;
   conversation.scrollTo({top:conversation.scrollHeight,behavior:'auto'});
   revealTimer=setTimeout(()=>{if(token!==revision)return;row.hidden=false;row.after(typing);$('[data-announcer]').textContent=row.textContent;next();},750);
  }
  next();
 }
 function render(focus=false){
  const typing=$('[data-typing]');conversation.insertBefore(typing,widget);widget.hidden=false;fileInput.disabled=false;
  const oldCount=thread.children.length,current=step();thread.replaceChildren();widget.replaceChildren();
  message(prompts.date);
  if(draft.date){message(`Mein Wunschtermin: ${pretty(draft.date)}.`,true);message(verdict());}
  for(const key of ['artwork','size','color','delivery']){
   if(draft[key]){message(prompts[key]);message(draft[key],true)}
  }
  if(draft.email){message(prompts.contact);message([draft.email,draft.phone].filter(Boolean).join('\n'),true)}
  if(current!=='date'&&current!=='review')message(editing?'Bitte ändern Sie Ihre Angabe. '+prompts[current]:prompts[current]);
  calendar();
  if(current==='artwork'){
   const quick=el('div','nt-express__quick');quick.append(button(file?'Anderes Logo auswählen':'Logo auswählen','',()=>fileInput.click()));widget.append(quick);widget.append(el('p','nt-express__calendar-note','PNG, JPG, WebP, SVG, PDF, AI oder EPS · maximal 20 MB. Alternativ können Sie Ihr Motiv unten beschreiben.'));
  } else if(current==='color'){
   const quick=el('div','nt-express__quick');['Warmweiß','Kaltweiß','Pink','Noch offen'].forEach(value=>quick.append(button(value,'',()=>advance('color',value))));widget.append(quick);
  } else if(current==='size'){
   const quick=el('div','nt-express__quick');quick.append(button('Größe noch offen','',()=>advance('size','Größe noch offen – bitte beraten')));widget.append(quick);
  } else if(current==='contact')contactForm();
  else if(current==='review'){
   message(status()==='feasible'?'Danke, Ihre Angaben sind vollständig zusammengestellt. Die genaue Umsetzung wird anhand Ihres Designs abgestimmt.':'Danke, Ihre Angaben sind zusammengestellt. Bitte rufen Sie jetzt kurz an, damit Fabiennes Team Ihren kurzfristigen Termin und das Design persönlich mit Ihnen abstimmen kann.');summary();
  }
  const hints={date:'Zum Beispiel „morgen“ – oder oben im Kalender wählen …',artwork:'Beschreiben Sie Ihr Motiv – oder hängen Sie Ihr Logo an …',size:'Zum Beispiel 120 cm breit und 50 cm hoch …',color:'Welche Leuchtfarbe wünschen Sie?',delivery:'PLZ, Ort und gegebenenfalls Lieferadresse …',contact:'Bitte tragen Sie Ihre Kontaktdaten oben ein.',review:'Ihre Anfrage ist zusammengestellt.'};
  textarea.placeholder=hints[current];textarea.disabled=current==='contact'||current==='review';$('.nt-express__send').disabled=textarea.disabled;
  $('.nt-express__attach span').textContent=file?'Logo ersetzen':'Logo anhängen';
  if(reduced.matches)$('[data-announcer]').textContent=(current==='review'?'Ihr Anfrageentwurf ist bereit.':current==='artwork'?verdict()+' '+prompts.artwork:prompts[current]);
  revealNewMessages(oldCount,focus);
  if(focus)requestAnimationFrame(()=>{conversation.scrollTo({top:conversation.scrollHeight,behavior:reduced.matches?'instant':'smooth'});if(!textarea.disabled)textarea.focus({preventScroll:true});else if(current==='contact')widget.querySelector('input')?.focus({preventScroll:true})});
 }
 composer.addEventListener('submit',e=>{
  e.preventDefault();if(busy)return;const value=textarea.value.trim(),current=step();if(current==='contact'||current==='review')return;
  if(!value){setError('Bitte ergänzen Sie Ihre Angabe.');return}
  if(current==='date'){const day=parseDateText(value,berlinToday());if(!day){setError('Bitte wählen Sie ein Datum im Kalender oder schreiben Sie z. B. „morgen“ oder „02.10.2026“.');return}chooseDate(day);return}
  if(value.length<2){setError('Bitte beschreiben Sie Ihre Angabe etwas genauer.');return}
  if(current==='artwork'){file=null;fileInput.value=''}advance(current,value);
 });
 textarea.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();composer.requestSubmit()}});
 textarea.addEventListener('input',()=>setError(''));
 fileInput.addEventListener('change',()=>{
  const next=fileInput.files[0];if(!next)return;
  if(next.size>20*1024*1024 || !/\.(png|jpe?g|webp|svg|pdf|ai|eps)$/i.test(next.name)){fileInput.value='';setError('Bitte wählen Sie PNG, JPG, WebP, SVG, PDF, AI oder EPS mit maximal 20 MB.');return}
  file=next;draft.artwork='Datei: '+next.name;
  if(editing==='artwork')editing=null;
  setError('');render(true);
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden)settle();syncMotion()});
 calendar();
 new IntersectionObserver((entries,observer)=>{if(entries.some(e=>e.isIntersecting)){render(false);observer.disconnect()}},{threshold:0.08}).observe(root);

 // Original 5-star Google review excerpts, checked on 05.10.2026.
 const reviews=[
  ['Christoph Reichardt','Wirklich gute Qualität (v.a. für Veranstaltungen), schöner Look und unglaublich schnelle Produktions- und Versandabwicklung.','google-reviewer-1.jpg'],
  ['Dina Tarus','Besonders gefreut hat mich die schnelle Lieferung – meine Bestellung kam sogar früher als erwartet an.','google-reviewer-2.jpg'],
  ['Kerstin Kubalski','Wir sind sehr zufrieden und es ist genau so geworden, wie sich unser Sohn es erhofft hat!','google-reviewer-3.jpg']
 ];
 let review=0,visible=false,lastPhoto=Date.now(),lastReview=Date.now(),proofPaused=false;
 function showReview(index){
  review=(index+reviews.length)%reviews.length;
  $('[data-review-name]').textContent=reviews[review][0];$('[data-review-avatar]').src=new URL(reviews[review][2],assets).href;$('[data-review-avatar]').alt='Profilbild von '+reviews[review][0];$('[data-review-quote]').textContent='„'+reviews[review][1]+'“';$('[data-review-count]').textContent=`0${review+1} / 03`;
  if(!reduced.matches)$('.nt-express__review').animate([{opacity:.25,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:300});
 }
 root.querySelectorAll('[data-review-step]').forEach(b=>b.addEventListener('click',()=>{showReview(review+Number(b.dataset.reviewStep));lastReview=Date.now()}));
 root.querySelectorAll('[data-slide]').forEach(b=>b.addEventListener('click',()=>lastPhoto=Date.now()));
 function syncMotion(){
  root.classList.toggle('is-motion-paused',reduced.matches||!visible||document.hidden);
 }
 reduced.addEventListener('change',syncMotion);
 new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;lastPhoto=lastReview=Date.now();syncMotion()},{threshold:0.08}).observe(root);
 syncMotion();
 const autoplay=setInterval(()=>{
  if(!root.isConnected){clearInterval(autoplay);clearTimeout(revealTimer);return}
  const now=Date.now();
  if(proofPaused||reduced.matches||!visible||document.hidden||root.matches(':hover')||root.contains(document.activeElement)){lastPhoto=lastReview=now;return}
  if(now-lastPhoto>=5200){showScene(requested+1);lastPhoto=now}
  if(now-lastReview>=8200){showReview(review+1);lastReview=now}
 },500);

}
