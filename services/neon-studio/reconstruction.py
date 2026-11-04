"""Sparse line/cubic reconstruction in source pixels, without glyph templates.

Curve fitting uses tangent-constrained least squares with Newton parameter
refinement (Schneider's Graphics Gems fitting approach). Pixel stair steps are
not corners: straight runs and sustained changes of direction supply anchors.
"""
import numpy as np
from scipy import ndimage
from shapely.geometry import LineString


def cross(a,b):
    return a[...,0]*b[...,1]-a[...,1]*b[...,0]


def unit(v):
    return v/max(np.linalg.norm(v),1e-12)


def resample(q,closed=False,sigma=1):
    q=np.asarray(q,float)
    ds=np.r_[0,np.cumsum(np.linalg.norm(np.diff(q,axis=0),axis=1))]
    if ds[-1]<1:return q
    t=np.linspace(0,ds[-1],max(4,int(ds[-1])+1))
    p=np.column_stack([np.interp(t,ds,q[:,a]) for a in (0,1)])
    if closed:
        p=p[:-1];p=ndimage.gaussian_filter1d(p,sigma,axis=0,mode='wrap')
        return np.vstack([p,p[0]])
    p=ndimage.gaussian_filter1d(p,sigma,axis=0,mode='nearest')
    p[0]=q[0];p[-1]=q[-1]
    return p


def cubic_fit(q,tolerance=1,t0=None,t1=None):
    """Fit a smooth run; every recursive join shares one tangent."""
    q=np.asarray(q,float)
    if len(q)<2:return []
    def tangent(p,at_end=False):
        n=min(7,len(p)-1)
        return unit(p[-n-1]-p[-1] if at_end else p[n]-p[0])
    out=[['m',q[0].tolist()]]
    def fit(p,left,right,level=0):
        chord=p[-1]-p[0];span=np.linalg.norm(chord)
        if len(p)<3:
            # A cubic preserves prescribed tangency even for a short join.
            out.append(['c',(p[0]+left*span/3).tolist(),(p[-1]+right*span/3).tolist(),p[-1].tolist()]);return
        if span>0:
            error=np.abs(cross(chord,p-p[0]))/span
            # A line is safe only when it preserves both prescribed tangents.
            # "Nearly" aligned creates visible stops between fitted curves.
            if error.max()<min(.45,tolerance*.45) and left@unit(chord)>1-1e-8 and right@unit(-chord)>1-1e-8:
                out.append(['l',p[-1].tolist()]);return
        ds=np.r_[0,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))]
        if ds[-1]<1e-8:return
        u=ds/ds[-1];best=None
        for _ in range(10):
            v=1-u;b0=v**3;b1=3*v*v*u;b2=3*v*u*u;b3=u**3
            mat=np.stack([b1[:,None]*left,b2[:,None]*right],axis=-1).reshape(-1,2)
            rhs=(p-(b0+b1)[:,None]*p[0]-(b2+b3)[:,None]*p[-1]).reshape(-1)
            alpha=np.linalg.lstsq(mat,rhs,rcond=None)[0]
            if np.any(alpha<ds[-1]*1e-4):alpha[:]=span/3
            alpha=np.minimum(alpha,ds[-1])
            a=p[0]+alpha[0]*left;b=p[-1]+alpha[1]*right
            value=b0[:,None]*p[0]+b1[:,None]*a+b2[:,None]*b+b3[:,None]*p[-1]
            residual=value-p;errors=np.linalg.norm(residual,axis=1)
            index=int(np.argmax(errors))
            if best is None or errors[index]<best[0]:best=(errors[index],index,a,b)
            if errors[index]<=tolerance:
                sample=np.linspace(0,1,81)[:,None]
                dense=(1-sample)**3*p[0]+3*(1-sample)**2*sample*a+3*(1-sample)*sample**2*b+sample**3*p[-1]
                if LineString(p).hausdorff_distance(LineString(dense))<=tolerance*1.1:
                    out.append(['c',a.tolist(),b.tolist(),p[-1].tolist()]);return
            d1=3*v[:,None]**2*(a-p[0])+6*(v*u)[:,None]*(b-a)+3*u[:,None]**2*(p[-1]-b)
            d2=6*v[:,None]*(b-2*a+p[0])+6*u[:,None]*(p[-1]-2*b+a)
            denom=(d1*d1+residual*d2).sum(axis=1)
            update=u-(residual*d1).sum(axis=1)/np.where(abs(denom)>1e-9,denom,1)
            update=np.clip(update,0,1);update[0]=0;update[-1]=1
            if np.any(np.diff(update)<=0):break
            u=update
        split=max(1,min(len(p)-2,best[1]))
        if level>16:split=len(p)//2
        # Estimate a stable tangent across several pixels, not one staircase step.
        n=min(4,split,len(p)-split-1)
        middle=unit(p[split+n]-p[split-n])
        fit(p[:split+1],left,-middle,level+1)
        fit(p[split:],middle,right,level+1)
    fit(q,unit(t0) if t0 is not None else tangent(q),unit(t1) if t1 is not None else tangent(q,True))
    return out


def straight_runs(q,min_span=18,error=.55):
    """Find long, supported lines; a short chord on an arc is not a stem."""
    q=np.asarray(q,float);n=len(q);candidates=[]
    step=max(2,int(min_span/5))
    for a in range(0,max(1,n-int(min_span)),step):
        b=min(n-1,a+int(min_span))
        best=None
        while b<n:
            p=q[a:b+1];anchor=p.mean(axis=0)
            _,_,v=np.linalg.svd(p-anchor,full_matrices=False);d=v[0]
            if np.max(np.abs((p-anchor)@v[1]))>error:break
            if d@(p[-1]-p[0])<0:d=-d
            best=(a,b,anchor,d)
            b+=step
        if best is not None and np.linalg.norm(q[best[1]]-q[a])>=min_span*.9:candidates.append(best)
    accepted=[]
    for item in sorted(candidates,key=lambda c:c[1]-c[0],reverse=True):
        a,b,anchor,d=item
        if any(a<other[1] and b>other[0] for other in accepted):continue
        # Recover the handful of points skipped by the coarse seed scan.
        while a>0 and abs(cross(d,q[a-1]-anchor))<=error:a-=1
        while b<n-1 and abs(cross(d,q[b+1]-anchor))<=error:b+=1
        if any(a<other[1] and b>other[0] for other in accepted):continue
        accepted.append((a,b,anchor,d))
    return sorted(accepted,key=lambda c:c[0])


def fit_boundary(q,tolerance=1):
    """Reconstruct an outline with image-supported corners and smooth spans."""
    original=np.asarray(q,float);closed=np.linalg.norm(original[0]-original[-1])<1
    p=resample(original,closed,sigma=.8)
    # RDP supplies candidate corners only. Require persistent incoming/outgoing
    # directions over multiple pixels to distinguish corners from raster noise.
    polygon=np.array(LineString(original).simplify(max(.9,tolerance*.8)).coords)
    corners=[]
    for i in range(1,len(polygon)-1):
        a=polygon[i]-polygon[i-1];b=polygon[i+1]-polygon[i]
        if min(np.linalg.norm(a),np.linalg.norm(b))<3:continue
        if unit(a)@unit(b)<.65:
            j=int(np.argmin(np.linalg.norm(p-polygon[i],axis=1)))
            corners.append(j);p[j]=polygon[i]
    cuts=sorted(set([0,*corners,len(p)-1]))
    if closed and len(cuts)==2:
        n=len(p)-1;cuts=[0,n//4,n//2,3*n//4,n]
    path=[]
    for a,b in zip(cuts,cuts[1:]):
        if b<=a:continue
        run=p[a:b+1];chord=run[-1]-run[0];span=np.linalg.norm(chord)
        # Pixel stair steps at corner endpoints can tilt the cubic's tangents
        # and bow a long straight boundary. Accept its chord only when the
        # entire run stays within half a source pixel and travels forwards.
        if span>=24 and np.max(np.abs(cross(chord,run-run[0])))/span<=.55 and np.min(np.diff(run@unit(chord)))>=-.1:
            part=[['m',run[0].tolist()],['l',run[-1].tolist()]]
        else:
            part=cubic_fit(run,tolerance)
        path.extend(part if not path else part[1:])
    if closed:path.append(['h'])
    return path
