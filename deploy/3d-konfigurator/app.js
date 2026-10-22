import {initMobileInput} from './mobile-input.js?v=38';
import {createRalPicker} from './ral-picker.js?v=35';
import {DEFAULT,SIGN_PROTECTION,LABELS,FONTS,COLORS,ACRYLICS,FINISHES,activeFinish,classicLook,finishDescription,paintDescription,choosePaint,PAINT_PRESETS,PAINT_FIELDS,normalize,validate,description} from './model.js?v=44';
import {quote3D,railColorEstimate} from './pricing.js';
import {CART_KEY,MAX_CART_ITEMS,cartEntry,restoreCart,storeCart,safePreview} from './cart.js?v=44';
import {createDraftSync,newDraftToken} from './draft-sync.js?v=44';
import {prepareCheckout3D} from './checkout-contract.js?v=44';
import {DELIVERY_LABEL,DELIVERY_NOTE} from './delivery.js?v=41';
const $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
let mobileInput=null;
const DRAFT_KEY='neontrip-3d-draft-v1';
let savingDesign=false;
let remoteTimer,remoteStatus='local';
const restoreToken=new URLSearchParams(location.hash.slice(1)).get('entwuerfe');
if(restoreToken)history.replaceState(null,'',location.pathname+location.search);
const draftSync=createDraftSync({storage:localStorage,onState:renderStorageStatus});
let state={...DEFAULT},cart=[],activeStep=0,activeChoice='',renderer,result=null,revision=0,debounce,editingId=null,returnToReview=false;
try{const draft=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');if([1,2,3].includes(draft?.version)){state=normalize(draft);editingId=typeof draft.cartItemId==='string'?draft.cartItemId:null;}}catch{$('#saved-status').textContent='Der gespeicherte Entwurf konnte nicht geladen werden.';}
try{cart=restoreCart(JSON.parse(localStorage.getItem(CART_KEY)||'[]'));}catch{$('#saved-status').textContent='Der gespeicherte Warenkorb konnte nicht geladen werden.';}
if(!cart.some(item=>item.id===editingId))editingId=null;
function persistDraft(){try{localStorage.setItem(DRAFT_KEY,JSON.stringify({...state,cartItemId:editingId}));$('#saved-status').textContent='Dein Entwurf ist auf diesem Gerät gespeichert.';}catch{$('#saved-status').textContent='Speichern auf diesem Gerät nicht möglich. Nutze „Bild speichern“.';}}
function persistCart(){const saved=storeCart(localStorage,cart);scheduleRemoteSave();return saved;}
function scheduleRemoteSave(){clearTimeout(remoteTimer);renderStorageStatus({status:'pending'});remoteTimer=setTimeout(()=>draftSync.save(cart).catch(()=>{}),700);}
for(const el of all('[data-sign-protection]'))el.textContent=SIGN_PROTECTION;
for(const el of all('[data-delivery-label]'))el.textContent=DELIVERY_LABEL;
for(const el of all('[data-delivery-note]'))el.textContent=DELIVERY_NOTE;
function syncDetail(){const shown=Boolean(renderer?.closeup);$('#detail-note').hidden=!shown;$('#detail-note').textContent=state.lighting==='back'?'Detailansicht · Edelstahl vorne, ca. 1 cm leuchtendes Acryl direkt dahinter.':'Detailansicht · Leuchtende Acrylfront auf dem Edelstahlkorpus.';}
function setPressed(selector,value,key){for(const el of all(selector))el.setAttribute('aria-pressed',String(el.dataset[key]===String(value)));}
const euro=value=>(value/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
function railPriceNote(design,quantity=1){const e=railColorEstimate(design,quantity);return e?`Farbaufpreis Schiene: ca. ${euro(e.totalCents)} (${e.metres.toLocaleString('de-DE')} m × ca. 110 €/m${quantity>1?' × '+quantity+' Stück':''}). Gesamtpreis folgt.`:'';}
function syncRail(){
 $('#rail-settings').hidden=state.mount!=='rail';$('#rail-color-settings').hidden=!state.railCustomColor;setPressed('[data-rail-finish]',state.railCustomColor?'custom':'standard','railFinish');$('#rail-color-price').textContent=railPriceNote(state);
}
function sync(){
 $('#sign-text').value=state.text;$('#width').value=state.width;$('#width-range').value=state.width;$('#spacing').value=state.spacing;
 $('.look-text').classList.toggle('is-multiline',state.text.includes('\n'));
 $('#char-count').textContent=`${state.text.length} / 60`;$('#spacing-label').textContent=state.spacing+' %';
 for(const key of ['font','lighting','mount','wall','depth','usage'])setPressed(`[data-${key}]`,state[key],key);
 setPressed('[data-color]',state.color,'color');setPressed('[data-acrylic]',state.acrylic,'acrylic');setPressed('[data-finish]',activeFinish(state),'finish');
 $('#color-name').textContent=COLORS.find(c=>c[0]===state.color)?.[1];
 $('#acrylic-color').value=state.acrylic;$('#acrylic-value').textContent=state.acrylic.toUpperCase();$('#acrylic-name').textContent=ACRYLICS.find(c=>c[0]===state.acrylic)?.[1]||'Eigene Farbe';
 syncPaints();$('#reset-side').disabled=state.sideColor===DEFAULT.sideColor&&!state.sideRal;
 $('#paint-settings').hidden=state.lighting==='front'||!['painted-steel','brushed-gold'].includes(activeFinish(state));
 const front=state.lighting==='front';$('#acrylic-settings').hidden=!front;$('#halo-settings').hidden=front;$('#surface-settings').hidden=front;$('#side-settings').hidden=!front;$('#surface-title').textContent='Metallfront & Korpus';$('#build-title').textContent=front?'Licht & Seitenfarbe.':'Deine Oberfläche. Dein Stil.';
 $('#classic-look-note').textContent=front?'Weißes Licht · schwarze Seiten':'Edelstahl, gold lackiert · warmweißes Licht';
 $('#reset-look').disabled=front?state.sideColor===DEFAULT.sideColor&&!state.sideRal&&state.acrylic===DEFAULT.acrylic:state.backFinish===DEFAULT.backFinish&&state.color===DEFAULT.color;
 $('#material-note').textContent=finishDescription(state)+'. '+(front?'Korpus und Rückseite aus Edelstahl.':'Hinten ca. 1 cm weißes, opales Acryl in Buchstabenform mit innenliegenden LEDs.');$('#construction-note').textContent=front?'Leuchtende Acrylfront · Edelstahlkorpus mit lackierten Seiten · LEDs innen.':finishDescription(state)+' · ca. 1 cm weißes Acryl hinten · Licht zur Wand.';$('#caption-material').textContent=front?'Seiten '+paintDescription(state,'sideColor'):FINISHES[activeFinish(state)].label;
 syncDetail();syncRail();$('#plate-settings').hidden=state.mount!=='plate';$('#light').setAttribute('aria-pressed',String(state.lightOn));$('#light').textContent=state.lightOn?'Licht an':'Licht aus';$('#night').setAttribute('aria-pressed',String(state.night));$('#night').textContent=state.night?'Tagansicht':'Nachtansicht';document.body.classList.toggle('night-mode',state.night);
 $('#caption-light').textContent=LABELS.lighting[state.lighting];$('#caption-mount').textContent=LABELS.mount[state.mount];$('#caption-depth').textContent=state.depth+' cm Tiefe';
 $('#cart-count').textContent=cart.reduce((sum,item)=>sum+item.quantity,0);syncChoices();step(activeStep,false);
}
function change(key,value){state[key]=value;if(key==='mount'&&value!=='rail'&&$('[data-view=mounting]').getAttribute('aria-pressed')==='true'){renderer?.view('perspective');setPressed('[data-view]','perspective','view');}sync();schedule();}
function pendingPaint(){const keys=state.lighting==='front'?['sideColor']:['brushed-gold','painted-steel'].includes(state.backFinish)?['body']:[];if(state.mount==='rail'&&state.railCustomColor)keys.push('railColor');if(state.mount==='plate')keys.push('plate');return keys.some(key=>ralPickers[key]?.pending);}
function syncAvailability(){const blocked=!result||Boolean(validate(state))||pendingPaint();$('#next').disabled=blocked;$('[data-step="3"]').disabled=blocked;$('#download').disabled=blocked;}
function setError(message){$('#sign-text').setAttribute('aria-invalid',String(!state.text.trim()||state.text.split('\n').length>2));$('#width').setAttribute('aria-invalid',String(!Number.isFinite(state.width)||state.width<30||state.width>400));$('#editor-error').textContent=message;$('#loading').hidden=!message;if(message)$('#loading').textContent=message;$('#next').disabled=Boolean(message)||!result;$('#download').disabled=Boolean(message)||!result;$('[data-step="3"]').disabled=Boolean(message)||!result;}
function schedule(){clearTimeout(debounce);++revision;result=null;$('#next').disabled=true;$('#download').disabled=true;$('[data-step="3"]').disabled=true;debounce=setTimeout(update,100);}
async function update(){
 const token=++revision;result=null;
 const search=pendingPaint();if(search){$('#editor-error').textContent='';$('#next').disabled=true;$('#download').disabled=true;return;}
 const error=validate(state);if(error){setError(error);return;}
 if(!renderer)return;
 $('#next').disabled=true;$('#download').disabled=true;
 try{
  const dimensions=await renderer.update({...state});if(token!==revision||!dimensions)return;
  result=dimensions;setError('');$('#layer-note').hidden=!dimensions.layerEmphasis;const height=dimensions.height.toLocaleString('de-DE',{maximumFractionDigits:1});
  $('#height-label').textContent=height+' cm';$('#dimensions').textContent=`Schriftzug ${state.width} × ${height} cm${state.mount==='plate'?` · Platte ${dimensions.overallWidth.toLocaleString('de-DE')} × ${dimensions.overallHeight.toLocaleString('de-DE',{maximumFractionDigits:1})} cm`:''}`;
  $('#canvas-host').setAttribute('aria-label',`${state.text}, ${LABELS.lighting[state.lighting]}, ${LABELS.mount[state.mount]}, ${finishDescription(state)}, ${state.width} mal ${height} Zentimeter. Mit Ziehen drehen oder die Ansichtsschalter verwenden.`);
  if(activeStep===3)renderReview();syncAvailability();persistDraft();
 }catch(e){if(token!==revision)return;result=null;setError(e.message||'Die Vorschau konnte nicht geladen werden. Bitte lade die Seite neu.');}
}
function renderReview(){
 if(!result)return;
 const host=$('#review-summary');host.replaceChildren();
 const cm=n=>n.toLocaleString('de-DE',{maximumFractionDigits:1})+' cm';
 const sections=[
  {title:'Dein Look',step:0,rows:[['Text',state.text],['Lichtart',LABELS.lighting[state.lighting]],['Schrift',LABELS.font[state.font]]]},
  {title:'Farben & Material',step:1,rows:state.lighting==='front'?[
   ['Leuchtfarbe',(ACRYLICS.find(c=>c[0]===state.acrylic)?.[1]||'Eigene Farbe')+' · '+state.acrylic.toUpperCase()],['Seiten','Edelstahl · '+paintDescription(state,'sideColor')]
  ]:[['Oberfläche',finishDescription(state)],['Leuchtfarbe',COLORS.find(c=>c[0]===state.color)?.[1]],['Rückseite','Ca. 1 cm weißes Acryl mit LEDs']]},
  {title:'Größe & Montage',step:2,rows:[['Einsatzort',LABELS.usage[state.usage]],['Schutzart des Schilds',SIGN_PROTECTION],['Breite × Höhe',cm(state.width)+' × '+cm(result.height)],['Buchstabentiefe',cm(state.depth)],['Montage',LABELS.mount[state.mount]],['Buchstabenabstand',state.spacing+' %']]}
 ];
 if(state.mount==='rail')sections[2].rows.push(['Schiene',state.railCustomColor?paintDescription(state,'railColor'):'Standardausführung']);
 if(state.mount==='plate')sections[2].rows.push(['Plattenmaß',cm(result.overallWidth)+' × '+cm(result.overallHeight)],['Plattenfarbe',paintDescription(state,'plate')]);
 for(const section of sections){
  const card=document.createElement('section'),header=document.createElement('div'),title=document.createElement('h3'),edit=document.createElement('button'),list=document.createElement('dl');card.className='review-card';header.className='review-card-heading';title.textContent=section.title;edit.textContent='Ändern';edit.setAttribute('aria-label',section.title+' ändern');edit.addEventListener('click',()=>{returnToReview=true;step(section.step);});header.append(title,edit);card.append(header);
  for(const [label,value] of section.rows){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);list.append(row);}card.append(list);host.append(card);
 }
 const estimate=railPriceNote(state);if(estimate){const note=document.createElement('p');note.className='rail-review-note';note.textContent=estimate+' Nur der Farbaufpreis, kein Gesamtpreis.';host.append(note);}
}
function step(index,focus=true){
 if(index===3&&(!result||validate(state)||pendingPaint()))return;
 if(focus&&activeChoice){activeChoice='';syncChoices();syncPreviewSize();}
 activeStep=Math.min(3,Math.max(0,index));
 for(const button of all('[data-step]')){if(Number(button.dataset.step)===activeStep)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
 for(let i=0;i<4;i++)$('#panel-'+i).hidden=i!==activeStep;
 $('#step-label').textContent=`Schritt ${activeStep+1} von 4`;$('#step-progress').style.width=((activeStep+1)*25)+'%';
 $('#previous').hidden=activeStep===0&&!activeChoice;$('#previous').setAttribute('aria-label',activeChoice?'Zur Übersicht':'Vorheriger Schritt');
 const label=activeChoice?'Auswahl übernehmen':activeStep===3?(editingId?'Änderungen speichern':'Entwurf in den Warenkorb'):returnToReview?'Änderungen prüfen':['Weiter zu den Farben','Weiter zur Größe','Entwurf prüfen'][activeStep];
 $('#next').replaceChildren(document.createTextNode(label));const arrow=document.createElement('span');arrow.textContent='→';$('#next').append(arrow);
 if(activeStep===3){returnToReview=false;renderReview();}
 if(focus){const focusPanel=()=>{const title=$('#panel-'+activeStep+' h2');title.tabIndex=-1;title.focus({preventScroll:true});$('.controls').scrollIntoView({behavior:matchMedia('(max-width:979px), (prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'});};if(mobileInput)mobileInput.finish(focusPanel);else focusPanel();}
}
const paintControls={
 sideColor:{id:'side',label:'Seiten'},body:{id:'body',label:'Front und Korpus'},railColor:{id:'rail',label:'Schiene'},plate:{id:'plate',label:'Trägerplatte'}
};
const ralPickers={};
function syncPaints(){
 for(const [key,{id}] of Object.entries(paintControls)){
  const field=PAINT_FIELDS[key],gold=key==='body'&&state.backFinish==='brushed-gold',hex=gold?FINISHES['brushed-gold'].color:state[key],value=gold?'':state[field];
  $('#'+id+'-color').value=hex;$('#'+id+'-value').textContent=hex.toUpperCase();
  ralPickers[key].sync(value);
  for(const button of all(`[data-paint-preset="${key}"]`))button.setAttribute('aria-pressed',String(!value&&button.dataset.paintColor===hex));
 }
}
for(const [key,{id,label}] of Object.entries(paintControls)){
 const host=$(`[data-paint-key="${key}"]`);
 host.innerHTML=`<div class="swatches paint-swatches" aria-label="Standardfarben ${label}"></div><label class="custom-color" for="${id}-color"><input type="color" id="${id}-color" aria-label="Eigene Lackfarbe ${label}"><span>Eigene Farbe wählen <output id="${id}-value" for="${id}-color"></output></span></label><div class="ral-control" id="${id}-ral-picker"></div>`;
 for(const [color,name] of PAINT_PRESETS){
  const button=document.createElement('button');button.type='button';button.dataset.paintPreset=key;button.dataset.paintColor=color;button.setAttribute('aria-label',name);button.style.setProperty('--swatch',color);button.style.setProperty('--tick',name==='Schwarz'?'#fff':'#292524');
  const chip=document.createElement('span');chip.className='swatch-chip';chip.setAttribute('aria-hidden','true');const text=document.createElement('span');text.className='swatch-label';text.textContent=name;button.append(chip,text);
  button.addEventListener('click',()=>{state=choosePaint(state,key,{color});sync();schedule();});host.querySelector('.paint-swatches').append(button);
 }
 $('#'+id+'-color').addEventListener('input',event=>{state=choosePaint(state,key,{color:event.target.value});sync();schedule();});
 ralPickers[key]=createRalPicker({host:$('#'+id+'-ral-picker'),id,label,
  onSelect:ral=>{state=choosePaint(state,key,{ral});sync();schedule();},
  onClear:()=>{state[PAINT_FIELDS[key]]='';sync();schedule();},onPendingChange:schedule
 });
}
for(const [target,key,choices] of [['#light-colors','color',COLORS],['#acrylic-colors','acrylic',ACRYLICS]]){
 for(const [value,label] of choices){const button=document.createElement('button');button.type='button';button.dataset[key]=value;button.style.setProperty('--swatch',value);button.title=label;button.setAttribute('aria-label',label);const chip=document.createElement('span');chip.className='swatch-chip';chip.setAttribute('aria-hidden','true');const name=document.createElement('span');name.className='swatch-label';name.textContent=label;button.append(chip,name);const rgb=value.slice(1).match(/../g).map(x=>parseInt(x,16)/255);button.style.setProperty('--tick',rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722<.5?'#fff':'#292524');button.addEventListener('click',()=>change(key,value));$(target).append(button);}
}
for(const [id,finish] of Object.entries(FINISHES)){
 const b=document.createElement('button');b.type='button';b.dataset.finish=id;const sample=document.createElement('span');sample.className='finish-sample '+id;sample.setAttribute('aria-hidden','true');const name=document.createElement('strong');name.textContent=finish.label;b.append(sample,name);b.addEventListener('click',()=>change('backFinish',id));$('#finish-options').append(b);
}
for(const [id,font] of Object.entries(FONTS)){
 const button=document.createElement('button');button.type='button';button.dataset.font=id;button.setAttribute('aria-label',font.label+' · '+font.style);
 const sample=document.createElement('img');sample.src='./fonts/'+id+'.svg';sample.alt='';sample.width=74;sample.height=30;
 const name=document.createElement('span');name.textContent=font.label;const detail=document.createElement('small');detail.textContent=font.style;
 button.append(sample,name,detail);$('#font-options').append(button);
}
// Keep each step an overview. Open one full palette in place, beside the live
// preview, instead of stacking every font/material/colour control vertically.
const choices={
 'font-settings':{label:'Schrift',value:()=>LABELS.font[state.font],image:()=>`./fonts/${state.font}.svg`},
 'halo-settings':{label:'Leuchtfarbe',value:()=>COLORS.find(c=>c[0]===state.color)?.[1],color:()=>state.color},
 'acrylic-settings':{label:'Leuchtfarbe',value:()=>ACRYLICS.find(c=>c[0]===state.acrylic)?.[1]||'Eigene Farbe',color:()=>state.acrylic},
 'surface-settings':{label:'Oberfläche',value:()=>FINISHES[activeFinish(state)].label,finish:()=>activeFinish(state)},
 'paint-settings':{label:'Lackfarbe · Front & Korpus',value:()=>state.backFinish==='brushed-gold'?'Gold gebürstet':paintDescription(state,'body'),color:()=>state.backFinish==='brushed-gold'?FINISHES['brushed-gold'].color:state.body},
 'side-settings':{label:'Lackfarbe · Seiten',value:()=>paintDescription(state,'sideColor'),color:()=>state.sideColor}
};
for(const [id,choice] of Object.entries(choices)){
 const field=$('#'+id),button=document.createElement('button');field.classList.add('choice-detail');
 button.type='button';button.className='choice-row';button.dataset.choice=id;button.setAttribute('aria-controls',id);button.setAttribute('aria-expanded','false');
 button.innerHTML='<span class="choice-sample" aria-hidden="true"></span><span class="choice-copy"><small></small><strong></strong></span><span class="choice-arrow" aria-hidden="true">›</span>';
 button.querySelector('small').textContent=choice.label;field.before(button);button.addEventListener('click',()=>openChoice(id));choice.button=button;
}
// Light is the first choice in both variants; material/paint follow below it.
for(const id of ['acrylic-settings','halo-settings'])$('#panel-1 .panel-heading').after(choices[id].button,$('#'+id));
for(const panel of [$('#panel-0'),$('#panel-1')]){
 const heading=document.createElement('div');heading.className='picker-heading';heading.innerHTML='<button type="button" class="choice-back" aria-label="Zur Übersicht">←</button><h3 tabindex="-1"></h3>';
 heading.querySelector('button').addEventListener('click',()=>openChoice(''));panel.prepend(heading);
}
function syncChoices(){
 if(activeChoice&&$('#'+activeChoice).hidden)activeChoice='';
 for(const [id,choice] of Object.entries(choices)){
  const button=choice.button,field=$('#'+id);button.hidden=field.hidden;button.setAttribute('aria-expanded',String(activeChoice===id));field.classList.toggle('is-open',activeChoice===id);
  button.querySelector('strong').textContent=choice.value();const sample=button.querySelector('.choice-sample');
  if(choice.image){let image=sample.querySelector('img');if(!image){image=document.createElement('img');image.alt='';sample.append(image);}image.src=choice.image();}
  if(choice.color)sample.style.background=choice.color();
  if(choice.finish)sample.className='choice-sample finish-sample '+choice.finish();
 }
 for(const panel of [$('#panel-0'),$('#panel-1')]){const open=activeChoice&&panel.contains($('#'+activeChoice));panel.classList.toggle('picker-open',Boolean(open));if(open)panel.querySelector('.picker-heading h3').textContent=choices[activeChoice].label;}
 $('.controls').classList.toggle('choice-open',Boolean(activeChoice));
}
function openChoice(id){
 const previous=activeChoice;
 const apply=()=>{
  activeChoice=id;syncChoices();step(activeStep,false);syncPreviewSize();
  const target=id?$('#panel-'+activeStep+' .picker-heading h3'):choices[previous]?.button;
  target?.focus({preventScroll:true});$('.controls').scrollIntoView({block:'start',behavior:'instant'});
 };
 if(mobileInput)mobileInput.finish(apply);else apply();
}
$('.controls').addEventListener('keydown',event=>{if(event.key==='Escape'&&activeChoice){event.preventDefault();openChoice('');}});
for(const button of all('[data-rail-finish]'))button.addEventListener('click',()=>change('railCustomColor',button.dataset.railFinish==='custom'));
$('#acrylic-color').addEventListener('input',event=>change('acrylic',event.target.value));
$('#reset-look').addEventListener('click',()=>{state=classicLook(state);sync();schedule();});
$('#reset-acrylic').addEventListener('click',()=>change('acrylic',DEFAULT.acrylic));
$('#reset-side').addEventListener('click',()=>{state=choosePaint(state,'sideColor',{color:DEFAULT.sideColor});sync();schedule();});
for(const key of ['font','lighting','mount','wall','depth','usage'])for(const button of all(`[data-${key}]`))button.addEventListener('click',()=>change(key,key==='depth'?Number(button.dataset[key]):button.dataset[key]));
for(const [id,key] of [['sign-text','text'],['width','width'],['width-range','width'],['spacing','spacing']])$('#'+id).addEventListener('input',event=>{
 const value=['width','spacing'].includes(key)?Number(event.target.value):event.target.value;state[key]=value;
 if(key==='text')$('.look-text').classList.toggle('is-multiline',state.text.includes('\n'));
 // Preserve the caret and incomplete numeric input while reflecting paired controls.
 $('#char-count').textContent=`${state.text.length} / 60`;$('#spacing-label').textContent=state.spacing+' %';if(id==='width-range')$('#width').value=value;if(id==='width')$('#width-range').value=value;syncRail();schedule();
});
$('#light').addEventListener('click',()=>change('lightOn',!state.lightOn));$('#night').addEventListener('click',()=>change('night',!state.night));
for(const button of all('[data-view]'))button.addEventListener('click',()=>{renderer?.view(button.dataset.view);setPressed('[data-view]',button.dataset.view,'view');syncDetail();});
$('#canvas-host').addEventListener('viewchange',()=>setPressed('[data-view]','','view'));
$('#canvas-host').addEventListener('rendererror',event=>{result=null;setError(event.detail);});
$('#zoom-in').addEventListener('click',()=>renderer?.changeZoom(.12));$('#zoom-out').addEventListener('click',()=>renderer?.changeZoom(-.12));$('#reset-view').addEventListener('click',()=>{renderer?.view('perspective');setPressed('[data-view]','perspective','view');syncDetail();});
for(const button of all('[data-step]'))button.addEventListener('click',()=>{returnToReview=false;step(Number(button.dataset.step));});
$('#previous').addEventListener('click',()=>activeChoice?openChoice(''):step(activeStep-1));
$('#next').addEventListener('click',()=>{if(!result||validate(state)||pendingPaint())return;if(activeChoice){openChoice('');return;}if(activeStep<3){step(returnToReview?3:activeStep+1);return;}saveDesign();});
for(const button of all('[data-close]'))button.addEventListener('click',()=>button.closest('dialog').close());
$('#download').addEventListener('click',()=>{if(!result)return;const link=document.createElement('a');link.download='NEONTRIP-3D-Entwurf.png';link.href=renderer.snapshot();link.click();});
function renderCart(){
 const host=$('#cart-items');host.replaceChildren();$('#cart-count').textContent=cart.reduce((sum,item)=>sum+item.quantity,0);
 $('#cart-totals').hidden=!cart.length;$('#new-design').textContent=cart.length?'Weiteren Schriftzug gestalten':'Neuen Schriftzug gestalten';$('#checkout').disabled=true;
 const quote=quote3D(cart);$('#cart-total-price').textContent=quote.grossCents===null?'— €':euro(quote.grossCents);
 if(!cart.length){const p=document.createElement('p');p.className='status-note';p.textContent='Hier ist Platz für deine Ideen. Gestalte deinen ersten Schriftzug und speichere ihn nach der Prüfung.';host.append(p);return;}
 for(const item of cart){
  const row=document.createElement('article');row.className='cart-row';
  const main=document.createElement('div'),preview=document.createElement('div'),info=document.createElement('div'),title=document.createElement('h3');main.className='cart-item-main';preview.className='cart-preview';info.className='cart-info';title.textContent=item.design.text;info.append(title);
  if(item.preview){const image=document.createElement('img');image.src=item.preview;image.alt='Entwurf: '+item.design.text;image.width=480;image.height=320;image.loading='lazy';preview.append(image);}else{const hint=document.createElement('span');hint.textContent='Vorschau nach Bearbeitung';preview.append(hint);}
  const height=item.dimensions?.height?.toLocaleString('de-DE',{maximumFractionDigits:1});
  for(const value of [`${LABELS.lighting[item.design.lighting]} · ${LABELS.mount[item.design.mount]}`,`${item.design.width} cm breit${height?' × ca. '+height+' cm hoch':''} · ${item.design.depth} cm tief`,finishDescription(item.design),`${LABELS.usage[item.design.usage]} · ${SIGN_PROTECTION}`]){const p=document.createElement('p');p.textContent=value;info.append(p);}
  const ref=document.createElement('p');ref.className='cart-draft-ref';ref.dataset.draftRef=item.id;info.append(ref);
  const detail=document.createElement('details'),summary=document.createElement('summary'),spec=document.createElement('p');detail.className='cart-specification';summary.textContent='Alle Angaben anzeigen';spec.textContent=description(item.design,item.dimensions?.height)+'\nBuchstabenabstand: '+item.design.spacing+' %'+(item.design.mount==='plate'&&item.dimensions?'\nPlatte: '+item.dimensions.overallWidth.toLocaleString('de-DE')+' × '+item.dimensions.overallHeight.toLocaleString('de-DE',{maximumFractionDigits:1})+' cm':'');detail.append(summary,spec);
  const surcharge=document.createElement('p');surcharge.className='rail-item-estimate';surcharge.textContent=railPriceNote(item.design,item.quantity);
  const actions=document.createElement('div');actions.className='cart-actions';
  for(const [name,fn] of [['Bearbeiten',()=>{editingId=item.id;state=normalize(item.design);$('#cart').close();result=null;returnToReview=false;sync();step(0);schedule();}],['Entfernen',()=>{const previous=cart;cart=cart.filter(x=>x.id!==item.id);try{persistCart();if(editingId===item.id){editingId=null;persistDraft();}renderCart();$('#cart-status').textContent='Entwurf entfernt.';step(activeStep,false);}catch{cart=previous;$('#cart-status').textContent='Die Änderung konnte nicht gespeichert werden.';}}]]){const b=document.createElement('button');b.textContent=name;b.addEventListener('click',fn);actions.append(b);}
  const quantity=document.createElement('input');quantity.type='number';quantity.min='1';quantity.max='99';quantity.value=item.quantity;quantity.inputMode='numeric';quantity.setAttribute('aria-label','Menge für '+item.design.text);quantity.addEventListener('input',()=>{const n=Number(quantity.value);if(!Number.isInteger(n)||n<1||n>99){quantity.setCustomValidity('Bitte eine Menge von 1 bis 99 eingeben.');quantity.setAttribute('aria-invalid','true');$('#cart-status').textContent='Bitte eine Stückzahl von 1 bis 99 eingeben.';return;}quantity.setCustomValidity('');quantity.removeAttribute('aria-invalid');const old=item.quantity;item.quantity=n;try{persistCart();$('#cart-count').textContent=cart.reduce((sum,line)=>sum+line.quantity,0);surcharge.textContent=railPriceNote(item.design,item.quantity);minus.disabled=n<=1;plus.disabled=n>=99;$('#cart-status').textContent='Menge gespeichert.';}catch{item.quantity=old;quantity.value=old;$('#cart-status').textContent='Die Menge konnte nicht gespeichert werden.';}});const restoreQuantity=()=>{if(!quantity.validity.valid){quantity.value=item.quantity;quantity.setCustomValidity('');quantity.removeAttribute('aria-invalid');$('#cart-status').textContent='Die zuletzt gültige Stückzahl wurde beibehalten.';}};quantity.addEventListener('change',restoreQuantity);quantity.addEventListener('blur',restoreQuantity);
  const quantityBox=document.createElement('div'),quantityLabel=document.createElement('span'),stepper=document.createElement('div'),minus=document.createElement('button'),plus=document.createElement('button');quantityBox.className='cart-quantity';quantityLabel.textContent='Stückzahl';stepper.className='quantity-stepper';minus.textContent='−';plus.textContent='+';minus.setAttribute('aria-label','Menge verringern für '+item.design.text);plus.setAttribute('aria-label','Menge erhöhen für '+item.design.text);minus.disabled=item.quantity<=1;plus.disabled=item.quantity>=99;
  for(const [button,delta] of [[minus,-1],[plus,1]])button.addEventListener('click',()=>{quantity.value=Math.max(1,Math.min(99,item.quantity+delta));quantity.dispatchEvent(new Event('input',{bubbles:true}));});stepper.append(minus,quantity,plus);quantityBox.append(quantityLabel,stepper);
  const price=document.createElement('p');price.className='cart-line-price';price.textContent='Stückpreis folgt · — €';quantityBox.append(price);main.append(preview,info);row.append(main,detail);if(surcharge.textContent)row.append(surcharge);row.append(actions,quantityBox);host.append(row);
 }
 updateDraftReferences();
}
let storedReferences=[];
function updateDraftReferences(){for(const el of all('[data-draft-ref]')){const ref=storedReferences.find(r=>r.localId===el.dataset.draftRef);el.textContent=ref?'Entwurfs-ID: '+ref.designId.slice(0,15)+'…':'';el.title=ref?.designId||'';}}
function renderStorageStatus(info){
 remoteStatus=info.status;
 if(info.references)storedReferences=info.references;
 const labels={local:'Bisher nur auf diesem Gerät gespeichert.',pending:'Änderungen werden gesichert …',saving:'Entwürfe werden dauerhaft gesichert …',saved:'Entwürfe dauerhaft gesichert.',unavailable:'Auf diesem Gerät gespeichert. Die dauerhafte Sicherung ist gerade nicht erreichbar.',conflict:'Dieser Warenkorb wurde auf einem anderen Gerät geändert. Deine Änderungen bleiben hier erhalten.'};
 $('#cloud-status').textContent=labels[info.status]||labels.local;
 $('#retry-save').hidden=!['unavailable','local'].includes(info.status);$('#fork-save').hidden=info.status!=='conflict';$('#copy-draft-link').disabled=info.status!=='saved';
 if(info.status!=='saved')$('#draft-link-box').hidden=true;
 updateDraftReferences();
}
$('#retry-save').addEventListener('click',()=>{clearTimeout(remoteTimer);draftSync.retry(cart).catch(()=>{});});
$('#fork-save').addEventListener('click',()=>{clearTimeout(remoteTimer);draftSync.fork(cart).catch(()=>{});});
$('#copy-draft-link').addEventListener('click',async()=>{
 try{const link=draftSync.link(location.origin);$('#draft-link').value=link;$('#draft-link-box').hidden=false;try{await navigator.clipboard.writeText(link);$('#cloud-status').textContent='Privater Link kopiert.';}catch{$('#cloud-status').textContent='Den privaten Link kannst du hier kopieren.';$('#draft-link').focus();$('#draft-link').select();}}catch{}
});
async function restoreRemote(){
 const before=JSON.stringify(cart);
 try{
  if(restoreToken){
   const remote=await draftSync.load(restoreToken);
   if(cart.length===0){storeCart(localStorage,remote.items);cart=remote.items;await draftSync.adopt(restoreToken,remote);}
   else{
    const added=remote.items.filter(item=>!cart.some(existing=>JSON.stringify(existing)===JSON.stringify(item))).map(item=>({...item,id:cart.some(existing=>existing.id===item.id)?newDraftToken():item.id}));
    if(cart.length+added.length>MAX_CART_ITEMS)throw Error('CART_FULL');
    const merged=[...cart,...added];storeCart(localStorage,merged);cart=merged;await draftSync.fork(cart);
   }
   renderCart();$('#cart-status').textContent='Gespeicherte Entwürfe geladen. Vorhandene Entwürfe wurden beibehalten.';$('#cart').showModal();
  }else if(draftSync.hasSession){
   const unchanged=await draftSync.unchanged(cart),remote=await draftSync.restoreOwn();
   if(JSON.stringify(cart)!==before)return;
   if(unchanged){storeCart(localStorage,remote.items);cart=remote.items;await draftSync.adopt(draftSync.sessionToken,remote);renderCart();}
   else{
    // Device storage may have omitted only thumbnails. Recover matching images
    // without changing local quantities/configurations or adopting a stale revision.
    if(remote.revision===draftSync.revision){
     cart=cart.map(item=>{const saved=remote.items.find(row=>row.id===item.id);return !item.preview&&saved&&JSON.stringify([item.design,item.dimensions])===JSON.stringify([saved.design,saved.dimensions])?{...item,preview:saved.preview}:item;});
     storeCart(localStorage,cart);renderCart();
    }
    await draftSync.save(cart);
   }
  }else if(cart.length)await draftSync.save(cart);
 }catch(error){
  if(restoreToken){$('#cart-status').textContent=error.message==='CART_FULL'?'Der gespeicherte Warenkorb passt nicht zusätzlich hinein (maximal 20 Entwürfe). Deine aktuellen Entwürfe bleiben erhalten.':'Der gespeicherte Warenkorb konnte gerade nicht geladen werden. Öffne deinen Link später erneut.';renderCart();$('#cart').showModal();}
  if(!['unavailable','conflict'].includes(remoteStatus))renderStorageStatus({status:'unavailable'});
 }
 $('#cart-count').textContent=cart.reduce((sum,item)=>sum+item.quantity,0);
}
restoreRemote();
$('#open-cart').addEventListener('click',()=>{renderCart();$('#cart-status').textContent='';$('#cart').showModal();});
async function cartThumbnail(){
 try{const image=new Image();image.src=renderer.snapshot();await image.decode();const canvas=document.createElement('canvas');canvas.width=Math.min(480,image.naturalWidth);canvas.height=Math.round(image.naturalHeight*canvas.width/image.naturalWidth);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return safePreview(canvas.toDataURL('image/jpeg',.7));}catch{return null;}
}
async function saveDesign(){
 if(savingDesign||!result||validate(state)||pendingPaint())return;
 if(!editingId&&cart.length>=MAX_CART_ITEMS){$('#editor-error').textContent='Du kannst bis zu 20 Entwürfe speichern. Entferne zuerst einen Entwurf.';return;}
 savingDesign=true;$('#next').disabled=true;
 const token=revision,design={...state},dimensions={...result},oldEditingId=editingId;
 try{
  const preview=await cartThumbnail();if(token!==revision||editingId!==oldEditingId)return;
  const old=cart,match=cart.find(item=>item.id===editingId),entry=cartEntry({id:match?.id||newDraftToken(),design,dimensions,preview,quantity:match?.quantity||1});cart=match?cart.map(item=>item.id===entry.id?entry:item):[...cart,entry];
  try{const saved=persistCart();editingId=entry.id;persistDraft();renderCart();$('#cart-status').textContent=saved.previewsOmitted?'Dein Entwurf wurde gespeichert. Für die Vorschaubilder reicht der Gerätespeicher nicht aus.':'Dein Entwurf wurde gespeichert.';$('#cart').showModal();step(activeStep,false);}catch{cart=old;editingId=oldEditingId;$('#editor-error').textContent='Der Warenkorb konnte nicht gespeichert werden. Bitte aktiviere den lokalen Browserspeicher.';}
 }finally{savingDesign=false;syncAvailability();}
}
$('#checkout').addEventListener('click',async()=>{
 // Defence in depth if the disabled DOM button is manually re-enabled.
 $('#checkout').disabled=true;
 try{await prepareCheckout3D(cart);$('#cart-status').textContent='Die verbindliche Kalkulation fehlt noch. Dein Entwurf bleibt gespeichert; es wurde keine Bestellung ausgelöst.';}catch{$('#cart-status').textContent='Bitte prüfe die Angaben deiner Entwürfe. Der Kauf ist noch gesperrt.';}
});
$('#new-design').addEventListener('click',()=>{editingId=null;returnToReview=false;state={...DEFAULT};result=null;$('#cart').close();sync();step(0);schedule();});
const compactLayout=matchMedia('(max-width:979px)');
const phoneLayout=matchMedia('(max-width:599px)');
const previewColumn=$('.preview-column');
let previewScrolled=false,previewExpanded=false,previewScrollFrame=0;
function previewLayout(){const column=$('.preview-column');document.documentElement.style.setProperty('--preview-stack',column.getBoundingClientRect().height+'px');document.documentElement.style.setProperty('--action-height',$('.control-footer').getBoundingClientRect().height+'px');}
const layoutObserver=new ResizeObserver(previewLayout);layoutObserver.observe($('.preview-column'));layoutObserver.observe($('.control-footer'));
function syncPreviewSize(){
 const collapsed=previewColumn.classList.contains('preview-collapsed');
 const small=phoneLayout.matches&&(previewScrolled||Boolean(activeChoice))&&!previewExpanded&&!collapsed&&!$('#preview-options').open;
 previewColumn.classList.toggle('preview-scrolled',previewScrolled);
 previewColumn.classList.toggle('preview-compact',small);
 $('#toggle-preview').setAttribute('aria-expanded',String(!collapsed));
 $('#toggle-preview span').textContent=collapsed?'3D-Vorschau anzeigen':small?'Ausblenden':'Vorschau einklappen';
 $('#resize-preview').setAttribute('aria-expanded',String(!small));
 $('#resize-preview').setAttribute('aria-label',small?'3D-Vorschau vergrößern':'3D-Vorschau verkleinern');
 $('#resize-preview').textContent=small?'Vergrößern':'Verkleinern';
 $('#preview').inert=collapsed;
 previewLayout();
}
function scrollPreview(){
 previewScrollFrame=0;
 if(document.body.classList.contains('editor-input-active'))return;
 // The editor's start never moves when the sticky preview changes height.
 // Separate entry/exit thresholds prevent flicker at the sticky boundary.
 const top=$('#editor').getBoundingClientRect().top;
 const scrolled=phoneLayout.matches&&(previewScrolled?top<16:top<-48);
 if(scrolled===previewScrolled)return;
 previewScrolled=scrolled;
 if(!scrolled)previewExpanded=false;
 syncPreviewSize();
}
addEventListener('scroll',()=>{if(!previewScrollFrame)previewScrollFrame=requestAnimationFrame(scrollPreview);},{passive:true});
addEventListener('resize',scrollPreview);
$('#resize-preview').addEventListener('click',()=>{previewExpanded=!previewExpanded;syncPreviewSize();});
$('#preview-settings').addEventListener('click',()=>{const options=$('#preview-options');options.open=!options.open;syncPreviewSize();});
$('#preview-options').addEventListener('toggle',()=>{$('#preview-settings').setAttribute('aria-expanded',String($('#preview-options').open));syncPreviewSize();});
$('#toggle-preview').addEventListener('click',()=>{previewColumn.classList.toggle('preview-collapsed');previewExpanded=false;$('#preview-options').open=false;syncPreviewSize();$('.controls').scrollIntoView({block:'start',behavior:'instant'});});
function responsivePreview(){if(!compactLayout.matches)previewColumn.classList.remove('preview-collapsed');$('.preview-options').open=false;scrollPreview();syncPreviewSize();}
phoneLayout.addEventListener('change',scrollPreview);
compactLayout.addEventListener('change',responsivePreview);responsivePreview();
new IntersectionObserver(entries=>document.body.classList.toggle('editor-in-view',entries[0].isIntersecting),{threshold:0}).observe($('#editor'));
mobileInput=initMobileInput({onLayout:previewLayout});

sync();$('#next').disabled=true;$('#download').disabled=true;
try{const {SignRenderer}=await import('./renderer.js?v=44');renderer=new SignRenderer($('#canvas-host'));await update();}catch{setError('Die 3D-Vorschau benötigt WebGL. Bitte verwende einen aktuellen Browser mit aktivierter Grafikbeschleunigung.');}
