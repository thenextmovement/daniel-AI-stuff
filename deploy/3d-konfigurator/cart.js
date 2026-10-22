import {normalize,validate} from './model.js?v=35';

export const CART_KEY = 'neontrip-3d-cart-v1';
export const MAX_CART_ITEMS = 20;
export const MAX_PREVIEW_LENGTH = 90_000;
const validId = id => typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id);
export const validQuantity = n => Number.isInteger(n)&&n>=1&&n<=99;
export function safePreview(value){
 return typeof value==='string'&&value.length<=MAX_PREVIEW_LENGTH&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)?value:null;
}
export function previewDimensions(value){
 if(!value||!['height','overallWidth','overallHeight'].every(key=>Number.isFinite(value[key])&&value[key]>0&&value[key]<=10000))return null;
 return Object.fromEntries(['height','overallWidth','overallHeight'].map(key=>[key,Math.round(value[key]*1000)/1000]));
}
export function cartEntry({id,design,quantity=1,dimensions=null,preview=null}){
 if(!validId(id)||!validQuantity(quantity))throw new Error('Ungültiger Warenkorbeintrag.');
 const clean=normalize(design);
 if(validate(clean))throw new Error(validate(clean));
 // Explicit fields: never restore prices, purchase flags or checkout URLs.
 return {id,design:clean,quantity,dimensions:previewDimensions(dimensions),preview:safePreview(preview)};
}
export function restoreCart(saved){
 if(!Array.isArray(saved))return [];
 const seen=new Set(),items=[];
 for(const raw of saved){
  if(items.length===MAX_CART_ITEMS)break;
  if(!raw||!validId(raw.id)||seen.has(raw.id)||![1,2,3].includes(raw.design?.version))continue;
  try{items.push(cartEntry({...raw,quantity:validQuantity(raw.quantity)?raw.quantity:1}));seen.add(raw.id);}catch{}
 }
 return items;
}
export function storeCart(storage,items){
 if(!Array.isArray(items)||items.length>MAX_CART_ITEMS)throw new Error('Warenkorb zu groß.');
 const clean=items.map(cartEntry);
 try{storage.setItem(CART_KEY,JSON.stringify(clean));return {items:clean,previewsOmitted:false};}
 catch(error){
  if(!clean.some(item=>item.preview))throw error;
  // Images are optional; retain every design and quantity if storage is tight.
  const compact=clean.map(item=>({...item,preview:null}));
  storage.setItem(CART_KEY,JSON.stringify(compact));
  return {items:compact,previewsOmitted:true};
 }
}
