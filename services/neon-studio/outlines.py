"""Local raster outlines: Potrace polygons/curves plus source-supported lines.

Only used for Double Line. No glyph recognition, logo coordinates or templates.
Potrace works at pixel corners; this app uses pixel centres, hence the -.5 offset.
"""
from copy import deepcopy

import numpy as np
import potrace
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Polygon

from geometry import sample_path
from reconstruction import cross, unit


def _line_points(a,b):
    return np.linspace(a,b,max(3,int(np.linalg.norm(b-a)*3)+1))


def _polish(path,tree):
    def error(q):return float(tree.query(q)[0].max())
    out=[deepcopy(path[0])];a=np.array(path[0][1])
    for original in path[1:]:
        if original[0]=='h':continue
        cmd=deepcopy(original);b=np.array(cmd[-1]);d=b-a
        if cmd[0]=='c':
            q=np.array(sample_path([['m',a.tolist()],cmd],60))
            # Remove sub-pixel bows only when the raster supports the chord.
            if np.linalg.norm(d)>2 and np.max(abs(cross(unit(d),q-a)))<.7 and error(_line_points(a,b))<.8:
                cmd=['l',b.tolist()]
            elif min(abs(d))>=3:
                # Recover squared caps that curve fitting inadvertently rounded.
                # Real curved corners fail the source-boundary distance check.
                for corner in (np.array([a[0],b[1]]),np.array([b[0],a[1]])):
                    elbow=np.vstack([_line_points(a,corner),_line_points(corner,b)])
                    if error(elbow)<.8 and LineString(q).hausdorff_distance(LineString(elbow))<2:
                        out.append(['l',corner.tolist()]);cmd=['l',b.tolist()];break
        out.append(cmd);a=b
    starts=np.array([out[0][1]]+[c[-1] for c in out[1:]],float)
    vertices=starts.copy();proposals={}
    for i,cmd in enumerate(out[1:]):
        if cmd[0]!='l':continue
        a,b=starts[i],starts[i+1];d=b-a
        if np.linalg.norm(d)<5:continue
        axis=int(np.argmin(abs(d)))
        if abs(d[axis])>1.5:continue
        q=_line_points(a,b);_,ids=tree.query(q)
        coord=float(np.median(tree.data[ids,axis]));new=q.copy();new[:,axis]=coord
        if error(new)>.8:continue
        for k in (i,i+1):proposals[(k,axis)]=coord
    for (i,axis),coord in proposals.items():vertices[i,axis]=coord
    if np.linalg.norm(starts[0]-starts[-1])<1e-6:
        for axis in (0,1):
            coord=proposals.get((0,axis),proposals.get((len(vertices)-1,axis),vertices[0,axis]))
            vertices[0,axis]=vertices[-1,axis]=coord
    result=[['m',vertices[0].tolist()]]
    for i,cmd in enumerate(out[1:]):
        if cmd[0]=='c':
            cmd[1]=(np.array(cmd[1])+vertices[i]-starts[i]).tolist()
            cmd[2]=(np.array(cmd[2])+vertices[i+1]-starts[i+1]).tolist()
        cmd[-1]=vertices[i+1].tolist()
        if cmd[0]=='l' and result[-1][0]=='l':
            a=np.array(result[-2][-1]);b=np.array(result[-1][-1]);c=vertices[i+1]
            if np.linalg.norm(c-a)>0 and abs(cross(unit(c-a),b-a))<.05 and (b-a)@(c-b)>=0:
                result[-1]=cmd;continue
        result.append(cmd)
    if len(result)>3 and result[1][0]==result[-1][0]=='l':
        a=np.array(result[-2][-1]);b=np.array(result[0][1]);c=np.array(result[1][-1])
        if np.linalg.norm(np.array(result[-1][-1])-b)<1e-6 and abs(cross(unit(c-a),b-a))<.05 and (b-a)@(c-b)>=0:
            result[0]=['m',a.tolist()];result.pop()
    result.append(['h'])
    before=LineString(sample_path(path,100));after=LineString(sample_path(result,100))
    # Keep topology and bound the correction if several adjacent edits interact.
    if before.hausdorff_distance(after)>2 or (Polygon(before).is_valid and not Polygon(after).is_valid):
        return path
    return result


def trace_outlines(mask,contours):
    tree=cKDTree(np.concatenate(contours))
    result=[]
    for curve in potrace.Bitmap(~mask).trace(turdsize=0,alphamax=1.0,opttolerance=.2):
        point=lambda p:[float(p.x)-.5,float(p.y)-.5]
        path=[['m',point(curve.start_point)]]
        for segment in curve:
            if segment.is_corner:path.extend([['l',point(segment.c)],['l',point(segment.end_point)]])
            else:path.append(['c',point(segment.c1),point(segment.c2),point(segment.end_point)])
        path.append(['h'])
        result.append(_polish(path,tree))
    return result
