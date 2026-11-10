"""Preserve SVG/PDF contours and artwork; derive centrelines separately on request."""
import base64
import copy
import io
import math
import re
import threading

import pdfplumber
from lxml import etree
from pypdf import PdfReader
from pypdf.generic import ContentStream
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg

from geometry import path_bounds, path_d, path_length, transform

MAX_VECTOR_BYTES = 100 * 1024 * 1024


class VectorPreviewRequired(ValueError):
    """The visible PDF can be rendered, but extracting its paths would lose content."""


def render_pdf_page(raw, page_index=0):
    """Bound rendering by pixel dimensions, independently of the PDF paper size."""
    import pypdfium2 as pdfium
    if len(raw)>MAX_VECTOR_BYTES:raise ValueError('Die PDF darf höchstens 100 MB groß sein.')
    with pdfium.PdfDocument(raw) as document:
        if type(page_index) is not int or not 0<=page_index<len(document):
            raise ValueError('Ungültige PDF-Seite.')
        page=document[page_index]
        try:
            width,height=page.get_size()
            scale=1800/max(width,height)
            bitmap=page.render(scale=scale)
            try:
                output=io.BytesIO();bitmap.to_pil().save(output,'PNG')
                return output.getvalue(),len(document),page_index
            finally:bitmap.close()
        finally:page.close()


def is_vector(raw, name):
    return str(name).lower().endswith(('.svg', '.pdf', '.ai', '.eps', '.ps', '.cdr', '.dxf')) or raw.lstrip().startswith((b'%PDF-', b'<svg', b'<?xml'))


def _svg_pdf(raw):
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise ValueError('SVG bitte ohne DTD oder externe Entitäten exportieren.')
    parser=etree.XMLParser(resolve_entities=False, no_network=True)
    try: root=etree.fromstring(raw, parser)
    except etree.XMLSyntaxError:
        raise ValueError('Die SVG-Datei ist beschädigt.') from None
    if etree.QName(root).localname!='svg':raise ValueError('Keine SVG-Datei erkannt.')
    nodes=list(root.iter())
    if len(nodes)>10000:raise ValueError('Die SVG enthält zu viele Elemente. Bitte nur das Logo exportieren.')
    clip_ids={n.get("id") for n in nodes if isinstance(n.tag,str) and etree.QName(n).localname=="clipPath" and n.get("id")}
    for node in nodes:
        if not isinstance(node.tag,str):continue
        tag=etree.QName(node).localname
        if tag in ('text','tspan','textPath'):
            raise ValueError('SVG-Schrift bitte zuerst in Pfade/Kurven umwandeln und erneut exportieren.')
        if tag in ('image','foreignObject','script','filter','mask','linearGradient','radialGradient','pattern','animate','set'):
            raise ValueError('SVG bitte als reine Pfade mit Vollfarben exportieren, ohne Bilder, Masken oder Effekte.')
        for key,value in node.attrib.items():
            if etree.QName(key).localname=='href' and not value.startswith('#'):
                raise ValueError('Externe SVG-Verweise werden nicht geladen. Bitte Pfade direkt einbetten.')
        attributes=dict(node.attrib)
        clip=re.fullmatch(r'url\(#([\w.-]+)\)',attributes.get('clip-path',''))
        if clip and clip[1] in clip_ids:
            del attributes['clip-path']
        style=' '.join(attributes.values())+' '+(node.text or '')
        if '@import' in style.lower() or 'url(' in style.lower():
            raise ValueError('SVG bitte ohne externe Stile, Farbverläufe oder Masken exportieren.')
    # The browser never receives the uploaded XML. It receives a preview rebuilt
    # from the imported path commands below, with no active/external content.
    if clip_ids:
        shapes={'svg','defs','g','path','rect','circle','ellipse','line','polyline','polygon','clipPath','title','desc'}
        if any(etree.QName(n).localname not in shapes or any(etree.QName(k).localname in ('href','base','style') for k in n.attrib)
               for n in nodes if isinstance(n.tag,str)):
            raise ValueError('SVG mit Beschneidungspfaden bitte als einfache Formen ohne externe Ressourcen exportieren.')
        for clip in root.iter('{*}clipPath'):
            children=[child for child in clip if isinstance(child.tag,str)]
            if len(children)!=1 or etree.QName(children[0]).localname not in shapes-{'svg','g','defs','clipPath','title','desc'} or clip.get('clipPathUnits','userSpaceOnUse')!='userSpaceOnUse':
                raise ValueError('Bitte jede SVG-Beschneidung als einzelnen Pfad exportieren.')
    drawing=svg2rlg(io.BytesIO(etree.tostring(root)))
    if drawing is None:raise ValueError('Keine SVG-Pfade gefunden.')
    return renderPDF.drawToString(drawing)


def _check_pdf_streams(page, reader, painted_bounds=None):
    """Retain harmless enclosing clips; render effects that change visible paths."""
    seen=set()
    def check(stream,resources,depth=0):
        if depth>20:raise VectorPreviewRequired('Die PDF enthält stark verschachtelte Grafiken.')
        if stream is None:return
        operations=ContentStream(stream,reader).operations
        if len(operations)>100000:raise VectorPreviewRequired('Die PDF enthält sehr viele Grafikbefehle.')
        identity=True;stack=[];rect=None
        for args,op in operations:
            if op==b'q':stack.append(identity)
            elif op==b'Q':identity=stack.pop() if stack else False
            elif op==b'cm' and list(args)!=[1,0,0,1,0,0]:identity=False
            elif op==b're':
                if rect is None and identity:
                    x,y,w,h=map(float,args);rect=(min(x,x+w),min(y,y+h),max(x,x+w),max(y,y+h))
                else:rect=False
            elif op in (b'm',b'l',b'c',b'v',b'y',b'h'):rect=False
            if op in (b'W',b'W*',b'sh'):
                # PDF exporters round coordinates independently; allow at most
                # .01 pt (~.0035 mm), never visible clipping of a motif segment.
                harmless=op!=b'sh' and depth==0 and rect and painted_bounds and all(
                    b[0]>=rect[0]-.01 and b[1]>=rect[1]-.01 and b[2]<=rect[2]+.01 and b[3]<=rect[3]+.01 for b in painted_bounds)
                if not harmless:raise VectorPreviewRequired('Die Seite enthält Schnittmasken oder Verläufe.')
            if op in (b'n',b'S',b's',b'f',b'F',b'f*',b'B',b'B*',b'b',b'b*'):rect=None
        resources=resources.get_object() if hasattr(resources,'get_object') else resources
        for state in resources.get('/ExtGState',{}).get_object().values() if '/ExtGState' in resources else []:
            state=state.get_object()
            if any(float(state.get(k,1))!=1 for k in ('/ca','/CA')) or state.get('/SMask','/None')!='/None':
                raise VectorPreviewRequired('Die Seite enthält transparente Grafiken.')
        for obj in resources.get('/XObject',{}).get_object().values() if '/XObject' in resources else []:
            obj=obj.get_object()
            if obj.get('/Subtype')=='/Form' and id(obj) not in seen:
                seen.add(id(obj));check(obj,obj.get('/Resources',resources),depth+1)
    check(page.get_contents(),page.get('/Resources',{}))


def _hex(color):
    values=[float(color)] if isinstance(color,(int,float)) else list(color or (0,0,0))
    if len(values)==1:values*=3
    elif len(values)==4:
        c,m,y,k=values;values=[(1-c)*(1-k),(1-m)*(1-k),(1-y)*(1-k)]
    if len(values)!=3 or not all(math.isfinite(v) for v in values):
        raise ValueError('Die PDF-Farbe wird nicht unterstützt. Bitte in RGB exportieren.')
    return '#'+''.join(f'{round(max(0,min(1,v))*255):02x}' for v in values)


def _commands(raw, scale):
    out=[];previous=None
    for op,*points in raw:
        points=[[float(x)*scale,float(y)*scale] for x,y in points]
        if not all(math.isfinite(v) and abs(v)<1e7 for p in points for v in p):
            raise ValueError('Ungültige Vektorkoordinaten.')
        if op=='v':op,points='c',[previous,*points]
        elif op=='y':op,points='c',[*points,points[-1]]
        if op not in ('m','l','c','h'):raise ValueError('Unbekannter Vektorpfad-Befehl.')
        out.append([op,*points])
        if points:previous=points[-1]
    return out


def _paint_groups(source):
    """Retain compound fill paths before pdfminer splits them into contours."""
    from pdfminer.converter import PDFPageAggregator
    from pdfminer.pdfinterp import PDFPageInterpreter
    from pdfminer.utils import apply_matrix_pt
    groups=[]
    class Collector(PDFPageAggregator):
        def paint_path(self,gstate,stroke,fill,evenodd,path):
            commands=[]
            for op,*values in path:
                commands.append((op,*[source.point2coord(apply_matrix_pt(self.ctm,(x,y)))
                                      for x,y in zip(values[::2],values[1::2])]))
            groups.append(commands)
    collector=Collector(source.pdf.rsrcmgr)
    PDFPageInterpreter(source.pdf.rsrcmgr,collector).process_page(source.page_obj)
    lookup={}
    def key(path):return tuple((c[0],*[tuple(round(v,6) for v in pt) for pt in c[1:]]) for c in path)
    for group,path in enumerate(groups):
        pieces=[]
        for c in path:
            if c[0]=='m':pieces.append([])
            if pieces:pieces[-1].append(c)
        for piece in pieces:lookup.setdefault(key(piece),[]).append(group)
    return lookup,key


def analyze_vector(raw, name, page_index=0):
    if len(raw)>MAX_VECTOR_BYTES:raise ValueError('Die Vektordatei darf höchstens 100 MB groß sein.')
    svg=not raw.lstrip().startswith(b'%PDF-')
    if svg and str(name).lower().endswith(('.ai','.eps','.ps','.cdr','.dxf')):
        raise ValueError('Dieses Vektorformat bitte aus dem Zeichenprogramm als SVG oder Vektor-PDF exportieren. AI funktioniert direkt, wenn die Datei PDF-kompatibel gespeichert wurde.')
    try:
        pdf=_svg_pdf(raw) if svg else raw
        reader=PdfReader(io.BytesIO(pdf))
        if reader.is_encrypted:raise ValueError('Bitte eine unverschlüsselte PDF hochladen.')
        if not reader.pages:raise ValueError('Die PDF enthält keine Seite.')
        optional=reader.trailer['/Root'].get('/OCProperties')
        if optional:
            default=optional.get_object().get('/D',{})
            if hasattr(default,'get_object'):default=default.get_object()
            groups=optional.get_object().get('/OCGs',[])
            # CorelDRAW commonly wraps every visible path in one OCG. This is
            # harmless. Hidden/conditional layers must not become cutting paths.
            on=default.get('/ON',[])
            if default.get('/OFF') or default.get('/AS') or (default.get('/BaseState','/ON')!='/ON' and any(g not in on for g in groups)):
                raise VectorPreviewRequired('Die PDF enthält ausgeblendete oder bedingte Ebenen.')
        if type(page_index) is not int or not 0<=page_index<len(reader.pages):raise ValueError('Ungültige PDF-Seite.')
        page=reader.pages[page_index]
        scale=float(page.get('/UserUnit',1))*25.4/72
        paths=[];notes=[]
        with pdfplumber.open(io.BytesIO(pdf)) as document:
            source=document.pages[page_index]
            objects=source.curves+source.lines+source.rects
            groups,path_key=_paint_groups(source)
            fallback_group=max((g for values in groups.values() for g in values),default=-1)+1
            painted=None
            if page.rotation==0 and list(page.mediabox.lower_left)==[0,0]:
                painted=[]
                for obj in objects:
                    if not (obj.get('stroke') or obj.get('fill')):continue
                    margin=float(obj.get('linewidth',0))/2 if obj.get('stroke') else 0
                    painted.append((obj['x0']-margin,source.height-obj['bottom']-margin,obj['x1']+margin,source.height-obj['top']+margin))
            _check_pdf_streams(page,reader,painted)
            if source.chars:notes.append('PDF-Text wurde ausgelassen. Benötigte Schrift vorher in Kurven umwandeln.')
            if source.images:notes.append('Eingebettete Rasterbilder wurden ausgelassen.')
            if len(reader.pages)>1:notes.append(f'Seite {page_index+1} von {len(reader.pages)} importiert.')
            for obj in objects:
                if not (obj.get('stroke') or obj.get('fill')):continue
                path=_commands(obj.get('path',[]),scale)
                if len(path)<2 or path_length(path)<1e-6:continue
                filled=bool(obj.get('fill'))
                matches=groups.get(path_key(obj.get('path',[])),[])
                group=matches.pop(0) if matches else fallback_group+len(paths)
                # A filled open shape is implicitly closed in PDF/SVG.
                if filled and path[-1][0]!='h':path.append(['h'])
                color=_hex(obj.get('non_stroking_color' if filled else 'stroking_color'))
                paths.append(dict(commands=path,sourceColor=color,length=path_length(path),filled=filled,originalGroup=group,
                    evenodd=bool(obj.get("evenodd",False)),originalStrokeWidth=float(obj.get("linewidth",0))*scale,
                    originalStrokeColor=_hex(obj.get("stroking_color")) if obj.get("stroke") else None))
            if not paths:raise VectorPreviewRequired('Keine Vektorpfade auf dieser Seite gefunden; die Seite enthält möglicherweise Text oder ein Bild.')
            if len(paths)>10000:raise VectorPreviewRequired('Die Seite enthält mehr als 10.000 Vektorpfade.')
            model=_vector_model(paths,('SVG' if svg else 'PDF')+' · Original-Vektorpfade',notes)
            # Raster is only the selection backdrop. Export still uses the exact
            # original cubic commands and physical units, never this preview.
            preview=source.to_image(resolution=min(120,1600*72/max(source.width,source.height)))
            buffer=io.BytesIO();preview.original.save(buffer,format='PNG')
            x0,y0=model.pop('origin')
            model['selectionImage']='data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()
            model['selectionBounds']=[source.bbox[0]*scale-x0,source.bbox[1]*scale-y0,source.width*scale,source.height*scale]
            model['pageCount']=len(reader.pages);model['pageIndex']=page_index
            model['selectionNotes']=notes
            return model
    except ValueError:raise
    except Exception:
        error=ValueError if svg else VectorPreviewRequired
        raise error('Die Originalpfade konnten nicht vollständig gelesen werden.') from None


def _vector_model(paths, label, notes=()):
    bounds=[path_bounds(p['commands']) for p in paths]
    x0=min(b[0] for b in bounds);y0=min(b[1] for b in bounds)
    width=max(b[2] for b in bounds)-x0;height=max(b[3] for b in bounds)-y0
    parts=[];part_map={};artwork_map={}
    for i,(item,b) in enumerate(zip(paths,bounds)):
        item['commands']=transform(item['commands'],1,-x0,-y0)
        group=item.get('originalGroup',i)
        part_key=('fill',group) if item.get('filled') else ('stroke',i)
        part=part_map.get(part_key)
        if part is None:
            part=dict(id=item.get('partId',f'vector-{i+1}'),name=item.get('name',f'Vektorpfad {i+1}'),
                      bounds=[b[0]-x0,b[1]-y0,b[2]-x0,b[3]-y0],single=1,double=0)
            part_map[part_key]=part;parts.append(part)
        else:
            a=part['bounds'];part['bounds']=[min(a[0],b[0]-x0),min(a[1],b[1]-y0),max(a[2],b[2]-x0),max(a[3],b[3]-y0)]
        part['double']+=1
        item.update(name=item.get('name',f'Vektorpfad {i+1}'),partId=part['id'],method='imported')
        if group not in artwork_map:artwork_map[group]={**item,'commands':[]}
        artwork_map[group]['commands'].extend(item['commands'])
    artwork=[artwork_map[key] for key in sorted(artwork_map)]
    w=max(width,.1);h=max(height,.1);stroke=max(w,h)/600
    markup=f'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="{max(1,round(1200*h/w))}" viewBox="{-stroke} {-stroke} {w+2*stroke} {h+2*stroke}">'
    markup+=''.join(f'<path d="{path_d(p["commands"])}" fill="{p["sourceColor"] if p.get("filled") else "none"}" fill-rule="{"evenodd" if p.get("evenodd") else "nonzero"}" stroke="{p.get("originalStrokeColor") or ("none" if p.get("filled") else p["sourceColor"])}" stroke-width="{p.get("originalStrokeWidth") or stroke}"/>' for p in artwork)+'</svg>'
    has_fills=any(p.get('filled') for p in paths)
    note='Vorhandene Vektorpfade direkt übernommen, ohne Raster-Nachzeichnung. Originalansicht zeigt die ursprünglichen Flächen und Farben. '
    if has_fills:note+='Double Line behält die Originalkonturen. Single Line berechnet daraus Mittellinien; bitte mit dem Original vergleichen. '
    note+=' '.join(notes)
    return dict(modes={'double':paths,'single':copy.deepcopy(paths)},parts=parts,artwork=artwork,
        image='data:image/svg+xml;base64,'+base64.b64encode(markup.encode()).decode(),
        imageBounds=[-stroke,-stroke,w+2*stroke,h+2*stroke],sourceKind='vector',sourceLabel=label,
        pixelWidth=round(w,2),pixelHeight=round(h,2),nativeWidthMm=width,nativeHeightMm=height,
        vectorHasFills=has_fills,singleReady=not has_fills,traceNote=note,origin=(x0,y0))


def vector_preview(model):
    paths=model['modes']['double'];parts=model['parts'];part_lookup={p['id']:p for p in parts}
    suggested=set(p['partId'] for p in paths);enclosing=None;most=2
    # A closed, unfilled path surrounding several other paths is a likely
    # backing outline. This is only a proposal: all paths remain selectable.
    for item,part in sorted(((p,part_lookup[p['partId']]) for p in paths),key=lambda pair:(pair[1]['bounds'][2]-pair[1]['bounds'][0])*(pair[1]['bounds'][3]-pair[1]['bounds'][1]),reverse=True):
        if item.get('filled') or item['commands'][-1][0]!='h':continue
        a=part['bounds'];inside=[]
        for other in parts:
            b=other['bounds']
            if other['id']!=part['id'] and a[0]<=b[0] and a[1]<=b[1] and a[2]>=b[2] and a[3]>=b[3]:inside.append(other['id'])
        if len(inside)>most:most=len(inside);suggested=set(inside);enclosing=part['id']
        if most==len(parts)-1:break
    note=('Vorschlag: Pfade innerhalb einer möglichen Außenkontur. Rahmen und außenliegende Maßhilfen sind rot. Bitte vor dem Übernehmen prüfen.' if enclosing else
          'Vorschlag: alle vorhandenen Vektorpfade. Wähle Rahmen, Maßhilfen und unerwünschte Teile ab.')
    preview_paths={}
    for item in paths:
        entry=preview_paths.setdefault(item['partId'],{**item,'commands':[]})
        entry['commands'].extend(item['commands'])
    return dict(kind='vector',image=model['selectionImage'],viewBox=model['selectionBounds'],
        pageCount=model['pageCount'],pageIndex=model['pageIndex'],suggested=sorted(suggested),suggestionNote=note,
        importNote=' '.join(model.get('selectionNotes',[])),paths=[dict(id=p['partId'],name=p['name'],d=path_d(p['commands']),
        bounds=part['bounds'],color=p['sourceColor'],filled=p.get('filled',False),
        role='Mögliche Außenkontur' if p['partId']==enclosing else 'Vektorpfad') for p,part in ((p,part_lookup[p['partId']]) for p in preview_paths.values())])


def select_vector(model, selected):
    valid={p['partId'] for p in model['modes']['double']}
    if not isinstance(selected,list) or not selected or any(not isinstance(s,str) or s not in valid for s in selected):
        raise ValueError('Bitte mindestens einen vorhandenen Vektorpfad auswählen.')
    paths=[copy.deepcopy(p) for p in model['modes']['double'] if p['partId'] in selected]
    result=_vector_model(paths,model['sourceLabel'],model.get('selectionNotes',[]))
    result.pop('origin')
    return result


_single_lock=threading.Lock()

def ensure_vector_single(model, outline_parts=()):
    with _single_lock:
        _build_vector_single(model)
        return _build_outline_single(model,set(outline_parts))


def _shape_centerlines(shape, resolution=400, max_scale=12.):
    import numpy as np
    from PIL import Image, ImageDraw
    from centerlines import centerline_paths
    paths=[]
    polygons=[shape] if shape.geom_type=='Polygon' else list(shape.geoms)
    for poly in polygons:
        if poly.geom_type!='Polygon':continue
        x0,y0,x1,y1=poly.bounds
        scale=min(max_scale,resolution/max(x1-x0,y1-y0,.0001))
        image=Image.new('1',(max(8,round((x1-x0)*scale)+9),max(8,round((y1-y0)*scale)+9)))
        draw=ImageDraw.Draw(image)
        def coords(ring):return [((x-x0)*scale+4,(y-y0)*scale+4) for x,y in ring.coords]
        draw.polygon(coords(poly.exterior),fill=1)
        for ring in poly.interiors:draw.polygon(coords(ring),fill=0)
        found,_,_=centerline_paths(np.asarray(image,dtype=bool))
        paths.extend(transform(p,1/scale,x0-4/scale,y0-4/scale) for p in found)
    return paths


def _build_outline_single(model, selected):
    """Explicit selection interprets closed strokes as outlines, preserving originals.

    Counters can be separate PDF paint operations. Only selected, nested contours
    of the same colour belong together. Append cached proposals so existing path
    keys (colours, hidden paths, undo) never change when another letter is converted.
    """
    if not selected:return set(),{}
    from uv_print import filled_shape
    shapes=model.setdefault('_outlineShapes',{})
    candidates={}
    for i,item in enumerate(model['modes']['double']):
        if item.get('filled') or item.get('neonCenterline') or item['partId'] not in selected:continue
        commands=item['commands']
        # SVG circles and some PDF exporters close by returning to the start,
        # without emitting an explicit close-path command.
        if commands[-1][0]!='h' and math.dist(commands[0][1],commands[-1][-1])>1e-6:continue
        if i not in shapes:shapes[i]=filled_shape(item['commands'],True)
        if not shapes[i].is_empty:candidates[i]=item
    parents={}
    for i,item in candidates.items():
        containers=[j for j,other in candidates.items() if j!=i and other['sourceColor']==item['sourceColor']]
        containers=[j for j in containers if shapes[j].area>shapes[i].area and shapes[j].contains(shapes[i])]
        if containers:parents[i]=min(containers,key=lambda j:shapes[j].area)
    groups={}
    for i in candidates:
        root=i
        while root in parents:root=parents[root]
        groups.setdefault(root,[]).append(i)
    cache=model.setdefault('_outlineSingle',{})
    active=set();linked={}
    for root,indices in groups.items():
        key=tuple(indices);members=[candidates[i]['partId'] for i in indices]
        if key not in cache:
            shape=filled_shape([c for i in indices for c in candidates[i]['commands']],True)
            paths=_shape_centerlines(shape,600,float('inf'))
            added=[]
            for path in paths:
                added.append(len(model['modes']['single']))
                model['modes']['single'].append({**candidates[root],'commands':path,'length':path_length(path),
                    'method':'centerline','outlineParts':members,'name':candidates[root]['name']+' · Mittellinie'})
            cache[key]=added
        if cache[key]:
            active.update(cache[key])
            for member in members:linked[member]=members
    return active,linked

def _build_vector_single(model):
    """Derive centreline proposals only for filled artwork; never alter imports."""
    if not model.get('vectorHasFills') or model.get('singleReady'):return
    from uv_print import filled_shape
    singles=[];counts={p['id']:0 for p in model['parts']}
    candidates=[p for p in model.get('artwork',model['modes']['double']) if p.get('filled')]
    candidates += [p for p in model['modes']['double'] if not p.get('filled')]
    for item in candidates:
        paths=[]
        if not item.get('filled'):paths=[item['commands']]
        else:
            shape=filled_shape(item['commands'],item.get('evenodd',False))
            if shape.is_empty:continue
            paths=_shape_centerlines(shape)
            # A tiny solid spot may not have a usable centreline. Keep a visible
            # silhouette proposal rather than silently dropping its geometry.
            if not paths:paths=[item['commands']]
        for path in paths:
            singles.append({**item,'commands':path,'length':path_length(path),'method':'centerline' if item.get('filled') else 'imported',
                            'name':item['name']+' · Mittellinie'})
            counts[item['partId']]+=1
    model['modes']['single']=singles
    model['parts']=[{**p,'single':counts[p['id']]} for p in model['parts']]
    model['singleReady']=True
