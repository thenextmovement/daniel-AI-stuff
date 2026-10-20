"""Build only the approved /neonschild/anfrage page; preserve all other deployed routes."""
from pathlib import Path
from hashlib import sha256
import subprocess,re,json
ROOT=Path(__file__).resolve().parent
DEPLOY=ROOT.parents[1]
PUBLIC=DEPLOY/'assets/neonschild-anfrage/20261013-v1'
PREFIX='/assets/neonschild-anfrage/20261013-v1/'
subprocess.run(['python3',str(ROOT/'build-preview.py')],check=True,capture_output=True)
base=(DEPLOY/'_source/layouts/base.html').read_text()
def between(start,end):
    assert base.count(start)==1 and base.count(end)==1,(start,end)
    return base.split(start,1)[1].split(end,1)[0]
# Reuse active, receipt-checked /api/c transport including the established WebKit fallback.
helpers=between('// ═══════ Fail-Loud Form Submit Helpers (added 2026-04-09) ═══════','// Multi-Step Form (only on anfrage.html)')
conversions=between('// ═══════ Enhanced Conversions Helper ═══════','// File upload size validation (max 20MB)')
script=helpers+'\n'+conversions+'\n'+(ROOT/'live-integration.js').read_text()
minified=subprocess.run(['node',str(ROOT/'minify-assets.cjs')],input=json.dumps([{'source':script,'loader':'js'}]),capture_output=True,text=True,check=True)
(PUBLIC/'live-integration.js').write_text(json.loads(minified.stdout)[0])
def paths(text):
    return re.sub(r'(?<![\w/])assets/',PREFIX+'assets/',text)
for f in ['modules.css','modules.js','live-scoped.css','live-products.js','interactions.js']:
    (PUBLIC/f).write_text(paths((ROOT/f).read_text()))
page=paths((ROOT/'index.html').read_text())
page=page.replace('noindex,nofollow','index,follow,max-image-preview:large')
page=page.replace("form-action 'none'; connect-src 'self'","form-action 'self'")
for f in ['modules.css','modules.js','live-scoped.css','live-products.js','interactions.js']:
    page=re.sub(r'(?<=")'+re.escape(f)+r'\?v=[a-f0-9]+',PREFIX+f+'?v='+sha256((PUBLIC/f).read_bytes()).hexdigest()[:10],page)
# Take the current production consent/measurement tags, never the legacy form/UI script.
existing=(DEPLOY/'neon-schilder/index.html').read_text()
scripts=re.findall(r'<script([^>]*)>(.*?)</script>',existing,re.S)
head=[];body=[]
for attrs,content in scripts:
    combined=attrs+content
    if len(content)>3000:continue
    if 'googletagmanager.com/gtag/js' in attrs:
        # Download analytics after the essential page markup and intro paint. Consent/config/events
        # stay queued in the existing gtag dataLayer, so no attribution or event is lost.
        url=re.search(r'src="([^"]+)"',attrs).group(1)
        head.append('<script data-cookieconsent="ignore">window.addEventListener("DOMContentLoaded",function(){function start(){requestAnimationFrame(function(){requestAnimationFrame(function(){var s=document.createElement("script");s.async=true;s.fetchPriority="low";s.src='+json.dumps(url)+';document.head.appendChild(s);});});}var intro=document.querySelector("[data-nt-splash]");if(!intro){start();return;}var observer=new MutationObserver(function(){if(!intro.isConnected){observer.disconnect();start();}});observer.observe(intro.parentNode,{childList:true});},{once:true});</script>')
    elif any(term in combined for term in ['consent.cookiebot.com','nt-openai-ads.js',"gtag('consent', 'default'","gtag('js', new Date())"]):
        head.append('<script'+attrs+'>'+content+'</script>')
    elif ('data-cookieconsent="statistics"' in attrs and 'clarity' in content) or 'nt-clarity-identifiers.js' in attrs:
        body.append('<script'+attrs+'>'+content+'</script>')
assert len(head)==5 and len(body)==3,(len(head),len(body))
page=page.replace('</head>','<link rel="preconnect" href="https://consent.cookiebot.com"><link rel="preconnect" href="https://consentcdn.cookiebot.com"><style>#CybotCookiebotDialog .CybotCookiebotDialogNavItemLink.CybotCookiebotDialogActive{color:#b80d70!important}</style>'+ '\n'.join(head)+'</head>')
# Keep transport ready before section submit listeners. Defer retains parser order.
pre='<script defer data-cookieconsent="ignore" src="/assets/js/nt-business-email.js?v=20261016-hints1"></script>'
pre+='<script defer data-cookieconsent="ignore" src="/assets/js/lp-common.js?v='+sha256((DEPLOY/'assets/js/lp-common.js').read_bytes()).hexdigest()[:10]+'"></script>'
pre+='<script defer data-cookieconsent="ignore" src="'+PREFIX+'live-integration.js?v='+sha256((PUBLIC/'live-integration.js').read_bytes()).hexdigest()[:10]+'"></script>'
page=page.replace('<script src="'+PREFIX+'modules.js',pre+'<script src="'+PREFIX+'modules.js')
page=page.replace('</head>','<script type="module" data-cookieconsent="ignore" src="/js/nt-x-page.js?v=20261016-x1"></script>'+'</head>')
page=page.replace('</body>','\n'.join(body)+'<script type="module" data-cookieconsent="ignore" src="/js/nt-cro-page.js?v=20261014-clarity3"></script></body>')
page=page.replace('href="https://anfrage.neontrip.de/cookie-einstellungen"','data-cookie-settings href="/cookie-einstellungen"')
page=page.replace('novalidate aria-label="Ihr LED-Neonschild anfragen">', 'novalidate aria-label="Ihr LED-Neonschild anfragen"><input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-10000px">')
# No JavaScript: expose real contact options rather than posting unmapped fields.
page=page.replace('</main>','<noscript><p style="padding:24px">Bitte aktivieren Sie JavaScript für das Anfrageformular oder schreiben Sie an <a href="mailto:support@neontrip.de">support@neontrip.de</a>.</p><style>#nt-inquiry-form,#nt-classic-form{display:none}</style></noscript></main>')
(DEPLOY/'neonschild').mkdir(exist_ok=True)
(DEPLOY/'neonschild/anfrage.html').write_text(page)
print('Built /neonschild/anfrage, '+str(len(page.encode()))+' bytes HTML')
