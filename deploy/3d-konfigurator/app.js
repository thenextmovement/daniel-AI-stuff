import {DEFAULT,LABELS,FONTS,COLORS,ACRYLICS,FINISHES,activeFinish,classicLook,finishDescription,normalize,validate,description} from './model.js?v=16';
import {quote3D,railColorEstimate} from './pricing.js';
const $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
const DRAFT_KEY='neontrip-3d-draft-v1',CART_KEY='neontrip-3d-cart-v1';
let state={...DEFAULT},cart=[],activeStep=0,renderer,result=null,revision=0,debounce,editingId=null;
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
 $('#rail-settings').hidden=state.mount!=='rail';$('#rail-color-settings').hidden=!state.railCustomColor;setPressed('[data-rail-finish]',state.railCustomColor?'custom':'standard','railFinish');$('#rail-color').value=state.railColor;$('#rail-color-value').textContent=state.railColor.toUpperCase();$('#rail-color-price').textContent=railPriceNote(state);
}
function sync(){
 $('#sign-text').value=state.text;$('#width').value=state.width;$('#width-range').value=state.width;$('#spacing').value=state.spacing;$('#plate-color').value=state.plate;
 $('#char-count').textContent=`${state.text.length} / 60`;$('#spacing-label').textContent=state.spacing+' %';
 for(const key of ['font','lighting','mount','wall','depth'])setPressed(`[data-${key}]`,state[key],key);
 setPressed('[data-color]',state.color,'color');setPressed('[data-acrylic]',state.acrylic,'acrylic');setPressed('[data-finish]',activeFinish(state),'finish');
 $('#color-name').textContent=COLORS.find(c=>c[0]===state.color)?.[1];
 $('#acrylic-color').value=state.acrylic;$('#acrylic-value').textContent=state.acrylic.toUpperCase();$('#acrylic-name').textContent=ACRYLICS.find(c=>c[0]===state.acrylic)?.[1]||'Eigene Farbe';
 $('#side-color').value=state.sideColor;$('#side-value').textContent=state.sideColor.toUpperCase();$('#reset-side').disabled=state.sideColor===DEFAULT.sideColor;
 $('#body-color').value=state.body;$('#body-value').textContent=state.body.toUpperCase();$('#paint-settings').hidden=state.lighting==='front'||activeFinish(state)!=='painted-steel';
 const front=state.lighting==='front';$('#acrylic-settings').hidden=!front;$('#halo-settings').hidden=front;$('#surface-settings').hidden=front;$('#side-settings').hidden=!front;$('#surface-title').textContent='Metallfront & Korpus';$('#build-title').textContent=front?'Licht & Seitenfarbe.':'Deine Oberfläche. Dein Stil.';
 $('#classic-look-note').textContent=front?'Weißes Licht · schwarze Seiten':'Edelstahl, gold lackiert · warmweißes Licht';
 $('#reset-look').disabled=front?state.sideColor===DEFAULT.sideColor&&state.acrylic===DEFAULT.acrylic:state.backFinish===DEFAULT.backFinish&&state.color===DEFAULT.color;
 $('#material-note').textContent=finishDescription(state)+'. '+(front?'Korpus und Rückseite aus Edelstahl.':'Hinten ca. 1 cm weißes, opales Acryl in Buchstabenform mit innenliegenden LEDs.');$('#construction-note').textContent=front?'Leuchtende Acrylfront · Edelstahlkorpus mit lackierten Seiten · LEDs innen.':finishDescription(state)+' · ca. 1 cm weißes Acryl hinten · Licht zur Wand.';$('#caption-material').textContent=front?'Seiten '+state.sideColor.toUpperCase():FINISHES[activeFinish(state)].label;
 syncDetail();syncRail();$('#plate-settings').hidden=state.mount!=='plate';$('#light').setAttribute('aria-pressed',String(state.lightOn));$('#light').textContent=state.lightOn?'Licht an':'Licht aus';$('#night').setAttribute('aria-pressed',String(state.night));$('#night').textContent=state.night?'Tagansicht':'Nachtansicht';document.body.classList.toggle('night-mode',state.night);
 $('#caption-light').textContent=LABELS.lighting[state.lighting];$('#caption-mount').textContent=LABELS.mount[state.mount];$('#caption-depth').textContent=state.depth+' cm Tiefe';
 $('#cart-count').textContent=cart.reduce((sum,item)=>sum+item.quantity,0);step(activeStep,false);
}
function change(key,value){state[key]=value;if(key==='mount'&&value!=='rail'&&$('[data-view=mounting]').getAttribute('aria-pressed')==='true'){renderer?.view('perspective');setPressed('[data-view]','perspective','view');}sync();schedule();}
function setError(message){$('#editor-error').textContent=message;$('#loading').hidden=!message;if(message)$('#loading').textContent=message;$('#next').disabled=Boolean(message)||!result;$('#download').disabled=Boolean(message)||!result;}
function schedule(){clearTimeout(debounce);++revision;result=null;$('#next').disabled=true;$('#download').disabled=true;debounce=setTimeout(update,100);}
async function update(){
 const token=++revision;result=null;
 const error=validate(state);if(error){setError(error);return;}
 if(!renderer)return;
 $('#next').disabled=true;$('#download').disabled=true;
 try{
  const dimensions=await renderer.update({...state});if(token!==revision||!dimensions)return;
  result=dimensions;setError('');$('#layer-note').hidden=!dimensions.layerEmphasis;const height=dimensions.height.toLocaleString('de-DE',{maximumFractionDigits:1});
  $('#height-label').textContent=height+' cm';$('#dimensions').textContent=`Schriftzug ${state.width} × ${height} cm${state.mount==='plate'?` · Platte ${dimensions.overallWidth.toLocaleString('de-DE')} × ${dimensions.overallHeight.toLocaleString('de-DE',{maximumFractionDigits:1})} cm`:''}`;
  $('#canvas-host').setAttribute('aria-label',`${state.text}, ${LABELS.lighting[state.lighting]}, ${LABELS.mount[state.mount]}, ${finishDescription(state)}, ${state.width} mal ${height} Zentimeter. Mit Ziehen drehen oder die Ansichtsschalter verwenden.`);
  persistDraft();
 }catch(e){if(token!==revision)return;result=null;setError(e.message||'Die Vorschau konnte nicht geladen werden. Bitte lade die Seite neu.');}
}
function step(index,focus=true){
 activeStep=Math.min(2,Math.max(0,index));for(const button of all('[data-step]')){if(Number(button.dataset.step)===activeStep)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
 for(let i=0;i<3;i++)$('#panel-'+i).hidden=i!==activeStep;
 $('#previous').hidden=activeStep===0;$('#next').replaceChildren(document.createTextNode(['Weiter zum Material','Weiter zum Aufbau',editingId?'Änderungen prüfen':'Konfiguration prüfen'][activeStep]));const arrow=document.createElement('span');arrow.textContent='→';$('#next').append(arrow);
 if(focus){const title=$('#panel-'+activeStep+' h2');title.tabIndex=-1;title.focus({preventScroll:true});if(matchMedia('(max-width:760px)').matches)$('.controls').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'});}
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
for(const [id,key] of [['acrylic-color','acrylic'],['side-color','sideColor'],['body-color','body'],['rail-color','railColor']])$('#'+id).addEventListener('input',event=>change(key,event.target.value));
$('#reset-look').addEventListener('click',()=>{state=classicLook(state);sync();schedule();});
$('#reset-acrylic').addEventListener('click',()=>change('acrylic',DEFAULT.acrylic));
$('#reset-side').addEventListener('click',()=>change('sideColor',DEFAULT.sideColor));
for(const key of ['font','lighting','mount','wall','depth'])for(const button of all(`[data-${key}]`))button.addEventListener('click',()=>change(key,key==='depth'?Number(button.dataset[key]):button.dataset[key]));
for(const [id,key] of [['sign-text','text'],['width','width'],['width-range','width'],['spacing','spacing'],['plate-color','plate']])$('#'+id).addEventListener('input',event=>{
 const value=['width','spacing'].includes(key)?Number(event.target.value):event.target.value;state[key]=value;
 // Preserve the caret and incomplete numeric input while reflecting paired controls.
 $('#char-count').textContent=`${state.text.length} / 60`;$('#spacing-label').textContent=state.spacing+' %';if(id==='width-range')$('#width').value=value;if(id==='width')$('#width-range').value=value;syncRail();schedule();
});
$('#light').addEventListener('click',()=>change('lightOn',!state.lightOn));$('#night').addEventListener('click',()=>change('night',!state.night));
for(const button of all('[data-view]'))button.addEventListener('click',()=>{renderer?.view(button.dataset.view);setPressed('[data-view]',button.dataset.view,'view');syncDetail();});
$('#canvas-host').addEventListener('viewchange',()=>setPressed('[data-view]','','view'));
$('#canvas-host').addEventListener('rendererror',event=>{result=null;setError(event.detail);});
$('#zoom-in').addEventListener('click',()=>renderer?.changeZoom(.12));$('#zoom-out').addEventListener('click',()=>renderer?.changeZoom(-.12));$('#reset-view').addEventListener('click',()=>{renderer?.view('perspective');setPressed('[data-view]','perspective','view');syncDetail();});
for(const button of all('[data-step]'))button.addEventListener('click',()=>step(Number(button.dataset.step)));
$('#previous').addEventListener('click',()=>step(activeStep-1));
$('#next').addEventListener('click',()=>{if(!result||validate(state))return;if(activeStep<2){step(activeStep+1);return;}$('#review-summary').textContent=[description(state,result.height),railPriceNote(state)].filter(Boolean).join('\n');$('#review-preview').src=renderer.snapshot();$('#add-cart').firstChild.textContent=editingId?'Änderungen übernehmen ':'In den Warenkorb ';$('#review').showModal();});
for(const button of all('[data-close]'))button.addEventListener('click',()=>button.closest('dialog').close());
$('#download').addEventListener('click',()=>{if(!result)return;const link=document.createElement('a');link.download='NEONTRIP-3D-Entwurf.png';link.href=renderer.snapshot();link.click();});
function renderCart(){
 const host=$('#cart-items');host.replaceChildren();$('#cart-count').textContent=cart.reduce((sum,item)=>sum+item.quantity,0);
 $('#checkout').disabled=!quote3D(cart).purchaseEnabled; // Remains fail-closed until authoritative 3D pricing is connected.
 if(!cart.length){const p=document.createElement('p');p.className='status-note';p.textContent='Dein Warenkorb ist noch leer. Gestalte zuerst deinen Schriftzug.';host.append(p);return;}
 for(const item of cart){
  const row=document.createElement('article');row.className='cart-row';const info=document.createElement('div'),title=document.createElement('h3');title.textContent=item.design.text;info.append(title);
  for(const value of [`${LABELS.lighting[item.design.lighting]} · ${LABELS.mount[item.design.mount]}`,`${item.design.width} cm breit · ${item.design.depth} cm tief`,`Schrift: ${LABELS.font[item.design.font]}`,finishDescription(item.design),item.design.lighting==='front'?`Leuchtfarbe vorne: ${item.design.acrylic.toUpperCase()}`:`Halo: ${COLORS.find(c=>c[0]===item.design.color)?.[1]}`]){const p=document.createElement('p');p.textContent=value;info.append(p);}
  if(item.design.mount==='rail'){const rail=document.createElement('p');rail.textContent=item.design.railCustomColor?'Schiene in Wunschfarbe '+item.design.railColor.toUpperCase():'Schiene: Standardausführung';info.append(rail);}
  const surcharge=document.createElement('p');surcharge.className='rail-item-estimate';surcharge.textContent=railPriceNote(item.design,item.quantity);if(surcharge.textContent)info.append(surcharge);
  const actions=document.createElement('div');actions.className='cart-actions';
  for(const [name,fn] of [['Bearbeiten',()=>{editingId=item.id;state=normalize(item.design);$('#cart').close();sync();step(0);schedule();}],['Entfernen',()=>{const previous=cart;cart=cart.filter(x=>x.id!==item.id);try{persistCart();if(editingId===item.id){editingId=null;persistDraft();}renderCart();}catch{cart=previous;$('#cart-status').textContent='Die Änderung konnte nicht gespeichert werden.';}}]]){const b=document.createElement('button');b.textContent=name;b.addEventListener('click',fn);actions.append(b);}info.append(actions);
  const quantity=document.createElement('input');quantity.type='number';quantity.min='1';quantity.max='99';quantity.value=item.quantity;quantity.setAttribute('aria-label','Menge für '+item.design.text);quantity.addEventListener('input',()=>{const n=Number(quantity.value);if(!Number.isInteger(n)||n<1||n>99){quantity.setCustomValidity('Bitte eine Menge von 1 bis 99 eingeben.');return;}quantity.setCustomValidity('');const old=item.quantity;item.quantity=n;try{persistCart();$('#cart-count').textContent=cart.reduce((sum,line)=>sum+line.quantity,0);surcharge.textContent=railPriceNote(item.design,item.quantity);$('#cart-status').textContent='Menge gespeichert.';}catch{item.quantity=old;quantity.value=old;$('#cart-status').textContent='Die Menge konnte nicht gespeichert werden.';}});quantity.addEventListener('change',()=>{if(!quantity.checkValidity()){quantity.value=item.quantity;quantity.setCustomValidity('');}});
  row.append(info,quantity);host.append(row);
 }
}
$('#open-cart').addEventListener('click',()=>{renderCart();$('#cart-status').textContent='';$('#cart').showModal();});
$('#add-cart').addEventListener('click',()=>{
 if(!result||validate(state))return;const old=cart;
 if(!editingId&&cart.length>=20){$('#review').close();$('#editor-error').textContent='Du kannst bis zu 20 Entwürfe speichern. Entferne zuerst einen Entwurf.';return;}
 const match=cart.find(item=>item.id===editingId);const entry={id:match?.id||crypto.randomUUID(),design:{...state},quantity:match?.quantity||1};cart=match?cart.map(item=>item.id===entry.id?entry:item):[...cart,entry];
 try{persistCart();editingId=entry.id;persistDraft();$('#review').close();renderCart();$('#cart-status').textContent='Dein Entwurf wurde gespeichert.';$('#cart').showModal();step(activeStep,false);}catch{cart=old;$('#review').close();$('#editor-error').textContent='Der Warenkorb konnte nicht gespeichert werden. Bitte aktiviere den lokalen Browserspeicher.';}
});
$('#new-design').addEventListener('click',()=>{editingId=null;state={...DEFAULT};$('#cart').close();sync();step(0);schedule();});
sync();$('#next').disabled=true;$('#download').disabled=true;
try{const {SignRenderer}=await import('./renderer.js?v=16');renderer=new SignRenderer($('#canvas-host'));await update();}catch{setError('Die 3D-Vorschau benötigt WebGL. Bitte verwende einen aktuellen Browser mit aktivierter Grafikbeschleunigung.');}
