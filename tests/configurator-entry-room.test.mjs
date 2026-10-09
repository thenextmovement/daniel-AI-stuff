import test from 'node:test';
import assert from 'node:assert/strict';
import {frameRoom,ROOM_FRAMES,roomArea,moveWithinRoom} from '../deploy/configurator/room-framing.js';
import {createDraftWriteGuard} from '../deploy/configurator/entry-onboarding.js';
const sign=(widthMm,heightMm=widthMm*.172,y=250)=>({x:500-widthMm/12,y:y-heightMm/12,width:widthMm/6,height:heightMm/6});
test('reception retains common photo camera from 50 to 75 cm and physical 1.5 ratio',()=>{
 for(const viewport of [{width:752,height:440},{width:390,height:200},{width:320,height:200}]){
  const a=frameRoom({room:'reception',viewport,sign:sign(500)}),b=frameRoom({room:'reception',viewport,sign:sign(750)});
  assert.ok(a.fits&&b.fits);assert.deepEqual(a.view,b.view);
  assert.equal(sign(750).width/sign(500).width,1.5);
  const again=frameRoom({room:'reception',viewport,sign:sign(500),camera:a.camera});assert.deepEqual(a,again);
  const closer=frameRoom({room:'reception',viewport,sign:sign(500),camera:{...a.camera,zoom:a.zoom+.2}});
  assert.ok(closer.view.width<a.view.width);assert.equal(closer.camera.y,a.camera.y);
 }
});
test('50 cm retains room context; broad signs pull back without a false wall-area fallback',()=>{
 for(const viewport of [{width:912,height:520},{width:390,height:200},{width:320,height:200}]){
  const initial=frameRoom({room:'reception',viewport,sign:sign(500)});
  assert.ok(initial.view.width>=650); // Both side walls and the reception counter remain recognizable.
  let previous=initial.view.width;
  for(const width of [2000,3000,4000]){
   const box=sign(width),frame=frameRoom({room:'reception',viewport,sign:box});
   assert.equal(frame.fits,true,`${viewport.width}px / ${width}mm`);
   assert.ok(frame.view.width>=previous);previous=frame.view.width;
   const sx=frame.view.width/viewport.width,sy=frame.view.height/viewport.height;
   assert.ok(box.x-frame.view.x>=18*sx-.01);
   assert.ok(frame.view.x+frame.view.width-box.x-box.width>=(viewport.width<=760?64:110)*sx-.01);
   assert.ok(box.y-frame.view.y>=58*sy-.01);
   assert.ok(frame.view.y+frame.view.height-box.y-box.height>=48*sy-.01);
   // Wider signs never reduce the amount of photo width visible at the initial framing.
   assert.ok(Math.min(1000,frame.view.x+frame.view.width)-Math.max(0,frame.view.x)>=Math.min(650,frame.view.width)-.01);
  }
 }
});
test('large signs retain their photo; detached positions, manual zoom and input remain stable',()=>{
 const viewport={width:390,height:200};
 assert.equal(frameRoom({room:'reception',viewport,sign:sign(500,4000)}).fits,false);
 assert.equal(frameRoom({room:'reception',viewport,sign:{...sign(500),x:1100}}).fits,false);
 const fitted=frameRoom({room:'reception',viewport,sign:sign(1500),camera:{x:500,y:275,zoom:4}});
 assert.ok(fitted.fits);assert.equal(fitted.zoom,fitted.maxZoom);
 const input={room:'reception',viewport,sign:sign(500),camera:{x:400,y:230,zoom:2}};const before=JSON.stringify(input);frameRoom(input);assert.equal(JSON.stringify(input),before);
});
test('all inspected room profiles define finite in-photo surfaces and shared move bounds',()=>{
 assert.equal(Object.keys(ROOM_FRAMES).length,18);
 for(const id of Object.keys(ROOM_FRAMES))for(const standing of [false,true]){
  const area=roomArea(id,standing);assert.ok(area[0]>=0&&area[1]>=0&&area[2]<=1000&&area[3]<=500);
  const box={x:450,y:200,width:100,height:20},offset={x:0,y:0};
  const moved=moveWithinRoom({area,box,offset,dx:10000,dy:-10000,standing});
  assert.ok(box.x+moved.x+box.width<=area[2]+.01);if(standing)assert.equal(moved.y,0);else assert.ok(box.y+moved.y>=area[1]);
 }
});
test('failed restoration prevents every write until a conscious replacement',()=>{
 const guard=createDraftWriteGuard();let writes=0,last='original';const save=v=>{writes++;last=v;};
 guard.block();for(const event of ['render','resize','tab','pagehide','visibilitychange'])assert.equal(guard.write(save,event),false);
 assert.equal(writes,0);assert.equal(last,'original');guard.release();assert.equal(guard.write(save,'replacement'),true);assert.equal(writes,1);assert.equal(last,'replacement');
});

test('a broad sign keeps the photograph at both normal and wide viewport shapes',()=>{
 const input={room:'studio',sign:sign(3000)};
 assert.equal(frameRoom({...input,viewport:{width:320,height:200}}).fits,true);
 assert.equal(frameRoom({...input,viewport:{width:320,height:160}}).fits,true);
});

test('all stock scenes keep 2 to 4 m signs at the same fixed example scale',()=>{
 for(const room of Object.keys(ROOM_FRAMES))for(const viewport of [{width:912,height:520},{width:390,height:200},{width:320,height:200}])for(const widthMm of [2000,3000,4000]){
  const span=6000;
  const width=widthMm*1000/span,height=width*.22,box={x:500-width/2,y:220-height/2,width,height};
  assert.equal(frameRoom({room,viewport,sign:box}).fits,true,`${room} / ${viewport.width}px / ${widthMm}mm`);
 }
});
