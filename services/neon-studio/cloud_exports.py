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
    for edge in (x,x+w):c.line(edge,top-3,edge,top+3)
    c.drawCentredString(x+w/2,top+5,de(d['width']/10)+' cm')
    c.line(left,y,left,y+h)
    for edge in (y,y+h):c.line(left-3,edge,left+3,edge)
    c.translate(left-5,y+h/2);c.rotate(90);c.drawCentredString(0,0,de(d['height']/10)+' cm')
    c.restoreState()
def artifacts(variants,spec):
    output=io.BytesIO();c=Canvas(output,pagesize=(600,760))
    quotes=[]
    for i,d in enumerate(variants):
        q=price(d,spec);quotes.append(q)
        c.setFont('Helvetica',12);c.drawString(36,726,'AUTO QUOTE · '+spec['customer_name'][:70])
        c.setFont('Helvetica',10);c.drawString(36,704,'Variante %d · %s × %s cm'%(i+1,de(d['width']/10),de(d['height']/10)))
        if spec.get('minimum_width_mm') is not None:
            c.setFont('Helvetica',9);c.drawString(36,688,'Mindestbreite (manuell): '+de(spec['minimum_width_mm']/10)+' cm')
        if spec.get('auto_minimum_mm') is not None:
            c.setFont('Helvetica',9);c.drawString(36,672,'Kleinste geprüfte Breite mit 8-mm-Neonflex: '+de(spec['auto_minimum_mm']/10)+' cm')
        artwork(c,d,58,440,506/mm,218/mm)
        dimensions(c,d,58,440,506/mm,218/mm)
        entries=[('Produkt','LED Neon Flex'),('Material','Silikon'),('Zuschnitt',CUT[d['settings']['shape']]),
                 ('Usage',spec['usage']),('Leuchtfarbe',spec['colors']),('Anzahl',str(spec.get('quantity',1))),
                 ('Neon-Fahrlänge je Schild',de(d['neonMeters'],3)+' m'),
                 ('Material je Schild inkl. 10 %',de(d['neonMaterialMeters'],3)+' m'),
                 ('Randabstand',de(d['settings']['gap'])+' mm'),
                 ('Produktion',de(q['production_usd'])+' USD'),('Versand ca.',de(q['shipping_usd'])+' USD'),('Gesamt EK ca.',de(q['total_usd'])+' USD')]
        for j,(key,value) in enumerate(entries):
            c.setFont('Helvetica',12);c.drawString(36,408-j*25,key+': '+value[:80])
        if any(a in q['assumptions'] for a in ('uv_print_rate_provisional','controller_rate_provisional')):
            extra=[]
            if q['items'][0]['uv_print']:extra.append('UV-Druck 30 USD je Schild')
            if q['items'][0]['controllers']:extra.append(str(q['items'][0]['controllers'])+' Controller je 15 USD je Schild')
            c.setFont('Helvetica',9);c.drawString(36,81,'Enthalten, vorläufig: '+', '.join(extra))
        c.setFont('Helvetica',9);c.drawString(36,58,'Interner Entwurf · Kosten nach hinterlegter Formel geschätzt.')
        c.drawString(36,43,'Vor Produktion: Pfadführung, Biegeradien und Lieferantenpreis prüfen.')
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
