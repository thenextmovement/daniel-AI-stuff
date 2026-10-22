import {sha256} from './vendor/sha256.js';
import {cartEntry,MAX_CART_ITEMS} from './cart.js?v=44';
export const DRAFT_SESSION_KEY='neontrip-3d-server-v1';
const PATH='/api/public/configurator-3d/drafts';
const tokenOK=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const newDraftToken=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
const digest=async value=>[...sha256(new TextEncoder().encode(JSON.stringify(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const empty=()=>({token:newDraftToken(),revision:0,signature:null,references:[],savedAt:null});
export class DraftSyncError extends Error{constructor(code){super(code);this.code=code;}}
function receipt(raw,items){
 if(raw?.version!==1||raw.status!=='SAVED'||!Number.isSafeInteger(raw.revision)||raw.revision<0||!Array.isArray(raw.references)||raw.references.length!==items.length||!(raw.savedAt===null||Number.isFinite(Date.parse(raw.savedAt))))throw new DraftSyncError('INVALID_RESPONSE');
 raw.references.forEach((ref,i)=>{if(ref.localId!==items[i].id||!/^3d_[a-f0-9]{64}$/.test(ref.designId)||!/^[a-f0-9]{64}$/.test(ref.versionId)||!(ref.previewHash===null||/^[a-f0-9]{64}$/.test(ref.previewHash)))throw new DraftSyncError('INVALID_RESPONSE');});
 return raw;
}
export function createDraftSync({storage,fetcher=fetch,onState=()=>{}}){
 let session=null,desired=null,working=null,stopped=false,state='local',stateCode;
 try{const raw=JSON.parse(storage.getItem(DRAFT_SESSION_KEY)||'null');if(tokenOK(raw?.token)&&Number.isSafeInteger(raw.revision)&&raw.revision>=0)session=raw;}catch{}
 const emit=(status,code)=>{state=status;stateCode=code;onState({status,code,references:session?.references||[],savedAt:session?.savedAt});};
 const remember=()=>{try{storage.setItem(DRAFT_SESSION_KEY,JSON.stringify(session));}catch{throw new DraftSyncError('DEVICE_STORAGE_UNAVAILABLE');}};
 async function request(method,secret,body){
  const response=await fetcher(PATH,{method,headers:{Authorization:'Bearer '+secret,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new DraftSyncError('STORAGE_UNAVAILABLE');
  const value=await response.json();
  if(!response.ok)throw new DraftSyncError(value?.error?.code||'STORAGE_UNAVAILABLE');
  return value;
 }
 async function drain(){
  try{
   if(!session){session=empty();remember();}
   while(desired){
    const items=desired;desired=null;
    const signature=await digest(items);
    if(session.signature===signature&&session.revision>0){remember();if(!desired)emit('saved');continue;}
    remember(); // A retry must also persist the access key before any upload.
    emit('saving');
    const reply=receipt(await request('PUT',session.token,{version:1,expectedRevision:session.revision,items}),items);
    session={token:session.token,revision:reply.revision,signature,references:reply.references,savedAt:reply.savedAt};remember();
    if(!desired)emit('saved');
   }
  }catch(error){stopped=true;emit(error.code==='REVISION_CONFLICT'?'conflict':'unavailable',error.code||'STORAGE_UNAVAILABLE');throw error;}
  finally{working=null;}
 }
 function save(items){
  if(!Array.isArray(items)||items.length>MAX_CART_ITEMS)throw new DraftSyncError('INVALID_DRAFT');
  desired=items.map(cartEntry);
  if(stopped){emit(state,stateCode);return Promise.resolve();}
  // Start after assigning the promise: even a synchronous storage failure must
  // clear `working` in finally, so a later retry can start a fresh attempt.
  if(!working)working=Promise.resolve().then(drain);
  return working;
 }
 return {
  save,
  retry(items){stopped=false;return save(items);},
  async fork(items){if(working)await working.catch(()=>{});session=empty();remember();stopped=false;return save(items);},
  async load(secret){
   if(!tokenOK(secret))throw new DraftSyncError('INVALID_LINK');
   const reply=await request('GET',secret);
   if(!Array.isArray(reply.items)||reply.items.length>MAX_CART_ITEMS)throw new DraftSyncError('INVALID_RESPONSE');
   const items=reply.items.map(cartEntry);if(new Set(items.map(i=>i.id)).size!==items.length)throw new DraftSyncError('INVALID_RESPONSE');
   receipt(reply,items);if(reply.revision===0)throw new DraftSyncError('NOT_FOUND');
   return {...reply,items};
  },
  async restoreOwn(){if(!session)return null;return this.load(session.token);},
  async adopt(secret,reply){if(working)await working.catch(()=>{});receipt(reply,reply.items);session={token:secret,revision:reply.revision,signature:await digest(reply.items),references:reply.references,savedAt:reply.savedAt};remember();stopped=false;emit('saved');},
  link(origin){if(state!=='saved'||!session?.revision)throw new DraftSyncError('NOT_SAVED');return new URL('/3d-konfigurator/#entwuerfe='+session.token,origin).href;},
  get status(){return state;},
  get revision(){return session?.revision||0;},
  get hasSession(){return Boolean(session);},
  get sessionToken(){return session?.token;},
  async unchanged(items){return Boolean(session?.revision&&session.signature===await digest(items));}
 };
}
