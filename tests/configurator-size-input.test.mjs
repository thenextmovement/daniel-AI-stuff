import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../deploy/configurator/configurator.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function normalizeOuterInput('),source.indexOf('function syncOuterSize('));
const normalize=vm.runInNewContext(code+';normalizeOuterInput');

test('a rounded displayed minimum height maps to manufacturable dimensions',()=>{
 // 13.8 cm is the displayed boundary of a fractional-mm minimum.
 for(const minimum of [138.1,138.49,138.51,138.99]){
  const fitted=normalize(Math.round(minimum),minimum,956.47);
  assert.ok(fitted>=minimum);
  assert.equal(Math.round(fitted),Math.round(minimum));
 }
});
test('rounded maxima stay inside the actual longer-side limit',()=>{
 for(const maximum of [956.47,956.75,4000]){
  const fitted=normalize(Math.round(maximum),138.1,maximum);
  assert.ok(fitted<=maximum);
  assert.equal(Math.round(fitted),Math.round(maximum));
 }
});
test('ordinary dimensions are unchanged; invalid entries are not broadly clamped',()=>{
 assert.equal(normalize(750,500,4000),750);
 for(const value of [NaN,Infinity,0,-10,499,4001])assert.equal(normalize(value,500,4000),null);
 assert.equal(normalize(130,138.1,956.47),null);
 assert.equal(normalize(4000,4001,4000),null);
});
test('a narrow legal range never gets inverted by the numerical inset',()=>{
 const fitted=normalize(500,500,500.001);
 assert.ok(fitted>=500&&fitted<=500.001);
 assert.equal(normalize(500,500,500),500);
});
