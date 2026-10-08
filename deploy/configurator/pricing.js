import {PRICE_RULES} from './pricing-data.js?v=20261007-factor26';
import {geometryCostPrice,interpolateSupplement} from './pricing-model.js?v=20261007-factor26';
import {MANUFACTURING_PROFILE,TABLE_STAND_HEIGHT_MESSAGE,evaluatePlateManufacturing,minimumTextDesign} from './manufacturing-profile.js?v=20261006-stand1';
export {PRICE_RULES};
const cents=n=>Math.round((n+Number.EPSILON)*100)/100;
const euro=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
// Daniel confirmed on 05.10.2026: existing selling prices already include 20% off.
// Presentation only: do not discount the cost calculation or net selling price again.
export const INCLUDED_DISCOUNT_PERCENT=20;
// Customer-facing gross unit prices use nearest 5 cents; internal net costs stay intact.
export const roundGrossPrice=amount=>Math.round((amount+Number.EPSILON)*20)/20;
export function priceAmounts(price,quantity=1){
 if(price?.net==null&&price?.gross==null)return null;
 const grossFromNet=net=>roundGrossPrice(net*(1+(price.vatRate??PRICE_RULES.vatRate)));
 // Round the displayed options before summing, so extras and totals reconcile.
 const gross=price.components?.length
  ?cents(price.components.reduce((sum,component)=>sum+(component.unitNet!=null?grossFromNet(component.unitNet)*(component.quantity??1):grossFromNet(component.net)),0))
  :roundGrossPrice(price.gross??grossFromNet(price.net));
 const regularGross=roundGrossPrice(price.regularGross??gross/(1-INCLUDED_DISCOUNT_PERCENT/100));
 return {gross:cents(gross*quantity),regularGross:cents(regularGross*quantity)};
}
export function priceLabel(price){
 const amounts=priceAmounts(price);
 const labels={pending:'Wird berechnet …',empty:'Text eingeben','below-minimum':'Größer wählen','above-maximum':'Maximal 400 cm','invalid-size':'Maße prüfen','invalid-geometry':'Entwurf prüfen','invalid-mount':'Montage ändern','invalid-option':'Ausstattung wählen','rgb-outdoor':'Feste Farbe wählen','unavailable-color':'Andere Farbe wählen','unsupported-mode':'Text gestalten','invalid-text':'Text anpassen','too-many-lines':'Maximal 5 Zeilen','layout-too-wide':'Abstände verkleinern','overlapping-text':'Abstände vergrößern','layout-too-detailed':'Text oder Schrift ändern','missing-font':'Schrift auswählen','calculation-error':'Erneut berechnen'};
 return amounts?euro.format(amounts.gross):labels[price?.status]||'Entwurf prüfen';
}
export function mountingNet(mount,baseNet=0,rules=PRICE_RULES){
 const option=rules.extras[mount];
 return mount==='table-stand'?cents(Math.max((Number.isFinite(baseNet)?baseNet:0)*option.fraction,option.minimumGross/(1+rules.vatRate))):option;
}
export function accessoryCounts(design={}){
 const defaults={'wall-mount':1,'hanging-kit':design.mount==='hanging-kit'?1:0,'adhesive-kit':design.mount==='adhesive-kit'?1:0,'table-stand':design.mount==='table-stand'?1:0,dimmer:1,extraCable2m:design.extraCable2m?1:0,'premium-white':1};
 return Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,key==='extraCable2m'?0:key==='dimmer'&&design.accessoryQuantities?.[key]===0?1:design.accessoryQuantities?.[key]??value]));
}
export function priceOptions(design={}){
 const accessoryQuantities=accessoryCounts(design);
 return {outdoor:design.outdoor===true,dimmer:accessoryQuantities.dimmer>0,extraCable2m:accessoryQuantities.extraCable2m>0,powerSupply:'premium-white',accessoryQuantities};
}
// Exact same outer dimensions as the current configurator, also for saved designs.
export function pricingPlateSize(size,design){
 const d=size.exact.design,extra=accessoryCounts(design)['table-stand']>0?MANUFACTURING_PROFILE.standSupportMm:0;
 let p=design.backing==='contour'?{widthMm:d.widthMm+20,heightMm:d.heightMm+20}:design.backing==='freestanding'?{...d}:{...size.exact.backing};
 if(design.backing==='square'){const side=Math.max(p.widthMm,p.heightMm+extra);p={widthMm:side,heightMm:side-extra};}
 return {...p,heightMm:p.heightMm+extra};
}
const minimumCache=new WeakMap();
export function minimumSizeForResult(design,result){
 if(!result)return null;
 if(!minimumCache.has(result)||minimumCache.get(result).text!==design.text)minimumCache.set(result,{text:design.text,value:minimumTextDesign(result,design.text)});
 const min=minimumCache.get(result).value;if(!min)return null;
 const tube=MANUFACTURING_PROFILE.tubeMm,d=result.size.exact.design,margin=design.backing==='contour'?20:design.backing==='freestanding'?0:30,extra=accessoryCounts(design)['table-stand']>0?MANUFACTURING_PROFILE.standSupportMm:0;
 const floorMm=min.minimumOuterWidthMm;
 const floorScale=design.backing==='square'?Math.min((floorMm-margin-tube)/(d.widthMm-tube),(floorMm-margin-extra-tube)/(d.heightMm-tube)):(floorMm-margin-tube)/(d.widthMm-tube);
 const scale=Math.max((min.widthMm-tube)/(d.widthMm-tube),floorScale);
 const size={widthMm:(d.widthMm-tube)*scale+tube,heightMm:(d.heightMm-tube)*scale+tube};
 const plate=pricingPlateSize({exact:{design:size,backing:{widthMm:size.widthMm+30,heightMm:size.heightMm+30}}},design);
 const widthMm=Math.ceil(plate.widthMm-1e-7),heightMm=design.backing==='square'?widthMm:(widthMm-margin-tube)*(d.heightMm-tube)/(d.widthMm-tube)+tube+margin+extra;
 const roundedScale=design.backing==='square'?Math.min((widthMm-margin-tube)/(d.widthMm-tube),(widthMm-margin-extra-tube)/(d.heightMm-tube)):(widthMm-margin-tube)/(d.widthMm-tube);
 return {widthMm,heightMm,designWidthMm:(d.widthMm-tube)*roundedScale+tube,profileId:min.profileId,layoutConflict:min.layoutConflict||null,manufacturingApproved:false};
}
// One range for both size inputs, drag handles and automatic layout corrections.
// The 400-cm limit applies to the longer OUTER side, including plate and feet.
export function sizeRangeForResult(design,result){
 const minimum=minimumSizeForResult(design,result);if(!minimum)return null;
 const d=result.size.exact.design,tube=MANUFACTURING_PROFILE.tubeMm,margin=design.backing==='contour'?20:design.backing==='freestanding'?0:30,extra=accessoryCounts(design)['table-stand']>0?MANUFACTURING_PROFILE.standSupportMm:0;
 const maximumMm=PRICE_RULES.longestSideMaxCm*10;
 const scale=Math.min((maximumMm-margin-tube)/(d.widthMm-tube),(maximumMm-margin-extra-tube)/(d.heightMm-tube));
 const sized={widthMm:(d.widthMm-tube)*scale+tube,heightMm:(d.heightMm-tube)*scale+tube};
 const plate=pricingPlateSize({exact:{design:sized,backing:{widthMm:sized.widthMm+30,heightMm:sized.heightMm+30}}},design);
 const maximum={widthMm:plate.widthMm,heightMm:plate.heightMm,designWidthMm:sized.widthMm};
 return {minimum,maximum,fits:!minimum.layoutConflict&&minimum.widthMm<=maximum.widthMm+.1&&minimum.heightMm<=maximum.heightMm+.1};
}
export function layoutCorrectionStatus(design){return /[^\S\r\n]{2}|\n\s*\n/u.test(design.text||'')?'layout-too-wide':'layout-too-detailed';}
export function calculatePrice({text,fontId,widthMm,heightMm,ledMeters,backing='contour',finish='clear',mount='wall-mount',lightMode='static',outdoor=false,dimmer=false,extraCable2m=false,powerSupply='premium-white',accessoryQuantities,geometryValid=true,mode='text'},rules=PRICE_RULES){
 const reasons=[],projectionReasons=[],target={widthCm:widthMm/10,heightCm:heightMm/10,ledMeters},longCm=Math.max(target.widthCm,target.heightCm),shortCm=Math.min(target.widthCm,target.heightCm);
 const result={version:rules.version,status:'unavailable',currency:'EUR',net:null,baseNet:null,vatRate:rules.vatRate,vat:null,gross:null,components:[],reasons,projectionReasons,costs:null,manufacturingApproved:false,supplierConfirmed:false,purchaseEnabled:false};
 if(![widthMm,heightMm,ledMeters].every(n=>Number.isFinite(n)&&n>0))return {...result,status:'invalid-geometry',reasons:['Gültige Maße und LED-Pfadlänge fehlen. Bitte den Entwurf prüfen.']};
 if(target.widthCm<rules.widthCm.min-1e-6)return {...result,status:'below-minimum',reasons:['Bitte mindestens 50 cm Außenbreite wählen.']};
 if(target.widthCm>rules.widthCm.max+1e-6||longCm>rules.longestSideMaxCm+1e-6)return {...result,status:'above-maximum',reasons:['Die längste Seite darf höchstens 400 cm betragen. Bitte das Maß verkleinern.']};
 const quantities=accessoryCounts({mount,dimmer,extraCable2m,accessoryQuantities});
 if(Object.entries(quantities).some(([key,n])=>!Number.isInteger(n)||n<(['wall-mount','premium-white','dimmer'].includes(key)?1:0)||n>99))return {...result,status:'invalid-option',reasons:['Bitte gültige Zubehörmengen von 0 bis 99 wählen. Wandmontageset, Premium-Netzteil und Dimmer sind mindestens einmal enthalten.']};
 if(['table-stand','hanging-kit','adhesive-kit'].includes(mount)&&quantities[mount]<1)return {...result,status:'invalid-option',reasons:['Bitte die Stückzahl der gewählten Montage prüfen.']};
 if(quantities['table-stand']>0&&heightMm>MANUFACTURING_PROFILE.standMaximumHeightMm+1e-7)return {...result,status:'invalid-mount',reasons:[TABLE_STAND_HEIGHT_MESSAGE]};
 if(!geometryValid)return {...result,status:'invalid-mount',reasons:['Bitte eine Montage wählen, die zu dieser Rückplatte und Größe passt.']};
 if(mode!=='text')return {...result,status:'unsupported-mode',reasons:['Die automatische Preiskalkulation ist für Schriftzüge vorgesehen. Bitte „Text gestalten“ wählen.']};
 if(outdoor&&lightMode==='rgb')return {...result,status:'rgb-outdoor',reasons:['Für Außen bitte eine feste Leuchtfarbe wählen. RGB empfehlen wir draußen aus technischen Gründen nicht; besondere Projekte bitte mit uns besprechen.']};
 if(!Object.hasOwn(rules.extras.powerSupply,powerSupply))return {...result,status:'invalid-option',reasons:['Bitte ein verfügbares Netzteil wählen.']};
 if(rules.unpriced[backing])reasons.push(rules.unpriced[backing]);
 if(rules.unpriced[finish])reasons.push(rules.unpriced[finish]);
 if(!['contour','rectangle','square','freestanding'].includes(backing)||!['clear','uv-print','mirror-gold','mirror-silver'].includes(finish)||!Object.hasOwn(rules.extras,mount)||!['static','rgb'].includes(lightMode))reasons.push('Ausstattung ohne Preisregel.');
 if(reasons.length)return {...result,status:'invalid-option',reasons:['Bitte eine verfügbare Rückplatte, Oberfläche und Montage wählen.']};
 const metrics={longCm,shortCm,areaCm2:target.widthCm*target.heightCm,ledMeters,aspect:longCm/shortCm};
 const coverageNames={longCm:'längste Seite',shortCm:'kurze Seite',areaCm2:'Schildfläche',ledMeters:'LED-Länge',aspect:'Seitenverhältnis'};
 for(const [key,value] of Object.entries(metrics)){const b=rules.bounds[key];if(value<b.min-1e-6||value>b.max+1e-6)projectionReasons.push('Hochgerechnet: '+coverageNames[key]+' außerhalb der historischen Abdeckung.');}
 if(typeof text!=='string'||!text.trim())return {...result,status:'invalid-text',reasons:['Bitte einen gültigen Schriftzug eingeben.']};
 const selling=geometryCostPrice(target,rules.costModel);
 if(!selling)return {...result,status:'calculation-error',reasons:['Die Berechnungsdaten sind nicht vollständig geladen. Bitte die Seite neu laden.']};
 const baseNet=selling.net;
 result.pricingBasis=selling;
 result.costs={productionUsd:selling.productionUsd,shippingUsd:selling.shippingUsd,supplierUsd:selling.supplierUsd,supplierEur:selling.supplierEur,reserveUsd:0,longCm,method:rules.costModel.method};
 const components=[{id:'sign',label:'Neon-LED-Schild inkl. Lieferantenversand',net:baseNet}];
 for(const key of ['rgb','outdoor'])if(key==='rgb'?lightMode==='rgb':outdoor)components.push({id:key,label:key==='rgb'?'RGB':'Outdoor',net:cents(Math.max(baseNet*rules.extras[key].fraction,rules.extras[key].minimumNet))});
 if(finish!=='clear')components.push({id:finish,label:finish==='uv-print'?'Bedruckte Rückplatte':'Verspiegelte Rückplatte',net:cents(rules.extras.finishGross[finish]/(1+rules.vatRate))});
 if(backing==='freestanding'){
  components.push({id:'freestanding',label:'Freigestellte Stützstreben',net:cents(interpolateSupplement(rules.extras.freestanding.anchors,longCm))});
  projectionReasons.push('Strebenaufpreis aus dem Altshop-Feinzuschnitt hochgerechnet.');
 }
 const accessoryLabels={'wall-mount':'Wandmontage-Set','hanging-kit':'Drahtseil-Abhängeset','adhesive-kit':'3M-Klebeset','table-stand':'Tischständer',dimmer:'Dimmer',extraCable2m:'Weitere 2 m Kabel','premium-white':'Premium-Netzteil'};
 for(const [key,quantity] of Object.entries(quantities)){
  const included=['wall-mount','premium-white','dimmer'].includes(key)?1:0,paid=quantity-included;
  if(included)components.push({id:key+'-included',label:accessoryLabels[key]+' · 1 inklusive',net:0});
  if(paid<=0)continue;
  const unitNet=key==='wall-mount'?rules.extras.additionalWallMountNet:key==='premium-white'?rules.extras.additionalPremiumNet:key==='table-stand'?mountingNet(key,baseNet,rules):rules.extras[key];
  components.push({id:key,label:accessoryLabels[key]+(paid>1?' · '+paid+' Stück':''),unitNet,quantity:paid,net:cents(unitNet*paid)});
 }
 result.components=components;
 if(reasons.length)return result;
 const net=cents(components.reduce((sum,c)=>sum+c.net,0)),vat=cents(net*rules.vatRate);
 return {...result,status:'calculated',net,baseNet,vat,gross:cents(net+vat)};
}
export function priceForResult(design,result){
 if(!result)return {version:PRICE_RULES.version,status:'pending',net:null,reasons:[]};
 if(design.lightMode!=='rgb'&&[typeof design.color==='string'?design.color:design.color?.id,...Array.from(design.wordColors||[],p=>typeof p[1]==='string'?p[1]:p[1]?.id),...Array.from(design.charColors||[],p=>typeof p[1]==='string'?p[1]:p[1]?.id)].includes('tropical_blue'))return {version:PRICE_RULES.version,status:'unavailable-color',net:null,reasons:['Tropisches Blau ist nicht mehr erhältlich. Bitte eine andere Leuchtfarbe wählen.']};
 const quantities=accessoryCounts(design),plate=pricingPlateSize(result.size,design),check=evaluatePlateManufacturing({...plate,mount:quantities['table-stand']>0?'table-stand':design.mount,marginMm:10});
 const range=sizeRangeForResult(design,result),minimum=range?.minimum;
 if(minimum?.layoutConflict)return {version:PRICE_RULES.version,status:'overlapping-text',net:null,reasons:['Getrennte Wörter oder Zeilen überschneiden sich. Bitte mehr Leerzeichen oder einen größeren Zeilenabstand wählen.'],manufacturingApproved:false,purchaseEnabled:false};
 if(range&&!range.fits)return {version:PRICE_RULES.version,status:layoutCorrectionStatus(design),net:null,reasons:['Dieser Text passt mit seinen Details und Abständen nicht in 50–400 cm. Bitte Leerzeichen oder Leerzeilen reduzieren, den Text kürzen oder eine einfachere Schrift wählen.'],manufacturingApproved:false,purchaseEnabled:false};
 if(minimum&&plate.widthMm<minimum.widthMm-.1)return {version:PRICE_RULES.version,status:'below-minimum',net:null,minimum,reasons:[`Für diesen Text in dieser Schrift mindestens ${(minimum.widthMm/10).toLocaleString('de-DE')} cm Außenbreite. Bitte größer wählen.`],manufacturingApproved:false,purchaseEnabled:false};
 return calculatePrice({text:design.text,fontId:design.fontId,...plate,ledMeters:result.production?.routeLengthMm/1000,backing:design.backing,finish:design.plateFinish?.kind||'clear',mount:design.mount,lightMode:design.lightMode||'static',...priceOptions(design),geometryValid:check.status!=='geometry-conflict'&&!(design.backing==='freestanding'&&(quantities['hanging-kit']>0||quantities['table-stand']>0||quantities['adhesive-kit']>0)),mode:design.mode||'text'});
}
