// Local draft/file storage. Checkout preparation explicitly uploads only required font/logo assets.
const KEY='neontrip-configurator-draft-v1';
let database;
function openDatabase(){
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open('neontrip-configurator-files',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('files');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{database=null;reject(request.error);};
    request.onblocked=()=>{database=null;reject(new Error('Dateispeicher ist blockiert.'));};
  });
  return database;
}
export async function saveAsset(id,file){
  const db=await openDatabase();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('files','readwrite');tx.objectStore('files').put(file,id);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
export async function readAsset(id){
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const request=db.transaction('files').objectStore('files').get(id);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
// One read/write transaction prevents two tabs from replacing the cart owner.
export async function saveAssetIfMissing(id,value){
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('files','readwrite'),store=tx.objectStore('files');
    let result;
    const request=store.get(id);
    request.onsuccess=()=>{result=request.result;if(result===undefined){result=value;store.put(value,id);}};
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
export function saveDraft(value,key=KEY){localStorage.setItem(key,JSON.stringify({version:1,savedAt:Date.now(),design:value}));}
export function readDraft(key=KEY){
  const raw=localStorage.getItem(key);if(!raw)return null;
  const draft=JSON.parse(raw);
  if(draft.version!==1||!draft.design||typeof draft.design.text!=='string')throw new Error('Unbekanntes Entwurfsformat.');
  return draft.design;
}

// Only small immutable configuration snapshots, never font bytes or photo copies.
export class DraftHistory{
  constructor(initial,limit=50){this.entries=[JSON.stringify(initial)];this.index=0;this.limit=limit;}
  record(value){
    const next=JSON.stringify(value);if(next===this.entries[this.index])return false;
    this.entries.splice(this.index+1);this.entries.push(next);
    if(this.entries.length>this.limit)this.entries.shift();
    this.index=this.entries.length-1;return true;
  }
  get canUndo(){return this.index>0;}
  get canRedo(){return this.index<this.entries.length-1;}
  move(delta){this.index=Math.max(0,Math.min(this.entries.length-1,this.index+delta));return JSON.parse(this.entries[this.index]);}
}

// Named designs reuse the existing IndexedDB file store; no server upload.
const NAMED_KEY='neontrip-saved-designs-v1';
export function listNamedDesigns(){
  const entries=JSON.parse(localStorage.getItem(NAMED_KEY)||'[]');
  if(!Array.isArray(entries))throw new Error('Gespeicherte Designs konnten nicht gelesen werden.');
  return entries.filter(e=>typeof e.id==='string'&&typeof e.name==='string');
}
export async function saveNamedDesign(design){
  const entries=listNamedDesigns();
  if(entries.length>=20)throw new Error('Bis zu 20 Designs sind möglich. Entferne zuerst einen älteren Entwurf.');
  const id='named-design-'+crypto.randomUUID();
  await saveAsset(id,design);
  // Re-read after the async write so another tab's saved entries are preserved.
  const latest=listNamedDesigns();
  localStorage.setItem(NAMED_KEY,JSON.stringify([...latest,{id,name:design.name,savedAt:Date.now()}]));
  return id;
}
export async function readNamedDesign(id){return readAsset(id);}
export function removeNamedDesign(id){localStorage.setItem(NAMED_KEY,JSON.stringify(listNamedDesigns().filter(e=>e.id!==id)));}
