#!/usr/bin/env python3
"""Build six product entries from the existing configurator; never submit a feed."""
from pathlib import Path
import html,json,re,xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[2]
DEST=ROOT/'deploy/configurator'
ORIGIN='https://anfrage.neontrip.de/configurator/'
products=json.loads((DEST/'shopping-products.json').read_text())
source=(DEST/'index.html').read_text()
assert all(f'id="{anchor}"' in source for anchor in ['config-ar','config-delivery-info'])
assert len(products)==6 and len({p['id'] for p in products})==6
ns='http://base.google.com/ns/1.0';ET.register_namespace('g',ns)
rss=ET.Element('rss',{'version':'2.0'});channel=ET.SubElement(rss,'channel')
for key,value in [('title','NEONTRIP Konfigurator'),('link',ORIGIN),('description','Sechs personalisierbare LED-Neon-Schriftzüge')]:ET.SubElement(channel,key).text=value
esc=lambda s:html.escape(str(s),quote=True)
for p in products:
 assert re.fullmatch(r'nt-cfg-[a-z0-9-]+',p['id']) and re.fullmatch(r'neon-[a-z0-9-]+',p['slug'])
 assert isinstance(p['priceCents'],int) and p['priceCents']>0
 price=f"{p['priceCents']/100:.2f}";price_de=price.replace('.',',')+' €'
 dimensions=f"{p['widthMm']/10:g} × {p['heightMm']/10:.1f} cm".replace('.',',')
 mount='Drahtseil-Abhängeset' if p['mount']=='hanging-kit' else 'Wandmontage-Set'
 included='Dimmer mit Fernbedienung, Premium-Netzteil, 2 m Anschlusskabel und Wandmontage-Set'
 if p['mount']=='hanging-kit':included+=', zusätzlich ein Drahtseil-Abhängeset'
 headline=f"„{p['text']}“ als LED-Neon-Schriftzug"
 description=f"LED-Neon-Schriftzug mit dem Beispieltext „{p['text']}“, Schrift {p['font']}, {dimensions} Außenmaß, {p['colorName']}, transparente Acrylplatte im Formzuschnitt, für innen. Enthalten: {included}. Text, Schrift, Farbe und Größe im Konfigurator anpassbar; der Preis wird neu berechnet."
 url=ORIGIN+p['slug'];image=ORIGIN+p['image']
 images=[p['image']]+p['additionalImages']
 assert all((DEST/path).is_file() for path in images)
 gallery=''.join(f'<button type="button" data-shopping-image="{esc(path)}" aria-label="{label}" aria-pressed="{str(i==0).lower()}"><img src="{esc(path)}" alt="" width="54" height="54" loading="lazy"></button>' for i,(path,label) in enumerate(zip(images,['Produktansicht','Ansicht im Raum','Lichtdetail'])))
 schema={'@context':'https://schema.org','@type':'Product','name':p['name'],'sku':p['id'],'brand':{'@type':'Brand','name':'NEONTRIP'},'description':description,'image':[ORIGIN+path for path in images],'color':p['colorName'],'material':'LED-Neon-Flex auf transparenter Acrylplatte','offers':{'@type':'Offer','url':url,'priceCurrency':'EUR','price':price,'availability':'https://schema.org/InStock','itemCondition':'https://schema.org/NewCondition','seller':{'@type':'Organization','name':'NEONTRIP'}}}
 card=f'''<section class="shopping-offer config-container" aria-labelledby="shopping-title">
<figure class="shopping-media"><img id="shopping-hero" src="{esc(p['image'])}" alt="{esc(p['text'])} – LED-Neon in {esc(p['colorName'])}, Schrift {esc(p['font'])}" width="1254" height="1254" fetchpriority="high"><div class="shopping-gallery" role="group" aria-label="Produktansichten">{gallery}</div><figcaption>Visualisierungen der Ausgangskonfiguration.</figcaption></figure>
<div><p class="config-kicker">PERSONALISIERTER LED-NEON-SCHRIFTZUG</p><h1 id="shopping-title">{esc(headline)}</h1>
<div class="shopping-price"><span id="shopping-selection">Preis der Ausgangskonfiguration</span><strong id="shopping-current-price">{price_de}</strong><small>Inkl. 19 % MwSt. und Standardlieferung nach Deutschland.</small></div>
<div class="shopping-actions"><button id="shopping-buy" type="button" disabled>In den Warenkorb</button><button id="shopping-edit" type="button">Eigenen Text gestalten</button></div>
<p>So bestellen oder deinen eigenen Text gestalten. Du siehst den Preis deiner Auswahl direkt im Konfigurator.</p>
<ul class="shopping-specs"><li>{esc(dimensions)}</li><li>{esc(p['colorName'])}</li><li>{esc(mount)}</li><li>Für innen</li></ul>
<p><strong>Abgebildete Ausgangskonfiguration:</strong> „{esc(p['text'])}“ in {esc(p['font'])}, transparente Trägerplatte im Formzuschnitt.</p>
<p>Inklusive {esc(included)}.</p><p>Standardlieferung: voraussichtlich 15 Werktage ab Bestellung bzw. Zahlungseingang bis zur Zustellung. Versand aus Deutschland. Dringend? Frühere Termine und Express-Aufpreise siehst du im Lieferkalender.</p>
<div class="shopping-links"><a href="#config-ar">Bei dir mit AR ansehen</a><a href="#config-delivery-info">Express-Termin prüfen</a></div>
<div class="shopping-recovery"><button id="shopping-resume" type="button" hidden>Letzte Anpassung dieses Angebots öffnen</button><a id="shopping-original" href="/configurator/" hidden>Zu deinem bisherigen Entwurf</a></div><p id="shopping-status" role="status"></p>
<noscript><p>Aktiviere JavaScript, um dieses Schild zu bestellen oder anzupassen.</p></noscript></div></section>'''
 page=re.sub(r'<section class="nt-splash".*?</section>','',source,count=1,flags=re.S)
 page=re.sub(r'<title>.*?</title>',f"<title>{esc(p['name'])} | NEONTRIP</title>",page,count=1)
 page=re.sub(r'<meta name="description" content="[^"]*"\s*/?>',f'<meta name="description" content="{esc(description)}">',page,count=1)
 page=page.replace('href="https://anfrage.neontrip.de/configurator/"','href="'+url+'"',1)
 for prop,value in [('og:title',p['name']),('og:description',description),('og:url',url),('og:image',image),('og:image:alt',p['text']+' – '+p['colorName'])]:
  page=re.sub(r'<meta property="'+prop+r'" content="[^"]*">',f'<meta property="{prop}" content="{esc(value)}">',page,count=1)
 # Replace generic page metadata with this concrete Product and Offer.
 page=re.sub(r'<script type="application/ld\+json">.*?</script>',lambda _: '<script type="application/ld+json">'+json.dumps(schema,ensure_ascii=False).replace('<','\\u003c')+'</script>',page,count=1,flags=re.S)
 page=page.replace('</head>','<link rel="stylesheet" href="shopping-entry.css?v=20261008-shopping1">\n<script type="application/json" id="shopping-offer">'+json.dumps(p,ensure_ascii=False).replace('<','\\u003c')+'</script></head>',1)
 page=re.sub(r'<section class="config-intro config-container".*?</section>',lambda _:card,page,count=1,flags=re.S)
 page=page.replace('<h1 id="page-heading">Gestalte deinen Neon<br> LED-Leuchtschriftzug</h1>','<h2 id="page-heading">Gestalte deinen Neon<br> LED-Leuchtschriftzug</h2>')
 page=re.sub(r'(<textarea id="sign-text"[^>]*>).*?(</textarea>)',lambda m:m[1]+esc(p['text'])+m[2],page,count=1,flags=re.S)
 (DEST/(p['slug']+'.html')).write_text(page)
 item=ET.SubElement(channel,'item')
 fields={'id':p['id'],'link':url,'image_link':image,'availability':'in_stock','price':price+' EUR','condition':'new','brand':'NEONTRIP','identifier_exists':'no','color':p['colorName'],'size':dimensions,'material':'LED-Neon-Flex / Acryl','product_type':'Leuchtschilder > Personalisierte LED-Neon-Schriftzüge > '+p['family'],'custom_label_0':'nt_configurator_shopping','custom_label_1':p['family'],'included_destination':'Shopping_ads'}
 for key,value in fields.items():ET.SubElement(item,'{'+ns+'}'+key).text=value
 # These six offers are prepared for the paused Shopping campaign only.
 ET.SubElement(item,'{'+ns+'}excluded_destination').text='Free_listings'
 for key,value in [('structured_title',p['name']),('structured_description',description)]:
  entry=ET.SubElement(item,'{'+ns+'}'+key)
  ET.SubElement(entry,'{'+ns+'}digital_source_type').text='trained_algorithmic_media'
  ET.SubElement(entry,'{'+ns+'}content').text=value
 for path in p['additionalImages']:ET.SubElement(item,'{'+ns+'}additional_image_link').text=ORIGIN+path
 shipping=ET.SubElement(item,'{'+ns+'}shipping')
 for key,value in [('country','DE'),('service','Standard'),('price','0.00 EUR')]:ET.SubElement(shipping,'{'+ns+'}'+key).text=value
ET.indent(rss)
(DEST/'shopping-feed.xml').write_bytes(ET.tostring(rss,encoding='utf-8',xml_declaration=True))
print('Built 6 product entries and one feed. No publication or submission performed.')
