/** Version 2 geometry masks. Pixel-centre sampling is identical in workers and
 * server browsers; Canvas antialiasing must not determine a price or cut path. */
// Round below one millionth of a raster pixel before boundary decisions.
// Engine-specific last-bit transcendental results cannot move a boundary cell.
const rasterNumber=value=>Math.round(value*1e6)/1e6;
const rasterPoint=point=>point.map(rasterNumber);
export function flattenSvgPath(source, transform = ([x,y]) => [x,y]) {
  if(source.replace(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g,'').replace(/[MLQCZmlqcz,\s]/g,''))throw new Error('Unsupported outline command.');
  const tokens=source.match(/[MLQCZmlqcz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)||[];
  const paths=[];let current=[],cursor=[0,0],start=[0,0],i=0,command='',count=0;
  const point=()=>{const p=[Number(tokens[i++]),Number(tokens[i++])];if(!p.every(Number.isFinite))throw new Error('Invalid outline coordinates.');return rasterPoint(transform(p));};
  const add=p=>{if(++count>100000)throw new Error('Outline raster limit exceeded.');current.push(rasterPoint(p));};
  const dist2=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return (p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2;};
  const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
  const curve=(p,depth=0)=>{
    if(depth>=12||p.slice(1,-1).every(v=>dist2(v,p[0],p.at(-1))<=.015625)){add(p.at(-1));return;}
    const levels=[p];while(levels.at(-1).length>1){const l=levels.at(-1);levels.push(l.slice(1).map((v,n)=>mid(l[n],v)));}
    curve(levels.map(l=>l[0]),depth+1);curve(levels.map(l=>l.at(-1)).reverse(),depth+1);
  };
  while(i<tokens.length){
    if(/^[A-Za-z]$/.test(tokens[i]))command=tokens[i++];
    if(command==='M'){if(current.length)paths.push({points:current,closed:false});cursor=point();start=cursor;current=[];add(cursor);command='L';}
    else if(command==='L'){cursor=point();add(cursor);}
    else if(command==='Q'){const control=point(),end=point();curve([cursor,control,end]);cursor=end;}
    else if(command==='C'){const a=point(),b=point(),end=point();curve([cursor,a,b,end]);cursor=end;}
    else if(command==='Z'||command==='z'){if(current.length)paths.push({points:current,closed:true});current=[];cursor=start;command='';}
    else throw new Error('Unsupported outline command.');
  }
  if(current.length)paths.push({points:current,closed:false});return paths;
}

export function createRasterMask(width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>2000000)throw new Error('Invalid raster size.');
  const mask=new Uint8Array(width*height);
  const span=(y,left,right)=>{const from=Math.max(0,Math.ceil(rasterNumber(left)-.5)),to=Math.min(width,Math.ceil(rasterNumber(right)-.5));if(to>from)mask.fill(1,y*width+from,y*width+to);};
  const fill=paths=>{
    const rows=new Map();let crossingsCount=0;
    for(const {points} of paths)for(let i=0;i<points.length;i++){
      const a=rasterPoint(points[i]),b=rasterPoint(points[(i+1)%points.length]);if(a[1]===b[1])continue;
      const lo=Math.max(0,Math.ceil(Math.min(a[1],b[1])-.5)),hi=Math.min(height,Math.ceil(Math.max(a[1],b[1])-.5));
      for(let y=lo;y<hi;y++){if(++crossingsCount>200000)throw new Error('Outline raster complexity exceeded.');const at=a[0]+(y+.5-a[1])*(b[0]-a[0])/(b[1]-a[1]);let row=rows.get(y);if(!row)rows.set(y,row=[]);row.push([at,b[1]>a[1]?1:-1]);}
    }
    for(const [y,crossings]of rows){crossings.sort((a,b)=>a[0]-b[0]);let winding=0,from=0;for(const [x,direction]of crossings){if(winding!==0)span(y,from,x);winding+=direction;from=x;}}
  };
  const disc=(p,r)=>{for(let y=Math.max(0,Math.ceil(p[1]-r-.5));y<Math.min(height,Math.ceil(p[1]+r-.5));y++){const dy=y+.5-p[1],dx=Math.sqrt(Math.max(0,r*r-dy*dy));span(y,p[0]-dx,p[0]+dx);}};
  const stroke=(paths,radius)=>{
    if(!Number.isFinite(radius)||radius<=0)return;radius=rasterNumber(radius);
    for(const {points,closed} of paths){
      for(const p of points)disc(p,radius);
      for(let i=0;i<points.length-(closed?0:1);i++){
        const a=points[i],b=points[(i+1)%points.length],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.sqrt(dx*dx+dy*dy);if(!length)continue;
        const x=-dy/length*radius,y=dx/length*radius;
        fill([{points:[[a[0]+x,a[1]+y],[b[0]+x,b[1]+y],[b[0]-x,b[1]-y],[a[0]-x,a[1]-y]]}]);
      }
    }
  };
  return {mask,fill,stroke,polygon:points=>fill([{points}])};
}
