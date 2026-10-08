import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePrice,priceAmounts,priceLabel,PRICE_RULES} from '../deploy/configurator/pricing.js';
import {getDeliveryQuote} from '../deploy/configurator/delivery-calendar.js';

const input={text:'Hi',fontId:'Waikiki',widthMm:500,heightMm:100,ledMeters:1};
const rulesForGross=gross=>({...PRICE_RULES,costModel:{...PRICE_RULES.costModel,
  sellingNetFactor:gross/1.19/((14+0.5*65+0.05*175)/1.1269)}});

test('EUR 189 is the discounted gross floor per sign, including cent-rounding boundaries',()=>{
 for(const [raw,expected] of [[100,189],[188.95,189],[188.99,189],[189,189],[189.04,189.05],[250,250]]){
  const price=calculatePrice(input,rulesForGross(raw));
  assert.equal(price.status,'calculated');
  assert.equal(priceAmounts(price).gross,expected);
  assert.equal(Math.round(priceAmounts(price,3).gross*100),Math.round(expected*100)*3);
  if(raw>=189)assert.ok(Math.abs(price.baseNet-raw/1.19)<1e-9);
 }
 const price=calculatePrice(input,rulesForGross(100));
 assert.equal(priceLabel(price),'189,00 €');
 assert.equal(priceAmounts(price).regularGross,236.25);
});

test('optional equipment and express remain additional to the sign floor',()=>{
 const rules=rulesForGross(100),base=calculatePrice(input,rules);
 const withExtras=calculatePrice({...input,accessoryQuantities:{dimmer:3}},rules);
 const extra=withExtras.components.find(c=>c.id==='dimmer');
 assert.equal(extra.quantity,2);
 assert.equal(priceAmounts(withExtras).gross,189+priceAmounts({net:extra.unitNet,vatRate:.19},2).gross);
 for(const options of [{lightMode:'rgb'},{outdoor:true},{mount:'table-stand'},{finish:'mirror-gold'},{backing:'freestanding'}]){
  const price=calculatePrice({...input,...options},rules);
  assert.equal(price.status,'calculated');
  assert.equal(price.baseNet,base.baseNet);
  assert.ok(priceAmounts(price).gross>189);
 }
 assert.equal(getDeliveryQuote(15,Math.round(base.baseNet)).feeGross,0);
 assert.equal(getDeliveryQuote(6,Math.round(base.baseNet)).feeGross,178.5);
});

test('minimum pricing does not make invalid signs purchasable',()=>{
 for(const [change,status] of [[{text:''},'invalid-text'],[{widthMm:499},'below-minimum'],[{widthMm:4001},'above-maximum'],[{ledMeters:0},'invalid-geometry'],[{geometryValid:false},'invalid-mount'],[{mode:'logo'},'unsupported-mode'],[{outdoor:true,lightMode:'rgb'},'rgb-outdoor']]){
  const price=calculatePrice({...input,...change});
  assert.equal(price.status,status);assert.equal(priceAmounts(price),null);
 }
});
