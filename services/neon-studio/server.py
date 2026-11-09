#!/usr/bin/env python3
"""Loopback-only local Neon Studio. No image upload leaves this computer."""
import argparse
import base64
import binascii
from collections import OrderedDict
from functools import lru_cache
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import time
from urllib.parse import urlparse
import uuid

ROOT=Path(__file__).resolve().parent
# Reuse the task-local scientific runtime; normal installations use requirements.txt.
for folder in ('python-deps','neon-studio-deps'):
    location=ROOT.parent.parent/'work'/folder
    if location.is_dir(): sys.path.insert(0,str(location))

from tracing import analyze_image, prepare_image, selected_image, selection_mask
from vector_import import analyze_vector, is_vector, vector_preview, select_vector, render_pdf_page, VectorPreviewRequired
from geometry import build_geometry
from export_pdf import make_pdf
from neon_pricing import calculate as calculate_price
from recovery import recovery_source, recover


class Store:
    def __init__(self):
        self.models=OrderedDict();self.prepared=OrderedDict();self.recoveries=OrderedDict();self.lock=threading.RLock()

    def add(self,raw,name,foreground=None):
        model=analyze_vector(raw,name) if foreground is None and is_vector(raw,name) else analyze_image(raw,foreground)
        return self.add_model(model,name)

    def add_model(self,model,name):
        token=uuid.uuid4().hex
        with self.lock:
            self.models[token]=model
            while len(self.models)>12:self.models.popitem(last=False)
        return {'id':token,'name':str(name)[:120],'canRecover':'recoveryImage' in model,**{key:model[key] for key in
            ('image','sourceKind','sourceLabel','pixelWidth','pixelHeight','traceNote','nativeWidthMm','nativeHeightMm','vectorHasFills','suggestedMode') if key in model}}

    def prepare(self,raw,name):
        if is_vector(raw,name):return self.prepare_vector(raw,name)
        image,labels,preview=prepare_image(raw);token=uuid.uuid4().hex
        with self.lock:
            self.prepared[token]=(image,labels,str(name)[:120])
            while len(self.prepared)>4:self.prepared.popitem(last=False)
        return dict(id=token,name=str(name)[:120],**preview)

    def prepare_vector(self,raw,name,page=0,raster=False):
        pdf=raw.lstrip().startswith(b'%PDF-')
        note='Nachzeichnung der sichtbaren PDF-Seite auf deinen Wunsch.'
        try:
            if raster and pdf:raise VectorPreviewRequired(note)
            model=analyze_vector(raw,name,page)
        except VectorPreviewRequired as error:
            if not pdf:raise
            rendered,count,index=render_pdf_page(raw,page)
            image,labels,preview=prepare_image(rendered);token=uuid.uuid4().hex
            note=str(error)+' Die sichtbare Seite wird als Bild nachgezeichnet. Originalpfade werden dabei nicht übernommen; Kurven und Maße anschließend prüfen.'
            with self.lock:
                self.prepared[token]={'image':image,'labels':labels,'raw':raw,'name':str(name)[:120],'note':note}
                while len(self.prepared)>4:self.prepared.popitem(last=False)
            preview['importNote']=note+' '+preview.get('importNote','')
            return dict(id=token,name=str(name)[:120],kind='pdf-raster',pageCount=count,pageIndex=index,**preview)
        token=uuid.uuid4().hex
        with self.lock:
            self.prepared[token]={'model':model,'raw':raw,'name':str(name)[:120]}
            while len(self.prepared)>4:self.prepared.popitem(last=False)
        return dict(id=token,name=str(name)[:120],**vector_preview(model))

    def vector_page(self,token,page,raster=False):
        with self.lock:
            prepared=self.prepared.get(token)
            if not isinstance(prepared,dict):raise ValueError('Die Dateiauswahl ist abgelaufen. Bitte erneut hochladen.')
        return self.prepare_vector(prepared['raw'],prepared['name'],page,raster)

    def trace_selection(self,token,selected=None,pixel_mask=None,additions=None):
        with self.lock:
            if token not in self.prepared:raise ValueError('Die Motivauswahl ist abgelaufen. Bitte das Bild erneut hochladen.')
            prepared=self.prepared[token]
            if isinstance(prepared,dict) and 'model' in prepared:
                return self.add_model(select_vector(prepared['model'],selected),prepared['name'])
            if isinstance(prepared,dict):image,labels,name=prepared['image'],prepared['labels'],prepared['name']
            else:image,labels,name=prepared
        if additions is not None:
            # Explicitly recovered pixels must survive the normal automatic mask.
            # Retain the original RGB under the selection for visual comparison.
            keep=selection_mask(image,labels,selected,pixel_mask,additions)
            import io
            import numpy as np
            from PIL import Image
            rgba=np.array(image);rgba[:,:,3]=np.where(keep,rgba[:,:,3],0)
            raw=io.BytesIO();Image.fromarray(rgba).save(raw,'PNG')
            model=analyze_image(raw.getvalue(),keep,trace_profile=image.info.get('traceProfile'))
        else:model=analyze_image(selected_image(image,labels,selected,pixel_mask),trace_profile=image.info.get('traceProfile'))
        model['recoveryImage']=image.copy()
        if isinstance(prepared,dict):
            model['sourceKind']='trace';model['sourceLabel']='PDF · sichtbare Seite nachgezeichnet'
            model['traceNote']=prepared['note']+' '+model['traceNote']
        return self.add_model(model,name)

    def model(self,token):
        with self.lock:
            if token not in self.models:
                raise ValueError('Dieses Projekt ist nicht mehr geladen. Bitte das Bild erneut hochladen.')
            self.models.move_to_end(token)
            return self.models[token]

    def recovery_source(self,token):
        return recovery_source(self.model(token))

    def recovery_preview(self,token,selection,settings):
        if not isinstance(settings,dict):raise ValueError('Ungültige Einstellungen.')
        original=self.model(token)
        # Freeze physical scale even if a caller has not yet normalized settings.
        normalized=build_geometry(original,settings,editable=False)['settings']
        model,keys=recover(original,selection)
        drawing=build_geometry(model,normalized,editable=False)
        paths=[path for key,path in zip(drawing['pathKeys'],drawing['pathData']) if key in keys]
        draft=uuid.uuid4().hex
        with self.lock:
            self.recoveries[draft]=(token,json.dumps(settings,sort_keys=True),model,normalized,keys)
            while len(self.recoveries)>4:self.recoveries.popitem(last=False)
        return dict(draft=draft,paths=paths,count=len(paths),neonMeters=drawing['neonMeters'])

    def recovery_apply(self,token,draft,settings,name='Motiv.png'):
        with self.lock:
            candidate=self.recoveries.get(draft)
        if not candidate:raise ValueError('Vorschau abgelaufen. Bitte erneut nacherkennen.')
        source,saved,model,normalized,keys=candidate
        if source!=token or saved!=json.dumps(settings,sort_keys=True):
            raise ValueError('Einstellungen wurden geändert. Bitte die Vorschau erneut prüfen.')
        drawing=build_geometry(model,normalized)
        if not any(key in keys for key in drawing['pathKeys']):
            raise ValueError('Keine zusätzlichen sichtbaren Linien gefunden.')
        if not drawing['exportable']:raise ValueError('Die Ergänzung konnte nicht vollständig geprüft werden. Bitte die Auswahl anpassen.')
        # Consume once; previews/cancellation never mutate the original model.
        with self.lock:
            if self.recoveries.pop(draft,None) is None:raise ValueError('Diese Vorschau wurde bereits übernommen.')
            project=self.add_model(model,name)
        return dict(project=project,drawing=drawing)

    def split_paths(self,token,keys,settings):
        from path_splitting import path_catalog, find_splits
        from geometry import transform
        from recovery import source_origin
        from uv_print import uv_geometry
        from shapely.geometry import Point
        if not isinstance(settings,dict):raise ValueError('Ungültige Einstellungen.')
        model=self.model(token)
        before=self.drawing(token,json.dumps(settings,sort_keys=True))
        if not isinstance(keys,list) or not keys or any(not isinstance(key,str) or key not in before['pathKeys'] for key in keys):
            raise ValueError('Bitte zuerst eine sichtbare Neonlinie auswählen.')
        normalized=before['settings'];catalog,_=path_catalog(model,normalized)
        paths={key:transform(catalog[key]['commands'],1,*catalog[key]['offset']) for key in before['pathKeys']}
        mask,_,_=uv_geometry(model,normalized.get('uvStrokes',[]),source_origin(model),normalized.get('uvMode','original'),normalized.get('hiddenPaths',[]))
        cuts=find_splits(paths,keys,tolerance=.05/normalized['scale'],
                         visible=None if mask.is_empty else lambda key,point:not mask.covers(Point(
                             [point[axis]-catalog[key]['offset'][axis] for axis in range(2)])))
        if not cuts:return dict(drawing=before,count=0)
        changed={**normalized,'pathSplits':{**normalized.get('pathSplits',{}),**cuts}}
        drawing=build_geometry(model,changed)
        return dict(drawing=drawing,count=len(drawing['paths'])-len(before['paths']))

    def size_probe(self,token,options,*,uncut=False):
        return build_geometry(self.model(token),options,editable=False,sizing_probe=True,uncut_probe=uncut)

    @lru_cache(maxsize=48)
    def drawing(self,token,serialized,editable=True):
        return build_geometry(self.model(token),json.loads(serialized),editable=editable)


class Handler(BaseHTTPRequestHandler):
    server_version='NeonStudio/1.0'
    def log_message(self,*args): pass

    def respond(self,status,data,content_type='application/json',filename=None):
        if content_type=='application/json':data=json.dumps(data,ensure_ascii=False,allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        if filename:self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
        self.end_headers()
        try:self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError): pass

    def allowed(self):
        host=self.headers.get('Host','').split(':')[0]
        if host not in ('localhost','127.0.0.1'):
            self.respond(403,{'error':'Nur lokaler Zugriff erlaubt.'});return False
        origin=self.headers.get('Origin')
        if origin and origin not in (f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}'):
            self.respond(403,{'error':'Fremde Webseiten können nicht auf dieses Projekt zugreifen.'});return False
        return True

    def do_GET(self):
        if not self.allowed():return
        path=urlparse(self.path).path
        if path=='/health':return self.respond(200,{'app':'neon-studio','version':'1.0'})
        files={'/':('static/index.html','text/html; charset=utf-8'),
               '/app.js':('static/app.js','text/javascript; charset=utf-8'),
               '/style.css':('static/style.css','text/css; charset=utf-8'),
               '/example.png':('assets/B_KITE.png','image/png'),
               '/test-logo.png':('assets/NOVA_Test.png','image/png')}
        if path not in files:return self.respond(404,{'error':'Nicht gefunden.'})
        file,ctype=files[path]
        try:return self.respond(200,(ROOT/file).read_bytes(),ctype)
        except FileNotFoundError:return self.respond(404,{'error':'Datei nicht gefunden.'})

    def do_POST(self):
        if not self.allowed():return
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=135*1024*1024:raise ValueError('Anfrage ist leer oder zu groß (maximal 100 MB Dateigröße).')
            if not self.headers.get('Content-Type','').startswith('application/json'):
                raise ValueError('JSON-Anfrage erforderlich.')
            payload=json.loads(self.rfile.read(length))
            if not isinstance(payload,dict):raise ValueError('Ungültige Anfrage.')
            path=urlparse(self.path).path
            if path=='/api/manufacturing':
                from minimum_size import minimum_size
                settings=payload.get('settings',{})
                if not isinstance(settings,dict):raise ValueError('Ungültige Einstellungen.')
                return self.respond(200,minimum_size(self.server.store,str(payload.get('id','')),settings))
            if path=='/api/pricing':
                settings=payload.get('settings',{})
                if not isinstance(settings,dict):raise ValueError('Ungültige Einstellungen.')
                drawing=self.server.store.drawing(str(payload.get('id','')),json.dumps(settings,sort_keys=True))
                options=payload.get('pricing',{})
                if not isinstance(options,dict):raise ValueError('Ungültige Preiseinstellungen.')
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
                quote=calculate_price(request)
                return self.respond(200,quote)
            if path=='/api/split-paths':
                return self.respond(200,self.server.store.split_paths(str(payload.get('id','')),payload.get('keys'),payload.get('settings',{})))
            if path=='/api/recovery-source':
                return self.respond(200,self.server.store.recovery_source(str(payload.get('id',''))))
            if path=='/api/recovery-preview':
                return self.respond(200,self.server.store.recovery_preview(str(payload.get('id','')),payload.get('selection'),payload.get('settings',{})))
            if path=='/api/recovery-apply':
                return self.respond(200,self.server.store.recovery_apply(str(payload.get('id','')),str(payload.get('draft','')),payload.get('settings',{}),payload.get('name','Motiv.png')))
            if path=='/api/example':
                return self.respond(200,self.server.store.add((ROOT/'assets/B_KITE.png').read_bytes(),'B_KITE.png'))
            if path=='/api/vector-page':
                return self.respond(200,self.server.store.vector_page(str(payload.get('id','')),payload.get('page'),payload.get('raster') is True))
            if path=='/api/trace-selection':
                return self.respond(200,self.server.store.trace_selection(str(payload.get('id','')),payload.get('selected'),payload.get('mask'),payload.get('additions')))
            if path in ('/api/upload','/api/prepare'):
                data=payload.get('data','')
                if not isinstance(data,str):raise ValueError('Ungültige Bilddaten.')
                raw=base64.b64decode(data.split(',')[-1],validate=True)
                operation=self.server.store.prepare if path=='/api/prepare' else self.server.store.add
                return self.respond(200,operation(raw,payload.get('name','Motiv.png')))
            if path in ('/api/geometry','/api/export'):
                settings=payload.get('settings',{})
                if not isinstance(settings,dict):raise ValueError('Ungültige Einstellungen.')
                started=time.perf_counter()
                drawing=self.server.store.drawing(str(payload.get('id','')),json.dumps(settings,sort_keys=True),
                                                 editable=not (path=='/api/geometry' and payload.get('preview') is True))
                if path=='/api/geometry':
                    return self.respond(200,{**drawing,'renderMs':round((time.perf_counter()-started)*1000,1)})
                options=payload.get('options',{})
                if not isinstance(options,dict):raise ValueError('Ungültige PDF-Einstellungen.')
                pdf=make_pdf(drawing,options)
                filename='Neon_Studio_'+drawing['settings']['mode']+'_'+('CNC' if options.get('kind','cnc')=='cnc' else 'Zeichnung')+'.pdf'
                return self.respond(200,pdf,'application/pdf',filename)
            return self.respond(404,{'error':'Nicht gefunden.'})
        except (ValueError,TypeError,KeyError,binascii.Error) as error:
            self.respond(400,{'error':str(error) or 'Ungültige Anfrage.'})
        except Exception as error:
            print(f'Neon Studio: {type(error).__name__}: {error}',file=sys.stderr,flush=True)
            self.respond(500,{'error':'Die Verarbeitung ist fehlgeschlagen. Bitte andere Einstellungen versuchen.'})


def create_server(port=8765):
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    server.daemon_threads=True;server.store=Store()
    return server


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--open',action='store_true')
    args=parser.parse_args()
    server=create_server(args.port)
    url=f'http://127.0.0.1:{server.server_port}'
    print(f'Neon Studio läuft: {url}',flush=True)
    if args.open:
        import webbrowser
        webbrowser.open(url)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
