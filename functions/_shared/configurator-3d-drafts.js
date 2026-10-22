import {DEFAULT,normalize,validate} from '../../deploy/3d-konfigurator/model.js';
import {cartEntry,MAX_CART_ITEMS,safePreview,previewDimensions} from '../../deploy/3d-konfigurator/cart.js';
import {productConfiguration,checkoutPayload3D,blockedCheckout3D} from '../../deploy/3d-konfigurator/checkout-contract.js';
import {shopify3DLineMetadata} from './configurator-3d-shopify.js';

export class Draft3DError extends Error {
 constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
const fail=()=>{throw new Draft3DError('INVALID_DRAFT');};
export function exactKeys(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))fail();
}
export function parseDraftSave(raw){
 exactKeys(raw,['version','expectedRevision','items']);
 if(raw.version!==1||!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<0||!Array.isArray(raw.items)||raw.items.length>MAX_CART_ITEMS)fail();
 const seen=new Set();
 const items=raw.items.map(item=>{
  exactKeys(item,['id','design','quantity','dimensions','preview']);
  exactKeys(item.design,Object.keys(DEFAULT));
  const normalized=normalize(item.design);
  if(Object.keys(DEFAULT).some(key=>normalized[key]!==item.design[key])||validate(normalized))fail();
  productConfiguration(normalized);
  if(item.preview!==null&&!safePreview(item.preview))fail();
  if(item.dimensions!==null){exactKeys(item.dimensions,['height','overallWidth','overallHeight']);if(!previewDimensions(item.dimensions))fail();}
  let clean;try{clean=cartEntry(item);}catch{fail();}
  if(seen.has(clean.id))fail();seen.add(clean.id);return clean;
 });
 return {version:1,expectedRevision:raw.expectedRevision,items};
}
// Only stored revisions reach this mapper. It never creates a Shopify cart.
export function savedShopifyHandoff(items,references){
 const blocked=blockedCheckout3D();
 if(!items.length)return {...blocked,lines:[]};
 const metadata=shopify3DLineMetadata(checkoutPayload3D(items));
 return {...blocked,lines:metadata.map((line,i)=>{
  const ref=references[i];
  if(!ref||ref.localId!==items[i].id||!/^3d_[a-f0-9]{64}$/.test(ref.designId)||!/^[a-f0-9]{64}$/.test(ref.versionId)||!(/^[a-f0-9]{64}$/.test(ref.previewHash)||ref.previewHash===null))fail();
  return {...line,designId:ref.designId,versionId:ref.versionId,previewHash:ref.previewHash,configuration:productConfiguration(items[i].design),
   previewDimensions:items[i].dimensions,attributes:[...line.attributes,
    {key:'Entwurfs-ID',value:ref.designId},
    {key:'_neontrip_design_version',value:ref.versionId},
    ...(ref.previewHash?[{key:'_neontrip_preview_sha256',value:ref.previewHash}]:[])
   ]};
 })};
}
