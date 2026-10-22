import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {paintGlow} from '../../deploy/3d-konfigurator/renderer.js';

// Optional native Canvas dependency; NODE_PATH can point to the bundled runtime.
// Pixel assertions exercise the blur, including a context with no filter API.
let createCanvas;
try{({createCanvas}=createRequire(import.meta.url)('@napi-rs/canvas'));}catch{}
for(const front of [false,true])test(`${front?'Front':'Rear'} halo spreads outside the letters without Canvas filter`,{skip:!createCanvas},()=>{
 const source=createCanvas(256,256),mask=source.getContext('2d');
 mask.fillStyle='#fff';mask.fillRect(80,70,96,116);mask.clearRect(110,100,36,56);
 const output=createCanvas(256,256),context=output.getContext('2d');
 const withoutFilter=context=>new Proxy(context,{
  get(target,key){assert.notEqual(key,'filter','Must not require Safari-unsupported filters');const value=target[key];return typeof value==='function'?value.bind(target):value;},
  set(target,key,value){assert.notEqual(key,'filter','Must not require Safari-unsupported filters');target[key]=value;return true;}
 });
 const layers=[[13,.85],[5.2,.75],[1.56,.7]];
 const scratch=()=>{const canvas=createCanvas(1,1),getContext=canvas.getContext.bind(canvas);canvas.getContext=(...args)=>withoutFilter(getContext(...args));return canvas;};
 paintGlow(withoutFilter(context),{canvas:source,px:1},layers,front,scratch);
 const alpha=(x,y)=>context.getImageData(x,y,1,1).data[3];
 assert.ok(alpha(74,128)>15,'Visible light spills beyond the metal silhouette');
 assert.ok(alpha(67,128)>0,'Soft outer halo survives away from the edge');
 assert.ok(alpha(74,128)>alpha(67,128),'Halo fades naturally towards the wall');
 assert.ok(alpha(113,128)>0,'Letter counters receive light as well');
 assert.equal(alpha(0,0),0,'No displaced copy of the solid source');
 if(front)assert.equal(alpha(90,128),0,'Front face stays clear of white overexposure');
 else assert.ok(alpha(90,128)>180,'Rear illumination has a strong core behind the metal');
 assert.equal(context.globalAlpha,1);assert.equal(context.globalCompositeOperation,'source-over');assert.equal(context.shadowBlur,0);
});
