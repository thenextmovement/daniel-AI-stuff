// Separate product family: never pass 3D letters to the neon-tube price/checkout API.
// Customer supplied 2026-10-21: about EUR 110 per linear metre ONLY for the rail's custom colour.
// Base prices and tax basis are still pending; this estimate cannot enable purchase.
export const RAIL_COLOR_RATE = 110;
export function railColorEstimate(design,quantity=1){
 if(design?.mount!=='rail'||design.railCustomColor!==true)return null;
 if(!Number.isFinite(design.width)||design.width<30||design.width>400||!Number.isInteger(quantity)||quantity<1||quantity>99)return null;
 const metres=design.width/100,unitCents=Math.round(metres*RAIL_COLOR_RATE*100);
 return {kind:'rail-custom-colour',status:'provisional',currency:'EUR',taxBasis:null,metres,quantity,ratePerMetre:RAIL_COLOR_RATE,unitCents,totalCents:unitCents*quantity};
}
export function quote3D(items=[]){
 const estimates=Array.isArray(items)?items.map(item=>railColorEstimate(item?.design,item?.quantity??1)).filter(Boolean):[];
 return Object.freeze({status:'placeholder',currency:'EUR',grossCents:null,version:null,purchaseEnabled:false,estimates});
}
