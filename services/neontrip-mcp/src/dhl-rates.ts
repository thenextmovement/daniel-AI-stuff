import {randomUUID} from "node:crypto";
import {draftSchema,type Draft,type Offer} from "./dhl-preview.js";
export type DhlRateConfig={environment:"test"|"production";username:string;password:string;accountNumber:string};
const MAX_BYTES=1500000;
async function boundedJson(response:Response):Promise<any>{
 if(!response.ok)throw new Error("DHL HTTP "+response.status);
 if(Number(response.headers.get("content-length"))>MAX_BYTES)throw new Error("Antwort zu groß");
 const reader=response.body?.getReader();if(!reader)throw new Error("Leere Antwort");
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();throw new Error("Antwort zu groß");}chunks.push(value);}}
 finally{reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function fetchDhlRates(input:Draft,config:DhlRateConfig,fetchImpl:typeof fetch=fetch,now:()=>number=Date.now):Promise<{offers:Offer[];warnings:string[]}>{
 const draft=draftSchema.parse(input);
 if(!config.username||!config.password||!/^\d{9}$/.test(config.accountNumber))throw new Error("DHL-Zugang nicht eingerichtet.");
 for(const date of draft.shippingDates){
  const time=Date.parse(date);
  if(time<now()||time>now()+10*86400000)throw new Error("Versandzeit muss in der Zukunft und innerhalb der nächsten zehn Tage liegen.");
 }
 const endpoint="https://express.api.dhl.com/mydhlapi"+(config.environment==="test"?"/test":"")+"/rates";
 const outcomes=await Promise.allSettled([...new Set(draft.shippingDates)].map(async(date)=>{
  const address=(a:Draft["shipper"])=>({postalCode:a.postalCode,cityName:a.city,countryCode:a.countryCode,addressLine1:a.addressLines[0],...(a.addressLines[1]?{addressLine2:a.addressLines[1]}:{}),...(a.addressLines[2]?{addressLine3:a.addressLines[2]}:{})});
  const planned=date.replace(/(Z|[+-]\d\d:\d\d)$/,(offset)=>"GMT"+(offset==="Z"?"+00:00":offset));
  const body={customerDetails:{shipperDetails:address(draft.shipper),receiverDetails:address(draft.receiver)},accounts:[{typeCode:"shipper",number:config.accountNumber}],plannedShippingDateAndTime:planned,unitOfMeasurement:"metric",isCustomsDeclarable:draft.customsDeclarable,
   ...(draft.declaredValue?{monetaryAmount:[{typeCode:"declaredValue",value:draft.declaredValue.amount,currency:draft.declaredValue.currency}]}:{}),
   estimatedDeliveryDate:{isRequested:true,typeCode:"QDDC"},
   packages:draft.parcels.map(p=>({weight:p.weightKg,dimensions:{length:p.lengthCm,width:p.widthCm,height:p.heightCm}}))};
  const response=await fetchImpl(endpoint,{method:"POST",redirect:"error",signal:AbortSignal.timeout(8000),headers:{"content-type":"application/json",accept:"application/json",authorization:"Basic "+Buffer.from(config.username+":"+config.password).toString("base64")},body:JSON.stringify(body)});
  const result=await boundedJson(response);
  if(!Array.isArray(result.products))throw new Error("Keine Produkte");
  const offers:Offer[]=[];
  for(const p of result.products.slice(0,100)){
   const price=Array.isArray(p.totalPrice)?p.totalPrice.find((v:any)=>v.currencyType==="BILLC"&&typeof v.price==="number"&&Number.isFinite(v.price)&&v.price>=0&&/^[A-Z]{3}$/.test(v.priceCurrency)):undefined;
   if(!price||typeof p.productCode!=="string")continue;
   const delivery=p.deliveryCapabilities?.estimatedDeliveryDateAndTime;
   offers.push({id:randomUUID(),shippingDate:date,...(typeof delivery==="string"&&Number.isFinite(Date.parse(delivery))?{deliveryDate:delivery}:{}),productCode:p.productCode,...(typeof p.localProductCode==="string"?{localProductCode:p.localProductCode}:{}),productName:typeof p.productName==="string"?p.productName:p.productCode,amount:price.price,currency:price.priceCurrency,taxNote:"DHL-Kostenschätzung. Steuerstatus und nachträgliche Zuschläge nicht abschließend bestätigt; Einfuhrabgaben nicht enthalten.",source:"dhl-account-rate",environment:config.environment});
  }
  return {date,offers};
 }));
 const offers:Offer[]=[];const warnings:string[]=[];
 outcomes.forEach((r,i)=>{
  if(r.status==="fulfilled"){offers.push(...r.value.offers);if(!r.value.offers.length)warnings.push("Für "+draft.shippingDates[i]+" liegt kein auswertbarer DHL-Kundentarif vor.");}
  else warnings.push("DHL-Preisabfrage für "+draft.shippingDates[i]+" nicht bestätigt. Bitte Eingaben und Zugang prüfen oder erneut abfragen.");
 });
 return {offers,warnings};
}
