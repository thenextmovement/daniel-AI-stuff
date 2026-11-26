import test from "node:test";
import assert from "node:assert/strict";
import {createPreviewStore, draftSchema} from "../src/dhl-preview.js";
import {draft,offer} from "./fixtures/dhl-preview.js";
test("preview confirmation cannot book and rejects stale versions, other owners and unknown offers",()=>{
 const s=createPreviewStore(()=>1000); const p=s.put("rahim",draft);
 s.setOffers("rahim",p.id,p.version,[offer],[]);
 assert.deepEqual(s.confirm("rahim",p.id,p.version,offer.id),{status:"preview_confirmed",booked:false});
 assert.deepEqual(s.confirm("rahim",p.id,p.version,offer.id),{status:"preview_confirmed",booked:false});
 assert.throws(()=>s.get("someone-else",p.id,p.version));
 assert.throws(()=>s.confirm("rahim",p.id,p.version,"invented"));
 s.put("rahim",{...draft,parcels:[{...draft.parcels[0]!,weightKg:6}]},p);
 assert.throws(()=>s.confirm("rahim",p.id,p.version,offer.id));
 assert.throws(()=>s.setOffers("rahim",p.id,p.version,[offer],[]));
});
test("expired previews cannot be revived; copies cannot mutate internal data",()=>{
 let now=0; const s=createPreviewStore(()=>now); const p=s.put("a",draft);
 p.draft.receiver.name="tampered"; assert.equal(s.get("a",p.id,p.version).draft.receiver.name,draft.receiver.name);
 now=600001; assert.throws(()=>s.get("a",p.id,p.version));
 assert.throws(()=>s.put("a",draft,p));
});
test("missing dimensions, units, contact and zero weight fail validation",()=>{
 for(const patch of [{parcels:[]},{parcels:[{...draft.parcels[0],weightKg:0}]},{parcels:[{...draft.parcels[0],weightKg:NaN}]},{receiver:{...draft.receiver,phone:""}},{receiver:{...draft.receiver,countryCode:"Germany"}},{shippingDates:["tomorrow"]}])
  assert.equal(draftSchema.safeParse({...draft,...patch}).success,false);
 assert.equal(draftSchema.safeParse({...draft,customsDeclarable:true}).success,false);
});
test("capacity is bounded and expired records are removed",()=>{
 let now=0; const s=createPreviewStore(()=>now);
 for(let i=0;i<100;i++)s.put("a",draft);
 assert.throws(()=>s.put("a",draft)); now=600001; assert.ok(s.put("a",draft).id);
});
