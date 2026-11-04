"""Component-local centreline reconstruction from pixels; no glyph templates."""
import numpy as np
from scipy import ndimage
from scipy.optimize import least_squares, minimize_scalar
from skimage.morphology import skeletonize
from skimage.measure import find_contours
from shapely.geometry import LineString, Point
from geometry import sample_path, segments, KAPPA
from reconstruction import cubic_fit, fit_boundary, resample, straight_runs, unit


def ellipse_path(q, tolerance):
    """Accept a four-cubic ellipse only when the complete loop fits the pixels."""
    q=np.asarray(q,float)
    if len(q)<20 or np.linalg.norm(q[0]-q[-1])>2:return None
    center=q.mean(axis=0);cov=np.cov((q-center).T)
    values,vectors=np.linalg.eigh(cov);radii=np.sqrt(np.maximum(values,1)*2)
    angle=np.arctan2(vectors[1,1],vectors[0,1])
    def local(params):
        x,y,a,b,t=params;c,s=np.cos(t),np.sin(t)
        return (q-[x,y])@np.array([[c,-s],[s,c]]),a,b
    def residual(params):
        xy,a,b=local(params);norm=np.sqrt((xy[:,0]/a)**2+(xy[:,1]/b)**2)
        # First-order geometric distance, in source pixels.
        return (1-1/np.maximum(norm,1e-9))*np.linalg.norm(xy,axis=1)
    try:
        result=least_squares(residual,[*center,radii[1],radii[0],angle],max_nfev=80,
                             bounds=([-np.inf,-np.inf,1,1,-np.inf],[np.inf]*5))
    except ValueError:return None
    x,y,a,b,t=result.x
    if not result.success or max(a,b)>np.ptp(q,axis=0).max()*2:return None
    errors=abs(residual(result.x))
    if np.percentile(errors,95)>tolerance or errors.max()>tolerance*1.8:return None
    c,s=np.cos(t),np.sin(t);rot=np.array([[c,s],[-s,c]])
    def pt(u,v):return (np.array([u*a,v*b])@rot+[x,y]).tolist()
    k=KAPPA
    path=[['m',pt(1,0)],['c',pt(1,k),pt(k,1),pt(0,1)],
            ['c',pt(-k,1),pt(-1,k),pt(-1,0)],['c',pt(-1,-k),pt(-k,-1),pt(0,-1)],
            ['c',pt(k,-1),pt(1,-k),pt(1,0)],['h']]
    if LineString(q).hausdorff_distance(LineString(sample_path(path,80)))>tolerance*1.8:return None
    return path


def smooth_path(q,tolerance=1,closed=False):
    q=np.array(q,float)
    if closed:
        ellipse=ellipse_path(q,tolerance)
        if ellipse:return ellipse
    return fit_boundary(q,tolerance) if closed else cubic_fit(resample(q,sigma=1.2),tolerance)


def centered_reference(q,r,mask,closed=False):
    """Refine a draft route to the midpoint of opposing image edges."""
    p=resample(q,closed,sigma=max(1.2,r*.25))
    offsets=np.arange(-3*r,3*r+.3,.3)
    for _ in range(2):
        tangents=ndimage.gaussian_filter1d(np.gradient(p,axis=0),max(1,r*.2),axis=0,mode='wrap' if closed else 'nearest')
        normals=np.column_stack([-tangents[:,1],tangents[:,0]])
        normals/=np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-9)
        probes=p[:,None,:]+offsets[None,:,None]*normals[:,None,:]
        values=ndimage.map_coordinates(mask.astype(float),[probes[:,:,1],probes[:,:,0]],order=1,mode='constant')
        corrections=np.zeros(len(p));center=int(np.argmin(abs(offsets)))
        for i,row in enumerate(values):
            if i in (0,len(p)-1) or row[center]<.5:continue
            left=right=center
            while left>0 and row[left]>.5:left-=1
            while right<len(row)-1 and row[right]>.5:right+=1
            if not left or right==len(row)-1:continue
            lo=offsets[left]+.3*(.5-row[left])/max(row[left+1]-row[left],1e-9)
            hi=offsets[right-1]+.3*(row[right-1]-.5)/max(row[right-1]-row[right],1e-9)
            width=hi-lo;mid=(hi+lo)/2
            if 1.2*r<width<2.8*r and abs(mid)<r*.5:corrections[i]=mid
        corrections=ndimage.gaussian_filter1d(corrections,max(1,r*.2),mode='wrap' if closed else 'nearest')
        p+=corrections[:,None]*normals*.8
        p[0]=q[0];p[-1]=q[-1]
    # Average sub-stroke edge noise before fitting; keep measured endpoints.
    return resample(p,closed,sigma=max(1.2,r*.3))


def reconstruct_route(q,r,mask):
    """Separate supported stems from bends before fitting the curved remainder."""
    closed=np.linalg.norm(q[0]-q[-1])<1
    p=centered_reference(q,r,mask,closed)
    if closed:
        n=len(p)-1;cuts=[0,n//4,n//2,3*n//4,n];path=[]
        for a,b in zip(cuts,cuts[1:]):
            if b<=a:continue
            t0=unit(p[min(a+3,n)]-p[max(a-3,0)])
            t1=unit(p[max(b-3,0)]-p[min(b+3,n)])
            part=cubic_fit(p[a:b+1],max(1.2,r*.16),t0,t1)
            path.extend(part if not path else part[1:])
        path.append(['h']);return path,[]
    runs=straight_runs(p,max(12,4*r),.65)
    fitted=[]
    for a,b,anchor,d in runs:
        fit=refine_line(p[a:b+1],r,mask)
        if fit is None:continue
        anchor,d=fit
        normal=np.array([-d[1],d[0]])
        if np.percentile(abs((p[a:b+1]-anchor)@normal),95)>max(1.8,r*.2):continue
        if d@(p[b]-p[a])<0:d=-d
        # Stop a stem where the reference actually reaches its axis. Projecting
        # a still-curving point onto the stem creates a tiny hook at the join.
        residual=abs((p-anchor)@normal)
        while a<b-4 and residual[a]>max(.35,r*.055):a+=1
        while b>a+4 and residual[b]>max(.35,r*.055):b-=1
        if a<r and residual[0]<max(1,r*.15):a=0
        if len(p)-1-b<r and residual[-1]<max(1,r*.15):b=len(p)-1
        if b-a<max(8,2*r):continue
        fitted.append((a,b,anchor,d))
    if not fitted:return cubic_fit(p,max(1.1,r*.08)),[]
    extras=[]
    for a,b,anchor,d in fitted:
        for idx in (a,b):p[idx]=anchor+((p[idx]-anchor)@d)*d
        # Recover short cap stems removed by skeleton pruning (e.g. a shoulder
        # meeting an upright). Extend only if opposite source edges remain
        # centered and the extension is longer than a local half-width.
        for idx,outward in ((a,-d),(b,d)):
            start=p[idx];normal=np.array([-outward[1],outward[0]])
            steps=np.arange(0,4*r,.5);probe=start+steps[:,None]*outward
            inside=ndimage.map_coordinates(mask.astype(float),[probe[:,1],probe[:,0]],order=1,mode='constant')>.5
            exits=np.flatnonzero(~inside)
            if not len(exits):continue
            extension=steps[exits[0]]-r
            if extension<r*1.1:continue
            # Check the last full cross-sections near the proposed cap.
            offsets=np.arange(-2*r,2*r+.25,.25)
            accepted=0
            for delta in np.linspace(max(0,extension-r*.65),extension,4):
                pts=start+delta*outward+offsets[:,None]*normal
                row=ndimage.map_coordinates(mask.astype(float),[pts[:,1],pts[:,0]],order=1,mode='constant')>.5
                center=int(np.argmin(abs(offsets)));left=right=center
                if not row[center]:continue
                while left>0 and row[left-1]:left-=1
                while right<len(row)-1 and row[right+1]:right+=1
                width=offsets[right]-offsets[left];mid=(offsets[right]+offsets[left])/2
                if 1.4*r<width<2.5*r and abs(mid)<max(1.25,r*.16):accepted+=1
            tip=start+extension*outward
            # A shallow bend already covers this area. It is not another arm:
            # recovering it would add a short whisker alongside the same arc.
            if accepted>=3 and LineString(p).distance(Point(tip))>r*.8:
                extras.append([['m',start.tolist()],['l',tip.tolist()]])
    path=[['m',p[0].tolist()]];cursor=0;previous=None
    for a,b,anchor,d in fitted:
        if a>cursor:
            part=cubic_fit(p[cursor:a+1],max(1.5,r*.12),previous,-d)
            path.extend(part[1:])
        path.append(['l',p[b].tolist()]);cursor=b;previous=d
    if cursor<len(p)-1:
        path.extend(cubic_fit(p[cursor:],max(1.5,r*.12),previous,None)[1:])
    return path,extras


def skeleton_routes(mask,preserved_caps=None):
    canonical=np.where(mask,1,0).astype(np.uint8).view(bool)
    skel=skeletonize(canonical,method='lee');distance=ndimage.distance_transform_edt(mask)
    pixels=set(map(tuple,np.argwhere(skel)))
    adj={}
    for y,x in pixels:
        adj[(y,x)]={q for dy in (-1,0,1) for dx in (-1,0,1) if (dy or dx)
                    and (q:=(y+dy,x+dx)) in pixels
                    and not (dy and dx and ((y,x+dx) in pixels or (y+dy,x) in pixels))}
    def routes():
        seen=set();out=[]
        def walk(a,b):
            route=[a];seen.add(frozenset((a,b)))
            while True:
                route.append(b)
                if b==route[0] or len(adj[b])!=2:break
                c=next(p for p in adj[b] if p!=a);edge=frozenset((b,c))
                if edge in seen:break
                seen.add(edge);a,b=b,c
            out.append(route)
        for junctions in (True,False):
            for a in sorted(adj):
                if junctions and len(adj[a])==2:continue
                for b in sorted(adj[a]):
                    if frozenset((a,b)) not in seen:walk(a,b)
        return out
    # Prune only terminal spurs shorter than their local stroke width. Never cut cycles.
    for _ in range(5):
        remove=set()
        for p in routes():
            if len(adj[p[-1]])==1:p=p[::-1]
            if len(adj[p[0]])!=1 or len(adj[p[-1]])<3:continue
            length=np.linalg.norm(np.diff(p,axis=0),axis=1).sum()
            cap_radius=distance[p[0]];junction_radius=distance[p[-1]]
            # A short, full-width cap is a real stroke (e.g. a crossbar or
            # descender). Corner whiskers taper down to a tiny endpoint radius.
            full_cap=cap_radius>=junction_radius*.6 and length>=cap_radius*.8
            if length<max(3,junction_radius*1.65):
                if full_cap and preserved_caps is not None:
                    preserved_caps.append((np.array([(x,y) for y,x in p],float),float(cap_radius)))
                remove.update(p[:-1])
        if not remove:break
        for p in remove:
            for neighbor in adj[p]:adj[neighbor].discard(p)
            del adj[p]
    return [(np.array([(x,y) for y,x in p],float),float(np.median([distance[q] for q in p])))
            for p in routes() if len(p)>1],distance


def continue_crossing_routes(routes,mask):
    """Follow opposed arms through an ink crossing instead of its medial fork.

    A raster X often skeletonizes as two T nodes with a short edge between
    them. That edge is not a pen stroke. Pair supported four-arm crossings
    and cursive retraces; leave angular letter corners and crossbars intact.
    """
    nodes={}
    for i,(q,r) in enumerate(routes):
        for end in (0,1):nodes.setdefault(tuple(q[0 if end==0 else -1]),[]).append((i,end))
    groups={key:{key} for key,arms in nodes.items() if len(arms)>=3}
    for q,r in sorted(routes,key=lambda item:LineString(item[0]).length):
        a,b=tuple(q[0]),tuple(q[-1])
        if a==b or a not in groups or b not in groups:continue
        group=groups[a]|groups[b]
        if len(group)>6 or LineString(q).length>4*r:continue
        points=np.array(list(group))
        if np.max(np.linalg.norm(points[:,None]-points[None,:],axis=2))>4*r:continue
        for key in group:groups[key]=group
    pairs={};trims={};branches={};removed=set();visited=set()
    values=mask.astype(float)
    for group in groups.values():
        frozen=frozenset(group)
        if frozen in visited:continue
        visited.add(frozen)
        internal={i for key in group for i,_ in nodes[key]
                  if tuple(routes[i][0][0]) in group and tuple(routes[i][0][-1]) in group
                  and LineString(routes[i][0]).length<4*routes[i][1]}
        arms=[arm for key in sorted(group) for arm in nodes[key] if arm[0] not in internal]
        if len(arms) not in (3,4):continue
        references=[];directions=[];cuts=[]
        for i,end in arms:
            q,r=routes[i];q=q if end==0 else q[::-1]
            p=centered_reference(q,r,mask)
            cut=min(int(max(4,2.5*r)),len(p)//4)
            reach=min(int(max(4,2*r)),len(p)-cut-1)
            references.append(p);cuts.append(cut)
            directions.append(unit(p[cut+reach]-p[cut]))
        if len(arms)==3:
            # A cursive retrace can merge into a stem before turning back.
            # Reconstruct its through stroke, then attach the third arm in
            # the same direction instead of keeping the medial-axis shoulder.
            stems=[straight_route(*routes[i],mask) for i,end in arms]
            if sum(s is not None for s in stems)!=1:continue
            choices=sorted(((-directions[a]@directions[b],a,b) for a,b in ((0,1),(0,2),(1,2))),reverse=True)
            score,a,b=choices[0]
            if score<.9 or score-choices[1][0]<.015:continue
            pairing=((a,b),)
        else:
            pairing=None
        options=[]
        for candidate in ((((0,1),(2,3)),((0,2),(1,3)),((0,3),(1,2))) if len(arms)==4 else ()):
            scores=[-directions[a]@directions[b] for a,b in candidate]
            options.append((sum(scores),min(scores),candidate))
        options.sort(reverse=True)
        score,minimum,crossing_pairing=options[0] if len(arms)==4 else (0,1,None)
        if pairing is None:pairing=crossing_pairing
        if minimum<.65:continue
        if len(arms)==4 and score-options[1][0]<.35:
            # A cursive connector can cross a stem at a very shallow angle.
            # Its local directions alone are ambiguous. A complete, collinear
            # source-supported stem supplies an independent pairing cue.
            stems=[straight_route(*routes[i],mask) for i,end in arms]
            supported=[]
            for candidate in options:
                if candidate[1]<.65:continue
                for a,b in candidate[2]:
                    if stems[a] is None or stems[b] is None:continue
                    aa,da=stems[a];ab,db=stems[b]
                    radius=min(routes[arms[a][0]][1],routes[arms[b][0]][1])
                    if abs(da@db)>.995 and abs(np.array([-da[1],da[0]])@(ab-aa))<radius:
                        supported.append(candidate);break
            if len(supported)!=1:continue
            score,minimum,pairing=supported[0]
            # Two curved strokes can retrace one common stem at close joins.
            # They must attach to that stem, not take an S-shaped shortcut.
            if len(group)>1 and sum(s is not None for s in stems)==2:
                pairing=tuple((a,b) for a,b in pairing if stems[a] is not None and stems[b] is not None)
                for k,(i,end) in enumerate(arms):
                    p=references[k];r=routes[i][1]
                    cuts[k]=min(int(max(4,(6 if stems[k] is not None else 3.5)*r)),len(p)//2)
                    reach=min(int(max(4,2*r)),len(p)-cuts[k]-1)
                    directions[k]=unit(p[cuts[k]+reach]-p[cuts[k]])
        connectors=[]
        for a,b in pairing:
            pa,pb=references[a][cuts[a]],references[b][cuts[b]]
            span=np.linalg.norm(pb-pa)
            # Incoming/outgoing directions measured beyond the widened crossing.
            da=-directions[a];db=directions[b]
            path=[['m',pa.tolist()],['c',(pa+da*span/3).tolist(),(pb-db*span/3).tolist(),pb.tolist()]]
            p=np.array(sample_path(path,max(20,int(span*2))))
            if np.min(ndimage.map_coordinates(values,[p[:,1],p[:,0]],order=1,mode='constant'))<.5:break
            connectors.append((a,b,p))
        if len(connectors)!=len(pairing):continue
        attached={}
        for third in (k for k in range(len(arms)) if all(k not in pair for pair in pairing)):
            p=connectors[0][2];tip=references[third][cuts[third]];direction=directions[third]
            # Find where the returning stroke's extrapolated axis meets the
            # through stroke. A shallow join must not be snapped sideways.
            normal=np.array([-direction[1],direction[0]])
            offset=(p-tip)@normal;indices=np.flatnonzero(offset[:-1]*offset[1:]<=0)
            if not len(indices):break
            j=min(indices,key=lambda j:np.linalg.norm(p[j]-tip))
            f=abs(offset[j])/max(abs(offset[j])+abs(offset[j+1]),1e-9)
            joint=p[j]+f*(p[j+1]-p[j]);tangent=unit(p[j+1]-p[j])
            if tangent@direction<0:tangent=-tangent
            span=np.linalg.norm(tip-joint)
            if span>(10 if len(arms)==4 else 6)*routes[arms[third][0]][1] or tangent@direction<.5:break
            path=[['m',joint.tolist()],['c',(joint+tangent*span/3).tolist(),(tip-direction*span/3).tolist(),tip.tolist()]]
            branch=np.array(sample_path(path,max(20,int(span*2))))
            if np.min(ndimage.map_coordinates(values,[branch[:,1],branch[:,0]],order=1,mode='constant'))<.5:break
            a,b,_=connectors[0]
            connectors[0]=(a,b,np.insert(p,j+1,joint,axis=0))
            attached[arms[third]]=(branch,cuts[third])
        if len(attached)!=len(arms)-2*len(pairing):continue
        branches.update(attached)
        removed.update(internal)
        for a,b,p in connectors:
            aa,bb=arms[a],arms[b]
            pairs[aa]=(bb,p);pairs[bb]=(aa,p[::-1])
            trims[aa]=references[a][cuts[a]:]
            trims[bb]=references[b][cuts[b]:]
    if not pairs:return routes,[]
    active={i for i,_ in pairs}|{i for i,_ in branches};done=set();joined=[]
    # Start at free ends first, then handle any remaining closed chains.
    starts=sorted(((i,end) for i in active for end in (0,1)),key=lambda e:e in pairs)
    for start in starts:
        if start[0] in done:continue
        current=start;parts=[];radii=[]
        while current[0] not in done:
            i,end=current;q,r=routes[i];done.add(i);radii.append(r)
            p=centered_reference(q,r,mask)
            lo=len(p)-len(trims[(i,0)]) if (i,0) in trims else 0
            hi=len(trims[(i,1)]) if (i,1) in trims else len(p)
            if (i,0) in branches:lo=branches[(i,0)][1]
            if (i,1) in branches:hi=len(p)-branches[(i,1)][1]
            p=p[lo:hi]
            if (i,0) in branches:p=np.vstack([branches[(i,0)][0][:-1],p])
            if (i,1) in branches:p=np.vstack([p,branches[(i,1)][0][-2::-1]])
            if end:p=p[::-1]
            parts.append(p)
            exit_end=(i,1-end)
            if exit_end not in pairs:break
            current,connector=pairs[exit_end];parts.append(connector[1:-1])
            if current==start:parts.append(parts[0][:1]);break
        joined.append((np.vstack(parts),float(np.median(radii))))
    return [item for i,item in enumerate(routes) if i not in removed|done],joined


def line_fit(points):
    anchor=points.mean(axis=0);_,_,v=np.linalg.svd(points-anchor,full_matrices=False)
    direction=v[0]
    return anchor,direction,np.abs((points-anchor)@v[1])


def refine_line(q,r,mask,tolerance=0):
    """Refit opposing stroke edges, excluding the wider areas at junctions."""
    trim=min(int(r),int(len(q)*.24));core=q[trim:len(q)-trim] if trim else q
    if len(core)<3:return None
    anchor,direction,error=line_fit(core)
    quality=float(np.percentile(error,95))
    if np.percentile(error,95)>max(1.2,r*.22,tolerance):return None
    for _ in range(3):
        normal=np.array([-direction[1],direction[0]])
        positions=np.linspace(*np.percentile((q-anchor)@direction,[12,88]),40)
        offsets=np.arange(-2.3*r,2.3*r+.5,.5)
        probes=anchor+positions[:,None,None]*direction+offsets[None,:,None]*normal
        values=ndimage.map_coordinates(mask.astype(float),[probes[:,:,1],probes[:,:,0]],order=1,mode='constant')>.5
        mids=[];widths=[]
        for p,row in zip(positions,values):
            mid=int(np.argmin(abs(offsets)))
            if not row[mid]:continue
            left=mid;right=mid
            while left>0 and row[left-1]:left-=1
            while right<len(row)-1 and row[right+1]:right+=1
            if left==0 or right==len(row)-1:continue
            widths.append(offsets[right]-offsets[left]);mids.append(anchor+p*direction+(offsets[right]+offsets[left])/2*normal)
        if len(mids)<6:break
        widths=np.array(widths);mids=np.array(mids)
        median=np.percentile(widths,30)
        accepted=mids[(widths>median*.8)&(widths<median*1.15)]
        if len(accepted)<6:break
        a,d,e=line_fit(accepted)
        if np.percentile(e,95)>max(1.1,r*.12,tolerance):break
        anchor,direction=a,d;quality=float(np.percentile(e,95))
    if quality>max(.9,r*.075,tolerance):return None
    if not tolerance:
        if abs(direction[0])<.035:direction=np.array([0.,1.])
        elif abs(direction[1])<.035:direction=np.array([1.,0.])
    return anchor,direction


def nearest_on_segment(op,p,point):
    if op=='l':
        v=p[-1]-p[0];t=np.clip((point-p[0])@v/max(v@v,1e-9),0,1)
        return p[0]+t*v
    def at(t):return (1-t)**3*p[0]+3*(1-t)**2*t*p[1]+3*(1-t)*t*t*p[2]+t**3*p[3]
    result=minimize_scalar(lambda t:np.sum((at(t)-point)**2),bounds=(0,1),method='bounded')
    return min((p[0],p[-1],at(result.x)),key=lambda p:np.linalg.norm(p-point))


def straight_route(q,r,mask):
    """A flat cap or branch may deflect the skeleton of a straight stroke.

    Fit its opposing image edges away from both ends. Only disregard terminal
    deviations when the central run is straight and stays within a stroke radius.
    """
    if len(q)<12 or np.linalg.norm(q[-1]-q[0])<4*r:return None
    trim=max(2,int(len(q)*.22));core=q[trim:-trim]
    fit=refine_line(core,r,mask)
    if fit is None:return None
    anchor,direction=fit;normal=np.array([-direction[1],direction[0]])
    residual=abs((q-anchor)@normal)
    if np.percentile(residual[trim:-trim],95)>max(1,r*.36) or residual.max()>r*1.15:return None
    # The candidate must remain inside the source over its full central span.
    points=anchor+((core-anchor)@direction)[:,None]*direction
    if np.min(ndimage.map_coordinates(mask.astype(float),[points[:,1],points[:,0]],order=1,mode='constant'))<.5:return None
    return fit


def join_straight_paths(paths):
    """Continue collinear strokes through branches, without duplicating them."""
    paths=list(paths)
    while True:
        merged=False
        for i,a in enumerate(paths):
            if len(a)!=2 or a[1][0]!='l':continue
            for j in range(i+1,len(paths)):
                b=paths[j]
                if len(b)!=2 or b[1][0]!='l':continue
                for ia in (0,1):
                    for ib in (0,1):
                        joint=np.array(a[ia][1]);other=np.array(b[ib][1])
                        if np.linalg.norm(joint-other)>.01:continue
                        first=np.array(a[1-ia][1]);last=np.array(b[1-ib][1])
                        if unit(first-joint)@unit(last-joint)>-.9999:continue
                        paths[i]=[['m',first.tolist()],['l',last.tolist()]]
                        paths.pop(j);merged=True;break
                    if merged:break
                if merged:break
            if merged:break
        if not merged:return paths


def join_loop_stems(routes,caps):
    """A loop with two arms can share one continuous stem with those arms.

    Split at the measured skeleton junctions, continuing along the short side
    of the loop. The other side remains a separate bowl, with shared junctions.
    """
    for cap in list(caps):
        q,r=cap
        for index,(loop,lr) in enumerate(routes):
            if np.linalg.norm(loop[0]-loop[-1])>1:continue
            j=int(np.argmin(np.linalg.norm(loop-q[-1],axis=1)))
            if j==0 or j==len(loop)-1 or np.linalg.norm(loop[j]-q[-1])>.1:continue
            a,b=loop[:j+1],loop[j:][::-1]
            la,lb=LineString(a).length,LineString(b).length
            stem,bowl=(a,b) if la<lb else (b,a)
            if min(la,lb)>.38*(la+lb):continue
            if abs(unit(stem[-1]-stem[0])@unit(q[-1]-q[0]))<.82:continue
            arms=[(i,p,pr) for i,(p,pr) in enumerate(routes) if i!=index
                  and np.linalg.norm(p[0]-p[-1])>1
                  and min(np.linalg.norm(p[0]-loop[0]),np.linalg.norm(p[-1]-loop[0]))<.1]
            if len(arms)!=1:continue
            i,arm,ar=arms[0]
            if np.linalg.norm(arm[0]-loop[0])<.1:arm=arm[::-1]
            main=np.vstack([arm,stem[1:],q[::-1][1:]])
            routes=[item for k,item in enumerate(routes) if k not in (i,index)]
            routes.extend([(main,float(np.median([r,lr,ar]))),(bowl,lr)])
            caps[:]=[item for item in caps if item is not cap];break
    return routes


def restore_caps(paths,caps,mask):
    """Restore source-supported short arms after the main strokes are smooth."""
    if not caps:return paths
    boundary=np.concatenate([np.fliplr(q) for q in find_contours(mask,.5)])
    for q,r in caps:
        if min(LineString(sample_path(p,80)).distance(Point(q[0])) for p in paths)<r*.65:continue
        outward=unit(q[0]-q[-1]);tip=q[0]+outward*r
        tip=boundary[np.argmin(np.linalg.norm(boundary-tip,axis=1))]
        cap=boundary[np.linalg.norm(boundary-tip,axis=1)<r*.8]
        if len(cap)<4:continue
        anchor,tangent,error=line_fit(cap)
        if error.max()>.7:continue
        normal=np.array([-tangent[1],tangent[0]])
        if normal@outward<0:normal=-normal
        if normal@outward<.8:continue
        end=anchor-normal*r
        offsets=np.arange(-2*r,2*r+.25,.25)
        probes=end+offsets[:,None]*tangent
        inside=ndimage.map_coordinates(mask.astype(float),[probes[:,1],probes[:,0]],order=1,mode='constant')>.5
        mid=int(np.argmin(abs(offsets)));a=b=mid
        if not inside[mid]:continue
        while a>0 and inside[a-1]:a-=1
        while b<len(inside)-1 and inside[b+1]:b+=1
        if not 1.4*r<offsets[b]-offsets[a]<2.7*r:continue
        end+=(offsets[a]+offsets[b])/2*tangent
        candidates=[]
        for path in paths:
            for op,p in segments(path):
                if op=='l':
                    v=p[-1]-p[0];t=np.clip((end-p[0])@v/max(v@v,1e-9),0,1);point=p[0]+t*v
                    aligned=abs(unit(v)@normal)>.97 and abs((end-p[0])@tangent)<r*.4 and np.linalg.norm(v)>2*r
                else:
                    point=nearest_on_segment(op,p,end);aligned=False
                distance=np.linalg.norm(point-end)
                if distance<r*4:candidates.append((not aligned,distance,point,unit(v) if aligned else None))
        if not candidates:continue
        _,distance,start,axis=min(candidates,key=lambda c:c[:2])
        if axis is not None:end=start+((end-start)@axis)*axis
        probes=np.linspace(start,end,40)
        if np.min(ndimage.map_coordinates(mask.astype(float),[probes[:,1],probes[:,0]],order=1,mode='constant'))<.5:continue
        paths.append([['m',start.tolist()],['l',end.tolist()]])
    return paths


def join_terminal_loop_stems(routes,mask):
    """Continue a straight tail through a loop's aligned side; keep its bowl.

    This is determined by opposing pixel edges and graph connectivity, not by
    recognizing a letter. Curved sides and loops with multiple arms stay intact.
    """
    for index,(loop,r) in enumerate(routes):
        if np.linalg.norm(loop[0]-loop[-1])>1:continue
        arms=[(i,q,ar) for i,(q,ar) in enumerate(routes) if i!=index
              and np.linalg.norm(q[0]-q[-1])>1
              and min(np.linalg.norm(q[0]-loop[0]),np.linalg.norm(q[-1]-loop[0]))<.1]
        if len(arms)!=1:continue
        i,arm,ar=arms[0];fit=straight_route(arm,ar,mask)
        if fit is None:continue
        anchor,d=fit;normal=np.array([-d[1],d[0]])
        if np.linalg.norm(arm[0]-loop[0])<.1:arm=arm[::-1]
        inward=unit(arm[-1]-arm[0]);candidates=[]
        for q in (loop,loop[::-1]):
            residual=abs((q-anchor)@normal)
            departures=np.flatnonzero(residual>max(1.2,r*.35))
            j=int(departures[0]-1) if len(departures) else 0
            if j<3 or np.linalg.norm(q[j]-q[0])<max(8,4*r):continue
            if unit(q[j]-q[0])@inward<.97:continue
            # Stop before the bowl turns away, not at an arbitrary quarter-loop.
            if refine_line(np.vstack([arm,q[1:j+1]]),r,mask) is None:continue
            candidates.append((j,q))
        if len(candidates)!=1:continue
        j,q=candidates[0]
        main=np.vstack([arm,q[1:j+1]]);bowl=q[j:]
        routes=[item for k,item in enumerate(routes) if k not in (i,index)]
        routes.extend([(main,float(np.median([r,ar]))),(bowl,r)])
        return join_terminal_loop_stems(routes,mask)
    return routes


def angular_route(q,r,mask):
    """Recover sharp joins between long straight runs of one open stroke."""
    if np.linalg.norm(q[0]-q[-1])<1:return None
    p=centered_reference(q,r,mask)
    runs=straight_runs(p,max(12,4*r),.65)
    if len(runs)<2 or runs[0][0]>r or len(p)-1-runs[-1][1]>r:return None
    if any(b[0]-a[1]>2.1*r or a[3]@b[3]>.65 for a,b in zip(runs,runs[1:])):return None
    fits=[refine_line(p[a:b+1],r,mask) for a,b,_,_ in runs]
    if any(f is None for f in fits):return None
    a,d=fits[0];points=[a+((q[0]-a)@d)*d]
    for j,((a,da),(b,db)) in enumerate(zip(fits,fits[1:])):
        normals=np.array([[-da[1],da[0]],[-db[1],db[0]]])
        if abs(np.linalg.det(normals))<.2:return None
        corner=np.linalg.solve(normals,[normals[0]@a,normals[1]@b])
        gap=p[runs[j][1]:runs[j+1][0]+1]
        if np.min(np.linalg.norm(gap-corner,axis=1))>3*r:return None
        points.append(corner)
    a,d=fits[-1];points.append(a+((q[-1]-a)@d)*d)
    samples=np.vstack([np.linspace(a,b,50) for a,b in zip(points,points[1:])])
    if np.min(ndimage.map_coordinates(mask.astype(float),[samples[:,1],samples[:,0]],order=1,mode='constant'))<.5:return None
    return [['m',points[0].tolist()]]+[['l',p.tolist()] for p in points[1:]]


def continue_stem_routes(routes,mask):
    """Follow an almost straight stem across junctions before fitting its bowl.

    Skeleton junctions displace short connecting edges inside broad ink. Fit
    opposing source edges over the whole stem instead of smoothing each piece.
    Only a narrow, source-covered line is accepted; curved branches stay separate.
    """
    routes=list(routes);fits={}
    def supported(q,r):
        fit=refine_line(q,r,mask,tolerance=r*.65)
        if fit is None:return None
        a,d=fit;normal=np.array([-d[1],d[0]])
        if np.max(abs((q-a)@normal))>r:return None
        points=a+np.linspace(*sorted(((q[[0,-1]]-a)@d)),120)[:,None]*d
        if np.min(ndimage.map_coordinates(mask.astype(float),[points[:,1],points[:,0]],order=1,mode='constant'))<.5:return None
        return fit
    while True:
        nodes={}
        for i,(q,r) in enumerate(routes):
            if np.linalg.norm(q[0]-q[-1])<1:continue
            for end in (0,-1):nodes.setdefault(tuple(q[end]),[]).append((i,end))
        cyclic=set()
        for i,(q,_) in enumerate(routes):
            start,goal=tuple(q[0]),tuple(q[-1])
            if start==goal:continue
            pending=[start];seen={start}
            while pending:
                node=pending.pop()
                for k,end in nodes.get(node,[]):
                    if k==i:continue
                    other=tuple(routes[k][0][-1 if end==0 else 0])
                    if other==goal:cyclic.add(i);pending=[];break
                    if other not in seen:seen.add(other);pending.append(other)
        merged=False
        for key,arms in nodes.items():
            if len(arms)<2:continue
            options=[]
            for j,(ia,ea) in enumerate(arms):
                for ib,eb in arms[:j]:
                    # A cycle assembled from several angular edges (for
                    # example a triangular counter) must keep its corners.
                    if ia in cyclic or ib in cyclic:continue
                    qa,ra=routes[ia];qb,rb=routes[ib]
                    qa=qa if ea==-1 else qa[::-1];qb=qb if eb==0 else qb[::-1]
                    alignment=unit(qa[-1]-qa[0])@unit(qb[-1]-qb[0])
                    if alignment<.94:continue
                    straight_a=straight_route(qa,ra,mask);straight_b=straight_route(qb,rb,mask)
                    if straight_a is None and straight_b is None:continue
                    # Do not move the junction of an angular connecting stroke:
                    # its two straight runs already describe a deliberate corner.
                    angular_branch=False
                    for k,_ in arms:
                        if k in (ia,ib):continue
                        branch,br=routes[k]
                        if len(branch)<8*br:continue
                        runs=straight_runs(centered_reference(branch,br,mask),max(12,4*br),.65)
                        if any(a[3]@b[3]<.5 and b[0]-a[1]<5*br for a,b in zip(runs,runs[1:])):angular_branch=True;break
                    if angular_branch:continue
                    if straight_a is not None and straight_b is not None:
                        curved_branch=any(k not in (ia,ib) and len(routes[k][0])>4*routes[k][1]
                                          and straight_route(*routes[k],mask) is None for k,_ in arms)
                        if not curved_branch:continue
                    q=np.vstack([qa,qb[1:]]);r=min(ra,rb)
                    if np.linalg.norm(q[-1]-q[0])<6*r:continue
                    fit=supported(q,r)
                    if fit is not None:options.append((alignment,ia,ib,q,r,fit))
            if not options:continue
            _,ia,ib,q,r,fit=max(options,key=lambda v:v[0])
            routes=[item for i,item in enumerate(routes) if i not in (ia,ib)]+[(q,r)]
            fits[id(q)]=fit;merged=True;break
        if not merged:break
    for index,(loop,r) in enumerate(routes):
        if np.linalg.norm(loop[0]-loop[-1])>1:continue
        arms=[(i,q,ar) for i,(q,ar) in enumerate(routes) if i!=index
              and np.linalg.norm(q[0]-q[-1])>1
              and min(np.linalg.norm(q[0]-loop[0]),np.linalg.norm(q[-1]-loop[0]))<.1]
        if len(arms)!=1:continue
        i,arm,ar=arms[0]
        if np.linalg.norm(arm[0]-loop[0])<.1:arm=arm[::-1]
        inward=unit(arm[-1]-arm[0]);options=[]
        for q in (loop,loop[::-1]):
            p=centered_reference(q,r,mask,True)
            runs=straight_runs(p,max(12,4*r),.65)
            if not runs:continue
            a,b,_,_=runs[0]
            if a>3.5*r or b>len(p)*.5 or unit(p[b]-p[a])@inward<.94:continue
            j=int(np.argmin(np.linalg.norm(q-p[b],axis=1)))
            if j<3 or j>=len(q)-3:continue
            main=np.vstack([arm,q[1:j+1]]);radius=min(r,ar)
            fit=supported(main,radius)
            if fit is not None:options.append((main,radius,fit,q[j:]))
        if len(options)!=1:continue
        main,radius,fit,bowl=options[0]
        routes=[item for k,item in enumerate(routes) if k not in (i,index)]+[(main,radius),(bowl,r)]
        fits[id(main)]=fit
        # Re-scan after replacing the two routes; retain overrides for new stems.
        rest,other=continue_stem_routes(routes,mask)
        fits.update(other);return rest,fits
    return routes,fits


def terminal_branch(p,r,stem,mask):
    """Recover a shared cap hidden by the medial axis of overlapping strokes.

    Require the exposed edge to widen immediately from the cap. A real side
    branch leaves a narrow stretch of stem above it and must keep its junction.
    """
    ends=np.array([stem[0][1],stem[-1][-1]])
    index=int(np.argmin(np.linalg.norm(ends-p[0],axis=1)))
    cap=ends[index];axis=unit(ends[1-index]-cap)
    if not r<np.linalg.norm(cap-p[0])<5*r:return None
    j=int(2.5*r);end=p[j];chord=unit(end-cap)
    if chord@axis<.5:return None
    normal=np.array([axis[1],-axis[0]])
    if (end-cap)@normal<0:normal=-normal
    offsets=np.arange(0,3*r,.25);widths=[]
    for t in (0,.5,1):
        points=cap+t*r*axis+offsets[:,None]*normal
        inside=ndimage.map_coordinates(mask.astype(float),[points[:,1],points[:,0]],order=1,mode='constant')>.5
        exits=np.flatnonzero(~inside)
        if not len(exits):return None
        widths.append(offsets[exits[0]]/r)
    if not .65<widths[0]<1.4 or widths[1]-widths[0]<.1 or widths[2]-widths[0]<.3:return None
    # Only the exposed outside edge is reliable in the overlap. Follow that
    # edge and offset it by half the measured stroke width, then resume the
    # two-sided centre reference beyond the junction.
    normal=np.array([chord[1],-chord[0]])
    if normal@axis>0:normal=-normal
    steps=np.arange(r*.5,np.linalg.norm(end-cap)+1,1.)
    if len(steps)<4:return None
    anchors=cap+steps[:,None]*chord
    probes=anchors[:,None,:]+offsets[None,:,None]*normal
    inside=ndimage.map_coordinates(mask.astype(float),[probes[:,:,1],probes[:,:,0]],order=1,mode='constant')>.5
    if not np.all(inside[:,0]) or np.any(np.all(inside,axis=1)):return None
    exits=np.argmax(~inside,axis=1)
    edge=anchors+offsets[exits,None]*normal
    edge=ndimage.gaussian_filter1d(edge,max(1,r*.15),axis=0,mode='nearest')
    tangents=np.gradient(edge,axis=0)
    tangents/=np.maximum(np.linalg.norm(tangents,axis=1)[:,None],1e-9)
    normals=np.column_stack([tangents[:,1],-tangents[:,0]])
    if normals.mean(axis=0)@normal<0:normals=-normals
    reference=np.vstack([cap,edge-r*normals,p[j+1:]])
    return resample(reference,sigma=max(1,r*.15))


def branch_into_stem(q,r,stem,mask,end):
    """Recover the direction of a branch beyond its widened junction."""
    p=centered_reference(q if end==0 else q[::-1],r,mask)
    j=int(2.5*r)
    if len(p)<j+2*r:return None
    terminal=terminal_branch(p,r,stem,mask) if r>=2 else None
    if terminal is not None:
        fitted=cubic_fit(terminal if end==0 else terminal[::-1],max(1.1,r*.08))
        points=np.array(sample_path(fitted,120))
        if np.min(ndimage.map_coordinates(mask.astype(float),[points[:,1],points[:,0]],order=1,mode='constant'))>=.5:return fitted
    tangent=p[max(1,j-int(r*.6)):j+1]
    if len(tangent)<3:return None
    a,d,error=line_fit(tangent)
    if np.max(error)>max(1,r*.08):return None
    b=np.array(stem[0][1]);v=np.array(stem[1][1])-b;db=unit(v)
    normals=np.array([[-d[1],d[0]],[-db[1],db[0]]])
    if abs(np.linalg.det(normals))<.3:return None
    target=np.linalg.solve(normals,[normals[0]@a,normals[1]@b])
    old=nearest_on_segment('l',np.array([b,b+v]),q[end])
    shift=np.linalg.norm(target-old)
    if not .5*r<shift<2.5*r or not .03<(target-b)@v/(v@v)<.97:return None
    # The continuation must point back toward the stem and stay inside ink.
    if unit(p[j]-target)@unit(p[j]-p[j-int(r*.6)])<.95:return None
    reference=np.vstack([np.linspace(target,p[j],max(4,int(np.linalg.norm(p[j]-target)))),p[j+1:]])
    if end==-1:reference=reference[::-1]
    fitted=cubic_fit(reference,max(1.1,r*.12))
    points=np.array(sample_path(fitted,100))
    if np.min(ndimage.map_coordinates(mask.astype(float),[points[:,1],points[:,0]],order=1,mode='constant'))<.5:return None
    return fitted


def neon_centerline_paths(mask):
    """Fit illuminated tubes without the stem/crossbar recovery used for fonts."""
    routes,distance=skeleton_routes(mask)
    # At an acute reversal the medial axis has three arms: the two tube runs
    # and a short spur pointing into the tip. This is a bend, not a T junction.
    # Only collapse it when both long arms leave in the same direction; real
    # crossbars and crossings have opposed arms and remain connected as drawn.
    while True:
        nodes={}
        for i,(q,r) in enumerate(routes):
            for end in (0,-1):nodes.setdefault(tuple(q[end]),[]).append((i,end))
        merged=False
        for key,arms in nodes.items():
            if len(arms)!=3 or len({i for i,_ in arms})!=3:continue
            outgoing=[(i,q if end==0 else q[::-1],r) for i,end in arms for q,r in [routes[i]]]
            outgoing.sort(key=lambda item:LineString(item[1]).length)
            i,cap,r=outgoing[0];j,a,ra=outgoing[1];k,b,rb=outgoing[2]
            radius=float(np.median([r,ra,rb]));length=LineString(cap).length
            if len(nodes[tuple(cap[-1])])!=1 or length>radius*6:continue
            if min(LineString(a).length,LineString(b).length)<max(length*2,radius*8):continue
            reach=max(6,int(radius*3))
            da=unit(a[min(reach,len(a)-1)]-a[0]);db=unit(b[min(reach,len(b)-1)]-b[0])
            tip=unit(cap[-1]-cap[0])
            if da@db<.45 or max(da@tip,db@tip)>-.3:continue
            # A genuine short Y stem can have the same graph. The axes of a
            # bend converge towards its tip; Y arms converge at the junction.
            normals=[];targets=[]
            for arm in (a,b):
                anchor,d,_=line_fit(arm[reach:reach*2])
                normal=np.array([-d[1],d[0]]);normals.append(normal);targets.append(normal@anchor)
            if abs(np.linalg.det(normals))<.1:continue
            intersection=np.linalg.solve(normals,targets)
            if (intersection-cap[0])@tip<radius*.8 or np.linalg.norm(intersection-cap[-1])>length*.9:continue
            # Replace the fork, including its off-centre junction, with a single
            # rounded turnaround through the measured tip. Trim only locally.
            trim=max(3,int(radius*2))
            q=np.vstack([a[trim:][::-1],cap[-1],b[trim:]])
            routes=[item for n,item in enumerate(routes) if n not in (i,j,k)]+[(q,radius)]
            merged=True;break
        if not merged:break
    routes,continuous=continue_crossing_routes(routes,mask)
    routes+=continuous
    continuous_ids={id(q) for q,r in continuous}
    paths=[];fitted_routes=[]
    for q,r in routes:
        closed=np.linalg.norm(q[0]-q[-1])<1
        reference=resample(q,closed,sigma=max(1.2,r*.3)) if id(q) in continuous_ids else centered_reference(q,r,mask,closed)
        # Fit each tube as a continuous curve. Detecting many short "straight"
        # stems in a pixel skeleton otherwise produces flat spots and kinks.
        tolerance=max(.8,r*.18)
        if closed:
            tangent=unit(reference[min(3,len(reference)-1)]-reference[max(0,len(reference)-4)])
            path=ellipse_path(reference,tolerance) or cubic_fit(reference,tolerance,tangent,-tangent)
        else:path=cubic_fit(reference,tolerance)
        if closed and path[-1][0]!='h':path.append(['h'])
        if len(path)>1:paths.append(path);fitted_routes.append((q,r,path))
    # Keep retraced branches attached when fitting moves the through curve
    # slightly away from its sampled reference.
    for q,r,path in fitted_routes:
        if id(q) not in continuous_ids or path[-1][0]=='h':continue
        for end,point in ((0,q[0]),(-1,q[-1])):
            owners=[owner for other,_,owner in fitted_routes if owner is not path and len(other)>2
                    and np.min(np.linalg.norm(other[1:-1]-point,axis=1))<.1]
            if not owners:continue
            target=min((nearest_on_segment(op,p,point) for owner in owners for op,p in segments(owner)),key=lambda p:np.linalg.norm(p-point))
            if np.linalg.norm(target-point)>max(2,r):continue
            command=path[end];delta=target-np.array(command[-1]);command[-1]=target.tolist()
            if end==0 and path[1][0]=='c':path[1][1]=(np.array(path[1][1])+delta).tolist()
            elif end==-1 and command[0]=='c':command[-2]=(np.array(command[-2])+delta).tolist()
    return paths,distance,routes


def centerline_paths(mask):
    caps=[];routes,distance=skeleton_routes(mask,caps)
    routes,continuous=continue_crossing_routes(routes,mask)
    loop_junctions={tuple(q[0]) for q,r in routes if np.linalg.norm(q[0]-q[-1])<1}
    routes=join_loop_stems(routes,caps)
    routes=join_terminal_loop_stems(routes,mask)
    routes,stem_fits=continue_stem_routes(routes,mask)
    routes+=continuous
    continuous_ids={id(q) for q,r in continuous}
    edges=[];path_edges=[];curves=[];curve_ends={};route_paths=[];structural_stems=set()
    def add_curve(path,q):
        index=len(curves);curves.append(path)
        route_paths.append((q,path))
        for key,end in ((tuple(q[0]),0),(tuple(q[-1]),-1)):curve_ends.setdefault(key,[]).append((index,end))
    for q,r in routes:
        closed=np.linalg.norm(q[0]-q[-1])<1
        if id(q) in continuous_ids:
            reference=resample(q,closed,sigma=max(1.2,r*.3))
            tangent=unit(reference[3]-reference[-4]) if closed else None
            path=cubic_fit(reference,max(.8,r*.18),tangent,-tangent if closed else None)
            if closed:path.append(['h'])
            add_curve(path,q);continue
        if closed:
            ellipse=ellipse_path(q,max(1.2,r*.12))
            if ellipse:add_curve(ellipse,q);continue
        whole_fit=stem_fits.get(id(q)) if not closed else None
        if whole_fit is None and not closed:whole_fit=straight_route(q,r,mask)
        if whole_fit is not None:
            path_edges.append([len(edges)])
            edges.append(dict(q=q,r=r,fit=whole_fit,a=tuple(q[0]),b=tuple(q[-1]),structural=id(q) in stem_fits))
            continue
        simplified=np.array(LineString(q).simplify(max(1.2,r*.85)).coords)
        indices=[int(np.argmin(np.linalg.norm(q-p,axis=1))) for p in simplified]
        indices[-1]=len(q)-1
        fits=[]
        for a,b in zip(indices,indices[1:]):
            chunk=q[a:b+1]
            if len(chunk)<3:fits.append(None);continue
            fits.append(refine_line(chunk,r,mask))
        # The skeleton can round a sharp joint into a tiny extra RDP segment.
        # Pool source-supported collinear runs before deciding it is a curve.
        j=0
        while j<len(fits)-1:
            if fits[j] is not None and fits[j+1] is not None and abs(fits[j][1]@fits[j+1][1])>.98:
                merged=refine_line(q[indices[j]:indices[j+2]+1],r,mask)
                if merged is not None:
                    fits[j:j+2]=[merged];indices.pop(j+1)
                    continue
            j+=1
        simplified=q[indices]
        # A curved stroke must not be turned into a polygon just because RDP has vertices.
        directions=np.diff(simplified,axis=0)
        spans=np.linalg.norm(directions,axis=1)
        directions/=np.maximum(spans[:,None],1e-9)
        gentle_turn=any(a@b>.65 for a,b in zip(directions,directions[1:]))
        short_bend=any(a@b>-.2 and min(spans[i:i+2])<6*r
                       for i,(a,b) in enumerate(zip(directions,directions[1:])))
        if closed or gentle_turn or short_bend or not fits or any(fit is None for fit in fits):
            if len(routes)==1 and not closed:
                angular=angular_route(q,r,mask)
                if angular is not None:add_curve(angular,q);continue
            path,extras=reconstruct_route(q,r,mask)
            add_curve(path,q)
            for extra in extras:
                idx=len(curves);curves.append(extra)
                for end in (q[0],q[-1]):
                    if np.linalg.norm(np.array(extra[0][1])-end)<r*.4:
                        curve_ends.setdefault(tuple(end),[]).append((idx,0))
            continue
        ids=[]
        for a,b,fit in zip(indices,indices[1:],fits):
            ids.append(len(edges));edges.append(dict(q=q[a:b+1],r=r,fit=fit,a=tuple(q[a]),b=tuple(q[b])))
        path_edges.append(ids)
    nodes={}
    for i,edge in enumerate(edges):
        for end in ('a','b'):nodes.setdefault(edge[end],[]).append((i,end))
    # At T junctions, pool nearly collinear arms before intersecting with the crossbar.
    for key,connected in nodes.items():
        if len(connected)<2:continue
        pairs=[]
        for j,(a,_) in enumerate(connected):
            for b,_ in connected[:j]:
                cosine=abs(edges[a]['fit'][1]@edges[b]['fit'][1]);pairs.append((cosine,a,b))
        cosine,a,b=max(pairs)
        if cosine<.94:continue
        qa,qb=edges[a]['q'],edges[b]['q']
        qa=qa if tuple(qa[-1])==key else qa[::-1]
        qb=qb if tuple(qb[0])==key else qb[::-1]
        fit=refine_line(np.vstack([qa,qb[1:]]),max(edges[a]['r'],edges[b]['r']),mask)
        if fit is None:
            aa,da=edges[a]['fit'];ab,db=edges[b]['fit']
            if da@db<0:db=-db
            wa,wb=len(qa),len(qb)
            fit=((aa*wa+ab*wb)/(wa+wb),unit(da*wa+db*wb))
        edges[a]['fit']=edges[b]['fit']=fit
    node_points={}
    for key,connected in nodes.items():
        point=np.array(key,float)
        # A merged stem still owns its former junctions. Include its fitted
        # axis when intersecting a straight branch, and never treat that
        # branch endpoint as a free cap.
        connected=connected+[(i,'interior') for i,edge in enumerate(edges) if edge.get('structural')
                             and key not in (edge['a'],edge['b'])
                             and np.min(np.linalg.norm(edge['q'][1:-1]-point,axis=1))<.1]
        radius=max(edges[i]['r'] for i,_ in connected)
        normals=[];targets=[]
        for i,_ in connected:
            anchor,direction=edges[i]['fit'];normal=np.array([-direction[1],direction[0]])
            normals.append(normal);targets.append(normal@anchor)
        if len(connected)>1 and np.linalg.matrix_rank(normals)==2:
            fitted=np.linalg.lstsq(normals,targets,rcond=None)[0]
        else:
            anchor,direction=edges[connected[0][0]]['fit'];fitted=anchor+((point-anchor)@direction)*direction
        # A diagonal flat cap can put the projected skeleton tip outside the
        # ink. Move inward along the fitted axis before locating the real cap;
        # falling back to the off-axis skeleton point would recreate a kink.
        if len(connected)==1 and key not in curve_ends and np.linalg.norm(fitted-point)<=radius*2.4:
            i,end=connected[0];edge=edges[i];direction=edge['fit'][1].copy()
            inward=edge['q'][-1]-edge['q'][0]
            if end=='b':inward=-inward
            if direction@inward<0:direction=-direction
            probes=fitted+np.arange(0,radius*3+.5,.5)[:,None]*direction
            inside=ndimage.map_coordinates(mask.astype(float),[probes[:,1],probes[:,0]],order=1,mode='constant')>.5
            entries=np.flatnonzero(inside)
            if len(entries):fitted=probes[entries[0]]
        # Bounded extrapolation; curves or unrelated close strokes are never joined.
        x,y=np.round(fitted).astype(int)
        reach=4 if any(end=='interior' for _,end in connected) else 2.4
        if np.linalg.norm(fitted-point)>radius*reach or not (0<=y<mask.shape[0] and 0<=x<mask.shape[1] and mask[y,x]):
            fitted=point
            # Acute joins may intersect far beyond the supported source run.
            # Keep the junction on its continuous stem even when extrapolating
            # the branch axis was rejected; the old skeleton node is off-axis.
            for i,end in connected:
                if end!='interior':continue
                anchor,direction=edges[i]['fit'];candidate=anchor+((point-anchor)@direction)*direction
                x,y=np.round(candidate).astype(int)
                if np.linalg.norm(candidate-point)<=radius and 0<=y<mask.shape[0] and 0<=x<mask.shape[1] and mask[y,x]:
                    fitted=candidate;break
        if len(connected)==1 and key not in curve_ends:
            i,end=connected[0];edge=edges[i];anchor,direction=edge['fit']
            inward=edge['q'][-1]-edge['q'][0]
            if end=='b':inward=-inward
            if direction@inward>0:direction=-direction
            # Stop half a stroke width before the flat cap, avoiding corner whiskers.
            distances=np.arange(0,radius*3+.5,.5);probes=fitted+distances[:,None]*direction
            values=ndimage.map_coordinates(mask.astype(float),[probes[:,1],probes[:,0]],order=1,mode='constant')>.5
            exits=np.flatnonzero(~values)
            if len(exits):fitted=fitted+(distances[exits[0]]-radius)*direction
        node_points[key]=fitted.tolist()
    for key,ends in curve_ends.items():
        if key not in node_points:continue
        for index,end in ends:
            path=curves[index]
            command=path[0] if end==0 else path[-2] if path[-1][0]=='h' else path[-1]
            old=np.array(command[-1]);new=np.array(node_points[key]);delta=new-old
            command[-1]=new.tolist()
            if end==0 and len(path)>1 and path[1][0]=='c':path[1][1]=(np.array(path[1][1])+delta).tolist()
            elif end==-1 and command[0]=='c':command[-2]=(np.array(command[-2])+delta).tolist()
    for ids in path_edges:
        path=[['m',node_points[edges[ids[0]]['a']]]]
        path.extend(['l',node_points[edges[i]['b']]] for i in ids)
        # Validate against foreground. Reject reconstruction if it leaves the stroke.
        samples=[]
        for a,b in zip(path,path[1:]):samples.extend(np.linspace(a[-1],b[-1],50))
        q=np.array(samples)
        outside=ndimage.map_coordinates(mask.astype(float),[q[:,1],q[:,0]],order=1,mode='constant')<.2
        if outside.mean()>.02:
            source=np.vstack([edges[i]['q'] for i in ids]);radius=edges[ids[0]]['r']
            angular=angular_route(source,radius,mask) if len(routes)==1 else None
            path=angular if angular is not None else smooth_path(source,max(1,radius*.055))
            # The fallback is a curve again, so its original junctions must
            # follow any stem that was fitted away from the pixel skeleton.
            for key,end in ((edges[ids[0]]['a'],0),(edges[ids[-1]]['b'],-1)):
                curve_ends.setdefault(key,[]).append((len(curves),end))
        curves.append(path)
        if len(ids)==1 and edges[ids[0]].get('structural'):structural_stems.add(id(path))
        route_paths.append((np.vstack([edges[i]['q'] for i in ids]),path))
    # A bowl can meet the middle of a continuous stem. Reattach its endpoints
    # to the fitted stem, not to the old pixel junction that has just moved.
    for key,ends in curve_ends.items():
        point=np.array(key)
        owners=[(q,path) for q,path in route_paths if len(q)>2 and np.min(np.linalg.norm(q[1:-1]-point,axis=1))<.1
                and min(np.linalg.norm(q[0]-point),np.linalg.norm(q[-1]-point))>.1]
        if not owners:continue
        target=min((nearest_on_segment(op,p,point) for _,owner in owners for op,p in segments(owner)),key=lambda p:np.linalg.norm(p-point))
        if np.linalg.norm(target-point)>max(2,distance[int(point[1]),int(point[0])]):continue
        for index,end in ends:
            path=curves[index]
            stems=[owner for q,owner in owners if id(owner) in structural_stems and len(owner)==2 and owner[1][0]=='l']
            sources=[q for q,p in route_paths if p is path]
            if key not in loop_junctions and len(stems)==1 and sources and path[-1][0]!='h':
                q=sources[0];radius=float(np.median(distance[q[:,1].astype(int),q[:,0].astype(int)]))
                rebuilt=branch_into_stem(q,radius,stems[0],mask,end)
                if rebuilt is not None:path[:]=rebuilt;continue
            command=path[0] if end==0 else path[-2] if path[-1][0]=='h' else path[-1]
            delta=target-np.array(command[-1]);command[-1]=target.tolist()
            if end==0 and len(path)>1 and path[1][0]=='c':path[1][1]=(np.array(path[1][1])+delta).tolist()
            elif end==-1 and command[0]=='c':command[-2]=(np.array(command[-2])+delta).tolist()
    curves=[p for p in curves if len(p)>1]
    # Extra stem recovery may meet an existing route. Remove only a complete
    # duplicate straight segment; leave intentional crossing points untouched.
    unique=[]
    for i,path in enumerate(curves):
        if len(path)==2 and path[1][0]=='l':
            line=LineString(sample_path(path))
            others=[LineString(sample_path(other,60)).buffer(.15) for j,other in enumerate(curves) if j!=i and (len(other)>2 or j<i)]
            if any(area.covers(line) for area in others):continue
        unique.append(path)
    return join_straight_paths(restore_caps(unique,caps,mask)),distance,routes
