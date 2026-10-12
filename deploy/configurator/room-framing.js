// Coordinates refer to each existing photo rendered into its 1000 x 500 scene.
// Conservative free wall / standing rectangles guide dragging, not photo visibility.
export const ROOM_FRAMES={
 reception:{area:[325,80,675,297],near:340,y:250},
 office:{area:[300,65,690,310],near:450,y:210},
 event:{area:[260,80,700,305],near:500,y:210},
 podcast:{area:[350,65,645,295],near:430,y:210},
 dj:{area:[300,80,695,232],near:450,y:210},
 'outdoor-shop':{area:[100,120,910,278],near:460,y:200},
 summer:{area:[245,135,790,310],near:600,y:223},
 'outdoor-party':{area:[230,130,775,328],near:600,y:220},
 'outdoor-terrace':{area:[250,85,775,300],standing:[175,75,845,335],near:600,y:220},
 shop:{area:[355,110,645,330],near:650,y:235},
 restaurant:{area:[275,110,760,365],near:650,y:210},
 cafe:{area:[335,40,755,370],near:600,y:210},
 beauty:{area:[220,40,760,315],near:650,y:210},
 medical:{area:[285,45,735,350],near:650,y:210},
 physio:{area:[250,30,780,365],near:650,y:210},
 fitness:{area:[230,45,780,345],near:650,y:210},
 studio:{area:[60,65,955,355],near:540,y:250},
 tabletop:{area:[200,25,800,285],standing:[200,25,800,285],near:420,y:250}
};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
// Stock photos are presentation scenes. Small signs start at a readable size;
// larger physical dimensions grow gently, without changing the ordered geometry.
export function stockPresentationScale(widthMm,heightMm){
 if(!(widthMm>0&&heightMm>0))return 1/6;
 const displayWidth=clamp(250+100*Math.log2(widthMm/500),220,550);
 return Math.min(displayWidth/widthMm,230/heightMm);
}
export function roomArea(room,standing=false){const p=ROOM_FRAMES[room];return standing&&p.standing?p.standing:p.area;}
export function containsSign(area,sign){return sign.x>=area[0]-.01&&sign.y>=area[1]-.01&&sign.x+sign.width<=area[2]+.01&&sign.y+sign.height<=area[3]+.01;}
export function frameRoom({room,viewport,sign,camera,standing=false,padding}){
 const profile=ROOM_FRAMES[room],aspect=viewport.width/viewport.height;
 const widest=Math.min(1000,500*aspect);
 const base=camera||{zoom:clamp(widest/Math.max(650,profile.near),1,4),x:500,y:profile.y+20};
 const pad=padding||{left:18,right:viewport.width<=760?64:110,top:58,bottom:48};
 const required=Math.max(sign.width/(1-(pad.left+pad.right)/viewport.width),sign.height*aspect/(1-(pad.top+pad.bottom)/viewport.height));
 const maxZoom=clamp(widest/required,1,4),zoom=Math.min(base.zoom,maxZoom);
 const width=Math.max(widest/zoom,required),height=width/aspect;
 const sx=width/viewport.width,sy=height/viewport.height;
 // A stock scene is a visual example, not a measured installation boundary.
 // Keep the photo for signs outside its conservative free-wall rectangle.
 // At the widest view, reserve an outer gutter instead of dropping the photo.
 // The sign itself stays inside the photograph; only label padding may extend outside.
 const left=sign.x+sign.width+pad.right*sx-width,right=sign.x-pad.left*sx;
 const top=sign.y+sign.height+pad.bottom*sy-height,bottom=sign.y-pad.top*sy;
 const x=clamp(base.x-width/2,Math.min(0,1000-width),Math.max(0,1000-width));
 const y=clamp(base.y-height/2,Math.min(0,500-height),Math.max(0,500-height));
 const fits=containsSign([0,0,1000,500],sign)&&left<=right+.01&&top<=bottom+.01;
 return {fits,camera:{...base},zoom,maxZoom,view:{x:clamp(x,left,right),y:clamp(y,top,bottom),width,height}};
}
export function moveWithinRoom({area,box,offset,dx,dy,standing=false}){
 const x=box.width>area[2]-area[0]?offset.x:offset.x+clamp(dx,area[0]-box.x,area[2]-box.x-box.width);
 const y=standing?0:box.height>area[3]-area[1]?offset.y:offset.y+clamp(dy,area[1]-box.y,area[3]-box.y-box.height);
 return {x,y};
}
