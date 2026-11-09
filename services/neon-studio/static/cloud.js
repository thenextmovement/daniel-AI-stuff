/* Ops adds persistence; the existing geometric editor remains unchanged. */
let cloud=null,cloudSpec={},cloudSaving=false;
const cloudBase='/api/ops/neon-studio';
async function cloudRequest(path,data) {
  const r=await fetch(cloudBase+'/cloud/'+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
  const j=await r.json();if(!r.ok)throw new Error(j.error||'Schritt nicht bestätigt.');return j;
}
function cloudLabel(){$('export').querySelector('span:last-child').textContent='In Trello hochladen';$('exportCaption').textContent='PDF · image.png · Technische Zeichnung';}
function setupDownloads(){
  const toggle=$('exportDropdown'),menu=$('exportMenu');
  toggle.hidden=false;toggle.textContent='Download ▾';toggle.setAttribute('aria-label','Download auswählen');
  toggle.parentElement.classList.add('cloud-exports');
  menu.replaceChildren(textElement('div','Dateien auswählen'));
  const formats=[['svg','Vektordatei (SVG)'],['drawing','Maßzeichnung (PDF)'],
    ['custom','PDF mit eigenen Angaben'],['cnc','CNC-Zeichnung 1:1 (PDF)'],['uv','UV-Druck 1:1 (PDF)'],
    ['technical','Technische Zeichnung (JPG)'],['quote','Auto Quote · alle Größen mit Preisen (PDF)'],
    ['preview','Auto Quote · aktuelle Vorschau (PNG)']];
  const checks=formats.map(([value,name])=>{
    const row=document.createElement('label'),box=document.createElement('input');
    box.type='checkbox';box.value=value;box.checked=['technical','quote','preview'].includes(value);
    row.append(box,document.createTextNode(name));menu.append(row);return box;
  });
  const customize=textElement('button','PDF-Angaben bearbeiten');
  customize.type='button';customize.hidden=true;customize.onclick=()=>$('exportDialog').showModal();menu.append(customize);
  menu.classList.add('cloud-downloads');
  const submit=textElement('button','Auswahl herunterladen');submit.type='button';menu.append(submit);
  menu.onchange=()=>{submit.disabled=!checks.some(b=>b.checked);customize.hidden=!checks.find(b=>b.value==='custom').checked;};
  submit.onclick=async()=>{
    if($('export').disabled){toast('Bitte die Bearbeitung abschließen und die Vorschau abwarten.',true);return;}
    const formats=checks.filter(b=>b.checked).map(b=>b.value);
    if(!formats.length)return;
    submit.disabled=true;state.exporting=true;exportState();
    try{
      if(sizesDirty&&formats.includes('quote'))await applySizeFields();
      const spec={...cloudSpec,auto_minimum_mm:window.studioManualMinimum()?null:manufacturingReport?.recommendedWidth,
        light_type:pricing.color,usage:pricing.outdoor?'Außen':'Innen',pricing_options:priceOptions(),
        controllers:Number($('priceControllers').value),uv_print:$('priceUv').checked,
        waterproof_psus:pricing.outdoor?Number($('pricePsus').value):0,shape:state.settings.shape};
      const response=await api('/api/export',{id:state.project.id,settings:state.settings,options:{kind:'download',formats,spec,pdfOptions:state.exportOptions}});
      const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
      link.href=url;link.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'Neon_Studio.zip';
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      toggleExportMenu(false);
    }catch(error){toast(error.message,true);}
    finally{state.exporting=false;exportState();submit.disabled=!checks.some(b=>b.checked);}
  };
}
let sizesDirty=false;
window.studioManualMinimum=()=>cloudSpec.minimum_width_mm;
window.studioManualSizeLabel=()=>cloudSpec.size_axis==='height'&&cloudSpec.manual_height_mm
  ?'Manuelle Mindesthöhe: '+number(cloudSpec.manual_height_mm/10,1)+' cm'
  :'Manuelle Mindestbreite: '+number(cloudSpec.minimum_width_mm/10,1)+' cm';
const extraInputs=['secondSize','thirdSize','fourthSize'];
const sizeInputs=['manualSize',...extraInputs];
function sizeDraftKey(){return 'neonstudio.sizes.'+cloud.id;}
function rememberSizeFields(){
  sizesDirty=true;
  $('previewSize').disabled=true;
  $('sizeDraftStatus').hidden=false;
  try{
    sessionStorage.setItem(sizeDraftKey(),JSON.stringify({revision:cloud.revision,axis:$('sizeAxis').value,
      values:sizeInputs.map(id=>$(id).value)}));
  }catch{/* The fields remain editable if browser storage is unavailable. */}
}
function restoreSizeDraft(){
  let draft;
  try{draft=JSON.parse(sessionStorage.getItem(sizeDraftKey()));}catch{return;}
  if(!draft||draft.revision!==cloud.revision||!Array.isArray(draft.values)||draft.values.length!==sizeInputs.length)return;
  $('sizeAxis').value=draft.axis;
  sizeInputs.forEach((id,i)=>{
    $(id).value=draft.values[i];
    if(draft.values[i])$(id).parentElement.hidden=false;
  });
  updateSizeLabels();rememberSizeFields();
}
function updateSizeLabels(){
  const height=$('sizeAxis').value==='height';
  $$('[data-size-label]').forEach(label=>label.textContent=label.dataset.sizeLabel+'. '+(height?'Höhe':'Breite')+' (cm)');
  $('manualSize').setAttribute('aria-label',(height?'Mindesthöhe':'Mindestbreite')+' in cm');
  $('manualSize').placeholder=!height&&manufacturingReport?number(manufacturingReport.recommendedWidth/10,1)+' (autom.)':'Automatisch';
  $('addSize').hidden=!$('fourthSize').parentElement.hidden;
}
$('addSize').onclick=()=>{
  const id=extraInputs.find(id=>$(id).parentElement.hidden);
  if(id){$(id).parentElement.hidden=false;updateSizeLabels();$(id).focus();}
};
function showSizeFields(){
  $('cloudSizes').hidden=false;
  const byHeight=cloudSpec.size_axis==='height';
  $('sizeAxis').value=byHeight?'height':'width';
  const manual=byHeight?cloudSpec.manual_height_mm:cloudSpec.minimum_width_mm;
  $('manualSize').value=manual==null?'':manual/10;
  const widths=cloudSpec.widths_mm||[];
  const extras=byHeight?(cloudSpec.heights_mm||[]).slice(manual==null?0:1)
    :cloudSpec.minimum_first&&!cloudSpec.sized_widths_mm?(cloudSpec.requested_widths_mm??widths):widths.slice(1);
  extraInputs.forEach((id,i)=>{
    $(id).value=extras[i]==null?'':extras[i]/10;
    $(id).parentElement.hidden=i>0&&i>=extras.length;
  });
  updateSizeLabels();
  sizesDirty=false;
  syncSizePreview();
}
function syncSizePreview(){
  const select=$('previewSize'),widths=cloudSpec.sized_widths_mm||[];
  const current=state.drawing?.width??state.settings.width;
  select.replaceChildren(...widths.map((width,i)=>{
    const index=cloudSpec.manual_height_mm==null?i-1:i;
    const height=cloudSpec.size_axis==='height'?cloudSpec.heights_mm?.[index]:null;
    const cm=Number(((height??width)/10).toFixed(2)).toLocaleString('de-DE');
    return new Option(`Größe ${i+1} · ${height==null?'Breite':'Höhe'} ${cm} cm`,String(width));
  }));
  select.selectedIndex=widths.findIndex(width=>Math.abs(width-current)<.1);
  select.disabled=sizesDirty||cloudSaving||state.busy;
  $('previewSizeRow').hidden=widths.length<2;
}
$('previewSize').onchange=async()=>{
  const width=Number($('previewSize').value);
  if(!width||state.busy||sizesDirty||cloudSaving)return;
  $('previewSize').disabled=true;
  try{await resizeToMinimum(width);}finally{syncSizePreview();}
};
function renderReview(){
  const box=$('cloudReview'),issues=cloudSpec.issues||[];
  box.hidden=!issues.length;
  box.replaceChildren();
  if(!issues.length)return;
  box.append(textElement('h2','Offene Anfrageangaben'));
  issues.forEach(issue=>box.append(textElement('p',issue)));
  const button=textElement('button','Angaben prüfen');button.className='button';button.onclick=cloudDetails;box.append(button);
}
window.addEventListener('studio-minimum-ready',()=>{
  if(!cloud)return;
  syncSizePreview();
  cloudSpec.issues=(cloudSpec.issues||[]).filter(issue=>!cloud.size_issues?.includes(issue));
  updateSizeLabels();
  renderReview();
});
async function applySizeFields(resetMinimum=!!cloudSpec.minimum_width_mm && $('manualSize').value===''){
  if(state.busy||state.analyzing)throw Error('Bitte die Berechnung abwarten.');
  for(const id of ['manualSize',...extraInputs]){
    if(!$(id).reportValidity())throw Error('Bitte ein Maß zwischen 8 und 2000 cm eingeben.');
  }
  const height=$('sizeAxis').value==='height';
  const manual=$('manualSize').valueAsNumber*10;
  const extras=extraInputs.filter(id=>$(id).value!=='').map(id=>$(id).valueAsNumber*10);
  const dimensions=manual?[manual,...extras]:extras;
  if(new Set(dimensions).size!==dimensions.length)throw Error('Bitte unterschiedliche Größen eingeben.');
  if(!manual&&(resetMinimum||!manufacturingReport))await checkManufacturing(false,true);
  const automatic=manufacturingReport?.recommendedWidth;
  const generation=state.generation;
  let converted=dimensions;
  if(height&&dimensions.length){
    const response=await api('/api/manufacturing',{id:state.project.id,settings:state.settings,heights_mm:dimensions});
    converted=(await response.json()).widths_mm;
    if(state.generation!==generation)throw Error('Die Zeichnung wurde geändert. Bitte die Größen erneut bestimmen.');
  }
  const first=manual?converted[0]:automatic;
  if(!first)throw Error('Die automatische Mindestgröße steht noch aus.');
  let additional=manual?converted.slice(1):converted;
  let heights=height?dimensions:[];
  if(resetMinimum){
    heights=height?dimensions.filter((_,i)=>converted[i]>first):[];
    additional=additional.filter(w=>w>first);
  }
  if(additional.some(w=>w<=first))throw Error('Weitere Größen müssen größer als die Mindestgröße sein.');
  await resizeToMinimum(first);
  if(!state.valid||Math.abs(state.drawing.width-first)>.1||
      (height&&manual&&Math.abs(state.drawing.height-manual)>.1))throw Error('Die eingegebene Größe konnte nicht übernommen werden.');
  const widths=[first,...additional];
  Object.assign(cloudSpec,{size_axis:height?'height':'width',heights_mm:heights,
    manual_height_mm:height&&manual?manual:null,minimum_width_mm:manual?first:null,minimum_first:true,smallest_requested:true,
    requested_widths_mm:additional,widths_mm:widths,sized_widths_mm:widths});
  sizesDirty=false;
  if(resetMinimum)showSizeFields();
  if(manual){
    minimumStatus(window.studioManualSizeLabel(),true);
    cloudSpec.issues=(cloudSpec.issues||[]).filter(issue=>!cloud.size_issues?.includes(issue));
    renderReview();
  }
}
$('sizeAxis').onchange=()=>{updateSizeLabels();rememberSizeFields();};
for(const id of sizeInputs)$(id).oninput=rememberSizeFields;
$('setSizes').onclick=async()=>{
  $('setSizes').disabled=true;
  try{await applySizeFields();await cloudSave();toast('Größen übernommen und gespeichert.');}catch(e){toast(e.message,true);}
  finally{$('setSizes').disabled=false;syncSizePreview();}
};
async function cloudSave() {
  if(!cloud||!state.project||state.analyzing||cloudSaving)throw new Error('Bitte die Berechnung abwarten.');
  cloudSaving=true;
  try {
    if(sizesDirty)await applySizeFields();
    await requestGeometry(true);
    if(state.busy||!state.valid)throw new Error('Die Zeichnung ist noch nicht bereit. Bitte die Einstellungen prüfen.');
    cloudSpec.widths_mm=cloudSpec.widths_mm||[];
    if(cloudSpec.widths_mm.length&&!cloudSpec.minimum_first&&$('previewSize').selectedIndex<=0)cloudSpec.widths_mm[0]=state.drawing.width;
    Object.assign(cloudSpec,{light_type:pricing.color,usage:pricing.outdoor?'Außen':'Innen',waterproof_psus:pricing.outdoor?Number($('pricePsus').value):0,uv_print:$('priceUv').checked,controllers:Math.max(1,Number($('priceControllers').value))});
    cloudSpec.pricing_options=priceOptions();
    cloudSpec.shape=state.settings.shape;
    cloud={...cloud,...await cloudRequest('save',{id:cloud.id,revision:cloud.revision,model:state.project.id,settings:state.settings,spec:cloudSpec})};
    if(sizesDirty)rememberSizeFields();
    else{
      try{sessionStorage.removeItem(sizeDraftKey());}catch{}
      $('sizeDraftStatus').hidden=true;
    }
    return cloud;
  } finally {cloudSaving=false;syncSizePreview();}
}
async function cloudPublish(){
  try{await cloudSave();if(cloudSpec.issues?.length){renderReview();setTab('check');return;}cloud=await cloudRequest('publish',{id:cloud.id,revision:cloud.revision});toast('Die drei Dateien werden in Trello hochgeladen.');cloudPoll();}
  catch(e){toast(e.message,true);}
}
function textElement(tag,text){const e=document.createElement(tag);e.textContent=text;return e;}
async function cloudPoll(){
  for(let i=0;i<120;i++){
    await new Promise(r=>setTimeout(r,2000));
    const p=await cloudRequest('project?id='+cloud.id);
    if(!['queued','copying','generating','publishing','publish_queued'].includes(p.status)){
      cloud=p;if(p.status==='ready'){cloudSpec=p.spec;showSizeFields();renderReview();}toast(p.error||(p.status==='ready'?'In Trello aktualisiert.':'Verarbeitung noch nicht bestätigt. Bitte Projektstatus prüfen.'),!!p.error||p.status!=='ready');return;
    }
  }
  toast('Die Verarbeitung läuft weiter. Den Status findest du in der Projektübersicht.');
}
function cloudPriceControls(){
  pricing.color=cloudSpec.light_type||'single';pricing.outdoor=cloudSpec.usage==='Außen';
  $('priceUv').checked=cloudSpec.uv_print===true;$('priceControllers').value=cloudSpec.controllers||1;
  $('pricePsus').value=cloudSpec.waterproof_psus??1;
  $$('[data-price-color]').forEach(b=>{const active=b.dataset.priceColor===pricing.color;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
  $$('[data-price-outdoor]').forEach(b=>{const active=(b.dataset.priceOutdoor==='true')===pricing.outdoor;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
  $('pricePsuRow').hidden=!pricing.outdoor;$('priceOutdoorNote').hidden=!pricing.outdoor;
  const warning=$('cloudSizeWarning');if(warning&&!state.project){
    if(cloudSpec.auto_minimum_mm){
      warning.hidden=false;warning.textContent=`Kleinste geprüfte Breite mit ${cloudSpec.minimum_tube_mm||8}-mm-Neonflex: `+(cloudSpec.auto_minimum_mm/10).toLocaleString('de-DE')+' cm';return;
    }
    warning.hidden=cloudSpec.minimum_width_mm==null&&!!cloudSpec.widths_mm?.length;
    warning.textContent=cloudSpec.minimum_width_mm!=null?'Mindestbreite: '+(cloudSpec.minimum_width_mm/10).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' cm · manuell':'Vorschaugröße – Mindestgröße noch nicht geprüft';
  }
}
function cloudDetails(){
  let dialog=document.getElementById('cloudDetails');if(dialog)dialog.remove();
  dialog=document.createElement('dialog');dialog.id='cloudDetails';
  Object.assign(dialog.style,{maxWidth:'520px',width:'90%',padding:'24px',borderRadius:'16px',background:'#25292c',color:'white',border:'1px solid #555'});
  dialog.append(textElement('h2','Anfrageangaben'));
  const fields=[['customer_name','Kundenname'],['colors','Leuchtfarbe (Deutsch)'],['widths_mm','Breiten in cm, getrennt mit Semikolon'],['minimum_width_mm','Mindestbreite in cm (manuell, optional)'],['usage','Innen oder Außen'],['quantity','Stückzahl'],['waterproof_psus','Wasserdichte Netzteile (bei Außen)']];
  if(cloudSpec.size_axis==='height')dialog.append(textElement('p','Die Höhen kannst du über „Größen manuell bestimmen“ ändern.'));
  const inputs={};
  for(const [key,label] of fields){
    if(cloudSpec.size_axis==='height'&&['widths_mm','minimum_width_mm'].includes(key))continue;
    const wrap=textElement('label',label);wrap.style.display='block';wrap.style.margin='12px 0';
    const input=document.createElement('input');input.style.width='100%';
    input.value=key==='widths_mm'?(cloudSpec[key]||[]).map(v=>Number((v/10).toFixed(2))).join('; '):key==='minimum_width_mm'?(cloudSpec[key]==null?'':String(cloudSpec[key]/10).replace('.',',')):String(cloudSpec[key]??'');
    wrap.append(input);dialog.append(wrap);inputs[key]=input;
    if(key==='minimum_width_mm'){
      input.inputMode='decimal';input.setAttribute('aria-describedby','cloudMinimumHint');
      const hint=textElement('p','Wird in Trello, PDF und image.png vermerkt. Ohne Angebotsbreite wird diese Größe verwendet. Keine automatische Fertigungsfreigabe.');
      hint.id='cloudMinimumHint';hint.style.cssText='font-size:12px;line-height:1.4;color:#bbc1c7;margin:4px 0 12px';dialog.append(hint);
    }
  }
  const reviewed=(cloudSpec.issues||[]).map(issue=>{
    const label=textElement('label',issue);label.style.display='block';const check=document.createElement('input');check.type='checkbox';label.prepend(check);dialog.append(label);return {issue,check};
  });
  if(reviewed.length)dialog.append(textElement('p','Geklärte Punkte bitte abhaken.'));
  const save=textElement('button','Angaben übernehmen');
  save.onclick=async()=>{
    const next={...cloudSpec,issues:reviewed.filter(r=>!r.check.checked).map(r=>r.issue)};
    for(const [key,input] of Object.entries(inputs))next[key]=input.value.trim();
    if(inputs.widths_mm){
      next.minimum_width_mm=next.minimum_width_mm===''?null:Number(next.minimum_width_mm.replace(',','.'))*10;
      if(next.minimum_width_mm!==null&&(!Number.isFinite(next.minimum_width_mm)||next.minimum_width_mm<80||next.minimum_width_mm>20000)){toast('Bitte eine Mindestbreite zwischen 8 cm und 20 m eintragen oder das Feld leer lassen.',true);return;}
      next.widths_mm=next.widths_mm===''?(next.minimum_width_mm===null?[]:[next.minimum_width_mm]):next.widths_mm.split(';').map(v=>Number(v.trim().replace(',','.'))*10);
      if(next.widths_mm.length>4||next.widths_mm.some(v=>!Number.isFinite(v)||v<80||v>20000)){toast('Bitte höchstens vier Breiten zwischen 8 cm und 20 m eintragen.',true);return;}
      if(next.minimum_width_mm!==null&&next.widths_mm.some(v=>v<next.minimum_width_mm-.1)){toast('Eine Angebotsbreite liegt unter der manuellen Mindestbreite. Bitte die Breiten anpassen.',true);return;}
    }
    next.quantity=Number(next.quantity||1);next.waterproof_psus=next.waterproof_psus===''?null:Number(next.waterproof_psus);
    cloudSpec=next;renderReview();showSizeFields();cloudPriceControls();if(inputs.widths_mm&&next.widths_mm.length){state.settings.width=next.widths_mm[0];state.settings.scale=null;}
    dialog.close();await requestGeometry(true);try{await cloudSave();toast('Angaben gespeichert.');}catch(e){toast(e.message,true);}
  };
  const cancel=textElement('button','Schließen');cancel.onclick=()=>dialog.close();dialog.append(save,cancel);document.body.append(dialog);dialog.showModal();
}
function cloudSources(){
  const dialog=document.createElement('dialog');
  dialog.style.cssText='max-width:600px;width:90%;padding:24px;background:#25292c;color:white;border:1px solid #666;border-radius:16px';
  dialog.append(textElement('h2','Kundenmotiv wählen'));
  dialog.append(textElement('p','Wähle die Vorlage, aus der die Zeichnung entstehen soll. Die vorhandenen Anhänge bleiben erhalten.'));
  const checks=[];
  for(const a of cloud.attachments||[]){
    const label=textElement('label',a.name);label.style.cssText='display:block;padding:10px';
    const input=document.createElement('input');input.type='checkbox';input.value=a.id;input.checked=(cloud.selected_attachments||[]).includes(a.id);
    label.prepend(input);dialog.append(label);checks.push(input);
  }
  const retry=textElement('button','Zeichnung neu erstellen');
  retry.onclick=async()=>{
    try {
      const attachments=checks.filter(i=>i.checked).map(i=>i.value);
      if(!attachments.length)throw new Error('Bitte mindestens eine Vorlage auswählen.');
      cloud=await cloudRequest('retry',{id:cloud.id,revision:cloud.revision,attachments});
      dialog.close();location.reload();
    }catch(e){toast(e.message,true);}
  };
  const close=textElement('button','Schließen');close.onclick=()=>dialog.close();
  dialog.append(retry,close);document.body.append(dialog);dialog.showModal();
}
async function cloudBoot(){
  const id=new URLSearchParams(location.search).get('project');
  const bar=document.createElement('div');bar.style.cssText='display:flex;gap:10px;align-items:center;padding:8px 18px;background:#25292c;color:#fff;flex-wrap:wrap';
  const back=textElement('a','Alle Anfragen');back.href=cloudBase+'/';bar.append(back);
  const status=textElement('span','Gespeicherte Neon-Projekte');bar.append(status);
  document.body.prepend(bar);
  const resize=()=>{const workspace=document.querySelector('.workspace');if(workspace)workspace.style.height='calc(100dvh - '+(78+bar.offsetHeight)+'px)';};new ResizeObserver(resize).observe(bar);resize();
  if(!id){
    const shell=document.querySelector('main')||document.querySelector('.workspace');if(shell)shell.hidden=true;
    document.querySelectorAll('body > header').forEach(e=>e.hidden=true);
    const panel=document.createElement('section');panel.style.cssText='padding:24px;overflow:auto;max-height:85vh;color:white';
    panel.append(textElement('h1','Neon Studio'));
    panel.append(textElement('p','LED/Neon-Anfragen werden beim Verschieben zu Quentin zusätzlich vorbereitet. Hier bearbeitest du die gespeicherten Entwürfe.'));
    const form=document.createElement('form');form.style.cssText='margin:24px 0;max-width:760px';
    const label=textElement('label','Trello-Link');label.htmlFor='trelloCardLink';label.style.cssText='display:block;margin-bottom:8px';
    const row=document.createElement('div');row.style.cssText='display:flex;gap:10px;flex-wrap:wrap';
    const input=document.createElement('input');input.id='trelloCardLink';input.name='card';input.required=true;
    input.placeholder='https://trello.com/c/…';input.autocomplete='off';input.spellcheck=false;
    input.style.cssText='flex:1 1 280px;min-width:0;padding:12px';
    input.setAttribute('aria-describedby','trelloLinkHint trelloLinkStatus');
    const start=textElement('button','Anfrage laden');start.type='submit';
    const hint=textElement('p','Vorhandene Entwürfe öffnen sich direkt – auch über den Link der Roboter-Kopie. Neue LED/Neon-Anfragen werden als Kopie vorbereitet.');
    hint.id='trelloLinkHint';hint.style.cssText='font-size:13px;line-height:1.5;color:#bbc1c7';
    const feedback=textElement('p','');feedback.id='trelloLinkStatus';feedback.setAttribute('role','status');feedback.hidden=true;
    form.onsubmit=async event=>{
      event.preventDefault();if(start.disabled)return;
      start.disabled=true;input.readOnly=true;start.textContent='Wird geladen…';feedback.hidden=false;feedback.textContent='Trello-Karte wird geprüft…';input.removeAttribute('aria-invalid');
      try{
        const p=await cloudRequest('enqueue',{card:input.value.trim()});
        location.href=cloudBase+'/?project='+encodeURIComponent(p.id);
      }catch(e){
        feedback.textContent=e.message;input.setAttribute('aria-invalid','true');start.disabled=false;input.readOnly=false;start.textContent='Anfrage laden';input.focus();
      }
    };
    row.append(input,start);form.append(label,row,hint,feedback);panel.append(form);
    const list=await cloudRequest('list');
    if(list.watch_error||list.alert_error)panel.append(textElement('p',list.watch_error||list.alert_error));
    for(const p of list.projects){
      const a=textElement('a',p.name+' · '+({queued:'Wartet',copying:'Karte wird kopiert',generating:'Zeichnung entsteht',publishing:'Übertragung läuft',publish_queued:'Wartet auf Übertragung',ready:'Zur Prüfung bereit',review:'Prüfung erforderlich',draft:'Entwurf'}[p.status]||p.status)+(p.error?' · '+p.error:''));
      a.href=cloudBase+'/?project='+p.id;a.style.cssText='display:block;padding:14px;border-bottom:1px solid #555;color:white';panel.append(a);
    }
    document.body.append(panel);return;
  }
  cloud=await cloudRequest('project?id='+encodeURIComponent(id));cloudSpec=cloud.spec||{};
  status.textContent=cloud.name;
  const sizeWarning=textElement('span','Vorschaugröße – Mindestgröße noch nicht geprüft');sizeWarning.id='cloudSizeWarning';sizeWarning.hidden=!!cloudSpec.widths_mm?.length;bar.append(sizeWarning);
  if(cloud.model){
    const check=textElement('button','Mindestgröße ermitteln');
    check.id='cloudMinimumCheck';check.disabled=true;
    check.onclick=async()=>{
      if(!sizesDirty||!window.studioManualMinimum()||$('manualSize').value!==''||$('manualSize').validity.badInput){
        await checkManufacturing(true);
        return;
      }
      try{
        await applySizeFields(true);
        minimumStatus('Geometrische Mindestbreite: '+number(state.drawing.width/10,1)+' cm',true);
        await cloudSave();
        toast('Automatische Mindestgröße übernommen und gespeichert.');
      }catch(error){toast(error.message,true);}
    };
    const limit=textElement('button','Engstelle zeigen');
    limit.id='cloudShowLimit';limit.type='button';limit.hidden=true;
    limit.onclick=toggleLimit;
    bar.append(check,limit);
  }
  const savedPrice=cloudSpec.pricing_options;
  if(savedPrice){
    for(const [id,key] of [['pricePacking','mode'],['priceMinimum','minimum_shipping_usd'],['priceExtra','additional_cost_usd'],['priceFactor','sales_factor']]){
      if(savedPrice[key]!=null)$(id).value=savedPrice[key];
    }
    if(savedPrice.footprint_cm){[$('priceSplitWidth').value,$('priceSplitHeight').value]=savedPrice.footprint_cm;}
    $('priceSplit').hidden=$('pricePacking').value!=='split';
    $('priceFactorValue').textContent=number(Number($('priceFactor').value),1);
  }
  cloudPriceControls();
  const source=textElement('button','Kundenmotiv wählen');
  source.onclick=()=>cloudSources();
  bar.append(source);
  if(!cloud.model||['queued','copying','generating'].includes(cloud.status)){
    processing('Anfrage wird vorbereitet',cloud.error||'Das Kundenmotiv wird auf dem Server als Zeichnung erstellt. Du kannst dieses Fenster schließen und später wieder öffnen.');
    if(cloud.error){$('processingOverlay').hidden=true;toast(cloud.error,true);cloudSources();}
    if(['queued','copying','generating'].includes(cloud.status))setTimeout(()=>location.reload(),10000);
    return;
  }
  state.project=cloud.model;state.settings={...defaults,...cloud.settings};$('tube').disabled=true;state.analyzing=false;state.history=[];state.historyIndex=-1;
  if(state.settings.geometricSizing||state.settings.autoRoute){$('gapHelp').textContent='Freier Rand zwischen Acrylkante und Außenkante des Neonstreifens.';$('tubeHelp').textContent=`Neonbreite in dieser Zeichnung: ${state.settings.tube} mm.`;}
  showSizeFields();restoreSizeDraft();renderReview();
  commitHistory();renderProject();updateControls();await requestGeometry(true);
  const plan=document.createElement('div');plan.className='help-text';
  if(cloud.metrics?.model)plan.append(textElement('p','KI-Zeichnung: '+cloud.metrics.model+'. Die Mindestgröße wird aus den Verlegepfaden berechnet.'));
  for(const region of cloudSpec.line_plan||[])plan.append(textElement('p',region.name+' · '+(region.mode==='double'?'Double Line':'Single Line')+': '+region.reason));
  $('manufacturingResult').before(plan);
  await checkManufacturing();
  $('export').onclick=cloudPublish;cloudLabel();setupDownloads();
  const save=textElement('button','Entwurf speichern');save.onclick=async()=>{try{await cloudSave();toast('Entwurf gespeichert.');}catch(e){toast(e.message,true);}};
  const details=textElement('button','Anfrageangaben');details.onclick=cloudDetails;
  bar.append(save,details);
  if(cloud.copy_url){const a=textElement('a','Trello-Karte');a.href=cloud.copy_url;a.target='_blank';a.rel='noopener';bar.append(a);}
  if(cloud.error&&!cloud.error.startsWith('Bitte prüfen:'))toast(cloud.error,true);
  window.addEventListener('beforeunload',event=>{if(state.historyIndex>0){event.preventDefault();event.returnValue='';}});
}
cloudBoot().catch(error=>toast(error.message,true));
