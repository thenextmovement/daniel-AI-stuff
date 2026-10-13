"""Build the independent local remix. No network, deployment or form service."""
from pathlib import Path
from hashlib import sha256
import re
import json
import subprocess
from html import escape

ROOT = Path(__file__).resolve().parent
SOURCES = ROOT / 'sources'
PUBLIC_URL = 'https://anfrage.neontrip.de/neonschild/anfrage'
TITLE = 'LED-Neonschild mit Logo anfertigen lassen | NEONTRIP'
DESCRIPTION = 'Individuelle LED-Neonschilder für Ihre Marke. Design hochladen, kostenlose 3D-Vorschau erhalten und unverbindlich anfragen. Persönliche Beratung von NEONTRIP.'
SOCIAL_IMAGE = 'https://anfrage.neontrip.de/assets/images/projekte/wella-sonderanfertigung.webp'
MODULES = {
    'hero': ('led-neon-usecases-v2', '.nt-usecases'),
    'facts': ('service-panel', '.nt-service'),
    'gallery4': ('gallery4', None),
    'inquiry': ('inquiry-b', None),
    'process': ('process-four-steps', '.nt-steps'),
    'videos': ('customer-video-proof', None),
    'express': ('express-chat', '.nt-express'),
    'material': ('material-montage', '.nt-material'),
    'classic': ('contact-classic', None),
}

def live_assets(text):
    return re.sub(r'(?<![\w/])(?:\.\./|/)?assets/', 'assets/live/assets/', text)

def minify(source, loader, content=None):
    result = subprocess.run(['node', str(ROOT / 'minify-assets.cjs')],
                            input=json.dumps([{'source': source, 'loader': loader, 'content': content}]),
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)[0].strip()

html, css, js = {}, [], []
for key, (module, selector) in MODULES.items():
    src = SOURCES / module
    # Frozen module sources remain editable here; original modules are untouched.
    fragment = (src / 'section.html').read_text()
    fragment = re.sub(r'(?<=["\s])assets/', f'assets/modules/{module}/', fragment)
    if key == 'hero':
        fragment = fragment.replace('<a href="#anfrage">Kontakt</a>', '<a href="#kontakt">Kontakt</a>')
        for logo in (ROOT / 'assets/modules/led-neon-usecases-v2/logos').glob('*.svg'):
            optimized_logo = logo.parent / 'optimized' / logo.name
            optimized_logo.parent.mkdir(exist_ok=True)
            optimized_logo.write_text(minify(logo.read_text(), 'svg'))
        fragment = fragment.replace('/logos/', '/logos/optimized/')
        # These two detailed logos are smaller as lossless 600px WebP exports.
        for logo in ('1', '11'):
            fragment = fragment.replace(f'/logos/optimized/{logo}.svg', f'/logos/{logo}.webp')
        # Same photography and framing, smaller AVIF transfer with WebP fallback.
        def hero_picture(match):
            image = match.group(0)
            source = re.search(r'(data-)?srcset="([^"]+)"', image)
            sizes = re.search(r'sizes="([^"]+)"', image).group(1)
            return ('<picture><source type="image/avif" ' + (source.group(1) or '') +
                    'srcset="' + source.group(2).replace('.webp', '.avif') +
                    '" sizes="' + sizes + '">' + image + '</picture>')
        fragment = re.sub(r'<img class="nt-usecases__image[^>]+>', hero_picture, fragment)
    for other, _ in MODULES.values():
        fragment = fragment.replace(f'../{other}/assets/', f'assets/modules/{other}/')
    fragment = fragment.replace('../../media/video-posters/', 'assets/media/video-posters/')
    if key in ('inquiry', 'process', 'classic'):
        def nearby_image(match):
            image = match.group(0)
            if 'loading="lazy"' not in image:
                return image
            deferred = re.sub(r'\bsrc(set)?=', lambda attr: 'data-near-' + attr.group(0), image)
            if 'alt="Google"' in image:
                # Reserve the real logo ratio while this distant image is unloaded.
                deferred = deferred.replace('<img ', '<img src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 184 60\'/%3E" ', 1)
            return deferred + '<noscript>' + image + '</noscript>'
        fragment = re.sub(r'<img\b[^>]+>', nearby_image, fragment)
    if key == 'gallery4':
        photos = json.loads((src / 'photos.json').read_text())
        cards = []
        for photo in photos:
            cards.append(f'<figure><a href="{escape(photo["image"], quote=True)}"><noscript><img src="{escape(photo["thumb"], quote=True)}" alt="{escape(photo["alt"], quote=True)}" width="720" height="720" loading="lazy" decoding="async" fetchpriority="low"></noscript></a><figcaption><strong>{escape(photo["title"])}</strong><span>{escape(photo["category"])}</span><p>{escape(photo.get("description", ""))}</p></figcaption></figure>')
        fragment = fragment.replace('__GALLERY4_FALLBACK__', ''.join(cards))
    html[key] = fragment
    styles = (src / 'section.css').read_text()
    styles = re.sub(r'url\(([\'"]?)assets/', rf'url(\1assets/modules/{module}/', styles)
    css.append(styles)
    script = (src / 'section.js').read_text()
    if key == 'gallery4':
        script = script.replace('__GALLERY4_PHOTOS__', json.dumps(json.loads((src / 'photos.json').read_text()), ensure_ascii=False))
        script = script.replace('__GALLERY4_STYLES__', json.dumps(minify((src / 'gallery.css').read_text(), 'css'), ensure_ascii=False))
    if selector:
        script = script.replace('export default function init', 'function init', 1).replace('export function ', 'function ')
        script = '(()=>{\n' + script + f'\ninit(document.querySelector("{selector}"));\n}})();'
    js.append(script)

for key in ('products', 'faq', 'footer', 'product-modal'):
    html[key] = '<div class="live-scope">' + live_assets((SOURCES / 'live' / f'{key}.html').read_text()) + '</div>'

# Remove only rules absent from the actual page and its runtime templates.
style_content = list(html.values()) + js + [(SOURCES / 'live/product-gallery.js').read_text(),
                                         (ROOT / 'interactions.js').read_text(),
                                         (SOURCES / 'splash-01/section.html').read_text()]

live_css = live_assets((SOURCES / 'live/inline.css').read_text())
# The live texture request fails; preserve the surface without the broken image.
live_css = re.sub(r'url\([\'"]?[^)]*grain-texture\.png[\'"]?\)', 'none', live_css)
tailwind = (ROOT / 'assets/live/assets/css/tailwind.min.css').read_text()
# Live global resets must not restyle the exact approved hero/express modules.
(ROOT / 'live-scoped.css').write_text(minify('@scope (.live-scope) {\n' + tailwind + '\n' + live_css + '\n}\n', 'css', style_content))
# Keep section styles separate for editing, then inline the compact production
# styles in their original cascade order. Async media-switch styles postpone
# the first rendered frame and can race the intro and font layout.
first_screen_css = minify('\n'.join(css[:2]), 'css', style_content)
(ROOT / 'modules.css').write_text(minify('\n'.join(css[2:]), 'css', style_content))
(ROOT / 'modules.js').write_text(minify('\n'.join(js), 'js'))
(ROOT / 'live-products.js').write_text(minify(live_assets((SOURCES / 'live/product-gallery.js').read_text()), 'js'))

# Reuse the approved intro independently of the page modules.
splash = (SOURCES / 'splash-01/section.html').read_text()
for extension in ('css', 'js'):
    (ROOT / f'neontrip-splash.{extension}').write_text(minify((SOURCES / f'splash-01/section.{extension}').read_text(), extension))

def version(file):
    return sha256((ROOT / file).read_bytes()).hexdigest()[:10]

head = '''<!doctype html><html lang="de"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preload" as="image" type="image/avif" href="assets/modules/led-neon-usecases-v2/hero-20260930/01-empfang-aus.avif" imagesrcset="assets/modules/led-neon-usecases-v2/hero-20260930/01-empfang-aus-960.avif 960w, assets/modules/led-neon-usecases-v2/hero-20260930/01-empfang-aus.avif 1672w" imagesizes="(max-width: 767px) 680px, 100vw" fetchpriority="high">
<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#181615">
<meta http-equiv="Content-Security-Policy" content="form-action 'none'; connect-src 'self'">
<link rel="icon" href="assets/favicon.svg">
<link rel="preload" href="assets/modules/led-neon-usecases-v2/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
'''
head += f'<title>{escape(TITLE)}</title>\n<meta name="description" content="{escape(DESCRIPTION, quote=True)}">\n'
head += f'<link rel="canonical" href="{PUBLIC_URL}">\n'
for key, value in {
    'og:type': 'website', 'og:locale': 'de_DE', 'og:site_name': 'NEONTRIP',
    'og:title': TITLE, 'og:description': DESCRIPTION, 'og:url': PUBLIC_URL,
    'og:image': SOCIAL_IMAGE,
    'og:image:alt': 'Pink leuchtendes Wella-Logo über einem Eventstand – ein NEONTRIP-Kundenprojekt',
}.items():
    head += f'<meta property="{key}" content="{escape(value, quote=True)}">\n'
for key, value in {'twitter:card': 'summary_large_image', 'twitter:title': TITLE, 'twitter:description': DESCRIPTION, 'twitter:image': SOCIAL_IMAGE, 'twitter:image:alt': 'Pink leuchtendes Wella-Logo über einem Eventstand'}.items():
    head += f'<meta name="{key}" content="{escape(value, quote=True)}">\n'
organization_id = 'https://neontrip.de/#organization'
structured_data = {'@context': 'https://schema.org', '@graph': [
    {'@type': 'Organization', '@id': organization_id, 'name': 'NEONTRIP', 'legalName': 'Dara Nova GmbH',
     'url': 'https://neontrip.de/', 'logo': 'https://anfrage.neontrip.de/assets/logo_affiliate.webp',
     'telephone': '+49 211 54257240', 'email': 'support@neontrip.de',
     'address': {'@type': 'PostalAddress', 'streetAddress': 'Bilker Allee 29', 'postalCode': '40219', 'addressLocality': 'Düsseldorf', 'addressCountry': 'DE'},
     'sameAs': ['https://www.instagram.com/neontrip.de', 'https://www.linkedin.com/company/neontrip', 'https://www.youtube.com/@neontrip', 'https://www.google.com/maps?cid=2466754384071016120']},
    {'@type': 'WebPage', '@id': PUBLIC_URL + '#webpage', 'url': PUBLIC_URL, 'name': TITLE,
     'description': DESCRIPTION, 'inLanguage': 'de', 'publisher': {'@id': organization_id},
     'mainEntity': {'@id': PUBLIC_URL + '#service'}},
    {'@type': 'Service', '@id': PUBLIC_URL + '#service', 'name': 'Individuelle LED-Neonschilder',
     'serviceType': 'LED-Neonschilder nach individuellem Design', 'url': PUBLIC_URL,
     'provider': {'@id': organization_id}, 'description': 'Individuelle LED-Neonschilder für Innenräume und den Außenbereich. Kostenlose 3D-Visualisierung des Designs, unverbindliches Angebot und persönliche Beratung.'},
]}
head += '<script type="application/ld+json">' + json.dumps(structured_data, ensure_ascii=False).replace('<', '\\u003c') + '</script>\n'
head += '<style data-style="splash">' + (ROOT / 'neontrip-splash.css').read_text() + '</style>\n'
head += '<style data-style="live-scoped">' + (ROOT / 'live-scoped.css').read_text() + '</style>\n'
head += '<style data-style="first-screen">' + first_screen_css + '</style>\n'
head += '<style data-style="modules">' + (ROOT / 'modules.css').read_text() + '</style>\n'
head += '<style data-style="composition">' + minify((ROOT / 'composition.css').read_text(), 'css', style_content) + '</style>\n'
head += '<noscript><style>img[data-near-src]{display:none!important}</style></noscript>\n'
sequence = ('hero', 'facts', 'gallery4', 'inquiry', 'process', 'material', 'videos', 'express', 'faq')
page = head + '</head><body>\n' + splash + '\n<div data-nt-splash-content style="display:contents">'
# Start before parsing visible page content, without waiting for images or module initialization.
page += '\n<script>' + (ROOT / 'neontrip-splash.js').read_text() + '</script>\n<main>\n'
page += '\n'.join(html[k] for k in sequence)
page += '\n' + html['products'] + '\n' + html['classic'] + '\n</main>\n' + html['footer'] + '\n' + html['product-modal']
for file in ('modules.js', 'live-products.js', 'interactions.js'):
    page += f'\n<script src="{file}?v={version(file)}" defer></script>'
page += '\n</div></body></html>'
# Project requests keep #anfrage; the separate classic contact uses #kontakt.
svg_matches = [match for match in re.finditer(r'<svg\b.*?</svg>', page, re.S)
               if '<symbol' not in match.group(0)]  # Sprite symbols are referenced by other SVGs.
if svg_matches:
    optimized = subprocess.run(['node', str(ROOT / 'minify-assets.cjs')],
                               input=json.dumps([{'source': m.group(0), 'loader': 'svg'} for m in svg_matches]),
                               text=True, capture_output=True, check=True)
    for match, svg in reversed(list(zip(svg_matches, json.loads(optimized.stdout)))):
        page = page[:match.start()] + svg + page[match.end():]
(ROOT / 'index.html').write_text(page)
print(ROOT / 'index.html')
