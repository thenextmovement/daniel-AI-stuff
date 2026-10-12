import test from 'node:test';
import assert from 'node:assert/strict';
import {createRasterMask,flattenSvgPath} from '../deploy/configurator/deterministic-raster.js';
test('font counter remains empty with nonzero winding and curves stay bounded',()=>{
 const raster=createRasterMask(20,20);
 raster.fill(flattenSvgPath('M1 1L19 1L19 19L1 19ZM5 5L5 15L15 15L15 5Z'));
 assert.equal(raster.mask[2*20+2],1);assert.equal(raster.mask[10*20+10],0);
 const curved=flattenSvgPath('M0 0C0 20 20 20 20 0Q10 10 0 0Z');
 assert.ok(curved[0].points.length>10);assert.ok(curved[0].points.length<1000);
 assert.throws(()=>flattenSvgPath('M0 0H100Z'),/Unsupported outline/);
});
test('valid but pathological outline stops before unbounded scanline memory',()=>{
 const points=Array.from({length:2000},(_,i)=>[i%2?380:10,i%2?380:10]);
 assert.throws(()=>createRasterMask(392,392).fill([{points}]),/complexity exceeded/);
});
