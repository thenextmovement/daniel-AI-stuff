import test from 'node:test';
import assert from 'node:assert/strict';
import {frameRoom,ROOM_FRAMES,roomArea,moveWithinRoom} from '../deploy/configurator/room-framing.js';
import {createDraftWriteGuard} from '../deploy/configurator/entry-onboarding.js';
const sign=(widthMm,heightMm=widthMm*.172,y=250)=>({x:500-widthMm/9.6,y:y-heightMm/9.6,width:widthMm/4.8,height:heightMm/4.8});
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
test('photo limits, wall limits, vertical padding and fit zoom limit are respected',()=>{
 const viewport={width:390,height:200};
 const tooWide=frameRoom({room:'reception',viewport,sign:sign(3000)});assert.equal(tooWide.fits,false);
 const tooTall=frameRoom({room:'reception',viewport,sign:sign(500,2000)});assert.equal(tooTall.fits,false);
 const fitted=frameRoom({room:'reception',viewport,sign:sign(1500),camera:{x:500,y:275,zoom:4}});
 assert.ok(fitted.fits);assert.equal(fitted.zoom,fitted.maxZoom);
 assert.ok(fitted.view.x>=0&&fitted.view.y>=0&&fitted.view.x+fitted.view.width<=1000&&fitted.view.y+fitted.view.height<=500);
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

test('a broad sign uses a wider viewport shape before discarding a compatible room',()=>{
 const input={room:'studio',sign:sign(3000)};
 assert.equal(frameRoom({...input,viewport:{width:320,height:200}}).fits,false);
 assert.equal(frameRoom({...input,viewport:{width:320,height:160}}).fits,true);
});
