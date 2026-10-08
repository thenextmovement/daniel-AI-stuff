// Historical estimator and Offers helpers retained for comparison.
// Active geometryCostPrice below converts USD explicitly; estimates are not supplier confirmations.
export const quantile=(values,q)=>{const a=[...values].sort((a,b)=>a-b);if(!a.length)return null;const p=(a.length-1)*q,i=Math.floor(p);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(p-i);};
export const median=a=>quantile(a,.5);
export const roundUpFive=n=>Math.ceil(n/5)*5;
export const roundDownFive=n=>Math.floor((Math.round(n*100)/100)/5)*5;
export function distance(a,b){
  const shape=r=>({area:r.widthCm*r.heightCm,long:Math.max(r.widthCm,r.heightCm),ratio:Math.max(r.widthCm,r.heightCm)/Math.min(r.widthCm,r.heightCm)});
  const x=shape(a),y=shape(b);
  return Math.abs(Math.log(x.area/y.area))+Math.abs(Math.log(x.long/y.long))+.5*Math.abs(Math.log(x.ratio/y.ratio));
}
export function estimateCosts(rows,target,excludeDesign=null){
  const eligible=rows.filter(r=>r.design!==excludeDesign),rateDesigns=new Map();
  for(const r of eligible)if(r.ledMeters>0&&r.ledMeters<200&&!rateDesigns.has(r.design))rateDesigns.set(r.design,r.productionUsd/r.ledMeters);
  const seen=new Set(),neighbors=eligible.map(r=>({...r,score:distance(r,target)})).sort((a,b)=>a.score-b.score||a.id.localeCompare(b.id)).filter(r=>{if(seen.has(r.design))return false;seen.add(r.design);return true;}).slice(0,12);
  if(rateDesigns.size<5||neighbors.length<5)return null;
  const targetLong=Math.max(target.widthCm,target.heightCm),targetShort=Math.min(target.widthCm,target.heightCm);
  // Grow comparable shipping quotes with target geometry; preserve observed small-parcel costs.
  const rateUsd=median([...rateDesigns.values()]),shippingUsd=median(neighbors.map(r=>r.shippingUsd*Math.max(1,(targetLong/Math.max(r.widthCm,r.heightCm))*Math.sqrt(targetShort/Math.min(r.widthCm,r.heightCm)))));
  return {rateUsd,productionUsd:target.ledMeters*rateUsd,shippingUsd,rateDesigns:rateDesigns.size,neighborCount:neighbors.length,nearestScore:neighbors[0].score,furthestScore:neighbors.at(-1).score,sourceIds:neighbors.map(r=>r.id)};
}
export function calibrate(rows){
  const evaluations=rows.filter(r=>r.ledMeters>0).flatMap(r=>{const prediction=estimateCosts(rows,r,r.design);return prediction?[{id:r.id,design:r.design,longCm:Math.max(r.widthCm,r.heightCm),observedUsd:r.productionUsd+r.shippingUsd,predictedUsd:prediction.productionUsd+prediction.shippingUsd,underestimateUsd:Math.max(0,r.productionUsd+r.shippingUsd-prediction.productionUsd-prediction.shippingUsd)}]:[];});
  const large=new Map();
  for(const e of evaluations)if(e.longCm>200)large.set(e.design,Math.max(large.get(e.design)||0,e.underestimateUsd));
  const positive=[...large.values()].filter(n=>n>0),p90=quantile(positive,.9)||0;
  return {evaluations,largeDesigns:large.size,positiveDesigns:positive.length,p90Usd:p90,reserveUsd:large.size<20?Math.max(0,...positive):p90,reserveMethod:large.size<20?'maximum-positive-design-error':'p90-positive-design-errors'};
}

// Sample the existing independent-design estimator once. A cumulative maximum
// and bilinear interpolation remove neighbor-switch discounts and hard tiers.
export function buildShippingGrid(rows){
 const axes=[10,25,50,75,100,150,200,220,240],cells=[];
 for(let i=0;i<axes.length;i++){
  cells[i]=[];
  for(let j=0;j<axes.length;j++){
   const e=estimateCosts(rows,{widthCm:axes[i],heightCm:axes[j],ledMeters:1});
   if(!e)throw new Error('Zu wenige Versandbelege.');
   const previous=[cells[i-1]?.[j],cells[i][j-1]].filter(Boolean).sort((a,b)=>b.usd-a.usd)[0];
   cells[i][j]=previous&&previous.usd>e.shippingUsd?{...previous}:{usd:e.shippingUsd,sourceIds:e.sourceIds};
  }
 }
 return {axes,cells,method:'monotone-size-normalized-neighbor-grid-no-downscale-linear-extension'};
}
export function projectedShipping(grid,widthCm,heightCm){
 const a=grid.axes,last=a.at(-1);
 const position=n=>{const value=Math.max(a[0],Math.min(last,n));let i=0;while(i<a.length-2&&value>a[i+1])i++;return {i,t:(value-a[i])/(a[i+1]-a[i])};};
 const x=position(widthCm),y=position(heightCm),parts=[[x.i,y.i,(1-x.t)*(1-y.t)],[x.i+1,y.i,x.t*(1-y.t)],[x.i,y.i+1,(1-x.t)*y.t],[x.i+1,y.i+1,x.t*y.t]];
 const scale=Math.max(1,widthCm/last)*Math.max(1,heightCm/last);
 return {shippingUsd:parts.reduce((sum,[i,j,w])=>sum+grid.cells[i][j].usd*w,0)*scale,shippingScale:scale,sourceIds:[...new Set(parts.filter(p=>p[2]>0).flatMap(([i,j])=>grid.cells[i][j].sourceIds))]};
}
export function calibrateProjection(rows){
 const folds=new Map(),evaluations=[];
 for(const r of rows){
  if(!r.ledMeters)continue;
  if(!folds.has(r.design)){
   const train=rows.filter(other=>other.design!==r.design);
   const e=estimateCosts(train,r);
   if(!e)continue;
   folds.set(r.design,{grid:buildShippingGrid(train),rateUsd:e.rateUsd});
  }
  const f=folds.get(r.design),s=projectedShipping(f.grid,r.widthCm,r.heightCm),predictedUsd=f.rateUsd*r.ledMeters+s.shippingUsd,longCm=Math.max(r.widthCm,r.heightCm);
  evaluations.push({id:r.id,design:r.design,longCm,observedUsd:r.productionUsd+r.shippingUsd,predictedUsd,underestimateUsd:Math.max(0,r.productionUsd+r.shippingUsd-predictedUsd),sourceIds:s.sourceIds});
 }
 const large=new Map();
 for(const e of evaluations)if(e.longCm>200)large.set(e.design,Math.max(large.get(e.design)||0,e.underestimateUsd/(e.longCm-200)));
 const positive=[...large.values()].filter(n=>n>0),p90=quantile(positive,.9)||0;
 return {evaluations,largeDesigns:large.size,positiveDesigns:positive.length,p90UsdPerCm:p90,usdPerCm:large.size<20?Math.max(0,...positive):p90,method:'positive-heldout-design-error-per-cm-over-200'};
}
export function interpolateSupplement(anchors,longCm){
 if(longCm<=anchors[0].cm)return anchors[0].net*longCm/anchors[0].cm;
 const last=anchors.at(-1);if(longCm>=last.cm)return last.net*longCm/last.cm;
 const i=anchors.findIndex(a=>a.cm>=longCm),lo=anchors[i-1],hi=anchors[i];
 return lo.net+(hi.net-lo.net)*(longCm-lo.cm)/(hi.cm-lo.cm);
}

// Offers src/lib/ops/offer-size-ladder.ts, anchored_offer_size_ladder_v1.
// Pure arithmetic only; these estimates do not confirm supplier or manufacturing costs.
const money2=n=>Math.round((n+Number.EPSILON)*100)/100;
export function scaleOfferAnchor(anchor,targetArea){
 if(Math.abs(anchor.areaCm2-targetArea)<1)return {production:anchor.production,shipping:anchor.shipping};
 const ratio=Math.max(targetArea/anchor.areaCm2,.001);
 return {production:money2(anchor.production*ratio**.82),shipping:money2(anchor.shipping*ratio**.78)};
}
export function scaleSplitSign(anchor,sizeFactor){
 // Daniel, 2026-10-07: 3 * 100 + 3 * 40 * .85 = 402, not 334.
 return {production:money2(anchor.production*sizeFactor),shipping:money2(anchor.shipping*sizeFactor*.85)};
}
export function legacyTariffReference({text,fontId,widthCm},tariff){
 if(typeof text!=='string'||!text.trim()||!Number.isFinite(widthCm)||widthCm<=0)return null;
 const lines=text.normalize('NFC').replace(/\r\n?/g,'\n').replace(/[^\S\n]+/gu,' ').split('\n').map(s=>s.trim()).filter(Boolean);
 const counts=lines.map(s=>[...s.replace(/\s/gu,'')].length),characters=counts.reduce((a,b)=>a+b,0),longest=Math.max(...counts);
 if(!characters||lines.length>5)return null;
 const group=tariff.fontGroups[fontId],row=Math.min(characters,40)-1;
 const pointsFor=(g,strict)=>tariff.groups[g][row].filter(p=>p.gross>0&&(!strict||longest<=p.lineLimit)).map(p=>({...p,gross:p.gross+(lines.length-1)*p.lineFeeGross}));
 const points=group&&characters<=40?pointsFor(group,true):[];
 const exact=points.find(p=>Math.abs(p.widthCm-widthCm)<1e-7);
 const low=exact||points.filter(p=>p.widthCm<widthCm).at(-1),high=exact||points.find(p=>p.widthCm>widthCm);
 const details={group:group||'conservative-font-envelope',characters,lines:lines.length};
 if(low&&high){
  const gross=exact?exact.gross:low.gross+(high.gross-low.gross)*(widthCm-low.widthCm)/(high.widthCm-low.widthCm);
  return {...details,status:'legacy',gross:Math.round((gross+Number.EPSILON)*20)/20,lowerWidthCm:low.widthCm,upperWidthCm:high.widthCm};
 }
 // Unknown fonts use the greatest positive reference at each width, never the
 // cheapest font. Long texts reuse the 40-character anchor with more production.
 const byWidth=new Map();
 for(const g of group?[group]:Object.keys(tariff.groups))for(const p of pointsFor(g,false))if(!byWidth.has(p.widthCm)||byWidth.get(p.widthCm).gross<p.gross)byWidth.set(p.widthCm,p);
 return {...details,status:'anchored',anchors:[...byWidth.values()].sort((a,b)=>a.widthCm-b.widthCm),characterFactor:Math.max(1,characters/40)};
}
export function anchoredSellingPrice(input,rules,estimate){
 const reference=legacyTariffReference(input,rules.legacyTariff);
 if(!reference)return null;
 if(reference.status==='legacy')return {...reference,net:money2(reference.gross/(1+rules.vatRate)),bufferPercent:0};
 const {widthCm,heightCm,ledMeters}=input;
 // Allocate the historical selling anchor using the existing geometry estimator.
 // This allocation is explicitly estimated, not a recorded historical EK split.
 const allocate=p=>{
  const ratio=p.widthCm/widthCm,h=heightCm*ratio;
  const productionCost=ledMeters*ratio*estimate.rateUsd,shippingCost=projectedShipping(rules.projection.shipping,p.widthCm,h).shippingUsd;
  const net=p.gross/(1+rules.vatRate),share=productionCost/(productionCost+shippingCost);
  return {...p,areaCm2:p.widthCm*h,production:net*share*reference.characterFactor,shipping:net*(1-share)};
 };
 const anchors=reference.anchors.map(allocate),targetArea=widthCm*heightCm;
 if(!anchors.length)return null;
 const exact=anchors.find(p=>Math.abs(p.widthCm-widthCm)<1e-7);
 let amounts,basis,anchorWidthCm;
 if(exact){amounts=exact;basis='conservative-font-anchor';anchorWidthCm=exact.widthCm;}
 else if(widthCm>anchors.at(-1).widthCm){
  const last=anchors.at(-1);amounts=scaleSplitSign(last,widthCm/last.widthCm);basis='split-sign';anchorWidthCm=last.widthCm;
  // A shipping consolidation discount must not make a larger sign cheaper.
  const floor=last.production+last.shipping;
  amounts.floorNet=floor;
 }else if(widthCm<anchors[0].widthCm){
  const first=anchors[0];amounts=scaleOfferAnchor(first,targetArea);basis='offers-single-anchor';anchorWidthCm=first.widthCm;
  amounts.floorNet=first.production+first.shipping;
 }else{
  const lo=anchors.filter(p=>p.widthCm<widthCm).at(-1),hi=anchors.find(p=>p.widthCm>widthCm);
  // Offers: production interpolates logarithmically by area; shipping linearly.
  const logT=Math.log(targetArea/lo.areaCm2)/Math.log(hi.areaCm2/lo.areaCm2),t=(targetArea-lo.areaCm2)/(hi.areaCm2-lo.areaCm2);
  amounts={production:money2(lo.production*(hi.production/lo.production)**logT),shipping:money2(lo.shipping+(hi.shipping-lo.shipping)*t)};
  // Keep the conservative old font envelope as a floor between its anchors too.
  amounts.floorNet=(lo.gross+(hi.gross-lo.gross)*(widthCm-lo.widthCm)/(hi.widthCm-lo.widthCm))/(1+rules.vatRate);
  basis='offers-anchor-interpolation';anchorWidthCm=lo.widthCm;
 }
 // For unknown/unsupported references the measured LED/parcel estimate is an
 // additional lower bound. The established Offers factor is used only here.
 let geometryNet=0;
 if(basis==='split-sign'){
  // Do not reintroduce a giant unsplit-parcel quote through the fallback floor.
  // Known old fonts already have a selling anchor. Unknown fonts/long texts
  // carry their geometry floor forward with the same split-shipping rule.
  if(!rules.legacyTariff.fontGroups[input.fontId]||reference.characters>40){
   const ratio=anchorWidthCm/widthCm,production=estimate.productionUsd*ratio,shipping=projectedShipping(rules.projection.shipping,anchorWidthCm,heightCm*ratio).shippingUsd;
   const anchorNet=roundDownFive(roundUpFive(production+shipping)*rules.offerScaling.customerFactor),factor=anchorNet/(production+shipping);
   const split=scaleSplitSign({production:production*factor,shipping:shipping*factor},1/ratio);
   geometryNet=Math.max(anchorNet,split.production+split.shipping);
  }
 }else geometryNet=roundDownFive(roundUpFive(estimate.productionUsd+projectedShipping(rules.projection.shipping,widthCm,heightCm).shippingUsd)*rules.offerScaling.customerFactor);
 const net=money2(Math.max(amounts.production+amounts.shipping,amounts.floorNet||0,geometryNet));
 return {...reference,anchors:undefined,net,basis,anchorWidthCm,estimatedSplit:true,productionNet:amounts.production,shippingNet:amounts.shipping,geometryFloorNet:geometryNet,bufferPercent:0};
}

// Approved local Standard-Neonflex estimate: whole-sign geometry, without font groups or split discounts.
// USD supplier quotes are converted explicitly; these are not confirmed landed costs.
export function geometryCostPrice(target,model){
 const values=[target.widthCm,target.heightCm,target.ledMeters,model?.productionUsdPerLedMeter,model?.shippingUsdPerLongestMeter,model?.shippingUsdPerSquareMeter,model?.usdPerEur,model?.sellingNetFactor];
 if(!values.every(value=>Number.isFinite(value)&&value>0))return null;
 const longestMeters=Math.max(target.widthCm,target.heightCm)/100,areaSquareMeters=target.widthCm*target.heightCm/10000;
 const productionUsd=target.ledMeters*model.productionUsdPerLedMeter;
 const shippingUsd=longestMeters*model.shippingUsdPerLongestMeter+areaSquareMeters*model.shippingUsdPerSquareMeter;
 const supplierUsd=productionUsd+shippingUsd,supplierEur=supplierUsd/model.usdPerEur;
 return {status:'geometry-cost-estimate',net:supplierEur*model.sellingNetFactor,productionUsd,shippingUsd,supplierUsd,supplierEur,longestMeters,areaSquareMeters,usdPerEur:model.usdPerEur,sellingNetFactor:model.sellingNetFactor};
}
