/* Ops adds persistence; the existing geometric editor remains unchanged. */
let cloud=null,cloudSpec={},cloudSaving=false;
const cloudBase='/api/ops/neon-studio';
async function cloudRequest(path,data) {
  const r=await fetch(cloudBase+'/cloud/'+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
  const j=await r.json();if(!r.ok)throw new Error(j.error||'Schritt nicht bestätigt.');return j;
}
function cloudLabel(){$('export').querySelector('span:last-child').textContent='In Trello hochladen';$('exportCaption').textContent='PDF · image.png · Technische Zeichnung';}
async function cloudSave() {
  if(!cloud||!state.project||state.analyzing||cloudSaving)throw new Error('Bitte die Berechnung abwarten.');
  cloudSaving=true;
  try {
    await requestGeometry(true);
    if(state.busy||!state.valid)throw new Error('Die Zeichnung ist noch nicht bereit. Bitte die Einstellungen prüfen.');
    cloudSpec.widths_mm=cloudSpec.widths_mm||[];cloudSpec.widths_mm[0]=state.drawing.width;
    cloudSpec.shape=state.settings.shape;
    cloud={...cloud,...await cloudRequest('save',{id:cloud.id,revision:cloud.revision,model:state.project.id,settings:state.settings,spec:cloudSpec})};
    return cloud;
  } finally {cloudSaving=false;}
}
async function cloudPublish(){
  try{await cloudSave();cloud=await cloudRequest('publish',{id:cloud.id,revision:cloud.revision});toast('Die drei Dateien werden in Trello hochgeladen.');cloudPoll();}
  catch(e){toast(e.message,true);}
}
function textElement(tag,text){const e=document.createElement(tag);e.textContent=text;return e;}
async function cloudPoll(){
  for(let i=0;i<120;i++){
    await new Promise(r=>setTimeout(r,2000));
    const p=await cloudRequest('project?id='+cloud.id);
    if(!['queued','copying','generating','publishing','publish_queued'].includes(p.status)){
      cloud=p;toast(p.error||(p.status==='ready'?'In Trello aktualisiert.':'Verarbeitung noch nicht bestätigt. Bitte Projektstatus prüfen.'),!!p.error||p.status!=='ready');return;
    }
  }
  toast('Die Verarbeitung läuft weiter. Den Status findest du in der Projektübersicht.');
}
function cloudDetails(){
  let dialog=document.getElementById('cloudDetails');if(dialog)dialog.remove();
  dialog=document.createElement('dialog');dialog.id='cloudDetails';
  Object.assign(dialog.style,{maxWidth:'520px',width:'90%',padding:'24px',borderRadius:'16px',background:'#25292c',color:'white',border:'1px solid #555'});
  dialog.append(textElement('h2','Anfrageangaben'));
  const fields=[['customer_name','Kundenname'],['colors','Leuchtfarbe (Deutsch)'],['widths_mm','Breiten in cm, getrennt mit Semikolon'],['usage','Innen oder Außen'],['quantity','Stückzahl'],['waterproof_psus','Wasserdichte Netzteile (bei Außen)']];
  const inputs={};
  for(const [key,label] of fields){
    const wrap=textElement('label',label);wrap.style.display='block';wrap.style.margin='12px 0';
    const input=document.createElement('input');input.style.width='100%';
    input.value=key==='widths_mm'?(cloudSpec[key]||[]).map(v=>v/10).join('; '):String(cloudSpec[key]??'');
    wrap.append(input);dialog.append(wrap);inputs[key]=input;
  }
  const save=textElement('button','Angaben übernehmen');
  save.onclick=async()=>{
    const next={...cloudSpec,issues:[]};
    for(const [key] of fields)next[key]=inputs[key].value.trim();
    next.widths_mm=next.widths_mm.split(';').map(v=>Number(v.trim().replace(',','.'))*10);
    next.quantity=Number(next.quantity||1);next.waterproof_psus=next.waterproof_psus===''?null:Number(next.waterproof_psus);
    cloudSpec=next;state.settings.width=next.widths_mm[0];state.settings.scale=null;
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
    const row=document.createElement('div'),input=document.createElement('input');input.placeholder='Trello-Karten-ID für einen Test';input.style.width='300px';
    const start=textElement('button','Testkopie vorbereiten');start.onclick=async()=>{try{const p=await cloudRequest('enqueue',{card:input.value.trim()});location.href=cloudBase+'/?project='+p.id;}catch(e){toast(e.message,true);}};
    row.append(input,start);panel.append(row);
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
  const source=textElement('button','Kundenmotiv wählen');
  source.onclick=()=>cloudSources();
  bar.append(source);
  if(!cloud.model){
    processing('Anfrage wird vorbereitet',cloud.error||'Das Kundenmotiv wird als Zeichnung erstellt. Du kannst dieses Fenster schließen und später wieder öffnen.');
    if(cloud.error){$('processingOverlay').hidden=true;toast(cloud.error,true);cloudSources();}
    if(['queued','copying','generating'].includes(cloud.status))setTimeout(()=>location.reload(),10000);
    return;
  }
  state.project=cloud.model;state.settings={...defaults,...cloud.settings};state.analyzing=false;state.history=[];state.historyIndex=-1;
  commitHistory();renderProject();updateControls();await requestGeometry(true);
  $('export').onclick=cloudPublish;cloudLabel();$('exportDropdown').hidden=true;
  const save=textElement('button','Entwurf speichern');save.onclick=async()=>{try{await cloudSave();toast('Entwurf gespeichert.');}catch(e){toast(e.message,true);}};
  const details=textElement('button','Anfrageangaben');details.onclick=cloudDetails;
  bar.append(save,details);
  if(cloud.copy_url){const a=textElement('a','Trello-Karte');a.href=cloud.copy_url;a.target='_blank';a.rel='noopener';bar.append(a);}
  if(cloud.error)toast(cloud.error,true);
  window.addEventListener('beforeunload',event=>{if(state.historyIndex>0){event.preventDefault();event.returnValue='';}});
}
cloudBoot().catch(error=>toast(error.message,true));
