import {initMobileInput} from './mobile-input.js?v=38';
import {createRalPicker} from './ral-picker.js?v=35';
import {DEFAULT,LABELS,FONTS,COLORS,ACRYLICS,FINISHES,activeFinish,classicLook,finishDescription,paintDescription,choosePaint,PAINT_PRESETS,PAINT_FIELDS,normalize,validate} from './model.js?v=35';
import {quote3D,railColorEstimate} from './pricing.js';
const $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
let mobileInput=null;
const DRAFT_KEY='neontrip-3d-draft-v1',CART_KEY='neontrip-3d-cart-v1';
let state={...DEFAULT},cart=[],activeStep=0,renderer,result=null,revision=0,debounce,editingId=null,returnToReview=false;
try{const draft=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');if([1,2,3].includes(draft?.version)){state=normalize(draft);editingId=typeof draft.cartItemId==='string'?draft.cartItemId:null;}}catch{$('#saved-status').textContent='Der gespeicherte Entwurf konnte nicht geladen werden.';}
try{const saved=JSON.parse(localStorage.getItem(CART_KEY)||'[]');if(Array.isArray(saved))cart=saved.filter(x=>x&&typeof x.id==='string'&&[1,2,3].includes(x.design?.version)).slice(0,20).map(x=>({...x,design:normalize(x.design),quantity:Number.isInteger(x.quantity)&&x.quantity>0&&x.quantity<=99?x.quantity:1}));}catch{$('#saved-status').textContent='Der gespeicherte Warenkorb konnte nicht geladen werden.';}
if(!cart.some(item=>item.id===editingId))editingId=null;
function persistDraft(){try{localStorage.setItem(DRAFT_KEY,JSON.stringify({...state,cartItemId:editingId}));$('#saved-status').textContent='Dein Entwurf ist auf diesem Gerät gespeichert.';}catch{$('#saved-status').textContent='Speichern auf diesem Gerät nicht möglich. Nutze „Bild speichern“.';}}
function persistCart(){localStorage.setItem(CART_KEY,JSON.stringify(cart));}
function syncDetail(){const shown=Boolean(renderer?.closeup);$('#detail-note').hidden=!shown;$('#detail-note').textContent=state.lighting==='back'?'Detailansicht · Edelstahl vorne, ca. 1 cm leuchtendes Acryl direkt dahinter.':'Detailansicht · Leuchtende Acrylfront auf dem Edelstahlkorpus.';}
function setPressed(selector,value,key){for(const el of all(selector))el.setAttribute('aria-pressed',String(el.dataset[key]===String(value)));}
const euro=value=>(value/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
function railPriceNote(design,quantity=1){const e=railColorEstimate(design,quantity);return e?`Farbaufpreis Schiene: ca. ${euro(e.totalCents)} (${e.metres.toLocaleString('de-DE')} m × ca. 110 €/m${quantity>1?' × '+quantity+' Stück':''}). Gesamtpreis folgt.`:'';}
function syncRail(){
 $('#rail-settings').hidden=state.mount!=='rail';$('#rail-color-settings').hidden=!state.railCustomColor;setPressed('[data-rail-finish]',state.railCustomColor?'custom':'standard','railFinish');$('#rail-color-price').textContent=railPriceNote(state);
}
function sync(){
 $('#sign-text').value=state.text;$('#width').value=state.width;$('#width-range').value=state.width;$('#spacing').value=state.spacing;
 $('#char-count').textContent=`${state.text.length} / 60`;$('#spacing-label').textContent=state.spacing+' %';
 for(const key of ['font','lighting','mount','wall','depth'])setPressed(`[data-${key}]`,state[key],key);
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
 $('#cart-count').textContent=cart.reduce((sum,item)=>sum+item.quantity,0);step(activeStep,false);
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
  {title:'Größe & Montage',step:2,rows:[['Breite × Höhe',cm(state.width)+' × '+cm(result.height)],['Buchstabentiefe',cm(state.depth)],['Montage',LABELS.mount[state.mount]],['Buchstabenabstand',state.spacing+' %']]}
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
 activeStep=Math.min(3,Math.max(0,index));
 for(const button of all('[data-step]')){if(Number(button.dataset.step)===activeStep)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
 for(let i=0;i<4;i++)$('#panel-'+i).hidden=i!==activeStep;
 $('#step-label').textContent=`Schritt ${activeStep+1} von 4`;$('#step-progress').style.width=((activeStep+1)*25)+'%';
 $('#previous').hidden=activeStep===0;
 const label=activeStep===3?(editingId?'Änderungen speichern':'Entwurf in den Warenkorb'):returnToReview?'Änderungen prüfen':['Weiter zu den Farben','Weiter zur Größe','Entwurf prüfen'][activeStep];
 $('#next').replaceChildren(document.createTextNode(label));const arrow=document.createElement('span');arrow.textContent='→';$('#next').append(arrow);
 if(activeStep===3){returnToReview=false;renderReview();}
 if(focus){const focusPanel=()=>{const title=$('#panel-'+activeStep+' h2');title.tabIndex=-1;title.focus({preventScroll:true});$('.controls').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'});};if(mobileInput)mobileInput.finish(focusPanel);else focusPanel();}
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
for(const button of all('[data-rail-finish]'))button.addEventListener('click',()=>change('railCustomColor',button.dataset.railFinish==='custom'));
$('#acrylic-color').addEventListener('input',event=>change('acrylic',event.target.value));
$('#reset-look').addEventListener('click',()=>{state=classicLook(state);sync();schedule();});
$('#reset-acrylic').addEventListener('click',()=>change('acrylic',DEFAULT.acrylic));
$('#reset-side').addEventListener('click',()=>{state=choosePaint(state,'sideColor',{color:DEFAULT.sideColor});sync();schedule();});
for(const key of ['font','lighting','mount','wall','depth'])for(const button of all(`[data-${key}]`))button.addEventListener('click',()=>change(key,key==='depth'?Number(button.dataset[key]):button.dataset[key]));
for(const [id,key] of [['sign-text','text'],['width','width'],['width-range','width'],['spacing','spacing']])$('#'+id).addEventListener('input',event=>{
 const value=['width','spacing'].includes(key)?Number(event.target.value):event.target.value;state[key]=value;
 // Preserve the caret and incomplete numeric input while reflecting paired controls.
 $('#char-count').textContent=`${state.text.length} / 60`;$('#spacing-label').textContent=state.spacing+' %';if(id==='width-range')$('#width').value=value;if(id==='width')$('#width-range').value=value;syncRail();schedule();
});
$('#light').addEventListener('click',()=>change('lightOn',!state.lightOn));$('#night').addEventListener('click',()=>change('night',!state.night));
for(const button of all('[data-view]'))button.addEventListener('click',()=>{renderer?.view(button.dataset.view);setPressed('[data-view]',button.dataset.view,'view');syncDetail();});
$('#canvas-host').addEventListener('viewchange',()=>setPressed('[data-view]','','view'));
$('#canvas-host').addEventListener('rendererror',event=>{result=null;setError(event.detail);});
$('#zoom-in').addEventListener('click',()=>renderer?.changeZoom(.12));$('#zoom-out').addEventListener('click',()=>renderer?.changeZoom(-.12));$('#reset-view').addEventListener('click',()=>{renderer?.view('perspective');setPressed('[data-view]','perspective','view');syncDetail();});
for(const button of all('[data-step]'))button.addEventListener('click',()=>{returnToReview=false;step(Number(button.dataset.step));});
$('#previous').addEventListener('click',()=>step(activeStep-1));
$('#next').addEventListener('click',()=>{if(!result||validate(state))return;if(activeStep<3){step(returnToReview?3:activeStep+1);return;}saveDesign();});
for(const button of all('[data-close]'))button.addEventListener('click',()=>button.closest('dialog').close());
$('#download').addEventListener('click',()=>{if(!result)return;const link=document.createElement('a');link.download='NEONTRIP-3D-Entwurf.png';link.href=renderer.snapshot();link.click();});
function renderCart(){
 const host=$('#cart-items');host.replaceChildren();$('#cart-count').textContent=cart.reduce((sum,item)=>sum+item.quantity,0);
 $('#cart-totals').hidden=!cart.length;$('#new-design').textContent=cart.length?'Weiteren Schriftzug gestalten':'Neuen Schriftzug gestalten';$('#checkout').disabled=!quote3D(cart).purchaseEnabled; // Remains fail-closed until authoritative 3D pricing is connected.
 if(!cart.length){const p=document.createElement('p');p.className='status-note';p.textContent='Hier ist Platz für deine Ideen. Gestalte deinen ersten Schriftzug und speichere ihn nach der Prüfung.';host.append(p);return;}
 for(const item of cart){
  const row=document.createElement('article');row.className='cart-row';const info=document.createElement('div'),title=document.createElement('h3');title.textContent=item.design.text;info.append(title);
  for(const value of [`${LABELS.lighting[item.design.lighting]} · ${LABELS.mount[item.design.mount]}`,`${item.design.width} cm breit · ${item.design.depth} cm tief`,`Schrift: ${LABELS.font[item.design.font]}`,finishDescription(item.design),item.design.lighting==='front'?`Leuchtfarbe vorne: ${item.design.acrylic.toUpperCase()}`:`Halo: ${COLORS.find(c=>c[0]===item.design.color)?.[1]}`]){const p=document.createElement('p');p.textContent=value;info.append(p);}
  if(item.design.mount==='rail'){const rail=document.createElement('p');rail.textContent=item.design.railCustomColor?'Schiene in Wunschfarbe '+paintDescription(item.design,'railColor'):'Schiene: Standardausführung';info.append(rail);}
  if(item.design.mount==='plate'){const plate=document.createElement('p');plate.textContent='Lackfarbe der Platte: '+paintDescription(item.design,'plate');info.append(plate);}
  const surcharge=document.createElement('p');surcharge.className='rail-item-estimate';surcharge.textContent=railPriceNote(item.design,item.quantity);if(surcharge.textContent)info.append(surcharge);
  const actions=document.createElement('div');actions.className='cart-actions';
  for(const [name,fn] of [['Bearbeiten',()=>{editingId=item.id;state=normalize(item.design);$('#cart').close();result=null;returnToReview=false;sync();step(0);schedule();}],['Entfernen',()=>{const previous=cart;cart=cart.filter(x=>x.id!==item.id);try{persistCart();if(editingId===item.id){editingId=null;persistDraft();}renderCart();$('#cart-status').textContent='Entwurf entfernt.';step(activeStep,false);}catch{cart=previous;$('#cart-status').textContent='Die Änderung konnte nicht gespeichert werden.';}}]]){const b=document.createElement('button');b.textContent=name;b.addEventListener('click',fn);actions.append(b);}info.append(actions);
  const quantity=document.createElement('input');quantity.type='number';quantity.min='1';quantity.max='99';quantity.value=item.quantity;quantity.inputMode='numeric';quantity.setAttribute('aria-label','Menge für '+item.design.text);quantity.addEventListener('input',()=>{const n=Number(quantity.value);if(!Number.isInteger(n)||n<1||n>99){quantity.setCustomValidity('Bitte eine Menge von 1 bis 99 eingeben.');quantity.setAttribute('aria-invalid','true');$('#cart-status').textContent='Bitte eine Stückzahl von 1 bis 99 eingeben.';return;}quantity.setCustomValidity('');quantity.removeAttribute('aria-invalid');const old=item.quantity;item.quantity=n;try{persistCart();$('#cart-count').textContent=cart.reduce((sum,line)=>sum+line.quantity,0);surcharge.textContent=railPriceNote(item.design,item.quantity);minus.disabled=n<=1;plus.disabled=n>=99;$('#cart-status').textContent='Menge gespeichert.';}catch{item.quantity=old;quantity.value=old;$('#cart-status').textContent='Die Menge konnte nicht gespeichert werden.';}});quantity.addEventListener('change',()=>{if(!quantity.checkValidity()){quantity.value=item.quantity;quantity.setCustomValidity('');quantity.removeAttribute('aria-invalid');$('#cart-status').textContent='Die zuletzt gültige Stückzahl wurde beibehalten.';}});
  const quantityBox=document.createElement('div'),quantityLabel=document.createElement('span'),stepper=document.createElement('div'),minus=document.createElement('button'),plus=document.createElement('button');quantityBox.className='cart-quantity';quantityLabel.textContent='Stückzahl';stepper.className='quantity-stepper';minus.textContent='−';plus.textContent='+';minus.setAttribute('aria-label','Menge verringern für '+item.design.text);plus.setAttribute('aria-label','Menge erhöhen für '+item.design.text);minus.disabled=item.quantity<=1;plus.disabled=item.quantity>=99;
  for(const [button,delta] of [[minus,-1],[plus,1]])button.addEventListener('click',()=>{quantity.value=Math.max(1,Math.min(99,item.quantity+delta));quantity.dispatchEvent(new Event('input',{bubbles:true}));});stepper.append(minus,quantity,plus);quantityBox.append(quantityLabel,stepper);row.append(info,quantityBox);host.append(row);
 }
}
$('#open-cart').addEventListener('click',()=>{renderCart();$('#cart-status').textContent='';$('#cart').showModal();});
function saveDesign(){
 if(!result||validate(state)||pendingPaint())return;const old=cart,oldEditingId=editingId;
 if(!editingId&&cart.length>=20){$('#editor-error').textContent='Du kannst bis zu 20 Entwürfe speichern. Entferne zuerst einen Entwurf.';return;}
 const match=cart.find(item=>item.id===editingId);const entry={id:match?.id||crypto.randomUUID(),design:{...state},quantity:match?.quantity||1};cart=match?cart.map(item=>item.id===entry.id?entry:item):[...cart,entry];
 try{persistCart();editingId=entry.id;persistDraft();renderCart();$('#cart-status').textContent='Dein Entwurf wurde gespeichert.';$('#cart').showModal();step(activeStep,false);}catch{cart=old;editingId=oldEditingId;$('#editor-error').textContent='Der Warenkorb konnte nicht gespeichert werden. Bitte aktiviere den lokalen Browserspeicher.';}
}
$('#new-design').addEventListener('click',()=>{editingId=null;returnToReview=false;state={...DEFAULT};result=null;$('#cart').close();sync();step(0);schedule();});
const compactLayout=matchMedia('(max-width:979px)');
const phoneLayout=matchMedia('(max-width:599px)');
const previewColumn=$('.preview-column');
let previewScrolled=false,previewExpanded=false,previewScrollFrame=0;
function previewLayout(){const column=$('.preview-column');document.documentElement.style.setProperty('--preview-stack',column.getBoundingClientRect().height+'px');document.documentElement.style.setProperty('--action-height',$('.control-footer').getBoundingClientRect().height+'px');}
const layoutObserver=new ResizeObserver(previewLayout);layoutObserver.observe($('.preview-column'));layoutObserver.observe($('.control-footer'));
function syncPreviewSize(){
 const collapsed=previewColumn.classList.contains('preview-collapsed');
 const small=previewScrolled&&!previewExpanded&&!collapsed;
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
$('#toggle-preview').addEventListener('click',()=>{previewColumn.classList.toggle('preview-collapsed');previewExpanded=false;syncPreviewSize();$('.controls').scrollIntoView({block:'start',behavior:'instant'});});
function responsivePreview(){if(!compactLayout.matches)previewColumn.classList.remove('preview-collapsed');$('.preview-options').open=!compactLayout.matches;scrollPreview();syncPreviewSize();}
phoneLayout.addEventListener('change',scrollPreview);
compactLayout.addEventListener('change',responsivePreview);responsivePreview();
new IntersectionObserver(entries=>document.body.classList.toggle('editor-in-view',entries[0].isIntersecting),{threshold:0}).observe($('#editor'));
mobileInput=initMobileInput({onLayout:previewLayout});
sync();$('#next').disabled=true;$('#download').disabled=true;
try{const {SignRenderer}=await import('./renderer.js?v=35');renderer=new SignRenderer($('#canvas-host'));await update();}catch{setError('Die 3D-Vorschau benötigt WebGL. Bitte verwende einen aktuellen Browser mit aktivierter Grafikbeschleunigung.');}
