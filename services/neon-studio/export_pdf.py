"""True stroke-only CNC PDF and separate annotated 1:1 drawing."""
import io
import math
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.pdfbase.pdfmetrics import stringWidth


def _wrap(value,font,size,width):
    """Wrap by real glyph width, including long unbroken order identifiers."""
    lines=[]
    for paragraph in value.splitlines():
        line=''
        for char in paragraph:
            if line and stringWidth(line+char,font,size)>width:
                split=line.rfind(' ')
                if split>0:
                    lines.append(line[:split]);line=line[split+1:]+char
                else:
                    lines.append(line);line=char
            else: line+=char
        lines.append(line)
    return lines


def _paint(c,path,ox,oy,color,stroke=1):
    p=c.beginPath()
    def point(pt): return ((ox+pt[0])*mm,(oy-pt[1])*mm)
    for op,*pts in path:
        if op=='m': p.moveTo(*point(pts[0]))
        elif op=='l': p.lineTo(*point(pts[0]))
        elif op=='c': p.curveTo(*[v for pt in pts for v in point(pt)])
        elif op=='h': p.close()
    c.setStrokeColor(HexColor(color)); c.setLineWidth(stroke*mm)
    c.setLineCap(1); c.setLineJoin(1); c.drawPath(p,stroke=1,fill=0)


def _print_uv(c,drawing,ox,oy):
    uv=drawing.get('uv')
    if not uv:return
    from reportlab.lib.utils import ImageReader
    import base64
    def path(commands):
        result=c.beginPath()
        def point(pt):return ((ox+pt[0])*mm,(oy-pt[1])*mm)
        for op,*pts in commands:
            if op=='m':result.moveTo(*point(pts[0]))
            elif op=='l':result.lineTo(*point(pts[0]))
            elif op=='c':result.curveTo(*[v for pt in pts for v in point(pt)])
            elif op=='h':result.close()
        return result
    c.saveState();c.clipPath(path(uv['clip']),stroke=0,fill=0,fillMode=0)
    if uv['artwork'] is not None:
        for item in uv['artwork']:
            c.setFillColor(HexColor(item['sourceColor']))
            stroke=item.get('originalStrokeColor') or (item['sourceColor'] if not item.get('filled') else None)
            if stroke:c.setStrokeColor(HexColor(stroke))
            c.setLineWidth((item.get('originalStrokeWidth') or .1)*mm)
            c.drawPath(path(item['commands']),stroke=int(bool(stroke)),fill=int(bool(item.get('filled'))),fillMode=0 if item.get('evenodd') else 1)
    else:
        x,y,w,h=drawing['imageBox']
        c.drawImage(ImageReader(io.BytesIO(base64.b64decode(uv['image'].split(',')[1]))),
                    (ox+x)*mm,(oy-y-h)*mm,width=w*mm,height=h*mm,mask='auto')
    c.restoreState()


def make_pdf(drawing,options=None):
    if not drawing.get('exportable',True):
        if not drawing.get('paths'):
            raise ValueError('Alle Linien sind ausgeblendet. Bitte zuerst eine Linie wiederherstellen.')
        raise ValueError('Motivelemente ohne Linien: Bitte zuerst eine verfügbare Linienart zuweisen.')
    options=options or {}
    kind=options.get('kind','cnc')
    if kind not in ('cnc','drawing','custom','uv'):
        raise ValueError('Unbekanntes PDF-Format.')
    if kind=='uv' and not drawing.get('uv'):raise ValueError('Zuerst einen Bereich als UV-Druck markieren.')
    annotated=kind in ('drawing','custom')
    dimensions=annotated and options.get('dimensions',True)
    meters=annotated and options.get('meters',True)
    title=str(options.get('title','Neon Studio'))[:120]
    note=str(options.get('note',''))[:600]
    width=drawing['width'];height=drawing['height']
    # Scale annotations with the sign so they stay readable in a page preview.
    # Coordinates and the physical stroke width of the CNC paths stay 1:1.
    label_scale=max(1,max(width,height)/500) if annotated else 1
    left=30*label_scale if annotated else 10
    title_lines=_wrap(title,'Helvetica-Bold',22*label_scale,width*mm) if annotated else []
    footer_lines=[]
    def footer_line(value,size=14,bold=False):
        for line in _wrap(value,'Helvetica-Bold' if bold else 'Helvetica',size*label_scale,width*mm):
            footer_lines.append((line,size,bold))
    if dimensions:footer_line(f'Overall size: {width/10:.2f} x {height/10:.2f} cm',15)
    if meters:
        footer_line(f'({drawing["neonMeters"]:.2f} m +10%)',14)
        footer_line(f'Neon-Length: {drawing["neonMaterialMeters"]:.2f} m',22,True)
        footer_line('Excludes backing outline, cables and UV print.' if drawing.get('uv') else 'Excludes backing outline and cables.',13)
    if annotated and drawing.get('uv'):footer_line('UV print: original artwork, excluded from neon length.',14)
    if annotated:
        shape={'rectangle':'Rectangle','bottom':'Cut to Shape - bottom only','shape':'Cut to Shape'}[drawing['settings']['shape']]
        footer_line(f'Backing: {shape}',14)
        gaps={side:drawing['settings'].get('gapSides',{}).get(side,drawing['settings']['gap']) for side in ('left','right','top','bottom')}
        if len(set(gaps.values()))==1:
            footer_line(f'Neon path to acrylic edge: {gaps["left"]/10:.2f} cm',14)
        else:
            footer_line('Neon path to acrylic edge:',14)
            footer_line(' / '.join(f'{side.title()}: {gap/10:.2f} cm' for side,gap in gaps.items()),14)
        colors={item['id']:item for item in drawing.get('pathColors',[])}
        for color in colors.values():
            suffix=' (black lines)' if color['color']=='#000000' else f' ({color["color"].upper()})'
            footer_line('Line colour: '+color['english']+suffix,13)
    if annotated and options.get('includeTitle',True):
        footer_line('Existing vector artwork' if drawing['sourceKind'] in ('master','vector') else 'Automatically traced - draft',12)
    if annotated and note:footer_line(note)
    top=max(45,34+10*len(title_lines))*label_scale if annotated else 10
    bottom=(20+sum(size*1.35/mm+2 for _,size,_ in footer_lines))*label_scale if annotated else 10
    pw=width+left+20*label_scale;ph=height+top+bottom
    # Keep PDF page coordinates within 14,400 points. UserUnit restores the
    # physical 1:1 size for large signs without changing any drawing geometry.
    user_unit=max(1,math.ceil(max(pw,ph)*mm/14400))
    output=io.BytesIO()
    c=canvas.Canvas(output,pagesize=(pw*mm/user_unit,ph*mm/user_unit),pageCompression=1)
    if user_unit>1:c.scale(1/user_unit,1/user_unit)
    c.setTitle(title+' - '+('UV print 1:1' if kind=='uv' else 'CNC 1:1' if not annotated else 'Drawing 1:1'))
    c.setAuthor('NEONTRIP · Neon Studio')
    bx,by,_,_=drawing['bounds'];ox=left-bx;oy=ph-top+by
    if kind!='cnc':_print_uv(c,drawing,ox,oy)
    for index,path in enumerate(drawing['paths'] if kind!='uv' else []):
        color=drawing['pathColors'][index]['color'] if drawing.get('pathColors') else '#1748bd'
        _paint(c,path,ox,oy,color)
    if kind!='uv':_paint(c,drawing['outer'],ox,oy,'#111111')
    if annotated:
        def text(x,y,value,size=12,bold=False):
            c.setFillColor(HexColor('#26313b'));c.setFont('Helvetica-Bold' if bold else 'Helvetica',size*label_scale)
            c.drawString(x*mm,(ph-y)*mm,value)
        for index,line in enumerate(title_lines): text(left,(12+10*index)*label_scale,line,22,True)
        mode_label='Mixed' if drawing['modeLabel']=='Gemischt' else drawing['modeLabel']
        text(left,(13+10*len(title_lines))*label_scale,mode_label+' / Drawing 1:1',14)
        if dimensions:
            c.setStrokeColor(HexColor('#63707b'));c.setLineWidth(.25*label_scale*mm)
            y=ph-top+8*label_scale
            c.line(left*mm,y*mm,(left+width)*mm,y*mm)
            for x in (left,left+width): c.line(x*mm,(y-2*label_scale)*mm,x*mm,(y+2*label_scale)*mm)
            c.setFillColor(HexColor('#26313b'));c.setFont('Helvetica',16*label_scale)
            c.drawCentredString((left+width/2)*mm,(y+3*label_scale)*mm,f'{width/10:.2f} cm')
            x=left-10*label_scale; y0=ph-top;y1=y0-height
            c.line(x*mm,y0*mm,x*mm,y1*mm)
            for y in (y0,y1):c.line((x-2*label_scale)*mm,y*mm,(x+2*label_scale)*mm,y*mm)
            c.saveState();c.translate((x-3*label_scale)*mm,(y0+y1)/2*mm);c.rotate(90)
            c.drawCentredString(0,0,f'{height/10:.2f} cm');c.restoreState()
        footer=top+height+7*label_scale
        for line,size,bold in footer_lines:
            footer+=(size*1.35/mm+2)*label_scale
            text(left,footer,line,size,bold)
    c.showPage();c.save()
    if user_unit>1:
        from pypdf import PdfReader, PdfWriter
        from pypdf.generic import NameObject, NumberObject
        writer=PdfWriter(clone_from=PdfReader(io.BytesIO(output.getvalue())))
        writer.pdf_header='%PDF-1.6'
        writer.pages[0][NameObject('/UserUnit')]=NumberObject(user_unit)
        output=io.BytesIO();writer.write(output)
    return output.getvalue()
