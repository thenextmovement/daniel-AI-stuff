"""On-demand, physical-unit screening; never a supplier manufacturing approval."""
import math
import numpy as np
from shapely.geometry import LineString
from shapely import STRtree


def normalize_dot(item, scale):
    from geometry import path_bounds, path_length, KAPPA
    # Only semantically identified dots, never arbitrary small logo squares.
    if item.get('role')!='dot' or '~' in item.get('key',''):return item
    x0,y0,x1,y1=path_bounds(item['commands']);cx=(x0+x1)/2
    if item.get('mode',item.get('key','').split(':')[0])=='single':
        height=max(20/scale,y1-y0)
        commands=[['m',[cx,y1]],['l',[cx,y1-height]]]
    else:
        r=max((x1-x0)/2,(y1-y0)/2);cy=y1-r;k=KAPPA*r
        commands=[['m',[cx+r,cy]],['c',[cx+r,cy+k],[cx+k,cy+r],[cx,cy+r]],
                  ['c',[cx-k,cy+r],[cx-r,cy+k],[cx-r,cy]],
                  ['c',[cx-r,cy-k],[cx-k,cy-r],[cx,cy-r]],
                  ['c',[cx+k,cy-r],[cx+r,cy-k],[cx+r,cy]],['h']]
    return {**item,'commands':commands,'length':path_length(commands)}


def inspect(drawing, profile=None):
    from geometry import segments, sample_path, path_length
    from uv_print import subpaths
    supplied=profile or {}
    values={}
    for key,default,low,high in [('bendRadius',25,1,200),('spacing',2,0,30),('cutLength',20,1,200)]:
        value=supplied.get(key,default)
        if type(value) not in (int,float) or not math.isfinite(value) or not low<=value<=high:
            raise ValueError('Ungültiger Fertigungswert: '+key)
        values[key]=float(value)
    tube=drawing['settings']['tube'];required=tube+values['spacing']
    radii=[];short=[];corners=0;lines=[];names=[];dots=[];local=[]
    for i,path in enumerate(drawing['paths']):
        name=drawing['names'][i]
        dot=drawing.get('pathRoles',['stroke']*len(drawing['paths']))[i]=='dot'
        for part in subpaths(path):
            length=path_length(part)
            if length<values['cutLength']-.01:short.append({'name':name,'length':round(length,2)})
            if length<.0001:continue
            line=LineString(sample_path(part,96));lines.append(line);names.append(name);dots.append(dot)
            curves=list(segments(part));tangents=[]
            for op,p in curves:
                differences=np.diff(p,axis=0)
                nonzero=[v for v in differences if np.linalg.norm(v)>1e-8]
                if nonzero:tangents.append((p[0],p[-1],nonzero[0],nonzero[-1]))
                if op!='c':continue
                t=np.linspace(0,1,257)[:,None];a,b,c=differences
                first=3*(1-t)**2*a+6*(1-t)*t*b+3*t*t*c
                second=6*(1-t)*(b-a)+6*t*(c-b)
                speed=np.linalg.norm(first,axis=1);cross=np.abs(first[:,0]*second[:,1]-first[:,1]*second[:,0])
                valid=(speed>1e-7)&(cross>1e-9)
                if valid.any():
                    radius=float(np.min(speed[valid]**3/cross[valid]))
                    if dot:
                        if radius<values['bendRadius']:local.append(f'{name}: Kreisradius kleiner als der Profilwert {values["bendRadius"]:g} mm. Punktform und lokale Fertigung prüfen.')
                    else:radii.append((radius,name))
            joins=list(zip(tangents,tangents[1:]))
            if part[-1][0]=='h' and tangents:joins.append((tangents[-1],tangents[0]))
            for a,b in joins:
                if np.linalg.norm(a[1]-b[0])>.01:continue
                cosine=np.dot(a[3],b[2])/(np.linalg.norm(a[3])*np.linalg.norm(b[2]))
                if cosine<math.cos(math.radians(15)):corners+=1
    minimum_radius=min(radii,default=(None,''))
    spacing=[];junctions=0
    tree=STRtree(lines)
    for i,line in enumerate(lines):
        for j in tree.query(line.buffer(required)):
            if int(j)<=i:continue
            distance=line.distance(lines[int(j)])
            if distance<.1:junctions+=1
            elif dots[i] or dots[int(j)]:
                if distance<required:local.append('Punktabstand lokal prüfen: '+names[i]+' / '+names[int(j)]+f' ({distance:.2f} mm Mitte–Mitte).')
            else:spacing.append((distance,names[i]+' / '+names[int(j)]))
    minimum_spacing=min(spacing,default=(None,''))
    factors=[1.]
    reasons=[]
    if minimum_radius[0] is not None and minimum_radius[0]<values['bendRadius']:
        factors.append(values['bendRadius']/max(.001,minimum_radius[0]))
        reasons.append('Engste Kurve: '+minimum_radius[1]+f' (Radius {minimum_radius[0]:.2f} mm).')
    if minimum_spacing[0] is not None and minimum_spacing[0]<required:
        factors.append(required/minimum_spacing[0])
        reasons.append('Engster Linienabstand: '+minimum_spacing[1]+f' ({minimum_spacing[0]:.2f} mm Mitte–Mitte).')
    # Acrylic padding stays fixed while the motif scales. Never scale padding.
    s=drawing['settings'];gaps=s.get('gapSides',{});padding=gaps.get('left',s['gap'])+gaps.get('right',s['gap'])
    proposed=math.ceil(((drawing['width']-padding)*max(factors)+padding)/50)*50
    spacing_factor=max(1,required/minimum_spacing[0]) if minimum_spacing[0] is not None else 1
    spacing_width=math.ceil(((drawing['width']-padding)*spacing_factor+padding)/50)*50
    warnings=['Profilwerte sind Annahmen, keine bestätigte Lieferantenvorgabe. Mindestgröße ist eine geometrische Orientierung, keine Fertigungsfreigabe.',
              'Abstand wird zwischen getrennten Pfaden geprüft. Selbstannäherungen innerhalb eines Pfads und Anschlüsse müssen zusätzlich geprüft werden.']
    if corners:warnings.append(f'{corners} scharfe Richtungswechsel: abrunden oder als getrennte Neonstücke planen. Größer skalieren allein löst diese Ecken nicht.')
    if junctions:warnings.append(f'{junctions} Berührungen/Kreuzungen: Anschlussführung und getrennte Stücke prüfen.')
    if short:warnings.append(f'{len(short)} Pfadstücke kürzer als {values["cutLength"]:g} mm. Lokale Verlängerung oder Anpassung nötig; nicht das ganze Motiv dafür vergrößern.')
    # An unchanged-path scale calculation is not a minimum manufacturable size
    # when corners, junctions or local details still require reconstruction.
    needs_local=bool(corners or junctions or short or local)
    if needs_local:warnings.append('Zuerst die genannten Details lokal bearbeiten. Reines Hochskalieren ist hier keine verlässliche Mindestgrößenempfehlung.')
    if proposed>20000:warnings.append('Zeichnung und enge Verbindungen zuerst korrigieren; reines Skalieren würde mehr als 20 m Breite benötigen.')
    return dict(profile=values,tube=tube,requiredSpacing=required,minimumRadius=minimum_radius[0],
        minimumSpacing=minimum_spacing[0],shortPaths=short,corners=corners,junctions=junctions,
        recommendedWidth=proposed if proposed<=20000 and not needs_local else None,
        spacingWidth=spacing_width if spacing_factor>1 else None,
        unchangedPathWidth=proposed,needsLocalCorrection=needs_local,currentWidth=drawing['width'],
        rawMeters=drawing['neonMeters'],materialMeters=drawing['neonMaterialMeters'],
        modes={mode:drawing['pathModes'].count(mode) for mode in set(drawing['pathModes'])},
        reasons=reasons,warnings=warnings+list(dict.fromkeys(local)),approved=False)
