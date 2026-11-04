'use strict';

const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];
const icons = {
  move:'<path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4"/>',
  scissors:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8 8 12 12M8 16 20 4"/>',
  recover:'<path d="M3 18c4-12 8 6 12-6M17 3v8m-4-4h8"/><circle cx="4" cy="18" r="2"/>',
  rectangle:'<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/>',
  brush:'<path d="m9 15 9-12 3 3-12 9M9 15c-5-3-2 6-7 6 6 2 11-1 7-6"/>',
  pipette:'<path d="m15 4 5 5M5 19l-2 2m3-3 11-11 2-2a2 2 0 0 0-3-3l-2 2L3 15v4h4z"/>',
  file:'<path d="M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z"/><path d="M14 2v7h7M7 13h10M7 17h7"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  download:'<path d="M12 3v13m-5-5 5 5 5-5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  undo:'<path d="m9 5-5 5 5 5M4 10h10a6 6 0 0 1 0 12" transform="translate(0 -2)"/>',
  redo:'<path d="m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12" transform="translate(0 -2)"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:'<path d="m3 3 18 18M10 5.2A13 13 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3 3.8M6.2 6.2A20 20 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.8-1.8M10 10a3 3 0 0 0 4 4"/>',
  ruler:'<path d="m16 3 5 5L8 21l-5-5zM13 6l2 2m-5 1 2 2m-5 1 2 2"/>',
  pointer:'<path d="m5 3 15 10-7 1-3 7z"/>',
  hand:'<path d="M8 12V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v7c0 4-3 7-7 7h-1c-2 0-3-1-4-3l-4-6c-1-2 1-3 2-2l2 2"/>',
  palette:'<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h4a5 5 0 0 0 5-5c0-3-5-5-9-5Z"/><circle cx="7" cy="9" r="1"/><circle cx="11" cy="6" r="1"/><circle cx="16" cy="7" r="1"/>',
  left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',
  contour:'<path d="M5 17C5 7 19 17 19 7"/><circle cx="5" cy="17" r="2.5"/><circle cx="19" cy="7" r="2.5"/>',
  pointAdd:'<path d="M3 16h6m6 0h6M12 2v6m-3-3h6"/><circle cx="12" cy="16" r="3"/>',
  pointDelete:'<path d="M3 16h6m6 0h6M9 5h6"/><circle cx="12" cy="16" r="3"/>',
  straighten:'<path d="M6 12h12"/><circle cx="3" cy="12" r="2.5"/><circle cx="21" cy="12" r="2.5"/>',
  crop:'<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>',
  fit:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  link:'<path d="m10 13 4-4m-7 6-2 2a4 4 0 0 0 6 5l4-4a4 4 0 0 0 0-6M17 9l2-2a4 4 0 0 0-6-5L9 6a4 4 0 0 0 0 6" transform="translate(0 0) scale(.95)"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  settings:'<path d="m9 3 1-1h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1z" transform="translate(1 1) scale(.88)"/><circle cx="12" cy="12" r="3.3"/>',
  sliders:'<path d="M4 6h7m5 0h4M4 12h2m5 0h9M4 18h10m5 0h1"/><circle cx="13.5" cy="6" r="2.5"/><circle cx="8.5" cy="12" r="2.5"/><circle cx="16.5" cy="18" r="2.5"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.info}</svg>`; }
function paintIcons(root=document) { root.querySelectorAll('[data-icon]').forEach(el => {el.innerHTML=icon(el.dataset.icon);}); }
paintIcons();

const defaults = {mode:'double',shape:'bottom',width:600,gap:15,gapSides:{},tube:6,depth:20,depthSides:{},radius:3,reserve:.1,scale:null,partModes:{},straightened:{},pathSplits:{},pathOffsets:{},outlineEdits:[],depthRegions:[],uvStrokes:[],uvMode:'original',hiddenPaths:[],pathColors:{}};
const presets = {
  technical:{neon:'#79c6ff',acrylic:'#aab4be',background:'#222527',opacity:8,glow:false},
  glow:{neon:'#fc7249',acrylic:'#aab4be',background:'#202224',opacity:4,glow:true},
  light:{neon:'#1951ae',acrylic:'#a3b4c1',background:'#e9edf0',opacity:18,glow:false}
};
function validPrefs(p) {
  const v={...presets.light};
  for (const key of ['neon','acrylic','background']) if (/^#[0-9a-f]{6}$/i.test(p?.[key])) v[key]=p[key];
  if (Number.isFinite(p?.opacity)) v.opacity=Math.max(0,Math.min(60,p.opacity));
  v.glow=Boolean(p?.glow);v.logoColors=p?.logoColors!==false; return v;
}
function readLocal(key,fallback) {try {return JSON.parse(localStorage.getItem(key)) || fallback;}catch{return fallback;}}
function saveLocal(key,value) {try {localStorage.setItem(key,JSON.stringify(value));}catch{/* Private modes can refuse persistence. */}}
const state = {project:null, settings:{...defaults}, drawing:null, view:'vectors',dimensions:true,
  dimensionUnit:readLocal('neonstudio.dimensionUnit.v1','cm')==='mm'?'mm':'cm',
  tab:'acrylic',zoom:100,pan:{x:0,y:0},tool:'select',selection:-1,selectedParts:[],selectedKeys:[],straightenSelection:null,outlineDraft:null,outlineBusy:false,outlineTicket:0,outlineError:'',outlineSelection:[],valid:false,busy:false,analyzing:false,
  exportKind:'cnc',exporting:false, generation:0, uploadGeneration:0, history:[],historyIndex:-1,
  prefs:validPrefs(readLocal('neonstudio.view.v1',presets.light)),
  customPresets:readLocal('neonstudio.presets.v1',{}),
  exportOptions:{dimensions:true,meters:true,includeTitle:true,title:'',note:''}};
let recoverySession=null, recoveryTimer;
let geometryTimer, depthPreviewTimer, toastTimer, dragInfo, regionStart, cropStart, cropRect=null, uvDraft=null, moveDraft=null;
let geometryPending=null, geometryRunning=false, geometryContext=0;
const number=(v,digits=1) => new Intl.NumberFormat('de-DE',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(v);

function toast(message,error=false) {
  clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;
  toastTimer=setTimeout(()=>{$('toast').hidden=true;},error?8500:3500);
}
async function api(path,payload) {
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if (!response.ok) {const error=await response.json().catch(()=>({}));throw new Error(error.error || 'Der lokale Dienst antwortet nicht.');}
  return response;
}
function setLive(text,status='') {
  $('liveStatus').className='live-indicator '+status;$('liveStatus').querySelector('span').textContent=text;
}
function exportState() { $('export').disabled=!state.project||!state.valid||state.busy||state.exporting||!!state.straightenSelection||!!state.outlineDraft||state.outlineBusy||!!uvDraft||!!moveDraft||!!recoverySession; }
function markPending() {invalidateManufacturing();cancelMoveSelection();closeRecovery(false);invalidatePrice();clearOutlineDraft();state.outlineSelection=[];state.outlineSelected=null;state.busy=true;state.valid=false;state.straightenSelection=null;renderStraightenControls();renderVisibilityControls();exportState();setLive('Berechne …','busy');}

async function loadImage(file=null, suppliedData=null, suppliedName=null, cropSource=null) {
  if(file && file.size>100*1024*1024) return toast('Bitte eine Datei mit höchstens 100 MB auswählen.',true);
  const ticket=++state.uploadGeneration;++state.generation;clearTimeout(geometryTimer);
  state.analyzing=true;markPending();processing('Datei wird vorbereitet','Große Bilder werden für die Motivauswahl verkleinert. Bei Vektoren bleiben die originalen Kurven erhalten.');
  try {
    let data=suppliedData;
    if(file) data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Bild konnte nicht gelesen werden.'));r.readAsDataURL(file);});
    const name=suppliedName || file?.name || 'B_KITE.png';
    let response,importMode=null;
    if(data){
      let prepared=await (await api('/api/prepare',{data,name})).json();
      if(ticket!==state.uploadGeneration)return;
      let selected;
      do{
        selected=await (prepared.kind==='vector'?chooseVectorMotif(prepared):chooseMotif(prepared));
        if(selected?.nextPrepared)prepared=selected.nextPrepared;
      }while(selected?.nextPrepared);
      if(ticket!==state.uploadGeneration)return;
      if(!selected){finishAnalysis();if(state.project)await requestGeometry(true);else{state.busy=false;setLive('Bereit');exportState();}return;}
      if(prepared.kind!=='vector'&&!cropSource)cropSource={data:prepared.image,name:prepared.kind==='pdf-raster'?name.replace(/\.[^.]+$/,'')+'.png':name};
      if(prepared.kind==='vector'){
        importMode=selected.mode;
        processing(importMode==='single'?'Single Lines werden vorbereitet':'Vektorpfade werden übernommen',importMode==='single'?'Aus gefüllten Formen werden Mittellinien berechnet. Vorhandene Mittellinien werden direkt übernommen.':'Die ausgewählten Originalkurven und Farben werden ohne Raster-Nachzeichnung importiert.');
      }
      else processing('Dein Motiv wird nachgezeichnet','Mittellinien, Verzweigungen und Kurven werden aus den ausgewählten Bildteilen berechnet.');
      response=await api('/api/trace-selection',{id:prepared.id,...selected});
    }else response=await api('/api/example',{});
    const project=await response.json();
    if(ticket!==state.uploadGeneration)return;
    project.originalData=project.image;
    // Keep the full raster separate from the traced motif and any later crops.
    if(project.sourceKind!=='vector')project.cropSource=cropSource||{data:project.image,name:project.name};
    state.project=project;state.selection=-1;state.selectedParts=[];state.selectedKeys=[];closePathColor();state.pan={x:0,y:0};state.zoom=100;
    state.settings.scale=null;state.settings.partModes={};state.settings.straightened={};state.settings.pathSplits={};state.settings.pathOffsets={};state.settings.outlineEdits=[];state.settings.depthRegions=[];state.settings.uvStrokes=[];state.settings.hiddenPaths=[];state.settings.pathColors={};setTool('select');
    if(project.sourceKind==='vector'){
      state.settings.mode=importMode||(project.vectorHasFills?'double':'single');
      state.settings.scale=1;
      state.settings.width=project.nativeWidthMm+['left','right'].reduce((sum,side)=>sum+(state.settings.gapSides?.[side]??state.settings.gap),0);
    }else if(project.suggestedMode==='single')state.settings.mode='single';
    $('pdfTitle').value=name.replace(/\.[^.]+$/,'');state.exportOptions.title=$('pdfTitle').value;
    state.analyzing=false;commitHistory();renderProject();processing('Außenkontur wird berechnet','Neonlänge und Abstände werden für deine Zeichnung geprüft.');await requestGeometry(true);
    if(project.sourceKind==='trace')toast('Automatisch nachgezeichnet. Mit dem Original vergleichen und die Kurven prüfen.');
  }catch(error){
    if(ticket!==state.uploadGeneration)return;
    finishAnalysis();state.busy=false;toast(error.message,true);
    if(state.project)await requestGeometry(true);else{setLive('Kein Motiv','error');exportState();}
  }finally{if(ticket===state.uploadGeneration){finishAnalysis();$('fileInput').value='';}}
}

function snapshot() {return {project:state.project,settings:{...state.settings}};}
function commitHistory() {
  const last=state.history[state.historyIndex];
  if(last?.project===state.project && JSON.stringify(last.settings)===JSON.stringify(state.settings))return;
  state.history=state.history.slice(0,state.historyIndex+1);state.history.push(snapshot());
  if(state.history.length>60)state.history.shift();state.historyIndex=state.history.length-1;updateHistoryButtons();
}
function updateHistoryButtons() { $('undo').disabled=state.historyIndex<=0;$('redo').disabled=state.historyIndex>=state.history.length-1; }
function historyMove(delta) {
  if(state.analyzing)return;
  cancelMoveSelection();uvDraft=null;closeRecovery(false);
  const index=state.historyIndex+delta;if(index<0||index>=state.history.length)return;
  ++state.uploadGeneration;state.historyIndex=index;const item=state.history[index];
  state.project=item.project;state.settings={...item.settings};state.selection=-1;state.selectedParts=[];state.selectedKeys=[];closePathColor();
  renderProject();updateControls();updateHistoryButtons();requestGeometry(true);
}

function requestGeometry(immediate=false,live=false) {
  if(!state.project||state.analyzing)return;
  clearTimeout(geometryTimer);const generation=++state.generation;markPending();
  // A slider stream may display checked intermediate contours. Other actions
  // (undo, upload, mode changes, release) invalidate that stream immediately.
  if(!live)++geometryContext;
  geometryPending?.resolve();
  const done=new Promise(resolve=>{geometryPending={project:state.project,settings:{...state.settings},generation,context:geometryContext,live,resolve};});
  if(immediate||live)runGeometry();else geometryTimer=setTimeout(runGeometry,65);
  return done;
}
async function runGeometry() {
  if(geometryRunning||!geometryPending)return;
  const job=geometryPending;geometryPending=null;
  const {project,settings,generation,context,live}=job;
  geometryRunning=true;
  try {
    if(project!==state.project||state.analyzing||generation!==state.generation)return;
    const response=await api('/api/geometry',{id:project.id,settings,preview:live});const drawing=await response.json();
    const latest=generation===state.generation;
    if(project!==state.project||state.analyzing||context!==geometryContext||(!latest&&!live))return;
    if(latest&&!live){
      const last=state.history[state.historyIndex];
      const historyMatches=last?.project===project && JSON.stringify(last.settings)===JSON.stringify(settings);
      state.settings.scale=drawing.settings.scale;state.settings.width=drawing.width;
      if(historyMatches)last.settings={...state.settings};
      state.busy=false;state.valid=drawing.exportable;
    }
    state.drawing=drawing;
    state.selectedKeys=state.selectedKeys.filter(key=>drawing.pathKeys.includes(key));
    state.selection=state.selectedKeys.length?drawing.pathKeys.indexOf(state.selectedKeys.at(-1)):-1;
    state.selectedParts=[...new Set(state.selectedKeys.map(key=>drawing.pathPartIds[drawing.pathKeys.indexOf(key)]))];
    renderDrawing();renderDetails();exportState();
    if(latest&&!live)updateControls();
    setLive(live?'Live-Vorschau':'Live',live?'busy':'');
    $('liveStatus').title=`Geometrie berechnet in ${number(drawing.renderMs,1)} ms`;
  }catch(error){
    if(generation!==state.generation||project!==state.project||state.analyzing||live)return;
    state.busy=false;state.valid=false;renderStraightenControls();exportState();setLive('Einstellungen prüfen','error');
    $('geometryNotice').hidden=false;$('geometryNotice').textContent=error.message;toast(error.message,true);
  }finally{
    geometryRunning=false;job.resolve();
    // Only one request runs at a time; skipped slider values cannot build up
    // a queue of obsolete CPU-heavy calculations.
    if(geometryPending)runGeometry();
  }
}
function setSetting(key,value,commit=true,side=null) {
  if(state.analyzing)return;
  if(key==='width' && state.settings.scale!==null){
    // Resize the motif; contour-to-path gaps stay in millimetres.
    // Use the last valid drawing so intermediate numeric input cannot compound
    // a bad scale, and rapid slider events always have the same reference.
    const drawing=state.drawing;
    const padding=s=>(s.gapSides?.left??s.gap)+(s.gapSides?.right??s.gap);
    const span=drawing?drawing.width-padding(drawing.settings):0;
    state.settings.scale=span>0 && value>padding(state.settings)+20
      ? drawing.settings.scale*(value-padding(state.settings))/span : null;
  }
  if(key==='depth'||key==='gap'){
    if(side)state.settings[key+'Sides']={...state.settings[key+'Sides'],[side]:value};
    else{state.settings[key]=value;state.settings[key+'Sides']={};}
  }else state.settings[key]=value;
  if(key==='shape'&&value!=='shape'&&state.tool==='depth-region')setTool('select');
  state.selection=-1;state.selectedKeys=[];state.selectedParts=[];updateControls();if(commit)commitHistory();requestGeometry(false,!commit);
}

function updateControls() {
  const factor=state.dimensionUnit==='cm'?10:1;
  $('width').min=80/factor;$('width').max=20000/factor;
  $('depthRange').max=Math.max(500,Math.ceil(state.settings.depth/100)*100);
  $$('[data-setting]').forEach(el=>{if(document.activeElement!==el)el.value=el.id==='width'?(state.settings.width/factor).toFixed(2):Number(Number(state.settings[el.dataset.setting]).toFixed(3));});
  $$('[data-side-setting]').forEach(el=>{
    const value=state.settings[el.dataset.sideSetting+'Sides']?.[el.dataset.side]??state.settings[el.dataset.sideSetting];
    if(el.type==='range'&&el.dataset.sideSetting==='depth')el.max=Math.max(500,Math.ceil(value/100)*100);
    if(document.activeElement!==el)el.value=value;
  });
  $$('[data-side-toggle]').forEach(button=>button.classList.toggle('has-overrides',Object.keys(state.settings[button.dataset.sideToggle+'Sides']||{}).length>0));
  $$('[data-dimension-unit]').forEach(button=>{
    const active=button.dataset.dimensionUnit===state.dimensionUnit;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);
  });
  $$('[data-dimension-suffix]').forEach(el=>el.textContent=state.dimensionUnit);
  $('height').textContent=state.drawing?number(state.drawing.height/factor,2):'—';
  $('widthRange').setAttribute('aria-valuetext',`${number(state.settings.width/factor,2)} ${state.dimensionUnit}`);
  for(const kind of ['shape','mode']) $$(`[data-${kind}]`).forEach(button=>{
    const active=button.dataset[kind]===state.settings[kind];button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);
    if(kind==='mode')button.disabled=state.analyzing;
  });
  $('depthRow').hidden=state.settings.shape==='rectangle';$('depthHelp').hidden=state.settings.shape==='rectangle';
  $('depthHelp').textContent=state.settings.shape==='shape'?'Der Hauptregler setzt alle Seiten. Über den Pfeil kannst du sie einzeln anpassen. Der Neonabstand bleibt erhalten.':'Bei „Nur unten“ wirkt der Wert für Unten. Die übrigen Seitenwerte bleiben für Cut to Shape gespeichert.';
  $('modeHelp').textContent=(state.settings.mode==='single'?'Eine Mittellinie je Neonzug.':'Innen- und Außenlinien als Neonpfade.')+' Gilt für Elemente ohne eigene Zuweisung.';
  if(state.project?.sourceKind==='vector')$('modeHelp').textContent=state.project.vectorHasFills?'Double Line erhält die Originalkonturen. Single Line berechnet daraus Mittellinien; bitte mit dem Original vergleichen.':'Original-Vektorlinien bleiben erhalten. Für Schriftumrisse: Schrift samt Innenräumen markieren und „Auswahl: Single“ wählen. Danach mit dem Original vergleichen.';
  $('zoom').value=String(state.zoom);renderDepthRegionControls();
}
function renderProject() {
  const p=state.project;const loaded=Boolean(p);$('emptyState').hidden=loaded;$('drawing').hidden=!loaded;
  $('filename').textContent=p?.name||'Kein Motiv';$('sourceName').textContent=p?.name||'Noch kein Bild';
  $('filetype').textContent=p?(p.name.split('.').pop()||'PNG').toUpperCase().slice(0,5):'PNG';
  $('sourceDescription').textContent=p?.sourceLabel||'Lade ein Bild hoch oder öffne das B-KITE-Beispiel.';
  $('sourceSize').textContent=p?(p.sourceKind==='vector'?`${number(p.nativeWidthMm/10,2)} × ${number(p.nativeHeightMm/10,2)} cm · Originalmotiv`:`${p.pixelWidth} × ${p.pixelHeight} px · lokal verarbeitet`):'PNG · JPG · WebP · SVG · PDF';
  if(p)$('sourceThumbnail').src=p.image;
  $('recoveryTool').disabled=!p?.canRecover;
  $('cropTool').disabled=!loaded||p.sourceKind==='vector';$('cropImage').disabled=!loaded||p.sourceKind==='vector';updateHistoryButtons();
}

function renderDrawing() {
  const d=state.drawing;if(!d)return;
  const p=state.prefs;document.documentElement.style.setProperty('--canvas',p.background);
  const light=p.background===presets.light.background;
  const edge=light?'#505d65':'#e1e7eb';const dim=light?'#53616a':'#bac5cc';
  const [x,y,w,h]=d.imageBox;
  const stroke=p.glow?Math.max(1,state.settings.tube):1.45;
  const paths=d.pathData.map((path,index)=>{
    const color=p.logoColors?((p.glow&&d.pathColors?.[index]?.swatch)||d.pathColors?.[index]?.color||p.neon):p.neon;
    // Contrast halo is display-only: black white-neon ink stays visible on anthracite.
    const effect=p.glow?`drop-shadow(0 0 3px ${d.pathColors?.[index]?.swatch||color})`:color==='#000000'&&!light?'drop-shadow(0 0 1px #ffffff)':'none';
    return `<path class="neon-path ${state.selectedKeys.includes(d.pathKeys[index])?'selected-path':''}" data-path="${index}" d="${path}" stroke="${color}" style="filter:${effect}" stroke-width="${stroke}" ${p.glow?'':'vector-effect="non-scaling-stroke"'}/>`;
  }).join('');
  const selections=state.tool==='move'?'':d.parts.filter(part=>state.selectedParts.includes(part.id)).map(part=>{const [a,b,c,e]=part.bounds;return `<rect x="${a}" y="${b}" width="${c-a}" height="${e-b}" class="part-bounds"/>`;}).join('');
  const [bx,by]=d.bounds;const W=d.width,H=d.height;
  const label=Math.max(W,H)/46;const offset=label*1.6;const tick=label*.22;
  const x0=bx,x1=bx+W,y0=by,y1=by+H;
  const dimensions=state.dimensions?`<g stroke="${dim}" stroke-width=".9" fill="none" vector-effect="non-scaling-stroke">
    <path d="M ${x0} ${y0-offset} H ${x1} M ${x0} ${y0-offset-tick} V ${y0-offset+tick} M ${x1} ${y0-offset-tick} V ${y0-offset+tick} M ${x0-offset} ${y0} V ${y1} M ${x0-offset-tick} ${y0} H ${x0-offset+tick} M ${x0-offset-tick} ${y1} H ${x0-offset+tick}"/>
    <text class="dimension-text" style="fill:${dim}" x="${(x0+x1)/2}" y="${y0-offset-label*.45}" font-size="${label}" text-anchor="middle" stroke="none">${number(W/(state.dimensionUnit==='cm'?10:1),2)} ${state.dimensionUnit}</text>
    <text class="dimension-text" style="fill:${dim}" transform="translate(${x0-offset-label*.55} ${(y0+y1)/2}) rotate(-90)" font-size="${label}" text-anchor="middle" stroke="none">${number(H/(state.dimensionUnit==='cm'?10:1),2)} ${state.dimensionUnit}</text></g>`:'';
  $('drawing').innerHTML=`<path d="${state.outlineDraft?.kind==='point'&&state.outlineDraft.drawing?state.outlineDraft.drawing.outerData:d.outerData}" fill="${p.acrylic}" fill-opacity="${p.opacity/100}" stroke="${edge}" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    ${state.view==='original'?`<image href="${state.project.image}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>`:`<g fill="none" stroke-linejoin="round" stroke-linecap="round">${paths}</g>`}${recoveryImageLayer()}${uvLayer()}${selections}${dimensions}${straightenOverlay()}${outlineStraightenOverlay()}${depthRegionOverlay()}<g id="uvLiveOverlay" pointer-events="none"></g>`;
  renderMoveBounds();updateViewBox();
  renderVisibilityControls();renderUvControls();renderUvOverlay();renderRecoveryOverlay();
  $('selectionLabel').textContent=state.tool==='move'&&state.selectedKeys.length?'Ziehen · Pfeile: 1 mm · Shift + Pfeile: 10 mm':state.selectedKeys.length>1?`${state.selectedKeys.length} Pfade ausgewählt`:state.selection>=0?d.names[state.selection]:'';
}
function updateViewBox() {
  const d=state.drawing;if(!d)return;
  const margin=Math.max(d.width,d.height)*.105;
  const w=(d.width+2*margin)/(state.zoom/100),h=(d.height+2*margin)/(state.zoom/100);
  const cx=d.bounds[0]+d.width/2+state.pan.x,cy=d.bounds[1]+d.height/2+state.pan.y;
  $('drawing').setAttribute('viewBox',`${cx-w/2} ${cy-h/2} ${w} ${h}`);
  renderOutlinePoints();
}
function renderDetails() {
  const d=state.drawing;
  $('height').textContent=number(d.height/(state.dimensionUnit==='cm'?10:1),2);$('neonLength').textContent=number(d.neonMaterialMeters,2);
  updatePrice();
  $('lengthCalculation').textContent=`(${number(d.neonMeters,2)} m +10 %)`;
  $('pathCount').textContent=d.paths.length;$('checkPaths').textContent=d.paths.length;$('checkOpen').textContent=d.openPaths;
  $('canvasMeta').replaceChildren();
  for (const [index,text] of [state.project.sourceKind==='master'?'B-KITE · Vektorvorlage':state.project.sourceKind==='vector'?'Original-Vektorpfade':'Automatischer Entwurf',`${d.paths.length} Neonpfade`,d.modeLabel].entries()){
    if(index){const dot=document.createElement('i');dot.className='meta-dot';$('canvasMeta').append(dot);}
    const span=document.createElement('span');span.textContent=text;$('canvasMeta').append(span);
  }
  $('geometryNotice').hidden=!d.notices.length;$('geometryNotice').textContent=d.notices.join(' ');
  $('traceWarning').hidden=!state.project.traceNote;$('traceWarning').textContent=state.project.traceNote;
  $('checkList').replaceChildren();
  const checks=[...d.checks];if(state.project.sourceKind==='trace')checks.push({ok:false,label:'Automatischer Entwurf: Kurven visuell prüfen'});
  checks.forEach(check=>{const row=document.createElement('div');row.className='check-item'+(check.ok?'':' warning');const glyph=document.createElement('span');glyph.dataset.icon=check.ok?'check':'info';glyph.innerHTML=icon(glyph.dataset.icon);const text=document.createElement('span');text.textContent=check.label;row.append(glyph,text);$('checkList').append(row);});
  renderParts();
  renderPathList();
  renderStraightenControls();
}
let manufacturingTicket=0, manufacturingReport=null;
function invalidateManufacturing(){
  manufacturingTicket++;manufacturingReport=null;
  if($('manufacturingResult'))$('manufacturingResult').textContent='Nach Änderungen erneut prüfen.';
  if($('manufacturingApply'))$('manufacturingApply').hidden=true;
  if($('manufacturingCheck'))$('manufacturingCheck').disabled=false;
}
function manufacturingKey(){return JSON.stringify([state.project?.id,state.settings]);}
async function checkManufacturing(){
  if(!state.project||!state.valid||state.busy)return toast('Bitte zuerst eine Zeichnung laden und die Berechnung abwarten.');
  invalidateManufacturing();const ticket=manufacturingTicket,key=manufacturingKey();
  const profile={bendRadius:Number($('manufacturingRadius').value),spacing:Number($('manufacturingSpacing').value),cutLength:Number($('manufacturingCut').value)};
  $('manufacturingCheck').disabled=true;$('manufacturingResult').textContent='Kurven, Abstände und Stücklängen werden geprüft …';
  try{
    const report=await (await api('/api/manufacturing',{id:state.project.id,settings:state.settings,profile})).json();
    if(ticket!==manufacturingTicket||key!==manufacturingKey())return;
    manufacturingReport={...report,key};const target=$('manufacturingResult');target.replaceChildren();
    const rows=[`${number(report.rawMeters,3)} m gezeichnet · ${number(report.materialMeters,3)} m mit 10 % Zuschlag.`,
      Object.entries(report.modes).map(([mode,count])=>`${count} ${mode==='single'?'Single':'Double'}-Line-Pfade`).join(' · '),
      report.minimumRadius===null?'Keine größenbestimmenden Kurven gefunden.':`Engster Kurvenradius: ${number(report.minimumRadius,2)} mm.`,
      report.minimumSpacing===null?'Kein zu enger Abstand zwischen getrennten, nicht berührenden Pfaden gefunden.':`Engster Abstand: ${number(report.minimumSpacing,2)} mm Mitte–Mitte; benötigt ${number(report.requiredSpacing,1)} mm.`,
      ...(report.spacingWidth?[`Nur für die gemessenen Linienabstände wären bei unveränderter Zeichnung etwa ${number(report.spacingWidth/10,1)} cm Breite nötig. Kurven, Punkte und Anschlüsse sind damit noch nicht geprüft.`]:[]),
      ...(report.recommendedWidth?[`Größenorientierung für unveränderte Linien: ${number(report.recommendedWidth/10,1)} cm Breite.`]:['Mindestgröße noch offen: erst lokale Details und Anschlüsse korrigieren.']),...report.reasons,...report.warnings];
    for(const text of rows){const row=document.createElement('p');row.textContent=text;target.append(row);}
    $('manufacturingApply').hidden=!report.recommendedWidth||Math.abs(report.recommendedWidth-report.currentWidth)<.1;
    $('manufacturingApply').textContent=report.recommendedWidth?`${number(report.recommendedWidth/10,1)} cm als Vorschau übernehmen`:'Vorschaugröße übernehmen';
  }catch(error){if(ticket===manufacturingTicket)$('manufacturingResult').textContent=error.message;}
  finally{if(ticket===manufacturingTicket)$('manufacturingCheck').disabled=false;}
}
$('manufacturingCheck').onclick=checkManufacturing;
for(const id of ['manufacturingRadius','manufacturingSpacing','manufacturingCut'])$(id).oninput=invalidateManufacturing;
$('manufacturingApply').onclick=()=>{
  const report=manufacturingReport;
  if(!report?.recommendedWidth||report.key!==manufacturingKey()||state.busy)return;
  state.settings.width=report.recommendedWidth;state.settings.scale=null;
  updateControls();commitHistory();requestGeometry(true);
};
function uvLayer() {
  const d=state.drawing;if(state.view!=='vectors'||!d?.uv)return '';
  const [x,y,w,h]=d.imageBox;
  return `<defs><clipPath id="uvPrintClip"><path d="${d.uv.clipData}" clip-rule="evenodd"/></clipPath></defs><image href="${state.project.image}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none" clip-path="url(#uvPrintClip)" pointer-events="none"/>`;
}
function renderUvControls() {
  const active=state.tool.startsWith('uv-');
  $('uvCanvasButton').hidden=state.view!=='original'||!state.project||!!recoverySession;
  $('uvCanvasButton').disabled=state.busy;
  $('uvCanvasButton').textContent=active?'UV malen':'UV-Druck markieren';
  $('uvCanvasErase').hidden=!active||state.view!=='original';$('uvCanvasErase').disabled=state.busy;
  for(const [id,tool] of [['uvCanvasButton','uv-brush'],['uvCanvasErase','uv-erase']]){
    $(id).classList.toggle('active',state.tool===tool);$(id).setAttribute('aria-pressed',state.tool===tool);
  }
  document.querySelectorAll('[data-uv-mode]').forEach(button=>{const selected=button.dataset.uvMode===(state.settings.uvMode||'original');button.classList.toggle('active',selected);button.setAttribute('aria-pressed',selected);button.disabled=!state.project||state.busy;});
  $('uvModeHelp').textContent=state.settings.uvMode==='forms'?'Nur erkannte Motivflächen werden gedruckt. Hintergrund und Buchstabeninnenräume bleiben transparent.':'Übernimmt den übermalten Originalausschnitt einschließlich Hintergrund.';
  $('uvTools').hidden=!active;
  for(const [id,tool] of [['uvBrushTool','uv-brush'],['uvEraseTool','uv-erase']]){
    $(id).disabled=!state.project||state.busy;$(id).classList.toggle('active',state.tool===tool);$(id).setAttribute('aria-pressed',state.tool===tool);
  }
  $('uvClear').hidden=!state.settings.uvStrokes?.length;$('uvClear').disabled=state.busy;
  $('uvStatus').textContent=state.drawing?.uv?'UV-Druck aktiv · Originalfarben · ohne Neonmeter':state.settings.uvStrokes?.length?'Keine sichtbare Druckfläche in der Markierung.':'Noch kein UV-Druck markiert.';
  $('lengthDetail').textContent=state.drawing?.uv?'ohne Acrylkontur, Kabel und UV-Druck':'ohne Acrylkontur und Kabel';
}
function renderUvOverlay() {
  const layer=$('uvLiveOverlay'),d=state.drawing;if(!layer||!d)return;
  if(state.view!=='original'){layer.innerHTML='';return;}
  const scale=d.settings.scale,[x,y,w,h]=d.imageBox;
  const strokes=[...(state.settings.uvStrokes||[]),...(uvDraft?[uvDraft]:[])];
  const shapes=strokes.map(s=>{
    const color=s.op==='erase'?'black':'white',points=s.points.map(p=>p.map(v=>v*scale));
    return points.length===1?`<circle cx="${points[0][0]}" cy="${points[0][1]}" r="${s.radius*scale}" fill="${color}"/>`:
      `<path d="M ${points.map(p=>p.join(' ')).join(' L ')}" fill="none" stroke="${color}" stroke-width="${2*s.radius*scale}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  layer.innerHTML=`<defs><mask id="uvBrushMask" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="black"/>${shapes}</mask></defs><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#24d4ad" opacity=".36" mask="url(#uvBrushMask)"/>`;
}
function startUv(tool) {
  if(!state.project||state.busy)return;
  state.view='original';state.selectedKeys=[];state.selectedParts=[];state.selection=-1;closePathColor();
  setTab('motif');updateViewControls();setTool(tool);
}

function curveSegments() {
  const result=[];
  state.drawing?.paths.forEach((path,index)=>{
    let previous=null;
    path.forEach((command,segment)=>{
      if(command[0]==='c'&&previous)result.push({index,segment,start:previous,end:command.at(-1),d:`M ${previous.join(' ')} C ${command.slice(1).flat().join(' ')}`});
      if(command[0]!=='h')previous=command.at(-1);
    });
  });
  return result;
}
function straightenOverlay() {
  if(state.tool!=='straighten'||state.busy)return '';
  const curves=curveSegments();
  const selected=curves.find(c=>c.index===state.straightenSelection?.index&&c.segment===state.straightenSelection?.segment);
  return `<g fill="none">${curves.map(c=>`<path class="curve-hit" data-curve="${c.index}:${c.segment}" d="${c.d}" vector-effect="non-scaling-stroke"/>`).join('')}${selected?`<path class="curve-before" d="${selected.d}" vector-effect="non-scaling-stroke"/><path class="straighten-preview" d="M ${selected.start.join(' ')} L ${selected.end.join(' ')}" vector-effect="non-scaling-stroke"/>`:''}</g>`;
}
function renderStraightenControls() {
  renderOutlineStraightenControls();renderDepthRegionControls();renderOutlinePointControls();
  $('straightenTool').disabled=!state.project||state.busy;
  $('straightenOptions').hidden=state.tool!=='straighten';
  $('applyStraighten').disabled=!state.straightenSelection||state.busy;
  const selected=state.straightenSelection;
  $('straightenHint').textContent=selected?`${state.drawing.names[selected.index]} · Abschnitt ${selected.segment}. Gelb: Vorschau der Geraden; Violett: bisherige Kurve. PDF erst nach Übernahme.`:'Klicke eine Kurve im Motiv an. Gelb zeigt die Gerade zwischen ihren Endpunkten.';
}
function applyStraighten() {
  const selected=state.straightenSelection;
  if(!selected||state.busy||!state.valid)return;
  const key=state.drawing.pathKeys[selected.index];
  const edits=state.settings.straightened||{};
  state.settings.straightened={...edits,[key]:[...new Set([...(edits[key]||[]),selected.segment])]};
  state.straightenSelection=null;commitHistory();requestGeometry(true);
}
function clearOutlineDraft() {
  clearTimeout(depthPreviewTimer);depthPreviewTimer=null;
  state.outlineTicket++;state.outlineDraft=null;state.outlineBusy=false;state.outlineError='';
}
function outlineAnchors(path) {
  const points=[];
  for(const command of path){
    if(command[0]==='h')continue;
    const p=command.at(-1);
    if(!points.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<.001))points.push(p);
  }
  return points;
}
function outlinePointTarget(anchor,start,pointer,shift) {
  let dx=pointer.x-start.x,dy=pointer.y-start.y;
  if(shift){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}
  return [anchor[0]+dx,anchor[1]+dy];
}
function previewOutlineMove(path,point,target,radius,visible=false) {
  // Mirror the editor's anchor/handle movement locally, before the exact
  // clearance check returns. This cage is a preview, never export geometry.
  const pieces=[];let first,last;
  for(const command of path){
    if(command[0]==='m'){first=last=command[1];continue;}
    if(command[0]==='h'){
      if(Math.hypot(last[0]-first[0],last[1]-first[1])>.001)pieces.push(['l',last,first]);
      continue;
    }
    pieces.push([command[0],last,...command.slice(1)]);last=command.at(-1);
  }
  if(!pieces.length)return path;
  let index=0;
  for(let i=1;i<pieces.length;i++)if(Math.hypot(pieces[i][1][0]-point[0],pieces[i][1][1]-point[1])<Math.hypot(pieces[index][1][0]-point[0],pieces[index][1][1]-point[1]))index=i;
  const incoming=pieces[(index-1+pieces.length)%pieces.length],outgoing=pieces[index],anchor=outgoing[1];
  const left=anchor.map((v,k)=>v-incoming[1][k]),right=outgoing.at(-1).map((v,k)=>v-anchor[k]);
  const ll=Math.hypot(...left),rl=Math.hypot(...right),t=left.map(v=>v/(ll||1)),delta=target.map((v,k)=>v-point[k]);
  const along=delta[0]*t[0]+delta[1]*t[1],normal=Math.hypot(...delta.map((v,k)=>v-t[k]*along));
  if(incoming[0]==='l'&&outgoing[0]==='l'&&ll>.01&&rl>.01&&(t[0]*right[0]+t[1]*right[1])/rl>.999999&&normal>1e-6){
    const reach=Math.max(4*radius,2*normal,.1),a=anchor.map((v,k)=>v-t[k]*Math.min(reach,ll)),b=anchor.map((v,k)=>v+t[k]*Math.min(reach,rl));
    const destination=anchor.map((v,k)=>v+delta[k]),la=Math.min(reach,ll)+along,lb=Math.min(reach,rl)-along;
    const start=(index-1+pieces.length)%pieces.length,rest=[...pieces.slice(start),...pieces.slice(0,start)].slice(2),bend=[];
    if(Math.hypot(...a.map((v,k)=>v-incoming[1][k]))>1e-8)bend.push(['l',incoming[1],a]);
    bend.push(['c',a,a.map((v,k)=>v+t[k]*la/3),destination.map((v,k)=>v-t[k]*la/3),destination],
      ['c',destination,destination.map((v,k)=>v+t[k]*lb/3),b.map((v,k)=>v-t[k]*lb/3),b]);
    if(Math.hypot(...b.map((v,k)=>v-outgoing.at(-1)[k]))>1e-8)bend.push(['l',b,outgoing.at(-1)]);
    const result=[...bend,...rest];
    return [['m',result[0][1]],...result.map(segment=>[segment[0],...segment.slice(2)]),['h']];
  }
  const count=pieces.length;
  if(visible)for(const j of [(index-1+count)%count,index]){
    const segment=pieces[j];
    if(segment[0]==='l'){
      const a=segment[1],b=segment[2],v=b.map((x,k)=>(x-a[k])/3);
      pieces[j]=['c',a,a.map((x,k)=>x+v[k]),b.map((x,k)=>x-v[k]),b];
    }
  }
  const moved=pieces.map((segment,i)=>segment.map((value,j)=>{
    if(!j)return value;
    const start=i===index&&(j===1||(segment[0]==='c'&&j===2));
    const end=(i+1)%count===index&&(j===segment.length-1||(segment[0]==='c'&&j===segment.length-2));
    return value.map((v,k)=>v+((start||end)?delta[k]:0));
  }));
  return [['m',moved[0][1]],...moved.map(segment=>[segment[0],...segment.slice(2)]),['h']];
}
function outlinePreviewData(path) {
  return path.map(c=>c[0]==='h'?'Z':c[0].toUpperCase()+' '+c.slice(1).map(p=>p.join(' ')).join(' ')).join(' ');
}
function nearestOutlinePoint(path,point) {
  let start,last,best=null,distance=Infinity;
  const edge=(a,b)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;
    const t=den?Math.max(0,Math.min(1,((point.x-a[0])*dx+(point.y-a[1])*dy)/den)):0;
    const q=[a[0]+t*dx,a[1]+t*dy],d=Math.hypot(q[0]-point.x,q[1]-point.y);
    if(d<distance){distance=d;best=q;}
  };
  for(const c of path){
    if(c[0]==='m'){start=last=c[1];continue;}
    if(c[0]==='h'){edge(last,start);last=start;continue;}
    if(c[0]==='l')edge(last,c[1]);
    if(c[0]==='c'){
      let previous=last;
      for(let i=1;i<=128;i++){
        const t=i/128,u=1-t,q=[0,1].map(k=>u*u*u*last[k]+3*u*u*t*c[1][k]+3*u*t*t*c[2][k]+t*t*t*c[3][k]);
        edge(previous,q);previous=q;
      }
    }
    last=c.at(-1);
  }
  return best;
}
function changeOutlineAnchor(action,point) {
  if(state.busy||state.outlineBusy||!state.valid||!point)return;
  clearOutlineDraft();state.outlineAdding=false;
  state.outlineDraft={kind:'point',action,point:[...point],target:[...point],dragging:false,revision:1,checked:-1,inFlight:false,moved:true};
  checkOutlinePoint();renderOutlinePointControls();exportState();
}
function selectOutlinePoints(current,incoming,additive=false,toggle=false) {
  const result=additive?[...current]:[];
  for(const point of incoming){
    const index=result.findIndex(p=>Math.hypot(p[0]-point[0],p[1]-point[1])<.01);
    if(index<0)result.push([...point]);else if(toggle)result.splice(index,1);
  }
  return result;
}
function outlinePointsInRect(path,rect) {
  return outlineAnchors(path).filter(([x,y])=>x>=rect[0]&&x<=rect[2]&&y>=rect[1]&&y<=rect[3]);
}
function deleteOutlineSelection() {
  const points=state.outlineSelection||[];
  if(!points.length||state.busy||state.outlineBusy||!state.valid)return;
  clearOutlineDraft();state.outlineAdding=false;
  state.outlineDraft={kind:'point',action:'delete',points:points.map(p=>[...p]),point:[...points[0]],target:[...points[0]],dragging:false,revision:1,checked:-1,inFlight:false,moved:true};
  checkOutlinePoint();renderOutlinePointControls();exportState();
}
function renderOutlinePointControls() {
  const active=['outline-points','outline-straighten'].includes(state.tool),count=state.outlineSelection?.length||0;
  $('outlinePointTool').classList.toggle('active',active);$('outlinePointTool').setAttribute('aria-pressed',active);
  $('outlinePointTool').disabled=!state.project||state.busy||!state.valid;
  $('outlinePointOptions').hidden=!active;
  $('outlinePointTool').setAttribute('aria-expanded',active);
  $('addOutlinePoint').classList.toggle('active',Boolean(state.outlineAdding));
  $('addOutlinePoint').setAttribute('aria-pressed',Boolean(state.outlineAdding));
  $('addOutlinePoint').disabled=state.busy||state.outlineBusy;
  $('deleteOutlinePoint').disabled=state.busy||state.outlineBusy||!count;
  const deleteLabel=count>1?`${count} Punkte löschen`:'Punkt löschen';
  $('deleteOutlinePoint').title=deleteLabel;$('deleteOutlinePoint').setAttribute('aria-label',deleteLabel);
  $('outlinePointHint').hidden=state.tool==='outline-straighten'||!(state.outlineError||state.outlineBusy||state.outlineAdding);
  $('outlinePointHint').textContent=state.outlineError||
    (active&&state.outlineBusy?(state.outlineDraft?.previewControls?'Live-Vorschau in Gold · Randabstand wird geprüft …':'Kontur und Randabstand werden geprüft …'):
    state.outlineAdding?'Auf die Acrylkante klicken, um einen Punkt hinzuzufügen.':'');
}
function renderOutlinePoints() {
  $('outlinePointOverlay')?.remove();
  if(state.tool!=='outline-points'||!state.drawing||state.busy)return;
  const svg=$('drawing'),matrix=svg.getScreenCTM();if(!matrix)return;
  const unit=1/Math.hypot(matrix.a,matrix.b),draft=state.outlineDraft;
  const drawing=draft?.drawing||state.drawing;
  const preview=draft?.previewControls&&draft.checked!==draft.revision?draft.previewControls:null;
  const controls=preview||drawing.outlineVisibleControls||drawing.outlineControls||drawing.outer;
  const points=outlineAnchors(controls);
  const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.id='outlinePointOverlay';
  g.innerHTML=(preview?`<path class="outline-live-preview" d="${outlinePreviewData(preview)}" vector-effect="non-scaling-stroke"/>`:'')+
    `<path class="outline-point-hit" d="${drawing.outerData}" fill="none" stroke="transparent" stroke-width="16" vector-effect="non-scaling-stroke"/>`+points.map((p,i)=>`<circle class="outline-point ${state.outlineSelection?.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<.01)?'selected':''}" data-outline-point="${i}" cx="${p[0]}" cy="${p[1]}" r="${3.5*unit}" vector-effect="non-scaling-stroke"><title>Konturpunkt ${i+1} ziehen · Shift: Achse sperren</title></circle>`).join('')+
    (draft?.kind==='point'&&draft.action!=='delete'?`<g pointer-events="none"><path class="outline-point-guide" d="M ${draft.point.join(' ')} L ${draft.target.join(' ')}" vector-effect="non-scaling-stroke"/><circle class="outline-point-target" cx="${draft.target[0]}" cy="${draft.target[1]}" r="${5*unit}" vector-effect="non-scaling-stroke"/></g>`:'');
  svg.append(g);
}
function startOutlinePoint(event) {
  if(state.busy||state.outlineBusy||!state.valid||event.target.dataset.outlinePoint===undefined)return;
  clearOutlineDraft();
  const pointer=svgPoint(event),anchors=outlineAnchors(state.drawing.outlineVisibleControls||state.drawing.outlineControls||state.drawing.outer);
  // At low zoom the hit circles overlap. Pick the closest anchor, not the last SVG child.
  const point=anchors.reduce((best,p)=>!best||Math.hypot(p[0]-pointer.x,p[1]-pointer.y)<Math.hypot(best[0]-pointer.x,best[1]-pointer.y)?p:best,null);if(!point)return;
  state.outlineSelected=[...point];state.outlineSelection=selectOutlinePoints(state.outlineSelection||[],[point],event.shiftKey,true);state.outlineAdding=false;renderOutlinePointControls();
  const matrix=$('drawing').getScreenCTM().inverse();
  state.outlineDraft={kind:'point',point:[...point],target:[...point],start:new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix),matrix,
    dragging:true,client:[event.clientX,event.clientY],revision:0,checked:-1,inFlight:false,drawing:null,moved:false};
  $('drawing').setPointerCapture(event.pointerId);event.preventDefault();exportState();renderOutlinePoints();
}
function moveOutlinePoint(event) {
  const draft=state.outlineDraft;if(draft?.kind!=='point'||!draft.dragging)return;
  if(!draft.moved&&draft.client&&Math.hypot(event.clientX-draft.client[0],event.clientY-draft.client[1])<3)return;
  state.outlineSelection=[[...draft.point]];
  const pointer=new DOMPoint(event.clientX,event.clientY).matrixTransform(draft.matrix);
  const target=outlinePointTarget(draft.point,draft.start,pointer,event.shiftKey);
  if(Math.hypot(target[0]-draft.target[0],target[1]-draft.target[1])<.001)return;
  draft.target=target;draft.revision++;draft.moved=true;state.outlineError='';
  draft.previewControls=previewOutlineMove(state.drawing.outlineVisibleControls||state.drawing.outlineControls||state.drawing.outer,draft.point,target,state.settings.radius,true);
  state.outlineBusy=true;renderOutlinePoints();renderOutlinePointControls();exportState();
  // Throttle instead of debounce: continuous movement must not starve checking.
  if(!draft.inFlight&&!depthPreviewTimer)depthPreviewTimer=setTimeout(()=>{depthPreviewTimer=null;checkOutlinePoint();},80);
}
async function checkOutlinePoint() {
  const draft=state.outlineDraft;if(draft?.kind!=='point'||draft.inFlight||!draft.moved)return;
  const ticket=state.outlineTicket,project=state.project,revision=draft.revision,scale=state.drawing.settings.scale;
  const edit={kind:'anchor',visibleContour:true,action:draft.action||'move',point:draft.point.map(v=>v/scale),target:draft.target.map(v=>v/scale)};
  if(edit.action==='move'){edit.fixedNeighbors=true;edit.autoHandles=true;}
  if(draft.points){edit.points=draft.points.map(p=>p.map(v=>v/scale));delete edit.target;}
  draft.inFlight=true;state.outlineBusy=true;
  try {
    if((state.settings.outlineEdits?.length||0)>=50)throw new Error('Höchstens 50 Konturkorrekturen sind möglich.');
    const drawing=await (await api('/api/geometry',{id:project.id,settings:{...state.settings,outlinePreview:edit}})).json();
    if(ticket!==state.outlineTicket||project!==state.project)return;
    if(!drawing.exportable)throw new Error('Diese Kontur ist nicht gültig. Die Änderung wurde nicht übernommen.');
    draft.edits=[edit];
    if(revision===draft.revision){draft.drawing=drawing;draft.edit=edit;draft.checked=revision;state.outlineError='';}
  }catch(error){
    if(ticket!==state.outlineTicket||project!==state.project)return;
    if(revision===draft.revision){draft.drawing=null;draft.checked=revision;state.outlineError=error.message;}
  }finally{
    if(ticket===state.outlineTicket&&project===state.project){
      draft.inFlight=false;
      if(revision!==draft.revision){checkOutlinePoint();}
      else{
        state.outlineBusy=false;
        if(!draft.dragging)finishOutlinePoint();
        else{renderDrawing();renderOutlinePointControls();exportState();}
      }
    }
  }
}
function outlineConstraintMessage(reason) {
  if(reason==='clearance')return 'Bewegung am eingestellten Randabstand begrenzt.';
  if(reason==='radius')return 'Bewegung begrenzt: Zwischen den festen Nachbarpunkten passt der Eckenradius nicht weiter.';
  return 'Bewegung begrenzt, damit sich die Acrylkontur nicht überschneidet.';
}
function finishOutlinePoint() {
  const draft=state.outlineDraft;if(draft?.kind!=='point'||draft.dragging)return;
  if(!draft.moved){clearOutlineDraft();renderDrawing();renderOutlinePointControls();exportState();return;}
  if(draft.inFlight)return;
  if(draft.checked!==draft.revision){checkOutlinePoint();return;}
  if(!draft.drawing){
    const error=state.outlineError;clearOutlineDraft();state.outlineError=error;
    renderDrawing();renderOutlinePointControls();exportState();toast(error,true);return;
  }
  commitHistory();
  state.settings.outlineEdits=[...(state.settings.outlineEdits||[]),...(draft.edits||[draft.edit])];
  const drawing=draft.drawing,constrained=drawing.outlinePreview?.constrained,old=state.drawing;
  state.pan.x+=old.bounds[0]+old.width/2-drawing.bounds[0]-drawing.width/2;
  state.pan.y+=old.bounds[1]+old.height/2-drawing.bounds[1]-drawing.height/2;
  state.settings.scale=drawing.settings.scale;state.settings.width=drawing.width;
  state.outlineSelected=drawing.outlinePreview?.point||null;state.outlineSelection=state.outlineSelected?[[...state.outlineSelected]]:[];
  state.drawing=drawing;state.valid=drawing.exportable;clearOutlineDraft();commitHistory();
  renderDrawing();renderDetails();updateControls();exportState();
  if(constrained)toast(outlineConstraintMessage(drawing.outlinePreview?.constraint));
}

function renderOutlineStraightenControls() {
  $('outlineStraightenTool').disabled=!state.project||state.busy||!state.valid;
  $('outlineStraightenOptions').hidden=state.tool!=='outline-straighten';
  $('applyOutlineStraighten').disabled=!state.outlineDraft?.drawing||state.outlineBusy||state.busy;
  $('resetOutlineEdits').disabled=state.busy||!state.settings.outlineEdits?.length;
  $('outlineStraightenHint').textContent=state.outlineBusy?'Kontur und Neonabstand werden geprüft …':state.outlineError||
    (state.outlineDraft?.drawing?'Gelb: neue Kante. Violett: bisheriger Abschnitt. Der Neonabstand bleibt erhalten. Übernehmen oder ein neues Rechteck ziehen.':'Ziehe ein Rechteck über eine Einkerbung der Acrylkante, einschließlich ihrer beiden Anschlussstücke.');
}
function outlineStraightenOverlay() {
  const draft=state.outlineDraft;if(!draft||state.tool!=='outline-straighten')return '';
  const [x,y,x1,y1]=draft.rect,p=draft.drawing?.outlinePreview;
  return `<rect x="${x}" y="${y}" width="${x1-x}" height="${y1-y}" class="part-bounds region-box"/>${p?`<g fill="none" transform="translate(${p.offset.join(' ')})"><path class="curve-before" d="${p.before}" vector-effect="non-scaling-stroke"/><path class="straighten-preview" d="${p.after}" vector-effect="non-scaling-stroke"/></g>`:''}`;
}
async function previewOutlineStraighten(rect) {
  clearOutlineDraft();const ticket=state.outlineTicket,project=state.project;
  const edit=rect.map(v=>v/state.drawing.settings.scale);
  state.outlineDraft={rect,edit,drawing:null};state.outlineBusy=true;
  renderDrawing();renderOutlineStraightenControls();exportState();
  try {
    const response=await api('/api/geometry',{id:project.id,settings:{...state.settings,outlinePreview:edit}});
    const drawing=await response.json();
    if(ticket!==state.outlineTicket||project!==state.project)return;
    state.outlineDraft.drawing=drawing;
  }catch(error){if(ticket===state.outlineTicket)state.outlineError=error.message;}
  finally{if(ticket===state.outlineTicket){state.outlineBusy=false;renderDrawing();renderOutlineStraightenControls();exportState();}}
}
function applyOutlineStraighten() {
  if(!state.outlineDraft?.drawing||state.outlineBusy||state.busy)return;
  commitHistory();
  state.settings.outlineEdits=[...(state.settings.outlineEdits||[]),state.outlineDraft.edit];
  clearOutlineDraft();commitHistory();requestGeometry(true);
}
function renderDepthRegionControls() {
  const enabled=state.settings.shape==='shape';
  const editing=state.tool==='depth-region',draft=editing?state.outlineDraft:null;
  $('depthRegionTool').disabled=!enabled||!state.project||state.busy||!state.valid;
  $('depthRegionControls').hidden=!enabled&&!state.settings.depthRegions?.length;
  $('depthRegionOptions').hidden=!editing;
  $('depthRegionDormant').hidden=enabled||!state.settings.depthRegions?.length;
  $('applyDepthRegion').disabled=!draft?.drawing||state.outlineBusy||state.busy;
  $('depthRegionHint').textContent=state.outlineBusy&&editing?'Lokale Kontur und Neonabstand werden geprüft …':editing&&state.outlineError?state.outlineError:
    draft?.drawing?'Gelb: neue Kontur. Violett: bisherige Kontur. Die Übergänge bleiben innerhalb des Rechtecks.':
    'Ziehe ein Rechteck über den gewünschten Bereich einschließlich der Acrylkante. Für einzelne Seiten nur den oberen oder unteren Rand markieren.';
  const list=$('depthRegionList');list.replaceChildren();
  (state.settings.depthRegions||[]).forEach((region,index)=>{
    const row=document.createElement('div');row.className='depth-region-row';
    const edit=document.createElement('button');edit.className='text-button';edit.textContent=`Bereich ${index+1} · ${number(region.depth,0)} mm`;
    edit.disabled=!enabled||state.busy;edit.setAttribute('aria-label',`Bereich ${index+1} bearbeiten`);
    edit.onclick=()=>{state.view='vectors';updateViewControls();setTool('depth-region');setDepthRegionValue(region.depth);previewDepthRegion(region.rect.map(v=>v*state.drawing.settings.scale),index);};
    const remove=document.createElement('button');remove.className='text-button';remove.textContent='Entfernen';remove.disabled=state.busy;
    remove.setAttribute('aria-label',`Bereich ${index+1} entfernen`);
    remove.onclick=()=>{state.settings.depthRegions=state.settings.depthRegions.filter((_,i)=>i!==index);commitHistory();requestGeometry(true);};
    row.append(edit,remove);list.append(row);
  });
}
function setDepthRegionValue(value) {
  $('depthRegionRange').max=Math.max(500,Math.ceil(value/100)*100);
  $('depthRegionValue').value=value;$('depthRegionRange').value=value;
}
function depthRegionOverlay() {
  const draft=state.outlineDraft;if(state.tool!=='depth-region'||!draft)return '';
  const [x,y,x1,y1]=draft.rect;
  const rect=`x="${x}" y="${y}" width="${x1-x}" height="${y1-y}"`;
  return `<rect ${rect} class="part-bounds region-box"/><defs><clipPath id="depthRegionClip"><rect ${rect}/></clipPath></defs>${draft.drawing?`<g clip-path="url(#depthRegionClip)" fill="none" pointer-events="none"><path class="curve-before" d="${state.drawing.outerData}" vector-effect="non-scaling-stroke"/><path class="straighten-preview" d="${draft.drawing.outerData}" vector-effect="non-scaling-stroke"/></g>`:''}`;
}
async function previewDepthRegion(rect,index=-1,delay=0) {
  clearOutlineDraft();const ticket=state.outlineTicket,project=state.project;
  const value=Number($('depthRegionValue').value);
  const edit={rect:rect.map(v=>v/state.drawing.settings.scale),depth:value};
  state.outlineDraft={kind:'depth',rect,edit,index,drawing:null};state.outlineBusy=true;
  renderDrawing();renderDepthRegionControls();exportState();
  const work=async()=>{
    try {
      if(!$('depthRegionValue').value.trim()||!Number.isFinite(value)||value<0||value>20000)throw new Error('Bitte eine Tiefe zwischen 0 und 20.000 mm eingeben.');
      const regions=[...(state.settings.depthRegions||[])];if(index<0)regions.push(edit);else regions[index]=edit;
      const drawing=await (await api('/api/geometry',{id:project.id,settings:{...state.settings,depthRegions:regions}})).json();
      if(!drawing.activeDepthRegions.includes(index<0?regions.length-1:index))throw new Error('Bitte den Bereich einschließlich der Acrylkante markieren.');
      if(ticket===state.outlineTicket&&project===state.project)state.outlineDraft.drawing=drawing;
    }catch(error){if(ticket===state.outlineTicket)state.outlineError=error.message;}
    finally{if(ticket===state.outlineTicket){state.outlineBusy=false;renderDrawing();renderDepthRegionControls();exportState();}}
  };
  if(delay)depthPreviewTimer=setTimeout(work,delay);else await work();
}
function applyDepthRegion() {
  const draft=state.outlineDraft;if(draft?.kind!=='depth'||!draft.drawing||state.outlineBusy||state.busy)return;
  commitHistory();const regions=[...(state.settings.depthRegions||[])];
  if(draft.index<0)regions.push(draft.edit);else regions[draft.index]=draft.edit;
  state.settings.depthRegions=regions;clearOutlineDraft();commitHistory();setTool('select');requestGeometry(true);
}
function renderVisibilityControls() {
  const selected=state.selectedKeys.length>0&&!['outline-points','outline-straighten'].includes(state.tool);
  const label=state.selectedKeys.length>1?`${state.selectedKeys.length} Linien ausblenden`:'Linie ausblenden';
  $('hideSelected').setAttribute('aria-label',label);
  $('moveTool').disabled=!state.selectedKeys.length||state.view!=='vectors'||state.busy||state.analyzing;
  $('hideSelected').disabled=!selected||state.busy||state.analyzing||!!moveDraft;
  $('colorSelected').disabled=!selected||state.busy||state.analyzing||!!moveDraft;
  $('splitSelected').disabled=!selected||state.busy||state.analyzing||!!moveDraft;
  $('hiddenSummary').hidden=!state.drawing?.hiddenPaths?.length;
  $('hiddenSummary').textContent=`Ausgeblendet (${state.drawing?.hiddenPaths?.length||0})`;
  $$('#pathList button').forEach(button=>button.disabled=state.busy||state.analyzing);
}
async function splitSelectedPaths() {
  if(!state.project||!state.selectedKeys.length||state.busy||state.analyzing)return;
  const project=state.project,settings=JSON.stringify(state.settings),generation=state.generation,upload=state.uploadGeneration;
  const current=()=>state.project===project&&state.generation===generation&&state.uploadGeneration===upload&&JSON.stringify(state.settings)===settings;
  state.busy=true;closePathColor();renderVisibilityControls();exportState();setLive('Trenne …','busy');
  try{
    const result=await (await api('/api/split-paths',{id:project.id,keys:[...state.selectedKeys],settings:JSON.parse(settings)})).json();
    if(!current())return;
    state.busy=false;
    if(result.count){
      state.settings=result.drawing.settings;state.drawing=result.drawing;state.valid=result.drawing.exportable;
      state.selection=-1;state.selectedKeys=[];state.selectedParts=[];commitHistory();
      updateControls();renderDrawing();renderDetails();
      toast('Linien an Verbindungen getrennt. Teilstücke auswählen und einfärben; Shift ergänzt die Auswahl.');
    }else toast('Keine weiteren Kreuzungen oder Anschlüsse an der Auswahl gefunden.');
    renderVisibilityControls();exportState();setLive('Live');
  }catch(error){if(current()){state.busy=false;renderVisibilityControls();exportState();setLive('Live');toast(error.message,true);}}
}
function setPathHidden(key,hidden) {
  if(state.busy||state.analyzing)return;
  const keys=state.settings.hiddenPaths||[];
  state.settings.hiddenPaths=hidden?[...new Set([...keys,...(Array.isArray(key)?key:[key])])]:keys.filter(k=>!(Array.isArray(key)?key:[key]).includes(k));
  state.selection=-1;state.selectedParts=[];state.selectedKeys=[];closePathColor();state.straightenSelection=null;
  commitHistory();requestGeometry(true);
}
function renderPathList() {
  const d=state.drawing;
  const rows=d.pathKeys.map((key,index)=>({key,index,name:d.names[index],mode:d.pathModes[index],color:d.pathColors[index],hidden:false}));
  rows.push(...(d.hiddenPaths||[]).map(item=>({...item,hidden:true})));
  rows.sort((a,b)=>a.mode.localeCompare(b.mode)||Number(a.key.split(':')[1])-Number(b.key.split(':')[1]));
  $('pathCount').textContent=`${d.paths.length} / ${rows.length}`;$('pathList').replaceChildren();
  for(const item of rows){
    const row=document.createElement('div');row.className='path-row'+(item.hidden?' is-hidden':'');
    const label=document.createElement('button');label.className='path-label';label.textContent=item.name;
    label.classList.toggle('active',!item.hidden&&state.selectedKeys.includes(item.key));
    label.onclick=event=>item.hidden?setPathHidden(item.key,false):selectPath(item.index,event.shiftKey);
    label.title=item.hidden?'Pfad wieder einblenden':'Pfad in der Zeichnung auswählen';
    const detail=document.createElement('small');detail.textContent=(item.hidden?'ausgeblendet':d.paths[item.index].at(-1)[0]==='h'?'geschlossen':'offen')+' · '+item.color.name;label.append(detail);
    const swatch=document.createElement('button');swatch.className='path-color';swatch.style.setProperty('--swatch',item.color.swatch||item.color.color);
    swatch.setAttribute('aria-label',`${item.name}: Farbe ändern (${item.color.name})`);swatch.title=swatch.getAttribute('aria-label');swatch.onclick=()=>showPathColor(item.key,item.name,item.color);
    const eye=document.createElement('button');eye.className='path-visibility';eye.innerHTML=icon(item.hidden?'eyeOff':'eye');
    const action=`${item.name} (${item.mode==='single'?'Single':'Double'}) ${item.hidden?'einblenden':'ausblenden'}`;
    eye.setAttribute('aria-label',action);eye.title=action;eye.setAttribute('aria-pressed',String(!item.hidden));
    eye.onclick=()=>setPathHidden(item.key,!item.hidden);row.append(swatch,label,eye);$('pathList').append(row);
  }
  renderVisibilityControls();
}
function canMoveSelection() {
  return state.tool==='move'&&state.view==='vectors'&&state.project&&state.drawing&&state.valid&&!state.busy&&!state.analyzing&&state.selectedKeys.length>0;
}
function renderMoveBounds() {
  if(state.tool!=='move'||state.view!=='vectors')return;
  const boxes=$$('.selected-path').map(path=>path.getBBox());if(!boxes.length)return;
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
  const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');rect.id='moveSelection';rect.classList.add('part-bounds');
  for(const [key,value] of Object.entries({x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y}))rect.setAttribute(key,value);
  $('drawing').append(rect);
}
function beginMoveSelection() {
  if(moveDraft||!canMoveSelection())return false;
  closePathColor();
  moveDraft={keys:[...state.selectedKeys],dx:0,dy:0,pressed:new Set(),settings:JSON.stringify(state.settings),project:state.project,generation:state.generation,upload:state.uploadGeneration};
  renderVisibilityControls();exportState();return true;
}
function paintMoveSelection() {
  if(!moveDraft)return;
  const {dx,dy}=moveDraft,transform=`translate(${dx} ${dy})`;
  for(const path of $$('.selected-path'))path.setAttribute('transform',transform);
  $('moveSelection')?.setAttribute('transform',transform);
  $('selectionLabel').textContent=`Verschieben: ${number(dx,1)} / ${number(dy,1)} mm · Esc: Abbrechen`;
}
function startMoveSelection(event) {
  if(moveDraft||state.busy||state.analyzing)return;
  const index=Number(event.target.dataset.path),key=state.drawing.pathKeys[index];if(!key)return;
  const selected=state.selectedKeys.includes(key);
  if(!selected)selectPath(index,event.shiftKey);
  if(!beginMoveSelection())return;
  const matrix=$('drawing').getScreenCTM().inverse();
  Object.assign(moveDraft,{pointerId:event.pointerId,matrix,toggleOnClick:event.shiftKey&&selected?index:null,start:new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix)});
  $('drawing').setPointerCapture(event.pointerId);$('drawing').classList.add('moving');event.preventDefault();
}
function previewMovePointer(event) {
  if(!moveDraft||moveDraft.checking||moveDraft.pointerId!==event.pointerId)return;
  const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(moveDraft.matrix);
  let dx=point.x-moveDraft.start.x,dy=point.y-moveDraft.start.y;
  if(event.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}
  moveDraft.dx=dx;moveDraft.dy=dy;paintMoveSelection();
}
function moveKeyDown(event) {
  const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},delta=directions[event.key];
  if(!delta||!canMoveSelection()||moveDraft?.pointerId!==undefined||moveDraft?.checking)return false;
  if(!moveDraft&&!beginMoveSelection())return false;
  event.preventDefault();moveDraft.pressed.add(event.key);
  moveDraft.dx+=delta[0]*(event.shiftKey?10:1);moveDraft.dy+=delta[1]*(event.shiftKey?10:1);paintMoveSelection();return true;
}
function moveKeyUp(event) {
  if(!moveDraft?.pressed.has(event.key))return;
  event.preventDefault();moveDraft.pressed.delete(event.key);if(!moveDraft.pressed.size)finishMoveSelection();
}
function cancelMoveSelection() {
  if(!moveDraft)return;
  const draft=moveDraft;moveDraft=null;
  if(draft.pointerId!==undefined&&$('drawing').hasPointerCapture(draft.pointerId))$('drawing').releasePointerCapture(draft.pointerId);
  if(draft.checking)state.busy=false;
  $('drawing').classList.remove('moving');renderDrawing();exportState();setLive('Live');
}
function preserveMoveView(before,after) {
  const svg=$('drawing'),fit=d=>{const margin=Math.max(d.width,d.height)*.105;return Math.max((d.width+2*margin)/svg.clientWidth,(d.height+2*margin)/svg.clientHeight);};
  state.pan.x+=before.bounds[0]+before.width/2-after.bounds[0]-after.width/2;
  state.pan.y+=before.bounds[1]+before.height/2-after.bounds[1]-after.height/2;
  setZoom(state.zoom*fit(after)/fit(before));
}
async function finishMoveSelection() {
  const draft=moveDraft;if(!draft||draft.checking)return;
  if(draft.pointerId!==undefined&&$('drawing').hasPointerCapture(draft.pointerId))$('drawing').releasePointerCapture(draft.pointerId);
  if(Math.hypot(draft.dx,draft.dy)<1e-7){cancelMoveSelection();if(draft.toggleOnClick!=null)selectPath(draft.toggleOnClick,true);return;}
  const current=()=>moveDraft===draft&&state.project===draft.project&&state.generation===draft.generation&&state.uploadGeneration===draft.upload&&JSON.stringify(state.settings)===draft.settings;
  const settings=JSON.parse(draft.settings),scale=state.drawing.settings.scale;
  settings.pathOffsets={...settings.pathOffsets};
  for(const key of draft.keys){const old=settings.pathOffsets[key]||[0,0];settings.pathOffsets[key]=[old[0]+draft.dx/scale,old[1]+draft.dy/scale];}
  draft.checking=true;state.busy=true;renderVisibilityControls();exportState();setLive('Kontur wird angepasst …','busy');
  try{
    const drawing=await (await api('/api/geometry',{id:draft.project.id,settings})).json();
    if(!current())return;
    if(!drawing.exportable)throw new Error('Diese Verschiebung ergibt keine gültige Acrylkontur. Bitte die Position anpassen.');
    const before=state.drawing;moveDraft=null;state.busy=false;state.settings=drawing.settings;state.drawing=drawing;state.valid=true;
    preserveMoveView(before,drawing);commitHistory();updateControls();renderDrawing();renderDetails();exportState();setLive('Live');
  }catch(error){if(current()){cancelMoveSelection();toast(error.message,true);}}
  finally{if(moveDraft===draft&&!current())cancelMoveSelection();$('drawing').classList.remove('moving');}
}
function selectionKeys(current, incoming, additive=false, toggle=false) {
  if(!additive)return [...incoming];
  const keys=new Set(current);
  for(const key of incoming){if(toggle&&keys.has(key))keys.delete(key);else keys.add(key);}
  return [...keys];
}
function selectKeys(keys) {
  cancelMoveSelection();closePathColor();
  state.selectedKeys=keys.filter(key=>state.drawing.pathKeys.includes(key));
  state.selection=state.selectedKeys.length?state.drawing.pathKeys.indexOf(state.selectedKeys.at(-1)):-1;
  state.selectedParts=[...new Set(state.selectedKeys.map(key=>state.drawing.pathPartIds[state.drawing.pathKeys.indexOf(key)]))];
  renderDrawing();renderDetails();
}
function selectPath(index, additive=false) {
  if(state.busy)return;
  state.view='vectors';updateViewControls();
  selectKeys(selectionKeys(state.selectedKeys,[state.drawing.pathKeys[index]],additive,true));
}
// Curve selection uses the actual route, not the bounding box of its motif.
function pathInSelection(commands, rect, crossing) {
  const [left,top,right,bottom]=rect;
  const inside=p=>p[0]>=left&&p[0]<=right&&p[1]>=top&&p[1]<=bottom;
  function intersects(points,level=0){
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    if(Math.max(...xs)<left||Math.min(...xs)>right||Math.max(...ys)<top||Math.min(...ys)>bottom)return false;
    if(inside(points[0])||inside(points.at(-1)))return true;
    if(points.length===2){
      const [a,b]=points;let lo=0,hi=1;
      for(const [v,d,min,max] of [[a[0],b[0]-a[0],left,right],[a[1],b[1]-a[1],top,bottom]]){
        if(Math.abs(d)<1e-12){if(v<min||v>max)return false;continue;}
        const u=(min-v)/d,w=(max-v)/d;lo=Math.max(lo,Math.min(u,w));hi=Math.min(hi,Math.max(u,w));
      }
      return lo<=hi;
    }
    if(level>=20||Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))<.005)return true;
    const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
    const [a,b,c,d]=points,ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),m=mid(abc,bcd);
    return intersects([a,ab,abc,m],level+1)||intersects([m,bcd,cd,d],level+1);
  }
  function contained(points){
    if(!inside(points[0])||!inside(points.at(-1)))return false;
    if(points.length===2)return true;
    // Exact cubic extrema, including curves whose controls extend outside.
    const ts=[];
    for(let axis=0;axis<2;axis++){
      const [a,b,c,d]=points.map(p=>p[axis]),A=-a+3*b-3*c+d,B=2*(a-2*b+c),C=b-a;
      if(Math.abs(A)<1e-12){if(Math.abs(B)>1e-12)ts.push(-C/B);}
      else {const disc=B*B-4*A*C;if(disc>=0){ts.push((-B+Math.sqrt(disc))/(2*A),(-B-Math.sqrt(disc))/(2*A));}}
    }
    return ts.filter(t=>t>0&&t<1).every(t=>inside([0,1].map(i=>(1-t)**3*points[0][i]+3*(1-t)**2*t*points[1][i]+3*(1-t)*t*t*points[2][i]+t**3*points[3][i])));
  }
  let here,start,seen=false;
  for(const [op,...points] of commands){
    if(op==='m'){here=start=points[0];continue;}
    const segment=op==='h'?[here,start]:[here,...points];seen=true;
    if(crossing&&intersects(segment))return true;
    if(!crossing&&!contained(segment))return false;
    here=segment.at(-1);
  }
  return !crossing&&seen;
}
let colorTarget=null;
function closePathColor() {$('pathColorPanel').hidden=true;$('colorSelected').classList.remove('active');$('colorSelected').setAttribute('aria-expanded',false);colorTarget=null;}
function showPathColor(key,name,color,keys=[key]) {
  if(state.busy||!state.project)return;
  setTool('select');
  colorTarget={key,keys:[...keys],project:state.project};$('colorPathName').textContent=name;
  $('colorSource').textContent=`Erkannte Originalfarbe: ${color.source.toUpperCase()} · Aktuell: ${color.name}`;
  $('applySameColor').checked=false;$('customPathColor').value=color.color;
  $('neonPalette').replaceChildren();
  for(const item of state.drawing.neonPalette){
    const button=document.createElement('button');button.className='neon-color-choice';button.classList.toggle('active',color.id===item.id);
    button.setAttribute('aria-pressed',String(color.id===item.id));button.title=`${item.group} · ${item.name}`;
    const dot=document.createElement('span');dot.className='color-dot';dot.style.background=item.swatch||item.color;
    const label=document.createElement('span');label.textContent=item.name;button.append(dot,label);button.onclick=()=>applyPathColor(item.id);$('neonPalette').append(button);
  }
  $('pathColorPanel').hidden=false;$('pathColorPanel').querySelector('details').open=false;
  $('colorSelected').classList.add('active');$('colorSelected').setAttribute('aria-expanded',true);
  $('neonPalette').scrollLeft=0;
}
function applyPathColor(value) {
  if(!colorTarget||colorTarget.project!==state.project||state.busy)return;
  const key=colorTarget.key,source=state.drawing.colorSources[key];
  const keys=$('applySameColor').checked?Object.keys(state.drawing.colorSources).filter(k=>state.drawing.colorSources[k]===source):colorTarget.keys;
  const colors={...state.settings.pathColors};
  for(const k of keys){if(value===null)delete colors[k];else colors[k]=value;}
  state.settings.pathColors=colors;closePathColor();
  commitHistory();requestGeometry(true);
}
function renderParts() {
  const count=state.selectedParts.length;
  $('partSelectionCount').textContent=count?`${count} Element${count===1?'':'e'} ausgewählt`:'Kein Element ausgewählt';
  $$('[data-part-mode]').forEach(button=>button.disabled=!count||state.busy);
  $('resetPartModes').disabled=!Object.keys(state.settings.partModes).length;
  $('partList').replaceChildren();
  for(const part of state.drawing.parts){
    const button=document.createElement('button');button.className='part-chip';
    const selected=state.selectedParts.includes(part.id);button.classList.toggle('active',selected);button.setAttribute('aria-pressed',selected);
    button.textContent=`${part.name} · ${part.mode==='single'?'Single':'Double'}`;
    button.onclick=()=>{state.selectedParts=selected?state.selectedParts.filter(id=>id!==part.id):[...state.selectedParts,part.id];selectKeys(state.drawing.pathKeys.filter((key,i)=>state.selectedParts.includes(state.drawing.pathPartIds[i])));};
    $('partList').append(button);
  }
}
function assignParts(mode) {
  if(!state.selectedParts.length||state.busy)return;
  const overrides={...state.settings.partModes};
  const ids=new Set(state.selectedParts.flatMap(id=>state.drawing.parts.find(p=>p.id===id)?.linkedParts||[id]));
  for(const id of ids) if(mode==='default')delete overrides[id];else overrides[id]=mode;
  state.settings.partModes=overrides;commitHistory();requestGeometry(true);
}
function svgPoint(event){return new DOMPoint(event.clientX,event.clientY).matrixTransform($('drawing').getScreenCTM().inverse());}
function setTab(tab) {
  if(tab!=='motif'&&state.tool.startsWith('uv-'))setTool('select');
  if(tab!=='acrylic'&&state.tool==='depth-region')setTool('select');
  state.tab=tab;$$('[data-tab]').forEach(button=>{const active=button.dataset.tab===tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',active);button.tabIndex=active?0:-1;});
  $$('.tab-panel').forEach(panel=>{panel.hidden=panel.id!==`panel-${tab}`;});
}
function updateViewControls() {
  $$('[data-view]').forEach(button=>{const active=button.dataset.view===state.view;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});
  $('dimensions').setAttribute('aria-pressed',state.dimensions);
}
function setZoom(value) {
  if(value==='fit'){state.zoom=100;state.pan={x:0,y:0};}else state.zoom=Math.max(25,Math.min(3200,Number(value)));
  const select=$('zoom');select.querySelectorAll('[data-custom]').forEach(el=>el.remove());
  if(![...select.options].some(option=>Number(option.value)===state.zoom)){const option=new Option(`${Math.round(state.zoom)} %`,String(state.zoom));option.dataset.custom='true';select.add(option);}
  select.value=String(state.zoom);updateViewBox();
}
function setTool(tool) {cancelMoveSelection();if(tool!=='recover')closeRecovery(false);closePathColor();state.outlineSelection=[];state.outlineSelected=null;state.outlineAdding=false;uvDraft=null;clearOutlineDraft();state.tool=tool;state.straightenSelection=null;for(const [id,value] of [['selectTool','select'],['moveTool','move'],['panTool','pan'],['regionTool','region'],['straightenTool','straighten'],['outlineStraightenTool','outline-straighten'],['depthRegionTool','depth-region'],['outlinePointTool','outline-points'],['recoveryTool','recover']]){$(id).classList.toggle('active',tool===value);$(id).setAttribute('aria-pressed',tool===value);}$('drawing').classList.toggle('uv-mode',tool==='uv-brush'||tool==='uv-erase');$('drawing').classList.toggle('pan-mode',tool==='pan');$('drawing').classList.toggle('move-mode',tool==='move');$('drawing').classList.toggle('region-mode',['region','outline-straighten','depth-region'].includes(tool));renderDrawing();renderStraightenControls();renderVisibilityControls();exportState();}

function toggleExportMenu(force) {const open=force ?? $('exportMenu').hidden;$('exportMenu').hidden=!open;$('exportDropdown').setAttribute('aria-expanded',open);}
function setExportKind(kind) {
  state.exportKind=kind;toggleExportMenu(false);
  $$('[data-export]').forEach(button=>button.classList.toggle('selected',button.dataset.export===kind));
  $('exportCaption').textContent={uv:'UV-Druck · Originalfarben · 1:1 · ohne Fräslinien',cnc:'CNC · ohne Angaben · 1:1',drawing:'Zeichnung · mit Maßen und Neonmetern',custom:'Zeichnung · eigene Angaben'}[kind];
  if(kind==='custom')$('exportDialog').showModal();
}
async function exportPDF() {
  if(!state.valid||state.busy||state.exporting||!state.project||state.straightenSelection||state.outlineDraft||state.outlineBusy||uvDraft||moveDraft)return;
  state.exporting=true;exportState();const label=$('export').querySelector('span:last-child');label.textContent='PDF wird erstellt …';
  const options=state.exportKind==='custom'?{...state.exportOptions,kind:'custom'}:{kind:state.exportKind,dimensions:true,meters:true,title:state.project.name.replace(/\.[^.]+$/,'')};
  const project=state.project, settings={...state.settings}, kind=state.exportKind, modeLabel=state.drawing.modeLabel.replaceAll(' ','');
  try{
    const response=await api('/api/export',{id:project.id,settings,options});
    const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');
    const filename=project.name.replace(/\.[^.]+$/,'').replace(/[^\w\-]/g,'_');
    a.href=url;a.download=`${filename}_${modeLabel}_${kind==='cnc'?'CNC':kind==='uv'?'UV_Druck':'Zeichnung'}.pdf`;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('PDF erstellt. Der Download ist bereit.');
  }catch(error){toast(error.message,true);}finally{state.exporting=false;exportState();label.textContent='PDF exportieren';}
}

function showSettings(){syncPrefsControls();renderCustomPresets();$('settingsDialog').showModal();}
function syncPrefsControls(){const p=state.prefs;$('neonColor').value=p.neon;$('acrylicColor').value=p.acrylic;$('backgroundColor').value=p.background;$('acrylicOpacity').value=p.opacity;$('opacityValue').textContent=p.opacity+' %';$('glow').checked=p.glow;$('logoColors').checked=p.logoColors;}
function applyPrefs(p){state.prefs=validPrefs(p);saveLocal('neonstudio.view.v1',state.prefs);syncPrefsControls();document.documentElement.style.setProperty('--canvas',state.prefs.background);renderDrawing();}
function renderCustomPresets(){
  $('customPresets').replaceChildren();
  for(const [name,prefs] of Object.entries(state.customPresets).slice(0,12)){const button=document.createElement('button');button.textContent=name;button.onclick=()=>applyPrefs(prefs);$('customPresets').append(button);}
}

async function openCrop(){
  if(!state.project||state.project.sourceKind==='vector')return;
  cropRect=null;cropStart=null;$('cropSelection').hidden=true;
  $('cropPreview').src=state.project.cropSource?.data||state.project.originalData;$('cropDialog').showModal();
}
function cropPoint(event){const rect=$('cropPreview').getBoundingClientRect();return {x:Math.max(0,Math.min(rect.width,event.clientX-rect.left)),y:Math.max(0,Math.min(rect.height,event.clientY-rect.top))};}
function drawCrop(){
  const box=$('cropSelection');if(!cropRect){box.hidden=true;return;}
  const image=$('cropPreview').getBoundingClientRect(),stage=$('cropStage').getBoundingClientRect();
  Object.assign(box.style,{left:`${image.left-stage.left+cropRect.x}px`,top:`${image.top-stage.top+cropRect.y}px`,width:`${cropRect.w}px`,height:`${cropRect.h}px`});box.hidden=false;
}
async function applyCrop(){
  const image=$('cropPreview');if(!image.complete||!image.naturalWidth)return toast('Das Bild wird noch geladen.');
  const source=state.project.cropSource||{data:state.project.originalData,name:state.project.name};
  if(!cropRect){
    $('cropDialog').close();
    if(source.data!==state.project.originalData)await loadImage(null,source.data,source.name,source);
    return;
  }
  const rect=image.getBoundingClientRect(),sx=image.naturalWidth/rect.width,sy=image.naturalHeight/rect.height;
  if(cropRect.w*sx<20||cropRect.h*sy<20)return toast('Bitte einen größeren Logobereich markieren.',true);
  const canvas=document.createElement('canvas');canvas.width=Math.round(cropRect.w*sx);canvas.height=Math.round(cropRect.h*sy);
  canvas.getContext('2d').drawImage(image,cropRect.x*sx,cropRect.y*sy,cropRect.w*sx,cropRect.h*sy,0,0,canvas.width,canvas.height);
  const name=source.name.replace(/\.[^.]+$/,'')+'_Ausschnitt.png';$('cropDialog').close();await loadImage(null,canvas.toDataURL('image/png'),name,source);
}

let processingTimer, motifSession=null;
function processing(title,detail='Linien und Kurven werden aus deinem Bild berechnet.') {
  clearInterval(processingTimer);const start=performance.now();
  $('processingTitle').textContent=title;$('processingDetail').textContent=detail;
  $('processingOverlay').hidden=false;$('stage').setAttribute('aria-busy','true');
  document.querySelector('.inspector').inert=true;
  const processingPlace=location.pathname.startsWith('/api/ops/neon-studio')?'Verarbeitung auf dem Server':'lokal auf deinem Rechner';
  const tick=()=>{$('processingElapsed').textContent=`${Math.floor((performance.now()-start)/1000)} s · ${processingPlace}`;};tick();processingTimer=setInterval(tick,1000);
}
function hideProcessing(){clearInterval(processingTimer);$('processingOverlay').hidden=true;$('stage').setAttribute('aria-busy','false');}
function finishAnalysis(){state.analyzing=false;hideProcessing();document.querySelector('.inspector').inert=false;}
function readImage(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('Motivvorschau konnte nicht geladen werden.'));im.src=src;});}
let vectorSession=null;
function vectorNode(tag,attributes={}){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attributes))node.setAttribute(k,String(v));return node;}
function vectorBounds(paths){
  const boxes=paths.map(p=>p.bounds),x=Math.min(...boxes.map(b=>b[0])),y=Math.min(...boxes.map(b=>b[1]));
  const w=Math.max(...boxes.map(b=>b[2]))-x,h=Math.max(...boxes.map(b=>b[3]))-y,pad=Math.max(w,h)*.035+1;
  return [x-pad,y-pad,Math.max(w,1)+2*pad,Math.max(h,1)+2*pad];
}
function chooseVectorMotif(prepared){
  return new Promise(resolve=>{
    vectorSession={prepared,selected:new Set(prepared.suggested),mode:null,history:[],tool:'click',fullPage:false,resolve,start:null,loading:false};
    setupVectorSelection();hideProcessing();$('vectorDialog').showModal();
  });
}
function setupVectorSelection(){
  const s=vectorSession,p=s.prepared;
  $('vectorRaster').hidden=!/\.(pdf|ai)$/i.test(p.name);
  $('vectorPageLabel').hidden=p.pageCount<=1;$('vectorPage').replaceChildren();
  for(let i=0;i<p.pageCount;i++){const option=new Option(String(i+1),String(i));$('vectorPage').add(option);}$('vectorPage').value=p.pageIndex;
  $('vectorStatus').textContent=p.suggestionNote;
  $('vectorPathList').replaceChildren();$('vectorColors').replaceChildren();
  for(const path of p.paths){
    const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.dataset.vectorId=path.id;
    box.onchange=()=>{saveVectorStep();if(box.checked)s.selected.add(path.id);else s.selected.delete(path.id);renderVectorSelection();};
    label.append(box,document.createTextNode(path.name+(path.role==='Vektorpfad'?'':' · '+path.role)));$('vectorPathList').append(label);
  }
  for(const color of new Set(p.paths.map(path=>path.color))){
    const button=document.createElement('button'),dot=document.createElement('i');button.type='button';dot.style.background=color;
    button.dataset.vectorColor=color;button.setAttribute('aria-label','Pfade mit Farbe '+color+' auswählen');button.append(dot,document.createTextNode(color.toUpperCase()));
    button.onclick=()=>{saveVectorStep();const paths=p.paths.filter(path=>path.color===color),all=paths.every(path=>s.selected.has(path.id));for(const path of paths)if(all)s.selected.delete(path.id);else s.selected.add(path.id);renderVectorSelection();};
    $('vectorColors').append(button);
  }
  renderVectorSelection();
}
function saveVectorStep(){const s=vectorSession;if(!s||s.loading)return;s.history.push([...s.selected]);if(s.history.length>20)s.history.shift();$('vectorStatus').textContent='Manuelle Auswahl. Nur die grünen Pfade werden übernommen.';}
function vectorImportMode(s){return s.mode||(s.prepared.paths.some(path=>s.selected.has(path.id)&&path.filled)?'double':'single');}
function renderVectorSelection(){
  const s=vectorSession;if(!s)return;const p=s.prepared,svg=$('vectorCanvas');svg.replaceChildren();
  const view=s.fullPage?p.viewBox:vectorBounds(p.paths);svg.setAttribute('viewBox',view.join(' '));
  svg.append(vectorNode('image',{href:p.image,x:p.viewBox[0],y:p.viewBox[1],width:p.viewBox[2],height:p.viewBox[3],opacity:.18,'pointer-events':'none'}));
  // Wide transparent hit strokes make thin supplier paths easy to click.
  for(const path of p.paths){
    const group=vectorNode('g',{'data-vector-path':path.id});
    group.append(vectorNode('path',{d:path.d,fill:'none',stroke:s.selected.has(path.id)?'#12965d':'#df6571','stroke-width':2,'vector-effect':'non-scaling-stroke','pointer-events':'none'}));
    group.append(vectorNode('path',{d:path.d,fill:'none',stroke:'transparent','stroke-width':14,'vector-effect':'non-scaling-stroke','pointer-events':'stroke'}));
    svg.append(group);
  }
  $$('[data-vector-id]').forEach(input=>input.checked=s.selected.has(input.dataset.vectorId));
  $$('[data-vector-color]').forEach(button=>button.setAttribute('aria-pressed',p.paths.filter(path=>path.color===button.dataset.vectorColor).every(path=>s.selected.has(path.id))));
  $$('[data-vector-tool]').forEach(button=>{const active=button.dataset.vectorTool===s.tool;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});
  $('vectorCount').textContent=`${s.selected.size} von ${p.paths.length} Pfaden ausgewählt`;
  const filled=p.paths.some(path=>s.selected.has(path.id)&&path.filled);
  const mode=vectorImportMode(s);
  $$('[data-vector-mode]').forEach(button=>{const active=button.dataset.vectorMode===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);button.disabled=s.loading;});
  $('vectorImportNote').textContent=[p.importNote,filled?(mode==='single'?'Single Line: Aus den gefüllten Formen werden dünne Mittellinien berechnet. Danach mit dem Original vergleichen. Die Originalkonturen bleiben für Double Line erhalten.':'Double Line: Die originalen Buchstabenumrisse und Formkonturen werden übernommen. Für einen einzelnen Neonzug wähle Single Line.'):'Original-Vektorlinien werden übernommen. Schriftumrisse kannst du anschließend samt Innenräumen markieren und mit „Auswahl: Single“ in Mittellinien umwandeln.'].filter(Boolean).join(' ');
  $('vectorConfirm').disabled=!s.selected.size||s.loading;$('vectorUndo').disabled=!s.history.length||s.loading;
  $('vectorFit').textContent=s.fullPage?'Vektoren vergrößern':'Gesamte Seite';
  $('vectorHelp').textContent=s.tool==='rectangle'?'Ziehe ein Rechteck: Vollständig enthaltene Pfade werden ausgewählt. Kurven werden nicht abgeschnitten. Danach einzelne Pfade per Klick korrigieren.':'Klicke auf eine Linie zum Aufnehmen oder Weglassen. Ein Klick auf die freie Fläche leert die Auswahl. Grün = übernehmen · Rot = weglassen.';
}
function vectorPoint(event){const p=$('vectorCanvas').createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform($('vectorCanvas').getScreenCTM().inverse());}
$$('[data-vector-mode]').forEach(button=>button.onclick=()=>{if(!vectorSession||vectorSession.loading)return;vectorSession.mode=button.dataset.vectorMode;renderVectorSelection();});
$$('[data-vector-tool]').forEach(button=>button.onclick=()=>{if(!vectorSession||vectorSession.loading)return;vectorSession.tool=button.dataset.vectorTool;renderVectorSelection();});
$('vectorAuto').onclick=()=>{if(!vectorSession||vectorSession.loading)return;saveVectorStep();vectorSession.selected=new Set(vectorSession.prepared.suggested);$('vectorStatus').textContent=vectorSession.prepared.suggestionNote;renderVectorSelection();};
$('vectorAll').onclick=()=>{if(!vectorSession||vectorSession.loading)return;saveVectorStep();vectorSession.selected=new Set(vectorSession.prepared.paths.map(p=>p.id));renderVectorSelection();};
$('vectorNone').onclick=()=>{if(!vectorSession||vectorSession.loading)return;saveVectorStep();vectorSession.selected.clear();renderVectorSelection();};
$('vectorUndo').onclick=()=>{if(vectorSession?.history.length&&!vectorSession.loading){vectorSession.selected=new Set(vectorSession.history.pop());renderVectorSelection();}};
$('vectorFit').onclick=()=>{if(!vectorSession)return;vectorSession.fullPage=!vectorSession.fullPage;renderVectorSelection();};
$('vectorCanvas').addEventListener('pointerdown',event=>{
  const s=vectorSession;if(!s||s.loading||event.button!==0)return;event.preventDefault();
  if(s.tool==='click'){saveVectorStep();const id=event.target.closest('[data-vector-path]')?.dataset.vectorPath;if(!id)s.selected.clear();else if(s.selected.has(id))s.selected.delete(id);else s.selected.add(id);renderVectorSelection();return;}
  s.start=vectorPoint(event);$('vectorCanvas').setPointerCapture(event.pointerId);
});
$('vectorCanvas').addEventListener('pointermove',event=>{
  const s=vectorSession;if(!s?.start)return;const p=vectorPoint(event);$('vectorRect')?.remove();
  $('vectorCanvas').append(vectorNode('rect',{id:'vectorRect',x:Math.min(s.start.x,p.x),y:Math.min(s.start.y,p.y),width:Math.abs(p.x-s.start.x),height:Math.abs(p.y-s.start.y),fill:'#12965d22',stroke:'#12965d','stroke-width':1.5,'vector-effect':'non-scaling-stroke','pointer-events':'none'}));
});
$('vectorCanvas').addEventListener('pointerup',event=>{
  const s=vectorSession;if(!s?.start)return;const p=vectorPoint(event),a=[Math.min(s.start.x,p.x),Math.min(s.start.y,p.y),Math.max(s.start.x,p.x),Math.max(s.start.y,p.y)];
  saveVectorStep();s.selected=new Set(s.prepared.paths.filter(path=>{const b=path.bounds;return b[0]>=a[0]&&b[1]>=a[1]&&b[2]<=a[2]&&b[3]<=a[3];}).map(path=>path.id));s.start=null;renderVectorSelection();
});
$('vectorCanvas').addEventListener('pointercancel',()=>{if(vectorSession){vectorSession.start=null;renderVectorSelection();}});
$('vectorPage').onchange=async()=>{
  const s=vectorSession;if(!s||s.loading)return;s.loading=true;renderVectorSelection();$('vectorStatus').textContent='Seite wird vorbereitet …';
  try{const p=await(await api('/api/vector-page',{id:s.prepared.id,page:Number($('vectorPage').value)})).json();if(vectorSession!==s)return;if(p.kind!=='vector'){vectorSession=null;$('vectorDialog').close();s.resolve({nextPrepared:p});return;}s.prepared=p;s.selected=new Set(p.suggested);s.history=[];s.loading=false;setupVectorSelection();}
  catch(error){if(vectorSession===s){s.loading=false;$('vectorPage').value=s.prepared.pageIndex;$('vectorStatus').textContent=error.message;renderVectorSelection();}}
};
$('vectorConfirm').onclick=()=>{const s=vectorSession;if(!s||s.loading||!s.selected.size)return;vectorSession=null;$('vectorDialog').close();s.resolve({id:s.prepared.id,selected:[...s.selected],mode:vectorImportMode(s)});};
$('vectorDialog').addEventListener('close',()=>{if(vectorSession){const s=vectorSession;vectorSession=null;s.resolve(null);}});
$('vectorRaster').onclick=async()=>{
  const s=vectorSession;if(!s||s.loading)return;s.loading=true;renderVectorSelection();$('vectorStatus').textContent='Sichtbare PDF-Seite wird vorbereitet …';
  try{const p=await(await api('/api/vector-page',{id:s.prepared.id,page:s.prepared.pageIndex,raster:true})).json();if(vectorSession!==s)return;vectorSession=null;$('vectorDialog').close();s.resolve({nextPrepared:p});}
  catch(error){if(vectorSession===s){s.loading=false;$('vectorStatus').textContent=error.message;renderVectorSelection();}}
};

async function chooseMotif(prepared) {
  const [image,labels]=await Promise.all([readImage(prepared.image),readImage(prepared.labels)]);
  const canvas=$('motifCanvas');canvas.width=prepared.width;canvas.height=prepared.height;
  const layer=document.createElement('canvas');layer.width=canvas.width;layer.height=canvas.height;
  const ctx=layer.getContext('2d',{willReadFrequently:true});ctx.drawImage(labels,0,0);
  const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const automatic=new Uint8Array(canvas.width*canvas.height);
  for(let i=0;i<automatic.length;i++)automatic[i]=Number(Boolean(bytes[i*4]||bytes[i*4+1]||bytes[i*4+2]));
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  $('motifImportNote').hidden=!prepared.importNote;$('motifImportNote').textContent=prepared.importNote||'';
  $('motifPageLabel').hidden=!(prepared.pageCount>1);
  $('motifPage').replaceChildren(...Array.from({length:prepared.pageCount||0},(_,index)=>new Option(String(index+1),String(index))));
  $('motifPage').value=prepared.pageIndex??0;$('motifPage').disabled=false;
  return new Promise(resolve=>{
    motifSession={prepared,image,pixels,automatic,additions:new Uint8Array(automatic.length),colorSeed:null,colorBase:null,mask:automatic.slice(),layer,overlay:ctx.createImageData(canvas.width,canvas.height),history:[],kind:'auto',tool:'rectangle',start:null,last:null,rect:null,frame:null,resolve};
    $('motifTolerance').value=24;$('motifToleranceValue').textContent='24';$('motifColorSample').style.background='transparent';setMotifTool('rectangle');renderMotif();hideProcessing();$('motifDialog').showModal();
  });
}
function setMotifTool(tool){
  if(!motifSession)return;motifSession.tool=tool;$('motifCursor').hidden=true;
  $$('[data-motif-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.motifTool===tool);b.setAttribute('aria-pressed',b.dataset.motifTool===tool);});
  $('motifColorOptions').hidden=tool!=='color';
  $('motifHelp').textContent=tool==='color'?'Klicke auf eine Farbe im Original. Die zusammenhängende Farbfläche wird grün ergänzt, auch wenn die Automatik sie übersehen hat. Rot bleibt ausgeschlossen.':tool==='rectangle'?'Ziehe ein Rechteck: Nur die Fläche darin wird grün. Danach mit Grün ergänzen oder mit Rot Flecken entfernen.':tool==='keep'?'Male die gewünschten Bildbereiche grün aus. Der Pinsel erweitert die Auswahl nur innerhalb seiner runden Spitze.':'Übermale störende Flecken rot. Nur die übermalten Pixel werden ausgeschlossen; verbundene Buchstaben bleiben erhalten.';
}
function motifSnapshot(s){return {mask:s.mask.slice(),additions:s.additions.slice(),kind:s.kind};}
function saveMotifStep(){const s=motifSession;s.colorSeed=null;s.colorBase=null;s.history.push(motifSnapshot(s));if(s.history.length>12)s.history.shift();}
function restoreMotifStep(previous){const s=motifSession;Object.assign(s,previous);s.colorSeed=null;s.colorBase=null;}
function queueMotifRender(){const s=motifSession;if(!s||s.frame!==null)return;s.frame=requestAnimationFrame(()=>{s.frame=null;if(motifSession===s)renderMotif();});}
function renderMotif(){
  const s=motifSession;if(!s)return;const canvas=$('motifCanvas'),ctx=canvas.getContext('2d'),rgba=s.overlay.data;let selected=0;
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(s.image,0,0);
  for(let i=0;i<s.mask.length;i++){
    const keep=s.mask[i]===1,red=s.mask[i]===2,j=i*4;if(keep)selected++;
    rgba[j]=keep?47:243;rgba[j+1]=keep?217:69;rgba[j+2]=keep?143:83;rgba[j+3]=keep?105:red?125:0;
  }
  s.layer.getContext('2d').putImageData(s.overlay,0,0);ctx.drawImage(s.layer,0,0);
  if(s.rect){const {x,y,w,h}=s.rect;ctx.strokeStyle='#81dcbc';ctx.fillStyle='#7be8bb35';ctx.lineWidth=canvas.width/canvas.getBoundingClientRect().width*2;ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);}
  $('motifCount').textContent=`${number(selected/s.mask.length*100,1)} % grün · nur dieser Bildbereich wird ausgelesen`;
  $('motifConfirm').disabled=!selected||!!s.loading;$('motifUndo').disabled=!s.history.length;
  $('motifAuto').classList.toggle('active',s.kind==='auto');$('motifAll').classList.toggle('active',s.kind==='all');
  $('motifStatus').textContent=s.kind==='auto'?'Automatischer Vorschlag. Bei Fotos können Teile des Hintergrunds dazugehören – mit Rechteck oder Pinsel korrigieren.':s.kind==='color'?'Farbfläche ergänzt. Die Toleranz gilt für den letzten Farbklick. Mit weiteren Klicks weitere Flächen aufnehmen.':s.kind==='all'?'Das ganze Bild ist freigegeben. Hintergrund und Motivlinien werden bei der Nachzeichnung unterschieden.':'Manuelle Auswahl. Rot und unmarkierte Bereiche werden nicht nachgezeichnet. Die Markierungsfarbe selbst wird kein Neonpfad.';
}
function motifPoint(event){const box=$('motifCanvas').getBoundingClientRect();return {x:Math.max(0,Math.min($('motifCanvas').width-1,(event.clientX-box.left)*$('motifCanvas').width/box.width)),y:Math.max(0,Math.min($('motifCanvas').height-1,(event.clientY-box.top)*$('motifCanvas').height/box.height))};}
function paintMotif(point){
  const s=motifSession,canvas=$('motifCanvas');const radius=Number($('motifBrush').value)/2*canvas.width/canvas.getBoundingClientRect().width;
  const start=s.last||point,steps=Math.max(1,Math.ceil(Math.hypot(point.x-start.x,point.y-start.y)/Math.max(1,radius/2))),value=s.tool==='keep'?1:2;
  for(let step=0;step<=steps;step++){
    const x=start.x+(point.x-start.x)*step/steps,y=start.y+(point.y-start.y)*step/steps;
    for(let yy=Math.max(0,Math.ceil(y-radius));yy<=Math.min(canvas.height-1,Math.floor(y+radius));yy++){
      const extent=Math.sqrt(Math.max(0,radius*radius-(yy-y)**2));
      const left=Math.max(0,Math.ceil(x-extent)),right=Math.min(canvas.width-1,Math.floor(x+extent));
      s.mask.fill(value,yy*canvas.width+left,yy*canvas.width+right+1);
    }
  }
  s.kind='manual';s.last=point;queueMotifRender();
}
function showMotifCursor(event){
  const s=motifSession;if(!s||!['keep','remove'].includes(s.tool))return;
  const wrap=$('motifCanvas').parentElement.getBoundingClientRect(),size=Number($('motifBrush').value);
  Object.assign($('motifCursor').style,{left:`${event.clientX-wrap.left}px`,top:`${event.clientY-wrap.top}px`,width:`${size}px`,height:`${size}px`,borderColor:s.tool==='keep'?'#70e9af':'#f5878d',background:s.tool==='keep'?'#70e9af18':'#f5878d18'});$('motifCursor').hidden=false;
}
function pickMotifColor(point) {
  const s=motifSession;if(!s)return;
  const width=s.prepared.width,seed=Math.round(point.y)*width+Math.round(point.x);
  if(s.pixels[seed*4+3]<=128){toast('Bitte auf eine sichtbare Farbe klicken.');return;}
  saveMotifStep();s.colorBase=motifSnapshot(s);s.colorSeed=seed;applyMotifColor();
}
function applyMotifColor() {
  const s=motifSession;if(!s||s.colorSeed===null)return;
  const tolerance=Number($('motifTolerance').value),bytes=s.pixels,seed=s.colorSeed,width=s.prepared.width;
  s.mask=s.colorBase.mask.slice();s.additions=s.colorBase.additions.slice();
  const rgb=bytes.slice(seed*4,seed*4+3),visited=new Uint8Array(s.mask.length),queue=new Int32Array(s.mask.length);
  let head=0,tail=1;queue[0]=seed;visited[seed]=1;
  const enqueue=index=>{if(!visited[index]){visited[index]=1;queue[tail++]=index;}};
  while(head<tail){
    const index=queue[head++],j=index*4;
    if(bytes[j+3]<=128||s.colorBase.mask[index]===2||Math.max(Math.abs(bytes[j]-rgb[0]),Math.abs(bytes[j+1]-rgb[1]),Math.abs(bytes[j+2]-rgb[2]))>tolerance)continue;
    s.mask[index]=1;s.additions[index]=1;
    if(index%width)enqueue(index-1);if(index%width<width-1)enqueue(index+1);
    if(index>=width)enqueue(index-width);if(index+width<s.mask.length)enqueue(index+width);
  }
  s.kind='color';$('motifColorSample').style.background=`rgb(${rgb.join(',')})`;renderMotif();
}
$('motifTolerance').oninput=()=>{$('motifToleranceValue').textContent=$('motifTolerance').value;applyMotifColor();};
$$('[data-motif-tool]').forEach(button=>button.onclick=()=>setMotifTool(button.dataset.motifTool));
$('motifAuto').onclick=()=>{saveMotifStep();motifSession.mask.set(motifSession.automatic);motifSession.additions.fill(0);motifSession.kind='auto';renderMotif();};
$('motifAll').onclick=()=>{saveMotifStep();motifSession.mask.fill(1);motifSession.kind='all';renderMotif();};
$('motifNone').onclick=()=>{saveMotifStep();motifSession.mask.fill(0);motifSession.additions.fill(0);motifSession.kind='manual';renderMotif();};
$('motifUndo').onclick=()=>{const s=motifSession;if(s.history.length){const previous=s.history.pop();restoreMotifStep(previous);renderMotif();}};
$('motifCanvas').addEventListener('pointerdown',event=>{if(!motifSession||event.button!==0)return;event.preventDefault();const p=motifPoint(event);if(motifSession.tool==='color'){pickMotifColor(p);return;}saveMotifStep();motifSession.start=p;motifSession.last=null;$('motifCanvas').setPointerCapture(event.pointerId);showMotifCursor(event);if(motifSession.tool!=='rectangle')paintMotif(p);});
$('motifCanvas').addEventListener('pointerleave',()=>{$('motifCursor').hidden=true;});
$('motifCanvas').addEventListener('pointermove',event=>{showMotifCursor(event);const s=motifSession;if(!s?.start)return;const p=motifPoint(event);if(s.tool==='rectangle'){s.rect={x:Math.min(p.x,s.start.x),y:Math.min(p.y,s.start.y),w:Math.abs(p.x-s.start.x),h:Math.abs(p.y-s.start.y)};queueMotifRender();}else paintMotif(p);});
$('motifCanvas').addEventListener('pointerup',event=>{
  const s=motifSession;if(!s?.start)return;const p=motifPoint(event),width=$('motifCanvas').width;
  if(s.tool==='rectangle'){
    const left=Math.floor(Math.min(p.x,s.start.x)),right=Math.ceil(Math.max(p.x,s.start.x)),top=Math.floor(Math.min(p.y,s.start.y)),bottom=Math.ceil(Math.max(p.y,s.start.y));
    s.mask.fill(0);for(let y=top;y<=bottom;y++)s.mask.fill(1,y*width+left,y*width+right+1);s.kind='manual';
  }else paintMotif(p);
  s.start=s.last=s.rect=null;renderMotif();
});
$('motifCanvas').addEventListener('pointercancel',()=>{const s=motifSession;if(s?.start){const previous=s.history.pop();if(previous){restoreMotifStep(previous);}s.start=s.last=s.rect=null;renderMotif();}});
function encodeMask(binary){
  const chunks=[];for(let i=0;i<binary.length;i+=8192)chunks.push(String.fromCharCode(...binary.subarray(i,i+8192)));
  return btoa(chunks.join(''));
}
$('motifConfirm').onclick=()=>{
  const s=motifSession;if(!s||s.loading)return;
  const binary=Uint8Array.from(s.mask,value=>Number(value===1));if(!binary.some(Boolean))return;
  const result={mask:encodeMask(binary)};if(s.additions.some(Boolean))result.additions=encodeMask(s.additions);
  motifSession=null;$('motifDialog').close();s.resolve(result);
};
$('motifDialog').addEventListener('close',()=>{if(motifSession){const s=motifSession;motifSession=null;if(s.frame!==null)cancelAnimationFrame(s.frame);s.resolve(null);}});
$('motifPage').onchange=async()=>{
  const s=motifSession;if(!s||s.loading)return;s.loading=true;$('motifPage').disabled=true;renderMotif();$('motifStatus').textContent='PDF-Seite wird vorbereitet …';
  try{const p=await(await api('/api/vector-page',{id:s.prepared.id,page:Number($('motifPage').value)})).json();if(motifSession!==s)return;motifSession=null;if(s.frame!==null)cancelAnimationFrame(s.frame);$('motifDialog').close();s.resolve({nextPrepared:p});}
  catch(error){if(motifSession===s){s.loading=false;$('motifPage').disabled=false;$('motifPage').value=s.prepared.pageIndex;renderMotif();$('motifStatus').textContent=error.message;}}
};

// Wire UI to the same state used by the PDF request.
for(const id of ['upload','emptyUpload','replaceImage'])$(id).onclick=()=>$('fileInput').click();
$('fileInput').addEventListener('change',event=>{if(event.target.files[0])loadImage(event.target.files[0]);});
for(const id of ['example','loadExample'])$(id).onclick=()=>loadImage();
$('loadTestLogo').onclick=async()=>{try{const response=await fetch('/test-logo.png');if(!response.ok)throw new Error('Testlogo konnte nicht geladen werden.');await loadImage(new File([await response.blob()],'NOVA_Test.png',{type:'image/png'}));}catch(error){toast(error.message,true);}};
$('fileInfo').onclick=()=>setTab('motif');
$$('[data-tab]').forEach(button=>button.onclick=()=>setTab(button.dataset.tab));
document.querySelector('.tabs').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const tabs=$$('[data-tab]');const next=(tabs.findIndex(b=>b.dataset.tab===state.tab)+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;setTab(tabs[next].dataset.tab);tabs[next].focus();}});
$$('[data-view]').forEach(button=>button.onclick=()=>{cancelMoveSelection();state.view=button.dataset.view;if(state.view==='vectors'&&(state.tool.startsWith('uv-')||state.tool==='recover'))setTool('select');updateViewControls();renderDrawing();});
$$('[data-shape]').forEach(button=>button.onclick=()=>setSetting('shape',button.dataset.shape));
$$('[data-mode]').forEach(button=>button.onclick=()=>setSetting('mode',button.dataset.mode));
$$('[data-dimension-unit]').forEach(button=>button.onclick=()=>{
  state.dimensionUnit=button.dataset.dimensionUnit;saveLocal('neonstudio.dimensionUnit.v1',state.dimensionUnit);
  updateControls();renderDrawing();
});
$$('[data-setting]').forEach(input=>{
  input.addEventListener('input',()=>{const value=Number(input.value.replace(',','.'))*(input.id==='width'&&state.dimensionUnit==='cm'?10:1);if(input.value!==''&&Number.isFinite(value))setSetting(input.dataset.setting,value,false);});
  input.addEventListener('change',()=>{if(input.id==='width')input.value=(state.settings.width/(state.dimensionUnit==='cm'?10:1)).toFixed(2);else if(input.value==='')input.value=state.settings[input.dataset.setting];commitHistory();updateControls();requestGeometry(true);});
});
$('dimensions').onclick=()=>{state.dimensions=!state.dimensions;updateViewControls();renderDrawing();};
$('undo').onclick=()=>historyMove(-1);$('redo').onclick=()=>historyMove(1);
$('zoom').onchange=event=>setZoom(event.target.value);$('fit').onclick=()=>setZoom('fit');
$('colorSelected').onclick=()=>{if(!$('pathColorPanel').hidden){closePathColor();return;}const i=state.selection;if(i>=0)showPathColor(state.drawing.pathKeys[i],state.selectedKeys.length>1?`${state.selectedKeys.length} Pfade`:state.drawing.names[i],state.drawing.pathColors[i],state.selectedKeys);};
$('closePathColor').onclick=closePathColor;
for(const [id,direction] of [['palettePrevious',-1],['paletteNext',1]])$(id).onclick=()=>{
  const strip=$('neonPalette');strip.scrollBy({left:direction*strip.clientWidth*.75,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
};
$('neonPalette').addEventListener('wheel',event=>{
  if(event.ctrlKey||event.metaKey||Math.abs(event.deltaX)>=Math.abs(event.deltaY))return;
  event.preventDefault();$('neonPalette').scrollLeft+=event.deltaY*(event.deltaMode===1?16:1);
},{passive:false});
$$('[data-side-toggle]').forEach(button=>button.onclick=()=>{
  const panel=$(button.dataset.sideToggle+'Sides');panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));
});
$$('[data-side-setting]').forEach(input=>{
  input.addEventListener('input',()=>{const value=Number(input.value.replace(',','.'));if(input.value!==''&&Number.isFinite(value))setSetting(input.dataset.sideSetting,value,false,input.dataset.side);});
  input.addEventListener('change',()=>{commitHistory();updateControls();requestGeometry(true);});
});
$('applyCustomColor').onclick=()=>applyPathColor($('customPathColor').value);
$('resetPathColor').onclick=()=>applyPathColor(null);
$('splitSelected').onclick=splitSelectedPaths;
$('hideSelected').onclick=()=>{if(state.selectedKeys.length)setPathHidden(state.selectedKeys,true);};
$('hiddenSummary').onclick=()=>{setTab('neon');$('pathOverview').scrollIntoView({block:'nearest'});};
$('uvCanvasButton').onclick=()=>{startUv('uv-brush');$('uvDone').scrollIntoView({block:'nearest'});};
$('uvCanvasErase').onclick=()=>startUv('uv-erase');
document.querySelectorAll('[data-uv-mode]').forEach(button=>button.onclick=()=>{state.settings.uvMode=button.dataset.uvMode;commitHistory();requestGeometry(true);});
$('uvBrushTool').onclick=()=>startUv('uv-brush');
$('uvEraseTool').onclick=()=>startUv('uv-erase');
$('uvDone').onclick=()=>{state.view='vectors';updateViewControls();setTool('select');};
$('uvBrushSize').oninput=()=>{$('uvBrushValue').textContent=$('uvBrushSize').value+' px';};
$('uvClear').onclick=()=>{state.settings.uvStrokes=[];commitHistory();requestGeometry(true);};
$('selectTool').onclick=()=>setTool('select');$('moveTool').onclick=()=>setTool(state.tool==='move'?'select':'move');$('panTool').onclick=()=>setTool('pan');
$('straightenTool').onclick=()=>setTool(state.tool==='straighten'?'select':'straighten');
$('cancelStraighten').onclick=()=>setTool('select');
$('applyStraighten').onclick=applyStraighten;
$('depthRegionTool').onclick=()=>{state.view='vectors';updateViewControls();setDepthRegionValue(state.settings.depth);setTool(state.tool==='depth-region'?'select':'depth-region');};
$('cancelDepthRegion').onclick=()=>setTool('select');
$('applyDepthRegion').onclick=applyDepthRegion;
for(const id of ['depthRegionValue','depthRegionRange'])$(id).oninput=()=>{
  const el=$(id),value=Number(el.value);
  if(el.value.trim()&&Number.isFinite(value)&&value>=0&&value<=20000){
    $('depthRegionRange').max=Math.max(500,Math.ceil(value/100)*100);
    $(id==='depthRegionRange'?'depthRegionValue':'depthRegionRange').value=value;
  }
  if(state.outlineDraft?.kind==='depth')previewDepthRegion(state.outlineDraft.rect,state.outlineDraft.index,180);
};
$('outlinePointTool').onclick=()=>{state.view='vectors';updateViewControls();setTool(['outline-points','outline-straighten'].includes(state.tool)?'select':'outline-points');};
$('finishOutlinePoints').onclick=()=>setTool('select');
$('addOutlinePoint').onclick=()=>{if(state.tool!=='outline-points')setTool('outline-points');state.outlineAdding=!state.outlineAdding;renderOutlinePointControls();};
$('deleteOutlinePoint').onclick=deleteOutlineSelection;
$('drawing').addEventListener('dblclick',event=>{
  if(state.tool==='outline-points'&&event.target.classList.contains('outline-point-hit')){
    event.preventDefault();changeOutlineAnchor('insert',nearestOutlinePoint(state.drawing.outlineVisibleControls||state.drawing.outlineControls||state.drawing.outer,svgPoint(event)));
  }
});
$('outlineStraightenTool').onclick=()=>{state.view='vectors';updateViewControls();setTool(state.tool==='outline-straighten'?'outline-points':'outline-straighten');};
$('cancelOutlineStraighten').onclick=()=>setTool('outline-points');
$('applyOutlineStraighten').onclick=applyOutlineStraighten;
$('resetOutlineEdits').onclick=()=>{state.settings.outlineEdits=[];commitHistory();requestGeometry(true);};
$('regionTool').onclick=()=>{setTool(state.tool==='region'?'select':'region');toast('Ziehe auf dem Motiv ein Rechteck um die gewünschten Elemente.');};
$$('[data-part-mode]').forEach(button=>button.onclick=()=>assignParts(button.dataset.partMode));
$('resetPartModes').onclick=()=>{state.settings.partModes={};commitHistory();requestGeometry(true);};
$('drawing').addEventListener('click',event=>{
  if(state.tool==='straighten'){
    if(state.busy||!state.valid)return;
    const curve=event.target.dataset.curve;
    if(curve){const [index,segment]=curve.split(':').map(Number);state.straightenSelection={index,segment};}
    else state.straightenSelection=null;
    renderDrawing();renderStraightenControls();exportState();return;
  }
 });
$('drawing').addEventListener('pointerdown',event=>{
  if(event.button!==0||!state.drawing)return;
  if(state.tool==='recover'){recoveryPointerDown(event);return;}
  if(state.tool==='outline-points'){
    if(state.outlineAdding&&event.target.classList.contains('outline-point-hit')){
      event.preventDefault();changeOutlineAnchor('insert',nearestOutlinePoint(state.drawing.outlineVisibleControls||state.drawing.outlineControls||state.drawing.outer,svgPoint(event)));
    }else if(event.target.dataset.outlinePoint!==undefined)startOutlinePoint(event);
    else if(!state.busy&&!state.outlineBusy&&state.valid){
      regionStart={points:true,point:svgPoint(event),client:[event.clientX,event.clientY],additive:event.shiftKey,moved:false};
      $('drawing').setPointerCapture(event.pointerId);event.preventDefault();
    }
    return;
  }
  if(state.tool.startsWith('uv-')&&!state.busy&&state.view==='original'){
    const point=svgPoint(event),scale=state.drawing.settings.scale,m=$('drawing').getScreenCTM().inverse();
    uvDraft={op:state.tool==='uv-erase'?'erase':'add',radius:Number($('uvBrushSize').value)*Math.hypot(m.a,m.b)/2/scale,points:[[point.x/scale,point.y/scale]]};
    $('drawing').setPointerCapture(event.pointerId);event.preventDefault();renderUvOverlay();exportState();return;
  }
  if(state.tool==='move'&&event.target.dataset.path!==undefined){startMoveSelection(event);return;}
  if(['select','move','region','outline-straighten','depth-region'].includes(state.tool)&&!state.busy){
    const depthIndex=state.outlineDraft?.index??-1;
    if(['outline-straighten','depth-region'].includes(state.tool)){clearOutlineDraft();renderDrawing();renderOutlineStraightenControls();renderDepthRegionControls();exportState();}
    regionStart={depth:state.tool==='depth-region',depthIndex,outline:state.tool==='outline-straighten',point:svgPoint(event),client:[event.clientX,event.clientY],index:event.target.dataset.path,additive:event.shiftKey,moved:false};
    $('drawing').setPointerCapture(event.pointerId);event.preventDefault();return;
  }
  if(state.tool!=='pan')return;const svg=$('drawing');svg.setPointerCapture(event.pointerId);svg.classList.add('dragging');
  const matrix=svg.getScreenCTM().inverse();const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix);
  dragInfo={point,pan:{...state.pan},matrix};
});
$('drawing').addEventListener('pointermove',event=>{
  if(moveDraft?.pointerId!==undefined){previewMovePointer(event);return;}
  if(state.tool==='recover'){recoveryPointerMove(event);return;}
  if(state.outlineDraft?.kind==='point'&&state.outlineDraft.dragging){moveOutlinePoint(event);return;}
  if(uvDraft){
    const point=svgPoint(event),scale=state.drawing.settings.scale,p=[point.x/scale,point.y/scale],last=uvDraft.points.at(-1);
    if(Math.hypot(p[0]-last[0],p[1]-last[1])>uvDraft.radius/8){uvDraft.points.push(p);renderUvOverlay();}return;
  }
  if(regionStart){
    if(Math.hypot(event.clientX-regionStart.client[0],event.clientY-regionStart.client[1])<4&&!regionStart.moved)return;
    regionStart.moved=true;const p=svgPoint(event),start=regionStart.point;let rect=$('regionSelection');
    if(!rect){rect=document.createElementNS('http://www.w3.org/2000/svg','rect');rect.id='regionSelection';rect.classList.add('part-bounds','region-box');$('drawing').append(rect);}
    const crossing=!regionStart.points&&!regionStart.outline&&!regionStart.depth&&p.x<start.x;rect.classList.toggle('crossing',crossing);
    for(const [key,value] of Object.entries({x:Math.min(p.x,start.x),y:Math.min(p.y,start.y),width:Math.abs(p.x-start.x),height:Math.abs(p.y-start.y)}))rect.setAttribute(key,value);
    $('selectionLabel').textContent=regionStart.points?'Konturpunkte auswählen':regionStart.depth?'Bereich für die Einkerbung markieren':regionStart.outline?'Abschnitt der Acrylkante markieren':crossing?'Berührte Pfade auswählen':'Vollständig eingeschlossene Pfade auswählen';return;
  }
  if(!dragInfo)return;const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(dragInfo.matrix);state.pan={x:dragInfo.pan.x-(point.x-dragInfo.point.x),y:dragInfo.pan.y-(point.y-dragInfo.point.y)};updateViewBox();
});
for(const name of ['pointerup','pointercancel'])$('drawing').addEventListener(name,event=>{
  if(moveDraft?.pointerId===event.pointerId){if(name==='pointercancel')cancelMoveSelection();else{previewMovePointer(event);finishMoveSelection();}return;}
  if(state.tool==='recover'){recoveryPointerEnd(event,name==='pointercancel');return;}
  if(state.outlineDraft?.kind==='point'&&state.outlineDraft.dragging){
    if(name==='pointercancel'){clearOutlineDraft();renderDrawing();renderOutlinePointControls();exportState();}
    else{moveOutlinePoint(event);state.outlineDraft.dragging=false;clearTimeout(depthPreviewTimer);finishOutlinePoint();}
    if($('drawing').hasPointerCapture(event.pointerId))$('drawing').releasePointerCapture(event.pointerId);
    return;
  }
  if(uvDraft){
    const stroke=uvDraft;uvDraft=null;
    if($('drawing').hasPointerCapture(event.pointerId))$('drawing').releasePointerCapture(event.pointerId);
    if(name!=='pointercancel'){const point=svgPoint(event),scale=state.drawing.settings.scale;stroke.points.push([point.x/scale,point.y/scale]);state.settings.uvStrokes=[...(state.settings.uvStrokes||[]),stroke];commitHistory();requestGeometry(true);}
    else{renderUvOverlay();exportState();}return;
  }
  const start=regionStart;regionStart=null;$('regionSelection')?.remove();dragInfo=null;$('drawing').classList.remove('dragging');
  if($('drawing').hasPointerCapture(event.pointerId))$('drawing').releasePointerCapture(event.pointerId);
  if(!start||name==='pointercancel'||state.busy)return;
  if(start.moved){
    const p=svgPoint(event),a=start.point,rect=[Math.min(p.x,a.x),Math.min(p.y,a.y),Math.max(p.x,a.x),Math.max(p.y,a.y)];
    if(start.points){
      const points=outlinePointsInRect(state.drawing.outlineVisibleControls||state.drawing.outlineControls||state.drawing.outer,rect);
      state.outlineSelection=selectOutlinePoints(state.outlineSelection||[],points,start.additive);
      renderOutlinePoints();renderOutlinePointControls();$('selectionLabel').textContent='';return;
    }
    if(start.depth){previewDepthRegion(rect,start.depthIndex);return;}
    if(start.outline){previewOutlineStraighten(rect);return;}
    const keys=state.drawing.pathKeys.filter((key,i)=>pathInSelection(state.drawing.paths[i],rect,p.x<a.x));
    selectKeys(selectionKeys(state.selectedKeys,keys,start.additive));
  }else if(start.points){if(!start.additive)state.outlineSelection=[];renderOutlinePoints();renderOutlinePointControls();}
  else if(start.outline||start.depth){renderDrawing();}
  else if(start.index!==undefined)selectPath(Number(start.index),start.additive);
  else if(!start.additive)selectKeys([]);
});
$('drawing').addEventListener('wheel',event=>{
  if(!state.drawing)return;
  event.preventDefault();
  if(state.outlineDraft?.kind==='point'||moveDraft)return;
  const svg=$('drawing'),unit=event.deltaMode===1?16:event.deltaMode===2?svg.clientHeight:1;
  const dx=event.deltaX*unit,dy=event.deltaY*unit;
  // Trackpads send two-finger movement as wheel events and pinch as Ctrl+wheel.
  if(event.ctrlKey||event.metaKey){
    const before=svgPoint(event);
    setZoom(state.zoom*Math.exp(-Math.max(-100,Math.min(100,dy))*.003));
    const after=svgPoint(event);
    state.pan.x+=before.x-after.x;state.pan.y+=before.y-after.y;
  }else{
    const matrix=svg.getScreenCTM().inverse(),speed=.65;
    state.pan.x+=(matrix.a*dx+matrix.c*dy)*speed;
    state.pan.y+=(matrix.b*dx+matrix.d*dy)*speed;
  }
  updateViewBox();
},{passive:false});
for(const id of ['cropTool','cropImage'])$(id).onclick=openCrop;
$('cropStage').addEventListener('pointerdown',event=>{cropStart=cropPoint(event);cropRect=null;$('cropStage').setPointerCapture(event.pointerId);drawCrop();});
$('cropStage').addEventListener('pointermove',event=>{if(!cropStart)return;const p=cropPoint(event);cropRect={x:Math.min(cropStart.x,p.x),y:Math.min(cropStart.y,p.y),w:Math.abs(p.x-cropStart.x),h:Math.abs(p.y-cropStart.y)};drawCrop();});
for(const name of ['pointerup','pointercancel'])$('cropStage').addEventListener(name,()=>{cropStart=null;});
$('resetCrop').onclick=()=>{cropStart=null;cropRect=null;drawCrop();return applyCrop();};$('applyCrop').onclick=applyCrop;
$('settings').onclick=showSettings;
$$('[data-preset]').forEach(button=>button.onclick=()=>applyPrefs(presets[button.dataset.preset]));
for(const id of ['neonColor','acrylicColor','backgroundColor','acrylicOpacity','glow','logoColors'])$(id).addEventListener('input',()=>applyPrefs({neon:$('neonColor').value,acrylic:$('acrylicColor').value,background:$('backgroundColor').value,opacity:Number($('acrylicOpacity').value),glow:$('glow').checked,logoColors:$('logoColors').checked}));
$('savePreset').onclick=()=>{const name=$('presetName').value.trim();if(!name)return toast('Bitte einen Namen für das Preset eingeben.');state.customPresets={...state.customPresets,[name]:{...state.prefs}};saveLocal('neonstudio.presets.v1',state.customPresets);$('presetName').value='';renderCustomPresets();toast('Ansicht als Preset gespeichert.');};
$$('[data-close]').forEach(button=>button.onclick=()=>$(button.dataset.close).close());
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
$('exportDropdown').onclick=event=>{event.stopPropagation();toggleExportMenu();};
$$('[data-export]').forEach(button=>button.onclick=()=>setExportKind(button.dataset.export));
document.addEventListener('click',event=>{if(!event.target.closest('.export-area'))toggleExportMenu(false);});
$('export').onclick=exportPDF;
$('saveExportOptions').onclick=()=>{state.exportOptions={dimensions:$('pdfDimensions').checked,meters:$('pdfMeters').checked,includeTitle:$('pdfTitleEnabled').checked,title:$('pdfTitleEnabled').checked?$('pdfTitle').value:'',note:$('pdfNote').value};$('exportDialog').close();toast('PDF-Angaben übernommen.');};
document.addEventListener('keydown',event=>{
  if(event.defaultPrevented)return;
  const editing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)||document.activeElement.isContentEditable;
  if(!editing&&!document.querySelector('dialog[open]')&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&moveKeyDown(event))return;
  if(!editing&&(event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();historyMove(event.shiftKey?1:-1);}
  if(!editing&&!document.querySelector('dialog[open]')&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&event.key.toLowerCase()==='c'&&!event.repeat&&state.selection>=0&&!state.busy){
    event.preventDefault();$('colorSelected').click();
  }
  if(!editing&&state.tool==='outline-points'&&['Delete','Backspace'].includes(event.key)){event.preventDefault();deleteOutlineSelection();}
  if(event.key==='Escape'){cancelMoveSelection();closePathColor();toggleExportMenu(false);if(['straighten','outline-straighten','depth-region','outline-points','recover'].includes(state.tool))setTool('select');}
});
document.addEventListener('keyup',moveKeyUp);
window.addEventListener('blur',cancelMoveSelection);
let dragDepth=0;
$('dropzone').addEventListener('dragenter',event=>{event.preventDefault();dragDepth++;$('dropOverlay').classList.add('visible');});
$('dropzone').addEventListener('dragover',event=>event.preventDefault());
$('dropzone').addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;$('dropOverlay').classList.remove('visible');}});
$('dropzone').addEventListener('drop',event=>{event.preventDefault();dragDepth=0;$('dropOverlay').classList.remove('visible');if(event.dataTransfer.files[0])loadImage(event.dataTransfer.files[0]);});





// Private pricing state never enters drawing settings or PDF export options.
let priceTicket=0;
const pricing={color:'single',outdoor:false};
const dollars=v=>`${number(Number(v),2)} $`;
const euros=v=>`${number(Number(v),2)} €`;
function invalidatePrice(message='Berechne …') {
  ++priceTicket;
  for(const id of ['priceProduction','priceShipping','priceTotal','priceCustomer'])$(id).textContent='—';
  $('priceStatus').textContent=message;
}
async function updatePrice() {
  invalidatePrice();
  if(!state.project||!state.drawing||state.busy){$('priceStatus').textContent=state.busy?'Geometrie wird berechnet …':'Zuerst ein Motiv laden.';return;}
  const ticket=priceTicket;
  const options={...pricing,uv_print:$('priceUv').checked,controllers:$('priceControllers').value,waterproof_psus:pricing.outdoor?$('pricePsus').value:0,mode:$('pricePacking').value,
    footprint_cm:[$('priceSplitWidth').value,$('priceSplitHeight').value],sales_factor:$('priceFactor').value,
    minimum_shipping_usd:$('priceMinimum').value,additional_cost_usd:$('priceExtra').value};
  try {
    const response=await api('/api/pricing',{id:state.project.id,settings:state.settings,pricing:options});
    const q=await response.json();if(ticket!==priceTicket)return;
    $('priceProduction').textContent=dollars(q.production_usd);$('priceShipping').textContent=dollars(q.shipping_usd);
    $('priceTotal').textContent=dollars(q.total_usd);$('priceCustomer').textContent=euros(q.customer_price.amount_eur);
    $('priceCustomerLabel').textContent=`Kunden-Richtpreis · × ${number(Number(q.customer_price.factor),1)}`;
    $('priceStatus').textContent='Unverbindliche Schätzung · offene Annahmen unter Preis';
    const p=q.packages[0],item=q.items[0];
    $('priceFormula').textContent=`${number(Number(item.neon_m),2)} m × 1,1 × ${item.rate_usd_m} $/m${item.outdoor?' × 1,2':''}${item.waterproof_psus?' + Netzteile':''}${item.uv_print?' + 30 $ UV-Druck (vorläufig)':''}${item.controllers?' + '+item.controllers+' × 15 $ Controller (vorläufig)':''}${q.items.length===2?' · zweimal Produktion':''}. Paket: ${p.dimensions_cm.map(v=>number(Number(v),2)).join(' × ')} cm; ${number(Number(p.volume_kg),3)} kg Volumengewicht × ca. 12 $, mindestens ${p.minimum_usd} $ je Paket${Number(p.oversize_usd)?' + 20 $ Überlänge':''}.`;
    $('priceWarnings').textContent=[Number(q.additional_cost_usd)?`In Gesamtkosten enthalten: ${dollars(q.additional_cost_usd)} manuelle Zusatzkosten.`:'',pricing.outdoor?'Netzteilanzahl und technische Outdoor-Eignung separat prüfen.':'',q.assumptions.includes('uv_print_rate_provisional')?'UV-Druck mit vorläufig 30 $ je Schild enthalten.':'',q.assumptions.includes('controller_rate_provisional')?'Controller mit vorläufig 15 $ pro Stück enthalten.':''].filter(Boolean).join(' ');
  }catch(error){if(ticket===priceTicket){invalidatePrice('Kalkulation nicht verfügbar');$('priceWarnings').textContent=error.message;}}
}
$('priceConfigure').onclick=()=>setTab('pricing');
$$('[data-price-color]').forEach(button=>button.onclick=()=>{
  pricing.color=button.dataset.priceColor;
  $$('[data-price-color]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});updatePrice();
});
$$('[data-price-outdoor]').forEach(button=>button.onclick=()=>{
  pricing.outdoor=button.dataset.priceOutdoor==='true';
  $$('[data-price-outdoor]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
  $('pricePsuRow').hidden=!pricing.outdoor;$('priceOutdoorNote').hidden=!pricing.outdoor;updatePrice();
});
for(const id of ['priceUv','priceControllers','pricePsus','pricePacking','priceSplitWidth','priceSplitHeight','priceFactor','priceMinimum','priceExtra']){
  $(id).addEventListener('input',()=>{$('priceSplit').hidden=$('pricePacking').value!=='split';$('priceFactorValue').textContent=number(Number($('priceFactor').value),1);updatePrice();});
}

setTab('acrylic');updateControls();renderProject();applyPrefs(state.prefs);

// Local line recovery. Drafts never enter project/history until explicitly applied.
function closeRecovery(render=true) {
  if(!recoverySession)return;
  recoverySession=null;clearTimeout(recoveryTimer);
  $('recoveryPanel').hidden=true;$('recoveryTool').classList.remove('active');$('recoveryTool').setAttribute('aria-expanded','false');$('recoveryTool').setAttribute('aria-pressed','false');
  $('drawing').classList.remove('recovery-mode');
  if(state.tool==='recover'){state.tool='select';$('selectTool').classList.add('active');$('selectTool').setAttribute('aria-pressed','true');}
  if(render){renderDrawing();exportState();}
}
async function startRecovery() {
  if(recoverySession){closeRecovery();return;}
  if(!state.project?.canRecover||state.busy||state.analyzing)return;
  setTool('recover');state.view='original';state.selectedKeys=[];state.selectedParts=[];state.selection=-1;
  const s=recoverySession={project:state.project,settings:JSON.parse(JSON.stringify(state.settings)),tool:'rectangle',revision:0,preview:null,source:null,rect:null,strokes:[],seed:null,running:false,pending:false,applying:false};
  $('recoveryPanel').hidden=false;$('recoveryTool').classList.add('active');$('recoveryTool').setAttribute('aria-expanded','true');$('drawing').classList.add('recovery-mode');
  $('recoveryTolerance').value=35;$('recoveryToleranceValue').textContent='35';$('recoveryColor').style.background='transparent';$('recoveryApply').disabled=true;
  $('recoveryStatus').textContent='Original wird geladen …';setRecoveryTool('rectangle');updateViewControls();renderDrawing();exportState();
  try{
    const source=await (await api('/api/recovery-source',{id:s.project.id})).json();
    const image=await readImage(source.image);
    if(recoverySession!==s)return;
    s.source=source;s.canvas=document.createElement('canvas');s.canvas.width=source.width;s.canvas.height=source.height;
    s.ctx=s.canvas.getContext('2d',{willReadFrequently:true});s.ctx.drawImage(image,0,0);
    s.mask=document.createElement('canvas');s.mask.width=source.width;s.mask.height=source.height;
    s.maskCtx=s.mask.getContext('2d',{willReadFrequently:true});
    $('recoveryStatus').textContent='Bereich markieren, dann mit der Pipette die gewünschte Farbfläche anklicken.';renderDrawing();
  }catch(error){if(recoverySession===s){closeRecovery();toast(error.message,true);}}
}
function setRecoveryTool(tool) {
  const s=recoverySession;if(!s||s.applying)return;s.tool=tool;
  for(const [id,name] of [['recoveryRect','rectangle'],['recoveryBrush','brush'],['recoveryPick','pick']]){
    $(id).classList.toggle('active',tool===name);$(id).setAttribute('aria-pressed',tool===name);
  }
  $('recoveryBrushControl').hidden=tool!=='brush';
}
function recoveryImageLayer() {
  const s=recoverySession;if(!s?.source||state.view!=='original')return '';
  const scale=state.drawing.settings.scale,[ox,oy]=s.source.origin;
  return `<image href="${s.source.image}" x="${-ox*scale}" y="${-oy*scale}" width="${s.source.width*scale}" height="${s.source.height*scale}" preserveAspectRatio="none"/><g fill="none" stroke="#687c90" opacity=".5" stroke-width="1" pointer-events="none">${state.drawing.pathData.map(d=>`<path d="${d}" vector-effect="non-scaling-stroke"/>`).join('')}</g>`;
}
function recoveryPoint(event) {
  const p=svgPoint(event),s=recoverySession,scale=state.drawing.settings.scale;
  return [Math.max(0,Math.min(s.source.width-1,p.x/scale+s.source.origin[0])),Math.max(0,Math.min(s.source.height-1,p.y/scale+s.source.origin[1]))];
}
function invalidateRecovery() {
  const s=recoverySession;if(!s)return;
  ++s.revision;s.preview=null;s.pending=false;clearTimeout(recoveryTimer);$('recoveryApply').disabled=true;renderRecoveryOverlay();
}
function recoveryPointerDown(event) {
  const s=recoverySession;if(!s?.source||s.applying)return;
  event.preventDefault();const p=recoveryPoint(event);
  if(s.tool==='pick'){
    if(!s.rect&&!s.strokes.length){$('recoveryStatus').textContent='Zuerst einen Bereich mit Rechteck oder Pinsel markieren.';return;}
    s.seed=p;const color=s.ctx.getImageData(Math.floor(p[0]),Math.floor(p[1]),1,1).data;
    $('recoveryColor').style.background=`rgb(${color[0]} ${color[1]} ${color[2]})`;
    queueRecoveryPreview();return;
  }
  invalidateRecovery();s.start=p;s.last=p;s.drawing=true;$('drawing').setPointerCapture(event.pointerId);
  if(s.tool==='rectangle'){s.rect=null;s.strokes=[];s.maskCtx.clearRect(0,0,s.source.width,s.source.height);s.seed=null;}
  else{
    s.rect=null;const m=$('drawing').getScreenCTM().inverse();
    s.stroke={points:[p],radius:Number($('recoveryBrushSize').value)*Math.hypot(m.a,m.b)/state.drawing.settings.scale/2};
    s.strokes.push(s.stroke);paintRecovery(p);
  }
  $('recoveryStatus').textContent='Nur der markierte Bereich wird nacherkannt.';renderRecoveryOverlay();
}
function paintRecovery(point) {
  const s=recoverySession,c=s.maskCtx,r=s.stroke.radius;c.fillStyle='#fff';c.strokeStyle='#fff';c.lineWidth=r*2;c.lineCap='round';
  c.beginPath();c.moveTo(...s.last);c.lineTo(...point);c.stroke();c.beginPath();c.arc(...point,r,0,Math.PI*2);c.fill();
  s.stroke.points.push(point);s.last=point;
}
function recoveryPointerMove(event) {
  const s=recoverySession;if(!s?.drawing)return;const p=recoveryPoint(event);
  if(s.tool==='rectangle')s.rect=[Math.min(p[0],s.start[0]),Math.min(p[1],s.start[1]),Math.max(p[0],s.start[0]),Math.max(p[1],s.start[1])];
  else paintRecovery(p);
  renderRecoveryOverlay();
}
function recoveryPointerEnd(event,cancelled) {
  const s=recoverySession;if(!s?.drawing)return;
  if(!cancelled)recoveryPointerMove(event);s.drawing=false;
  if($('drawing').hasPointerCapture(event.pointerId))$('drawing').releasePointerCapture(event.pointerId);
  if(cancelled){s.rect=null;s.strokes=[];s.seed=null;s.maskCtx.clearRect(0,0,s.source.width,s.source.height);renderRecoveryOverlay();return;}
  if(s.seed)queueRecoveryPreview();
  else{setRecoveryTool('pick');$('recoveryStatus').textContent='Jetzt die gewünschte Farbfläche innerhalb der Markierung anklicken.';}
}
function renderRecoveryOverlay() {
  $('recoveryOverlay')?.remove();const s=recoverySession;if(!s?.source||state.view!=='original')return;
  const scale=state.drawing.settings.scale,[ox,oy]=s.source.origin;
  const group=document.createElementNS('http://www.w3.org/2000/svg','g');group.id='recoveryOverlay';
  let region='';
  if(s.rect){const [a,b,c,d]=s.rect;region=`<rect x="${a}" y="${b}" width="${c-a}" height="${d-b}" fill="#42d5b7" fill-opacity=".12" stroke="#20a78d" stroke-width="1" vector-effect="non-scaling-stroke"/>`;}
  else region=s.strokes.map(stroke=>`<path d="M ${stroke.points.map(p=>p.join(' ')).join(' L ')}" fill="none" stroke="#42d5b7" stroke-opacity=".18" stroke-width="${stroke.radius*2}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  if(s.seed)region+=`<circle cx="${s.seed[0]}" cy="${s.seed[1]}" r="3" fill="#fff" stroke="#166457" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  group.innerHTML=`<g transform="scale(${scale}) translate(${-ox} ${-oy})">${region}</g><g fill="none" stroke="#00ad78" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${(s.preview?.paths||[]).map(d=>`<path d="${d}" vector-effect="non-scaling-stroke"/>`).join('')}</g>`;
  $('drawing').append(group);
}
function queueRecoveryPreview() {
  const s=recoverySession;if(!s||s.applying)return;invalidateRecovery();
  if(!s.seed||(!s.rect&&!s.strokes.length))return;
  s.pending=true;$('recoveryStatus').textContent='Linien werden nacherkannt …';
  recoveryTimer=setTimeout(()=>runRecoveryPreview(s),120);
}
async function runRecoveryPreview(s) {
  if(recoverySession!==s||s.running||!s.pending)return;
  s.pending=false;s.running=true;const revision=s.revision;
  try{
    const selection={seed:s.seed,tolerance:Number($('recoveryTolerance').value)};
    if(s.rect)selection.rect=s.rect;
    else{const data=s.maskCtx.getImageData(0,0,s.source.width,s.source.height).data;const mask=new Uint8Array(s.source.width*s.source.height);for(let i=0;i<mask.length;i++)mask[i]=data[i*4+3]>0?1:0;selection.mask=encodeMask(mask);}
    const preview=await (await api('/api/recovery-preview',{id:s.project.id,settings:s.settings,selection})).json();
    if(recoverySession!==s||s.revision!==revision)return;
    s.preview=preview;$('recoveryApply').disabled=!preview.count;
    $('recoveryStatus').textContent=preview.count?`${preview.count} ${preview.count===1?'neue Linie':'neue Linien'} grün · prüfen und mit ✓ übernehmen.`:'Keine zusätzlichen Linien. Farbe oder Empfindlichkeit anpassen; vorhandene Linien werden nicht doppelt ergänzt.';
    renderRecoveryOverlay();
  }catch(error){if(recoverySession===s&&s.revision===revision)$('recoveryStatus').textContent=error.message;}
  finally{s.running=false;if(recoverySession===s&&s.pending)runRecoveryPreview(s);}
}
async function applyRecovery() {
  const s=recoverySession;if(!s?.preview?.count||s.applying)return;
  s.applying=true;$('recoveryApply').disabled=true;$('recoveryStatus').textContent='Linien und Acrylabstand werden geprüft …';
  try{
    const result=await (await api('/api/recovery-apply',{id:s.project.id,draft:s.preview.draft,settings:state.settings,name:s.project.name})).json();
    if(recoverySession!==s||state.project!==s.project)return;
    state.project={...result.project,originalData:s.project.originalData,cropSource:s.project.cropSource};state.settings=result.drawing.settings;state.drawing=result.drawing;state.valid=result.drawing.exportable;state.busy=false;
    closeRecovery(false);state.view='vectors';commitHistory();renderProject();updateControls();updateViewControls();renderDrawing();renderDetails();exportState();setLive('Live');
    toast('Neue Linien übernommen. Rückgängig stellt die vorherige Zeichnung wieder her.');
  }catch(error){if(recoverySession===s){$('recoveryStatus').textContent=error.message;$('recoveryApply').disabled=false;}}
  finally{s.applying=false;}
}
$('recoveryTool').onclick=startRecovery;
$('recoveryRect').onclick=()=>setRecoveryTool('rectangle');$('recoveryBrush').onclick=()=>setRecoveryTool('brush');$('recoveryPick').onclick=()=>setRecoveryTool('pick');
$('recoveryCancel').onclick=()=>closeRecovery();$('recoveryApply').onclick=applyRecovery;
$('recoveryTolerance').oninput=()=>{$('recoveryToleranceValue').textContent=$('recoveryTolerance').value;queueRecoveryPreview();};

// Explanations stay beside the rail, including when a tool is unavailable.
const toolMenu=document.querySelector('.canvas-tool-menu');
let tooltipTarget=null;
function hideToolTooltip(){
  tooltipTarget?.removeAttribute('aria-describedby');tooltipTarget=null;$('toolTooltip').hidden=true;
}
function showToolTooltip(event){
  const button=event.target.closest('[data-tooltip]');
  if(!button||!toolMenu.contains(button)||(event.type==='focusin'&&!button.matches(':focus-visible')))return;
  hideToolTooltip();tooltipTarget=button;
  const tip=$('toolTooltip');tip.textContent=button.dataset.tooltip;tip.hidden=false;
  button.setAttribute('aria-describedby','toolTooltip');
  const rect=button.getBoundingClientRect(),box=tip.getBoundingClientRect();
  tip.style.left=`${Math.max(12,Math.min(rect.right+12,window.innerWidth-box.width-12))}px`;
  tip.style.top=`${Math.max(12,Math.min(rect.top,window.innerHeight-box.height-12))}px`;
}
toolMenu.addEventListener('pointerover',showToolTooltip);
toolMenu.addEventListener('focusin',showToolTooltip);
toolMenu.addEventListener('pointerout',event=>{if(!tooltipTarget?.contains(event.relatedTarget))hideToolTooltip();});
toolMenu.addEventListener('focusout',hideToolTooltip);
toolMenu.addEventListener('pointerdown',hideToolTooltip);
toolMenu.addEventListener('keydown',event=>{if(event.key==='Escape')hideToolTooltip();});
window.addEventListener('resize',hideToolTooltip);
window.addEventListener('scroll',hideToolTooltip,true);

// Open a labeled, local example after all UI state is initialized.
loadImage();
