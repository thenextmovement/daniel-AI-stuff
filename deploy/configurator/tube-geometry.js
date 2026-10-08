/** Local preview routing. A centerline plus a physical diameter, never a filled font outline.
 * Raster thinning follows the Zhang–Suen neighbourhood rules; graph tracing below is local.
 * Derived routes are not a manufacturing approval or a bending/cutting program. */
export const TUBE_MM=8;

export function thinMask(input,width,height){
  if(width<3||height<3||input.length!==width*height)throw new Error('Invalid raster dimensions.');
  const mask=Uint8Array.from(input,v=>v?1:0);
  let changed=true;
  while(changed){
    changed=false;
    for(let pass=0;pass<2;pass++){
      const remove=[];
      for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
        const i=y*width+x;if(!mask[i])continue;
        const p=[mask[i-width],mask[i-width+1],mask[i+1],mask[i+width+1],mask[i+width],mask[i+width-1],mask[i-1],mask[i-width-1]];
        const count=p.reduce((a,b)=>a+b,0);if(count<2||count>6)continue;
        let transitions=0;for(let k=0;k<8;k++)if(!p[k]&&p[(k+1)%8])transitions++;
        if(transitions!==1)continue;
        if(pass===0?(p[0]*p[2]*p[4]||p[2]*p[4]*p[6]):(p[0]*p[2]*p[6]||p[0]*p[4]*p[6]))continue;
        remove.push(i);
      }
      for(const i of remove)mask[i]=0;
      if(remove.length)changed=true;
    }
  }
  return mask;
}

/** Distance to the silhouette boundary, used only to remove raster medial-axis spurs.
 * This is a font conversion tolerance, not a minimum manufacturing feature size. */
export function boundaryDistances(mask,width,height){
  const d=Float32Array.from(mask,v=>v?width+height:0),diag=Math.SQRT2;
  for(let y=1;y<height;y++)for(let x=1;x<width;x++){
    const i=y*width+x;if(d[i])d[i]=Math.min(d[i],d[i-1]+1,d[i-width]+1,d[i-width-1]+diag,x<width-1?d[i-width+1]+diag:Infinity);
  }
  for(let y=height-2;y>=0;y--)for(let x=width-2;x>=0;x--){
    const i=y*width+x;if(d[i])d[i]=Math.min(d[i],d[i+1]+1,d[i+width]+1,d[i+width+1]+diag,x?d[i+width-1]+diag:Infinity);
  }
  return d;
}

/** Thinning can leave several graph nodes around one filled stroke junction.
 * Collapse only short junction-to-junction edges within the local ink width,
 * before smoothing and physical scaling. Free terminals, isolated dots and
 * counters extending beyond the junction are not candidates. */
export function collapseRasterJunctions(traced,distances,width){
  const key=p=>p.join(':'),nodes=new Map();
  for(const route of traced.paths)if(route.points.length>1)for(const point of [route.points[0],route.points.at(-1)]){
    const id=key(point);if(!nodes.has(id))nodes.set(id,{id,point,degree:0,radius:distances[Math.floor(point[1])*width+Math.floor(point[0])]||1});
    nodes.get(id).degree++;
  }
  const groups=new Map([...nodes].filter(([,n])=>n.degree>2).map(([id,n])=>[id,[n]]));
  for(const route of [...traced.paths].sort((a,b)=>routeLength(a)-routeLength(b))){
    if(route.closed||route.points.length<2)continue;
    const a=groups.get(key(route.points[0])),b=groups.get(key(route.points.at(-1)));
    if(!a||!b||a===b)continue;
    const merged=[...a,...b],radius=Math.max(...merged.map(n=>n.radius));
    if(routeLength(route)>radius*2.5)continue;
    if(merged.some(n=>merged.some(other=>Math.hypot(n.point[0]-other.point[0],n.point[1]-other.point[1])>radius*2)))continue;
    for(const node of merged)groups.set(node.id,merged);
  }
  const centers=new Map();
  for(const group of new Set(groups.values())){
    if(group.length<2)continue;
    const weight=group.reduce((n,node)=>n+node.radius**2,0);
    const point=[0,1].map(axis=>group.reduce((n,node)=>n+node.point[axis]*node.radius**2,0)/weight);
    for(const node of group)centers.set(node.id,{point,radius:Math.max(...group.map(n=>n.radius))});
  }
  const paths=[];
  for(const route of traced.paths){
    if(route.points.length<2){paths.push(route);continue;}
    const a=centers.get(key(route.points[0])),b=centers.get(key(route.points.at(-1)));
    if(a&&b&&a.point===b.point&&routeLength(route)<=a.radius*2.5)continue;
    let points=route.points.map(p=>[...p]);
    const trimJunction=(points,node)=>{
      if(!node)return points;
      let end=0;
      while(end<points.length-2&&Math.hypot(points[end+1][0]-node.point[0],points[end+1][1]-node.point[1])<=node.radius)end++;
      return [[...node.point],...points.slice(end+1)];
    };
    points=trimJunction(points,a);points=trimJunction(points.reverse(),b).reverse();
    paths.push({...route,points});
  }
  const degree=new Map();for(const route of paths)if(route.points.length>1)for(const point of [route.points[0],route.points.at(-1)]){
    const id=key(point);degree.set(id,{point,count:(degree.get(id)?.count||0)+1});
  }
  return {paths,junctions:[...degree.values()].filter(n=>n.count>2).map(n=>n.point)};
}

export function pruneRasterSpurs(traced,distances,width){
  const key=p=>p.join(':'),degree=new Map();
  for(const p of traced.paths)if(p.points.length>1)for(const end of [p.points[0],p.points.at(-1)])degree.set(key(end),(degree.get(key(end))||0)+1);
  const paths=traced.paths.filter(route=>{
    if(route.closed||route.points.length<2)return true;
    const a=route.points[0],b=route.points.at(-1),da=degree.get(key(a)),db=degree.get(key(b));
    if(!((da===1&&db>2)||(db===1&&da>2)))return true;
    const join=da>2?a:b,radius=distances[Math.floor(join[1])*width+Math.floor(join[0])];
    let length=0;for(let i=1;i<route.points.length;i++)length+=Math.hypot(route.points[i][0]-route.points[i-1][0],route.points[i][1]-route.points[i-1][1]);
    return length>radius*1.8;
  });
  const keptDegree=new Map();for(const p of paths)if(p.points.length>1)for(const end of [p.points[0],p.points.at(-1)])keptDegree.set(key(end),(keptDegree.get(key(end))||0)+1);
  return {paths,junctions:traced.junctions.filter(p=>keptDegree.get(key(p))>2)};
}

/** Trace every skeleton edge, preserving loops, junctions and isolated dots. */
export function traceMask(mask,width,height){
  const neighbours=new Map(),point=i=>[i%width+.5,Math.floor(i/width)+.5];
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x;if(!mask[i])continue;
    const adjacent=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const j=i+dy*width+dx;if(!mask[j])continue;
      // No diagonal shortcut when the same corner is already connected orthogonally.
      if(dx&&dy&&(mask[i+dx]||mask[i+dy*width]))continue;
      adjacent.push(j);
    }
    neighbours.set(i,adjacent);
  }
  const visited=new Set(),paths=[];
  const edge=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
  const walk=(start,next)=>{
    const points=[point(start)];let prev=start,current=next,closed=false;
    visited.add(edge(prev,current));
    for(;;){
      points.push(point(current));
      if(current===start){closed=true;break;}
      const adjacent=neighbours.get(current)||[];
      if(adjacent.length!==2)break;
      const following=adjacent.find(n=>n!==prev);
      if(visited.has(edge(current,following)))break;
      visited.add(edge(current,following));prev=current;current=following;
    }
    paths.push({points,closed});
  };
  for(const [i,adjacent] of neighbours){
    if(!adjacent.length)paths.push({points:[point(i)],closed:false});
    if(adjacent.length===2)continue;
    for(const next of adjacent)if(!visited.has(edge(i,next)))walk(i,next);
  }
  for(const [i,adjacent] of neighbours)for(const next of adjacent)if(!visited.has(edge(i,next)))walk(i,next);
  return {paths,junctions:[...neighbours].filter(([,n])=>n.length>2).map(([i])=>point(i))};
}

/** Moving averages remove pixel stair steps without moving open endpoints or junctions. */
export function smoothRoute(route,passes=3,junctions=[]){
  let points=route.points.map(p=>[...p]);
  if(points.length<4)return {...route,points};
  if(route.closed)points.pop();
  const pinned=new Set(points.flatMap((p,i)=>junctions.some(q=>p[0]===q[0]&&p[1]===q[1])?[i]:[]));
  for(let pass=0;pass<passes;pass++)points=points.map((p,i)=>{
    if(pinned.has(i)||(!route.closed&&(i===0||i===points.length-1)))return p;
    const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length];
    return [(a[0]+2*p[0]+b[0])/4,(a[1]+2*p[1]+b[1])/4];
  });
  // Drop nearly straight intermediate points (max. 0.15 raster pixels deviation).
  const simplified=[points[0]];
  for(let i=1;i<points.length-1;i++){
    const a=simplified.at(-1),b=points[i],c=points[i+1];
    const d=Math.abs((c[0]-a[0])*(a[1]-b[1])-(a[0]-b[0])*(c[1]-a[1]))/(Math.hypot(c[0]-a[0],c[1]-a[1])||1);
    if(pinned.has(i)||d>.15||Math.hypot(c[0]-a[0],c[1]-a[1])>8)simplified.push(b);
  }
  simplified.push(points.at(-1));if(route.closed)simplified.push([...simplified[0]]);
  return {...route,points:simplified};
}

const boundsOf=points=>{
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const [x,y] of points){if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Ungültiger Neonpfad.');minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  return {minX,minY,maxX,maxY};
};

/** The requested outer tube measure includes the round 4-mm endcaps on both sides. */
export function physicalTubeLayout(source,routes,{axis='width',valueMm=1000,marginMm=15}={}){
  if(!['width','height'].includes(axis)||!Number.isFinite(valueMm)||valueMm<=TUBE_MM)throw new Error('Das gewählte Maß muss größer als die 8-mm-Neonlinie sein.');
  if(routes.length!==source.glyphs.length||routes.some(r=>!r.paths.length))throw new Error('Für diese Schrift konnte kein vollständiger Neonpfad erzeugt werden.');
  const all=routes.flatMap(r=>r.paths.flatMap(p=>p.points)),box=boundsOf(all);
  const span=axis==='width'?box.maxX-box.minX:box.maxY-box.minY;
  if(!(span>0))throw new Error('Dieses Zeichen kann nicht auf das gewählte Maß skaliert werden.');
  const factor=(valueMm-TUBE_MM)/span,half=TUBE_MM/2;
  const convert=([x,y])=>[(x-box.minX)*factor+half,(y-box.minY)*factor+half];
  const glyphs=source.glyphs.map((glyph,index)=>{
    const paths=routes[index].paths.map(p=>({...p,points:p.points.map(convert)}));
    const b=boundsOf(paths.flatMap(p=>p.points));
    const centerlineD=paths.map(p=>{
      const points=p.points.length===1?[p.points[0],p.points[0]]:p.points;
      return 'M'+points.map(([x,y])=>`${x.toFixed(3)} ${y.toFixed(3)}`).join('L')+(p.closed?'Z':'');
    }).join('');
    return {...glyph,x:0,y:0,centerlineD,paths,junctions:routes[index].junctions.map(convert),bounds:{minX:b.minX-half,minY:b.minY-half,maxX:b.maxX+half,maxY:b.maxY+half}};
  });
  const widthMm=(box.maxX-box.minX)*factor+TUBE_MM,heightMm=(box.maxY-box.minY)*factor+TUBE_MM;
  const design={widthMm,heightMm},backing={widthMm:widthMm+marginMm*2,heightMm:heightMm+marginMm*2};
  const rounded=b=>Object.fromEntries(Object.entries(b).map(([k,v])=>[k,Math.round(v)]));
  return {
    layout:{...source,glyphs,bounds:{x:0,y:0,width:widthMm,height:heightMm},unitsPerEm:source.unitsPerEm*factor,baselineStep:source.baselineStep*factor,tubeMm:TUBE_MM,measurement:'centerline-with-8mm-tube'},
    size:{scale:1,marginMm,axis,design:rounded(design),backing:rounded(backing),exact:{design,backing}},
  };
}

/** Measured route facts. Unconfirmed material limits must never become a manufacturing approval. */
export function inspectTubeLayout(layout){
  let lengthMm=0,routeCount=0,isolatedDots=0,junctionCount=0;
  for(const glyph of layout.glyphs){
    junctionCount+=glyph.junctions.length;
    for(const route of glyph.paths){routeCount++;if(route.points.length===1)isolatedDots++;
      for(let i=1;i<route.points.length;i++)lengthMm+=Math.hypot(route.points[i][0]-route.points[i-1][0],route.points[i][1]-route.points[i-1][1]);
    }
  }
  const overlap=inspectTubeClearance(layout);
  return {tubeMm:TUBE_MM,lengthMm,routeCount,isolatedDots,junctionCount,...overlap,status:'review-required',unconfirmedRules:['minBendRadiusMm','cutPitchMm','minDetailGapMm','acrylicThicknessMm','minBridgeWidthMm'],source:'derived-font-centerlines'};
}

export function segmentDistance(a,b,c,d){
  const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const u=cross(a,b,c),v=cross(a,b,d),s=cross(c,d,a),t=cross(c,d,b);
  if(((u>0&&v<0)||(u<0&&v>0))&&((s>0&&t<0)||(s<0&&t>0)))return 0;
  const pointSegment=(p,x,y)=>{
    const dx=y[0]-x[0],dy=y[1]-x[1],l=dx*dx+dy*dy;
    const fraction=l?Math.max(0,Math.min(1,((p[0]-x[0])*dx+(p[1]-x[1])*dy)/l)):0;
    return Math.hypot(p[0]-x[0]-fraction*dx,p[1]-x[1]-fraction*dy);
  };
  return Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));
}

/** Hard geometric interference: non-neighbouring tube sections closer than 8 mm.
 * Junctions and connections require routing review even if intentional in the font.
 * A spatial index bounds the work; the count is capped because one issue is sufficient. */
export function inspectTubeClearance(layout){
  const cells=new Map(),segments=[];let overlaps=0,routeId=0,tightLoops=0;
  for(const glyph of layout.glyphs)for(const route of glyph.paths){
    const points=route.points.length===1?[route.points[0],route.points[0]]:route.points;
    const b=boundsOf(points);
    if(route.closed&&Math.min(b.maxX-b.minX,b.maxY-b.minY)<TUBE_MM)tightLoops++;
    let arc=0,total=0;for(let i=1;i<points.length;i++)total+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      const current={a,b,routeId,from:arc,to:arc+length,total,closed:route.closed};arc+=length;
      const keys=[];
      for(let x=Math.floor((Math.min(a[0],b[0])-TUBE_MM)/TUBE_MM);x<=Math.floor((Math.max(a[0],b[0])+TUBE_MM)/TUBE_MM);x++)
        for(let y=Math.floor((Math.min(a[1],b[1])-TUBE_MM)/TUBE_MM);y<=Math.floor((Math.max(a[1],b[1])+TUBE_MM)/TUBE_MM);y++)keys.push(`${x}:${y}`);
      const seen=new Set();
      for(const key of keys)for(const id of cells.get(key)||[]){
        if(seen.has(id))continue;seen.add(id);const other=segments[id];
        if(other.routeId===routeId){
          let gap=current.from-other.to;
          if(route.closed)gap=Math.min(gap,total-current.to+other.from);
          if(gap<TUBE_MM*2)continue;
        }
        if(segmentDistance(a,b,other.a,other.b)<TUBE_MM-.05&&++overlaps>=20)return {tubeInterferences:overlaps,tightLoops,interferenceCountCapped:true};
      }
      const id=segments.length;segments.push(current);
      for(const key of keys){if(!cells.has(key))cells.set(key,[]);cells.get(key).push(id);}
    }
    routeId++;
  }
  return {tubeInterferences:overlaps,tightLoops,interferenceCountCapped:false};
}

const routeLength=route=>route.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-route.points[i][0],p[1]-route.points[i][1]),0);
const pointKey=p=>p.map(v=>v.toFixed(4)).join(':');

/** Rejoin graph fragments after spur removal. At T/Y nodes choose the straightest
 * continuation. Remaining branches retain their original endpoints for a seamless
 * preview; physical intersections are reported separately for routing review. */
export function joinTubeRoutes(input){
  const paths=input.map(p=>({...p,points:p.points.map(p=>[...p])}));
  for(;;){
    const nodes=new Map();
    paths.forEach((route,id)=>{
      if(route.closed||route.points.length<2)return;
      for(const end of [0,1]){
        const ordered=end?[...route.points].reverse():route.points,key=pointKey(ordered[0]);
        let next=ordered[1];for(const p of ordered.slice(1)){next=p;if(Math.hypot(p[0]-ordered[0][0],p[1]-ordered[0][1])>=8)break;}
        const dx=next[0]-ordered[0][0],dy=next[1]-ordered[0][1],length=Math.hypot(dx,dy)||1;
        if(!nodes.has(key))nodes.set(key,[]);nodes.get(key).push({id,end,v:[dx/length,dy/length]});
      }
    });
    let pair=null,best=Infinity;
    for(const ends of nodes.values())for(let i=0;i<ends.length;i++)for(let j=i+1;j<ends.length;j++){
      const a=ends[i],b=ends[j];if(a.id===b.id)continue;
      const dot=a.v[0]*b.v[0]+a.v[1]*b.v[1];
      if((ends.length===2||dot<-.5)&&dot<best){best=dot;pair=[a,b];}
    }
    if(!pair)break;
    const [a,b]=pair,ap=paths[a.id].points,bp=paths[b.id].points;
    const joined=[...(a.end?ap:[...ap].reverse()),...(b.end?[...bp].reverse():bp).slice(1)];
    paths[a.id]={...paths[a.id],points:joined,closed:pointKey(joined[0])===pointKey(joined.at(-1))};
    paths.splice(b.id,1);
  }
  return paths;
}

function sampleRoute(route,step=1){
  if(routeLength(route)/step>80000)throw new Error('Dieser Entwurf enthält zu viele Neonsegmente. Bitte kürzen Sie den Text.');
  const points=[route.points[0]];let remaining=step;
  for(let i=1;i<route.points.length;i++){
    let a=route.points[i-1],b=route.points[i],distance=Math.hypot(b[0]-a[0],b[1]-a[1]);
    while(distance>=remaining&&distance>1e-8){
      const p=a.map((v,axis)=>v+(b[axis]-v)*remaining/distance);points.push(p);a=p;distance-=remaining;remaining=step;
    }
    remaining-=distance;
  }
  if(pointKey(points.at(-1))!==pointKey(route.points.at(-1)))points.push(route.points.at(-1));
  return {...route,points};
}

/** Arc-length smoothing uses mm rather than font pixels, so a 50-cm design does
 * not inherit the same sharp artifacts as a 200-cm design. Ends remain fixed. */
export function softenTubeRoute(route,reachMm=8){
  if(route.points.length<3)return route;
  let points=sampleRoute(route).points;if(points.length<4)return route;if(route.closed)points.pop();
  const radius=Math.min(Math.round(reachMm),Math.floor(points.length/4));
  if(radius<2)return {...route,points:route.closed?[...points,points[0]]:points};
  const smoothed=points.map((p,i)=>{
    if(!route.closed&&(i===0||i===points.length-1))return p;
    const reach=route.closed?radius:Math.min(radius,i,points.length-1-i);
    let x=0,y=0,weight=0;
    for(let d=-reach;d<=reach;d++){
      const q=points[(i+d+points.length)%points.length],w=reach+1-Math.abs(d);x+=q[0]*w;y+=q[1]*w;weight+=w;
    }
    return [x/weight,y/weight];
  });
  if(route.closed)smoothed.push(smoothed[0]);
  return {...route,points:smoothed};
}

/** Collapse raster junction islands and discard attached retracing shards.
 * Only short fragments already covered by a longer stroke are redundant.
 * Original isolated dots and genuine short T-bars are retained. */
export function cleanTubeJunctions(input){
  let removedFragments=0,mergedNodes=0;
  const paths=input.map(p=>({...p,points:p.points.map(q=>[...q])}));
  const lengths=paths.map(routeLength);
  const retained=paths.filter((route,id)=>{
    const box=boundsOf(route.points),tinyLoop=route.closed&&Math.max(box.maxX-box.minX,box.maxY-box.minY)<1;
    if(route.points.length===1&&!route.rasterArtifact)return true;
    if(!tinyLoop&&(route.closed||lengths[id]>TUBE_MM*3))return true;
    const attached=paths.some((other,j)=>j!==id&&!other.closed&&other.points.length>1&&[route.points[0],route.points.at(-1)].some(end=>other.points.slice(1).some((p,k)=>segmentDistance(end,end,other.points[k],p)<=1)));
    if(!attached)return true;
    const samples=sampleRoute(route,1).points;
    const redundant=paths.some((other,j)=>{
      if(j===id||lengths[j]<Math.max(TUBE_MM*4,lengths[id]*3))return false;
      return samples.every(point=>other.points.slice(1).some((p,k)=>segmentDistance(point,point,other.points[k],p)<TUBE_MM));
    });
    if(redundant){removedFragments++;return false;}return true;
  });
  // A pixel-sized loop at the end of a discarded spur is part of that spur,
  // not a detached dot/diacritic from the original font.
  const discarded=paths.filter(p=>!retained.includes(p));
  for(let i=retained.length-1;i>=0;i--){const route=retained[i],box=boundsOf(route.points);
    if(!route.closed||Math.max(box.maxX-box.minX,box.maxY-box.minY)>=1)continue;
    if(discarded.some(other=>!other.closed&&[other.points[0],other.points.at(-1)].some(p=>segmentDistance(p,p,route.points[0],route.points[0])<=1))){retained.splice(i,1);removedFragments++;}
  }
  // Adjacent skeleton pixels can create several vertices for one physical node.
  const ends=[];retained.forEach((r,id)=>{if(r.points.length<2)return;for(const index of [0,r.points.length-1])ends.push({id,index,point:r.points[index]});});
  const groups=[];
  for(const end of ends){let group=groups.find(g=>g.some(e=>Math.hypot(e.point[0]-end.point[0],e.point[1]-end.point[1])<=2));if(!group){group=[];groups.push(group);}group.push(end);}
  for(const group of groups){if(group.length<2)continue;const point=[0,1].map(axis=>group.reduce((sum,e)=>sum+e.point[axis],0)/group.length);if(group.some(e=>pointKey(e.point)!==pointKey(point)))mergedNodes++;for(const end of group)retained[end.id].points[end.index]=point;}
  for(const route of retained)if(route.points.length>2&&pointKey(route.points[0])===pointKey(route.points.at(-1)))route.closed=true;
  return {paths:retained,removedFragments,mergedNodes};
}

/** Shorten only a free decorative end that collides with a shorter neighbouring
 * stroke in the same word. Never remove a middle section or alter a closed
 * counter. The remaining route stays continuous; real T joints stay intact. */
export function trimOverlappingTerminals(glyphs,source){
  const clearance=TUBE_MM+1,cell=16,cells=new Map(),entries=[];
  glyphs.forEach((glyph,glyphIndex)=>glyph.paths.forEach((route,routeIndex)=>{
    const length=routeLength(route),entry={route,glyphIndex,routeIndex,length,word:source.glyphs[glyphIndex].wordIndex,line:source.glyphs[glyphIndex].lineIndex};entries.push(entry);
    for(let i=1;i<route.points.length;i++){
      const a=route.points[i-1],b=route.points[i],segment={a,b,entry};
      for(let x=Math.floor((Math.min(a[0],b[0])-clearance)/cell);x<=Math.floor((Math.max(a[0],b[0])+clearance)/cell);x++)for(let y=Math.floor((Math.min(a[1],b[1])-clearance)/cell);y<=Math.floor((Math.max(a[1],b[1])+clearance)/cell);y++){
        const key=x+':'+y;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(segment);
      }
    }
  }));
  let trimmedTerminals=0;
  for(const entry of entries){
    const {route,glyphIndex,length}=entry;if(route.closed||length<TUBE_MM*8)continue;
    const points=sampleRoute(route).points,limit=Math.min(Math.floor(points.length*.22),TUBE_MM*24);
    let start=0,end=points.length-1;
    for(const reverse of [false,true]){
      const terminal=reverse?points.at(-1):points[0];
      const attached=glyphs[glyphIndex].paths.some(other=>other!==route&&other.points.slice(1).some((p,i)=>segmentDistance(terminal,terminal,other.points[i],p)<2));
      if(attached)continue;
      let last=-1;
      for(let i=0;i<=limit;i++){
        const point=points[reverse?points.length-1-i:i];
        const collision=(cells.get(Math.floor(point[0]/cell)+':'+Math.floor(point[1]/cell))||[]).some(({a,b,entry:other})=>other.glyphIndex!==glyphIndex&&other.line===entry.line&&other.word===entry.word&&other.length<length*.9&&segmentDistance(point,point,a,b)<clearance);
        if(collision)last=i;
      }
      if(last<0||last>=limit)continue;
      if(reverse)end=points.length-2-last;else start=last+1;
      trimmedTerminals++;
    }
    if(start||end<points.length-1)route.points=points.slice(start,end+1);
  }
  return trimmedTerminals;
}

const nearestRoutePoint=(point,route)=>{
  let distance=Infinity,nearest=null,segmentIndex=-1;
  for(let index=0;index<route.points.length-1;index++){
    const a=route.points[index],b=route.points[index+1],dx=b[0]-a[0],dy=b[1]-a[1];
    const t=dx||dy?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy))):0;
    const candidate=[a[0]+dx*t,a[1]+dy*t],gap=Math.hypot(point[0]-candidate[0],point[1]-candidate[1]);
    if(gap<distance){distance=gap;nearest=candidate;segmentIndex=index;}
  }
  return {distance,point:nearest,segmentIndex};
};
const insertRoutePoint=(route,nearest)=>{
  if(nearest.segmentIndex<0)return;
  const a=route.points[nearest.segmentIndex],b=route.points[nearest.segmentIndex+1];
  if(Math.hypot(a[0]-nearest.point[0],a[1]-nearest.point[1])<1e-5)return a;
  if(Math.hypot(b[0]-nearest.point[0],b[1]-nearest.point[1])<1e-5)return b;
  route.points.splice(nearest.segmentIndex+1,0,nearest.point);
  return nearest.point;
};
const routesTouchWithin=(a,b,limit)=>a.points.slice(1).some((point,index)=>b.points.slice(1).some((other,j)=>segmentDistance(a.points[index],point,b.points[j],other)<=limit));
const addJunction=(glyph,point)=>{
  if(!glyph.junctions.some(other=>Math.hypot(other[0]-point[0],other[1]-point[1])<.05))glyph.junctions.push([...point]);
};

/** A script outline can overlap the next letter although separately thinned
 * glyphs leave two open centerlines. Join only nearby strokes in the same word.
 * The bridge belongs to the preceding character so color targets stay intact. */
export function connectScriptGlyphs(glyphs,outlineGlyphs){
  let connectedGlyphs=0,removedRedundantStrokes=0,snappedJunctions=0;
  // Raster artifacts have already been classified in source pixels. Never
  // delete strokes or snap unrelated parts merely because the sign is small.
  for(let index=0;index<glyphs.length-1;index++){
    const current=outlineGlyphs[index],next=outlineGlyphs[index+1];
    if(!current?.bounds||!next?.bounds||current.lineIndex!==next.lineIndex||current.wordIndex!==next.wordIndex)continue;
    if(next.bounds.minX<current.bounds.minX||current.bounds.maxX<=next.bounds.minX)continue;
    const left=glyphs[index],right=glyphs[index+1];
    const leftBox=boundsOf(left.paths.flatMap(path=>path.points)),rightBox=boundsOf(right.paths.flatMap(path=>path.points));
    // Relative limits keep connection decisions independent of the chosen cm.
    const span=Math.min(leftBox.maxX-leftBox.minX,rightBox.maxX-rightBox.minX);
    const maxGap=span*.2;
    const leftLength=Math.max(...left.paths.map(routeLength)),rightLength=Math.max(...right.paths.map(routeLength));
    let best={distance:Infinity};
    for(const route of left.paths){
      if(route.closed||route.points.length<2||routeLength(route)<leftLength*.1)continue;
      for(const end of [0,route.points.length-1]){
        const from=route.points[end];
        if(from[0]<leftBox.maxX-(leftBox.maxX-leftBox.minX)*.35)continue;
        for(const target of right.paths){
          if(target.points.length<2||routeLength(target)<rightLength*.1)continue;
          const candidate=nearestRoutePoint(from,target);
          if(candidate.point[0]<from[0]-span*.2||candidate.distance>=best.distance)continue;
          best={...candidate,route,end,target};
        }
      }
    }
    if(best.distance>maxGap)continue;
    const join=insertRoutePoint(best.target,best);
    if(best.distance<=span*1e-9)best.route.points[best.end]=join;
    else if(best.end===0)best.route.points.unshift(join);
    else best.route.points.push(join);
    addJunction(right,join);
    connectedGlyphs++;
  }
  return {connectedGlyphs,removedRedundantStrokes,snappedJunctions};
}

/** Preserve the source centerlines at every physical size. Raster cleanup and
 * smoothing happen before scaling, with original junctions pinned. Manufacturing
 * collisions and bend limits belong to inspection, not destructive letter edits. */
export function refineTubeRoutes(layout,{connectScript=false,outlineGlyphs=[]}={}){
  if(layout.glyphs.reduce((n,g)=>n+g.paths.reduce((sum,p)=>sum+routeLength(p),0),0)>70000)throw new Error('Dieser Entwurf enthält zu viele Neonsegmente. Bitte kürzen Sie den Text.');
  const glyphRoutes=layout.glyphs.map(glyph=>({
    paths:glyph.paths.map(path=>({...path,points:path.points.map(point=>[...point])})),
    junctions:(glyph.junctions||[]).map(point=>[...point]),
  }));
  const scriptAdaptation=connectScript?connectScriptGlyphs(glyphRoutes,outlineGlyphs):{connectedGlyphs:0,removedRedundantStrokes:0,snappedJunctions:0};
  return {routes:glyphRoutes,adaptation:{removedLoops:0,removedFragments:0,mergedNodes:0,trimmedTerminals:0,...scriptAdaptation,separatedRoutes:0,source:'source-preserving-tube-routing',manufacturingApproved:false}};
}

/** Circular fillets for actual font corners. Long legs can use the estimated
 * 15-mm bend radius; short legs limit the fillet and remain subject to review. */
export function roundTubeCorners(route,radiusMm=15){
  if(route.points.length<3)return route;
  const simplify=points=>{
    const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
    while(stack.length){const [a,b]=stack.pop();let far=-1,distance=.7;
      for(let i=a+1;i<b;i++){const d=segmentDistance(points[i],points[i],points[a],points[b]);if(d>distance){distance=d;far=i;}}
      if(far>=0){keep.add(far);stack.push([a,far],[far,b]);}
    }
    return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
  };
  let points;
  if(route.closed){const half=Math.floor((route.points.length-1)/2);points=[...simplify(route.points.slice(0,half+1)).slice(0,-1),...simplify(route.points.slice(half)).slice(0,-1)];}
  else points=simplify(route.points);
  if(points.length<3)return {...route,points:route.closed?[...points,points[0]]:points};
  const output=[];
  points.forEach((b,i)=>{
    if(!route.closed&&(i===0||i===points.length-1)){output.push(b);return;}
    const a=points[(i+points.length-1)%points.length],c=points[(i+1)%points.length];
    const la=Math.hypot(b[0]-a[0],b[1]-a[1]),lb=Math.hypot(c[0]-b[0],c[1]-b[1]);
    if(!la||!lb){output.push(b);return;}
    const u=b.map((v,k)=>(v-a[k])/la),v=c.map((x,k)=>(x-b[k])/lb),dot=Math.max(-1,Math.min(1,u[0]*v[0]+u[1]*v[1]));
    const turn=Math.acos(dot),direction=Math.sign(u[0]*v[1]-u[1]*v[0]);
    if(turn<.02||turn>Math.PI-.05||!direction){output.push(b);return;}
    const cut=Math.min(radiusMm*Math.tan(turn/2),la*.45,lb*.45),r=cut/Math.tan(turn/2);
    const start=b.map((x,k)=>x-u[k]*cut),center=[start[0]-u[1]*r*direction,start[1]+u[0]*r*direction];
    const angle=Math.atan2(start[1]-center[1],start[0]-center[0]),steps=Math.max(2,Math.ceil(turn*r/1.5));
    for(let j=0;j<=steps;j++){const t=angle+direction*turn*j/steps;output.push([center[0]+r*Math.cos(t),center[1]+r*Math.sin(t)]);}
  });
  if(route.closed)output.push(output[0]);
  return {...route,points:output};
}

/** Split a route when it returns onto its own tube. Nearby arc neighbours and
 * the ordinary closure of a counter are exempt; distant crossings are not. */
export function separateSelfCrossings(route){
  if(route.points.length<3)return [route];
  const points=sampleRoute(route).points,arc=[0],clearance=TUBE_MM+1,cells=new Map(),segments=[],available=[];
  for(let i=1;i<points.length;i++)arc.push(arc.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  const total=arc.at(-1);
  for(let i=0;i<points.length;i++){
    const p=points[i],ids=cells.get(`${Math.floor(p[0]/clearance)}:${Math.floor(p[1]/clearance)}`)||[];
    available[i]=!ids.some(id=>{
      const s=segments[id];let gap=arc[i]-s.arc;
      if(route.closed)gap=Math.min(gap,total-arc[i]+s.from);
      return gap>=TUBE_MM*2&&segmentDistance(p,p,s.a,s.b)<clearance;
    });
    if(!i||!available[i]||!available[i-1])continue;
    const a=points[i-1],b=p,id=segments.length;segments.push({a,b,arc:arc[i],from:arc[i-1]});
    for(let x=Math.floor((Math.min(a[0],b[0])-clearance)/clearance);x<=Math.floor((Math.max(a[0],b[0])+clearance)/clearance);x++)
      for(let y=Math.floor((Math.min(a[1],b[1])-clearance)/clearance);y<=Math.floor((Math.max(a[1],b[1])+clearance)/clearance);y++){
        const key=`${x}:${y}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(id);
      }
  }
  if(available.every(Boolean))return [route];
  const runs=[];let current=[];
  points.forEach((p,i)=>{if(available[i])current.push(p);else if(current.length){runs.push(current);current=[];}});
  if(current.length)runs.push(current);
  if(route.closed&&runs.length>1&&available[0]&&available.at(-1))runs[0]=[...runs.pop(),...runs[0].slice(1)];
  return runs.map(points=>({points,closed:false})).filter(p=>routeLength(p)>=.5);
}
