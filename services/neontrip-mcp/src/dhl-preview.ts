import {randomUUID} from "node:crypto";
import {z} from "zod";
const text=(max:number)=>z.string().trim().min(1).max(max).refine(v=>!/[\u0000-\u001f\u007f]/u.test(v),"Kontrollzeichen sind nicht erlaubt.");
const addressSchema=z.object({
 name:text(120),company:text(120).optional(),addressLines:z.array(text(150)).min(1).max(3),
 postalCode:text(20),city:text(100),countryCode:z.string().regex(/^[A-Z]{2}$/),
 phone:text(40),email:z.email().max(254).optional(),
}).strict();
export const draftSchema=z.object({
 shipper:addressSchema,receiver:addressSchema,
 parcels:z.array(z.object({lengthCm:z.number().finite().positive().max(3000),widthCm:z.number().finite().positive().max(3000),heightCm:z.number().finite().positive().max(3000),weightKg:z.number().finite().positive().max(3000)}).strict()).min(1).max(10),
 shippingDates:z.array(z.iso.datetime({offset:true})).min(1).max(3),
 customsDeclarable:z.boolean(),
 declaredValue:z.object({amount:z.number().finite().positive(),currency:z.string().regex(/^[A-Z]{3}$/)}).strict().optional(),
 dutiesPayer:z.literal("receiver"),
}).strict().refine(v=>!v.customsDeclarable||!!v.declaredValue,{message:"Warenwert und Währung für Zollsendungen erforderlich.",path:["declaredValue"]});
export type Draft=z.infer<typeof draftSchema>;
export type Offer={id:string;shippingDate:string;deliveryDate?:string;productCode:string;localProductCode?:string;productName:string;amount:number;currency:string;taxNote:string;source:"dhl-account-rate";environment:"test"|"production"};
export type Preview={id:string;version:number;expiresAt:number;mode:"preview";draft:Draft;offers:Offer[];warnings:string[]};
export interface PreviewStore {
 put(owner:string,draft:Draft,prior?:{id:string;version:number}):Preview;
 get(owner:string,id:string,version:number):Preview;
 setOffers(owner:string,id:string,version:number,offers:Offer[],warnings:string[]):Preview;
 confirm(owner:string,id:string,version:number,offerId:string):{status:"preview_confirmed";booked:false};
}
export function createPreviewStore(now:()=>number=Date.now):PreviewStore {
 const entries=new Map<string,{owner:string;preview:Preview}>();
 const read=(owner:string,id:string,version:number)=>{
  const entry=entries.get(id);
  if(!entry||entry.owner!==owner||entry.preview.expiresAt<=now())throw new Error("Vorschau nicht verfügbar oder abgelaufen. Bitte neu vorbereiten.");
  if(entry.preview.version!==version)throw new Error("Die Versanddaten wurden geändert. Bitte die aktuelle Maske verwenden.");
  return entry.preview;
 };
 return {
  put(owner,draft,prior){
   const parsed=draftSchema.parse(draft);
   if(prior)read(owner,prior.id,prior.version);
   for(const [key,value] of entries)if(value.preview.expiresAt<=now())entries.delete(key);
   if(!prior&&entries.size>=100)throw new Error("Zu viele Vorschauen. Bitte später erneut versuchen.");
   const preview:Preview={id:prior?.id??randomUUID(),version:(prior?.version??0)+1,expiresAt:now()+600000,mode:"preview",draft:parsed,offers:[],warnings:[]};
   entries.set(preview.id,{owner,preview});return structuredClone(preview);
  },
  get(owner,id,version){return structuredClone(read(owner,id,version));},
  setOffers(owner,id,version,offers,warnings){
   const p=read(owner,id,version);p.offers=structuredClone(offers);p.warnings=[...warnings];return structuredClone(p);
  },
  confirm(owner,id,version,offerId){
   const p=read(owner,id,version);
   if(!p.offers.some(o=>o.id===offerId))throw new Error("Bitte ein aktuelles DHL-Angebot auswählen.");
   return {status:"preview_confirmed",booked:false};
  },
 };
}
