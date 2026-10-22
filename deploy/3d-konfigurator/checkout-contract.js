import {normalize,validate} from './model.js?v=35';
import {MAX_CART_ITEMS,validQuantity,previewDimensions} from './cart.js?v=41';
import {DELIVERY_3D} from './delivery.js?v=41';

export const CHECKOUT_3D_PATH='/api/public/configurator-3d/checkout';
export const PRODUCT_FAMILY='neontrip-3d-letters';
export const CHECKOUT_BLOCKERS=Object.freeze(['PRICE_RULE_NOT_APPROVED','SERVER_GEOMETRY_NOT_VERIFIED','MANUFACTURING_NOT_VERIFIED','TAX_SHIPPING_NOT_VERIFIED','SHOPIFY_3D_NOT_CONFIGURED']);
export class Checkout3DError extends Error{
 constructor(code){super('Die 3D-Konfiguration muss vor der Bestellung geprüft werden.');this.code=code;}
}
const fail=()=>{throw new Checkout3DError('INVALID_3D_CART');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function exactKeys(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail();
}
export function productConfiguration(raw){
 if(!raw||raw.version!==3)fail();
 const clean=normalize(raw);
 const keys=['version','text','font','lighting','mount','width','depth','spacing',
  ...(clean.lighting==='front'?['acrylic','sideColor','sideRal']:['backFinish','color',...(clean.backFinish==='painted-steel'?['body','bodyRal']:[])]),
  ...(clean.mount==='rail'?['railCustomColor',...(clean.railCustomColor?['railColor','railRal']:[])]:clean.mount==='plate'?['plate','plateRal']:[])];
 // Reject changed/truncated/coerced input, instead of silently ordering defaults.
 if(validate(clean)||keys.some(key=>!same(raw[key],clean[key])))fail();
 return Object.fromEntries(keys.map(key=>[key,clean[key]]));
}
export function checkoutPayload3D(items){
 if(!Array.isArray(items)||!items.length||items.length>MAX_CART_ITEMS)fail();
 const seen=new Set();
 const lines=items.map(item=>{
  if(!item||typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(item.id)||seen.has(item.id)||!validQuantity(item.quantity))fail();
  seen.add(item.id);
  return {id:item.id,quantity:item.quantity,configuration:productConfiguration(item.design),previewDimensions:previewDimensions(item.dimensions)};
 });
 return {contractVersion:1,productFamily:PRODUCT_FAMILY,items:lines,delivery:{...DELIVERY_3D}};
}
export function parseCheckout3DRequest(raw){
 exactKeys(raw,['contractVersion','productFamily','items','delivery']);
 if(raw.contractVersion!==1||raw.productFamily!==PRODUCT_FAMILY)fail();
 exactKeys(raw.delivery,Object.keys(DELIVERY_3D));
 if(Object.keys(DELIVERY_3D).some(key=>raw.delivery[key]!==DELIVERY_3D[key])||!Array.isArray(raw.items))fail();
 const items=raw.items.map(line=>{
  exactKeys(line,['id','quantity','configuration','previewDimensions']);
  const config=productConfiguration(line.configuration);
  exactKeys(line.configuration,Object.keys(config));
  if(line.previewDimensions!==null){
   exactKeys(line.previewDimensions,['height','overallWidth','overallHeight']);
   if(!previewDimensions(line.previewDimensions))fail();
  }
  return {id:line.id,quantity:line.quantity,design:config,dimensions:line.previewDimensions};
 });
 return checkoutPayload3D(items);
}
export function blockedCheckout3D(){
 // Intentionally unconditional. Browser state/env flags cannot enable purchase.
 return {status:'BLOCKED',purchaseEnabled:false,checkoutUrl:null,currency:'EUR',grossCents:null,priceVersion:null,blockers:[...CHECKOUT_BLOCKERS],delivery:{...DELIVERY_3D}};
}
export async function prepareCheckout3D(items){
 checkoutPayload3D(items);
 // No fetch, uploads, Shopify cart or redirect while pricing is unapproved.
 return blockedCheckout3D();
}
