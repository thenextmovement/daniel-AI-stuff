"""Confidential LED Neon Flex procurement estimate, source revision 2026-10-21.

Pure standard-library calculator shared verbatim with local Neon Studio.
Inputs are raw installed neon meters, NEVER the displayed length including reserve.
Includes an internal retail indication by owner-approved nominal factor; no quotation, FX conversion or communication side effect.
"""
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_HALF_UP
import json
import sys

VERSION = '2026-11-09.1'
MINIMUM_SHIPPING_USD = Decimal(45)
RATES = {'single':Decimal(14), 'rgb':Decimal(20), 'chasing_rgb':Decimal(28)}

def decimal(value, name, minimum=0, maximum=100000):
    if isinstance(value, bool) or not isinstance(value, (int,float,str,Decimal)):
        raise ValueError(f'{name}: Zahl erforderlich.')
    try:d=Decimal(str(value))
    except InvalidOperation:raise ValueError(f'{name}: ungültige Zahl.')
    if not d.is_finite() or d<minimum or d>maximum:raise ValueError(f'{name}: außerhalb des gültigen Bereichs.')
    return d

def money(value):return str(value.quantize(Decimal('.01'),rounding=ROUND_HALF_UP))
def whole(value):return value.to_integral_value(rounding=ROUND_CEILING)
def number(value):return format(value.normalize(),'f')

def drawing_price(drawing,options):
    item={'width_cm':drawing['width']/10,'height_cm':drawing['height']/10,
          'neon_m':drawing['neonMeters'],'color':options.get('color','single'),
          'outdoor':options.get('outdoor',False),'waterproof_psus':options.get('waterproof_psus',0),
          'uv_print':bool(drawing.get('uv')) or options.get('uv_print',False),'controllers':options.get('controllers',0)}
    mode=options.get('mode','single')
    if mode not in ('single','pair','split'):raise ValueError('Unbekannte Paketoption.')
    request={'items':[item,item.copy()] if mode=='pair' else [item],
             'packing':'stacked' if mode=='pair' else 'split' if mode=='split' else 'separate',
             'sales_factor':options.get('sales_factor','2.3'),
             'minimum_shipping_usd':options.get('minimum_shipping_usd',45),
             'additional_cost_usd':options.get('additional_cost_usd',0)}
    if mode=='split':request['footprint_cm']=options.get('footprint_cm')
    return calculate(request)

def calculate(request):
    allowed={'items','packing','footprint_cm','minimum_shipping_usd','additional_cost_usd','sales_factor'}
    if not isinstance(request,dict) or set(request)-allowed:raise ValueError('Unbekannte Kalkulationsfelder.')
    items=request.get('items')
    if not isinstance(items,list) or not 1<=len(items)<=2:raise ValueError('Ein oder zwei Schilder erforderlich; weitere Pakete separat kalkulieren.')
    packing=request.get('packing','separate')
    if packing not in ('separate','stacked','split'):raise ValueError('Unbekannte Verpackungsart.')
    if (packing=='stacked' and len(items)!=2) or (packing=='split' and len(items)!=1):raise ValueError('Stapel: zwei Schilder. Geteilt: ein Schild aus zwei Teilen.')
    minimum=max(MINIMUM_SHIPPING_USD,decimal(request.get('minimum_shipping_usd',MINIMUM_SHIPPING_USD),'Mindestversand'))
    extra=decimal(request.get('additional_cost_usd',0),'Zusatzkosten')
    sales_factor=decimal(request.get('sales_factor','2.3'),'Verkaufsfaktor',Decimal('.01'),100)
    rows=[];dims=[];production=Decimal(0)
    assumptions=['loss_factor_1_1_once','padding_10cm_per_dimension','usd_per_kg_12_approximate','oversize_once_per_package','actual_weight_unknown','supplier_quote_required']
    if extra:assumptions.append('manual_additional_cost')
    for i,item in enumerate(items):
        if not isinstance(item,dict) or set(item)-{'width_cm','height_cm','neon_m','color','outdoor','waterproof_psus','uv_print','controllers'}:raise ValueError('Unbekannte Schildfelder.')
        width=decimal(item.get('width_cm'),'Breite',Decimal('.01'),2000)
        height=decimal(item.get('height_cm'),'Höhe',Decimal('.01'),2000)
        meters=decimal(item.get('neon_m'),'Neonmeter',0,10000)
        color=item.get('color','single')
        if color not in RATES:raise ValueError('Farbe: single, rgb oder chasing_rgb.')
        outdoor=item.get('outdoor',False)
        if not isinstance(outdoor,bool):raise ValueError('Outdoor muss true oder false sein.')
        if outdoor and 'waterproof_psus' not in item:raise ValueError('Outdoor: Anzahl wasserdichter Netzteile angeben.')
        psus=decimal(item.get('waterproof_psus',0),'Wasserdichte Netzteile',0,100)
        if psus!=psus.to_integral_value() or (not outdoor and psus):raise ValueError('Netzteile: ganze Anzahl, nur für Outdoor.')
        if outdoor and psus<1:assumptions.append('outdoor_supply_excluded')
        factor=Decimal('1.2') if outdoor else Decimal(1)
        material=meters*Decimal('1.1')
        flex=material*RATES[color]*factor
        supply=psus*25
        uv=item.get('uv_print',False)
        if not isinstance(uv,bool):raise ValueError('UV-Druck muss true oder false sein.')
        controllers=decimal(item.get('controllers',0),'Controller',0,100)
        if controllers!=controllers.to_integral_value():raise ValueError('Controller: ganze Anzahl erforderlich.')
        uv_cost=Decimal(30 if uv else 0);controller_cost=controllers*15
        if uv:assumptions.append('uv_print_rate_provisional')
        if controllers:assumptions.append('controller_rate_provisional')
        cost=flex+supply+uv_cost+controller_cost;production+=cost;dims.append((width,height))
        rows.append({'item':i+1,'width_cm':number(width),'height_cm':number(height),'neon_m':number(meters),
                     'material_m':number(material),'color':color,'rate_usd_m':number(RATES[color]),
                     'outdoor':outdoor,'outdoor_factor':number(factor),'waterproof_psus':int(psus),
                     'flex_usd':money(flex),'psu_usd':money(supply),'uv_print':uv,'uv_print_usd':money(uv_cost),
                     'controllers':int(controllers),'controller_usd':money(controller_cost),'production_usd':money(cost)})
    override=request.get('footprint_cm')
    if packing=='split' and override is None:raise ValueError('Bei Teilung die tatsächlichen Stapelmaße angeben.')
    if override is not None:
        if packing=='separate' or not isinstance(override,list) or len(override)!=2:raise ValueError('Stapel-Grundfläche: Breite und Höhe in cm.')
        footprint=tuple(decimal(v,'Stapelmaß',Decimal('.01'),2000) for v in override)
        if packing=='stacked' and any(footprint[n]<max(d[n] for d in dims) for n in (0,1)):
            raise ValueError('Stapelmaße dürfen die angegebenen Schilder nicht unterschreiten.')
    else:footprint=tuple(max(d[n] for d in dims) for n in (0,1))
    bases=dims if packing=='separate' else [footprint]
    thickness=Decimal(6 if packing=='separate' else 10)
    packages=[];shipping=Decimal(0)
    for w,h in bases:
        dimensions=(w+10,h+10,thickness)
        weight=dimensions[0]*dimensions[1]*dimensions[2]/5000
        base=weight*12
        oversize=Decimal(20 if max(dimensions)>120 else 0)
        charge=max(base,minimum)+oversize;shipping+=charge
        packages.append({'dimensions_cm':[number(v) for v in dimensions],'volume_kg':number(weight),
                         'freight_usd':money(base),'minimum_usd':money(minimum),'oversize_usd':money(oversize),
                         'shipping_usd':money(charge)})
    production=whole(production)
    shipping=whole(shipping)
    extra=whole(extra)
    total=production+shipping+extra
    return {'version':VERSION,'classification':'confidential_internal','estimate':True,'currency':'USD',
            'items':rows,'packing':packing,'packages':packages,'production_usd':str(production),
            'shipping_usd':str(shipping),'additional_cost_usd':str(extra),
            'total_usd':str(total),
            'customer_price':{'amount_eur':str(whole(total*sales_factor)),
                              'factor':number(sales_factor),'method':'USD-Zahlenwert × Faktor = EUR-Richtpreis; keine Wechselkursumrechnung',
                              'tax_status':'nicht festgelegt','binding':False},
            'assumptions':list(dict.fromkeys(assumptions)),
            'not_priced':['Sonderacryl und Montagezubehör','Indoor-Netzteil: keine separate bestätigte Rate',
                          'Zoll, Einfuhrabgaben, Steuern und Weitertransport','Gewichtsaufrundung und tatsächliches Paketgewicht ungeklärt'],
            'source':'Quentin-Preissheet + interne Ergänzungen Rahim; Mindestfracht 45 USD und +10 cm je Außenmaß bestätigt 04.11.2026; UV 30 USD und Controller 15 USD vorläufig'}

if __name__=='__main__':
    try:print(json.dumps(calculate(json.load(sys.stdin)),ensure_ascii=False))
    except (ValueError,TypeError) as error:
        print(json.dumps({'error':str(error)},ensure_ascii=False));sys.exit(1)
