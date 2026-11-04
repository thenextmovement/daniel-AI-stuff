"""Authenticated private service; reachable only through the Ops session proxy."""
import hmac,json,os,re,threading
from urllib.parse import urlparse,parse_qs
from http.server import ThreadingHTTPServer
from server import Handler,ROOT
from cloud_data import Database,DurableStore,Conflict
from cloud_jobs import Jobs
from cloud_ai import Review,validate_spec,manual_minimum_width
from cloud_trello import request_id

PREFIX='/api/ops/neon-studio'
class CloudHandler(Handler):
    def allowed(self):
        expected=os.getenv('NEON_SERVICE_TOKEN','')
        actual=self.headers.get('Authorization','').removeprefix('Bearer ')
        if len(expected)<32 or not hmac.compare_digest(expected,actual):
            self.respond(401,{'error':'Anmeldung erforderlich.'});return False
        return True
    def send_header(self,key,value):
        if key.lower()=='content-security-policy':value=value.replace("frame-ancestors 'none'","frame-ancestors 'self'")
        super().send_header(key,value)
    def respond(self,status,data,content_type='application/json',filename=None):
        if isinstance(data,bytes) and content_type.startswith('text/html'):
            text=data.decode().replace('href="/style.css"','href="'+PREFIX+'/style.css"').replace('src="/app.js"','src="'+PREFIX+'/app.js"')
            text=text.replace('</body>','<script src="'+PREFIX+'/cloud.js" defer></script></body>')
            data=text.encode()
        if isinstance(data,bytes) and content_type.startswith('text/javascript') and urlparse(self.path).path=='/app.js':
            text=data.decode().replace("fetch(path,","fetch('"+PREFIX+"'+path,").replace("fetch('/test-logo.png')","fetch('"+PREFIX+"/test-logo.png')")
            text=text.replace('loadImage();\n','/* Cloud project boot is handled by cloud.js. */\n') if text.rstrip().endswith('loadImage();') else text
            # Only replace the final boot call, not event handlers.
            data=text.encode()
        return super().respond(status,data,content_type,filename)
    def do_GET(self):
        path=urlparse(self.path).path
        if path=='/health':
            return self.respond(200,{'app':'neon-studio','commit':os.getenv('SOURCE_COMMIT','unknown'),'ready':True})
        if not self.allowed():return
        try:
            db=self.server.db
            if path=='/cloud.js':return self.respond(200,(ROOT/'static/cloud.js').read_bytes(),'text/javascript; charset=utf-8')
            if path=='/cloud/list':
                return self.respond(200,{'projects':[public(p) for p in db.list()],'watch_enabled':os.getenv('NEON_WATCH_ENABLED')=='true','last_poll':db.meta('last_poll'),'watch_error':db.meta('watch_error'),'alert_error':db.meta('alert_error')})
            if path=='/cloud/project':
                id=parse_qs(urlparse(self.path).query).get('id',[''])[0];p=db.get(id)
                return self.respond(200,{**public(p),'settings':p.get('settings',{}),'spec':p.get('spec',{}),
                    'model':self.server.store.info(p['model']) if p.get('model') else None,
                    'attachments':[{'id':a['id'],'name':a['name']} for a in p.get('snapshot',{}).get('attachments',[]) if a.get('isUpload')],
                    'selected_attachments':p.get('selected_attachments',[])})
            return super().do_GET()
        except ValueError as e:return self.respond(400,{'error':str(e)})
    def do_POST(self):
        path=urlparse(self.path).path
        if not path.startswith('/cloud/'):return super().do_POST()
        if not self.allowed():return
        try:
            size=int(self.headers.get('Content-Length',0))
            if size<=0 or size>4000000:raise Review('Ungültige Anfragegröße.')
            payload=json.loads(self.rfile.read(size));db=self.server.db;jobs=self.server.jobs
            with jobs.lock:
                if path=='/cloud/enqueue':
                    p=jobs.ingest(str(payload.get('card','')),'manual:'+str(payload.get('card','')))
                    return self.respond(200,public(p))
                p=db.get(str(payload.get('id','')))
                if p['status'] in ('copying','generating','publishing','queued','publish_queued'):raise Review('Projekt wird bereits verarbeitet.')
                if p['revision']!=payload.get('revision'):raise Conflict('Projekt wurde inzwischen geändert. Bitte neu öffnen.')
                if path=='/cloud/save':
                    model=str(payload.get('model') or p.get('model',''));self.server.store.model(model)
                    settings=payload.get('settings');spec=payload.get('spec',p.get('spec'))
                    if not isinstance(settings,dict) or not isinstance(spec,dict):raise Review('Ungültige Einstellungen.')
                    manual_minimum_width(spec)
                    # Geometry settings are validated by the existing engine.
                    self.server.store.drawing(model,json.dumps(settings,sort_keys=True))
                    p=db.save(p['id'],{'model':model,'settings':settings,'spec':spec},expected=p['revision'],status='draft')
                elif path=='/cloud/publish':
                    validate_spec(p.get('spec'))
                    if p.get('upload_intent') or p.get('pending_attachments'):raise Review('Eine frühere Übertragung ist unbestätigt. Anhänge vor Wiederholung abgleichen.')
                    p=db.save(p['id'],{},expected=p['revision'],status='publish_queued')
                elif path=='/cloud/retry':
                    if p.get('copy_intent') and not p.get('copy'):raise Review('Kopierergebnis zuerst in Trello abgleichen.')
                    if p.get('upload_intent') or p.get('pending_attachments'):raise Review('Frühere Übertragung zuerst in Trello abgleichen.')
                    selected=payload.get('attachments',p.get('selected_attachments',[]))
                    allowed={a['id'] for a in p.get('snapshot',{}).get('attachments',[]) if a.get('isUpload')}
                    if not isinstance(selected,list) or any(x not in allowed for x in selected):raise Review('Ungültige Anhangauswahl.')
                    p=db.save(p['id'],{'error':'','selected_attachments':selected},expected=p['revision'],status='queued')
                else:return self.respond(404,{'error':'Nicht gefunden.'})
            return self.respond(200,public(p))
        except Conflict as e:return self.respond(409,{'error':str(e)})
        except (ValueError,KeyError,TypeError) as e:return self.respond(400,{'error':str(e)})
        except Exception:return self.respond(500,{'error':'Schritt nicht bestätigt. Projektstatus prüfen.'})

def public(p):
    return {k:p.get(k) for k in ('id','source','revision','status','updated','copy_url','error','metrics')} | {
        'name':p.get('snapshot',{}).get('name','Anfrage'),'request_id':request_id(p.get('snapshot',{}))}
def main():
    if len(os.getenv('NEON_SERVICE_TOKEN',''))<32:raise RuntimeError('NEON_SERVICE_TOKEN fehlt.')
    db=Database(os.getenv('NEON_DATA_DIR','/data'));store=DurableStore(db)
    server=ThreadingHTTPServer(('0.0.0.0',8080),CloudHandler);server.daemon_threads=True
    server.db=db;server.store=store;server.jobs=Jobs(db,store)
    for target in (server.jobs.run,):threading.Thread(target=target,daemon=True).start()
    server.serve_forever()
if __name__=='__main__':main()
