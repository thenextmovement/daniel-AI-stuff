"""All three quote artifacts derive from the same measured drawing."""
import io,json,re
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
import fitz
from PIL import Image
from export_pdf import _paint
from neon_pricing import drawing_price
def de(value,places=2):return f'{float(value):.{places}f}'.replace('.',',')
CUT={'shape':'Formzuschnitt','rectangle':'Rechteck','bottom':'Nur unten'}
def price(drawing,spec):
    q=drawing_price(drawing,{**spec.get('pricing_options',{}),'color':spec.get('light_type','single'),
        'outdoor':spec['usage']=='Außen','waterproof_psus':spec.get('waterproof_psus',0),
        'uv_print':spec.get('uv_print',False),'controllers':spec.get('controllers',1)})
    quantity=spec.get('quantity',1)
    for key in ('production_usd','shipping_usd','total_usd'):
        q[key]=str(int(q[key])*quantity)
    q['quantity']=quantity
    if quantity>1:q['assumptions'].append('quantity_separate_packages')
    return q
def artwork(c,d,x,y,width,height,technical=False):
    scale=min(width/d['width'],height/d['height'])
    c.saveState();c.translate(x,y);c.scale(scale,scale)
    bx,by=d['bounds'][:2]
    _paint(c,d['outer'],-bx,d['height']+by,'#333333',max(.12,.3/scale/mm))
    for seam in (d.get('acrylicSplit') or {}).get('seams',[]):
        _paint(c,seam,-bx,d['height']+by,'#777777',max(.12,.3/scale/mm))
    for path,color in zip(d['paths'],d['pathColors']):
        _paint(c,path,-bx,d['height']+by,color['color'],d['settings']['tube'] if technical else max(.35,1/scale/mm))
    c.restoreState()
def dimensions(c,d,x,y,width,height):
    scale=min(width/d['width'],height/d['height'])*mm
    w,h=d['width']*scale,d['height']*scale
    c.saveState();c.setStrokeColor(HexColor('#555555'));c.setLineWidth(.45);c.setFont('Helvetica',9)
    top=y+h+12;left=x-16
    c.line(x,top,x+w,top)
    arrow=min(4,w/4,h/4)
    for tip,direction in ((x,1),(x+w,-1)):
        c.line(tip,top,tip+direction*arrow,top+arrow/2)
        c.line(tip,top,tip+direction*arrow,top-arrow/2)
    for edge in (x,x+w):c.line(edge,top-3,edge,top+3)
    c.drawCentredString(x+w/2,top+5,de(d['width']/10)+' cm')
    c.line(left,y,left,y+h)
    for tip,direction in ((y,1),(y+h,-1)):
        c.line(left,tip,left-arrow/2,tip+direction*arrow)
        c.line(left,tip,left+arrow/2,tip+direction*arrow)
    for edge in (y,y+h):c.line(left-3,edge,left+3,edge)
    c.translate(left-5,y+h/2);c.rotate(90);c.drawCentredString(0,0,de(d['height']/10)+' cm')
    c.restoreState()
def quote_table(c, x, top, widths, title, rows, emphasize_total=False):
    from reportlab.platypus import Paragraph, Table, TableStyle
    from reportlab.lib.styles import ParagraphStyle
    from xml.sax.saxutils import escape

    ink=HexColor('#21374A')
    c.setFillColor(ink)
    c.setFont('Helvetica-Bold',12)
    c.drawString(x,top,title)
    cells=[]
    for index,(label,value) in enumerate(rows):
        bold=emphasize_total and index==len(rows)-1
        row=[]
        for column,content in enumerate((label,value)):
            style=ParagraphStyle('cell',fontName='Helvetica-Bold' if bold else 'Helvetica',
                                 fontSize=9,leading=11,textColor=ink,alignment=2 if column else 0)
            row.append(Paragraph(escape(content).replace('\n','<br/>'),style))
        cells.append(row)
    table=Table(cells,colWidths=widths)
    table.setStyle(TableStyle([
        ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
        ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
        ('RIGHTPADDING',(0,0),(0,-1),8),
        ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),
        ('LINEABOVE',(0,0),(-1,0),.6,HexColor('#ABBBC6')),
        ('LINEBELOW',(0,0),(-1,-1),.35,HexColor('#CED9DF'))]))
    _,height=table.wrap(sum(widths),top)
    table.drawOn(c,x,top-9-height)
    return top-9-height

def product_rows(d,spec):
    from colors import NEON_COLORS
    translations={v['name'].lower():v['english'] for v in NEON_COLORS}
    translations['hellblau']='Light blue'
    colors=spec['colors'][:80]
    english=re.sub(r'[\w]+(?: Pink)?',lambda m:translations.get(m[0].lower(),m[0]),colors)
    shape=d['settings']['shape']
    rows=[]
    for key,label in [('auto_minimum_mm','Minimum checked width / Kleinste geprüfte Breite'),
                      ('minimum_width_mm','Manual minimum / Mindestbreite (manuell)')]:
        if key=='minimum_width_mm' and spec.get('manual_height_mm') is not None:
            rows.append(('Manual minimum height / Mindesthöhe (manuell)',de(spec['manual_height_mm']/10)+' cm'))
        elif spec.get(key) is not None:
            rows.append((label,de(spec[key]/10)+' cm'))
    if d.get('acrylicSplit'):
        rows.append(('Acrylic parts / Acrylteile',str(len(d['acrylicSplit']['pieces']))))
    return rows+[
        ('Product type / Produktart','LED Neon Flex'),
        ('Material','Silicone / Silikon'),
        ('Backboard cut / Zuschnitt',{'shape':'Cut to shape','rectangle':'Rectangle','bottom':'Bottom only'}[shape]+' / '+CUT[shape]),
        ('Use / Einsatz',{'Innen':'Indoor / Innen','Außen':'Outdoor / Außen'}[spec['usage']]),
        ('Light colour / Leuchtfarbe',english+'\n'+colors if english!=colors else colors),
        ('Quantity / Anzahl',str(spec.get('quantity',1))),
        ('Neon length / Neon-Länge',de(d['neonMeters'],1)+' m'),
        ('Final neon length / Endgültige Neonlänge (+10 %)',de(d['neonMaterialMeters'],1)+' m'),
        ('Acrylic margin / Acrylrand',de(d['settings']['gap'])+' mm')]

def quote_pdf(variants,spec,motif=None):
    output=io.BytesIO();c=Canvas(output,pagesize=(600,760))
    quotes=[]
    for i,d in enumerate(variants):
        q=price(d,spec);quotes.append(q)
        c.setFillColor(HexColor('#21374A'))
        c.setFont('Helvetica-Bold',18)
        c.drawString(36,720,'Auto Quote · Entwurf' if spec.get('download_draft') else 'Auto Quote')
        option=f'Option {i+1}' if len(variants)>1 else None
        title=' · '.join(filter(None,[spec['customer_name'][:70],motif,option]))
        c.setFont('Helvetica',min(12,528*12/max(1,c.stringWidth(title,'Helvetica',12))))
        c.drawString(36,698,title)
        scale=min(476/d['width'],248/d['height'])
        left=(600-d['width']*scale)/2
        artwork(c,d,left,403,476/mm,248/mm)
        dimensions(c,d,left,403,476/mm,248/mm)
        quote_table(c,36,375,[193,130],'Product Details / Produkt Details',product_rows(d,spec))
        costs=[(label,q[key]+' USD') for label,key in [
            ('Production / Produktion','production_usd'),('Shipping / Versand','shipping_usd'),
            ('Total / Gesamt','total_usd')]]
        bottom=quote_table(c,385,375,[112,67],'Costs (Kosten)',costs,True)
        if any(a in q['assumptions'] for a in ('uv_print_rate_provisional','controller_rate_provisional')):
            extras=[]
            if q['items'][0]['uv_print']:extras.append('UV print / UV-Druck: 30 USD')
            if q['items'][0]['controllers']:extras.append(str(q['items'][0]['controllers'])+' × Controller: 15 USD')
            c.setFont('Helvetica',8)
            for j,note in enumerate(['Included per sign / Enthalten je Schild',*extras]):
                c.drawString(385,bottom-15-12*j,note)
        c.setFont('Helvetica',9)
        c.drawString(36,44,'Please review the design before production and approval. / Vor Produktion und Freigabe bitte das Design prüfen.')
        c.showPage()
    c.save()
    name=re.sub(r'[^\w-]+','_',spec['customer_name'],flags=re.U).strip('_')[:80] or 'Kunde'
    return ('auto_quote_'+name+'.pdf','application/pdf',output.getvalue()),quotes


def quote_image(pdf):
    doc=fitz.open(stream=pdf,filetype='pdf')
    pages=[]
    for page in doc:
        pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
        pages.append(Image.frombytes('RGB',[pix.width,pix.height],pix.samples))
    combined=Image.new('RGB',(max(p.width for p in pages),sum(p.height for p in pages)),'white');y=0
    for p in pages:combined.paste(p,(0,y));y+=p.height
    image=io.BytesIO();combined.save(image,'PNG')
    return ('image.png','image/png',image.getvalue())


def artifacts(variants,spec,motif=None):
    pdf,quotes=quote_pdf(variants,spec,motif)
    return [pdf,quote_image(pdf[2]),('technische_zeichnung.jpg','image/jpeg',technical_image(variants[0]))],quotes


def technical_image(d):
    w=1600;h=max(500,min(2300,round(w*d['height']/d['width']+160)))
    out=io.BytesIO();c=Canvas(out,pagesize=(w,h))
    c.setFont('Helvetica',48);c.drawCentredString(w/2,h-66,'Technische Zeichnung')
    artwork(c,d,45,40,(w-90)/mm,(h-160)/mm,True);c.showPage();c.save()
    technical=fitz.open(stream=out.getvalue(),filetype='pdf')[0].get_pixmap(alpha=False)
    jpeg=io.BytesIO();Image.frombytes('RGB',[technical.width,technical.height],technical.samples).save(jpeg,'JPEG',quality=95,subsampling=0)
    return jpeg.getvalue()


def selected_download(drawing,options,store,model,settings):
    from zipfile import ZipFile, ZIP_DEFLATED
    from xml.etree import ElementTree as ET
    from geometry import path_d
    from export_pdf import make_pdf

    formats=options.get('formats')
    allowed={'svg','drawing','custom','cnc','uv','technical','quote','preview'}
    if not isinstance(formats,list) or not formats or not all(isinstance(k,str) and k in allowed for k in formats) or len(set(formats))!=len(formats):
        raise ValueError('Bitte die gewünschten Dateien auswählen.')
    if not drawing['exportable']:
        raise ValueError('Die Zeichnung ist noch nicht bereit.')
    files=[]
    if 'svg' in formats:
        w,h=drawing['width'],drawing['height']
        x,y=drawing['bounds'][:2]
        svg=ET.Element('svg',xmlns='http://www.w3.org/2000/svg',width=f'{w}mm',height=f'{h}mm',viewBox=f'{x} {y} {w} {h}',fill='none')
        acrylic=ET.SubElement(svg,'g',id='Acryl',stroke='#555555')
        ET.SubElement(acrylic,'path',d=drawing['outerData'])
        for seam in (drawing.get('acrylicSplit') or {}).get('seams',[]):
            ET.SubElement(acrylic,'path',d=path_d(seam))
        neon=ET.SubElement(svg,'g',id='Neon')
        for path,color in zip(drawing['pathData'],drawing['pathColors']):
            ET.SubElement(neon,'path',d=path,stroke=color['color'])
        files.append(('Zeichnung.svg','image/svg+xml',ET.tostring(svg,encoding='utf-8',xml_declaration=True)))
    for kind,label in [('drawing','Masszeichnung'),('custom','Zeichnung_mit_Angaben'),('cnc','CNC'),('uv','UV-Druck')]:
        if kind in formats:
            files.append((label+'.pdf','application/pdf',make_pdf(drawing,{**(options.get('pdfOptions',{}) if kind=='custom' else {}),'kind':kind})))
    if 'quote' in formats or 'preview' in formats:
        from cloud_ai import validate_spec
        # A download documents the current preview, including provisional choices.
        # Publishing still validates outstanding review items on the project.
        source=options['spec']
        widths=(source.get('widths_mm') or [drawing['width']]) if 'quote' in formats else [drawing['width']]
        spec=validate_spec({**source,'issues':[],'widths_mm':widths})
        spec['download_draft']=bool(source.get('issues'))
        if 'quote' in formats:
            from minimum_size import PROFILE
            variants=[]
            for width in widths:
                if abs(width-drawing['width'])<.001:
                    variant=drawing
                else:
                    options_at_width={**settings,**PROFILE,'width':width}
                    variant=store.drawing(model,json.dumps(options_at_width,sort_keys=True))
                if not variant['exportable'] or abs(variant['width']-width)>.1:
                    raise ValueError('Eine Angebotsgröße konnte nicht gezeichnet werden.')
                variants.append(variant)
            pdf,_=quote_pdf(variants,spec,options.get('motif'))
            files.append(pdf)
        if 'preview' in formats:
            if 'quote' not in formats or len(widths)!=1 or abs(widths[0]-drawing['width'])>=.001:
                pdf,_=quote_pdf([drawing],spec,options.get('motif'))
            files.append(quote_image(pdf[2]))
    if 'technical' in formats:
        files.append(('technische_zeichnung.jpg','image/jpeg',technical_image(drawing)))
    if len(files)==1:return files[0]
    output=io.BytesIO()
    with ZipFile(output,'w',compression=ZIP_DEFLATED) as archive:
        for name,_,data in files:archive.writestr(name,data)
    return 'Neon_Studio.zip','application/zip',output.getvalue()
