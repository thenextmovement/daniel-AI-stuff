import {buildPreviewBackingContour} from './backing-contour.js?v=20261016-preview-worker1';
import {createRasterMask,flattenSvgPath} from './deterministic-raster.js';
import {evaluateTubeManufacturing,minimumTextDesign,minimumTextGroupClearance} from './manufacturing-profile.js?v=20261005-spacing2';
import { parseFont } from './vendor/fontkit.js';
import { layoutText } from './geometry.js?v=20261005-spacing2';
import { thinMask,traceMask,smoothRoute,physicalTubeLayout,inspectTubeLayout,boundaryDistances,collapseRasterJunctions,pruneRasterSpurs,smoothRasterRoutes,refineTubeRoutes } from './tube-geometry.js?v=20261014-font-replay3';

const fonts = new Map();
const routeCache=new Map();
const logos=new Map();
const CONNECTED_SCRIPT_FONTS=new Set(['Alexa','Amanda','Amsterdam','Austin','Barcelona','Bayview','Beachfront','Chelsea','Freehand','Freespirit','Greenworld','Hamillton','LoveNeon','LoveNote','Mayfair','Melbourne','Neonscript','NewCursive','Northshore','Signature','Waikiki','WildScript']);
function isConnectedScriptFont(font,id){
  // Uploaded copies retain their intrinsic family, regardless of the upload ID.
  return !!font&&(CONNECTED_SCRIPT_FONTS.has(id)||CONNECTED_SCRIPT_FONTS.has(font.familyName)||
    (font['OS/2']?.sFamilyClass>>>8)===10||font['OS/2']?.panose?.[0]===3);
}
function finishNeonLayout(layout,routes,data){
  const raw=physicalTubeLayout(layout,routes,{axis:data.axis,valueMm:data.valueMm,marginMm:15});
  const refined=refineTubeRoutes(raw.layout,{connectScript:isConnectedScriptFont(fonts.get(data.fontId),data.fontId),outlineGlyphs:layout.glyphs,smoothConnections:data.rasterVersion===3});
  if(refined.routes.reduce((n,g)=>n+g.paths.reduce((sum,p)=>sum+p.points.length,0),0)>80000)throw new Error('Dieser Entwurf enthält zu viele Neonsegmente. Bitte vereinfachen Sie das Motiv.');
  const result=physicalTubeLayout(raw.layout,refined.routes,{axis:data.axis,valueMm:data.valueMm,marginMm:15});
  return {...result,...([2,3].includes(data.rasterVersion)?{rasterVersion:data.rasterVersion}:{}),production:{...inspectTubeLayout(result.layout),adaptation:refined.adaptation,...evaluateTubeManufacturing(result.layout)}};
}
function glyphRoutes(glyph,fontId,rasterVersion){
  const key=`${fontId}:${glyph.glyphId}:${rasterVersion??1}`;
  let route=routeCache.get(key);
  if(!route){
    const b=glyph.bounds,w=b.maxX-b.minX,h=b.maxY-b.minY,resolution=384/Math.max(w,h),pad=4;
    const width=Math.ceil(w*resolution)+pad*2,height=Math.ceil(h*resolution)+pad*2;
    let mask;
    if(rasterVersion===2||rasterVersion===3){
      const raster=createRasterMask(width,height);
      raster.fill(flattenSvgPath(glyph.d,([x,y])=>[pad+(x+glyph.x-b.minX)*resolution,pad+(-y+glyph.y-b.minY)*resolution]));
      mask=raster.mask;
    }else{
      if(typeof OffscreenCanvas==='undefined'||typeof Path2D==='undefined')throw new Error('Die Neonpfad-Vorschau benötigt einen aktuellen Browser.');
      const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});
      ctx.setTransform(resolution,0,0,-resolution,pad+(glyph.x-b.minX)*resolution,pad+(glyph.y-b.minY)*resolution);
      ctx.fill(new Path2D(glyph.d));
      const pixels=ctx.getImageData(0,0,width,height).data;
      mask=Uint8Array.from({length:width*height},(_,i)=>pixels[i*4+3]>127?1:0);
    }
    const distances=boundaryDistances(mask,width,height);
    // Version 1/2 must replay their original paths and material lengths exactly.
    let traced=pruneRasterSpurs(collapseRasterJunctions(traceMask(thinMask(mask,width,height),width,height),distances,width),distances,width,{taperedCorners:rasterVersion===3});
    if(rasterVersion===3)traced=smoothRasterRoutes(traced,distances,width);
    const local=([x,y])=>[(x-pad)/resolution,(y-pad)/resolution];
    route={paths:traced.paths.map(p=>{const smoothed=smoothRoute(p,rasterVersion===3?8:3,traced.junctions);return {...smoothed,points:smoothed.points.map(local)};}),junctions:traced.junctions.map(local)};
    // Bounded cache: uploaded fonts cannot retain an unlimited number of raster routes.
    if(routeCache.size>=512)routeCache.delete(routeCache.keys().next().value);
    routeCache.set(key,route);
  }
  const position=([x,y])=>[x+glyph.bounds.minX,y+glyph.bounds.minY];
  return {paths:route.paths.map(p=>({...p,points:p.points.map(position)})),junctions:route.junctions.map(position)};
}
self.onmessage = async ({ data }) => {
  const { requestId } = data;
  try {
    if(['render','render-logo'].includes(data.type)&&data.rasterVersion!==undefined&&![1,2,3].includes(data.rasterVersion))throw new Error('Unbekannte Entwurfsversion.');
    if (data.type === 'load') {
      if (!fonts.has(data.fontId)) {
        const bytes = data.bytes || await fetch(data.url).then(r => {
          if (!r.ok) throw new Error('Die Schriftdatei konnte nicht geladen werden.');
          return r.arrayBuffer();
        });
        if (bytes.byteLength > 5_000_000) throw new Error('Die Schriftdatei darf höchstens 5 MB groß sein.');
        const font = parseFont(new Uint8Array(bytes));
        if (!font || typeof font.layout !== 'function') throw new Error('Bitte verwenden Sie eine einzelne TTF- oder OTF-Schrift.');
        fonts.set(data.fontId, font);
      }
      self.postMessage({ requestId, ok: true });
    } else if(data.type==='text-minimum'){
      self.postMessage({requestId,ok:true,minimum:minimumTextDesign(data.result,data.text)});
    } else if(data.type==='line-clearance'){
      const layout={...data.layout,glyphs:data.layout.glyphs.map(g=>({...g,wordIndex:0}))};
      self.postMessage({requestId,ok:true,clearance:minimumTextGroupClearance(layout)});
    } else if(data.type==='preview-contour'){
      self.postMessage({requestId,ok:true,path:buildPreviewBackingContour(data.result,data.marginMm)});
    } else if(data.type==='load-logo'){
      if(logos.has(data.logoId)){self.postMessage({requestId,ok:true});return;}
      const {width,height,mask}=data;
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<3||height<3||width>776||height>776||!(mask instanceof Uint8Array)||mask.length!==width*height)throw new Error('Ungültiges Logoraster.');
      const traced=pruneRasterSpurs(traceMask(thinMask(mask,width,height),width,height),boundaryDistances(mask,width,height),width);
      const paths=traced.paths.map(path=>smoothRoute(path,3,traced.junctions));
      if(!paths.length||paths.length>600||paths.reduce((n,p)=>n+p.points.length,0)>80000)throw new Error('Das Logo enthält zu viele Details. Bitte ein einfacheres Linienlogo verwenden.');
      if(logos.size>=20)logos.delete(logos.keys().next().value);
      logos.set(data.logoId,{paths,junctions:traced.junctions});self.postMessage({requestId,ok:true});
    } else if(data.type==='render-logo'){
      const routes=logos.get(data.logoId);if(!routes)throw new Error('Das Logo ist noch nicht geladen.');
      const layout={glyphs:[{lineIndex:0,wordIndex:0,glyphId:0}],unitsPerEm:1000,baselineStep:0,lineCount:1,alignment:'center'};
      self.postMessage({requestId,ok:true,...finishNeonLayout(layout,[routes],data)});
    } else if (data.type === 'render') {
      const font = fonts.get(data.fontId);
      if (!font) throw new Error('Die gewählte Schrift ist noch nicht geladen.');
      const layout = layoutText(font, { text: data.text, alignment: data.alignment, lineHeight: data.lineHeight ?? 1.25, maxLines: 5 });
      if (layout.glyphs.length > 250 || layout.glyphs.reduce((n,g) => n + g.d.length, 0) > 1_000_000) {
        throw new Error('Dieser Schriftzug ist zu komplex. Bitte kürzen Sie den Text oder wählen Sie eine andere Schrift.');
      }
      const routes=[];let pointCount=0;
      for(const glyph of layout.glyphs){
        const route=glyphRoutes(glyph,data.fontId,data.rasterVersion);pointCount+=route.paths.reduce((count,path)=>count+path.points.length,0);
        if(pointCount>80000)throw new Error('Diese Schrift enthält zu viele feine Details. Bitte wählen Sie eine einfachere Schrift oder kürzen Sie den Text.');
        routes.push(route);
      }
      const result=finishNeonLayout(layout,routes,data);
      // Every text preview uses complete source contours, including reopened
      // V1/V2 drafts. rasterVersion only selects the original material/pricing
      // replay; it must not send old drafts back through the lossy skeleton view.
      // One uniform transform preserves shaping, kerning and every source curve
      // without changing versioned paths, dimensions or manufacturing inputs.
      const design=result.size.exact.design,scale=Math.min(design.widthMm/layout.bounds.width,design.heightMm/layout.bounds.height);
      result.outlinePreview={scale,x:(design.widthMm-layout.bounds.width*scale)/2,y:(design.heightMm-layout.bounds.height*scale)/2,origins:layout.glyphs.map(g=>[g.x,g.y])};
      self.postMessage({requestId,ok:true,...result});
    }
  } catch (error) {
    self.postMessage({ requestId, ok: false, error: error.message || 'Die Schrift konnte nicht verarbeitet werden.', code: error.code || 'FONT_ERROR' });
  }
};
