import test from 'node:test';
import assert from 'node:assert/strict';
import {inputViewport,inputScrollDelta,initMobileInput} from '../../deploy/3d-konfigurator/mobile-input.js';

// Event-driven harness: keyboard size/offset changes independently of the
// layout viewport, as on iOS; other cases resize both, as on Android.
function harness({visual=true,mobile=true}={}){
 const events=()=>({listeners:{},addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);},emit(name,event={}){for(const fn of this.listeners[name]||[])fn(event);}});
 const classes=new Set(),styles=new Map(),timers=new Map(),frames=new Map();let id=0,scroll=400,footerHeight=64;
 const classList={contains:name=>classes.has(name),add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),toggle(name,on){if(on)classes.add(name);else classes.delete(name);}};
 const doc={...events(),body:{classList},documentElement:{style:{setProperty:(k,v)=>styles.set(k,v),removeProperty:k=>styles.delete(k)}},activeElement:null};
 const done=events(),footer={getBoundingClientRect:()=>({height:footerHeight})},layout={...events(),matches:mobile};
 const viewport={...events(),height:844,offsetTop:0,scale:1};
 const win={...events(),innerHeight:844,innerWidth:390,visualViewport:visual?viewport:undefined,matchMedia:()=>layout,scrollBy:({top})=>{scroll+=top;},setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key),requestAnimationFrame(fn){frames.set(++id,fn);return id;},ResizeObserver:class{constructor(fn){this.fn=fn;}observe(){}}};
 doc.querySelector=selector=>selector==='.control-footer'?footer:done;
 const control={};
 const field=(y=1000)=>({disabled:false,readOnly:false,value:'PRADA',matches:()=>true,closest:selector=>selector==='.controls,#cart'?control:null,getClientRects:()=>[{}],getBoundingClientRect(){const top=y-scroll-(classes.has('editor-input-active')?200:0);return {top,bottom:top+82,height:82};},blur(){doc.activeElement=null;doc.emit('focusout');}});
 const flush=()=>{for(let count=0;frames.size&&count<10;count++){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());}assert.equal(frames.size,0,'Layout updates settle');};
 const app=initMobileInput({win,doc});
 return {app,doc,win,viewport,styles,classes,layout,field,done,flush,get scroll(){return scroll;},focus(element){doc.activeElement=element;doc.emit('focusin',{target:element});flush();},resize(height,offset=0,layoutHeight=844){viewport.height=height;viewport.offsetTop=offset;win.innerHeight=layoutHeight;viewport.emit('resize');win.emit('resize');flush();},timers(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());flush();},footerHeight(value){footerHeight=value;}};
}

test('Visual viewport inset accounts for iOS panning and Android layout resizing',()=>{
 assert.deepEqual(inputViewport(844,{height:420,offsetTop:64,scale:1}),{top:64,height:420,inset:360,zoomed:false});
 assert.deepEqual(inputViewport(420,{height:420,offsetTop:0,scale:1}),{top:0,height:420,inset:0,zoomed:false});
 assert.equal(inputViewport(420,{height:430,offsetTop:0,scale:1}).inset,0);
 assert.equal(inputViewport(844,{height:420,offsetTop:20,scale:2}).inset,0,'Pinch zoom is not keyboard occlusion');
 assert.equal(inputViewport(420).height,420,'Fallback uses the resized layout viewport');
});

test('Focused fields fit between visible top and the action bar without unnecessary scrolling',()=>{
 assert.equal(inputScrollDelta({top:100,bottom:182,height:82},40,300),0);
 assert.equal(inputScrollDelta({top:250,bottom:332,height:82},40,300),32);
 assert.equal(inputScrollDelta({top:20,bottom:102,height:82},40,300),-20);
 assert.equal(inputScrollDelta({top:100,bottom:250,height:150},40,140),60,'Oversized fields align at their top instead of oscillating');
});

for(const resizeLayout of [false,true])test(`Typing and delayed navigation with ${resizeLayout?'both viewports':'only the visual viewport'} resized`,()=>{
 const h=harness(),field=h.field();h.focus(field);assert.ok(h.classes.has('editor-input-active'));
 h.resize(420,resizeLayout?0:45,resizeLayout?420:844);
 assert.equal(h.styles.get('--input-inset'),resizeLayout?'0px':'379px');
 const rect=field.getBoundingClientRect(),top=resizeLayout?0:45;
 assert.ok(rect.top>=top+12&&rect.bottom<=top+420-64-12,'Field and actions have separate visible space');
 let prevented=false;
 h.doc.emit('pointerdown',{target:{closest:()=>({})},preventDefault(){prevented=true;}});
 assert.ok(prevented,'Action tap does not blur and move its own target before click');
 let navigated=false;h.app.finish(()=>{navigated=true;});
 assert.equal(navigated,false);assert.ok(h.classes.has('editor-input-active'),'Preview waits while keyboard closes');
 h.resize(844,0,844);assert.ok(navigated);assert.equal(h.classes.size,0);assert.equal(h.styles.size,0);
 assert.equal(field.value,'PRADA','Caret/value handling is left to the native field');
});

test('Switching inputs and choosing a RAL result does not restore the preview mid-edit',()=>{
 const h=harness(),first=h.field(),second=h.field(1200);h.focus(first);h.resize(420);
 first.blur();h.focus(second);h.timers();assert.ok(h.classes.has('editor-input-active'));
 // RAL buttons may briefly take focus, then return it to their combobox.
 second.blur();h.focus(second);h.timers();assert.ok(h.classes.has('editor-input-active'));
 const before=h.scroll;h.viewport.offsetTop=35;h.viewport.emit('scroll');h.flush();assert.equal(h.scroll,before,'User scrolling through RAL results is not pulled back to the field');
});

test('Native keyboard dismissal restores the preview; tapping the still-focused field re-enters input mode',()=>{
 const h=harness(),field=h.field();h.focus(field);h.resize(420);h.resize(844);
 assert.equal(h.classes.size,0);
 h.doc.emit('pointerdown',{target:field});h.flush();assert.ok(h.classes.has('editor-input-active'));
 h.done.emit('click');assert.equal(h.classes.size,0,'Explicit Done works without an on-screen keyboard');
});

test('Desktop and browsers without VisualViewport retain a usable fallback',()=>{
 const desktop=harness({mobile:false});desktop.focus(desktop.field());assert.equal(desktop.classes.size,0);
 const h=harness({visual:false}),field=h.field();h.focus(field);h.win.innerHeight=440;h.win.emit('resize');h.flush();
 assert.equal(h.styles.get('--input-inset'),'0px');assert.equal(h.styles.get('--input-height'),'440px');
 h.app.finish();h.timers();assert.equal(h.classes.size,0,'Missing final viewport events cannot leave input mode stuck');
});

test('Changing to a desktop width releases temporary keyboard UI without changing the draft',()=>{
 const h=harness(),field=h.field();h.focus(field);h.resize(420);h.layout.matches=false;h.layout.emit('change');h.flush();
 assert.equal(h.classes.size,0);assert.equal(field.value,'PRADA');
});
