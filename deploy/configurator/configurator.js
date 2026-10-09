import {frameRoom,roomArea,moveWithinRoom} from './room-framing.js?v=20261008-entry-room1';
import {initEntryOnboarding,createDraftWriteGuard} from './entry-onboarding.js?v=20261008-entry-room1';
import {initBudgetAdvisor} from './budget-advisor.js?v=20261008-budget-live1';
import {createQuoteClient} from './quote-client.js?v=20261006-quote1';
import {initDeliveryCalendar,deliveryTierLabel,minimumDeliveryBusinessDays,DELIVERY_RESTRICTION_NOTE} from './delivery-calendar.js?v=20261008-min189';
import {refreshWishDelivery} from './content-experience.js?v=20261008-min189';
import {loadFontCatalog,searchFontCatalog,catalogFontAssetId,validateCatalogFont,FONT_CATALOG_CATEGORIES} from './font-catalog.js?v=20261006-filters1';
import {MANUFACTURING_PROFILE,TABLE_STAND_HEIGHT_MESSAGE,evaluatePlateManufacturing,minimumTextGroupClearance} from './manufacturing-profile.js?v=20261006-stand1';
import {decodeLogoFile} from './logo-import.js?v=20260929-upload2';
import {setupPhotoCalibration} from './photo-calibration.js?v=20260928-touch1';
import {DraftHistory,saveDraft,readDraft,saveAsset,readAsset,saveAssetIfMissing,saveNamedDesign,listNamedDesigns,readNamedDesign,removeNamedDesign} from './draft-store.js?v=20261004-a1';
import {createCheckoutClient,CHECKOUT_SESSION_KEY,rollingCheckoutDelivery,cookiebotVisitorConsent} from './checkout-client.js?v=20261008-min189';
import { buildBackingContour, tabletopContour, buildFreestandingSupports } from './backing-contour.js?v=20261006-bridges1';
import {createColorExample} from './color-examples.js?v=20261005-refine2';
import {PRICE_RULES,accessoryCounts,mountingNet,pricingPlateSize,priceForResult,priceLabel,priceOptions,minimumSizeForResult,sizeRangeForResult,layoutCorrectionStatus,priceAmounts,INCLUDED_DISCOUNT_PERCENT} from './pricing.js?v=20261008-min189';
import {createDesignLink,readDesignLink,isLocalShareUrl,emailShareUrl,shareMessage,createShareImage} from './design-share.js?v=20261006-quantities1';
const $ = selector => document.querySelector(selector);
const draftWriteGuard=createDraftWriteGuard();
const entryOnboarding=initEntryOnboarding({field:$('#sign-text'),help:$('#entry-help'),label:$('#entry-label')});
function acceptReplacementDraft(){draftWriteGuard.release();$('#use-replacement-draft').hidden=true;}
$('#use-replacement-draft').addEventListener('click',()=>{if(designRendering||!state.result||!state.sizeValid)return;acceptReplacementDraft();persistDesign(captureDesign());});
// The initial editor structure is rendered in HTML; only interaction is bound here.
const motifHeading=$('.studio-motif-heading');
const studioContext=$('.studio-context');
const textTools=$('.studio-text-tools');
const studioToolbar=$('.studio-toolbar');
const studioSceneActions=$('.studio-scene-actions');
const studioVariantTools=$('.studio-variant-tools');
const colorGalleryBody=$('.color-gallery-body');
const lookCards=$('.look-cards');
const scenarioSelect=$('#studio-scenario');
const textLayout=$('.text-layout-options');
const studioFooter=$('.studio-preview-footer');
const studioDesignTools=$('.design-tools');
const studioFonts=$('.studio-fonts');
const studioColors=$('.studio-colors');
const inlineRgbNote=$('#studio-rgb-note');
const previewSlot=$('#preview-slot');
scenarioSelect.addEventListener('change',()=>{if(!ROOMS.some(room=>room.id===scenarioSelect.value&&sceneAvailable(room)))return;state.room=scenarioSelect.value;state.scene='wall';paint();});
$('.text-layout-done').addEventListener('click',()=>{textLayout.open=false;textLayout.querySelector('summary').focus({preventScroll:true});});
document.addEventListener('click',event=>{if(!textLayout.contains(event.target))textLayout.open=false;});
textLayout.addEventListener('keydown',event=>{if(event.key==='Escape'){textLayout.open=false;textLayout.querySelector('summary').focus();}});
function fitTextField(){const field=$('#sign-text');field.style.height='0px';field.style.height=Math.max(54,field.scrollHeight+2)+'px';}
$('#sign-text').addEventListener('input',fitTextField);
const mobileChoiceMedia=matchMedia('(max-width:760px)');
function syncChoiceDetails(){for(const details of document.querySelectorAll('.choice-details'))details.open=false;}
syncChoiceDetails();
mobileChoiceMedia.addEventListener('change',syncChoiceDetails);
const shareDetails=document.createElement('details');shareDetails.className='share-extra';
shareDetails.innerHTML='<summary>Hinweise & Design-Link</summary>';
$('#share-image-note').before(shareDetails);shareDetails.append($('#share-image-note'),$('#share-link-label'),$('#share-link'));
const shareIcons={
 'share-email':'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
 'share-whatsapp':'<path d="M20 11.5a8.5 8.5 0 0 1-12.5 7.4L3 21l1.5-5A8.5 8.5 0 1 1 20 11.5Z"/><path d="M8 7c-2 4 3 9 7 8l1-2-3-1-1 1-2-2 1-1-1-3Z"/>',
 'share-pinterest':'<path d="m9 21 3-13M10 16c-4-1-5-9 1-11 7-2 10 5 6 10-2 2-5 1-5-1"/>',
 'share-copy':'<path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
 'share-image':'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
 'share-native':'<path d="M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7"/>'
};
function labelShareAction(id,label){const button=$('#'+id);button.innerHTML='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'+shareIcons[id]+'</svg>';const text=document.createElement('span');text.textContent=label;button.append(text);}
for(const id of Object.keys(shareIcons))labelShareAction(id,$('#'+id).textContent);
const SVG = 'http://www.w3.org/2000/svg';
const FONTS = ['Alexa','Amanda','Amsterdam','Austin','Avante','Barcelona','Bayview','Beachfront','Buttercup','Chelsea','ClassicType','Freehand','Freespirit','Greenworld','Hamillton','LoveNeon','LoveNote','Marquee','Mayfair','Melbourne','Monaco','NeoTokyo','NeonGlow','NeonLite','Neonscript','Neontrace','Nevada','NewCursive','Northshore','Rocket','Royalty','SciFi','Signature','Typewriter','Vintage','Waikiki','WildScript'];
let catalogDownloadController;
let mobileFontPage=0,mobileColorPage=0;
let fontCategory='all',fontLibrary='neon',fontTraitEnabled=false,fontCatalog=null,fontCatalogLimit=24;
// Swatches and off-state colors from the existing NEONTRIP configurator, 25 Sep 2026.
const COLORS = [
  ['warm_white','Warmweiß','#FFFDCF',true],['white','Weiß','#E1E3E6',true],['lemon_yellow','Zitronengelb','#FFF97C',false],
  ['golden_yellow','Goldgelb','#FFD62E',false],['orange','Orange','#FF8D02',false],['light_red','Hellrot','#FF7575',true],
  ['red','Rot','#FF2A4D',false],['pink','Neon-Pink','#FF90FF',true],['cotton_candy','Weiches Rosa','#EAA4FF',false],
  ['deep_pink','Rosa','#FF5CE8',false],['purple','Lila','#8C59FF',true],['deep_blue','Dunkleres Blau','#0274FC',false],
  ['electric_blue','Hellblau','#63AAFF',true],['ice_blue','Eis-Blau','#90DCFF',true],['tropical_blue','Tropisches Blau','#24B7DE',false],
  ['mint','Minziges Grün','#80FFD9',false],['green','Helles Grün','#85FFAA',true],['deep_green','Dunkleres Grün','#0BD748',false]
].map(([id,name,color,whiteOff]) => ({id,name,color,off:whiteOff ? '#F4F4F4' : color,whiteOff}));
const AVAILABLE_COLORS=COLORS.filter(color=>color.id!=='tropical_blue');
const BACKINGS = {
  contour: {name:'Formzuschnitt',description:'Folgt eng der Schriftkontur. Getrennte Wörter werden durch breite Übergänge verbunden.'},
  rectangle: {name:'Rechteckig',description:'Gerade Kanten rund um deinen Schriftzug, mit ca. 1,5 cm Rand auf jeder Seite.'},
  square: {name:'Quadratisch',description:'Gleich lange Seiten. Dein Schriftzug sitzt mittig, mit mindestens ca. 1,5 cm Rand.'},
  freestanding: {name:'Freigestellt',description:'Schmale transparente Stützen hinter den Buchstaben, ohne seitlichen Überstand. Die genaue Statik wird vor Fertigung geprüft.'}
};
const PLATE_FINISHES={clear:'Transparent', 'uv-print':'UV-Druck', 'mirror-gold':'Gold verspiegelt', 'mirror-silver':'Silber verspiegelt'};
function normalizedFinish(value){
  if(value==null)return {kind:'clear',color:'#FFFFFF'};
  if(!PLATE_FINISHES[value.kind]||!/^#[0-9a-f]{6}$/i.test(value.color))throw new Error('Die Rückplattenfarbe ist ungültig.');
  return {kind:value.kind,color:value.kind==='clear'?'#FFFFFF':value.kind==='mirror-gold'?'#D4AF37':value.kind==='mirror-silver'?'#C0C0C0':value.color.toUpperCase()};
}
function finishName(value){const finish=normalizedFinish(value);return PLATE_FINISHES[finish.kind]+(finish.kind==='uv-print'?' · '+(finish.color==='#FFFFFF'?'Weiß':finish.color==='#000000'?'Schwarz':finish.color):'');}
const MOUNTS={
  none:{name:'Ohne Montageset',description:'Du verwendest eigenes Montagezubehör.'},
  'wall-mount':{name:'Wandmontage-Set',image:'wall-mount.webp',description:'Schrauben, Dübel und Abstandshalter zur verschraubten Wandmontage.'},
  'hanging-kit':{name:'Drahtseil-Abhängeset',image:'hanging-kit.webp',description:'Zwei Drahtseile, um dein Schild von der Decke abzuhängen.'},
  'adhesive-kit':{name:'3M-Klebeset',image:'adhesive-kit.webp',description:'3M-Klett-Klebestreifen, von Schild und geeignetem Untergrund rückstandslos ablösbar.'},
  'table-stand':{name:'Acryl-Steckfüße',image:'table-stand.webp',description:'Zwei transparente Acrylfüße halten dein Schild auf einem Tisch oder einer Theke. Die Rückplatte erhält eine gerade Unterkante und Steckschlitze.'}
};
const STAND_SUPPORT_MM=MANUFACTURING_PROFILE.standSupportMm;
// Assumed photo widths for room metadata; example-room display framing is normalized below.
// Uploaded photos keep their calibrated width. Changing sign size must never refit it to the photo.
const ROOMS = [
  {id:'reception',spanMm:6000,name:'Empfang',image:'./assets/scenes/reception-detail-desktop-v1.webp',mobileImage:'./assets/scenes/reception-detail-mobile-v1.webp'},
  {id:'office',spanMm:5500,name:'Büro',image:'./assets/scenes/office-detail.webp'},
  {id:'event',spanMm:8000,name:'Event',image:'./assets/scenes/event-detail.webp'},
  {id:'podcast',spanMm:4000,name:'Podcast-Studio',image:'./assets/scenes/podcast-detail.webp'},
  {id:'dj',spanMm:8000,name:'DJ / Party',image:'./assets/scenes/dj-detail.webp'},
  {id:'outdoor-shop',outdoor:true,spanMm:3200,signY:200,mobileMinWidth:700,name:'Ladenfassade',image:'./assets/scenes/outdoor-20261007/storefront/storefront.webp'},
  {id:'summer',outdoor:true,spanMm:3200,signY:223,mobileMinWidth:700,name:'Sommerfestival',image:'./assets/scenes/outdoor-20261007/festival/festival-outdoor.webp'},
  {id:'outdoor-party',outdoor:true,spanMm:3200,signY:220,mobileMinWidth:700,name:'Open-Air-Party',image:'./assets/scenes/outdoor-20261007/evenings/outdoor-courtyard-party.webp'},
  {id:'outdoor-terrace',outdoor:true,spanMm:3200,signY:220,standY:323,mobileMinWidth:700,name:'Überdachte Terrasse',image:'./assets/scenes/outdoor-20261007/evenings/outdoor-pergola-terrace.webp'},
  {id:'shop',spanMm:5000,name:'Schaufenster · innen',image:'./assets/scenes/shop-detail.webp'},
  {id:'restaurant',spanMm:5000,name:'Restaurant',image:'./assets/scenes/optimized-20261008/restaurant.webp'},
  {id:'cafe',spanMm:4000,name:'Café',image:'./assets/scenes/optimized-20261008/cafe.webp'},
  {id:'beauty',spanMm:4000,name:'Beautystudio',image:'./assets/scenes/optimized-20261008/beauty.webp'},
  {id:'medical',spanMm:5000,name:'Arztpraxis',image:'./assets/scenes/optimized-20261008/medical.webp'},
  {id:'physio',spanMm:4500,name:'Physio-Studio',image:'./assets/scenes/optimized-20261008/physio.webp'},
  {id:'fitness',spanMm:6500,name:'Fitnessstudio',image:'./assets/scenes/optimized-20261008/fitness.webp'},
  {id:'studio',spanMm:4500,name:'Neutrale Wand',image:'./assets/scenes/studio-detail.webp'},
  {id:'tabletop',spanMm:3300,name:'Event · Podest',image:'./assets/scenes/optimized-20261008/event-podium.webp'}
];
const SCENE_IMAGE = new URL('./assets/scenes/neontrip-scenarios-wide.png',import.meta.url).href;
// Indoor rooms keep their shared display scale; outdoor scenes use their own framing.
// Uploaded photos retain their calibrated scale. This does not change sign dimensions.
function previewSpanMm(room){return room.id==='custom'||room.id==='tabletop'||room.outdoor?room.spanMm:4800;}
const lastWallRooms={indoor:'reception',outdoor:'outdoor-shop'};
function sceneAvailable(room){
  if(!room)return false;
  if(room.id==='custom')return true;
  if(state.mount==='table-stand')return room.id===(state.outdoor?'outdoor-terrace':'tabletop');
  return room.id!=='tabletop'&&!!room.outdoor===!!state.outdoor;
}
function ensureSceneMatchesUsage(){
  const usage=state.outdoor?'outdoor':'indoor';
  if(!sceneAvailable(ROOMS.find(room=>room.id===state.room)))state.room=state.mount==='table-stand'?(state.outdoor?'outdoor-terrace':'tabletop'):lastWallRooms[usage];
  if(state.mount!=='table-stand'&&state.room!=='custom')lastWallRooms[usage]=state.room;
}
function sceneSignY(room){return room.signY??(room.id==='shop'?235:room.id==='studio'||room.id==='reception'?250:210);}
const positions=new Map();
const cameras=new Map();
let roomPresentation=null;
let previewBox=null,drag=null,dragFrame=0,photoRevision=0,resizeFocus=null;
const state = {font:'Alexa',fontId:'Alexa',text:$('#sign-text').value,alignment:'center',lineHeight:.8,axis:'width',valueMm:500-2*MANUFACTURING_PROFILE.contourMarginMm,color:COLORS[7],wordColors:new Map(),words:[],colorTarget:'all',light:true,dimensions:true,scene:'wall',room:'reception',backing:'contour',mount:'wall-mount',previousRoom:'reception',result:null,sizeValid:true,autoContourNotice:false};
let designRendering=false,compactLineSpacing=false,budgetAdvisor,budgetSelecting=false;
// Spacing edits retain the physical letter scale, including across an invalid oversized draft.
let spacingAnchor=null;
const spacingContent=text=>String(text).replace(/[^\S\r\n]/gu,'');
const storedPriceCache=new Map();
Object.assign(state,priceOptions());
let presetKey='',presetRevision=0,lastBackingExampleResult=null;
let revision = 0, fontSelectionRevision = 0, requestId = 0, timer, uploadedFace, fontFile;
let worker;
const pending = new Map();
const loaded = new Map();
const draftAssets=new Map();
state.mode='text';state.logo=null;state.fontSource=null;state.plateFinish=normalizedFinish();state.charColors=new Map();state.characters=[];state.colorScope='words';state.lightMode='static';
let rgbPaused=matchMedia('(prefers-reduced-motion: reduce)').matches;
let logoSelectionRevision=0;
const designName=()=>state.mode==='logo'?(state.logo?.name||'Dein Logo'):state.text;
function designAssetRefs(snapshot){return [snapshot.photo?.assetId,snapshot.fontId?.startsWith('upload-')?snapshot.fontId:null,snapshot.logo?.assetId,snapshot.logo?.originalAssetId].filter(Boolean);}
let draftReady=false,draftApplying=false,draftTimer,history,lastSavedSnapshot;
let shareDesignKey=null;
function captureDesign(){
  const photo=ROOMS.find(room=>room.id==='custom');
  return {text:$('#sign-text').value,mode:state.mode,logo:state.logo?{...state.logo}:null,font:state.font,fontId:state.fontId,fontSource:state.mode==='logo'?null:state.fontSource,retainedFontSource:state.mode==='logo'?state.fontSource:null,alignment:state.alignment,lineHeight:state.lineHeight,
    axis:state.axis,valueMm:state.valueMm,color:state.color.id,wordColors:[...state.wordColors].map(([key,color])=>[key,color.id]),charColors:[...state.charColors].map(([key,color])=>[key,color.id]),lightMode:state.lightMode,
    ...priceOptions(state),light:state.light,dimensions:state.dimensions,scene:state.scene,room:state.room,backing:state.backing,plateFinish:{...state.plateFinish},mount:state.mount,previousRoom:state.previousRoom,
    positions:[...positions],cameras:[...cameras],photo:photo?{assetId:photo.assetId,spanMm:photo.spanMm,photoWidth:photo.photoWidth,photoHeight:photo.photoHeight,calibration:photo.calibration||null}:null};
}
function refreshHistoryButtons(){
  if(!history)return;
  const pending=JSON.stringify(captureDesign())!==history.entries[history.index];
  $('#undo-design').disabled=draftApplying||!(history.canUndo||pending);
  $('#redo-design').disabled=draftApplying||pending||!history.canRedo;
  const offset=positions.get(state.room);
  $('#reset-position').disabled=draftApplying||!offset||(!offset.x&&!offset.y);
}
function persistDesign(snapshot){
  if(draftWriteGuard.blocked){$('#draft-status').textContent='Vorhandener Entwurf konnte nicht geladen werden. Dieser neue Entwurf ist noch nicht gespeichert.';return;}
  const serialized=JSON.stringify(snapshot);if(serialized===lastSavedSnapshot)return;
  try{
    const assetIds=designAssetRefs(snapshot);
    if(assetIds.some(id=>!draftAssets.get(id)?.persisted))throw new Error('Datei nicht gespeichert');
    draftWriteGuard.write(saveDraft,snapshot);lastSavedSnapshot=serialized;$('#draft-status').textContent='Auf diesem Gerät gespeichert';
  }catch{$('#draft-status').textContent='Speichern nicht möglich – diesen Tab geöffnet lassen.';}
}
function commitHistory(){
  clearTimeout(draftTimer);if(!draftReady||draftApplying)return;
  history.record(captureDesign());refreshHistoryButtons();
}
function scheduleDraft(){
  if(!draftReady||draftApplying)return;
  persistDesign(captureDesign());refreshHistoryButtons();clearTimeout(draftTimer);
  draftTimer=setTimeout(commitHistory,400);
}
async function rememberAsset(id,file,url){
  const asset={file,url,persisted:false};draftAssets.set(id,asset);
  try{await saveAsset(id,file);asset.persisted=true;}catch{/* The live design remains usable; its save status reports the failure. */}
  return asset;
}
async function getDraftAsset(id,kind){
  let asset=draftAssets.get(id);
  if(!asset){const file=await readAsset(id);if(!file)throw new Error('Eine gespeicherte Datei fehlt.');asset={file,persisted:true};draftAssets.set(id,asset);}
  if(kind==='photo'||kind==='logo'){
    if(!(asset.file instanceof Blob)||!['image/jpeg','image/png','image/webp'].includes(asset.file.type)||asset.file.size>10_000_000)throw new Error('Das gespeicherte Foto ist ungültig.');
    if(!asset.url)asset.url=URL.createObjectURL(asset.file);
  }else if(kind==='original'){
    if(!(asset.file instanceof Blob)||asset.file.size>20_000_000)throw new Error('Die gespeicherte Originaldatei ist ungültig.');
  }else if(!(asset.file instanceof ArrayBuffer)||asset.file.byteLength>5_000_000)throw new Error('Die gespeicherte Schrift ist ungültig.');
  return asset;
}
async function applyDesign(value){
  entryOnboarding.end();
  spacingAnchor=null;
  if(!value||typeof value.text!=='string'||value.text.length>160||!['width','height'].includes(value.axis)||!Number.isFinite(value.valueMm)||value.valueMm<10||value.valueMm>5000||!BACKINGS[value.backing]||!MOUNTS[value.mount]||!['left','center','right'].includes(value.alignment))throw new Error('Der gespeicherte Entwurf ist ungültig.');
  const color=COLORS.find(c=>c.id===value.color);if(!color)throw new Error('Die gespeicherte Farbe ist ungültig.');
  const plateFinish=normalizedFinish(value.plateFinish);
  let fontSource=null;const storedFontSource=value.fontSource||(value.mode==='logo'?value.retainedFontSource:null);if(storedFontSource){const entry=validateCatalogFont(storedFontSource.entry);if(value.fontId!==catalogFontAssetId(entry)||typeof storedFontSource.licenseText!=='string'||storedFontSource.licenseText.length>50000)throw new Error('Der gespeicherte Schriftbeleg ist ungültig.');fontSource=storedFontSource;}
  if(value.lightMode&&!['static','rgb'].includes(value.lightMode))throw new Error('Die gespeicherte Beleuchtungsart ist ungültig.');
  let photo,fontAsset,face,logo=null;
  if(value.mode&& !['text','logo'].includes(value.mode))throw new Error('Der gespeicherte Motivtyp ist ungültig.');
  if(value.logo){
    if(typeof value.logo.assetId!=='string'||!value.logo.assetId.startsWith('logo-')||typeof value.logo.name!=='string'||value.logo.name.length>160)throw new Error('Die gespeicherte Logodatei ist ungültig.');
    await getDraftAsset(value.logo.assetId,'logo');logo={assetId:value.logo.assetId,name:value.logo.name};
    if(value.logo.originalAssetId){
      if(typeof value.logo.originalAssetId!=='string'||!value.logo.originalAssetId.startsWith('logo-original-'))throw new Error('Die gespeicherte Originaldatei ist ungültig.');
      const original=await getDraftAsset(value.logo.originalAssetId,'original');if(!(original.file instanceof Blob)||original.file.size>20_000_000)throw new Error('Die gespeicherte Originaldatei ist ungültig.');
      logo.originalAssetId=value.logo.originalAssetId;
      if(['pdf','eps'].includes(value.logo.sourceFormat)){logo.sourceFormat=value.logo.sourceFormat;logo.page=1;}
    }
  }
  if(value.photo){
    const p=value.photo;
    if(!Number.isFinite(p.spanMm)||p.spanMm<500||p.spanMm>50000||!Number.isFinite(p.photoWidth)||p.photoWidth<=0||p.photoWidth>1000+1e-6||!Number.isFinite(p.photoHeight)||p.photoHeight<=0||p.photoHeight>500+1e-6)throw new Error('Der gespeicherte Bildmaßstab ist ungültig.');
    const asset=await getDraftAsset(p.assetId,'photo');photo={...p,id:'custom',name:'Eigenes Foto',image:asset.url};
  }
  if(typeof value.fontId!=='string')throw new Error('Die gespeicherte Schrift fehlt.');
  if(value.fontId.startsWith('upload-')){
    fontAsset=await getDraftAsset(value.fontId,'font');
    await callWorker({type:'load',fontId:value.fontId,bytes:fontAsset.file});
    face=new FontFace('NT-Uploaded',fontAsset.file);await face.load();
  }else if(!FONTS.includes(value.fontId))throw new Error('Die gespeicherte Schrift ist unbekannt.');
  const roomIds=new Set(ROOMS.filter(r=>r.id!=='custom').map(r=>r.id));if(photo)roomIds.add('custom');
  if(!roomIds.has(value.room)||!roomIds.has(value.previousRoom))throw new Error('Die gespeicherte Szene fehlt.');
  // Validate resources before replacing any part of the currently visible design.
  revision++;state.requestedOuter=null;fontSelectionRevision++;photoRevision++;logoSelectionRevision++;clearTimeout(timer);compactLineSpacing=false;
  $('#accessory-migration-note').hidden=!hasRetiredCable(value);
  $('#accessory-migration-note').textContent=hasRetiredCable(value)?retiredCableMessage:'';
  Object.assign(state,priceOptions(value));
  state.mode=value.mode==='logo'?'logo':'text';state.logo=logo;state.fontSource=fontSource;state.lightMode=value.lightMode||'static';state.charColors=new Map((value.charColors||[]).filter(([key,id])=>typeof key==='string'&&key.length<500&&COLORS.some(c=>c.id===id)).map(([key,id])=>[key,COLORS.find(c=>c.id===id)]));
  if(face){if(uploadedFace)document.fonts.delete(uploadedFace);uploadedFace=face;document.fonts.add(face);fontFile=fontAsset.file;loaded.set(value.fontId,Promise.resolve());}
  const old=ROOMS.findIndex(r=>r.id==='custom');if(old>=0)ROOMS.splice(old,1);if(photo)ROOMS.push(photo);
  const requestedMount=state.accessoryQuantities['table-stand']>0?'table-stand':value.mount;
  const restoredMount=requestedMount==='none'||(value.backing==='freestanding'&&['hanging-kit','adhesive-kit','table-stand'].includes(requestedMount))?'wall-mount':requestedMount;
  let restoredRoom=restoredMount!==value.mount&&value.room==='tabletop'?value.previousRoom:value.room;
  if(restoredMount==='wall-mount'&&restoredRoom==='shop')restoredRoom='reception';
  Object.assign(state,{text:value.text,font:value.fontId.startsWith('upload-')?String(value.font||'Eigene Schrift'):value.fontId,fontId:value.fontId,alignment:value.alignment,lineHeight:Number.isFinite(value.lineHeight)&&value.lineHeight>=.8&&value.lineHeight<=2?value.lineHeight:1.25,axis:value.axis,valueMm:value.valueMm,color,wordColors:new Map((value.wordColors||[]).filter(([key,id])=>typeof key==='string'&&COLORS.some(c=>c.id===id)).map(([key,id])=>[key,COLORS.find(c=>c.id===id)])),light:value.light!==false,dimensions:value.dimensions!==false,scene:value.scene==='technical'?'technical':'wall',room:restoredRoom,backing:value.backing,plateFinish,mount:restoredMount,previousRoom:value.previousRoom,sizeValid:true,autoContourNotice:false});
  for(const [map,entries] of [[positions,value.positions],[cameras,value.cameras]]){
    map.clear();for(const [id,p] of entries||[])if(roomIds.has(id)&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=1000&&Math.abs(p.y)<=650&&(!('zoom' in p)||(p.zoom>=1&&p.zoom<=4)))map.set(id,{...p});
  }
  $('#sign-text').value=state.text;$('#size-error').hidden=true;
  for(const b of document.querySelectorAll('[data-align]'))b.setAttribute('aria-pressed',b.dataset.align===state.alignment);
  $('#photo-settings').hidden=!photo;if(photo)$('#photo-width').value=photo.spanMm/10;
  // update() first invalidates the price; a restored draft has no calculated price yet.
  $('#preview-room').replaceChildren();renderSceneButtons();syncDesignMode();state.result=null;await update();
}
async function moveHistory(delta){
  if(draftApplying||!history)return;commitHistory();
  if(delta<0?!history.canUndo:!history.canRedo)return;
  const previousIndex=history.index;draftApplying=true;refreshHistoryButtons();
  $('.editor').inert=true;$('.editor-tabs').inert=true;$('.preview-column').inert=true;
  try{await applyDesign(history.move(delta));persistDesign(captureDesign());}
  catch(error){history.index=previousIndex;$('#draft-status').textContent=error.message;}
  finally{draftApplying=false;$('.editor').inert=false;$('.editor-tabs').inert=false;$('.preview-column').inert=false;refreshHistoryButtons();}
}


function startWorker() {
  worker = new Worker(new URL('./font-worker.js?v=20261005-spacing2',import.meta.url), {type:'module'});
  worker.onmessage = ({data}) => {
    const request = pending.get(data.requestId);
    if (!request) return;
    clearTimeout(request.timeout); pending.delete(data.requestId);
    data.ok ? request.resolve(data) : request.reject(Object.assign(new Error(data.error),{code:data.code}));
  };
  worker.onerror = () => resetWorker('Die Schriftverarbeitung wurde unterbrochen. Bitte wähle die Schrift erneut.');
}
function resetWorker(message) {
  worker.terminate(); loaded.clear();
  for (const request of pending.values()) {clearTimeout(request.timeout);request.reject(new Error(message));}
  pending.clear(); startWorker();
}
function callWorker(data) {
  return new Promise((resolve,reject) => {
    const id = ++requestId;
    const timeout = setTimeout(() => resetWorker('Die Schrift konnte nicht rechtzeitig verarbeitet werden. Bitte wähle eine andere Schrift.'),12000);
    pending.set(id,{resolve,reject,timeout}); worker.postMessage({...data,requestId:id});
  });
}
function ensureFont() {
  const id = state.fontId;
  if (!loaded.has(id)) {
    const input = id.startsWith('upload-') ? {bytes:fontFile} : {url:new URL(`./assets/fonts/${id}.ttf`,import.meta.url).href};
    loaded.set(id,callWorker({type:'load',fontId:id,...input}).catch(error => {loaded.delete(id);throw error;}));
  }
  return loaded.get(id);
}
async function ensureLogo(){
  if(!state.logo)throw new Error('Bitte lade zuerst dein Logo hoch.');
  const id=state.logo.assetId,asset=await getDraftAsset(id,'logo');
  if(!asset.raster)asset.raster=await decodeLogoFile(asset.file);
  // Worker owns its bounded cache; repeat load so an evicted logo can be edited.
  return callWorker({type:'load-logo',logoId:id,mask:asset.raster.mask,width:asset.raster.width,height:asset.raster.height});
}
const cm = mm => new Intl.NumberFormat('de-DE',{minimumFractionDigits:0,maximumFractionDigits:1}).format(mm/10);
const inputCm = mm => String(Math.round(mm)/10);
const dimensions = size => `${cm(size.widthMm)} × ${cm(size.heightMm)} cm`;
function svg(tag,attributes={},text) {
  const element = document.createElementNS(SVG,tag);
  for(const [key,value] of Object.entries(attributes)) element.setAttribute(key,String(value));
  if(text !== undefined) element.textContent=text;
  return element;
}

// All price surfaces use this one version and the current worker geometry.
function renderPriceValue(element,price,quantity=1,{compact=false,unit=false}={}){
  element.replaceChildren();const amounts=priceAmounts(price,quantity);
  if(!amounts){element.textContent=priceLabel(price);return;}
  const before=document.createElement('del'),current=document.createElement('span');
  before.className='price-before';before.textContent=priceLabel({gross:amounts.regularGross});before.setAttribute('aria-label','Preis ohne Rabatt: '+before.textContent);
  current.className='price-current';current.textContent=priceLabel({gross:amounts.gross});element.append(before,current);
  if(!compact){const discount=document.createElement('span');discount.className='price-discount';discount.textContent=`−${INCLUDED_DISCOUNT_PERCENT} % Rabatt`;element.append(discount);}
  if(unit){const note=document.createElement('small');note.className='price-tax';note.textContent='Inkl. 19 % MwSt.';element.append(note);}
}
function priceDetail(price){
  if(price?.net==null)return price?.status==='pending'?'Maße und Preis werden aktualisiert.':price?.reasons?.join(' ')||'Bitte einen gültigen Entwurf erstellen.';
  return `Inkl. 19 % MwSt. · ${INCLUDED_DISCOUNT_PERCENT} % Rabatt bereits enthalten · `+price.components.map(c=>c.label+': '+priceLabel({gross:priceAmounts({net:c.net,components:[c]}).gross})).join(' · ');
}
function priceCorrectionHint(price){
  if(price?.net!=null)return 'Inkl. 19 % MwSt.';
  if(price?.status==='pending')return 'Maße und Preis werden aktualisiert.';
  if(price?.status==='unsupported-mode')return 'Logo-Entwürfe bleiben gespeichert. Wähle „Text gestalten“, um einen Schriftzug zu erstellen.';
  if(['invalid-size','below-minimum','above-maximum'].includes(price?.status))return 'Bitte die Maße anpassen.';
  if(price?.status==='missing-font')return 'Bitte die Schrift erneut auswählen.';
  if(price?.status==='invalid-mount')return price.reasons?.includes(TABLE_STAND_HEIGHT_MESSAGE)?'Tischständer nur bis 50 cm Außenhöhe.':'Bitte eine passende Montage wählen.';
  if(price?.status==='invalid-option')return 'Bitte die Ausstattung anpassen.';
  if(price?.status==='calculation-error')return 'Bitte erneut versuchen oder neu laden.';
  return 'Bitte den Text im Textfeld anpassen.';
}
function updatePagePurchase(){
  const dock=$('#page-purchase');if(!dock)return;
  renderPriceValue($('#page-purchase-price'),state.price);
  $('#page-purchase-design').textContent=!designRendering&&state.result?`${designName()} · ${dimensions(plateSize(state.result.size))}`:'Entwurf wird aktualisiert';
  $('#page-add-to-cart').disabled=designRendering||!state.result||!state.sizeValid||state.price?.status!=='calculated';
}
function invalidatePrice(pending=true){
  $('#share-design').disabled=true;$('#stage-ar').disabled=true;
  $('#config-ar-start').disabled=true;$('#ar-customer-design').replaceChildren();$('#config-ar-size').textContent=pending?'Dein Entwurf wird aktualisiert …':'Gib zuerst deinen Text ein.';
  state.price={status:pending?'pending':'unavailable',net:null,reasons:[]};
  invalidateFontQuotes();
  updatePagePurchase();
  const standPrice=$('[data-accessory-price="table-stand"]');if(standPrice)standPrice.textContent=pending?'Wird berechnet …':'Entwurf prüfen';
  const label=$('.design-price strong');if(label)label.textContent=pending?'Wird berechnet …':'Entwurf prüfen';
  if($('.design-price small'))$('.design-price small').textContent=pending?'Maße und Preis werden aktualisiert.':'Gültigen Entwurf erstellen';
  presetKey='';presetRevision++;
  for(const price of document.querySelectorAll('.preset-price')){price.textContent='Wird berechnet …';price.closest('button').disabled=true;}
}
function paintPrice(){
  if(!budgetSelecting)budgetAdvisor?.refreshContext();
  state.price=designRendering?{status:'pending',net:null}:state.result?priceForResult(state,state.result):state.price;
  renderPriceValue($('.design-price strong'),state.price);
  refreshFontQuotes();
  updatePagePurchase();
  $('.design-price small').textContent=priceCorrectionHint(state.price);
  $('.design-price').title=priceDetail(state.price);
  $('.design-price').dataset.priceVersion=PRICE_RULES.version;
  const standPrice=$('[data-accessory-price="table-stand"]');
  if(standPrice)standPrice.textContent=state.price.status==='pending'?'Wird berechnet …':(state.price.baseNet==null?'ab ':'')+priceLabel({net:mountingNet('table-stand',state.price.baseNet)})+' inkl. MwSt.';
  $('#share-design').disabled=designRendering||!state.result||!state.sizeValid;
  $('#stage-ar').disabled=designRendering||!state.result||!state.sizeValid;
  $('#stage-ar span').textContent=state.mount==='table-stand'?'3D ansehen':'An deiner Wand ansehen';
  $('#stage-ar').setAttribute('aria-controls',mobileAr||state.mount==='table-stand'?'ar-dialog':'ar-share-dialog');
  $('#stage-ar').title=state.mount==='table-stand'?'3D-Vorschau. Wand-AR ist für Tischständer noch nicht verfügbar.':'';
  const arEntry=$('#config-ar-start');arEntry.disabled=$('#stage-ar').disabled;
  arEntry.setAttribute('aria-controls',$('#stage-ar').getAttribute('aria-controls'));
  arEntry.querySelector('span').textContent=state.mount==='table-stand'?'In 3D ansehen':mobileAr?'An deiner Wand ansehen':'QR-Code für dein Schild öffnen';
  $('#config-ar-instructions').textContent=state.mount==='table-stand'?'Deinen Entwurf in der 3D-Vorschau von allen Seiten ansehen.':mobileAr?'Vorschau öffnen und die Wandansicht starten.':'QR-Code öffnen und mit deiner Handykamera scannen.';
  $('#config-ar-note').textContent=state.mount==='table-stand'?'Wand-AR ist für Tischständer noch nicht verfügbar.':'Ohne App-Installation auf unterstützten Smartphones.';
  paintAccessoryQuantities();
}
async function storedPrice(design){
  const key=PRICE_RULES.version+JSON.stringify(design);
  if(!storedPriceCache.has(key)){
    const calculation=(async()=>{
      if(design.mode==='logo')return {status:'unsupported-mode',net:null,reasons:['Bitte „Text gestalten“ für die automatische Preiskalkulation wählen.']};
      try{
        if(design.fontId.startsWith('upload-')){const asset=await getDraftAsset(design.fontId,'font');await callWorker({type:'load',fontId:design.fontId,bytes:asset.file});}
        else if(FONTS.includes(design.fontId))await callWorker({type:'load',fontId:design.fontId,url:new URL('./assets/fonts/'+design.fontId+'.ttf',import.meta.url).href});
        else throw new Error('Schrift fehlt.');
      }catch{throw Object.assign(new Error('Bitte den gespeicherten Entwurf öffnen und seine Schrift erneut auswählen oder hochladen.'),{code:'MISSING_FONT'});}
      const result=await callWorker({type:'render',fontId:design.fontId,text:design.text,alignment:design.alignment,lineHeight:design.lineHeight,axis:design.axis,valueMm:design.valueMm});
      return priceForResult(design,result);
    })().catch(error=>{storedPriceCache.delete(key);return {status:priceStatusForError(error),net:null,reasons:[errorMessage(error)]};});
    if(storedPriceCache.size>100)storedPriceCache.delete(storedPriceCache.keys().next().value);
    storedPriceCache.set(key,calculation);
  }
  return storedPriceCache.get(key);
}
async function displayStoredPrice(element,design,quantity=1,{cartLine=false}={}){
  element.textContent='Wird berechnet …';
  const price=await storedPrice(design);
  const unit=priceAmounts(price),total=priceAmounts(price,quantity);
  if(cartLine&&unit&&total){
    element.replaceChildren();
    const unitRow=document.createElement('div'),unitLabel=document.createElement('span'),unitValue=document.createElement('strong');
    unitRow.className='cart-unit-price';unitLabel.textContent='Einzelpreis';unitValue.textContent=priceLabel({gross:unit.gross});unitRow.append(unitLabel,unitValue);
    const calculation=document.createElement('div');calculation.className='cart-price-calculation';calculation.textContent=priceLabel({gross:unit.gross})+' × '+quantity+' '+(quantity===1?'Schild':'Schilder');
    const totalRow=document.createElement('div'),totalLabel=document.createElement('span'),totalValue=document.createElement('strong');
    totalRow.className='cart-line-total';totalLabel.textContent='Positionssumme';totalValue.textContent=priceLabel({gross:total.gross});totalRow.append(totalLabel,totalValue);
    const tax=document.createElement('small');tax.className='cart-line-tax';tax.textContent='Inkl. 19 % MwSt. · Rabatt bereits enthalten';
    element.append(unitRow,calculation,totalRow,tax);
  }else renderPriceValue(element,price,quantity,{unit:true});
  element.title=priceDetail(price);element.dataset.priceVersion=PRICE_RULES.version;
}
let cartPriceRevision=0;
async function refreshCartPrice(){
  const token=++cartPriceRevision,items=cartItems.map(item=>({design:item.design,quantity:item.quantity,previousPrice:item.snapshot?.price}));
  cartPricesValid=false;cartTotals=null;refreshCartButtons();
  const total=$('#cart-total-price');total.textContent='Wird berechnet …';
  $('#cart-subtotal').textContent='Wird berechnet …';$('#cart-delivery-fee').textContent='Wird berechnet …';
  $('#cart-tax-breakdown').hidden=true;
  const prices=await Promise.all(items.map(item=>storedPrice(item.design)));
  if(token!==cartPriceRevision)return;
  cartPricesValid=prices.length>0&&prices.every(p=>p.status==='calculated'&&Number.isFinite(p.net));
  if(!cartPricesValid){total.textContent='Entwürfe prüfen';$('#checkout-preparation-status').textContent=prices.some(p=>p.net==null)?'Bitte die markierten Entwürfe öffnen und korrigieren. Danach wird der Gesamtpreis neu berechnet.':'';}
  else{
    const amounts=prices.map((p,i)=>priceAmounts(p,items[i].quantity));
    const changed=prices.some((p,i)=>{const before=priceAmounts(items[i].previousPrice),after=priceAmounts(p);return before&&after&&Math.abs(before.gross-after.gross)>.01;});
    $('#checkout-preparation-status').textContent=changed?'Die Preise deiner gespeicherten Entwürfe wurden aktualisiert. Bitte prüfe Einzelpreise und Gesamtpreis.':'';
    cartTotals={signNet:Math.round(prices.reduce((sum,p,i)=>sum+p.baseNet*items[i].quantity,0)),subtotalGross:Math.round(amounts.reduce((sum,p)=>sum+p.gross,0)*100)/100};
  }
  refreshDeliverySummary();
  total.dataset.priceVersion=PRICE_RULES.version;
  refreshCartButtons();return cartPricesValid;
}
function clearResult(message='',error=false,status='invalid-text') {
  invalidatePrice(false);
  designRendering=false;lastBackingExampleResult=null;presetKey='';presetRevision++;
  if(!$('#freestanding-example img'))$('#freestanding-example').replaceChildren();
  $('#preview-size-fallback').hidden=true;$('#preview-handles').replaceChildren();previewBox=null;
  state.result=null;$('#stage-width').textContent='—';$('#stage-height').textContent='—';$('#design-summary-size').textContent='Maße prüfen';$('#save-design').disabled=true;$('#suggest-production-size').hidden=true;$('#production-note').textContent='Für die Fertigungsprüfung ist ein gültiger Entwurf erforderlich.';$('#size-plate-total').textContent='—';for(const b of document.querySelectorAll('[data-width-cm]'))b.setAttribute('aria-pressed','false');paintMount(); $('#preview-art').replaceChildren();$('#preview-dimensions').replaceChildren();
  state.price={status,net:null,reasons:[message]};renderPriceValue($('.design-price strong'),state.price);
  refreshFontQuotes();
  updatePagePurchase();$('.design-price small').textContent=priceCorrectionHint(state.price);$('.design-price').title=message;
  $('#minimum-size-note').textContent='';for(const b of document.querySelectorAll('[data-width-cm]')){b.disabled=true;const price=b.querySelector('.preset-price');if(price)price.textContent=priceLabel(state.price);}
  $('#summary-size').textContent='—';$('#choice-value-3').textContent='Größe prüfen';$('#choice-plate-size').textContent='—';$('#backing-size').textContent='—';
  $('#preview-state').textContent=error?priceLabel(state.price)+'. '+priceCorrectionHint(state.price):message;$('#preview-state').hidden=!message;$('#preview-state').classList.toggle('is-error',error);
  $('#sign-preview').setAttribute('aria-label',message || 'Keine Vorschau');
  clearArIllustration();
}
function priceStatusForError(error){
  if(error.priceStatus)return error.priceStatus;
  return ({EMPTY_TEXT:'empty',EMPTY_OUTLINE:'empty',TOO_MANY_LINES:'too-many-lines',UNSUPPORTED_GLYPH:'invalid-text',INVALID_TEXT:'invalid-text',INVALID_SIZE:'invalid-size',MISSING_FONT:'missing-font',INVALID_FONT:'missing-font'})[error.code]||'calculation-error';
}
function errorMessage(error) {
  if (error.code === 'EMPTY_TEXT') return 'Gib deinen Text ein, um die Vorschau zu sehen.';
  if (error.code === 'UNSUPPORTED_GLYPH') return error.message;
  if(!error.code&&!error.priceStatus)return 'Die Vorschau konnte nicht vollständig berechnet werden. Bitte erneut versuchen oder die Seite neu laden.';
  return error.message;
}
async function update(sizeNotice='') {
  // A direct change supersedes a pending text update; cancelled renders keep the fit request.
  clearTimeout(timer);
  const rev=++revision,fitLines=compactLineSpacing;designRendering=true;invalidatePrice();$('#save-design').disabled=true;
  const text=$('#sign-text').value;
  state.text=text;
  $('.line-height-control').hidden=false;state.hadMultipleLines=text.includes('\n');
  $('#line-height').value=state.lineHeight;$('#line-height').disabled=!text.includes('\n');
  $('#line-height-value').textContent=Math.round(state.lineHeight*100)+' %';$('#studio-line-spacing').textContent=Math.round(state.lineHeight*100)+' %';
  $('#line-height-help').textContent=text.includes('\n')?'Die Maße passen sich dem Zeilenabstand an.':'Ab zwei Textzeilen einstellbar.';
  scheduleDraft();
  syncColorWords();paintColorControls();
  paintRoom();
  $('#text-count').textContent=`${text.length} / 160`;
  $('#text-error').hidden=true;
  $('#size-error').hidden=true;
  
  
  updateFontSelection();updateChoices();
  if(!state.sizeValid) {clearResult('Bitte ein gültiges Maß eingeben.',true,'invalid-size');return;}
  if(state.mode==='text'&&!text.trim()) {clearResult('Gib deinen Text ein.',false,'empty');return;}
  if(state.mode==='text'&&text.length>160) {clearResult('Bitte verwende höchstens 160 Zeichen.',true);return;}
  if(state.mode==='logo'&&!state.logo){clearResult('Wähle „Text gestalten“, um einen Schriftzug zu erstellen.',false,'unsupported-mode');return;}
  $('#preview-state').textContent='Vorschau wird aktualisiert …';$('#preview-state').classList.remove('is-error');$('#preview-state').hidden=false;
  try {
    if(state.mode==='logo')await ensureLogo();else await ensureFont();
    if(rev!==revision)return;
    let lineHeight=state.lineHeight;
    const renderAt=valueMm=>callWorker(state.mode==='logo'?{type:'render-logo',logoId:state.logo.assetId,axis:state.axis,valueMm}:{type:'render',fontId:state.fontId,text,alignment:state.alignment,lineHeight,axis:state.axis,valueMm});
    let result=await renderAt(state.valueMm);
    const keepSpacing=spacingAnchor&&spacingAnchor.fontId===state.fontId&&spacingAnchor.content===spacingContent(text)&&spacingAnchor.lineHeight===lineHeight;
    if(keepSpacing){
      const tube=MANUFACTURING_PROFILE.tubeMm;
      state.valueMm=(state.valueMm-tube)*spacingAnchor.unitsPerEm/result.layout.unitsPerEm+tube;
      result=await renderAt(state.valueMm);if(rev!==revision)return;
    }
    if(fitLines&&state.mode==='text'&&text.includes('\n')){
      // Keep whole words untouched; only compare the actual neon routes between lines.
      const lineGap=()=>minimumTextGroupClearance({...result.layout,glyphs:result.layout.glyphs.map(g=>({...g,wordIndex:0}))}).distanceMm;
      const initialLineHeight=lineHeight;
      while(lineGap()!==null&&lineGap()<MANUFACTURING_PROFILE.tubeMm&&lineHeight<2){
        if(rev!==revision)return;
        lineHeight=Math.round((lineHeight+.05)*100)/100;
        result=await renderAt(state.valueMm);
      }
      if(rev!==revision)return;
      state.lineHeight=lineHeight;
      $('#line-height').value=state.lineHeight;$('#line-height-value').textContent=Math.round(state.lineHeight*100)+' %';$('#studio-line-spacing').textContent=Math.round(state.lineHeight*100)+' %';
      if(state.lineHeight>initialLineHeight)$('#line-height-help').textContent='Für diese Schrift auf '+Math.round(state.lineHeight*100)+' % angepasst, damit die Neonlinien zwischen den Zeilen genug Abstand haben.';
    }
    const requested=state.requestedOuter;
    if(requested){
      let actual=plateSize(result.size)[requested.axis+'Mm'];
      let low=actual<requested.valueMm?state.valueMm:10,high=actual<requested.valueMm?5000:state.valueMm;
      for(let i=0;i<13&&Math.abs(actual-requested.valueMm)>.5&&rev===revision;i++){
        const next=(low+high)/2,candidate=await renderAt(next);
        if(rev!==revision)return;
        const measured=plateSize(candidate.size)[requested.axis+'Mm'];
        if(measured<requested.valueMm)low=next;else high=next;
        if(Math.abs(measured-requested.valueMm)<Math.abs(actual-requested.valueMm)){state.valueMm=next;result=candidate;actual=measured;}
      }
    }
    if(rev!==revision)return;
    state.requestedOuter=null;
    if(state.mode==='text'){
      const range=sizeRangeForResult(state,result),outer=plateSize(result.size);
      if(range?.minimum.layoutConflict)throw Object.assign(new Error('Getrennte Wörter oder Zeilen überschneiden sich. Bitte mehr Leerzeichen oder einen größeren Zeilenabstand wählen.'),{priceStatus:'overlapping-text'});
      if(!range?.fits)throw Object.assign(new Error('Dieser Text passt mit seinen Details und Abständen nicht in 50–400 cm. Bitte Leerzeichen oder Leerzeilen reduzieren, den Text kürzen oder eine einfachere Schrift wählen.'),{priceStatus:layoutCorrectionStatus(state)});
      const tooSmall=outer.widthMm<range.minimum.widthMm-.1,tooLarge=outer.widthMm>range.maximum.widthMm+.01||outer.heightMm>range.maximum.heightMm+.01;
      if(tooLarge&&keepSpacing)throw Object.assign(new Error('Mit diesen Abständen wäre das Schild größer als 400 cm. Bitte weniger Leerzeichen verwenden. Die Buchstaben werden nicht automatisch verkleinert.'),{priceStatus:'layout-too-wide'});
      if((tooSmall||tooLarge)&&requested)throw Object.assign(new Error('Dieses Maß passt nicht zu Text und Rückplatte. Bitte ein Maß innerhalb der angezeigten Grenzen wählen.'),{priceStatus:'invalid-size'});
      if(tooSmall||tooLarge){
        state.axis='width';state.valueMm=tooSmall?range.minimum.designWidthMm:range.maximum.designWidthMm;
        result=await renderAt(state.valueMm);if(rev!==revision)return;
        const adjusted=plateSize(result.size);
        $('#size-error').textContent=(tooSmall?'Die Buchstaben wären zu klein. Automatisch auf das Mindestmaß vergrößert: ':'Die längste Seite ist auf 400 cm begrenzt. Automatisch angepasst: ')+dimensions(adjusted)+'.';$('#size-error').hidden=false;
        $('#text-error').textContent=$('#size-error').textContent;$('#text-error').hidden=false;
      }
    }
    compactLineSpacing=false;state.result=result;syncColorCharacters();
    if(typeof sizeNotice==='string'&&sizeNotice&&$('#size-error').hidden){$('#size-error').textContent=sizeNotice;$('#size-error').hidden=false;}
    syncOuterSize(result.size);
    $('#backing-size').textContent=dimensions(result.size.backing);
    fitTextField();
    $('#studio-selected-font').textContent=state.font;
    $('#summary-font').textContent=state.mode==='logo'?'Eigenes Logo':state.font;
    $('#preview-state').hidden=true;
    
    designRendering=false;paint();$('#save-design').disabled=false;
  } catch(error) {
    if(rev!==revision)return;
    const message=errorMessage(error);designRendering=false;
    clearResult(message,true,priceStatusForError(error));$('#text-error').textContent=message;$('#text-error').hidden=false;
  }
}
// Preview contour, in physical mm. Manufacturing still requires a separate check.
const CONTOUR_MARGIN_MM=MANUFACTURING_PROFILE.contourMarginMm;
const contourCache=new WeakMap();
function backingContour(result){
  if(!contourCache.has(result))contourCache.set(result,buildBackingContour(result,CONTOUR_MARGIN_MM));
  return contourCache.get(result);
}
function contourTopAt(path,x){
  const points=[...path.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
  let top=Infinity;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    if(x<Math.min(a[0],b[0]) || x>Math.max(a[0],b[0]))continue;
    if(a[0]===b[0])top=Math.min(top,a[1],b[1]);
    else top=Math.min(top,a[1]+(x-a[0])/(b[0]-a[0])*(b[1]-a[1]));
  }
  return Number.isFinite(top)?top:0;
}
function basePlateSize(size) {
  if(state.backing==='contour')return {widthMm:size.exact.design.widthMm+2*CONTOUR_MARGIN_MM,heightMm:size.exact.design.heightMm+2*CONTOUR_MARGIN_MM};
  if(state.backing==='freestanding')return {...size.exact.design};
  const backing=size.exact.backing;
  if(state.backing!=='square')return backing;
  const extra=state.mount==='table-stand'?STAND_SUPPORT_MM:0;
  const side=Math.max(backing.widthMm,backing.heightMm+extra);
  return {widthMm:side,heightMm:side-extra};
}
function plateSize(size){const base=basePlateSize(size);return {...base,heightMm:base.heightMm+(state.mount==='table-stand'?STAND_SUPPORT_MM:0)};}
function syncOuterSize(size){
  const outer=plateSize(size);
  const range=sizeRangeForResult(state,state.result),minimum=range?.minimum;
  const minimumWidth=(minimum?.widthMm||500)/10;
  const minimumHeight=(state.backing==='rectangle'||state.backing==='square'?40:state.backing==='contour'?30:10)+(state.mount==='table-stand'?STAND_SUPPORT_MM:0);
  $('#sign-width').min=String(minimumWidth);$('#width-slider').min=String(minimumWidth);
  $('#sign-width').max=String(Math.round(range?.maximum.widthMm||4000)/10);$('#width-slider').max=$('#sign-width').max;$('#sign-height').max=String(Math.round(range?.maximum.heightMm||4000)/10);
  $('#width-slider-max').textContent=$('#sign-width').max+' cm';
  $('#width-slider-min').textContent=`${minimumWidth.toLocaleString('de-DE')} cm`;
  $('#sign-height').min=String(Math.round(minimum?.heightMm||minimumHeight)/10);
  $('#minimum-size-note').textContent=range&&!range.fits?'Bitte Abstände reduzieren oder eine einfachere Schrift wählen.':'Für deinen Text: mindestens '+minimumWidth.toLocaleString('de-DE')+' cm breit · 8 mm Neon.';
  $('#sign-width').value=inputCm(outer.widthMm);$('#sign-height').value=inputCm(outer.heightMm);
  $('#width-slider').value=String(outer.widthMm/10);
  $('#width-slider').setAttribute('aria-valuetext',`${cm(outer.widthMm)} Zentimeter gesamte Außenbreite`);
  $('#summary-size').textContent=dimensions(outer);
  $('#stage-width').textContent=cm(outer.widthMm)+' cm';$('#stage-height').textContent=cm(outer.heightMm)+' cm';
  $('#design-summary-size').textContent=dimensions(outer);$('#design-summary-look').textContent=(state.mode==='logo'?'Eigenes Logo':state.font)+' · '+colorSummary();
}
function innerSizeForOuter(axis,outerMm){
  const mountExtra=state.mount==='table-stand'?STAND_SUPPORT_MM:0;
  if(state.backing==='square'){
    const ratio=state.result?.size.exact.design.heightMm/state.result?.size.exact.design.widthMm||.25;
    const width=Math.min(outerMm-30,(outerMm-30-mountExtra)/ratio);
    return axis==='width'?width:width*ratio;
  }
  const margin=state.backing==='rectangle'?30:state.backing==='contour'?20:0;
  return outerMm-margin-(axis==='height'?mountExtra:0);
}
function chooseOuterSize(axis,outerMm){
  const range=sizeRangeForResult(state,state.result),minimum=range?.minimum;
  const minimumMm=axis==='width'?(minimum?.widthMm||500):(minimum?.heightMm||10);
  const maximumMm=axis==='width'?(range?.maximum.widthMm||4000):(range?.maximum.heightMm||4000);
  const belowMinimum=Number.isFinite(outerMm)&&outerMm<minimumMm;
  const aboveMaximum=Number.isFinite(outerMm)&&outerMm>maximumMm;
  if(belowMinimum||aboveMaximum||!Number.isFinite(outerMm)||outerMm<=0){
    state.sizeValid=false;state.requestedOuter=null;revision++;clearTimeout(timer);
    const message=belowMinimum?`Für diesen Entwurf mindestens ${cm(minimumMm)} cm ${axis==='width'?'Breite':'Höhe'}. Bitte ein größeres Maß eingeben.`:aboveMaximum?`Für diesen Entwurf höchstens ${cm(maximumMm)} cm ${axis==='width'?'Breite':'Höhe'}. Die längste Seite darf 400 cm nicht überschreiten.`:'Bitte eine positive Zahl für das Maß eingeben.';
    $('#size-error').textContent=message;$('#size-error').hidden=false;clearResult(message,true,'invalid-size');return false;
  }
  const inner=innerSizeForOuter(axis,outerMm);
  state.sizeValid=true;spacingAnchor=null;state.axis=axis;state.valueMm=inner;state.requestedOuter={axis,valueMm:outerMm};$('#size-error').hidden=true;clearTimeout(timer);update();return true;
}
function railPath(result){return buildFreestandingSupports(result,{logo:state.mode==='logo'}).path;}
const standContourCache=new WeakMap();
function plateContour(result){
  const base=basePlateSize(result.size);
  if(state.backing==='freestanding')return railPath(result);
  const path=state.backing==='contour'?backingContour(result):`M0 0L${base.widthMm} 0L${base.widthMm} ${base.heightMm}L0 ${base.heightMm}Z`;
  if(state.mount!=='table-stand')return path;
  if(!standContourCache.has(result))standContourCache.set(result,new Map());
  const entries=standContourCache.get(result);
  if(!entries.has(state.backing))entries.set(state.backing,tabletopContour(path,base.widthMm,base.heightMm,{supportMm:STAND_SUPPORT_MM,slotInsetMm:MANUFACTURING_PROFILE.standInsetMm,slotWidthMm:MANUFACTURING_PROFILE.acrylicThicknessMm+MANUFACTURING_PROFILE.standSlotClearanceMm,slotDepthMm:MANUFACTURING_PROFILE.standSlotDepthMm}));
  return entries.get(state.backing);
}
function standFits(){return state.backing!=='freestanding'&&!!state.result&&evaluatePlateManufacturing({...plateSize(state.result.size),mount:'table-stand',marginMm:CONTOUR_MARGIN_MM}).standFits;}
function standSelectionTooTall(){
  if(!state.result)return false;
  const size=state.result.size,outer=plateSize(size);
  let height=outer.heightMm;
  if(state.axis==='width'&&state.mount!=='table-stand'){
    const candidate=pricingPlateSize(size,{...state,mount:'table-stand',accessoryQuantities:{...state.accessoryQuantities,'table-stand':Math.max(1,state.accessoryQuantities['table-stand'])},backing:state.backing==='freestanding'?'contour':state.backing});
    const d=size.exact.design,tube=MANUFACTURING_PROFILE.tubeMm;
    // Mount selection preserves the chosen outer axis, including an automatic
    // freestanding-to-contour change. Evaluate that resulting height, not an
    // unscaled plate with an extra margin added on top.
    height=state.backing==='square'?outer.widthMm:(d.heightMm-tube)*(d.widthMm-(candidate.widthMm-outer.widthMm)-tube)/(d.widthMm-tube)+tube+candidate.heightMm-d.heightMm;
  }
  return height>MANUFACTURING_PROFILE.standMaximumHeightMm+1e-7;
}
function adhesiveOver100(){return !!state.result&&Math.max(plateSize(state.result.size).widthMm,plateSize(state.result.size).heightMm)>=1000;}
function paintMount(){
  const invalidStand=state.mount==='table-stand'&&!standFits();
  const standTooTall=standSelectionTooTall();
  const invalidHanging=state.mount==='hanging-kit'&&state.backing==='freestanding';
  const autoContour=state.autoContourNotice&&['adhesive-kit','table-stand'].includes(state.mount);
  $('#choice-value-5').textContent=MOUNTS[state.mount].name;
  $('#mount-description').textContent=MOUNTS[state.mount].description;
  $('#mount-warning').hidden=state.mount!=='adhesive-kit'&&!invalidStand&&!invalidHanging&&!autoContour;
  $('#mount-warning').textContent=(autoContour?'Rückplatte wurde auf Formzuschnitt geändert. ':'')+(state.mount==='adhesive-kit'?(adhesiveOver100()?'Ab 100 cm keine dauerhafte Lösung: Klebestreifen nur vorübergehend und nach Prüfung des Untergrunds verwenden.':'Klebestreifen nur vorübergehend und auf geeignetem Untergrund verwenden.'):invalidHanging?'Freigestellte Schriftzüge können nicht mit dem Abhängeset montiert werden. Wähle Formzuschnitt oder eine rechteckige Rückplatte.':invalidStand?'Die Rückplatte ist zu schmal für die beiden Steckfüße. Bitte wähle ein größeres Schild oder eine andere Montage.':'');
  if(standTooTall){
    const warning=$('#mount-warning'),otherWarning=state.mount!=='table-stand'&&!warning.hidden?warning.textContent+' ':'';
    warning.hidden=false;warning.textContent=otherWarning+TABLE_STAND_HEIGHT_MESSAGE+' ';
    const phone=document.querySelector('footer a[href^="tel:"]');
    if(phone){const call=document.createElement('a');call.href=phone.href;call.textContent=phone.textContent;warning.append(call);}
  }
  for(const button of document.querySelectorAll('[data-mount]')){
    button.closest('.accessory-item').classList.toggle('is-selected',state.accessoryQuantities[button.dataset.mount]>0);
    button.disabled=button.dataset.mount==='hanging-kit'&&state.backing==='freestanding';
    if(button.dataset.mount==='adhesive-kit')button.title='Bei freigestellter Schrift wird Formzuschnitt gewählt; ab 100 cm nur vorübergehend';
    if(button.dataset.mount==='table-stand'){
      button.setAttribute('aria-disabled',String(standTooTall));
      if(standTooTall)$('[data-accessory-price="table-stand"]').textContent='Nur bis 50 cm Außenhöhe';
      button.title=standTooTall?TABLE_STAND_HEIGHT_MESSAGE:'Bis 50 cm Außenhöhe. Bei freigestellter Schrift wird Formzuschnitt gewählt';
      if(standTooTall)button.setAttribute('aria-describedby','mount-warning');else button.removeAttribute('aria-describedby');
    }
  }
  paintAccessoryQuantities();
}
function selectMount(mount){
  if(!MOUNTS[mount]||mount==='none')return;
  if(mount===state.mount){paint();return;}
  if(mount==='hanging-kit'&&state.backing==='freestanding')return;
  if(mount==='table-stand'&&standSelectionTooTall()){paintMount();return;}
  const outer=state.result?plateSize(state.result.size):null;
  state.autoContourNotice=state.backing==='freestanding'&&['adhesive-kit','table-stand'].includes(mount);
  if(state.autoContourNotice)state.backing='contour';
  if(mount==='table-stand'&&state.mount!=='table-stand'){state.previousRoom=state.room;state.room='tabletop';state.scene='wall';}
  if(mount!=='table-stand'&&state.mount==='table-stand')state.room=state.previousRoom;
  state.mount=mount;
  if(['wall-mount','adhesive-kit'].includes(mount)&&state.room==='shop')state.room='reception';
  if(outer)chooseOuterSize(state.axis,outer[state.axis+'Mm']);else paint();
}
function changeAccessoryQuantity(key,quantity){
 const minimum=['wall-mount','premium-white','dimmer'].includes(key)?1:0;
 if(!Number.isInteger(quantity)||quantity<minimum||quantity>99)return false;
 if(key==='table-stand'&&quantity>0&&standSelectionTooTall()){paintMount();return false;}
 if(key==='hanging-kit'&&quantity>0&&state.backing==='freestanding')return false;
 state.accessoryQuantities[key]=quantity;
 if(['hanging-kit','adhesive-kit','table-stand'].includes(key)){
  const mount=state.accessoryQuantities['table-stand']>0?'table-stand':quantity>0?key:state.mount===key?Object.keys(MOUNTS).find(id=>id!=='wall-mount'&&state.accessoryQuantities[id]>0)||'wall-mount':state.mount;
  selectMount(mount);
 }else{state.dimmer=state.accessoryQuantities.dimmer>0;state.extraCable2m=state.accessoryQuantities.extraCable2m>0;paint();}
 return true;
}
// Product photos, included quantities and paid additions are separate controls.
const accessoryRows=new Map();
const accessoryPhoto=$('#accessory-photo-dialog');
let accessoryPhotoTrigger=null;
accessoryPhoto.querySelector('[data-close-accessory-photo]').addEventListener('click',()=>accessoryPhoto.close());
accessoryPhoto.addEventListener('close',()=>accessoryPhotoTrigger?.focus({preventScroll:true}));
const includedAccessoryKeys=['wall-mount','dimmer','premium-white'];
const accessoryProducts=[
 {id:'wall-mount',...MOUNTS['wall-mount'],extraNet:PRICE_RULES.extras.additionalWallMountNet},
 {id:'dimmer',name:'Dimmer mit Fernbedienung',image:'remote-dimmer.webp',description:'Mit Fernbedienung, Funk und Bluetooth',extraNet:PRICE_RULES.extras.dimmer},
 {id:'premium-white',name:'Premium-Netzteil',image:'power-white.webp',description:'NEONTRIP Premium-Netzteil',extraNet:PRICE_RULES.extras.additionalPremiumNet},
 ...['hanging-kit','adhesive-kit','table-stand'].map(id=>({id,...MOUNTS[id]}))
];
for(const product of accessoryProducts){
 const key=product.id,included=includedAccessoryKeys.includes(key);
 const row=document.createElement('article');row.className='accessory-item';row.dataset.accessory=key;
 const photo=document.createElement('button');photo.type='button';photo.className='accessory-photo';
 photo.setAttribute('aria-label',product.name+' – Foto vergrößern');photo.setAttribute('aria-haspopup','dialog');photo.setAttribute('aria-controls','accessory-photo-dialog');
 const img=document.createElement('img');img.src='./assets/mounts/'+product.image;img.alt=product.description;img.width=96;img.height=96;
 photo.append(img);photo.insertAdjacentHTML('beforeend','<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>');
 photo.addEventListener('click',()=>{accessoryPhotoTrigger=photo;accessoryPhoto.querySelector('img').src=img.src;accessoryPhoto.querySelector('img').alt=product.description;$('#accessory-photo-title').textContent=product.name;accessoryPhoto.showModal();});
 const copy=document.createElement('div');copy.className='accessory-copy';
 const name=document.createElement('h4');name.textContent=product.name;copy.append(name);
 const price=document.createElement('p');price.className='accessory-price';price.dataset.accessoryPrice=key;
 if(included){const badge=document.createElement('span');badge.className='accessory-included-badge';badge.textContent='1 inklusive';copy.append(badge);price.textContent='Weitere: '+priceLabel({net:product.extraNet})+' / Stück';}
 else price.textContent=(key==='table-stand'?'ab ':'')+priceLabel({net:mountingNet(key)})+' inkl. MwSt.';
 copy.append(price);
 const actions=document.createElement('div');actions.className='accessory-actions';
 const add=document.createElement('button');add.type='button';add.className='accessory-add';add.textContent=included?'+ Weitere':'Hinzufügen';
 add.setAttribute('aria-label',product.name+' – '+(included?'weiteres Exemplar hinzufügen':'hinzufügen'));
 if(!included)add.dataset.mount=key;
 const stepper=document.createElement('div');stepper.className='accessory-stepper';stepper.hidden=true;
 const minus=document.createElement('button'),plus=document.createElement('button'),amount=document.createElement('output');
 minus.type=plus.type='button';minus.textContent='−';plus.textContent='+';
 minus.setAttribute('aria-label',product.name+' – ein Exemplar weniger');plus.setAttribute('aria-label',product.name+' – ein Exemplar mehr');
 amount.setAttribute('aria-live','polite');
 const extra=document.createElement('small');extra.textContent=included?'zusätzlich':'Stück';
 stepper.append(minus,amount,plus,extra);actions.append(add,stepper);row.append(photo,copy,actions);
 (included?$('#included-accessories'):$('#mount-options')).append(row);
 accessoryRows.set(key,{row,add,stepper,minus,plus,amount,included});
 const change=delta=>{
  const next=state.accessoryQuantities[key]+delta;
  if(!changeAccessoryQuantity(key,next))return;
  const shown=next-(included?1:0);
  (shown===0?add:delta>0?(next===99?minus:plus):minus).focus({preventScroll:true});
 };
 add.addEventListener('click',()=>change(1));minus.addEventListener('click',()=>change(-1));plus.addEventListener('click',()=>change(1));
}
function paintAccessoryQuantities(){
 for(const [key,ui] of accessoryRows){
  const quantity=state.accessoryQuantities[key],extra=quantity-(ui.included?1:0);
  ui.add.hidden=extra>0;ui.stepper.hidden=extra===0;ui.amount.value=String(extra);ui.amount.textContent=String(extra);
  ui.row.classList.toggle('is-selected',!ui.included&&quantity>0);
  ui.minus.disabled=extra<=0;
  ui.plus.disabled=quantity>=99||ui.add.disabled||ui.add.getAttribute('aria-disabled')==='true';
 }
}
function hasRetiredCable(design){return design?.extraCable2m===true||Number(design?.accessoryQuantities?.extraCable2m)>0;}
const retiredCableMessage='Zusätzliches Kabel wird nicht mehr angeboten und wurde aus diesem Entwurf entfernt. Die enthaltenen 2 m Anschlusskabel bleiben dabei. Der Preis wird neu berechnet.';

// Word identity follows unchanged text (including moved words); new words use
// the shared base color. Line/word positions match the existing font layout.
function syncColorWords(){
  if(state.mode==='logo'){
    state.words=[{text:state.logo?.name||'Dein Logo',lineIndex:0,wordIndex:0,key:'logo'}];state.colorTarget='all';$('#color-targets').replaceChildren();return;
  }
  const occurrences=new Map(),words=[];
  for(const [lineIndex,line] of state.text.replace(/\r\n?/g,'\n').split('\n').entries()){
    const tokens=line.match(/[^\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f]+/gu)||[];
    tokens.forEach((text,wordIndex)=>{
      const occurrence=occurrences.get(text)||0;occurrences.set(text,occurrence+1);
      words.push({text,lineIndex,wordIndex,key:JSON.stringify([text,occurrence])});
    });
  }
  const keys=new Set(words.map(word=>word.key));
  for(const key of state.wordColors.keys())if(!keys.has(key))state.wordColors.delete(key);
  if(state.colorTarget!=='all'&&!state.colorTarget.startsWith('char:')&&!state.colorTarget.startsWith('line:')&&!keys.has(state.colorTarget))state.colorTarget='all';
  state.words=words;
  if(state.colorTarget.startsWith('line:')&&!colorLines().some(line=>line.key===state.colorTarget))state.colorTarget='all';
  renderColorTargets();
}
function syncColorCharacters(){
  state.characters=[];
  if(state.mode==='logo'){renderColorTargets();return;}
  const lines=state.text.replace(/\r\n?/g,'\n').split('\n'),seen=new Set(),occurrences=new Map();
  const lineKeys=lines.map(line=>{const occurrence=occurrences.get(line)||0;occurrences.set(line,occurrence+1);return [line,occurrence];});
  for(const glyph of state.result?.layout.glyphs||[]){
    const charIndex=glyph.charIndex??0,charText=glyph.charText||lines[glyph.lineIndex]||'',key='char:'+JSON.stringify([...lineKeys[glyph.lineIndex],charIndex,charText]);
    glyph.colorKey=key;
    if(seen.has(key))continue;seen.add(key);
    state.characters.push({key,text:charText,lineIndex:glyph.lineIndex,wordIndex:glyph.wordIndex,charIndex,charLength:glyph.charLength||Array.from(charText).length,mapping:glyph.charMapping});
  }
  for(const key of state.charColors.keys())if(!seen.has(key))state.charColors.delete(key);
  if(state.colorTarget.startsWith('char:')&&!seen.has(state.colorTarget))state.colorTarget='all';
  renderColorTargets();
}
const wordColor=word=>state.mode==='logo'?state.color:state.wordColors.get(word.key)||state.color;
function characterColor(character){const word=state.words.find(w=>w.lineIndex===character.lineIndex&&w.wordIndex===character.wordIndex);return state.charColors.get(character.key)||(word?wordColor(word):state.color);}
function glyphColor(glyph){if(state.mode==='logo')return state.color;const word=state.words.find(w=>w.lineIndex===glyph.lineIndex&&w.wordIndex===glyph.wordIndex);return state.charColors.get(glyph.colorKey)||(word?wordColor(word):state.color);}
// Line selection is only an editing convenience; persist the existing word/letter colours.
function colorLines(){return state.text.replace(/\r\n?/g,'\n').split('\n').map((text,lineIndex)=>({key:'line:'+lineIndex,text:text.trim(),lineIndex})).filter(line=>line.text);}
function targetColors(target){
  if(!target)return usedColors();
  if(target.charIndex!==undefined)return [characterColor(target)];
  const glyphs=(state.result?.layout.glyphs||[]).filter(g=>g.lineIndex===target.lineIndex&&(target.wordIndex===undefined||g.wordIndex===target.wordIndex));
  const fallback=target.wordIndex!==undefined?[wordColor(target)]:state.words.filter(w=>w.lineIndex===target.lineIndex).map(wordColor);
  return [...new Map((glyphs.length?glyphs.map(glyphColor):fallback).map(c=>[c.id,c])).values()];
}
function renderColorTargets(){
  const root=$('#color-targets');root.replaceChildren();
  const targets=state.mode==='logo'?[]:state.colorScope==='letters'?state.characters:state.colorScope==='lines'?colorLines():state.words;
  for(const target of [null,...targets]){
    const button=document.createElement('button');button.type='button';button.className='color-target';button.dataset.colorTarget=target?.key||'all';
    button.textContent=target?(state.colorScope==='lines'?`Zeile ${target.lineIndex+1}: ${target.text}`:target.text):(state.mode==='logo'?'Ganzes Logo':'Alles');
    button.addEventListener('click',()=>{state.colorTarget=button.dataset.colorTarget;paint();});root.append(button);
  }
  const select=$('#mobile-color-target');select.replaceChildren();
  const all=document.createElement('option');all.value='all';all.textContent=state.mode==='logo'?'Ganzes Logo':'Ganzer Schriftzug';select.append(all);
  for(const [label,items] of [['Zeilen',colorLines()],['Wörter',state.words],['Buchstaben',state.characters]]){if(state.mode==='logo'||!items?.length)continue;const group=document.createElement('optgroup');group.label=label;for(const item of items){const option=document.createElement('option');option.value=item.key;option.textContent=`Zeile ${item.lineIndex+1}${label==='Zeilen'?'':` · ${label==='Wörter'?`Wort ${item.wordIndex+1}`:item.mapping==='line-fallback'?'Ganze Zeile':`Zeichen ${item.charIndex+1}`}`}: ${item.text}`;group.append(option);}select.append(group);}
  select.value=state.colorTarget;
  root.classList.toggle('is-letters',state.colorScope==='letters');
}
function usedColors(){return [...new Map((state.mode==='logo'?[state.color]:state.result?.layout.glyphs.length?state.result.layout.glyphs.map(glyphColor):state.words.length?state.words.map(wordColor):[state.color]).map(color=>[color.id,color])).values()];}
function colorSummary(){if(state.lightMode==='rgb')return 'RGB-Farbwechsel';const colors=usedColors();return colors.length===1?colors[0].name:`${colors.length} Farben`;}
let colorGalleryLayout=null, colorCurrentLayout=null, colorGalleryTarget=null, colorCurrentTarget=null;
function colorExampleOptions(prefix){
  let layout=state.result?.layout,text=state.mode==='logo'?'Dein Logo':state.text;
  const character=state.characters.find(c=>c.key===state.colorTarget),word=state.words.find(w=>w.key===state.colorTarget),line=colorLines().find(l=>l.key===state.colorTarget),target=character||word||line;
  if(layout&&target){
    const glyphs=layout.glyphs.filter(g=>character?g.colorKey===character.key:line?g.lineIndex===line.lineIndex:g.lineIndex===word.lineIndex&&g.wordIndex===word.wordIndex);
    if(glyphs.length){
      const x=Math.min(...glyphs.map(g=>g.bounds.minX)),y=Math.min(...glyphs.map(g=>g.bounds.minY));
      layout={...layout,glyphs,bounds:{x,y,width:Math.max(...glyphs.map(g=>g.bounds.maxX))-x,height:Math.max(...glyphs.map(g=>g.bounds.maxY))-y}};text=target.text;
    }
  }
  return {prefix,layout,text,font:state.mode==='logo'?'Logo':state.font};
}
function refreshColorExamples(){
  if(!state.result||(colorGalleryLayout===state.result.layout&&colorGalleryTarget===state.colorTarget))return;
  for(const color of AVAILABLE_COLORS){const card=$('#color-palette [data-color="'+color.id+'"]');card.querySelector('svg').replaceWith(createColorExample(color,colorExampleOptions('color-card-'+color.id)));}
  const rgbExample=createColorExample(COLORS.find(c=>c.id==='red'),colorExampleOptions('rgb-gallery-example'));rgbExample.classList.add('rgb-example-art');$('#rgb-example').replaceChildren(rgbExample);
  colorGalleryLayout=state.result.layout;colorGalleryTarget=state.colorTarget;
}
function paintColorControls(){
  const character=state.characters.find(c=>c.key===state.colorTarget),word=state.words.find(w=>w.key===state.colorTarget),line=colorLines().find(l=>l.key===state.colorTarget),target=character||word||line,colors=usedColors(),rgb=state.lightMode==='rgb';
  const selection=targetColors(target),selected=selection.length===1?selection[0]:null;
  $('#studio-selected-color').textContent=rgb?'RGB':colors.length===1?colors[0].name:`${colors.length} Farben`;
  $('#studio-all-colors').firstChild.textContent=rgb?'RGB-Vorschau ':colors.length>1?'Farben bearbeiten ':'Mehrere Farben ';
  $('#studio-all-colors').setAttribute('aria-label',rgb?'RGB-Farbwechsel ansehen':'Zeilen, Wörter oder Buchstaben einzeln färben');
  $('#look-color-name').textContent=rgb?'RGB-Farbwechsel':colors.length===1?colors[0].name:'Mehrfarbig';
  $('#look-color-off').textContent=rgb?'Dynamischer Farbwechsel':colors.length===1?(colors[0].whiteOff?'Ausgeschaltet weiß':'Ausgeschaltet farbig'):'Individuelle Farben';
  $('#look-color-chip').style.background=rgb?'linear-gradient(135deg,#ff3984,#ffcc35,#54dbaf,#7050fc)':colors.length===1?colors[0].color:`linear-gradient(135deg,${colors.map(c=>c.color).join(',')})`;
  $('#summary-color').textContent=colorSummary();$('#color-name').textContent=rgb?'RGB':selected?selected.name:'Mehrfarbig';
  $('#open-color-gallery').hidden=rgb;
  $('#color-detail-options').hidden=state.mode==='logo'||rgb;
  $('#current-color-label').textContent=selected?.name||'Mehrfarbig';
  $('#color-gallery-selection').textContent=rgb?'RGB-Farbwechsel':selected?.name||'Mehrfarbig';
  $('#color-gallery-context').textContent=target?`Für „${target.text}“ · 17 Farben`:state.mode==='logo'?'Für dein Logo · 17 Farben':'Für deinen ganzen Schriftzug · 17 Farben';
  const example=$('#current-color-example'),exampleColor=selected||state.color;
  if(example.getClientRects().length&&(example.dataset.colorId!==exampleColor.id||colorCurrentLayout!==state.result?.layout||colorCurrentTarget!==state.colorTarget)){example.replaceChildren(createColorExample(exampleColor,colorExampleOptions('color-current')));example.dataset.colorId=exampleColor.id;colorCurrentLayout=state.result?.layout;colorCurrentTarget=state.colorTarget;}
  if($('#color-gallery').open)refreshColorExamples();
  $('#mobile-color-target').value=state.colorTarget;
  $('#color-scope').textContent=target?`Farbe für „${target.text}“`:'Farbe für den ganzen Schriftzug';
  $('#color-note').textContent=target?(selected?`„${target.text}“: ausgeschaltet ${selected.off==='#F4F4F4'?'weiß':selected.name}.`:'Die neue Farbe ersetzt die bisherigen Farben in dieser Auswahl.'):'Eine neue Gesamtfarbe ersetzt alle Wort- und Buchstabenfarben.';
  if(state.mode==='logo'){$('#color-scope').textContent='Leuchtfarbe für dein Logo';$('#color-note').textContent='Die gewählte LED-Farbe gilt für den gesamten Logo-Linienentwurf.';}
  $('.word-color-help').hidden=state.mode==='logo'||rgb;$('#color-scope-switch').hidden=state.mode==='logo'||rgb;
  $('#color-targets').hidden=rgb;$('#color-palette').hidden=rgb;$('#color-scope').hidden=rgb;$('#color-note').hidden=rgb;$('#rgb-settings').hidden=!rgb;
  $('#rgb-preview-toggle').textContent=rgbPaused?'Farbwechsel abspielen':'Farbwechsel pausieren';$('#rgb-preview-toggle').setAttribute('aria-pressed',String(!rgbPaused));
  $('#rgb-settings').classList.toggle('rgb-paused',rgbPaused);$('#preview-stage').classList.toggle('rgb-paused',rgbPaused);$('#preview-stage').classList.toggle('rgb-play-enabled',!rgbPaused);
  for(const b of document.querySelectorAll('[data-light-mode]')){b.setAttribute('aria-pressed',b.dataset.lightMode===state.lightMode);b.disabled=b.dataset.lightMode==='rgb'&&state.outdoor;b.setAttribute('aria-describedby',b.closest('.studio-colors')?'studio-rgb-note':'rgb-outdoor-note');}
  $('#rgb-outdoor-note').hidden=!state.outdoor;inlineRgbNote.hidden=!state.outdoor;$('#usage-note').hidden=!state.outdoor;
  $('#delivery-production-note').hidden=minimumDeliveryBusinessDays([state])<7;
  $('#delivery-production-note').textContent=DELIVERY_RESTRICTION_NOTE;
  refreshWishDelivery(state);
  for(const b of document.querySelectorAll('[data-usage]'))b.setAttribute('aria-pressed',String((b.dataset.usage==='outdoor')===state.outdoor));
  $('#retired-color-note').hidden=!usedColors().some(color=>color.id==='tropical_blue');
  for(const b of document.querySelectorAll('[data-color-scope]'))b.setAttribute('aria-pressed',b.dataset.colorScope===state.colorScope);
  for(const b of document.querySelectorAll('[data-color]')){
    const swatchColor=b.closest('.studio-palette')?(colors.length===1?colors[0]:null):selected;
    b.setAttribute('aria-pressed',!rgb&&b.dataset.color===swatchColor?.id);
  }
  for(const button of document.querySelectorAll('[data-color-target]')){
    const item=state.characters.find(c=>c.key===button.dataset.colorTarget)||state.words.find(w=>w.key===button.dataset.colorTarget)||colorLines().find(l=>l.key===button.dataset.colorTarget);
    button.setAttribute('aria-pressed',button.dataset.colorTarget===state.colorTarget);
    if(item){const colors=targetColors(item),label=colors.length===1?colors[0].name:'Mehrfarbig';button.style.setProperty('--word-color',colors.length===1?colors[0].color:`linear-gradient(135deg,${colors.map(c=>c.color).join(',')})`);button.setAttribute('aria-label',`${item.text} – ${label}, Zeile ${item.lineIndex+1}${item.charIndex!==undefined?', Zeichen '+(item.charIndex+1):item.wordIndex!==undefined?', Wort '+(item.wordIndex+1):''}`);}
  }
  $('#character-mapping-note').hidden=rgb||state.colorScope!=='letters'||!state.characters.some(c=>c.mapping==='line-fallback'||c.charLength>1);
}
for(const button of document.querySelectorAll('[data-color-scope]'))button.addEventListener('click',()=>{state.colorScope=button.dataset.colorScope;state.colorTarget='all';renderColorTargets();paint();});
for(const button of document.querySelectorAll('[data-light-mode]'))button.addEventListener('click',()=>{if(state.outdoor&&button.dataset.lightMode==='rgb')return;state.lightMode=button.dataset.lightMode;paint();});
for(const button of document.querySelectorAll('[data-usage]'))button.addEventListener('click',()=>{state.outdoor=button.dataset.usage==='outdoor';state.scene='wall';if(state.outdoor&&state.lightMode==='rgb')state.lightMode='static';paint();});
$('#rgb-preview-toggle').addEventListener('click',()=>{rgbPaused=!rgbPaused;paint();});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',event=>{rgbPaused=event.matches;paint();});
function paint() {
  ensureSceneMatchesUsage();
  paintPrice();updateFontSelection();
  if(presetKey&&presetKey!==presetSignature()){presetKey='';presetRevision++;}
  scheduleDraft();
  if(shareDesignKey&&shareDesignKey!==JSON.stringify(captureDesign())){
    shareDesignKey=null;shareRevision++;shareAbort?.abort();sharePending=false;shareExpiresAt=0;
    $('#ar-share-qr').hidden=true;$('#ar-share-placeholder').hidden=false;$('#ar-share-link').hidden=true;
    $('#ar-share-status').textContent='Dein Entwurf hat sich geändert. Erstelle einen neuen QR-Code.';
  }
  const c=state.color;
  const stage=$('#preview-stage');stage.style.setProperty('--neon',c.color);stage.classList.toggle('is-off',!state.light);
  paintColorControls();paintMount();paintFinishControls();
  $('#light-toggle').setAttribute('aria-pressed',state.light);$('#light-toggle span').textContent=state.light?'Licht an':'Licht aus';const mobileLightButton=$('#mobile-light-on');mobileLightButton.setAttribute('aria-pressed',state.light);mobileLightButton.setAttribute('aria-label',state.light?'Licht ausschalten':'Licht einschalten');mobileLightButton.title=state.light?'Licht ausschalten':'Licht einschalten';mobileLightButton.querySelector('.sr-only').textContent=state.light?'Licht an':'Licht aus';
  $('#dimensions-toggle').setAttribute('aria-pressed',state.dimensions);$('#dimensions-toggle span').textContent=state.dimensions?'Maßlinien ausblenden':'Maßlinien anzeigen';
  for(const button of document.querySelectorAll('[data-backing]'))button.setAttribute('aria-pressed',button.dataset.backing===state.backing);
  $('#backing-description').textContent=BACKINGS[state.backing].description+(state.mount==='table-stand'?' Für den Tischständer wird die Unterkante gerade ausgeführt und erhält zwei Steckschlitze.':'');
  $('#backing-margin').textContent=state.backing==='contour'?'ca. 1 cm Rand um den Schriftzug':state.backing==='square'?'mindestens ca. 1,5 cm Rand':state.backing==='freestanding'?'schmale Streben hinter dem Schriftzug':'ca. 1,5 cm Rand um den Schriftzug';
  $('#freestanding-note').hidden=state.backing!=='freestanding';
  for(const button of document.querySelectorAll('[data-backing="square"]'))button.hidden=state.backing!=='square';
  if(state.mount==='table-stand')$('#backing-margin').textContent='Mit gerader Standkante und Steckschlitzen';
  updateChoices();
  paintRoom();
  if(!state.result)return;
  const {layout,size,production}=state.result;
  const issues=[];
  if(production?.tightBends)issues.push('enge Biegungen');
  if(production?.shortSections||production?.isolatedDots)issues.push('sehr kurze Leuchtabschnitte');
  if(production?.tubeInterferences||production?.junctionCount)issues.push('Verbindungen der Neonlinien');
  const plateCheck=evaluatePlateManufacturing({...plateSize(size),mount:state.mount,marginMm:CONTOUR_MARGIN_MM});
  if(plateCheck.status==='geometry-conflict')issues.push(plateCheck.standHeightFits?'zu wenig Platz für die Steckfüße':'Tischständer nur bis 50 cm Außenhöhe');
  $('#production-note').textContent=issues.length
    ? 'Bitte prüfen: '+issues.join(', ')+'. Größere Maße oder eine einfachere Schrift können helfen. Prüfung anhand vorläufiger Materialwerte.'
    : 'Geometrie anhand vorläufiger Materialwerte geprüft. Die tatsächliche Schlauchführung und Rückplatte brauchen noch eine Fertigungsfreigabe.';
  if(state.mount==='table-stand'&&!plateCheck.standHeightFits)$('#production-note').textContent=TABLE_STAND_HEIGHT_MESSAGE;
  if(state.mode==='logo')$('#production-note').textContent='Automatisch abgeleiteter Logo-Linienentwurf. Bitte mit dem Original vergleichen; Flächen und kleine Details können sich verändern. '+$('#production-note').textContent;
  if(state.backing==='freestanding')$('#production-note').textContent='Freigestellte Acrylstreben: Anzahl und Lage sind eine Vorschau. Buchstabenbefestigung, mehrzeilige Motive und Montage müssen vor Fertigung geprüft werden. '+$('#production-note').textContent;
  const sizeTechnicalDetails=$('#size-technical-details');
  const needsProductionReview=issues.length>0||state.mode==='logo'||state.backing==='freestanding';
  sizeTechnicalDetails.classList.toggle('has-warning',needsProductionReview);
  sizeTechnicalDetails.querySelector('summary').textContent=needsProductionReview?'Fertigungshinweis ansehen':'Maße und Fertigungshinweise';
  const profile=MANUFACTURING_PROFILE;
  $('#production-assumptions').textContent=`Arbeitswerte: ${profile.tubeMm} mm Neon · mindestens ${profile.minBendRadiusMm} mm Biegeradius · ${profile.cutPitchMm} mm Schnittabstand · ${profile.acrylicThicknessMm} mm Acryl. Geschätzt; keine bestätigten Lieferantendaten.`;
  if(state.mount==='table-stand')$('#production-assumptions').textContent+=` Steckschlitze: ${new Intl.NumberFormat('de-DE').format(plateCheck.slotWidthMm)} mm breit, ${profile.standSlotDepthMm} mm tief, ${profile.standInsetMm} mm vom Rand. Standfestigkeit noch nicht nachgewiesen.`;
  const minimum=minimumSizeForResult(state,state.result),belowMinimum=minimum&&plateSize(size).widthMm<minimum.widthMm-.1;
  $('#suggest-production-size').hidden=!belowMinimum||!!minimum&&(minimum.widthMm>4000||minimum.heightMm>4000);$('#suggest-production-size').disabled=false;
  $('#suggest-production-size').dataset.suggestedOuterMm=String(minimum?.widthMm||500);
  $('#suggest-production-size').textContent='Auf '+cm(minimum?.widthMm||500)+' cm Mindestbreite vergrößern';
  const technical=roomPresentation.technical;
  const design=size.exact.design,backing=plateSize(size);
  syncOuterSize(size);
  $('#backing-size').textContent=dimensions(backing);
  $('#size-plate-total').textContent=dimensions(backing);
  for(const button of document.querySelectorAll('[data-width-cm]'))button.setAttribute('aria-pressed',Math.abs(Number(button.dataset.widthCm)*10-backing.widthMm)<.6);$('#choice-plate-size').textContent=dimensions(backing);
  $('#choice-value-3').textContent=dimensions(backing);
  $('#choice-value-4').textContent=BACKINGS[state.backing].name;
  $('#tab-4').title=BACKINGS[state.backing].name+' · '+finishName(state.plateFinish);
  const room=ROOMS.find(room=>room.id===state.room);
  let centerY=technical?325:sceneSignY(room);
  const standing=state.mount==='table-stand';
  const pxPerMm=technical?roomPresentation.scale:(room.photoWidth||1000)/previewSpanMm(room);
  // The light spill represents a fixed physical distance, independent of sign size.
  const lightScale=pxPerMm/.42;
  const mobileLight=matchMedia('(max-width:760px)').matches;
  const lightViewport=$('#sign-preview').getBoundingClientRect();
  const screenScale=Math.max(.01,Math.min(lightViewport.width/$('#sign-preview').viewBox.baseVal.width,lightViewport.height/$('#sign-preview').viewBox.baseVal.height));
  for(const [id,radius,blur] of [['ambient',6,22],['wide',2,5],['close',.35,1]]){
    $('#glow-'+id+' feMorphology').setAttribute('radius',radius*lightScale);
    const minimumBlur=id==='ambient'?(mobileLight?12:8):id==='wide'?(mobileLight?4:2.5):.7;
    $('#glow-'+id+' feGaussianBlur').setAttribute('stdDeviation',Math.max(blur*lightScale,minimumBlur/screenScale));
  }
  const width=design.widthMm*pxPerMm,height=design.heightMm*pxPerMm,margin=(state.backing==='contour'?CONTOUR_MARGIN_MM:15)*pxPerMm;
  if(standing&&!technical)centerY=(room.standY??276)-backing.heightMm*pxPerMm/2;
  const plateTop=centerY-backing.heightMm*pxPerMm/2;
  const plateBottom=centerY+backing.heightMm*pxPerMm/2;

  const x=(1000-width)/2,y=standing?plateTop+(basePlateSize(size).heightMm-design.heightMm)*pxPerMm/2:centerY-height/2;
  const scale=size.scale*pxPerMm;
  const art=$('#preview-art');art.replaceChildren();
  const savedOffset=positions.get(state.room)||{x:0,y:0};
  const offset=technical?{x:0,y:0}:{x:savedOffset.x,y:standing&&room.id!=='custom'?0:savedOffset.y};
  const firstRailTop=state.backing==='freestanding'?Number(railPath(state.result).match(/^M[\d.]+ ([\d.]+)/)?.[1]||0)*pxPerMm:0;
  art.setAttribute('transform',`translate(${offset.x} ${offset.y})`);
  if(!technical&&!standing&&state.backing!=='freestanding'&&(state.mount==='hanging-kit'||(state.mount==='none'&&state.room==='shop'))){
    for(const anchor of [-.3,.3]){
      const localX=(.5+anchor)*backing.widthMm;
      let attachmentY=plateTop;
      if(state.backing==='contour'){
        attachmentY+=contourTopAt(backingContour(state.result),localX)*pxPerMm;
      }else attachmentY+=firstRailTop;
      const anchorTop=(state.room==='shop'?102:10)-offset.y;
      art.append(svg('line',{x1:500+anchor*backing.widthMm*pxPerMm,x2:500+anchor*backing.widthMm*pxPerMm,y1:anchorTop,y2:attachmentY,stroke:'#b9c0c5','stroke-width':1.5,opacity:.85}));
      art.append(svg('rect',{x:496+anchor*backing.widthMm*pxPerMm,y:anchorTop-5,width:8,height:6,rx:1.5,fill:'#b9c0c5',stroke:'#747b83','stroke-width':.5}));
    }
  }
  const finish=state.plateFinish;
  let plateFill=state.backing==='freestanding'?(technical?'#ffffff25':'#ffffff18'):finish.kind==='clear'?(technical?'#ffffff05':'#ffffff02'):finish.color;
  if(finish.kind.startsWith('mirror-')){
    const gradient=svg('linearGradient',{id:'plate-reflection',x1:'0%',y1:'0%',x2:'100%',y2:'80%'});
    const colors=finish.kind==='mirror-gold'?['#79602d','#d4af59','#fff0b5','#98752f','#eed697','#715725']:['#58616c','#c2cbd5','#f7fafc','#8b959f','#e8edf2','#636d79'];
    colors.forEach((color,index)=>gradient.append(svg('stop',{offset:`${[0,25,42,49,73,100][index]}%`,'stop-color':color})));
    const plateDefs=svg('defs');plateDefs.append(gradient);art.append(plateDefs);plateFill='url(#plate-reflection)';
  }
  const plateStyle={id:'backing-plate',fill:plateFill,stroke:finish.kind==='clear'?(technical?'#ffffff2b':'#ffffff20'):'#ffffff50','stroke-width':.65,'data-cut':state.backing,'data-finish':finish.kind};
  if(state.backing==='contour'||state.backing==='freestanding'||standing){
    art.append(svg('path',{...plateStyle,d:plateContour(state.result),transform:`translate(${(1000-backing.widthMm*pxPerMm)/2} ${plateTop}) scale(${pxPerMm})`,'vector-effect':'non-scaling-stroke','stroke-linejoin':'round'}));
  }else{
    art.append(svg('rect',{...plateStyle,x:(1000-backing.widthMm*pxPerMm)/2,y:centerY-backing.heightMm*pxPerMm/2,width:backing.widthMm*pxPerMm,height:backing.heightMm*pxPerMm,rx:Math.min(margin,6)}));
  }
  if(standing&&standFits()){
    const feet=svg('g',{'data-mount-preview':'table-stand','aria-label':'Zwei eingesteckte Acrylfüße'});
    const inset=MANUFACTURING_PROFILE.standInsetMm*pxPerMm;
    for(const anchorX of [(1000-backing.widthMm*pxPerMm)/2+inset,(1000+backing.widthMm*pxPerMm)/2-inset]){
      const depth=Math.max(9,Math.min(20,40*pxPerMm)),rise=Math.max(12,Math.min(30,55*pxPerMm));
      if(!technical)feet.append(svg('ellipse',{cx:anchorX,cy:plateBottom+4,rx:depth+5,ry:4,fill:'#000',opacity:.4}));
      feet.append(svg('path',{d:`M${anchorX-depth} ${plateBottom-6}L${anchorX-depth*.5} ${plateBottom-rise}L${anchorX+depth*.55} ${plateBottom-rise+7}L${anchorX+depth} ${plateBottom+7}Z`,fill:technical?'#cbd5df70':'#e8f4ff32',stroke:technical?'#737f8a':'#e6f4ffb0','stroke-width':1.2,'stroke-linejoin':'round'}));
      feet.append(svg('path',{d:`M${anchorX} ${plateBottom-rise*.65}L${anchorX} ${plateBottom-1}`,stroke:technical?'#5f6d78':'#e9f5ff','stroke-width':1.3,fill:'none'}));
    }
    art.append(feet);
  }
  // Wall fixings belong to the included mounting set, not to the drawn design.
  const defs=svg('defs'),shapes=new Map();
  for(const [glyphIndex,glyph] of layout.glyphs.entries()){
    // One light field per color avoids overlapping letter-by-letter blur hotspots.
    // Paths and transforms remain the same; individual word/letter colors still resolve above.
    const key=glyphColor(glyph).id;
    if(!shapes.has(key)){
      const color=glyphColor(glyph),shape=svg('g',{id:`neon-character-${glyphIndex}`,transform:`translate(${x} ${y}) scale(${scale})`});
      shapes.set(key,{shape,color});defs.append(shape);
    }
    shapes.get(key).shape.append(svg('path',glyph.centerlineD?{d:glyph.centerlineD,'stroke-linecap':'round','stroke-linejoin':'round'}:{d:glyph.d,transform:`translate(${glyph.x} ${glyph.y}) scale(1 -1)`,'vector-effect':'non-scaling-stroke'}));
  }
  art.append(defs);
  // Layered diffuser and a narrower bright core keep the selected neon color visible.
  // The existing unlit tube and the physical 8-mm geometry remain unchanged.
  const displayTubeMm=technical?layout.tubeMm:layout.tubeMm*(state.light?1.26:1.3);
  const layers=state.light?[
    {filter:'url(#glow-ambient)',opacity:technical?.45:1,style:'mix-blend-mode:screen','data-light-layer':'ambient'},
    {filter:'url(#glow-wide)',opacity:1,'data-light-layer':'halo'},
    {filter:'url(#glow-close)',opacity:1,'data-light-layer':'bloom'},
    {'data-light-layer':'tube'},
    {fill:'#fff',opacity:.62,'data-light-layer':'diffuser'},
    {fill:'#fff',opacity:.98,'data-light-layer':'core'}
  ]:[{off:true}];
  for(const layer of layers)for(const {shape,color} of shapes.values()){
    const {off,...attrs}=layer;
    if(layout.tubeMm){
      const {fill,...strokeAttrs}=attrs;
      if(state.lightMode==='rgb'&&state.light&&!fill)strokeAttrs.class='rgb-neon';
      const layerName=attrs['data-light-layer'];
      const strokeWidth=displayTubeMm*(layerName==='core'?.6:layerName==='diffuser'?.86:1);
      // Emitted light is more saturated than the pale silicone face; swatch/order colors stay intact.
      const emission=color.id==='pink'?'#ff38b8':color.id==='warm_white'?'#ffe3ad':color.color;
      const isGlow=['ambient','halo','bloom'].includes(layerName);
      art.append(svg('use',{href:`#${shape.id}`,fill:'none',stroke:fill||(off?color.off:isGlow?emission:color.color),'stroke-width':strokeWidth,...strokeAttrs}));
    }else art.append(svg('use',{href:`#${shape.id}`,fill:off?color.off:color.color,...attrs}));
  }
  const measures=$('#preview-dimensions');measures.replaceChildren();
  measures.setAttribute('transform',`translate(${offset.x} ${offset.y})`);
  if(state.dimensions){
    const ink='#ffffff';
    const viewport=$('#sign-preview').getBoundingClientRect();
    const measureScale=Math.max(.1,Math.min(viewport.width/$('#sign-preview').viewBox.baseVal.width,viewport.height/$('#sign-preview').viewBox.baseVal.height));
    const mobileMeasures=mobileChoiceMedia.matches;
    const measureFont=(mobileMeasures?12:14)/measureScale,tick=4/measureScale;
    const dimY=centerY+backing.heightMm*pxPerMm/2+18/measureScale,dimX=(1000+backing.widthMm*pxPerMm)/2+(mobileMeasures?4:20)/measureScale;
    const line=(x1,y1,x2,y2)=>measures.append(svg('line',{x1,y1,x2,y2,stroke:ink,'stroke-width':1,opacity:.65}));
    const outerX=(1000-backing.widthMm*pxPerMm)/2;
    line(outerX,dimY,outerX+backing.widthMm*pxPerMm,dimY);line(outerX,dimY-tick,outerX,dimY+tick);line(outerX+backing.widthMm*pxPerMm,dimY-tick,outerX+backing.widthMm*pxPerMm,dimY+tick);
    line(dimX,plateTop,dimX,plateBottom);line(dimX-tick,plateTop,dimX+tick,plateTop);line(dimX-tick,plateBottom,dimX+tick,plateBottom);
    measures.append(svg('text',{x:500,y:dimY+16/measureScale,fill:ink,'font-family':'Inter,sans-serif','font-size':measureFont,'text-anchor':'middle'},`Breite ${cm(backing.widthMm)} cm`));
    const heightLabelX=dimX+(mobileMeasures?6:8)/measureScale,viewRight=$('#sign-preview').viewBox.baseVal.x+$('#sign-preview').viewBox.baseVal.width-8/measureScale-offset.x;
    const x=heightLabelX;
    const label=svg('text',{x,y:(plateTop+plateBottom)/2-7/measureScale,fill:ink,'font-family':'Inter,sans-serif','font-size':measureFont,'text-anchor':'start'});
    label.append(svg('tspan',{x,dy:0},'Höhe'),svg('tspan',{x,dy:18/measureScale},`${cm(backing.heightMm)} cm`));measures.append(label);
    if(mobileMeasures&&label.getBBox().x+label.getBBox().width>viewRight){
      label.setAttribute('x',viewRight);label.setAttribute('text-anchor','end');
      for(const span of label.children)span.setAttribute('x',viewRight);
    }
  }
  const fallback=$('#preview-size-fallback'),v=$('#sign-preview').viewBox.baseVal;
  const dimensionBounds=$('#sign-preview').getBoundingClientRect();
  const dimensionScale=Math.min(dimensionBounds.width/v.width,dimensionBounds.height/v.height);
  // Judge the actual rendered label bounds at every viewport.
  const measureBounds=measures.getBBox(),edge=4/Math.max(.1,dimensionScale);
  const outside=measureBounds.x+offset.x<v.x+edge||measureBounds.x+measureBounds.width+offset.x>v.x+v.width-edge||measureBounds.y+offset.y<v.y+edge||measureBounds.y+measureBounds.height+offset.y>v.y+v.height-edge;
  measures.style.visibility=outside?'hidden':'';
  fallback.hidden=!state.dimensions||!outside;fallback.textContent=`Breite ${cm(backing.widthMm)} cm · Höhe ${cm(backing.heightMm)} cm`;
  const handles=$('#preview-handles');handles.replaceChildren();
  $('#direct-edit-hint').hidden=technical;
  previewBox={x:(1000-backing.widthMm*pxPerMm)/2+offset.x,y:plateTop+offset.y,width:backing.widthMm*pxPerMm,height:backing.heightMm*pxPerMm,pxPerMm,centerY};
  if(!technical){
    const view=$('#sign-preview').viewBox.baseVal;
    if(previewBox.x<view.x||previewBox.y<view.y||previewBox.x+previewBox.width>view.x+view.width||previewBox.y+previewBox.height>view.y+view.height)$('#scene-note').textContent='Ganzes Schild in der Detailansicht ansehen';
    const box=previewBox,bounds=$('#sign-preview').getBoundingClientRect();
    const screenScale=Math.max(.1,Math.min(bounds.width/$('#sign-preview').viewBox.baseVal.width,bounds.height/$('#sign-preview').viewBox.baseVal.height));
    const pad=10/screenScale,knob=4/screenScale;box.pad=pad;
    handles.append(svg('rect',{x:box.x-pad,y:box.y-pad,width:box.width+2*pad,height:box.height+2*pad,rx:3,class:'sign-drag-area','data-edit':'move',tabindex:0,role:'button','aria-label':'Schild verschieben. Ziehen oder Pfeiltasten verwenden.'}));
    for(const [sx,sy] of [[1,1]]){
      const hx=box.x+box.width/2+sx*(box.width/2+pad),hy=box.y+box.height/2+sy*(box.height/2+pad);
      const handle=svg('g',{'data-edit':'resize','data-sx':sx,'data-sy':sy,tabindex:0,role:'button','aria-label':'Schildgröße ändern. Ziehen oder Plus und Minus verwenden.',class:'sign-size-handle'});
      handle.append(svg('circle',{cx:hx,cy:hy,r:14/screenScale,fill:'transparent'}),svg('circle',{cx:hx,cy:hy,r:knob*1.65,class:'resize-knob','vector-effect':'non-scaling-stroke'}),svg('path',{d:`M${hx-knob*.65} ${hy+knob*.65}L${hx+knob*.65} ${hy-knob*.65}M${hx-knob*.4} ${hy-knob*.65}H${hx+knob*.65}V${hy+knob*.4}`,class:'resize-arrow','vector-effect':'non-scaling-stroke'}));
      handles.append(handle);
    }
  }
  paintBackingExample();
  paintArSection();
  if(activeStep===3)refreshPresetSizes();
  if(resizeFocus){const [sx,sy]=resizeFocus;resizeFocus=null;$('#preview-handles [data-sx="'+sx+'"][data-sy="'+sy+'"]')?.focus();}
  $('#sign-preview').setAttribute('aria-label',`${designName()}, ${state.mode==='logo'?'Logo':'Schrift '+state.font}, ${colorSummary()}, Außenmaße ${dimensions(backing)}, ${BACKINGS[state.backing].name}, Montage ${MOUNTS[state.mount].name}, ${state.light?'eingeschaltet':'ausgeschaltet'}, Szene ${ROOMS.find(r=>r.id===state.room).name}.`);
}
function sampleText(){return state.text.trim().replace(/\s+/g,' ').slice(0,40)||'Dein Text';}
// Visible cards first, then the 37 bundled fonts for three distinct retail price suggestions.
const visibleFontCards=new Set(),fontQuoteCache=new Map(),catalogSourceCache=new Map();
let fontQuoteKey='',fontQuoteContextValue=null,fontQuoteRunning=false,fontQuoteTimer;
function fontPriceContext(){
  return {text:state.text,mode:state.mode,alignment:state.alignment,lineHeight:state.lineHeight,
    axis:state.axis,valueMm:state.valueMm,outerMm:state.result?plateSize(state.result.size)[state.axis+'Mm']:null,
    backing:state.backing,plateFinish:{...state.plateFinish},mount:state.mount,lightMode:state.lightMode,
    ...priceOptions(state),color:state.color.id,wordColors:[...state.wordColors].map(([k,c])=>[k,c.id]),charColors:[...state.charColors].map(([k,c])=>[k,c.id])};
}
function fontQuoteCacheKey(context,id){return PRICE_RULES.version+JSON.stringify(context)+id;}
function paintFontQuote(button,quote,key){
  const price=button.querySelector('.font-card-price'),size=button.querySelector('.font-card-size');
  if(!price)return;
  price.textContent=priceLabel(quote.price);size.textContent=quote.price.minimum?'Ab '+cm(quote.price.minimum.widthMm)+' cm Breite':quote.size?`${quote.price.status==='calculated'?'für ':''}${dimensions(quote.size)}`:'Bitte Schrift prüfen';
  button.dataset.quoteKey=key;button.dataset.quoteStatus=quote.price.status;
  price.title='Gesamtpreis für dein Schild inklusive gewähltem Zubehör und MwSt.\n'+priceDetail(quote.price);button.setAttribute('aria-label',`${button.dataset.fontName}: Schildpreis ${price.textContent} inklusive MwSt., ${size.textContent}`);
}
function invalidateFontQuotes(){
  fontQuoteKey='';fontQuoteContextValue=null;clearTimeout(fontQuoteTimer);
  $('.studio-font-grid').dataset.suggestionsStatus='pending';
  $('.studio-font-grid').dataset.suggestionsKey='';
  for(const card of document.querySelectorAll('[data-quote-font]')){
    card.dataset.quoteKey='';card.dataset.quoteStatus=card.disabled?'unavailable':'pending';card.querySelector('.font-card-price').textContent=card.disabled?'Nicht verfügbar':'Wird berechnet …';card.querySelector('.font-card-size').textContent='';
    card.setAttribute('aria-label','Schrift '+card.dataset.fontName);
  }
}
function refreshFontQuotes(){
  if(designRendering)return;
  const context=fontPriceContext(),key=JSON.stringify(context);
  if(key!==fontQuoteKey){invalidateFontQuotes();fontQuoteKey=key;fontQuoteContextValue=context;}
  const fixedSize=state.result?`${cm(context.outerMm)} cm ${context.axis==='width'?'Breite':'Höhe'}`:'Deiner gewählten Größe';
  $('.studio-fonts .font-price-context').textContent=state.result?`Dein Schild bei ${fixedSize} · inkl. MwSt.`:'Schildpreise für deinen Text und deine Größe';
  $('#font-price-explanation').textContent=`Für deinen Text bei ${fixedSize}, inklusive gewählter Ausstattung und 19 % MwSt. Der Rabatt ist bereits enthalten. ${context.axis==='width'?'Die Höhe':'Die Breite'} ergibt sich aus der Schrift; beide Maße stehen auf jeder Karte.`;
  if(!state.result||!state.sizeValid||!state.text.trim()){
    for(const card of document.querySelectorAll('[data-quote-font]')){card.querySelector('.font-card-price').textContent='Text und Größe prüfen';card.querySelector('.font-card-size').textContent='';}
    return;
  }
  clearTimeout(fontQuoteTimer);fontQuoteTimer=setTimeout(runFontQuotes,80);
}
const fontQuoteObserver=new IntersectionObserver(entries=>{
  for(const entry of entries)entry.isIntersecting?visibleFontCards.add(entry.target):visibleFontCards.delete(entry.target);
  refreshFontQuotes();
},{rootMargin:'80px'});
function addFontQuote(button,{id,name,entry=null}){
  button.dataset.quoteFont=id;button.dataset.fontName=name;button.dataset.quoteStatus=button.disabled?'unavailable':'pending';button.fontQuoteEntry=entry;
  const price=document.createElement('span');price.className='font-card-price';price.textContent=button.disabled?'Nicht verfügbar':'Wird berechnet …';
  const size=document.createElement('span');size.className='font-card-size';
  const label=document.createElement('span');label.className='font-card-price-label';label.textContent='Schildpreis inkl. MwSt.';
  button.append(label,price,size);fontQuoteObserver.observe(button);
}
async function calculateFontQuote(context,id,entry,key,isCurrent=()=>key===fontQuoteKey&&!designRendering,includeGeometry=false){
  if(!loaded.has(id)){
    const input=entry?{bytes:(await getCatalogSource(entry)).bytes}:{url:new URL(`./assets/fonts/${id}.ttf`,import.meta.url).href};
    if(!isCurrent())return null;
    loaded.set(id,callWorker({type:'load',fontId:id,...input}).catch(error=>{loaded.delete(id);throw error;}));
  }
  await loaded.get(id);if(!isCurrent())return null;
  const design={...context,fontId:id};
  const render=()=>callWorker({type:'render',fontId:id,text:design.text,alignment:design.alignment,lineHeight:design.lineHeight,axis:design.axis,valueMm:design.valueMm});
  let result=await render();
  if(design.text.includes('\n')){
    const lineGap=()=>minimumTextGroupClearance({...result.layout,glyphs:result.layout.glyphs.map(g=>({...g,wordIndex:0}))}).distanceMm;
    while(lineGap()!==null&&lineGap()<MANUFACTURING_PROFILE.tubeMm&&design.lineHeight<2){
      if(!isCurrent())return null;
      design.lineHeight=Math.round((design.lineHeight+.05)*100)/100;result=await render();
    }
  }
  if(design.outerMm){
    let actual=pricingPlateSize(result.size,design)[design.axis+'Mm'];
    let low=actual<design.outerMm?design.valueMm:10,high=actual<design.outerMm?5000:design.valueMm;
    for(let i=0;i<13&&Math.abs(actual-design.outerMm)>.5;i++){
      if(!isCurrent())return null;
      const previous=design.valueMm;design.valueMm=(low+high)/2;const candidate=await render(),measured=pricingPlateSize(candidate.size,design)[design.axis+'Mm'];
      if(measured<design.outerMm)low=design.valueMm;else high=design.valueMm;
      if(Math.abs(measured-design.outerMm)<Math.abs(actual-design.outerMm)){result=candidate;actual=measured;}else design.valueMm=previous;
    }
  }
  return {price:priceForResult(design,result),size:pricingPlateSize(result.size,design),axis:design.axis,valueMm:design.valueMm,lineHeight:design.lineHeight,...(includeGeometry?{result,design}: {})};
}
// Budget suggestions share the font cards' geometry and retail-price calculation.
function budgetContextKey(){
  return JSON.stringify([PRICE_RULES.version,state.alignment,state.lineHeight,state.backing,state.plateFinish,state.mount,priceOptions(state)]);
}
function setupBudgetAdvisor(){
  const root=$('#config-budget');if(!root)return;
  budgetAdvisor=initBudgetAdvisor(root,{
    fonts:FONTS,colors:AVAILABLE_COLORS,logoUrl:'../assets/brand/logo-white.svg',priceVersion:PRICE_RULES.version,
    initial:{text:state.text.trim()||'Stay golden',width:state.result?Math.round(plateSize(state.result.size).widthMm)/10:100,budget:400,color:state.lightMode==='rgb'?'rgb':state.color.id},
    contextKey:budgetContextKey,
    async quote(input,font,isCurrent){
      const contextKey=budgetContextKey();
      const context={...fontPriceContext(),mode:'text',text:input.text,axis:'width',valueMm:input.width*10-20,outerMm:input.width*10,
        color:input.color==='rgb'?'pink':input.color,lightMode:input.color==='rgb'?'rgb':'static',wordColors:[],charColors:[]};
      const q=await calculateFontQuote(context,font,null,contextKey,()=>isCurrent()&&contextKey===budgetContextKey(),true);
      if(!q)return null;
      // Never suggest a silently adjusted width or a price from an invalid design.
      if(q.price.status==='calculated'&&Math.abs(q.size.widthMm-input.width*10)>.5)q.price={status:'invalid-size',net:null,reasons:['Diese Außenbreite ist mit der gewählten Rückplatte nicht möglich.']};
      return {...q,contextKey,gross:priceAmounts(q.price)?.gross};
    },
    async choose(q){
      if(draftApplying||designRendering)throw new Error('Bitte warte, bis der aktuelle Entwurf berechnet ist.');
      if(q.contextKey!==budgetContextKey()||q.price.status!=='calculated')throw new Error('Bitte die Vorschläge mit deiner aktuellen Ausstattung neu berechnen.');
      const before=captureDesign();commitHistory();draftApplying=true;budgetSelecting=true;
      const regions=[$('.editor'),$('.editor-tabs'),$('.preview-column')];regions.forEach(node=>node.inert=true);
      try{
        await applyDesign({...before,...q.design,font:q.design.fontId,fontSource:null,retainedFontSource:null,mode:'text',logo:null});
        if(!state.result||state.price?.status!=='calculated')throw new Error('Der Vorschlag konnte nicht übernommen werden. Bitte erneut berechnen.');
        const size=plateSize(state.result.size),gross=priceAmounts(state.price).gross;
        if(Math.abs(size.widthMm-q.size.widthMm)>.5||Math.abs(size.heightMm-q.size.heightMm)>.5||Math.round(gross*100)!==Math.round(q.gross*100)){
          await applyDesign(before);throw new Error('Maße oder Preis haben sich geändert. Bitte die Vorschläge neu berechnen.');
        }
        acceptReplacementDraft();history.record(captureDesign());persistDesign(captureDesign());setStep(0,false,{scroll:false});
        regions.forEach(node=>node.inert=false);$('#main').scrollIntoView({block:'start',behavior:'instant'});$('#sign-text').focus({preventScroll:true});
        return {message:`${state.font} ist im Konfigurator ausgewählt. Maße und Preis stimmen mit deinem Vorschlag überein.`};
      }finally{draftApplying=false;budgetSelecting=false;regions.forEach(node=>node.inert=false);refreshHistoryButtons();budgetAdvisor?.refreshContext();}
    }
  });
}
async function runFontQuotes(){
  if(fontQuoteRunning||designRendering||!state.result||!fontQuoteContextValue)return;
  fontQuoteRunning=true;
  try{
    while(!designRendering&&fontQuoteContextValue&&state.result&&state.sizeValid&&state.text.trim()){
      const key=fontQuoteKey,context=fontQuoteContextValue;
      const button=[...visibleFontCards].find(b=>b.isConnected&&!b.disabled&&b.getClientRects().length&&(!b.closest('dialog')||b.closest('dialog').open)&&b.dataset.quoteKey!==key);
      // Offscreen bundled cards supply real comparison prices without fetching the external catalogue.
      const candidate=button||[...$('.studio-font-grid').children].find(b=>!b.disabled&&b.dataset.quoteKey!==key);
      if(!candidate){applyQuickFontSuggestions();break;}
      const id=candidate.dataset.quoteFont,cacheKey=fontQuoteCacheKey(context,id);
      let quote=fontQuoteCache.get(cacheKey);
      try{
        if(id===state.fontId)quote={price:state.price,size:plateSize(state.result.size),axis:state.axis,valueMm:state.valueMm,lineHeight:state.lineHeight};
        else if(!quote)quote=await calculateFontQuote(context,id,candidate.fontQuoteEntry,key);
      }catch(error){quote={price:{status:priceStatusForError(error),net:null,reasons:[errorMessage(error)]}};}
      if(key!==fontQuoteKey||designRendering||!quote)continue;
      if(fontQuoteCache.size>=100)fontQuoteCache.delete(fontQuoteCache.keys().next().value);fontQuoteCache.set(cacheKey,quote);
      for(const card of document.querySelectorAll('[data-quote-font]'))if(card.dataset.quoteFont===id)paintFontQuote(card,quote,key);
      await new Promise(requestAnimationFrame);
    }
  }finally{fontQuoteRunning=false;}
}
function applyQuickFontSuggestions(){
  const grid=$('.studio-font-grid'),cards=[...grid.children],context=fontQuoteContextValue;
  if(!context||designRendering||grid.dataset.suggestionsKey===fontQuoteKey||cards.some(card=>card.dataset.quoteKey!==fontQuoteKey))return;
  // Do not move a card underneath a pointer or keyboard focus during a selection.
  if(grid.matches(':hover')||grid.contains(document.activeElement))return;
  const available=cards.map(card=>({card,quote:fontQuoteCache.get(fontQuoteCacheKey(context,card.dataset.quoteFont))}))
    .filter(({quote})=>quote?.price.status==='calculated'&&Number.isFinite(priceAmounts(quote.price).gross)&&Math.abs(quote.size[context.axis+'Mm']-context.outerMm)<=.5)
    .map(item=>({...item,cents:Math.round(priceAmounts(item.quote.price).gross*100)}))
    .sort((a,b)=>a.cents-b.cents||Number(b.card.dataset.quoteFont===state.fontId)-Number(a.card.dataset.quoteFont===state.fontId)||a.card.dataset.fontName.localeCompare(b.card.dataset.fontName,'de'));
  const distinct=available.filter((item,i)=>!i||item.cents!==available[i-1].cents);
  const chosen=[];
  if(distinct.length){
    chosen.push(distinct[0]);
    if(distinct.length>2){
      const midpoint=(distinct[0].cents+distinct.at(-1).cents)/2;
      chosen.push(distinct.slice(1,-1).reduce((best,item)=>Math.abs(item.cents-midpoint)<Math.abs(best.cents-midpoint)?item:best));
    }
    if(distinct.length>1)chosen.push(distinct.at(-1));
  }
  for(const item of available)if(chosen.length<3&&!chosen.includes(item))chosen.push(item);
  if(chosen.length){
    const first=chosen.map(item=>item.card),ordered=[...first,...cards.filter(card=>!first.includes(card))];
    ordered.forEach((card,i)=>card.classList.toggle('studio-mobile-font',i>=first.length));
    grid.append(...ordered);fitQuickFontSamples();
  }
  grid.dataset.suggestionsStatus=distinct.length>=3?'ready':'limited';
  grid.dataset.suggestionsKey=fontQuoteKey;
  grid.setAttribute('aria-label',distinct.length>=3?'Schriftvorschläge mit günstigem, mittlerem und höherem Schildpreis':'Schriftvorschläge mit verfügbaren Schildpreisen');
  grid.title=distinct.length>=3?'Drei Preisstufen für denselben Text und dasselbe gewählte Maß.':'Bei dieser Auswahl sind weniger als drei unterschiedliche Schildpreise verfügbar.';
}
function useFontQuoteLayout(id){
  const context=fontPriceContext(),quote=fontQuoteCache.get(fontQuoteCacheKey(context,id));
  state.requestedOuter=context.outerMm?{axis:state.axis,valueMm:context.outerMm}:null;
  compactLineSpacing=true;
  if(quote?.price.status==='calculated'){
    state.axis=quote.axis;state.valueMm=quote.valueMm;state.lineHeight=quote.lineHeight;state.requestedOuter=null;compactLineSpacing=false;
  }
}
async function getCatalogSource(entry,signal){
  validateCatalogFont(entry);const id=catalogFontAssetId(entry);
  if(catalogSourceCache.has(id))return catalogSourceCache.get(id);
  const existing=draftAssets.get(id);
  const [data,licenseBytes]=await Promise.all([existing?new Uint8Array(existing.file):fetchFontSource(entry.file.url,5000000,signal),fetchFontSource(entry.license.url,50000,signal)]);
  const header=new TextEncoder().encode(`blob ${data.length}\0`),blob=new Uint8Array(header.length+data.length);blob.set(header);blob.set(data,header.length);
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-1',blob))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(data.length!==entry.file.bytes||digest!==entry.file.gitBlobSha)throw new Error('Die Schriftdatei stimmt nicht mit dem Katalog überein.');
  const licenseText=new TextDecoder().decode(licenseBytes);if(!licenseText.trim())throw new Error('Der Lizenzbeleg fehlt.');
  const source={bytes:data.buffer,licenseText};if(catalogSourceCache.size>=8)catalogSourceCache.delete(catalogSourceCache.keys().next().value);catalogSourceCache.set(id,source);return source;
}

function makeFontButton(name) {
  const button=document.createElement('button');button.className='font-option';button.type='button';button.dataset.font=name;button.setAttribute('aria-label',`Schrift ${name}`);
  const sample=document.createElement('span');sample.className='font-sample';sample.style.fontFamily=`"NT-${name}"`;sample.textContent=sampleText();
  const label=document.createElement('small');label.textContent=name;button.append(sample,label);
  addFontQuote(button,{id:name,name});
  button.addEventListener('click',()=>{fontSelectionRevision++;$('#upload-state').hidden=true;useFontQuoteLayout(name);state.font=name;state.fontId=name;state.fontSource=null;if($('#font-overview').open)$('#font-overview').close();update();});return button;
}
function fitQuickFontSamples(){
  for(const sample of document.querySelectorAll('.studio-font-grid .font-sample,#font-grid .font-sample')){
    if(!sample.clientWidth)continue;
    sample.style.fontSize='25px';
    const style=getComputedStyle(sample),available=sample.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-2;
    const textRange=document.createRange();textRange.selectNodeContents(sample);
    for(let px=24;textRange.getBoundingClientRect().width>available&&px>=(sample.textContent.length<=16?10:14);px--)sample.style.fontSize=px+'px';
  }
}
new ResizeObserver(fitQuickFontSamples).observe($('.studio-font-grid'));
new ResizeObserver(fitQuickFontSamples).observe($('#font-grid'));
document.fonts.addEventListener('loadingdone',fitQuickFontSamples);
function updateFontSelection(){
  for(const button of document.querySelectorAll('[data-font]')) {
    button.setAttribute('aria-pressed',button.dataset.font===state.fontId);
    button.querySelector('.font-sample').textContent=sampleText();
  }
  fitTextField();document.fonts.ready.then(fitQuickFontSamples);
  $('#studio-selected-font').textContent=state.font;
  $('#summary-font').textContent=state.mode==='logo'?'Eigenes Logo':state.font;
  $('#all-fonts').firstChild.textContent='Weitere Schriften ';
  $('#look-font-name').textContent=state.font;
  const sample=$('#look-font-sample'),layout=state.result?.layout;
  if(layout?.glyphs?.length&&!designRendering){
    if(sample.layout!==layout){
      const b=layout.bounds,pad=Math.max(layout.tubeMm||8,Math.min(b.width,b.height)*.025);
      const art=svg('svg',{viewBox:`${(b.x||0)-pad} ${(b.y||0)-pad} ${b.width+pad*2} ${b.height+pad*2}`,preserveAspectRatio:'xMinYMid meet','aria-hidden':'true'});
      for(const glyph of layout.glyphs)art.append(svg('path',{d:glyph.centerlineD,fill:'none',stroke:'currentColor','stroke-width':layout.tubeMm||8,'stroke-linecap':'round','stroke-linejoin':'round'}));
      sample.replaceChildren(art);sample.layout=layout;
    }
  }else{sample.textContent=state.text?'Vorschau wird berechnet …':'Dein Text';sample.layout=null;}
  sample.title=state.text;
  $('#current-font-name').textContent=state.font;$('#current-font-sample').textContent=state.text||'Dein Text';$('#current-font-sample').style.fontFamily=state.fontId.startsWith('upload-')||state.fontSource?'NT-Uploaded':`NT-${state.font}`;
  $('#font-source-note').hidden=!state.fontSource;
  if(state.fontSource){
    let link=$('#font-source-note [data-font-license]');
    if(link.tagName!=='A'){const anchor=document.createElement('a');anchor.dataset.fontLicense='';anchor.target='_blank';anchor.rel='noopener noreferrer';link.replaceWith(anchor);link=anchor;}
    link.href=state.fontSource.entry.license.url;link.textContent=`${state.font} · ${state.fontSource.entry.license.spdx}`;
  }
}
// One browser for all font sources; reuse the existing catalogue and file handlers.
$('#font-dialog-tabs').append($('.font-library-switch'));
$('#font-dialog-content').append($('#font-browser'),$('.font-upload'),$('#font-source-note'));
$('#font-favorites').hidden=true;
function openFontOverview(library=fontLibrary){
  if(!$('#font-overview').open)$('#font-overview').showModal();
  openFontLibrary(library);updateFontSelection();
}
$('#open-font-overview').addEventListener('click',()=>openFontOverview());
$('#look-font').addEventListener('click',()=>openFontOverview());
$('#open-font-upload').addEventListener('click',()=>openFontOverview('upload'));
$('#tab-1').addEventListener('click',()=>openFontOverview());
$('#studio-all-fonts').addEventListener('click',()=>openFontOverview());
const studioFontOrder=[...new Set(['Alexa','NeonLite','Neontrace',...FONTS])];
for(const [index,name] of studioFontOrder.entries()){
  const button=makeFontButton(name);if(index>2)button.classList.add('studio-mobile-font');$('.studio-font-grid').append(button);
}
const fontPriceCaption=document.createElement('p');fontPriceCaption.className='font-price-context';$('.studio-font-grid').before(fontPriceCaption);
const dialogPriceContext=document.createElement('aside');dialogPriceContext.className='font-price-context font-price-explainer';
dialogPriceContext.innerHTML='<strong>Schildpreise für deinen Text und deine Größe</strong><p id="font-price-explanation"></p>';
$('#font-dialog-tabs').before(dialogPriceContext);
$('.studio-font-grid').addEventListener('mouseleave',applyQuickFontSuggestions);
$('.studio-font-grid').addEventListener('focusout',()=>requestAnimationFrame(applyQuickFontSuggestions));
const fontSwipeHint=document.createElement('p');fontSwipeHint.className='studio-font-hint';fontSwipeHint.textContent='37 Schriften · nach rechts wischen';$('.studio-font-grid').after(fontSwipeHint);
$('#studio-all-colors').addEventListener('click',()=>{
  const multicolor=state.lightMode!=='rgb'&&state.mode!=='logo';
  if(multicolor){
    state.colorScope=colorLines().length>1?'lines':'words';
    state.colorTarget=(state.colorScope==='lines'?colorLines():state.words)[0]?.key||'all';
    $('#color-detail-options').open=true;renderColorTargets();
  }else state.colorTarget='all';
  paint();openColorGallery({focusTarget:multicolor});
});
for(const color of AVAILABLE_COLORS){
 const swatch=document.createElement('button');swatch.type='button';swatch.dataset.color=color.id;
 swatch.style.setProperty('--swatch',color.color);swatch.setAttribute('aria-label',color.name);swatch.title=color.name;
 swatch.addEventListener('click',()=>{state.lightMode='static';state.colorTarget='all';state.color=color;state.wordColors.clear();state.charColors.clear();paint();});
 $('.studio-palette').append(swatch);
}
for(const color of AVAILABLE_COLORS){
  const button=document.createElement('button');button.type='button';button.className='color-swatch';button.dataset.color=color.id;button.style.setProperty('--swatch',color.color);button.setAttribute('aria-label',color.name);button.title=color.name;const colorLabel=document.createElement('span');colorLabel.className='color-swatch-label';colorLabel.textContent=color.name.replace('Zitronengelb','Zitronen\u00adgelb');
  // Build the wall-photo SVG only when the color gallery is opened.
  button.append(svg('svg',{'aria-hidden':'true',viewBox:'0 0 780 260'}),colorLabel);
  button.addEventListener('click',()=>{
    if(state.lightMode==='rgb')return;
    if(state.colorTarget==='all'){state.color=color;if(state.mode!=='logo'){state.wordColors.clear();state.charColors.clear();}}
    else if(state.colorTarget.startsWith('char:'))state.charColors.set(state.colorTarget,color);
    else if(state.colorTarget.startsWith('line:')){const lineIndex=Number(state.colorTarget.slice(5));for(const word of state.words)if(word.lineIndex===lineIndex)state.wordColors.set(word.key,color);for(const character of state.characters)if(character.lineIndex===lineIndex)state.charColors.delete(character.key);}
    else {state.wordColors.set(state.colorTarget,color);const word=state.words.find(w=>w.key===state.colorTarget);for(const g of state.result?.layout.glyphs||[])if(g.lineIndex===word?.lineIndex&&g.wordIndex===word?.wordIndex)state.charColors.delete(g.colorKey);}
    paint();
  });$('#color-palette').append(button);
}
// The legacy current-color card can become visible after a layout/step change.
const currentColorVisibility=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))paintColorControls();});
currentColorVisibility.observe($('#current-color-example'));
function openColorGallery({focusTarget=false}={}){
  const dialog=$('#color-gallery');refreshColorExamples();
  $('#color-gallery-size').textContent=`Dein Schild: Breite ${$('#stage-width').textContent} · Höhe ${$('#stage-height').textContent}`;
  if(!dialog.open)dialog.showModal();
  colorGalleryBody.scrollTop=0;
  (focusTarget?$('#color-targets [aria-pressed="true"]'):state.lightMode==='rgb'?$('#color-gallery [data-light-mode="rgb"]'):$('#color-palette [aria-pressed="true"]')||$('#color-palette button'))?.focus({preventScroll:true});
}
$('#open-color-gallery').addEventListener('click',openColorGallery);
$('#look-color').addEventListener('click',()=>{state.colorTarget='all';paint();openColorGallery();});
$('#color-palette').addEventListener('keydown',event=>{
  const cards=[...$('#color-palette').children],current=cards.indexOf(event.target),columns=matchMedia('(max-width:760px)').matches?3:6;
  if(current<0)return;
  let next=current;
  if(event.key==='ArrowRight')next=(current+1)%cards.length;
  else if(event.key==='ArrowLeft')next=(current+cards.length-1)%cards.length;
  else if(event.key==='ArrowDown')next=(current+columns)%cards.length;
  else if(event.key==='ArrowUp')next=(current+cards.length-columns)%cards.length;
  else if(event.key==='Home')next=0;
  else if(event.key==='End')next=cards.length-1;
  else return;
  event.preventDefault();cards[next].focus();
});
$('#line-height').addEventListener('input',event=>{compactLineSpacing=false;state.lineHeight=Math.max(.8,Math.min(2,Number(event.target.value)||1.25));clearTimeout(timer);update();});
$('#sign-text').addEventListener('input',()=>{
 const next=$('#sign-text').value,content=spacingContent(next);
 if(next!==state.text&&content===spacingContent(state.text)&&state.result&&!designRendering){spacingAnchor={content,fontId:state.fontId,lineHeight:state.lineHeight,unitsPerEm:state.result.layout.unitsPerEm};}
 else if(spacingAnchor?.content!==content)spacingAnchor=null;
 state.sizeValid=true;
 if(!state.text.includes('\n')&&next.includes('\n')){state.lineHeight=.8;compactLineSpacing=true;}
 designRendering=true;invalidatePrice();$('#save-design').disabled=true;scheduleDraft();clearTimeout(timer);revision++;timer=setTimeout(update,90);
});
for(const button of document.querySelectorAll('[data-align]'))button.addEventListener('click',()=>{state.alignment=button.dataset.align;for(const b of document.querySelectorAll('[data-align]'))b.setAttribute('aria-pressed',b===button);update();});
for(const axis of ['width','height']){
 const input=$('#sign-'+axis);
 let edited=false;
 const commitSize=()=>{
  if(!edited)return;
  // Clear before rendering so change, blur and Enter cannot commit twice.
  edited=false;
  chooseOuterSize(axis,input.value.trim()?Number(input.value)*10:NaN);
 };
 input.addEventListener('input',()=>{
  edited=true;
  // Do not render/clamp partial keystrokes (e.g. 1 -> 10 -> 100).
  designRendering=true;invalidatePrice();$('#save-design').disabled=true;clearTimeout(timer);revision++;
  $('#size-error').hidden=true;
 });
 input.addEventListener('change',commitSize);
 input.addEventListener('blur',commitSize);
 input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commitSize();input.blur();}});
}
$('#width-slider').addEventListener('input',event=>{chooseOuterSize('width',Number(event.target.value)*10);});
$('#light-toggle').addEventListener('click',()=>{state.light=!state.light;paint();});
$('#mobile-light-on').addEventListener('click',()=>{state.light=!state.light;paint();});
$('#mobile-background').addEventListener('click',()=>$('#scene-dialog').showModal());
$('#dimensions-toggle').addEventListener('click',()=>{state.dimensions=!state.dimensions;paint();});
studioFooter.prepend($('#dimensions-toggle'));studioFooter.append($('#camera-controls'));

function paintFinishControls(){
  const finish=state.plateFinish;
  for(const button of document.querySelectorAll('[data-plate-finish]')){button.setAttribute('aria-pressed',button.dataset.plateFinish===finish.kind&&(!button.dataset.plateColor||button.dataset.plateColor===finish.color));button.disabled=state.backing==='freestanding'&&button.dataset.plateFinish!=='clear';}
  $('#plate-custom-color').disabled=state.backing==='freestanding';
  $('#plate-custom-color').value=finish.kind==='uv-print'?finish.color:'#D4AF37';
  $('#plate-finish-name').textContent=finishName(finish);$('#finish-selection').textContent=finishName(finish);$('#finish-preview').dataset.finish=finish.kind;$('#finish-preview').style.setProperty('--finish-color',finish.color);$('#finish-dialog-note').textContent=state.backing==='freestanding'?'Freigestellte Stützstreben bleiben transparent.':'Die Auswahl wird direkt in deinem Entwurf und Gesamtpreis sichtbar.';
  $('#plate-finish-note').textContent=state.backing==='freestanding'?'Die Acrylstreben bleiben transparent.':finish.kind.startsWith('mirror-')?'Verspiegeltes Acryl. Die Reflexion ist in der Vorschau angenähert.':finish.kind==='uv-print'?'Farbige Rückplatte mit UV-Druck. Bildschirmfarben dienen zur Orientierung.':'Klare Acrylplatte mit dezenter sichtbarer Kante.';
}
for(const button of document.querySelectorAll('[data-plate-finish]'))button.addEventListener('click',()=>{state.plateFinish=normalizedFinish({kind:button.dataset.plateFinish,color:button.dataset.plateColor||'#FFFFFF'});paint();});
$('#plate-custom-color').addEventListener('input',event=>{state.plateFinish=normalizedFinish({kind:'uv-print',color:event.target.value});paint();});
$('#plate-custom-color').addEventListener('change',commitHistory);
for(const button of document.querySelectorAll('[data-backing]'))button.addEventListener('click',()=>{
  const outer=state.result?plateSize(state.result.size):null;
  state.backing=button.dataset.backing;
  state.autoContourNotice=false;
  if(state.backing==='freestanding'){
    state.plateFinish=normalizedFinish();
    if(state.mount!=='wall-mount'){
      if(state.mount==='table-stand')state.room=state.previousRoom;
      state.mount='wall-mount';
      if(state.room==='shop')state.room='reception';
    }
  }
  if(outer)chooseOuterSize(state.axis,outer[state.axis+'Mm']);else paint();
});
for(const button of document.querySelectorAll('.scene-tabs button'))button.addEventListener('click',()=>{state.scene=button.dataset.scene;paint();});
async function openFontLibrary(library='free'){
  if(library!==fontLibrary)fontTraitEnabled=false;
  fontLibrary=library;$('#mobile-font-library').value=library;
  $('.font-filter-toolbar').hidden=library!=='free';
  $('#font-browser').hidden=library==='upload';$('#font-dialog-content .font-upload').hidden=library!=='upload';
  for(const b of document.querySelectorAll('[data-font-library]'))b.setAttribute('aria-pressed',b.dataset.fontLibrary===library);
  if(library==='upload')return;
  fontCatalogLimit=24;renderFontCategories();filterFonts();
  if(library==='free'&&!fontCatalog){$('#font-catalog-status').textContent='Schriftkatalog wird geladen …';try{fontCatalog=await loadFontCatalog();$('#font-catalog-status').textContent='';if(fontLibrary==='free')filterFonts();}catch(error){$('#font-catalog-status').textContent=error.message;}}
}
$('#all-fonts').addEventListener('click',()=>openFontOverview('free'));
function renderFontCategories(){
  const root=$('#font-categories');root.replaceChildren();$('#font-category-select').replaceChildren();
  for(const category of FONT_CATALOG_CATEGORIES){
    const option=document.createElement('option');option.value=category.id;option.textContent=category.label;$('#font-category-select').append(option);
    const button=document.createElement('button');button.type='button';button.dataset.fontCategory=category.id;button.textContent=category.label;
    button.addEventListener('click',()=>{fontCategory=category.id;fontCatalogLimit=24;filterFonts();});root.append(button);
  }
  $('#font-trait-label').textContent='Konturschrift';
  $('#font-trait').checked=fontTraitEnabled;
  $('#font-trait-note').textContent='Konturen im Schriftbild; zwei fertigbare Neonlinien sind nicht garantiert.';
  for(const b of document.querySelectorAll('[data-font-library]'))b.setAttribute('aria-pressed',b.dataset.fontLibrary===fontLibrary);
}
function updateFontFilterState(query){
  for(const b of document.querySelectorAll('[data-font-category]'))b.setAttribute('aria-pressed',b.dataset.fontCategory===fontCategory);
  $('#font-category-select').value=fontCategory;
  const active=[];
  if(fontCategory!=='all')active.push(FONT_CATALOG_CATEGORIES.find(c=>c.id===fontCategory).label);
  if(fontTraitEnabled)active.push('Konturschrift');
  if(query)active.push('Suche aktiv');
  $('#font-filter-active').textContent=active.join(' · ')||'Alle Stile';
  $('#font-filter-reset').hidden=active.length===0;
  $('#font-filter-active').parentElement.hidden=active.length===0;
}
const fontStyleFilter=$('#font-style-filter');
function syncFontFilterDisclosure(){fontStyleFilter.open=!mobileChoiceMedia.matches;}
syncFontFilterDisclosure();mobileChoiceMedia.addEventListener('change',syncFontFilterDisclosure);
function filterFonts(preserveMobilePage=false){
  if(!preserveMobilePage)mobileFontPage=0;
  const grid=$('#font-grid'),query=$('#font-search').value.trim();for(const card of grid.querySelectorAll('[data-quote-font]')){fontQuoteObserver.unobserve(card);visibleFontCards.delete(card);}grid.replaceChildren();let visible=0,total=0;
  if(fontLibrary==='neon'){
    for(const name of studioFontOrder)if(name.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de'))){grid.append(makeFontButton(name));visible++;}total=visible;
    $('.font-preview-help').textContent='Dein eigener Text, direkt in unseren Neon-Schriften.';
  }else if(fontCatalog){
    const page=searchFontCatalog(fontCatalog,{query,category:fontCategory,trait:fontTraitEnabled?'outline':'all',limit:Math.min(fontCatalogLimit,60)});
    const pages=[];for(let offset=0;offset<Math.min(fontCatalogLimit,page.total);offset+=60)pages.push(...searchFontCatalog(fontCatalog,{query,category:fontCategory,trait:fontTraitEnabled?'outline':'all',offset,limit:Math.min(60,fontCatalogLimit-offset)}).items);
    for(const entry of pages){
      const card=document.createElement('div');card.className='catalog-font-card';
      const button=document.createElement('button');button.type='button';button.className='font-option catalog-font-option';button.dataset.catalogFont=entry.id;button.setAttribute('aria-pressed',state.fontId===catalogFontAssetId(entry));
      const name=document.createElement('strong'),hint=document.createElement('small');name.textContent=entry.family;hint.textContent=entry.file.bytes>5000000?'Über 5 MB · derzeit nicht unterstützt':'Im Schild ausprobieren';button.append(name,hint);button.disabled=entry.file.bytes>5000000;addFontQuote(button,{id:catalogFontAssetId(entry),name:entry.family,entry});button.addEventListener('click',()=>selectCatalogFont(entry));
      const license=document.createElement('a');license.href=entry.license.url;license.target='_blank';license.rel='noopener noreferrer';license.textContent=entry.license.spdx;license.setAttribute('aria-label',`Lizenz für ${entry.family}`);card.append(button,license);grid.append(card);
    }visible=pages.length;total=page.total;
    $('.font-preview-help').textContent=fontTraitEnabled?'Konturschriften. Nach Auswahl erscheint dein Text in der Neon-Vorschau; zwei fertigbare Lichtlinien sind nicht garantiert.':'Schriftnamen zur Orientierung. Nach Auswahl erscheint dein Text in der tatsächlichen Schrift auf dem Schild.';
  }
  updateFontFilterState(query);
  $('#font-count').textContent=fontLibrary==='free'&&!fontCatalog?'Katalog wird geladen …':visible===total?`${total} ${total===1?'Schrift':'Schriften'}`:`${visible} von ${total} Schriften`;
  $('#font-no-results').hidden=total>0||fontLibrary==='free'&&!fontCatalog;$('#font-more').hidden=fontLibrary!=='free'||visible>=total;
  $('#font-download-note').hidden=fontLibrary!=='free';updateFontSelection();paintMobileChoices();refreshFontQuotes();
}
for(const button of document.querySelectorAll('[data-font-library]'))button.addEventListener('click',()=>openFontLibrary(button.dataset.fontLibrary));
$('#font-category-select').addEventListener('change',event=>{fontCategory=event.target.value;fontCatalogLimit=24;filterFonts();});
$('#font-trait').addEventListener('change',event=>{fontTraitEnabled=event.target.checked;fontCatalogLimit=24;filterFonts();});
$('#font-filter-reset').addEventListener('click',()=>{fontCategory='all';fontTraitEnabled=false;$('#font-trait').checked=false;$('#font-search').value='';fontCatalogLimit=24;filterFonts();$('#font-search').focus({preventScroll:true});});
$('#font-more').addEventListener('click',()=>{fontCatalogLimit+=24;filterFonts();});
$('#font-search').addEventListener('input',()=>{fontCatalogLimit=24;filterFonts();});
async function fetchFontSource(url,max,signal){
  const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
  if(!response.ok||Number(response.headers.get('content-length'))>max||!response.body)throw new Error('Die Schriftquelle ist gerade nicht erreichbar. Bitte erneut versuchen.');
  const reader=response.body.getReader(),chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error('Die Schriftdatei überschreitet das Größenlimit.');chunks.push(value);}}catch(error){await reader.cancel();throw error;}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
async function selectCatalogFont(entry){
  validateCatalogFont(entry);if(entry.file.bytes>5000000)return;
  catalogDownloadController?.abort();const controller=new AbortController();catalogDownloadController=controller;
  const token=++fontSelectionRevision,status=$('#font-catalog-status');status.textContent=`${entry.family} wird geladen und geprüft …`;
  try{
    const fontId=catalogFontAssetId(entry),{bytes,licenseText}=await getCatalogSource(entry,controller.signal);
    if(token!==fontSelectionRevision)return;
    await callWorker({type:'load',fontId,bytes});if(token!==fontSelectionRevision)return;
    await callWorker({type:'render',fontId,text:$('#sign-text').value.trim()?$('#sign-text').value:'Neon',alignment:state.alignment,lineHeight:state.lineHeight,axis:state.axis,valueMm:state.valueMm});if(token!==fontSelectionRevision)return;
    const face=new FontFace('NT-Uploaded',bytes);await face.load();if(token!==fontSelectionRevision)return;
    await rememberAsset(fontId,bytes);if(token!==fontSelectionRevision)return;
    if(uploadedFace)document.fonts.delete(uploadedFace);uploadedFace=face;document.fonts.add(face);fontFile=bytes;loaded.set(fontId,Promise.resolve());
    useFontQuoteLayout(fontId);state.fontId=fontId;state.font=entry.family;state.fontSource={entry,licenseText};status.textContent='';$('#upload-state').hidden=true;await update();if($('#font-overview').open)$('#font-overview').close();
  }catch(error){if(token===fontSelectionRevision)status.textContent=errorMessage(error);}
}
$('#font-upload').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  const selectionRev=++fontSelectionRevision;
  const status=$('#upload-state');status.hidden=false;
  try{
    if(!/\.(ttf|otf|woff2?)$/i.test(file.name)||file.size>5_000_000||file.size<100)throw new Error('Bitte wähle eine gültige TTF-, OTF- oder WOFF-Datei bis 5 MB.');
    status.textContent='Schrift wird auf deinem Gerät geprüft …';
    const bytes=await file.arrayBuffer();
    const magic=new DataView(bytes).getUint32(0,false);
    if(magic!==0x00010000&&magic!==0x4f54544f&&magic!==0x74727565&&magic!==0x774f4646&&magic!==0x774f4632)throw new Error('Die Datei ist keine unterstützte TTF-, OTF- oder WOFF-Schrift.');
    const fontId=`upload-${Date.now()}`;
    await callWorker({type:'load',fontId,bytes});
    const face=new FontFace('NT-Uploaded',bytes);await face.load();
    if(selectionRev!==fontSelectionRevision)return;
    if(uploadedFace)document.fonts.delete(uploadedFace);uploadedFace=face;document.fonts.add(face);
    await rememberAsset(fontId,bytes);
    if(selectionRev!==fontSelectionRevision)return;
    loaded.set(fontId,Promise.resolve());fontFile=bytes;state.fontId=fontId;state.fontSource=null;state.font=file.name.replace(/\.(ttf|otf|woff2?)$/i,'');
    compactLineSpacing=true;status.textContent=`${state.font} ist ausgewählt.`;await update();if($('#font-overview').open)$('#font-overview').close();
  }catch(error){if(selectionRev===fontSelectionRevision)status.textContent=error.message;}
  if(selectionRev===fontSelectionRevision)event.target.value='';
});
const mobileToggle=$('.hero-mobile-toggle'),mobileNav=$('.hero-mobile-nav'),productsToggle=$('.hero-nav-toggle'),products=$('.hero-dropdown');
function closeSiteMenus(){mobileNav.hidden=true;products.hidden=true;mobileToggle.setAttribute('aria-expanded','false');mobileToggle.setAttribute('aria-label','Menü öffnen');productsToggle.setAttribute('aria-expanded','false');}
for(const [button,panel] of [[mobileToggle,mobileNav],[productsToggle,products]])button.addEventListener('click',()=>{const open=panel.hidden;closeSiteMenus();panel.hidden=!open;button.setAttribute('aria-expanded',String(open));if(button===mobileToggle)button.setAttribute('aria-label',open?'Menü schließen':'Menü öffnen');});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const trigger=!mobileNav.hidden?mobileToggle:!products.hidden?productsToggle:null;closeSiteMenus();trigger?.focus();}});
document.addEventListener('click',event=>{if(event.target.closest('.config-site-header a')||!event.target.closest('.hero-product-nav,.hero-mobile-toggle,.hero-mobile-nav'))closeSiteMenus();});
matchMedia('(max-width:900px)').addEventListener('change',closeSiteMenus);
function updateChoices(){
  $('#choice-value-0').textContent=state.mode==='logo'?(state.logo?.name||'Logo hochladen'):$('#sign-text').value.trim().replace(/\s+/g,' ')||'Text eingeben';
  $('#choice-value-1').textContent=state.font;
  $('#choice-value-2').textContent=colorSummary();
  const colors=usedColors();
  $('#tab-2').style.setProperty('--choice-color',colors.length===1?colors[0].color:`linear-gradient(135deg,${colors.map(color=>color.color).join(',')})`);
  $('#choice-value-4').textContent=BACKINGS[state.backing].name;
  $('#tab-4').title=BACKINGS[state.backing].name+' · '+finishName(state.plateFinish);
}
// Legacy camera coordinates are retained for calibrated own photographs.
function defaultCamera(roomId){
  return {zoom:1,x:500,y:roomId==='tabletop'?245:roomId==='shop'?210:roomId==='studio'?225:185};
}
// Reuse the same scene IDs, availability and draft persistence as the background picker.
function syncScenarioChoice(){
  const rooms=ROOMS.filter(sceneAvailable);
  const key=rooms.map(room=>room.id+':'+room.name).join('|');
  if(scenarioSelect.dataset.options!==key){
    scenarioSelect.replaceChildren();
    for(const room of rooms){const option=document.createElement('option');option.value=room.id;option.textContent=room.name;scenarioSelect.append(option);}
    scenarioSelect.dataset.options=key;
  }
  scenarioSelect.value=state.room;scenarioSelect.title=ROOMS.find(room=>room.id===state.room)?.name||'';
  const sceneLabel=$('#mobile-scene-label');if(sceneLabel)sceneLabel.textContent=(state.outdoor?'Außen':'Innen')+' · '+scenarioSelect.title;
}
function stockSignBox(room){
  const plate=plateSize(state.result.size),scale=1000/previewSpanMm(room),standing=state.mount==='table-stand';
  const offset=positions.get(room.id)||{x:0,y:0},width=plate.widthMm*scale,height=plate.heightMm*scale;
  return {x:500+offset.x-width/2,y:standing?(room.standY??276)-height:sceneSignY(room)+offset.y-height/2,width,height:height+(standing?7:0)};
}
function stockFrame(room,viewport){return frameRoom({room:room.id,viewport,sign:stockSignBox(room),camera:cameras.get(room.id),standing:state.mount==='table-stand'});}
function alternativeRoomFits(room,viewport){
  if(room.id==='custom'||stockFrame(room,viewport).fits)return true;
  const plate=plateSize(state.result.size),height=Math.max(mobileChoiceMedia.matches?150:240,Math.min(viewport.height,viewport.width/2));
  return plate.widthMm>plate.heightMm*2&&height<viewport.height&&stockFrame(room,{...viewport,height}).fits;
}
function paintRoom(){
  syncScenarioChoice();
  const room=ROOMS.find(r=>r.id===state.room),stage=$('#preview-stage'),mobile=mobileChoiceMedia.matches;
  const custom=room.id==='custom',plate=state.result?plateSize(state.result.size):null;
  const previous=roomPresentation;
  // Camera and height are stable throughout either kind of pointer drag.
  let bounds=stage.getBoundingClientRect(),height=bounds.height;
  const adaptive=!custom&&!$('#large-room-dialog').open&&!document.body.classList.contains('keyboard-editing');
  if(adaptive){
    height=drag?.presentation?.stageHeight||(mobile?Math.min(340,Math.round(200+Math.max(0,(plate?.heightMm||0)/(plate?.widthMm||1)-.35)*150)):Math.max(340,Math.min(520,innerHeight-280)));
    if(stage.style.height!==height+'px')stage.style.height=height+'px';
    bounds=stage.getBoundingClientRect();
  }else if(!drag&&stage.style.height){stage.style.removeProperty('height');bounds=stage.getBoundingClientRect();height=bounds.height;}
  const viewport={width:Math.max(1,bounds.width),height:Math.max(1,bounds.height)};
  let frame=null,technical=state.scene==='technical',automatic=false,view;
  if(!custom&&plate&&!technical){
    frame=stockFrame(room,viewport);
    // A wide sign can fit the same finite photograph in a wider-shaped viewport.
    if(!frame.fits&&adaptive&&!drag){
      const wideHeight=Math.max(mobile?150:240,Math.min(height,viewport.width/2));
      if(wideHeight<height&&plate.widthMm>plate.heightMm*2){
        const wideFrame=stockFrame(room,{width:viewport.width,height:wideHeight});
        if(wideFrame.fits){height=wideHeight;viewport.height=height;frame=wideFrame;stage.style.height=height+'px';}
      }
    }
    // Only completed valid geometry may change the automatic presentation mode.
    automatic=!frame.fits;
    if(designRendering||!state.sizeValid)automatic=previous?.room===room.id?previous.automatic:false;
    technical=automatic;
    view=frame.view;
    if(document.body.classList.contains('keyboard-editing')&&previous?.room===room.id){technical=previous.technical;automatic=previous.automatic;view=previous.view;}
  }
  if(custom){
    const camera=cameras.get(room.id)||defaultCamera(room.id),aspect=viewport.width/viewport.height;
    const mobileRoomHeight=$('#large-room-dialog').open?390:320;
    let width=(mobile?Math.min(1000,mobileRoomHeight*aspect):1000)/camera.zoom,h=width/aspect;
    if(h>500){h=500;width=h*aspect;}
    view={x:Math.max(0,Math.min(1000-width,camera.x-width/2)),y:Math.max(0,Math.min(500-h,camera.y+25-h/2)),width,height:h};
    frame={camera,zoom:camera.zoom,maxZoom:4};
  }
  if(!view)view={x:0,y:0,width:1000,height:500};
  let scale=null;
  if(technical){
    const aspect=viewport.width/viewport.height,w=1000,h=w/aspect;
    // Keep text, measurements and the top controls in screen-space clearance.
    view={x:0,y:325-h/2,width:w,height:h};
    if(plate)scale=Math.min((w-2*(mobile?78:110)*w/viewport.width)/plate.widthMm,(h-116*h/viewport.height)/plate.heightMm);
    scale=Math.max(.001,scale||1);
  }
  roomPresentation=drag?.presentation||{room:room.id,technical,automatic,frame,view,scale,stageHeight:height};
  ({technical,automatic,view,scale,frame}=roomPresentation);
  const viewBox=`${view.x} ${view.y} ${view.width} ${view.height}`;
  $('#sign-preview').setAttribute('viewBox',viewBox);$('#sign-preview').setAttribute('preserveAspectRatio','xMidYMid meet');
  $('#room-preview').setAttribute('viewBox',viewBox);stage.dataset.scene=technical?'technical':'wall';
  for(const button of document.querySelectorAll('.scene-tabs button')){button.setAttribute('aria-pressed',button.dataset.scene===(technical?'technical':'wall'));button.textContent=button.dataset.scene==='wall'&&technical?'Zur Raumansicht':button.dataset.scene==='wall'?'Raumansicht':'Detailansicht';}
  $('#camera-controls').hidden=technical;
  $('#camera-out').disabled=!frame||frame.zoom<=1.001;$('#camera-in').disabled=!frame||frame.zoom>=frame.maxZoom-.001;
  const compatibleRooms=automatic?ROOMS.filter(candidate=>sceneAvailable(candidate)&&alternativeRoomFits(candidate,viewport)):[];
  $('#room-fit-scenes').textContent=compatibleRooms.length?'Passenden Hintergrund wählen':'Eigenes Foto verwenden';
  $('#room-fit-note').hidden=!automatic;
  $('#room-fit-note-text').textContent=automatic?'Für dieses Format oder diese Position zeigen wir dein Schild in der Detailansicht. Wähle einen passenden Hintergrund für die Raumvorschau.':'';
  $('#room-fit-reset').hidden=!automatic||!positions.has(room.id);
  if(automatic&&!compatibleRooms.length)$('#room-fit-note-text').textContent='Für dieses Format zeigen wir dein Schild in der Detailansicht. Für die Raumvorschau kannst du ein eigenes Foto mit Referenzmaß verwenden.';
  $('#selected-room').textContent=room.name;$('#open-scenes').title='Hintergrund ändern · '+room.name+(room.id==='custom'?'':' · Raum als Gestaltungsvorschau, nicht vermessen');$('#scene-caption').textContent=technical?'Schild im Detail':room.name;
  $('#scene-note').textContent='';
  $('#scene-note').title=technical?'Die Maßangaben gelten für die gesamten Außenmaße des Schilds.':`Angenommene Bildbreite auf Schildhöhe: ${cm(previewSpanMm(room))} cm. Keine vermessene Raumszene.`;
  for(const button of document.querySelectorAll('[data-room]')){button.setAttribute('aria-pressed',button.dataset.room===room.id);const candidate=ROOMS.find(item=>item.id===button.dataset.room);button.hidden=!sceneAvailable(candidate)||(automatic&&!alternativeRoomFits(candidate,viewport));}
  if(room.id==='custom')$('#scene-note').title=room.calibration?'Eigenes Foto mit deinem Referenzmaß':'Eigenes Foto ohne Referenzmaß';
  $('#scene-strip').classList.toggle('is-tabletop',state.mount==='table-stand');
  const group=$('#preview-room');
  if(technical){group.replaceChildren();return;}
  const roomImage=mobile&&room.mobileImage?room.mobileImage:room.image;
  const roomImageUrl=roomImage?new URL(roomImage,import.meta.url).href:SCENE_IMAGE;
  if(group.dataset.room===room.id&&group.dataset.image===roomImageUrl&&group.children.length)return;
  group.dataset.room=room.id;group.dataset.image=roomImageUrl;group.replaceChildren();
  const crop=svg('svg',{x:0,y:0,width:1000,height:500,viewBox:room.image?'0 0 1000 500':`${room.col*1000} ${room.row*500} 1000 500`,preserveAspectRatio:'xMidYMid meet',overflow:'hidden'});
  const photo=svg('image',{id:'scene-photo',href:roomImageUrl,x:room.photoWidth?(1000-room.photoWidth)/2:0,y:room.photoHeight?(500-room.photoHeight)/2:0,width:room.photoWidth||(room.image?1000:2000),height:room.photoHeight||(room.image?500:2000)});
  if(room.outdoor)photo.setAttribute('preserveAspectRatio','xMidYMid slice');
  photo.addEventListener('error',()=>{$('#scene-note').textContent='Szenenbild nicht verfügbar. Dein Entwurf bleibt sichtbar.';});
  crop.append(photo);group.append(crop);
  group.append(svg('rect',{width:1000,height:500,fill:'#05070a',opacity:room.id==='reception'?.08:.04}));
}
function renderSceneButtons(){
for(const target of ['#scene-grid','#scene-strip']){
$(target).replaceChildren();
for(const room of ROOMS){
  const button=document.createElement('button');button.type='button';button.className='scene-card';button.dataset.room=room.id;button.setAttribute('aria-label',room.name);
  const thumbnail=document.createElement('span');thumbnail.className='scene-thumb';thumbnail.style.setProperty('--scene-x',`${room.col*100}%`);thumbnail.style.setProperty('--scene-y',`${room.row/3*100}%`);
  if(room.image){thumbnail.style.backgroundImage=`url("${room.image}")`;thumbnail.style.backgroundSize='cover';thumbnail.style.backgroundPosition='center';}
  const label=document.createElement('span');label.textContent=room.name;button.append(thumbnail,label);
  button.addEventListener('click',()=>{if(!sceneAvailable(room))return;state.room=room.id;state.scene='wall';paint();if($('#scene-dialog').open)$('#scene-dialog').close();});$(target).append(button);
}
}
}
renderSceneButtons();
$('#open-scenes').addEventListener('click',()=>$('#scene-dialog').showModal());
$('#room-fit-scenes').addEventListener('click',()=>$('#scene-dialog').showModal());
$('#room-fit-reset').addEventListener('click',()=>{positions.delete(state.room);paint();});
for(const button of document.querySelectorAll('[data-dialog]'))button.addEventListener('click',()=>document.getElementById(button.dataset.dialog).showModal());

for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>button.closest('dialog').close());
$('#summary-size-edit').addEventListener('click',()=>{setStep(3,true);$('#sign-width').focus();});
$('#summary-price-details').replaceChildren(document.createTextNode('Deine Auswahl '));
$('#summary-price-details').insertAdjacentHTML('beforeend','<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>');
$('#summary-price-details').setAttribute('aria-label','Deine Auswahl und Preisdetails ansehen');
$('#summary-price-details').setAttribute('aria-controls','order-review');
$('#summary-price-details').addEventListener('click',()=>openOrderReview({overview:true}));
const largeRoom=$('#large-room-dialog'),livePreview=$('.preview-column');
// Mobile uses the same live controls in focused sections, without a second design state.
let activeStep=0;
const mobileLook=$('.studio-mobile-look');
function selectMobileLook(value,navigate=true){
  const previousScroll=window.scrollY;
  const step=value==='size'?3:value==='backing'?4:0;
  if(navigate&&mobileChoiceMedia.matches&&activeStep!==step)setStep(step);
  document.body.dataset.mobileLook=value;
  for(const button of mobileLook.querySelectorAll('button'))button.setAttribute('aria-pressed',button.dataset.mobileLook===value);
  updateStepNavigation();
  requestAnimationFrame(()=>{if(value==='text')fitTextField();fitQuickFontSamples();if(mobileChoiceMedia.matches){const editorTop=$('.editor').getBoundingClientRect().top+window.scrollY;window.scrollTo({top:Math.min(previousScroll,Math.max(0,editorTop)),behavior:'instant'});}});
}
for(const button of mobileLook.querySelectorAll('button'))button.addEventListener('click',()=>selectMobileLook(button.dataset.mobileLook));
selectMobileLook('text');
const mobileExpand=document.createElement('button');mobileExpand.type='button';mobileExpand.id='studio-mobile-expand';
mobileExpand.setAttribute('aria-label','Vorschau vergrößern');mobileExpand.setAttribute('aria-haspopup','dialog');mobileExpand.setAttribute('aria-controls','large-room-dialog');
mobileExpand.innerHTML='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/></svg>';
mobileExpand.insertAdjacentHTML('beforeend','<span>Vorschau vergrößern</span>');
mobileExpand.addEventListener('click',()=>{mobileTools.open=false;$('#open-large-preview').click();});
const studioViewTabs=$('.scene-tabs');
const mobileTools=document.createElement('details');mobileTools.className='studio-mobile-tools';
mobileTools.innerHTML='<summary aria-label="Einsatzbereich, Hintergrund und Vorschau einstellen" title="Einsatzbereich, Hintergrund und Vorschau einstellen"><span id="mobile-scene-label">Raum &amp; Einsatz</span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M9 4v6m6 4v6"/></svg></summary><div class="studio-tools-popover"><strong>Raum &amp; Einsatz</strong></div>';
studioToolbar.append(mobileExpand,mobileTools);
function syncMobileStudio(){
  mobileTools.open=false;textLayout.open=false;
  $('.journey').setAttribute('aria-label',mobileChoiceMedia.matches?'Gestaltung in zwei Schritten':'Gestaltung in drei Schritten');
  $('.journey [data-group="1"]').hidden=mobileChoiceMedia.matches;
  $('.journey [data-group="2"]>span').textContent=mobileChoiceMedia.matches?'2':'3';
  if(mobileChoiceMedia.matches){
    $('.line-height-control').prepend($('.alignment'));
    textLayout.querySelector('summary').setAttribute('aria-label','Textausrichtung und Zeilenabstand einstellen');
    mobileTools.querySelector('.studio-tools-popover').append(studioContext,$('#usage-note'),studioViewTabs,studioSceneActions,mobileExpand,studioFooter);
    $('#saved-current-actions').append(studioDesignTools);
    $('#save-design span').textContent='Aktuellen Entwurf speichern';
    $('#share-design span').textContent='Aktuellen Entwurf teilen';
    $('.editor').prepend($('.journey'));
    $('.studio-palette').append($('.studio-rgb'));
    $('.step-navigation').prepend($('#previous-step'));
  }else{
    textTools.prepend($('.alignment'));
    textLayout.querySelector('summary').setAttribute('aria-label','Zeilenabstand einstellen');
    studioVariantTools.append(studioDesignTools);
    $('#save-design span').textContent='Speichern';$('#share-design span').textContent='Teilen';
    studioToolbar.append(mobileExpand,mobileTools);
    studioToolbar.prepend(studioViewTabs);studioToolbar.insertBefore(studioSceneActions,mobileExpand);livePreview.append(studioFooter);
    $('.workbench-heading').after($('.journey'),studioContext,$('#usage-note'),$('#accessory-migration-note'));
    $('.studio-palette').append($('.studio-rgb'));
    $('.step-navigation').prepend($('#previous-step'));
  }
}
syncMobileStudio();mobileChoiceMedia.addEventListener('change',syncMobileStudio);
document.addEventListener('click',event=>{if(!mobileTools.contains(event.target))mobileTools.open=false;});
mobileTools.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();mobileTools.open=false;mobileTools.querySelector('summary').focus();}});
for(const button of [...studioViewTabs.querySelectorAll('button'),$('#open-scenes'),$('#save-design'),$('#compare-designs'),$('#share-design')])button.addEventListener('click',()=>{mobileTools.open=false;});
new ResizeObserver(()=>{document.documentElement.style.setProperty('--studio-preview-height',`${livePreview.getBoundingClientRect().height}px`);}).observe(livePreview);

const priceDock=$('.design-summary');
new ResizeObserver(()=>{const height=priceDock.getBoundingClientRect().height;if(height>0&&mobileChoiceMedia.matches)document.documentElement.style.setProperty('--price-dock-height',`${height}px`);}).observe(priceDock);
const pagePurchase=$('#page-purchase');
function updatePurchaseDockVisibility(){
  // Desktop needs the full configurator clear of the viewport before the dock appears.
  if(!mobileChoiceMedia.matches){pagePurchase.hidden=$('#main').getBoundingClientRect().bottom>0;return;}
  const action=$('#next-step').getBoundingClientRect();
  const actionVisible=action.top>=0&&action.bottom<=window.innerHeight&&action.width>0;
  pagePurchase.hidden=actionVisible;
}
const purchaseVisibilityObserver=new IntersectionObserver(updatePurchaseDockVisibility,{threshold:[0,1]});
purchaseVisibilityObserver.observe($('#next-step'));purchaseVisibilityObserver.observe($('#main'));
let purchaseScrollFrame=0;
window.addEventListener('scroll',()=>{if(!purchaseScrollFrame)purchaseScrollFrame=requestAnimationFrame(()=>{purchaseScrollFrame=0;updatePurchaseDockVisibility();});},{passive:true});
window.addEventListener('resize',updatePurchaseDockVisibility);
new ResizeObserver(()=>{const height=pagePurchase.getBoundingClientRect().height;if(height)document.documentElement.style.setProperty('--page-purchase-height',`${height}px`);}).observe(pagePurchase);
$('#page-add-to-cart').addEventListener('click',openOrderReview);
for(const link of document.querySelectorAll('[data-resume-design]'))link.addEventListener('click',event=>{
 event.preventDefault();const main=$('#main');main.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 $('.journey [aria-current=step]').focus({preventScroll:true});
});
// The mobile price dock is sticky within the editor and leaves with it.
// Keep its in-flow height when it scrolls out; no observer-driven layout jump.
$('#open-large-preview').addEventListener('click',()=>{
  previewSlot.style.height=livePreview.getBoundingClientRect().height+'px';previewSlot.hidden=false;
  $('#large-room-content').append(livePreview);largeRoom.showModal();document.body.classList.add('room-expanded');paint();
});
largeRoom.addEventListener('close',()=>{
  previewSlot.after(livePreview);previewSlot.hidden=true;document.body.classList.remove('room-expanded');paint();(mobileChoiceMedia.matches?mobileTools.querySelector('summary'):$('#open-large-preview')).focus({preventScroll:true});
});
mobileChoiceMedia.addEventListener('change',()=>{if(largeRoom.open&&!mobileChoiceMedia.matches)largeRoom.close();});
const stepNames=['Text','Schriftart','Leuchtfarbe','Größe','Rückplatte','Montage'];
function visibleSteps(){return state.mode==='logo'?[0,2,3,4,5]:[0,1,2,3,4,5];}
function adjacentStep(delta){const steps=visibleSteps();return steps[Math.max(0,Math.min(steps.length-1,steps.indexOf(activeStep)+delta))];}
function loadBackingPreviews(){
  for(const image of document.querySelectorAll('#panel-4 img[data-src]')){image.src=image.dataset.src;delete image.dataset.src;}
}
function setStep(index,focus=false,{scroll=true}={}){
  if(index===1){if(mobileChoiceMedia.matches)selectMobileLook('font',false);else openFontOverview();index=0;}
  if(index===2){if(mobileChoiceMedia.matches)selectMobileLook('color',false);else openColorGallery();index=0;}
  if(state.mode==='logo'&&index===1)index=0;
  activeStep=index;
  if(index===4)loadBackingPreviews();
  const group=index<3?0:index<5?1:2,previousGroup=Number(document.body.dataset.activeGroup||0);
  document.body.dataset.activeGroup=group;
  const journeyGroup=mobileChoiceMedia.matches&&group===1?0:group;
  if(mobileChoiceMedia.matches){
    if(index===3||index===4)selectMobileLook(index===3?'size':'backing',false);
    else if(index===0&&['size','backing'].includes(document.body.dataset.mobileLook))selectMobileLook('text',false);
    if(scroll&&group===2&&group!==previousGroup)requestAnimationFrame(()=>window.scrollTo({top:$('.editor').getBoundingClientRect().top+window.scrollY,behavior:'instant'}));
  }
  for(let i=0;i<stepNames.length;i++){
    const tab=$('#tab-'+i),inGroup=(i<3?0:i<5?1:2)===group;
    tab.hidden=!inGroup||(state.mode==='logo'&&i===1);
    tab.setAttribute('aria-selected',i===index);tab.tabIndex=i===index?0:-1;
    $('#panel-'+i).hidden=i!==index;
  }
  for(const b of document.querySelectorAll('[data-group]')){
    if(Number(b.dataset.group)===journeyGroup)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');
  }
  $('#group-kicker').textContent=['01 / DEIN LOOK','02 / FORMAT','03 / ZUBEHÖR'][group];
  $('#group-title').textContent=['Dein Look','Dein Format','Dein Zubehör'][group];
  $('#group-help').textContent=['Text, Schrift und Farbe machen es zu deinem Schild.','Vergleiche Größen und wähle die passende Rückplatte.','Wähle, wie du dein Schild befestigen möchtest.'][group];
  $('#next-step').disabled=false;
  $('#next-step-label').textContent=['Weiter zum Format','Weiter zum Zubehör','Entwurf prüfen'][group];
  updateStepNavigation();
  $('#step-count').textContent=mobileChoiceMedia.matches?`${group===2?2:1} von 2`:`${group+1} von 3`;
  $('#editor-step-title').textContent=stepNames[index];$('#editor-step-hint').textContent='';
  $('.editor-panels').scrollTop=0;
  for(const button of document.querySelectorAll('[data-canvas-step]'))button.setAttribute('aria-pressed',Number(button.dataset.canvasStep)===index);
  if(index===1&&!$('#font-grid').children.length)openFontLibrary('neon');
  if(focus){
    const target=mobileChoiceMedia.matches?(index===5?$('#mount-options button'):index===0&&document.body.dataset.mobileLook==='text'?$('#sign-text'):mobileLook.querySelector('[aria-pressed=true]')):index===0?$('#sign-text'):$('#tab-'+index);
    target.focus({preventScroll:true});
  }

  revealActiveTab();
  if(group===1&&state.result)refreshPresetSizes();
  if(index===0)requestAnimationFrame(fitTextField);
  if(scroll&&!mobileChoiceMedia.matches)requestAnimationFrame(()=>{
    const panel=$('#panel-'+activeStep).getBoundingClientRect(),nav=$('.journey').getBoundingClientRect();
    if(panel.top<nav.bottom+8||panel.top>window.innerHeight-120){
      window.scrollTo({top:Math.max(0,$('.editor').getBoundingClientRect().top+window.scrollY-12),behavior:'instant'});
    }
  });
}
function revealActiveTab(){
  if(!matchMedia('(max-width:760px)').matches)return;
  const tab=$('#tab-'+activeStep),bar=tab.parentElement,t=tab.getBoundingClientRect(),b=bar.getBoundingClientRect();
  if(t.left<b.left+8)bar.scrollLeft+=t.left-b.left-8;else if(t.right>b.right-8)bar.scrollLeft+=t.right-b.right+8;
}
for(let i=0;i<stepNames.length;i++){
  const tab=$('#tab-'+i);tab.addEventListener('click',()=>setStep(i));
  tab.addEventListener('keydown',event=>{const steps=visibleSteps().filter(s=>(s<3?0:s<5?1:2)===(i<3?0:i<5?1:2)),at=steps.indexOf(i);let next=i;if(event.key==='ArrowRight')next=steps[(at+1)%steps.length];else if(event.key==='ArrowLeft')next=steps[(at+steps.length-1)%steps.length];else if(event.key==='Home')next=steps[0];else if(event.key==='End')next=steps.at(-1);else return;event.preventDefault();setStep(next,true);});
}
function updateStepNavigation(){
  const group=Number(document.body.dataset.activeGroup||0);
  let label=activeStep===3?'Weiter zur Rückplatte':['Weiter zum Format','Weiter zum Zubehör','Entwurf prüfen'][group];
  if(mobileChoiceMedia.matches){
    if(group===0){const look=document.body.dataset.mobileLook||'text';label=look==='text'?(state.mode==='logo'?'Weiter zur Farbe':'Weiter zur Schrift'):look==='font'?'Weiter zur Farbe':'Weiter zur Größe';}
    else if(activeStep===3)label='Weiter zur Rückplatte';
  }
  $('#next-step-label').textContent=label;
  let previous=group===2?'Zurück zur Rückplatte':activeStep===4?'Zurück zur Größe':group===1?'Zurück zum Look':'';
  if(mobileChoiceMedia.matches){
    const look=document.body.dataset.mobileLook||'text';
    previous=group===2?'Zurück zur Rückplatte':activeStep===4?'Zurück zur Größe':activeStep===3?'Zurück zur Farbe':look==='color'?(state.mode==='logo'?'Zurück zum Logo':'Zurück zur Schrift'):look==='font'?'Zurück zum Text':'';
  }
  $('#previous-step').textContent=previous;
  $('#previous-step').hidden=!previous;$('#previous-step').disabled=!previous;
}
mobileChoiceMedia.addEventListener('change',()=>setStep(activeStep,false,{scroll:false}));
function navigateStep(direction){
  const group=activeStep<3?0:activeStep<5?1:2;
  setStep([0,3,5][Math.max(0,Math.min(2,group+direction))],true);
  if(mobileChoiceMedia.matches)requestAnimationFrame(()=>$('.editor').scrollIntoView({block:'start',behavior:'instant'}));
}
for(const b of document.querySelectorAll('[data-group]'))b.addEventListener('click',()=>setStep([0,3,5][Number(b.dataset.group)]));
$('#previous-step').addEventListener('click',()=>{
  if(mobileChoiceMedia.matches){
    const look=document.body.dataset.mobileLook||'text';
    selectMobileLook(activeStep===5?'backing':activeStep===4?'size':activeStep===3?'color':look==='color'&&state.mode!=='logo'?'font':'text');
    mobileLook.querySelector('[aria-pressed=true]').focus({preventScroll:true});
    return;
  }
  if(activeStep===5){setStep(4,true);return;}
  if(activeStep===4){setStep(3,true);return;}
  navigateStep(-1);
});
$('#next-step').addEventListener('click',()=>{
  if(mobileChoiceMedia.matches){
    if(activeStep===0&&document.body.dataset.mobileLook!=='color'){
      selectMobileLook(document.body.dataset.mobileLook==='text'&&state.mode!=='logo'?'font':'color');return;
    }
  }
  if(activeStep===3){setStep(4,true);return;}
  activeStep===stepNames.length-1?openOrderReview():navigateStep(1);
});

function syncDesignMode(){
  const isLogo=state.mode==='logo';
  motifHeading.hidden=isLogo;
  mobileLook.querySelector('[data-mobile-look=text]').textContent=isLogo?'Logo':'Text';mobileLook.querySelector('[data-mobile-look=font]').hidden=isLogo;
  if(isLogo&&document.body.dataset.mobileLook==='font')selectMobileLook('text');
  studioFonts.hidden=isLogo;$('#text-count').hidden=isLogo;$('#look-font').hidden=isLogo;$('#text-settings').hidden=isLogo;$('#logo-settings').hidden=!isLogo;$('#tab-1').hidden=isLogo;document.querySelector('[data-canvas-step="1"]').hidden=isLogo;
  $('#tab-0 .choice-label').textContent=isLogo?'Logo':'Text';$('#tab-0').setAttribute('aria-label',isLogo?'Logo ändern':'Dein Text ändern');
  $('#summary-font').previousElementSibling.textContent=isLogo?'Motiv':'Schriftart';
  $('#summary-size').previousElementSibling.textContent='Gesamte Außenmaße';
  $('#tab-3 .choice-label').textContent='Größe';
  $('#tab-3').setAttribute('aria-label','Gesamte Außenmaße ändern');
  $('#size-motif-label').textContent='Beliebte Größen · inkl. MwSt.';
  $('label[for="width-slider"]').textContent='Gesamte Außenbreite des Schilds';
  $('#size-calculation-help').textContent='Die Außenmaße umfassen Motiv, Träger und gegebenenfalls Tischständer. Die zweite Seite wird proportional berechnet.';
  const asset=state.logo&&draftAssets.get(state.logo.assetId);
  $('#logo-original').hidden=!asset;
  if(asset){$('#logo-original').src=asset.url;$('#logo-original').alt='Originaldatei: '+state.logo.name;$('#logo-file-name').textContent=state.logo.name;}
  else{$('#logo-original').removeAttribute('src');$('#logo-file-name').textContent='Noch kein Logo ausgewählt';}
  $('#logo-download-original').hidden=!state.logo?.originalAssetId;
  setStep(activeStep,false,{scroll:false});
}
// Keep old logo drafts and their original files readable; new designs use text only.
$('#legacy-logo-text').addEventListener('click',()=>{
  logoSelectionRevision++;state.mode='text';syncDesignMode();update();$('#sign-text').focus();
});
$('#logo-download-original').addEventListener('click',async()=>{try{const asset=await getDraftAsset(state.logo.originalAssetId,'original'),url=URL.createObjectURL(asset.file),a=document.createElement('a');a.href=url;a.download=state.logo.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch{$('#logo-status').textContent='Die Originaldatei konnte nicht geladen werden.';}});


// A local immutable review snapshot. Future checkout must validate/reprice on the
// server; neither these browser values nor its geometry authorize a paid order.
let orderSnapshot=null,orderDesign=null,orderReviewRevision=0;
function captureOrderSnapshot(){
  const result=state.result;if(!result||!state.sizeValid)throw new Error('Bitte erstelle zuerst einen gültigen Entwurf.');
  const words=state.words.map(word=>({...word,color:{...wordColor(word)}}));
  const characterSummary=new Map();if(state.mode!=='logo')for(const glyph of result.layout.glyphs){const target=state.characters.find(c=>c.key===glyph.colorKey);if(!target)continue;const color=glyphColor(glyph),fallback=glyph.charMapping==='line-fallback',word=state.words.find(w=>w.lineIndex===glyph.lineIndex&&w.wordIndex===glyph.wordIndex);characterSummary.set(glyph.colorKey+':'+(fallback?glyph.wordIndex:'')+':'+color.id,{...target,text:fallback?(word?.text||target.text):target.text,color:{...color}});}
  return structuredClone({
    text:designName(),mode:state.mode,lightMode:state.lightMode,characters:[...characterSummary.values()],logo:state.logo?{...state.logo}:null,font:{id:state.fontId,name:state.mode==='logo'?'Eigenes Logo':state.font,source:state.mode==='logo'?null:state.fontSource,uploaded:state.mode!=='logo'&&state.fontId.startsWith('upload-')},
    alignment:state.alignment,lineHeight:state.lineHeight,words,
    sign:{...result.size.exact.design,tubeMm:result.layout.tubeMm,
      glyphs:result.layout.glyphs.map(glyph=>({lineIndex:glyph.lineIndex,wordIndex:glyph.wordIndex,
        color:glyphColor(glyph),charIndex:glyph.charIndex,charText:glyph.charText,charLength:glyph.charLength,charMapping:glyph.charMapping,
        centerlineD:glyph.centerlineD,paths:glyph.paths}))},
    plate:{type:state.backing,name:BACKINGS[state.backing].name,finish:{...state.plateFinish},...plateSize(result.size),path:plateContour(result),
      base:basePlateSize(result.size),marginMm:state.backing==='contour'?CONTOUR_MARGIN_MM:15,
      acrylicThicknessMm:MANUFACTURING_PROFILE.acrylicThicknessMm},
    mount:{id:state.mount,...MOUNTS[state.mount],valid:state.mount==='table-stand'?standFits():state.mount==='hanging-kit'?state.backing!=='freestanding':true},
    power:{cableDiameterMm:6,cableLengthMm:2000,cableColor:'transparent',powerSupplyBrand:'NEONTRIP',plug:'Schuko'},
    production:{...result.production,manufacturingApproved:false},materialProfile:{...MANUFACTURING_PROFILE},
    presentation:{light:state.light},...priceOptions(state),price:priceForResult(state,result)
  });
}
let previewCloneId=0;
function withoutWallHardware(source){
  if(!source.includes('data-mount-preview'))return source;
  const document=new DOMParser().parseFromString(source,'image/svg+xml');
  if(document.querySelector('parsererror'))return source;
  for(const node of document.querySelectorAll('[data-mount-preview="wall-mount"]'))node.remove();
  return new XMLSerializer().serializeToString(document.documentElement);
}
function orderPreview(){
  const prefix=`preview-copy-${++previewCloneId}-`;
  const preview=$('#sign-preview').cloneNode(true),art=preview.querySelector('#preview-art');
  // Retain the exact paths, light layers, plate and selected hardware. Scene-only
  // hanging wires, room images, drag handles and measurement overlays are omitted.
  for(const id of ['preview-room','preview-dimensions','preview-handles'])preview.querySelector('#'+id)?.remove();
  for(const node of [...art.children])if(!['defs','use'].includes(node.localName)&&node.id!=='backing-plate'&&!node.hasAttribute('data-mount-preview'))node.remove();
  const box=previewBox,pad=Math.max(28,box.width*.08);
  preview.setAttribute('viewBox',`${box.x-pad} ${box.y-pad} ${box.width+2*pad} ${box.height+2*pad+12}`);
  preview.setAttribute('preserveAspectRatio','xMidYMid meet');preview.setAttribute('role','img');
  preview.setAttribute('aria-label',`${designName()}, Außenmaße ${dimensions(plateSize(state.result.size))}, ${MOUNTS[state.mount].name}`);
  if(state.lightMode==='rgb'&&state.light){
    preview.setAttribute('data-rgb-snapshot','true');const style=svg('style');style.textContent='[data-rgb-snapshot] .rgb-neon{stroke:#ff2a4d;animation:neon-rgb-snapshot 14s linear infinite'+(rgbPaused?';animation-play-state:paused':'')+'}@keyframes neon-rgb-snapshot{0%,100%{stroke:#ff2a4d}14.28%{stroke:#ffd62e}28.57%{stroke:#0bd748}42.85%{stroke:#24b7de}57.14%{stroke:#0274fc}71.42%{stroke:#8c59ff}85.71%{stroke:#ff5ce8}}@media(prefers-reduced-motion:reduce){[data-rgb-snapshot] .rgb-neon{animation:none}}';preview.append(style);
  }
  const ids=new Map([...preview.querySelectorAll('[id]'),preview].filter(e=>e.id).map(e=>[e.id,`${prefix}${e.id}`]));
  for(const e of [preview,...preview.querySelectorAll('*')])for(const attr of [...e.attributes]){
    let value=attr.value;if(attr.name==='id')value=ids.get(value);
    else{for(const [id,next] of ids){value=value.replaceAll(`url(#${id})`,`url(#${next})`);if((attr.name==='href'||attr.name==='xlink:href')&&value===`#${id}`)value=`#${next}`;}}
    e.setAttribute(attr.name,value);
  }
  return preview;
}
function paintArSection(){
  const host=$('#ar-customer-design'),valid=!designRendering&&state.result&&state.sizeValid;
  if(!valid){host.replaceChildren();$('#config-ar-size').textContent=designRendering?'Dein Entwurf wird aktualisiert …':'Gib einen gültigen Entwurf ein, um die Vorschau zu nutzen.';return;}
  const preview=orderPreview();
  for(const [name,value] of Object.entries({x:318,y:227,width:420,height:250}))preview.setAttribute(name,value);
  host.replaceChildren(preview);
  $('#config-ar-size').textContent=`Dein Entwurf · ${dimensions(plateSize(state.result.size))}`;
}
function orderRow(label,value,step){
  const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;
  if(value instanceof Node)dd.append(value);else dd.textContent=value;
  if(step!==undefined){const button=document.createElement('button');button.type='button';button.textContent='Ändern';button.setAttribute('aria-label',`${label} ändern`);button.dataset.orderEdit=step;row.append(dt,dd,button);}else row.append(dt,dd);
  return row;
}
function snapshotColorEntries(snapshot){
  return snapshot.characters?.length?snapshot.characters:snapshot.words||[];
}
function snapshotColors(snapshot){
  const entries=snapshotColorEntries(snapshot);
  const colors=entries.length?entries.map(entry=>entry.color):snapshot.sign.glyphs.map(glyph=>glyph.color);
  return [...new Map(colors.map(color=>[color.id||color.name,color])).values()];
}
function snapshotColorSummary(snapshot){
  if(snapshot.lightMode==='rgb')return 'RGB-Farbwechsel · ohne Warmweiß';
  const names=snapshotColors(snapshot).map(color=>color.name);
  return names.length===1?names[0]:names.length?`${names.length} Farben: ${names.join(', ')}`:'Farbe nicht verfügbar';
}
function orderColorDisplay(snapshot){
  const label=snapshotColorSummary(snapshot);
  if(snapshot.lightMode==='rgb'||snapshotColors(snapshot).length<2)return label;
  const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ul');
  details.className='order-color-details';summary.textContent=label;list.className='order-word-colors';
  for(const entry of snapshotColorEntries(snapshot)){
    const item=document.createElement('li'),dot=document.createElement('i'),name=document.createElement('span');
    dot.style.background=entry.color.color;dot.setAttribute('aria-hidden','true');name.textContent=`${entry.text} – ${entry.color.name}`;
    item.append(dot,name);list.append(item);
  }
  details.append(summary,list);return details;
}
async function openOrderReview({overview=false}={}){
  const token=++orderReviewRevision,dialog=$('#order-review');orderSnapshot=null;orderDesign=null;
  dialog.classList.toggle('selection-overview',overview);dialog.scrollTop=0;
  $('#order-title').textContent=overview?'Deine Auswahl':'Alles so, wie du es möchtest?';
  $('#order-review .dialog-intro').textContent=overview?'Dein Schild auf einen Blick. Jede Auswahl lässt sich ändern.':'Prüfe Schriftzug, Maße und Ausstattung deines Entwurfs.';

  $('#order-content').hidden=true;$('#order-status').textContent='Dein Entwurf wird geprüft …';
  if(!dialog.open)dialog.showModal();
  clearTimeout(timer);await update();
  if(token!==orderReviewRevision||!dialog.open)return;
  if(!state.result){$('#order-status').textContent=$('#preview-state').textContent||'Bitte prüfe deinen Entwurf.';return;}
  try{
    const snapshot=captureOrderSnapshot();orderSnapshot=snapshot;orderDesign=structuredClone(captureDesign());$('#review-add-to-cart').disabled=!cartReady||!snapshot.mount.valid||snapshot.price.status!=='calculated';$('#review-add-to-cart').textContent=editingCartId?'Änderungen übernehmen':'In den Warenkorb';
    $('#order-preview').replaceChildren(orderPreview());$('.order-preview-caption').textContent=(state.light?'Eingeschaltet. ':'Ausgeschaltet. ')+'Dein Schild ohne Raumfoto. Farbe und Leuchtwirkung können am Bildschirm abweichen.';
    $('#order-specifications').replaceChildren(
      orderRow(snapshot.mode==='logo'?(overview?'Dein Logo':'Dein Logo'):(overview?'Dein Text':'Dein Text'),snapshot.text,0),orderRow(snapshot.mode==='logo'?'Motiv':'Schriftart',snapshot.font.name+(snapshot.font.source?' · freier Schriftkatalog':snapshot.font.uploaded?' · eigene Schrift':''),snapshot.mode==='logo'?0:1),
      orderRow('Leuchtfarben',orderColorDisplay(snapshot),2),orderRow('Einsatzbereich',snapshot.outdoor?'Außen':'Innen',0),orderRow('Gesamte Außenmaße (B × H)',dimensions(snapshot.plate),3),
      orderRow(overview?'Rückplatte':'Träger',snapshot.plate.name+' · '+finishName(snapshot.plate.finish),4),
      orderRow('Montage',snapshot.mount.name,5)
    );
    if(snapshot.mount.id!=='none'){
      const description=document.createElement('p');description.className='order-mount-description';description.textContent=snapshot.mount.description;
      if(snapshot.mount.id==='adhesive-kit')description.textContent+=adhesiveOver100()?' Ab 100 cm keine dauerhafte Lösung; Untergrund und Befestigung müssen geprüft werden.':' Nur für vorübergehende Befestigung auf geeignetem Untergrund.';
      $('#order-specifications').lastElementChild.querySelector('dd').append(description);
    }
    const usageButton=$('#order-specifications').children[3].querySelector('button');usageButton.dataset.orderTarget='usage';
    const counts=accessoryCounts(snapshot),accessoryNames={'wall-mount':'Wandmontage-Set','hanging-kit':'Drahtseil-Abhängeset','adhesive-kit':'3M-Klebeset','table-stand':'Tischständer',dimmer:'Dimmer mit Fernbedienung',extraCable2m:'Weitere 2 m Kabel','premium-white':'Premium-Netzteil'};
    const accessories=Object.entries(counts).filter(([,n])=>n>0).map(([key,n])=>`${n} × ${accessoryNames[key]}${['wall-mount','premium-white','dimmer'].includes(key)?' (1 inklusive)':''}`);
    accessories.push('2 m Anschlusskabel inklusive');
    $('#order-specifications').append(orderRow('Zubehör pro Schild',accessories.join('\n'),5));
    $('#order-production-note').textContent=$('#production-note').textContent+(snapshot.mount.valid?'':' Die ausgewählte Montage passt nicht zur aktuellen Größe. Bitte ändere die Montage.');
    $('#review-quantity').value=cartItems.find(item=>item.id===editingCartId)?.quantity||1;
    renderPriceValue($('#order-review .order-purchase strong'),snapshot.price,Number($('#review-quantity').value));
    $('#order-price-detail').textContent=priceDetail(snapshot.price);
    $('#order-status').textContent='';$('#order-content').hidden=false;
  }catch(error){$('#order-status').textContent=error.message;}
}
$('#open-order-review').addEventListener('click',openOrderReview);
let arController=null,arRevision=0;
async function openArPreview(){
  const token=++arRevision,dialog=$('#ar-dialog');arController?.dispose();arController=null;
  $('#ar-host').replaceChildren();$('#ar-status').textContent='Dein Schild wird in Originalmaßen für 3D und AR vorbereitet …';$('#ar-start').disabled=true;$('#ar-size').textContent='';
  dialog.showModal();dialog.scrollTop=0;clearTimeout(timer);await update();
  if(token!==arRevision||!dialog.open)return;
  try{
    const snapshot=captureOrderSnapshot();
    $('#ar-size').textContent=`Gesamte Außenmaße: ${dimensions(snapshot.plate)} · ${snapshot.plate.name}`;
    if(snapshot.lightMode==='rgb'){$('#ar-size').textContent+=' · RGB als statische Rotphase';snapshot.sign.glyphs.forEach(g=>g.color={...COLORS.find(c=>c.id==='red')});}
    const {prepareArPreview}=await import('./ar-preview.js?v=20261005-refine1');
    if(token!==arRevision||!dialog.open)return;
    const controller=await prepareArPreview(snapshot,$('#ar-host'));
    if(token!==arRevision||!dialog.open){controller.dispose();return;}
    arController=controller;$('#ar-status').textContent=controller.availabilityMessage;$('#ar-start').disabled=!controller.canActivateAR;
    controller.element.addEventListener('ar-status',event=>{
      if(token!==arRevision)return;
      const status=event.detail?.status;
      if(status==='failed')$('#ar-status').textContent='AR konnte nicht gestartet werden. Dein Entwurf bleibt erhalten.';
      if(status==='object-placed')$('#ar-status').textContent='Schild platziert. Die konfigurierte Größe bleibt fest eingestellt.';
      if(status==='not-presenting')$('#ar-status').textContent=controller.availabilityMessage;
    });
  }catch(error){if(token===arRevision)$('#ar-status').textContent=error.message||'Die 3D-Vorschau ist derzeit nicht verfügbar.';}
}
let shareRevision=0,shareAbort,sharePending=false,shareExpiresAt=0;
const mobileAr=/iPhone|iPad|iPod|Android/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const arSharePanel=$('#ar-share-panel');
function openCurrentDesignAr(){
 if($('#stage-ar').disabled)return;
 mobileTools.open=false;
 if(mobileAr||state.mount==='table-stand'){openArPreview();return;}
 const dialog=$('#ar-share-dialog');$('#ar-share-dialog-content').append(arSharePanel);
 if(!dialog.open)dialog.showModal();
 openArShare();
}
$('#stage-ar').addEventListener('click',openCurrentDesignAr);
$('#config-ar-start').addEventListener('click',openCurrentDesignAr);
$('#ar-share-retry').addEventListener('click',openArShare);
$('#ar-share-dialog').addEventListener('close',()=>{
 if(sharePending){shareRevision++;shareAbort?.abort();sharePending=false;shareDesignKey=null;arSharePanel.hidden=true;}
});
async function openArShare(){
 $('#ar-share-panel').hidden=false;
 if(sharePending)return;
 if(shareDesignKey===JSON.stringify(captureDesign())&&shareExpiresAt>Date.now()&&!$('#ar-share-qr').hidden)return;
 sharePending=true;shareExpiresAt=0;$('#ar-share-retry').hidden=true;
 const token=++shareRevision;shareAbort?.abort();shareAbort=new AbortController();shareDesignKey=null;
 $('#ar-share-status').textContent='Dein aktueller Entwurf wird vorbereitet …';$('#ar-share-qr').hidden=true;$('#ar-share-placeholder').hidden=false;$('#ar-share-link').hidden=true;
 try{
  clearTimeout(timer);await update();if(token!==shareRevision)return;
  const snapshot=captureOrderSnapshot();
  shareDesignKey=JSON.stringify(captureDesign());
  if(snapshot.lightMode==='rgb')snapshot.sign.glyphs.forEach(g=>g.color={...COLORS.find(c=>c.id==='red')});
  const {createArShare,renderShareQr}=await import('./ar-share.js?v=20261008-anfrage1');
  if(token!==shareRevision)return;
  const result=await createArShare(snapshot,{signal:shareAbort.signal});if(token!==shareRevision)return;
  await renderShareQr($('#ar-share-qr'),result.shareUrl);if(token!==shareRevision)return;
  shareExpiresAt=Date.parse(result.expiresAt);
  $('#ar-share-link').href=result.shareUrl;$('#ar-share-link').hidden=false;$('#ar-share-qr').hidden=false;$('#ar-share-placeholder').hidden=true;
  $('#ar-share-status').textContent='Bereit. Gültig bis '+new Intl.DateTimeFormat('de-DE',{dateStyle:'short',timeStyle:'short'}).format(new Date(result.expiresAt))+(snapshot.lightMode==='rgb'?' · RGB wird als statische Rotphase gezeigt.':'');
 }catch(error){if(token===shareRevision){shareDesignKey=null;$('#ar-share-status').textContent=error.message||'Die Modellfreigabe konnte nicht erstellt werden. Bitte versuche es erneut.';$('#ar-share-retry').hidden=false;}}
 finally{if(token===shareRevision){sharePending=false;}}
}
$('#ar-start').addEventListener('click',()=>{
  if(!arController?.canActivateAR)return;
  const token=arRevision;arController.activateAR().catch(error=>{if(token===arRevision)$('#ar-status').textContent=error.message||'AR konnte nicht gestartet werden.';});
});
$('#ar-dialog').addEventListener('close',()=>{arRevision++;arController?.dispose();arController=null;$('#ar-host').replaceChildren();$('#ar-start').disabled=true;});
$('#order-review').addEventListener('close',()=>{orderReviewRevision++;orderSnapshot=null;orderDesign=null;});
$('#order-review').addEventListener('click',event=>{
  const button=event.target.closest('[data-order-edit]');if(!button)return;
  const step=Number(button.dataset.orderEdit);
  $('#order-review').close();
  if(step===0)selectMobileLook('text');
  setStep(step,true);
  if(step===0)requestAnimationFrame(()=>{
    if(button.dataset.orderTarget==='usage'&&mobileChoiceMedia.matches)mobileTools.open=true;
    const target=button.dataset.orderTarget==='usage'?$('#usage-options button[aria-pressed=true]'):state.mode==='logo'?$('#legacy-logo-text'):$('#sign-text');
    target.focus({preventScroll:true});target.scrollIntoView({block:'center',behavior:'instant'});
  });
});


// Reuse the existing IndexedDB store; this is a local cart, never a paid order.
const CART_STORAGE_KEY='neontrip-local-cart-v1';
const cartCompareIds=new Set();
let cartItems=[],cartReady=false,cartPricesValid=false,cartWriteRevision=0,editingCartId=null,cartEditing=false,cartSyncing=false,cartTotals=null;
const checkoutApiOrigin=new URL(document.querySelector('meta[name=neontrip-ar-endpoint]')?.content||'/api/public/configurator/ar',window.location.href).origin;
const checkoutClient=createCheckoutClient({
  apiBaseUrl:checkoutApiOrigin===window.location.origin?'':checkoutApiOrigin,
  readSession:()=>readAsset(CHECKOUT_SESSION_KEY),
  saveSession:token=>saveAssetIfMissing(CHECKOUT_SESSION_KEY,token),
  readVisitorConsent:()=>cookiebotVisitorConsent(window.Cookiebot),
  readFile:async(id,kind)=>(await getDraftAsset(id,kind)).file
});
function refreshCartButtons(){
  const count=cartItems.reduce((n,item)=>n+item.quantity,0);
  $('#cart-count').textContent=String(count);$('#header-cart-count').textContent=String(count);
  $('#header-cart').setAttribute('aria-label',`Warenkorb öffnen, ${count} Artikel`);
  $('#add-to-cart').disabled=!cartReady;
  $('#add-to-cart').lastChild.textContent=editingCartId?'Änderungen prüfen':'Entwurf prüfen';
  $('#review-add-to-cart').disabled=!cartReady||!orderSnapshot?.mount.valid||orderSnapshot?.price.status!=='calculated';
  $('#cart-request-quote').disabled=!cartReady||!cartItems.length||!cartPricesValid||cartSyncing||cartEditing;
  $('#cart-delivery-open').disabled=!cartReady||!cartItems.length||!cartPricesValid||cartSyncing||cartEditing;
  const hasUnapprovedCarrier=cartItems.some(item=>item.snapshot.plate.type==='freestanding');
  $('#prepare-checkout').disabled=!cartReady||!cartItems.length||!cartPricesValid||cartSyncing||cartEditing||hasUnapprovedCarrier||!selectedDelivery;
  $('#cart-pay').disabled=$('#prepare-checkout').disabled;
  if(hasUnapprovedCarrier)$('#checkout-preparation-status').textContent='Freigestellte Acrylstreben können erst nach technischer Prüfung an die Angebotserstellung übergeben werden. Der Entwurf bleibt auf diesem Gerät gespeichert.';
}
async function persistCart(){
  const revision=++cartWriteRevision;
  const saved=structuredClone({version:1,items:cartItems,editingId:editingCartId,deliveryDateIso:selectedDelivery?.dateIso||null,deliveryBusinessDays:selectedDelivery?.businessDays||null});
  try{
    const refs=new Map();
    for(const item of saved.items){if(item.design.photo?.assetId)refs.set(item.design.photo.assetId,'photo');if(item.design.fontId?.startsWith('upload-'))refs.set(item.design.fontId,'font');if(item.design.logo?.assetId)refs.set(item.design.logo.assetId,'logo');if(item.design.logo?.originalAssetId)refs.set(item.design.logo.originalAssetId,'original');}
    for(const [id,kind] of refs){const asset=await getDraftAsset(id,kind);if(!asset.persisted){await saveAsset(id,asset.file);asset.persisted=true;}}
    if(revision!==cartWriteRevision)return;
    await saveAsset(CART_STORAGE_KEY,saved);
    if(revision===cartWriteRevision)$('#cart-storage-status').textContent='Auf diesem Gerät gespeichert. Noch keine Bestellung.';
  }catch{
    if(revision===cartWriteRevision)$('#cart-storage-status').textContent='Warenkorb nur in diesem Tab verfügbar. Speichern auf diesem Gerät nicht möglich.';
  }
}
function accessorySummary(design,multiplier=1){
 const names={'wall-mount':'Wandmontage-Set','premium-white':'Premium-Netzteil','hanging-kit':'Abhängeset','adhesive-kit':'Klebeset','table-stand':'Tischständer',dimmer:'Dimmer',extraCable2m:'2 m Zusatzkabel'};
 return Object.entries(accessoryCounts(design)).filter(([,n])=>n>0).map(([key,n])=>(n*multiplier)+' × '+names[key]).join(' · ');
}
function renderCart(){
  $('#checkout-preparation-status').textContent='';
  for(const id of cartCompareIds)if(!cartItems.some(item=>item.id===id))cartCompareIds.delete(id);
  const list=$('#cart-items');list.replaceChildren();
  for(const item of cartItems){
    const card=document.createElement('article');card.className='cart-item';card.dataset.itemId=item.id;
    const picture=document.createElement('img');picture.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(withoutWallHardware(item.previewSvg));picture.alt=`Entwurf: ${item.snapshot.text}`;picture.className='cart-item-preview';
    const body=document.createElement('div'),heading=document.createElement('h3'),summary=document.createElement('p'),colors=document.createElement('p'),price=document.createElement('div');
    heading.textContent=item.snapshot.text;summary.textContent=`${item.snapshot.font.name} · Außenmaße ${dimensions(item.snapshot.plate)} · ${item.snapshot.plate.name} · ${finishName(item.snapshot.plate.finish)} · ${item.snapshot.mount.name}`;
    colors.className='cart-colors';colors.textContent=snapshotColorSummary(item.snapshot);
    const accessoryLine=document.createElement('p');accessoryLine.className='cart-accessories';accessoryLine.textContent='Je Schild: '+accessorySummary(item.design);
    if(item.quantity>1){const total=document.createElement('span');total.className='cart-accessory-total';total.textContent='Insgesamt für '+item.quantity+' Schilder: '+accessorySummary(item.design,item.quantity);accessoryLine.append(document.createElement('br'),total);}
    price.textContent='Wird berechnet …';price.className='cart-item-price';
    displayStoredPrice(price,item.design,item.quantity,{cartLine:true});
    const controls=document.createElement('div');controls.className='cart-item-controls';
    const label=document.createElement('label'),qty=document.createElement('input');label.textContent='Menge';qty.type='number';qty.min='1';qty.max='99';qty.step='1';qty.value=item.quantity;qty.dataset.cartQuantity=item.id;qty.setAttribute('aria-label',`Menge für ${item.snapshot.text}`);label.append(qty);controls.append(label);
    for(const [action,text] of [['edit','Bearbeiten'],['remove','Entfernen']]){const button=document.createElement('button');button.type='button';button.dataset.cartAction=action;button.dataset.itemId=item.id;button.textContent=text;button.setAttribute('aria-label',`${item.snapshot.text}: ${text}`);controls.append(button);}
    const compareLabel=document.createElement('label'),compareCheck=document.createElement('input');compareLabel.className='cart-compare-choice';compareCheck.type='checkbox';compareCheck.dataset.cartCompare=item.id;compareCheck.checked=cartCompareIds.has(item.id);compareCheck.setAttribute('aria-label',item.snapshot.text+' zum Vergleich auswählen');compareLabel.append(compareCheck,document.createTextNode('Zum Vergleich auswählen'));
    body.append(heading,summary,colors,accessoryLine,price,controls,compareLabel);card.append(picture,body);list.append(card);
  }
  updateCartComparison();refreshCartPrice();
  $('#cart-empty').hidden=cartItems.length>0;$('#cart-checkout').hidden=!cartItems.length;refreshCartButtons();
}
function updateCartComparison(){
 $('#cart-compare-bar').hidden=cartItems.length<2;
 $('#cart-compare').disabled=cartCompareIds.size!==2;
 $('#cart-compare-status').textContent=cartCompareIds.size+' von 2 Entwürfen ausgewählt';
}
$('#cart-items').addEventListener('change',event=>{
 const id=event.target.dataset.cartCompare;if(!id)return;
 if(event.target.checked&&cartCompareIds.size>=2){event.target.checked=false;$('#cart-compare-status').textContent='Bitte zuerst eine Auswahl aufheben.';return;}
 event.target.checked?cartCompareIds.add(id):cartCompareIds.delete(id);updateCartComparison();
});
$('#cart-compare').addEventListener('click',()=>{
 if(cartCompareIds.size!==2)return;
 const records=cartItems.filter(item=>cartCompareIds.has(item.id)).map(item=>({
  name:item.snapshot.text,design:item.design,preview:item.previewSvg,size:dimensions(item.snapshot.plate),font:item.snapshot.font.name,
  color:snapshotColorSummary(item.snapshot),backing:item.snapshot.plate.name,finish:finishName(item.snapshot.plate.finish),mount:item.snapshot.mount.name
 }));
 showComparison(records);
});
function showCart(){renderCart();if(!$('#cart-dialog').open)$('#cart-dialog').showModal();}
$('#cart-continue').addEventListener('click',()=>{
  $('#cart-dialog').close();if($('#saved-designs').open)$('#saved-designs').close();
  requestAnimationFrame(()=>{
    const target=activeStep===3?$('#sign-width'):activeStep===4?$('.backing-options [aria-pressed=true]'):activeStep===5?$('#panel-5 .accessory-photo'):mobileChoiceMedia.matches?mobileLook.querySelector('[aria-pressed=true]'):$('#sign-text');
    target?.focus({preventScroll:true});target?.scrollIntoView({block:'center',behavior:'instant'});
  });
});
// Existing Offers-based delivery rule, priced from the cart's core signs.
// Persist the selected tier so the date advances until checkout. Saved/browser
// fee amounts never serve as the authoritative checkout price.
let selectedDelivery=null;
const cartCurrency=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
function refreshDeliverySummary(){
  const designs=cartItems.map(item=>item.design),restricted=minimumDeliveryBusinessDays(designs)===7;
  const previousDate=selectedDelivery?.dateIso;
  if(selectedDelivery)selectedDelivery=rollingCheckoutDelivery(selectedDelivery,{signNet:cartTotals?.signNet,designs});
  if(previousDate&&previousDate!==selectedDelivery?.dateIso)persistCart();
  const summary=selectedDelivery?`${new Intl.DateTimeFormat('de-DE',{dateStyle:'full',timeZone:'UTC'}).format(new Date(selectedDelivery.dateIso+'T12:00:00Z'))} · ${deliveryTierLabel(selectedDelivery.businessDays)} · für alle Schilder.`:previousDate?'Dein bisheriger Termin ist für diesen Warenkorb nicht mehr verfügbar. Bitte wähle erneut.':'Ein gemeinsamer Liefertermin für deinen Warenkorb.';
  $('#cart-delivery-summary').textContent=summary+(restricted?' '+DELIVERY_RESTRICTION_NOTE:'');
  if(!cartPricesValid||!cartTotals){
    $('#cart-tax-breakdown').hidden=true;
    $('#cart-subtotal').textContent=cartItems.length?'Entwürfe prüfen':'—';
    $('#cart-delivery-fee').textContent='Nach Entwurfsprüfung';
    return;
  }
  const amount=cartTotals.subtotalGross+(selectedDelivery?.feeGross||0);
  $('#cart-subtotal').textContent=cartCurrency.format(cartTotals.subtotalGross);
  $('#cart-delivery-fee').textContent=selectedDelivery?(selectedDelivery.feeNet===0?'Gratis':cartCurrency.format(selectedDelivery.feeGross)):'Bitte Termin wählen';
  $('#cart-total-label').textContent=selectedDelivery?'Gesamtpreis inkl. Lieferung':'Zwischensumme';
  $('#cart-total-price').textContent=cartCurrency.format(Math.round(amount*100)/100);
  // Informational breakdown of the displayed German gross total, including
  // delivery when selected. Rounding reconciles net + VAT exactly to that total.
  const grossCents=Math.round(amount*100),netCents=Math.round(grossCents/(1+PRICE_RULES.vatRate));
  $('#cart-net-total').textContent=cartCurrency.format(netCents/100);
  $('#cart-vat-total').textContent=cartCurrency.format((grossCents-netCents)/100);
  $('#cart-tax-breakdown').hidden=false;
  $('#cart-delivery-open').textContent=selectedDelivery?'Liefertermin ändern':'Liefertermin wählen';
  refreshCartButtons();
}
const deliveryCalendar=initDeliveryCalendar($('#delivery-calendar-host'),{
  getContext:()=>({signNet:cartTotals?.signNet,subtotalGross:cartTotals?.subtotalGross,selectedDate:selectedDelivery?.dateIso,designs:cartItems.map(item=>item.design)}),
  onContinue:selection=>{
    selectedDelivery=selection;persistCart();$('#delivery-dialog').close();
  }
});
function openDeliverySelection(){
  if(!cartReady||!cartItems.length||!cartPricesValid||!cartTotals||cartEditing||cartSyncing)return;
  refreshDeliverySummary();$('#cart-dialog').close();deliveryCalendar.refresh({resetSelection:true});$('#delivery-dialog').showModal();
}
$('#cart-delivery-open').addEventListener('click',openDeliverySelection);
$('#delivery-back').addEventListener('click',()=>$('#delivery-dialog').close());
// Escape, close icon and Back all return to the cart without committing a draft choice.
$('#delivery-dialog').addEventListener('close',()=>{showCart();$('#cart-delivery-open').focus();});

async function addReviewedDesign(){
  if(!orderSnapshot?.mount.valid||!orderDesign||!cartReady||orderSnapshot?.price.status!=='calculated'||!Number.isFinite(orderSnapshot.price.net))return;
  if(!editingCartId&&cartItems.length>=20){$('#order-status').textContent='Der Warenkorb enthält bereits 20 Entwürfe. Bitte entferne zuerst einen Entwurf.';return;}
  const quantity=Number($('#review-quantity').value);if(!Number.isInteger(quantity)||quantity<1||quantity>99){$('#order-status').textContent='Bitte eine Stückzahl von 1 bis 99 eingeben.';$('#review-quantity').focus();return;}
  const old=cartItems.find(item=>item.id===editingCartId);
  const item={id:old?.id||crypto.randomUUID(),quantity,design:structuredClone(orderDesign),snapshot:structuredClone(orderSnapshot),previewSvg:new XMLSerializer().serializeToString($('#order-preview svg'))};
  if(old)cartItems[cartItems.indexOf(old)]=item;else cartItems.push(item);
  editingCartId=null;$('#order-review').close();showCart();await persistCart();
}
$('#add-to-cart').addEventListener('click',openOrderReview);
$('#review-add-to-cart').addEventListener('click',addReviewedDesign);
$('#review-quantity').addEventListener('input',()=>{
 const quantity=Number($('#review-quantity').value),valid=Number.isInteger(quantity)&&quantity>=1&&quantity<=99;
 $('#review-add-to-cart').disabled=!valid||!cartReady||!orderSnapshot?.mount.valid||orderSnapshot?.price.status!=='calculated';
 if(valid&&orderSnapshot){renderPriceValue($('#order-review .order-purchase strong'),orderSnapshot.price,quantity);$('#order-status').textContent='';}
 else{$('#order-review .order-purchase strong').textContent='Stückzahl prüfen';$('#order-status').textContent='Bitte eine Stückzahl von 1 bis 99 eingeben.';}
});
$('#open-cart').addEventListener('click',showCart);$('#header-cart').addEventListener('click',showCart);
$('#cart-items').addEventListener('change',event=>{
  const id=event.target.dataset.cartQuantity;if(!id||cartEditing||cartSyncing)return;
  const item=cartItems.find(item=>item.id===id),quantity=Number(event.target.value);
  if(item&&Number.isInteger(quantity)&&quantity>=1&&quantity<=99){item.quantity=quantity;persistCart();}
  renderCart();
});
$('#cart-items').addEventListener('click',async event=>{
  const button=event.target.closest('[data-cart-action]');if(!button||cartEditing||cartSyncing)return;
  const item=cartItems.find(item=>item.id===button.dataset.itemId);if(!item)return;
  if(button.dataset.cartAction==='remove'){
    cartItems=cartItems.filter(candidate=>candidate.id!==item.id);if(!cartItems.length)selectedDelivery=null;if(editingCartId===item.id)editingCartId=null;renderCart();await persistCart();return;
  }
  cartEditing=true;commitHistory();draftApplying=true;
  $('#cart-items').inert=true;$('.editor').inert=true;$('.editor-tabs').inert=true;$('.preview-column').inert=true;
  $('#cart-dialog').querySelectorAll('[data-close]').forEach(b=>b.disabled=true);
  $('#cart-storage-status').textContent='Entwurf wird geladen …';
  try{
    await applyDesign(item.design);
    if(!state.result)throw new Error('Der gespeicherte Entwurf konnte nicht neu gezeichnet werden. Bitte prüfe Schrift und Größe.');
    acceptReplacementDraft();editingCartId=item.id;draftApplying=false;commitHistory();persistDesign(captureDesign());await persistCart();
    $('#cart-dialog').close();setStep(0,true);refreshCartButtons();
  }catch(error){$('#cart-storage-status').textContent=error.message;}
  finally{cartEditing=false;draftApplying=false;$('#cart-items').inert=false;$('.editor').inert=false;$('.editor-tabs').inert=false;$('.preview-column').inert=false;$('#cart-dialog').querySelectorAll('[data-close]').forEach(b=>b.disabled=false);refreshHistoryButtons();}
});
$('#cart-dialog').addEventListener('cancel',event=>{if(cartEditing||cartSyncing)event.preventDefault();});
const quoteClient=createQuoteClient({readAttempt:readAsset,saveAttempt:saveAsset,claimAttempt:saveAssetIfMissing});
let quoteCart=null,quoteSubmitting=false,quoteDelivery=null;
$('#cart-request-quote').addEventListener('click',async()=>{
 if(cartSyncing||cartEditing||!cartPricesValid||!cartItems.length)return;
 quoteCart=structuredClone(cartItems);quoteDelivery=selectedDelivery?{...selectedDelivery}:null;
 $('#quote-summary').textContent=quoteCart.reduce((n,item)=>n+item.quantity,0)+' Schilder · '+quoteCart.length+' '+(quoteCart.length===1?'Entwurf':'Entwürfe')+'. Wir prüfen deine Angaben und senden dir ein Angebot per E-Mail.';
 $('#quote-status').textContent='';$('#quote-form').hidden=false;$('#quote-submit').disabled=false;
 $('#quote-dialog').showModal();$('#quote-first-name').focus();
});
$('#quote-form').addEventListener('submit',async event=>{
 event.preventDefault();if(quoteSubmitting||!quoteCart?.length||!$('#quote-form').reportValidity())return;
 quoteSubmitting=true;$('#quote-submit').disabled=true;$('#quote-form').inert=true;
 $('#quote-dialog').querySelectorAll('[data-close]').forEach(button=>button.disabled=true);
 const status=$('#quote-status');status.textContent='Deine Entwürfe werden für die Anfrage vorbereitet …';
 try{
  const {createShareImage}=await import('./design-share.js?v=20261006-quantities1');
  const data=[],previews=[];
  for(const [index,item] of quoteCart.entries()){
   const price=await storedPrice(item.design);if(price.status!=='calculated')throw new Error('Bitte den Entwurf im Warenkorb erneut prüfen.');
   const d=item.design,snapshot=item.snapshot;
   data.push({entwurf:index+1,text:d.text,schrift:snapshot.font.name,schriftQuelle:d.fontSource?.entry?.family||null,schriftDateiNachreichen:!!snapshot.font.uploaded,konfiguration:Object.fromEntries(['text','fontId','axis','valueMm','alignment','lineHeight','color','wordColors','charColors','lightMode','backing','plateFinish','mount','outdoor','accessoryQuantities'].map(key=>[key,d[key]])),anzahlSchilder:item.quantity,aussenmasseMm:{breite:snapshot.plate.widthMm,hoehe:snapshot.plate.heightMm},farbe:snapshotColorSummary(snapshot),lichtmodus:d.lightMode,einsatz:d.outdoor?'Außen':'Innen',rueckplatte:snapshot.plate.name,oberflaeche:finishName(snapshot.plate.finish),zubehoerProSchild:accessoryCounts(d),ausrichtung:d.alignment,zeilenabstand:d.lineHeight,ledLaengeMm:snapshot.production.routeLengthMm,preisversion:price.version,preisvorschauBruttoProSchild:priceAmounts(price).gross,preisvorschauBruttoGesamt:priceAmounts(price,item.quantity).gross});
   previews.push(await createShareImage([{name:snapshot.text,preview:withoutWallHardware(item.previewSvg),size:dimensions(snapshot.plate),font:snapshot.font.name,color:snapshotColorSummary(snapshot)}]));
  }
  const description='Konfigurator Angebot\nBitte ein Angebot für die folgenden Neon-LED-Schilder erstellen.\nMengen beim Zubehör gelten jeweils PRO SCHILD. Die genannten Preise sind lokale Kalkulationswerte, keine Lieferantenbestätigung oder Fertigungsfreigabe. Kein zweiter Rabatt.\n\n'+JSON.stringify(data,null,2);
  status.textContent='Anfrage wird übertragen …';
  const receipt=await quoteClient.submit({contact:{firstName:$('#quote-first-name').value,lastName:$('#quote-last-name').value,email:$('#quote-email').value},description,previews,usage:data.some(d=>d.einsatz==='Außen')?'aussen':'innen',delivery:quoteDelivery?.dateIso||'Termin noch offen',size:data.map(d=>d.anzahlSchilder+' × '+dimensions({widthMm:d.aussenmasseMm.breite,heightMm:d.aussenmasseMm.hoehe})).join('; '),color:[...new Set(data.map(d=>d.farbe))].join('; ')});
  $('#quote-form').hidden=true;status.textContent='Deine Anfrage ist bei NEONTRIP eingegangen. Wir prüfen deine Entwürfe und melden uns per E-Mail. Referenz: '+receipt.lead_request_id.slice(0,8)+'.';
 }catch(error){status.textContent=error.message||'Der Eingang konnte nicht bestätigt werden. Dein Warenkorb bleibt erhalten.';}
 finally{quoteSubmitting=false;$('#quote-submit').disabled=false;$('#quote-form').inert=false;$('#quote-dialog').querySelectorAll('[data-close]').forEach(button=>button.disabled=false);}
});
$('#quote-dialog').addEventListener('cancel',event=>{if(quoteSubmitting)event.preventDefault();});
$('#quote-dialog').addEventListener('close',()=>{quoteCart=null;quoteDelivery=null;});
async function goToCheckout(){
  const reviewedDelivery=selectedDelivery?{...selectedDelivery}:null;
  if(cartSyncing||cartEditing||!cartReady||!cartPricesValid||!cartItems.length||cartItems.some(item=>item.snapshot.plate.type==='freestanding'))return;
  cartSyncing=true;refreshCartButtons();$('#cart-items').inert=true;
  $('#cart-dialog').querySelectorAll('[data-close]').forEach(button=>button.disabled=true);
  const status=$('#checkout-preparation-status');status.textContent='Dein Warenkorb wird an die Kasse übergeben …';
  try{
    if(!await refreshCartPrice())return;
    if(!selectedDelivery){status.textContent='Bitte wähle zuerst einen aktuellen Liefertermin.';return;}
    if(!reviewedDelivery||reviewedDelivery.businessDays!==selectedDelivery.businessDays||reviewedDelivery.feeGross!==selectedDelivery.feeGross){status.textContent='Die Lieferoption oder ihr Preis wurde aktualisiert. Bitte prüfe die Übersicht erneut.';return;}
    const expectedTotalCents=Math.round((cartTotals.subtotalGross+selectedDelivery.feeGross)*100);
    const receipt=await checkoutClient.prepare(cartItems,selectedDelivery,expectedTotalCents);
    if(receipt.status==='CREATED'){
      status.textContent='Dein Warenkorb ist bereit. Weiter zur sicheren Bezahlung …';
      window.location.assign(receipt.checkoutUrl);
    }else status.textContent='Die Kasse ist für diese Konfiguration noch nicht verfügbar. Dein Warenkorb bleibt gespeichert.';
  }catch(error){status.textContent=error.message||'Die Sicherung konnte nicht bestätigt werden. Dein Warenkorb bleibt auf diesem Gerät erhalten.';}
  finally{
    cartSyncing=false;$('#cart-items').inert=false;
    $('#cart-dialog').querySelectorAll('[data-close]').forEach(button=>button.disabled=false);
    refreshCartButtons();
  }
}
$('#prepare-checkout').addEventListener('click',goToCheckout);
$('#cart-pay').addEventListener('click',goToCheckout);
async function restoreCart(){
  let removedCable=false;
  try{
    const saved=await readAsset(CART_STORAGE_KEY);
    if(saved){
      if(saved.version!==1||!Array.isArray(saved.items)||saved.items.length>20||saved.items.some(item=>!item||typeof item.id!=='string'||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>99||typeof item.snapshot?.text!=='string'||typeof item.design?.text!=='string'||!Array.isArray(item.snapshot?.words)||typeof item.previewSvg!=='string'||item.previewSvg.length>4000000||!['widthMm','heightMm'].every(k=>Number.isFinite(item.snapshot?.sign?.[k])&&Number.isFinite(item.snapshot?.plate?.[k]))))throw new Error('Der gespeicherte Warenkorb konnte nicht gelesen werden. Bitte lass diesen Tab geöffnet.');
      removedCable=saved.items.some(item=>hasRetiredCable(item.design)||hasRetiredCable(item.snapshot));
      cartItems=saved.items.map(item=>({...item,design:{...item.design,...priceOptions(item.design)},snapshot:{...item.snapshot,...priceOptions(item.snapshot)}}));editingCartId=cartItems.some(item=>item.id===saved.editingId)?saved.editingId:null;
      // Older carts only stored a calendar date; its original tier cannot be
      // recovered safely. Keep the designs and require a fresh delivery choice.
      if(cartItems.length){try{selectedDelivery=rollingCheckoutDelivery({businessDays:saved.deliveryBusinessDays},{designs:cartItems.map(item=>item.design)});}catch{selectedDelivery=null;}}
    }
    cartReady=true;renderCart();$('#cart-storage-status').textContent=removedCable?retiredCableMessage:cartItems.length?'Warenkorb auf diesem Gerät wiederhergestellt. Noch keine Bestellung.':'Dein Warenkorb wird auf diesem Gerät gespeichert.';
  }catch(error){cartReady=false;$('#cart-storage-status').textContent=error.message||'Der lokale Warenkorb ist derzeit nicht verfügbar.';refreshCartButtons();}
}
restoreCart();
function refreshCartDeliveryDate(){if(cartReady&&!cartSyncing&&selectedDelivery){refreshDeliverySummary();refreshCartButtons();}}
window.addEventListener('focus',refreshCartDeliveryDate);
window.addEventListener('pageshow',refreshCartDeliveryDate);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshCartDeliveryDate();});

window.addEventListener('resize',()=>{paint();revealActiveTab();});
for(const [id,delta] of [['camera-out',-.2],['camera-in',.2]])$('#'+id).addEventListener('click',()=>{
  const current=roomPresentation?.frame?.camera||cameras.get(state.room)||defaultCamera(state.room);
  const offset=positions.get(state.room)||{x:0,y:0};
  const zoom=Math.max(1,Math.min(roomPresentation?.frame?.maxZoom||4,(roomPresentation?.frame?.zoom||current.zoom)+delta));
  cameras.set(state.room,state.room==='custom'?{zoom,x:500+offset.x,y:defaultCamera(state.room).y+offset.y}:{...current,zoom});paint();
});
$('#preview-color').addEventListener('click',()=>setStep(2,true));
for(const button of document.querySelectorAll('[data-canvas-step]'))button.addEventListener('click',()=>{setStep(Number(button.dataset.canvasStep),true);if(matchMedia('(max-width:760px)').matches)window.scrollTo(0,0);});
$('#open-background-upload').addEventListener('click',()=>{$('#scene-dialog').showModal();if(matchMedia('(max-width:760px)').matches)$('#background-upload').click();else $('#background-upload').focus();});
const preview=$('#sign-preview');
function localPoint(event){return new DOMPoint(event.clientX,event.clientY).matrixTransform(preview.getScreenCTM().inverse());}
function resizeSign(widthMm){
  if(!state.result)return;
  const range=sizeRangeForResult(state,state.result);if(!range?.fits)return;
  state.valueMm=Math.max(range.minimum.designWidthMm,Math.min(range.maximum.designWidthMm,widthMm));
  state.axis='width';state.sizeValid=true;$('#size-error').hidden=true;
  clearTimeout(timer);update();
}
preview.addEventListener('pointerdown',event=>{
  if(matchMedia('(max-width:760px)').matches)return;
  const target=event.target.closest('[data-edit]');
  $('#preview-stage').classList.toggle('sign-selected',!!target);
  if(!target||!previewBox||roomPresentation?.technical||event.button!==0)return;
  event.preventDefault();const point=localPoint(event),offset=positions.get(state.room)||{x:0,y:0};
  drag={presentation:roomPresentation,id:event.pointerId,kind:target.dataset.edit,start:point,offset:{...offset},box:{...previewBox},width:state.result.size.exact.design.widthMm,sx:Number(target.dataset.sx)||1,sy:Number(target.dataset.sy)||1};
  preview.setPointerCapture(event.pointerId);
});
preview.addEventListener('pointermove',event=>{
  if(!drag||drag.id!==event.pointerId)return;
  const point=localPoint(event),dx=point.x-drag.start.x,dy=point.y-drag.start.y;
  if(drag.kind==='move'){
    positions.set(state.room,boundedPosition(drag.box,drag.offset,dx,dy));paint();
  }else{
    const vx=drag.sx*(drag.box.width/2+drag.box.pad),vy=drag.sy*(drag.box.height/2+drag.box.pad);
    drag.nextWidth=drag.width*Math.max(.01,1+(dx*vx+dy*vy)/(vx*vx+vy*vy));
    if(!dragFrame)dragFrame=requestAnimationFrame(()=>{dragFrame=0;if(drag)resizeSign(drag.nextWidth);});
  }
});
function boundedPosition(box,offset,dx,dy){
  const v=preview.viewBox.baseVal,standing=state.mount==='table-stand'&&state.room!=='custom';
  const area=state.room==='custom'?[v.x+12,v.y+12,v.x+v.width-12,v.y+v.height-12]:roomArea(state.room,standing);
  return moveWithinRoom({area,box:{...box,height:box.height+(standing?7:0)},offset,dx,dy,standing});
}
function endDrag(event){
  if(!drag||drag.id!==event.pointerId)return;
  if(dragFrame){cancelAnimationFrame(dragFrame);dragFrame=0;}
  if(drag.kind==='resize'&&drag.nextWidth)resizeSign(drag.nextWidth);
  drag=null;paint();
  if(preview.hasPointerCapture(event.pointerId))preview.releasePointerCapture(event.pointerId);
}
preview.addEventListener('pointerup',endDrag);
preview.addEventListener('pointercancel',endDrag);
preview.addEventListener('keydown',event=>{
  const target=event.target.closest('[data-edit]');if(!target||!state.result)return;
  if(target.dataset.edit==='resize'&&['+','=','-','ArrowUp','ArrowDown'].includes(event.key)){
    event.preventDefault();const delta=['-','ArrowDown'].includes(event.key)?-10:10;
    resizeFocus=[target.dataset.sx,target.dataset.sy];resizeSign(state.result.size.exact.design.widthMm+delta);
  }else if(target.dataset.edit==='move'&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
    event.preventDefault();const amount=event.shiftKey?10:2,offset=positions.get(state.room)||{x:0,y:0};
    const dx=event.key==='ArrowLeft'?-amount:event.key==='ArrowRight'?amount:0,dy=event.key==='ArrowUp'?-amount:event.key==='ArrowDown'?amount:0;
    positions.set(state.room,boundedPosition(previewBox,offset,dx,dy));
    paint();$('#preview-handles [data-edit="move"]').focus();
  }
});
$('#background-upload').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  const rev=++photoRevision,status=$('#photo-status');let url;
  status.hidden=false;status.textContent='Foto wird geladen …';
  try{
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10_000_000)throw new Error('Bitte wähle JPG, PNG oder WebP bis 10 MB.');
    url=URL.createObjectURL(file);const img=new Image();img.src=url;await img.decode();
    if(rev!==photoRevision){URL.revokeObjectURL(url);return;}
    if(!img.naturalWidth||!img.naturalHeight)throw new Error('Das Foto konnte nicht gelesen werden.');
    const assetId=`photo-${crypto.randomUUID()}`;await rememberAsset(assetId,file,url);
    if(rev!==photoRevision)return;
    const old=ROOMS.find(room=>room.id==='custom');
    const scale=Math.min(1000/img.naturalWidth,500/img.naturalHeight);
    const custom={id:'custom',assetId,name:'Eigenes Foto',image:url,spanMm:6000,calibration:null,photoWidth:Math.min(1000,img.naturalWidth*scale),photoHeight:Math.min(500,img.naturalHeight*scale)};
    $('#photo-width').value=custom.spanMm/10;
    if(old)Object.assign(old,custom);else ROOMS.push(custom);
    positions.delete('custom');cameras.delete('custom');$('#preview-room').replaceChildren();
    state.room='custom';state.scene='wall';$('#photo-settings').hidden=false;
    status.textContent='Foto geladen. Lege für dieses Bild ein neues Referenzmaß fest oder passe die geschätzte Bildbreite an.';
    renderSceneButtons();paint();
  }catch(error){if(url)URL.revokeObjectURL(url);status.textContent=error.message;}
  event.target.value='';
});
$('#photo-width').addEventListener('input',event=>{
  const value=Number(event.target.value),room=ROOMS.find(room=>room.id==='custom');
  if(!room)return;
  if(!event.target.value||value<50||value>5000){$('#photo-status').hidden=false;$('#photo-status').textContent='Bitte gib eine Bildbreite zwischen 50 und 5.000 cm ein.';return;}
  room.spanMm=value*10;room.calibration=null;$('#photo-status').textContent='Bildmaßstab aktualisiert.';paint();
});
$('#apply-background').addEventListener('click',()=>{state.room='custom';state.scene='wall';paint();$('#scene-dialog').close();});
$('#remove-background').addEventListener('click',()=>{
  photoRevision++;const index=ROOMS.findIndex(room=>room.id==='custom');if(index<0)return;
  ROOMS.splice(index,1);positions.delete('custom');
  if(state.previousRoom==='custom')state.previousRoom='reception';
  if(state.room==='custom')state.room=state.mount==='table-stand'?'tabletop':'reception';
  $('#photo-settings').hidden=true;$('#photo-status').hidden=true;renderSceneButtons();paint();
});

for(const button of document.querySelectorAll('[data-width-cm]'))button.addEventListener('click',()=>chooseOuterSize('width',Number(button.dataset.widthCm)*10));
setupPhotoCalibration({getPhoto:()=>ROOMS.find(r=>r.id==='custom'),onApply:({spanMm,calibration})=>{const room=ROOMS.find(r=>r.id==='custom');if(!room)return;room.spanMm=spanMm;room.calibration=calibration;$('#photo-width').value=Math.round(spanMm)/10;state.room='custom';state.scene='wall';paint();}});
$('#undo-design').addEventListener('click',()=>moveHistory(-1));
$('#redo-design').addEventListener('click',()=>moveHistory(1));
$('#reset-position').addEventListener('click',()=>{positions.delete(state.room);paint();});
// Finish a typing/drag group before a different button action begins.
document.addEventListener('click',()=>commitHistory(),true);
document.addEventListener('focusin',event=>{if(event.target.matches('input,textarea'))commitHistory();});
document.addEventListener('pointerdown',event=>{if(event.target.closest('input[type=range],#preview-handles'))commitHistory();},true);
document.addEventListener('keydown',event=>{
  if(document.querySelector('dialog[open]')||!(event.ctrlKey||event.metaKey)||event.altKey||event.target.closest('input,textarea,[contenteditable="true"]'))return;
  if(event.key.toLowerCase()==='z'||(event.ctrlKey&&event.key.toLowerCase()==='y')){event.preventDefault();moveHistory(event.shiftKey||event.key.toLowerCase()==='y'?1:-1);}
});
window.addEventListener('pagehide',()=>{commitHistory();if(draftReady&&!draftApplying)persistDesign(captureDesign());});
setStep(0,false,{scroll:false});startWorker();
async function bootDraft(){
  $('.editor').inert=true;$('.editor-tabs').inert=true;$('.preview-column').inert=true;
  let restored=false,failure=false;
  try{const saved=readDraft();if(saved){await applyDesign(saved);restored=true;}else await update();}
  catch{failure=true;draftWriteGuard.block();entryOnboarding.end();await update();$('#use-replacement-draft').hidden=false;$('#draft-status').textContent='Vorhandener Entwurf konnte nicht geladen werden. Dieser neue Entwurf ist noch nicht gespeichert.';}
  history=new DraftHistory(captureDesign());lastSavedSnapshot=restored?JSON.stringify(captureDesign()):null;draftReady=true;
  if(!restored&&!failure)persistDesign(captureDesign());
  if(!failure)$('#draft-status').textContent=restored?'Entwurf wiederhergestellt':'Wird auf diesem Gerät gespeichert';
  $('.editor').inert=false;$('.editor-tabs').inert=false;$('.preview-column').inert=false;refreshHistoryButtons();
  entryOnboarding.start(!restored&&!failure&&!location.hash);
  showIncomingDesigns();setupBudgetAdvisor();
}
bootDraft();

$('#suggest-production-size').addEventListener('click',()=>chooseOuterSize('width',Number($('#suggest-production-size').dataset.suggestedOuterMm)));

// The editing area follows the visible viewport when the phone keyboard opens.
function updateEditingViewport(){
  const viewport=window.visualViewport;
  const typing=matchMedia('(max-width:760px)').matches&&!!document.activeElement?.closest('.editor input:not([type=file]):not([type=range]):not([type=color]),.editor textarea');
  const keyboard=typing&&viewport&&window.innerHeight-viewport.height>120;
  const opening=keyboard&&!document.body.classList.contains('keyboard-editing');
  document.body.classList.toggle('keyboard-editing',!!keyboard);
  if(opening)requestAnimationFrame(()=>document.activeElement?.scrollIntoView({block:'center',behavior:'instant'}));
  document.documentElement.style.setProperty('--editing-height',`${viewport?.height||window.innerHeight}px`);
  document.documentElement.style.setProperty('--editing-top',`${viewport?.offsetTop||0}px`);
}
window.visualViewport?.addEventListener('resize',updateEditingViewport);
window.visualViewport?.addEventListener('scroll',updateEditingViewport);
document.addEventListener('focusin',updateEditingViewport);
document.addEventListener('focusout',()=>setTimeout(updateEditingViewport,0));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&draftReady&&!draftApplying)persistDesign(captureDesign());});
function clearArIllustration(){
  shareDesignKey=null;shareRevision++;shareAbort?.abort();sharePending=false;shareExpiresAt=0;
  $('#ar-share-panel').hidden=true;$('#ar-share-qr').hidden=true;
  $('#ar-share-link').hidden=true;$('#ar-share-link').removeAttribute('href');
}
// The three journey groups and contextual field tabs have one location on every device.
const formatMedia=matchMedia('(min-width:1100px)');formatMedia.addEventListener('change',()=>setStep(activeStep,false,{scroll:false}));
const mobilePreviewMedia=matchMedia('(max-width:760px)');
mobilePreviewMedia.addEventListener('change',()=>{paintMobileChoices();if(state.result)paint();});
new ResizeObserver(()=>{if(state.result)paint();}).observe($('#preview-stage'));
// Mobile choices use two-row horizontal lists; all visible cards remain selectable by touch and keyboard.
function paintMobileChoices(){
 for(const node of $('#font-grid').children)node.hidden=false;
 for(const node of $('#color-palette').children)node.hidden=false;
}
paintMobileChoices();

$('#mobile-font-library').addEventListener('change',event=>openFontLibrary(event.target.value));
$('#mobile-color-target').addEventListener('change',event=>{state.colorTarget=event.target.value;state.colorScope=state.colorTarget.startsWith('char:')?'letters':state.colorTarget.startsWith('line:')?'lines':'words';paint();});

// Keep one material chapter visible while native disclosure groups handle switching.
for(const chapter of document.querySelectorAll('details[name="config-material-chapter"]')){
  chapter.querySelector('summary').addEventListener('click',event=>{if(chapter.open)event.preventDefault();});
}

// Width presets use the same worker and plate calculation as the chosen size.
// Only the field currently being edited changes the authoritative design.
function presetSignature(){return JSON.stringify([state.mode,state.logo?.assetId,state.fontId,state.text,state.alignment,state.lineHeight,state.backing,state.mount,state.plateFinish,state.lightMode,priceOptions(state)]);}
async function refreshPresetSizes(){
  if(!state.result||!state.sizeValid)return;
  const key=presetSignature();
  if(key===presetKey)return;
  presetKey=key;const rev=++presetRevision;
  const requestBase=state.mode==='logo'?{type:'render-logo',logoId:state.logo.assetId}:{type:'render',fontId:state.fontId,text:state.text,alignment:state.alignment,lineHeight:state.lineHeight};
  for(const b of document.querySelectorAll('[data-width-cm]')){
    b.disabled=true;b.replaceChildren();const size=document.createElement('strong'),price=document.createElement('span');
    size.textContent=b.dataset.widthCm+' × … cm';price.textContent='— €';price.className='preset-price';b.append(size,price);b.setAttribute('aria-label',b.dataset.widthCm+' cm Breite, Höhe wird berechnet, Preis folgt');
  }
  for(const b of document.querySelectorAll('[data-width-cm]')){
    if(rev!==presetRevision||presetKey!==key)return;
    try{
      const result=await callWorker({...requestBase,axis:'width',valueMm:innerSizeForOuter('width',Number(b.dataset.widthCm)*10)});
      if(rev!==presetRevision||presetKey!==key)return;
      const outer=plateSize(result.size);
      b.querySelector('strong').textContent=dimensions(outer);
      const price=priceForResult(state,result);b.disabled=price.net==null;if(b.disabled)b.querySelector('.preset-price').textContent=price.status==='below-minimum'?'Zu klein':price.status==='above-maximum'?'Zu groß':priceLabel(price);else renderPriceValue(b.querySelector('.preset-price'),price,1,{compact:true});
      b.querySelector('.preset-price').title=priceDetail(price);
      b.setAttribute('aria-label',dimensions(outer)+', '+priceLabel(price)+', inkl. 19 % MwSt.'+(price.net!=null?`, ${INCLUDED_DISCOUNT_PERCENT} % Rabatt bereits enthalten`:''));
    }catch{if(rev===presetRevision){b.querySelector('strong').textContent=b.dataset.widthCm+' cm Breite';b.setAttribute('aria-label',b.dataset.widthCm+' cm Breite, genaue Höhe nach Auswahl, Preis folgt');presetKey='';}}
  }
}
function paintBackingExample(){
  if(!state.result||lastBackingExampleResult===state.result)return;
  lastBackingExampleResult=state.result;
  const {layout,size}=state.result,design=size.exact.design;
  for(const kind of ['contour','rectangle','freestanding']){
    if($('#'+kind+'-example').querySelector('img'))continue;
    const margin=kind==='freestanding'?0:kind==='contour'?CONTOUR_MARGIN_MM:15;
    const w=design.widthMm+margin*2,h=design.heightMm+margin*2;
    const preview=svg('svg',{viewBox:`-20 -20 ${w+40} ${h+40}`,preserveAspectRatio:'xMidYMid meet'});
    const path=kind==='contour'?backingContour(state.result):kind==='rectangle'?`M0 0H${w}V${h}H0Z`:railPath(state.result);
    preview.append(svg('path',{d:path,fill:'#ffffff38',stroke:'#786e64','stroke-width':Math.max(1,w/240)}));
    const layer=svg('g',{transform:`translate(${margin} ${margin}) scale(${size.scale})`});
    // The same per-glyph offsets as the canonical preview, without glow layers.
    for(const glyph of layout.glyphs||[]){
      const g=svg('g');
      if(glyph.centerlineD)g.append(svg('path',{d:glyph.centerlineD,fill:'none',stroke:'#d780b0','stroke-width':layout.tubeMm,'stroke-linecap':'round','stroke-linejoin':'round'}));
      else if(glyph.d)g.append(svg('path',{d:glyph.d,transform:`translate(${glyph.x} ${glyph.y}) scale(1 -1)`,fill:'#d780b0'}));
      layer.append(g);
    }
    preview.append(layer);$('#'+kind+'-example').replaceChildren(preview);
  }
}
const selectedDesignIds=new Set();
let compareEntries=[];
const sharePolicy={fonts:FONTS,palette:COLORS.map(c=>c.id),rooms:ROOMS.filter(r=>r.id!=='custom').map(r=>r.id)};
let currentShare=null,shareDialogRevision=0,incomingDesigns=null;
function currentShareRecord(){
 const snapshot=captureOrderSnapshot();
 return {name:designName(),design:captureDesign(),size:dimensions(snapshot.plate),font:state.mode==='logo'?'Eigenes Logo':state.font,color:snapshotColorSummary(snapshot),preview:new XMLSerializer().serializeToString(orderPreview())};
}
function updateShareEmail(){
 if(!currentShare)return;
 $('#share-email').href=emailShareUrl(currentShare.records,$('#share-message').value,currentShare.local?'':currentShare.link);
 const whatsapp=$('#share-whatsapp');whatsapp.href='https://wa.me/?text='+encodeURIComponent(shareMessage(currentShare.records,$('#share-message').value,currentShare.local?'':currentShare.link));
 whatsapp.setAttribute('aria-disabled',String(currentShare.local||!currentShare.link));
}
async function openDesignShare(records){
 records=records.map(record=>({...record,preview:withoutWallHardware(record.preview)}));
 const token=++shareDialogRevision,dialog=$('#design-share-dialog');
 if(currentShare?.imageUrl)URL.revokeObjectURL(currentShare.imageUrl);
 currentShare={records:structuredClone(records),link:'',local:isLocalShareUrl(location.href),file:null,imageUrl:null};
 $('#share-message').value=records.length===2?'Welcher Entwurf gefällt dir besser – A oder B?':'Was hältst du von diesem Entwurf?';
 $('#design-share-title').textContent=records.length===2?'Entwürfe teilen':'Entwurf teilen';
 $('#share-status').textContent='Vorschaubild wird erstellt …';$('#share-native').hidden=true;
 $('#share-image').removeAttribute('href');$('#share-image').setAttribute('aria-disabled','true');
 $('#share-pinterest-help').hidden=true;$('#share-pinterest').setAttribute('aria-expanded','false');
 $('#share-preview').replaceChildren();
 for(const [i,record] of records.entries()){
  const figure=document.createElement('figure'),caption=document.createElement('figcaption');
  caption.textContent=(records.length===2?(i?'B · ':'A · '):'')+record.name+' · '+record.size;
  figure.append(previewImage(record),caption);$('#share-preview').append(figure);
 }
 let reason='';
 try{currentShare.link=createDesignLink(records.map(r=>r.design),location.href,sharePolicy);}catch(error){reason=error.message;}
 $('#share-link').value=currentShare.link;$('#share-copy').disabled=!currentShare.link;
 labelShareAction('share-copy',currentShare.local?'Lokaler Link':'Link kopieren');shareDetails.open=false;
 $('#share-link').hidden=$('#share-link-label').hidden=!currentShare.link;
 $('#share-link-note').textContent=reason||(currentShare.local?'Lokale Vorschau: Dieser Link funktioniert nur auf diesem Rechner. Für andere Personen bitte das Bild herunterladen und an die E-Mail anhängen.':'Jeder mit dem Link kann eine eigene Kopie öffnen. Änderungen werden nicht gemeinsam synchronisiert.');
 if(records.some(r=>r.design.photo)&&!reason)$('#share-link-note').textContent+=' Ein eigenes Raumfoto wird durch den Beispielraum ersetzt.';
 updateShareEmail();dialog.showModal();
 try{
  const blob=await createShareImage(records);if(token!==shareDialogRevision||!dialog.open)return;
  currentShare.file=new File([blob],records.length===2?'neontrip-vergleich.png':'neontrip-entwurf.png',{type:'image/png'});
  currentShare.imageUrl=URL.createObjectURL(blob);$('#share-image').href=currentShare.imageUrl;$('#share-image').download=currentShare.file.name;$('#share-image').setAttribute('aria-disabled','false');
  $('#share-native').hidden=!(navigator.share&&navigator.canShare?.({files:[currentShare.file]}));
  $('#share-status').textContent=currentShare.local||!currentShare.link?'Bild bereit. Eine E-Mail öffnet als Entwurf; das Bild bitte selbst anhängen.':'Bereit zum Teilen. Eine E-Mail öffnet als Entwurf.';
 }catch(error){if(token===shareDialogRevision&&dialog.open)$('#share-status').textContent=error.message||'Bildexport nicht verfügbar. Bitte erneut versuchen.';}
}
$('#share-design').addEventListener('click',()=>{
 if(designRendering||!state.result||!state.sizeValid)return;
 openDesignShare([currentShareRecord()]);
});
$('#share-comparison').addEventListener('click',()=>{if(compareEntries.length===2)openDesignShare(compareEntries);});
$('#share-message').addEventListener('input',updateShareEmail);
$('#share-whatsapp').addEventListener('click',event=>{if(currentShare?.local||!currentShare?.link){event.preventDefault();$('#share-status').textContent='Lade das Bild herunter und hänge es in WhatsApp an. Der lokale Link ist für andere Geräte nicht erreichbar.';}});
$('#share-pinterest').addEventListener('click',()=>{const help=$('#share-pinterest-help');help.hidden=!help.hidden;$('#share-pinterest').setAttribute('aria-expanded',String(!help.hidden));});
$('#share-email').addEventListener('click',()=>{$('#share-status').textContent=currentShare?.local||!currentShare?.link?'Die Nachricht öffnet in deinem E-Mail-Programm. Bitte das heruntergeladene Bild anhängen.':'Die Nachricht öffnet mit deinem Design-Link im E-Mail-Programm. Du wählst Empfänger und Versand.';});
$('#share-copy').addEventListener('click',async()=>{
  if(!currentShare?.link)return;
  const session=currentShare;
  try{await navigator.clipboard.writeText(session.link);if(currentShare===session)$('#share-status').textContent=session.local?'Lokaler Link kopiert – nur auf diesem Rechner nutzbar.':'Link kopiert. Du kannst ihn jetzt weitergeben.';}
  catch{if(currentShare!==session)return;shareDetails.open=true;$('#share-link').focus();$('#share-link').select();$('#share-status').textContent='Bitte den markierten Link über das Kopiermenü kopieren.';}
});
$('#share-native').addEventListener('click',async()=>{
 if(!currentShare?.file)return;
 const session=currentShare;
 try{await navigator.share({files:[session.file],title:session.records.length===2?'NEONTRIP – Entwürfe vergleichen':'Mein NEONTRIP-Entwurf',text:shareMessage(session.records,$('#share-message').value,session.local?'':session.link)});if(currentShare===session)$('#share-status').textContent='An den Teilen-Dialog übergeben.';}
 catch(error){if(currentShare===session)$('#share-status').textContent=error.name==='AbortError'?'Teilen abgebrochen. Dein Entwurf bleibt erhalten.':'Teilen hier nicht verfügbar. Bitte das Bild herunterladen oder den Link kopieren.';}
});
$('#design-share-dialog').addEventListener('close',()=>{shareDialogRevision++;if(currentShare?.imageUrl)URL.revokeObjectURL(currentShare.imageUrl);currentShare=null;});
function showIncomingDesigns(){
 if(!draftReady)return;
 const dialog=$('#shared-design-dialog'),list=$('#shared-design-list');
 list.replaceChildren();$('#shared-design-status').textContent='';
 try{
  if(location.hash)entryOnboarding.end();
  incomingDesigns=readDesignLink(location.hash,sharePolicy);$('#open-shared-designs').hidden=!incomingDesigns;
  if(!incomingDesigns)return;
  $('#shared-design-title').textContent=incomingDesigns.length===2?'Zwei Entwürfe für dich.':'Ein Entwurf für dich.';
  for(const [i,design] of incomingDesigns.entries()){
   const card=document.createElement('article'),title=document.createElement('h3'),info=document.createElement('p');
   title.textContent=(incomingDesigns.length===2?(i?'B · ':'A · '):'')+design.text;info.textContent=design.fontId+' · '+COLORS.find(c=>c.id===design.color).name;
   card.append(title,info,designButton('Als eigene Kopie öffnen',async()=>{
    if(draftApplying)return;commitHistory();const previous=captureDesign();draftApplying=true;card.querySelector('button').disabled=true;
    try{await applyDesign(design);if(!state.result)throw new Error($('#text-error').textContent||'Dieser Entwurf benötigt eine Korrektur.');acceptReplacementDraft();history.record(captureDesign());persistDesign(captureDesign());dialog.close();setStep(0);$('#save-design-status').textContent='Geteilte Kopie geöffnet. Vorheriger Entwurf: Rückgängig.';}
    catch(error){await applyDesign(previous);$('#shared-design-status').textContent=error.message;}
    finally{draftApplying=false;card.querySelector('button').disabled=false;refreshHistoryButtons();}
   }));list.append(card);
  }
  if(!dialog.open)dialog.showModal();
 }catch(error){incomingDesigns=null;$('#open-shared-designs').hidden=true;$('#shared-design-status').textContent=error.message;if(!dialog.open)dialog.showModal();}
}
$('#open-shared-designs').addEventListener('click',showIncomingDesigns);
window.addEventListener('hashchange',showIncomingDesigns);
function refreshSavedCount(){try{$('#saved-count').textContent=listNamedDesigns().length;}catch{$('#saved-count').textContent='—';}}
function designButton(label,action){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',action);return b;}
function previewImage(record){const img=document.createElement('img');img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(withoutWallHardware(record.preview));img.alt=record.name+' · '+record.size;return img;}
async function restoreNamed(record,status){
  if(draftApplying)return;
  draftApplying=true;$('.editor').inert=true;
  try{await applyDesign(record.design);if(!state.result)throw new Error('Dieser Entwurf konnte nicht berechnet werden.');acceptReplacementDraft();history.record(captureDesign());persistDesign(captureDesign());$('#saved-designs').close();$('#design-comparison').close();$('#cart-dialog').close();setStep(0);}
  catch(error){status.textContent=error.message;}
  finally{draftApplying=false;$('.editor').inert=false;refreshHistoryButtons();}
}
$('#save-design').addEventListener('click',async()=>{
  const button=$('#save-design'),status=$('#save-design-status');
  if(designRendering||!state.result||!state.sizeValid){status.textContent='Bitte zuerst die gültige Vorschau abwarten.';return;}
  button.disabled=true;
  try{
    const design=captureDesign();
    if(designAssetRefs(design).some(id=>!draftAssets.get(id)?.persisted))throw new Error('Eine Datei ist noch nicht gespeichert. Bitte erneut versuchen.');
    const snapshot=captureOrderSnapshot();
    const record={version:1,name:designName(),design,size:dimensions(snapshot.plate),widthMm:snapshot.plate.widthMm,heightMm:snapshot.plate.heightMm,font:state.mode==='logo'?'Eigenes Logo':state.font,color:snapshotColorSummary(snapshot),backing:BACKINGS[state.backing].name,finish:finishName(state.plateFinish),mount:MOUNTS[state.mount].name,preview:new XMLSerializer().serializeToString(orderPreview())};
    await saveNamedDesign(record);status.textContent='Design gespeichert';refreshSavedCount();if($('#saved-designs').open)await openSavedDesigns();
  }catch(error){status.textContent=error.message||'Speichern nicht möglich. Bitte diesen Tab geöffnet lassen.';}
  finally{button.disabled=designRendering||!state.result;}
});
function updateComparisonAction(){const n=selectedDesignIds.size;$('#start-comparison').disabled=n!==2;$('#start-comparison').textContent=n===2?'Diese 2 Designs vergleichen':`${n} von 2 Designs ausgewählt`;}
async function openSavedDesigns(){
  const dialog=$('#saved-designs'),list=$('#saved-design-list'),status=$('#saved-designs-status');
  list.replaceChildren();status.textContent='Designs werden geladen …';selectedDesignIds.clear();updateComparisonAction();if(!dialog.open)dialog.showModal();
  try{
    const entries=listNamedDesigns();
    status.textContent=entries.length?'':mobileChoiceMedia.matches?'Noch keine gespeicherten Varianten. Speichere deinen aktuellen Entwurf oben.':'Noch keine gespeicherten Varianten. Nutze „Speichern“ über der Vorschau.';
    for(const entry of entries){
      const record=await readNamedDesign(entry.id);if(!record)continue;
      const card=document.createElement('article');card.className='saved-design-card';
      const pic=document.createElement('div');pic.className='saved-preview';pic.append(previewImage(record));
      const heading=document.createElement('h3');heading.textContent=record.name;
      const info=document.createElement('p');info.textContent=record.size+' · '+record.font+' · '+record.color;
      const price=document.createElement('p');price.className='saved-design-price';displayStoredPrice(price,record.design);
      const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label',record.name+' zum Vergleich auswählen');
      check.addEventListener('change',()=>{if(check.checked&&selectedDesignIds.size===2){check.checked=false;status.textContent='Wähle genau zwei Designs. Hebe zuerst eine Auswahl auf.';return;}check.checked?selectedDesignIds.add(entry.id):selectedDesignIds.delete(entry.id);status.textContent='';updateComparisonAction();});
      label.append(check,document.createTextNode('Vergleichen'));
      card.append(pic,heading,info,price,label,designButton('Design öffnen',()=>restoreNamed(record,status)),designButton('Teilen',()=>openDesignShare([record])),designButton('Entfernen',()=>{try{removeNamedDesign(entry.id);selectedDesignIds.delete(entry.id);card.remove();refreshSavedCount();updateComparisonAction();}catch{status.textContent='Entfernen nicht möglich.';}}));list.append(card);
    }
  }catch{status.textContent='Der Gerätespeicher ist nicht verfügbar. Deine aktuelle Gestaltung bleibt erhalten.';}
}
$('#open-designs').addEventListener('click',openSavedDesigns);$('#compare-designs').addEventListener('click',openSavedDesigns);
function showComparison(records){
    compareEntries=records.map(record=>({...record,usage:record.design.outdoor?'Außen':'Innen',accessories:accessorySummary(record.design)}));
    if(compareEntries.length!==2||compareEntries.some(e=>!e))throw new Error('Ein Design ist nicht mehr verfügbar.');
    const content=$('#comparison-content');content.replaceChildren();
    for(const [i,record] of compareEntries.entries()){
      const card=document.createElement('article');card.className='comparison-card';card.dataset.comparisonCard=i;
      const heading=document.createElement('h3');heading.textContent=(i?'B':'A')+' · '+record.name;
      const pic=document.createElement('div');pic.className='comparison-preview';pic.append(previewImage(record));
      const dl=document.createElement('dl');
      for(const [key,label] of [['size','Breite × Höhe'],['font','Schrift'],['color','Farbe'],['backing','Rückplatte'],['finish','Oberfläche'],['usage','Einsatz'],['accessories','Zubehör pro Schild']]){
        const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=record[key];if(record[key]!==compareEntries[1-i][key])row.className='is-different';row.append(dt,dd);dl.append(row);
      }
      const price=document.createElement('p');price.className='comparison-price';displayStoredPrice(price,record.design);const priceNote=document.createElement('p');priceNote.textContent='Preis pro Schild mit ausgewähltem Zubehör';priceNote.className='comparison-unit-note';
      card.append(heading,pic,dl,priceNote,price,designButton('Mit diesem Design weiter',()=>restoreNamed(record,$('#comparison-status'))));content.append(card);
    }
    $('#comparison-status').textContent='Unterschiede sind farbig hinterlegt. Die Vorschauen passen sich jeweils an die Bildfläche an; maßgeblich sind Breite und Höhe.';
    $('#saved-designs').close();$('#design-comparison').dataset.active='0';$('#design-comparison').showModal();
    for(const b of document.querySelectorAll('[data-comparison-index]'))b.setAttribute('aria-pressed',b.dataset.comparisonIndex==='0');
}
$('#start-comparison').addEventListener('click',async()=>{
 if(selectedDesignIds.size!==2)return;
 try{showComparison(await Promise.all([...selectedDesignIds].map(readNamedDesign)));}
 catch(error){$('#saved-designs-status').textContent=error.message;}
});
for(const b of document.querySelectorAll('[data-comparison-index]'))b.addEventListener('click',()=>{
  $('#design-comparison').dataset.active=b.dataset.comparisonIndex;
  for(const other of document.querySelectorAll('[data-comparison-index]'))other.setAttribute('aria-pressed',other===b);
});
refreshSavedCount();
