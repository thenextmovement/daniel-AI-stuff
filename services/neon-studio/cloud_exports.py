"""All three quote artifacts derive from the same measured drawing."""
import io,re
from decimal import Decimal
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
import fitz
from PIL import Image
from export_pdf import _paint
from neon_pricing import calculate
def de(value,places=2):return f'{float(value):.{places}f}'.replace('.',',')
CUT={'shape':'Formzuschnitt','rectangle':'Rechteck','bottom':'Nur unten'}
def price(drawing,spec):
    q=calculate({'items':[{'width_cm':drawing['width']/10,'height_cm':drawing['height']/10,
        'neon_m':drawing['neonMeters'],'color':spec.get('light_type','single'),
        'outdoor':spec['usage']=='Außen','waterproof_psus':spec.get('waterproof_psus',0),
        'uv_print':bool(drawing.get('uv')) or spec.get('uv_print',False),'controllers':spec.get('controllers',0)}],
        'packing':'separate','minimum_shipping_usd':45,'additional_cost_usd':0,'sales_factor':2.3})
    quantity=spec.get('quantity',1)
    for key in ('production_usd','shipping_usd','total_usd'):
        q[key]=format(Decimal(q[key])*quantity,'.2f')
    q['quantity']=quantity
    if quantity>1:q['assumptions'].append('quantity_separate_packages')
    return q
def artwork(c,d,x,y,width,height,technical=False):
    scale=min(width/d['width'],height/d['height'])
    c.saveState();c.translate(x,y);c.scale(scale,scale)
    bx,by=d['bounds'][:2]
    _paint(c,d['outer'],-bx,d['height']+by,'#333333',max(.12,.3/scale/mm))
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
        if spec.get(key) is not None:
            rows.append((label,de(spec[key]/10)+' cm'))
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

def artifacts(variants,spec,motif=None):
    output=io.BytesIO();c=Canvas(output,pagesize=(600,760))
    quotes=[]
    for i,d in enumerate(variants):
        q=price(d,spec);quotes.append(q)
        c.setFillColor(HexColor('#21374A'))
        c.setFont('Helvetica-Bold',18)
        c.drawString(36,720,'Auto Quote')
        title=' · '.join(filter(None,[spec['customer_name'][:70],motif,'Option '+str(i+1)]))
        c.setFont('Helvetica',min(12,528*12/max(1,c.stringWidth(title,'Helvetica',12))))
        c.drawString(36,698,title)
        scale=min(476/d['width'],248/d['height'])
        left=(600-d['width']*scale)/2
        artwork(c,d,left,403,476/mm,248/mm)
        dimensions(c,d,left,403,476/mm,248/mm)
        quote_table(c,36,375,[193,130],'Product Details / Produkt Details',product_rows(d,spec))
        costs=[(label,de(q[key])+' USD') for label,key in [
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
    c.save();pdf=output.getvalue()
    doc=fitz.open(stream=pdf,filetype='pdf')
    pages=[]
    for page in doc:
        pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
        pages.append(Image.frombytes('RGB',[pix.width,pix.height],pix.samples))
    combined=Image.new('RGB',(max(p.width for p in pages),sum(p.height for p in pages)),'white');y=0
    for p in pages:combined.paste(p,(0,y));y+=p.height
    image=io.BytesIO();combined.save(image,'PNG')
    d=variants[0];w=1600;h=max(500,min(2300,round(w*d['height']/d['width']+160)))
    out=io.BytesIO();c=Canvas(out,pagesize=(w,h))
    c.setFont('Helvetica',48);c.drawCentredString(w/2,h-66,'Technische Zeichnung')
    artwork(c,d,45,40,(w-90)/mm,(h-160)/mm,True);c.showPage();c.save()
    technical=fitz.open(stream=out.getvalue(),filetype='pdf')[0].get_pixmap(alpha=False)
    jpeg=io.BytesIO();Image.frombytes('RGB',[technical.width,technical.height],technical.samples).save(jpeg,'JPEG',quality=95,subsampling=0)
    name=re.sub(r'[^\w-]+','_',spec['customer_name'],flags=re.U).strip('_')[:80] or 'Kunde'
    return [('auto_quote_'+name+'.pdf','application/pdf',pdf),('image.png','image/png',image.getvalue()),('technische_zeichnung.jpg','image/jpeg',jpeg.getvalue())],quotes
