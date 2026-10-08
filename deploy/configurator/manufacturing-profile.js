/** Provisional working values, explicitly requested by Daniel on 2026-09-28.
 * These are not a certificate for NEONTRIP's unknown actual hose/material.
 * Comparison: https://flexibleneon.com.au/products/8x16mm (30-mm bend diameter,
 * 10-mm cutting interval); https://www.ledsignsandlighting.co.uk/8mm (10-mm cut).
 * Acrylic, bridge and slot values below are engineering preview assumptions. */
export const MANUFACTURING_PROFILE=Object.freeze({
  id:'neontrip-estimated-8mm-v2',status:'estimated',
  tubeMm:8,minBendRadiusMm:15,cutPitchMm:10,acrylicThicknessMm:5,
  contourMarginMm:10,minBridgeWidthMm:25,
  standInsetMm:35,standSlotClearanceMm:.2,standSlotDepthMm:12,standSupportMm:20,
  // User-set selection limit (2026-10-06), including the displayed support height.
  standMaximumHeightMm:500,
});

export const TABLE_STAND_HEIGHT_MESSAGE='Tischständer sind nur bis 50 cm Außenhöhe wählbar. Darüber empfehlen wir sie aus statischen Gründen nicht. Bitte ruf uns im Zweifel an.';

/** Samples several mm of arc on both sides, avoiding curvature of raster stair steps. */
export function routeMetrics(route){
  const points=route.points,arc=[0];
  for(let i=1;i<points.length;i++)arc.push(arc.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  const lengthMm=arc.at(-1)||0;
  if(lengthMm<1e-8)return {lengthMm,minRadiusMm:null};
  const at=distance=>{
    const d=route.closed?(distance%lengthMm+lengthMm)%lengthMm:Math.max(0,Math.min(lengthMm,distance));
    let lo=0,hi=arc.length-1;
    while(lo+1<hi){const mid=(lo+hi)>>1;if(arc[mid]<d)lo=mid;else hi=mid;}
    const t=(d-arc[lo])/(arc[hi]-arc[lo]||1);
    return points[lo].map((v,axis)=>v+(points[hi][axis]-v)*t);
  };
  let minRadiusMm=Infinity;
  const reach=Math.min(8,lengthMm/4),start=route.closed?0:reach,end=route.closed?lengthMm:lengthMm-reach;
  for(let d=start;d<=end;d+=Math.max(2,lengthMm/4000)){
    const a=at(d-reach),b=at(d),c=at(d+reach);
    const cross=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
    if(cross<.001)continue;
    const ab=Math.hypot(a[0]-b[0],a[1]-b[1]),bc=Math.hypot(b[0]-c[0],b[1]-c[1]),ca=Math.hypot(c[0]-a[0],c[1]-a[1]);
    if(Math.min(ab,bc,ca)<.01)continue;
    minRadiusMm=Math.min(minRadiusMm,ab*bc*ca/(2*cross));
  }
  return {lengthMm,minRadiusMm:Number.isFinite(minRadiusMm)?minRadiusMm:null};
}

export function evaluateTubeManufacturing(layout,profile=MANUFACTURING_PROFILE){
  let tightBends=0,shortSections=0,minRadiusMm=Infinity,cutLengthMm=0,routeLengthMm=0;
  for(const glyph of layout.glyphs)for(const route of glyph.paths){
    const metrics=routeMetrics(route);routeLengthMm+=metrics.lengthMm;
    if(metrics.lengthMm<profile.cutPitchMm)shortSections++;
    cutLengthMm+=Math.ceil((metrics.lengthMm-1e-8)/profile.cutPitchMm)*profile.cutPitchMm;
    if(metrics.minRadiusMm!==null){minRadiusMm=Math.min(minRadiusMm,metrics.minRadiusMm);if(metrics.minRadiusMm<profile.minBendRadiusMm)tightBends++;}
  }
  return {profileId:profile.id,profileStatus:profile.status,tightBends,shortSections,minRadiusMm:Number.isFinite(minRadiusMm)?minRadiusMm:null,
    routeLengthMm,estimatedCutLengthMm:cutLengthMm,status:tightBends||shortSections?'estimated-review-required':'estimated-check-passed',manufacturingApproved:false};
}

export function evaluatePlateManufacturing({widthMm,heightMm,mount,marginMm},profile=MANUFACTURING_PROFILE){
  const slotWidthMm=profile.acrylicThicknessMm+profile.standSlotClearanceMm;
  const standSlotsFit=widthMm>2*profile.standInsetMm+slotWidthMm&&heightMm>profile.standSlotDepthMm;
  const standHeightFits=Number.isFinite(heightMm)&&heightMm<=profile.standMaximumHeightMm+1e-7;
  const standFits=standSlotsFit&&standHeightFits;
  return {profileId:profile.id,profileStatus:profile.status,acrylicThicknessMm:profile.acrylicThicknessMm,
    minimumBridgeMm:profile.minBridgeWidthMm,slotWidthMm,standSlotsFit,standHeightFits,standFits,marginWithinRange:marginMm>=10&&marginMm<=15,
    status:mount==='table-stand'&&!standFits?'geometry-conflict':'estimated-review-required',strengthVerified:false};
}

/** Global turning sampled at equal arc-length intervals. An inscribed coarse
 * polygon measures a lower bound on the total turn without summing tiny raster
 * wiggles. With curvature at most 1/R, any continuous route needs L >= R * turn.
 * This necessary bound does not certify local radii, junctions or clearance. */
export function coarseRouteTurn(route){
  const points=route.points,arc=[0];
  for(let i=1;i<points.length;i++)arc.push(arc.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  const lengthMm=arc.at(-1)||0;
  if(lengthMm<1e-8||points.length<3)return 0;
  const sampled=[];let cursor=0;
  // Eight sections are a numerical sampling choice, not another material limit.
  for(let i=0;i<=8;i++){
    const target=lengthMm*i/8;
    while(cursor+1<arc.length-1&&arc[cursor+1]<target)cursor++;
    const t=(target-arc[cursor])/(arc[cursor+1]-arc[cursor]||1);
    sampled.push(points[cursor].map((v,axis)=>v+(points[cursor+1][axis]-v)*t));
  }
  let angle=0;
  for(let i=2;i<sampled.length;i++){
    const a=sampled[i-2],b=sampled[i-1],c=sampled[i];
    const ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-b[0],vy=c[1]-b[1];
    angle+=Math.abs(Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy));
  }
  return angle;
}

/** Exact separation of independent words/lines. Same-word script connections
 * are intentionally excluded. Small segment trees only prune impossible pairs;
 * the final distance uses the same segment formula as tube-geometry.js. */
export function minimumTextGroupClearance(layout){
  const groups=new Map();
  for(const glyph of layout.glyphs){
    const key=`${glyph.lineIndex??0}:${glyph.wordIndex??0}`;
    if(!groups.has(key))groups.set(key,[]);
    for(const route of glyph.paths){
      const points=route.points;if(!points.length)continue;
      const pairs=points.length===1?[[points[0],points[0]]]:points.slice(1).map((p,i)=>[points[i],p]);
      if(route.closed)pairs.push([points.at(-1),points[0]]);
      for(const [a,b] of pairs)groups.get(key).push({a,b,minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minY:Math.min(a[1],b[1]),maxY:Math.max(a[1],b[1])});
    }
  }
  if(groups.size<2)return {distanceMm:null,groups:groups.size};
  const distanceBoxes=(a,b)=>Math.hypot(Math.max(0,a.minX-b.maxX,b.minX-a.maxX),Math.max(0,a.minY-b.maxY,b.minY-a.maxY));
  const tree=segments=>{
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const s of segments){minX=Math.min(minX,s.minX);minY=Math.min(minY,s.minY);maxX=Math.max(maxX,s.maxX);maxY=Math.max(maxY,s.maxY);}
    const node={minX,minY,maxX,maxY,count:segments.length};
    if(segments.length<=8)return {...node,segments};
    const axis=maxX-minX>=maxY-minY?'X':'Y';
    segments.sort((a,b)=>a['min'+axis]+a['max'+axis]-b['min'+axis]-b['max'+axis]);
    const half=segments.length>>1;
    return {...node,children:[tree(segments.slice(0,half)),tree(segments.slice(half))]};
  };
  const pointSegment=(p,a,b)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;
    const t=length2?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2)):0;
    return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
  };
  const segmentDistance=(a,b,c,d)=>{
    const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
    const u=cross(a,b,c),v=cross(a,b,d),s=cross(c,d,a),t=cross(c,d,b);
    if(((u>0&&v<0)||(u<0&&v>0))&&((s>0&&t<0)||(s<0&&t>0)))return 0;
    return Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));
  };
  let best=Infinity;
  const compare=(a,b)=>{
    if(distanceBoxes(a,b)>=best)return;
    if(a.segments&&b.segments){
      for(const s of a.segments)for(const t of b.segments){
        if(distanceBoxes(s,t)>=best)continue;
        best=Math.min(best,segmentDistance(s.a,s.b,t.a,t.b));
        if(best===0)return;
      }
      return;
    }
    const splitA=a.children&&(!b.children||a.count>=b.count);
    const pairs=(splitA?a.children:b.children).map(child=>splitA?[child,b]:[a,child]);
    pairs.sort((x,y)=>distanceBoxes(...x)-distanceBoxes(...y));
    for(const pair of pairs)compare(...pair);
  };
  const roots=[...groups.values()].filter(segments=>segments.length).map(tree),pairs=[];
  for(let i=0;i<roots.length;i++)for(let j=i+1;j<roots.length;j++)pairs.push([roots[i],roots[j]]);
  pairs.sort((a,b)=>distanceBoxes(...a)-distanceBoxes(...b));
  for(const pair of pairs){compare(...pair);if(best===0)break;}
  return {distanceMm:Number.isFinite(best)?best:null,groups:roots.length};
}

/** Technical route diagnostic only; not used to gate text sizes or prices.
 * A scale-invariant lower bound, not a complete fabrication certificate.
 * Closed loops must fit at least the bend diameter; finite routes need a cut interval.
 * Open curves also need enough arc length for their measured global turning.
 * Local junctions/cusps remain routing-review items, not size multipliers.
 * Measure at a fixed reference width so changing the preview cannot move the limit. */
export function minimumTubeDesign(result,profile=MANUFACTURING_PROFILE){
  const width=result?.size?.exact?.design?.widthMm;
  if(!Number.isFinite(width)||width<=profile.tubeMm)return null;
  const referenceSpan=1000-profile.tubeMm,factor=referenceSpan/(width-profile.tubeMm);
  let scale=0,closedLoops=0,shortRoutes=0,openCurves=0;
  for(const glyph of result.layout.glyphs)for(const route of glyph.paths){
    const points=route.points.map(p=>p.map(v=>(v-profile.tubeMm/2)*factor));
    const metrics=routeMetrics({...route,points});
    // One/two-point fragments are rendered as capped dots. They require a
    // separate construction decision, not a tens-of-metres sign-size estimate.
    if(points.length>2&&metrics.lengthMm>1e-6){
      scale=Math.max(scale,profile.cutPitchMm/metrics.lengthMm);shortRoutes++;
      if(!route.closed){
        const turn=coarseRouteTurn({...route,points});
        scale=Math.max(scale,profile.minBendRadiusMm*turn/metrics.lengthMm);
        if(turn>1e-8)openCurves++;
      }
    }
    if(route.closed){
      const spans=[0,1].map(axis=>Math.max(...points.map(p=>p[axis]))-Math.min(...points.map(p=>p[axis])));
      const span=Math.min(...spans);
      // Raster cusps inside a font are not circles. Their local radius remains
      // a review warning; using it as a size multiplier would reject normal text.
      if(span>1e-6)scale=Math.max(scale,2*profile.minBendRadiusMm/span);
      closedLoops++;
    }
  }
  const clearance=minimumTextGroupClearance(result.layout);
  const referenceGapMm=clearance.distanceMm===null?null:clearance.distanceMm*factor;
  const layoutConflict=referenceGapMm!==null&&referenceGapMm<1e-7?'overlapping-text-groups':null;
  if(referenceGapMm!==null&&!layoutConflict)scale=Math.max(scale,profile.tubeMm/referenceGapMm);
  const widthMm=referenceSpan*scale+profile.tubeMm;
  const ratio=(result.size.exact.design.heightMm-profile.tubeMm)/(width-profile.tubeMm);
  return {widthMm,heightMm:(widthMm-profile.tubeMm)*ratio+profile.tubeMm,closedLoops,shortRoutes,openCurves,layoutConflict,textGroups:clearance.groups,profileId:profile.id,manufacturingApproved:false};
}

/** Availability policy derived from the live old shop on 2026-10-05:
 * 11 characters at 50 cm, 14 at 75, 18 at 100, 24 at 150, 32 at 200.
 * Intermediate centimetres are interpolated; longer lines extend the last span.
 * The old one-line height range starts at 5 cm. Neither shop range certifies
 * fabrication. In particular, a skeleton fragment is not an individual tube:
 * estimated bend/cut details remain in evaluateTubeManufacturing, not a veto.
 */
export const TEXT_SIZE_POLICY=Object.freeze({
  id:'neontrip-text-size-20261005-v5',minimumLetterHeightMm:50,
  anchors:Object.freeze([[11,500],[14,750],[18,1000],[24,1500],[32,2000]].map(Object.freeze)),
  source:'https://www.neontrip.de/products/custom-neon',checkedAt:'2026-10-05',
});
export function textMinimumOuterWidthMm(text=''){
  const lines=text.replace(/\r\n?/g,'\n').replace(/[^\S\n\t]/gu,' ').replace(/\t/g,'    ').split('\n').map(line=>line.trimEnd());
  const visible=lines.filter(line=>line.trim());
  // The renderer treats a common leading indent as a translation, not material.
  const commonIndent=visible.length?Math.min(...visible.map(line=>line.length-line.trimStart().length)):0;
  const segments=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  const count=Math.max(0,...visible.map(line=>[...segments.segment(line.slice(commonIndent).replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/gu,''))].length));
  const anchors=TEXT_SIZE_POLICY.anchors;
  if(count<=anchors[0][0])return anchors[0][1];
  const next=anchors.findIndex(([n])=>n>=count),hi=next<0?anchors.length-1:next,lo=hi-1;
  return anchors[lo][1]+(count-anchors[lo][0])*(anchors[hi][1]-anchors[lo][1])/(anchors[hi][0]-anchors[lo][0]);
}
export function minimumTextDesign(result,text='',profile=MANUFACTURING_PROFILE){
  const width=result?.size?.exact?.design?.widthMm;
  if(!Number.isFinite(width)||width<=profile.tubeMm)return null;
  let scale=0;
  const words=new Map();
  for(const glyph of result.layout.glyphs){
    // Dots, accents and punctuation are not separate 5-cm letters. Within a
    // word, use its tallest actual letter body, including the fixed tube width.
    if(!/[\p{L}\p{N}]/u.test(glyph.charText||''))continue;
    const ys=glyph.paths.flatMap(route=>route.points.map(p=>p[1]));
    if(!ys.length)continue;
    const key=`${glyph.lineIndex??0}:${glyph.wordIndex??0}`;
    words.set(key,Math.max(words.get(key)||0,Math.max(...ys)-Math.min(...ys)));
  }
  for(const height of words.values())if(height>1e-7)scale=Math.max(scale,(TEXT_SIZE_POLICY.minimumLetterHeightMm-profile.tubeMm)/height);
  const clearance=minimumTextGroupClearance(result.layout);
  const layoutConflict=clearance.distanceMm!==null&&clearance.distanceMm<1e-7?'overlapping-text-groups':null;
  if(clearance.distanceMm!==null&&!layoutConflict)scale=Math.max(scale,profile.tubeMm/clearance.distanceMm);
  return {widthMm:(width-profile.tubeMm)*scale+profile.tubeMm,
    heightMm:(result.size.exact.design.heightMm-profile.tubeMm)*scale+profile.tubeMm,
    minimumOuterWidthMm:textMinimumOuterWidthMm(text),layoutConflict,textGroups:clearance.groups,
    profileId:TEXT_SIZE_POLICY.id,manufacturingApproved:false};
}
