import {parseCheckout3DRequest} from '../../deploy/3d-konfigurator/checkout-contract.js';
import {description} from '../../deploy/3d-konfigurator/model.js';
import {DELIVERY_LABEL} from '../../deploy/3d-konfigurator/delivery.js';

// Pure mapping for the future SERVER adapter, not an executable checkout.
// Variant IDs and prices must later come from persisted, verified 3D quotes.
// A cart-line attribute cannot set a Shopify merchandise price.
export function shopify3DLineMetadata(request){
 const payload=parseCheckout3DRequest(request);
 return payload.items.map(line=>({
  localLineId:line.id,quantity:line.quantity,
  attributes:[
   {key:'_neontrip_product_family',value:payload.productFamily},
   {key:'_neontrip_contract_version',value:String(payload.contractVersion)},
   {key:'_neontrip_line_id',value:line.id},
   {key:'Schriftzug',value:line.configuration.text},
   {key:'Ausführung',value:description(line.configuration,line.previewDimensions?.height)},
   {key:'Buchstabenabstand',value:line.configuration.spacing+' %'},
   {key:'Lieferzeit',value:DELIVERY_LABEL}
  ]
 }));
}
