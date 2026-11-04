import fcntl,json,os,threading,time,traceback
from datetime import datetime,timezone,timedelta
from pathlib import Path
from cloud_trello import Trello,BOARD,TRIGGER,HOLDING,READY,REQUEST,USAGE,FIELDS,eligible,field_value,decimal
from cloud_ai import generate,validate_spec,Review,drawing_model
from cloud_exports import artifacts,CUT
class Jobs:
    def __init__(self,db,store,trello=None):
        self.db=db;self.store=store;self.t=trello or Trello();self.lock=threading.RLock()
    def alert(self,p,error):
        # User opt-out, 2026-11-04: project/watch errors stay in Studio only.
        # Do not contact the email webhook, even if old credentials remain set.
        self.db.meta('alert_error','')
    def fail(self,id,error):
        p=self.db.save(id,{'error':error},status='review');self.alert(p,error)
    def ingest(self,source,event):
        card=self.t.card(source)
        source=card['id']
        existing=self.db.for_card(source)
        if existing:return existing
        if not eligible(card['name']):raise Review('Nur LED/Neon-Anfragen ohne 3D werden verarbeitet.')
        if card['idBoard']!=BOARD and not event.startswith('action:'):raise Review('Karte gehört nicht zum Anfrage-Board.')
        return self.db.enqueue(source,event,card)
    def process(self,p):
        id=p['id'];source=p.get('snapshot') or self.t.card(p['source'])
        if not eligible(source['name']):raise Review('Diese Anfrage ist keine LED/Neon-Anfrage.')
        # Copy intent is durable before a non-idempotent API call; never blindly repeat it.
        if not p.get('copy'):
            if p.get('copy_intent'):raise Review('Kartenerstellung war nicht bestätigt. Vor Wiederholung in Trello prüfen.')
            self.db.save(id,{'copy_intent':True},status='copying')
            copy=self.t.copy(source)
            p=self.db.save(id,{'copy':copy['id'],'copy_url':copy['url']},status='generating')
            self.t.verify_copy(source,copy['id'])
        else:
            if not p.get('copy_verified'):self.t.verify_copy(source,p['copy'])
            self.db.save(id,{},status='generating')
        self.db.save(id,{'copy_verified':True})
        marker='Neon-Studio-Projekt '+id
        self.t.comment_once(p['copy'],marker+'\nhttps://ops.neontrip.de/ops/neon-studio?project='+id+'\nInterner Auto-Quote-Entwurf; kein Kundenversand.',marker)
        data,metrics=generate(self.t,source,p.get('selected_attachments'))
        # Persist even an incomplete spec so a staff member can correct it.
        model,part_modes=drawing_model(data)
        info=self.store.add_model(model,'KI-Zeichnung.svg')
        spec={k:v for k,v in data.items() if k!='svg'}
        settings={'mode':'single','partModes':part_modes,'shape':spec.get('shape') or 'shape','width':(spec.get('widths_mm') or [600])[0],'gap':15,'tube':6,'radius':3,'depth':20,'reserve':.1,'scale':None}
        from manufacturing import inspect
        drawing=self.store.drawing(info['id'],json.dumps(settings,sort_keys=True))
        metrics['manufacturing']=inspect(drawing)
        p=self.db.save(id,{'model':info['id'],'spec':spec,'metrics':metrics,'settings':settings},status='draft')
        self.publish(p)
    def publish(self,p):
        with self.lock:
            p=self.db.get(p['id'])
            if p['status'] in ('publishing','generating','copying','queued'):raise Review('Projekt wird bereits verarbeitet.')
            spec=validate_spec(p.get('spec'))
            if not p.get('copy') or not p.get('model'):raise Review('Kopie oder Zeichnung fehlt.')
            card=self.t.card(p['copy'])
            if card['idBoard']!=BOARD or card['idList'] not in (HOLDING,READY):raise Review('Karte wurde weiterbearbeitet. Veröffentlichung hier gesperrt.')
            widths=spec['widths_mm'];settings=dict(p['settings'])
            variants=[]
            for i,width in enumerate(widths):
                options={**settings,'width':width,'shape':spec['shape']}
                if i>0 or abs(float(settings.get('width',0))-width)>.1:options['scale']=None
                d=self.store.drawing(p['model'],json.dumps(options,sort_keys=True))
                if not d.get('exportable') or not d['paths']:raise Review('Zeichnung enthält noch ungeklärte Pfade.')
                variants.append(d)
            files,quotes=artifacts(variants,spec)
            revision=p['revision'];marker='Neon Studio '+p['id']+' Revision '+str(revision)
            p=self.db.save(p['id'],{'publish_revision':revision,'error':'','upload_intent':False},status='publishing')
            old=list(dict.fromkeys(p.get('generated_attachments',[])+p.get('cleanup_pending',[])+p.get('pending_attachments',[])));new=[]
            try:
                # Upload first. Existing customer and supplier attachments are never deleted.
                for name,mime,data in files:
                    self.db.save(p['id'],{'upload_intent':True})
                    a=self.t.call('POST',f"cards/{p['copy']}/attachments",files={'file':(name,data,mime)},data={'name':name})
                    new.append(a['id'])
                    self.db.save(p['id'],{'pending_attachments':new,'upload_intent':False})
                for i,(d,q) in enumerate(zip(variants,quotes)):
                    vals=[decimal(q['total_usd']),decimal(d['width']/10)+' × '+decimal(d['height']/10)+' cm',spec['colors'],CUT[spec['shape']]]
                    for field,value in zip(FIELDS[i],vals):self.t.field(p['copy'],field,value)
                for fields in FIELDS[len(variants):]:
                    for field in fields:self.t.field(p['copy'],field,'')
                self.t.field(p['copy'],USAGE,spec['usage'])
                # Verify artifacts/fields before moving the card into the review list.
                checked=self.t.card(p['copy'])
                if not set(new).issubset({a['id'] for a in checked.get('attachments',[])}):raise Review('Trello-Anhänge nicht bestätigt.')
                if field_value(checked,USAGE)!=spec['usage']:raise Review('Usage nicht bestätigt.')
                for i,(d,q) in enumerate(zip(variants,quotes)):
                    expected=[decimal(q['total_usd']),decimal(d['width']/10)+' × '+decimal(d['height']/10)+' cm',spec['colors'],CUT[spec['shape']]]
                    if any(field_value(checked,k)!=v for k,v in zip(FIELDS[i],expected)):raise Review('Custom Fields nicht bestätigt.')
                self.db.save(p['id'],{'generated_attachments':new,'pending_attachments':[],'cleanup_pending':old,'quotes':quotes})
                for attachment in list(old):
                    current=self.t.card(p['copy'])
                    if attachment in {a['id'] for a in current.get('attachments',[])}:
                        self.t.call('DELETE',f"cards/{p['copy']}/attachments/{attachment}")
                    old.remove(attachment)
                    self.db.save(p['id'],{'cleanup_pending':list(old)})
                self.t.comment_once(p['copy'],marker+'\nDrei Dateien erstellt. EK inklusive Versand in USD; Formel-Schätzung, Lieferantenpreis noch nicht bestätigt.\nBearbeiten: https://ops.neontrip.de/ops/neon-studio?project='+p['id'],marker)
                self.t.call('PUT',f"cards/{p['copy']}",json={'name':'🤖 '+p['snapshot']['name']+' 🤖','idList':READY})
                checked=self.t.card(p['copy'])
                if checked['idList']!=READY:raise Review('Zielliste nicht bestätigt.')
                return self.db.save(p['id'],{'published_revision':revision,'error':''},status='ready')
            except Exception:
                # Preserve intent and IDs for reconciliation. Never repeat an uncertain upload.
                raise
    def poll(self):
        cursor=self.db.meta('cursor')
        if not cursor:
            cursor=datetime.now(timezone.utc).isoformat();self.db.meta('cursor',cursor)
        actions=[];before=None
        while True:
            from urllib.parse import quote
            path=f'boards/{BOARD}/actions?filter=updateCard:idList,moveCardFromBoard&limit=1000&since='+quote((datetime.fromisoformat(cursor.replace('Z','+00:00'))-timedelta(seconds=1)).isoformat(),safe='')
            if before:path+='&before='+before
            page=self.t.call('GET',path);actions.extend(page)
            if len(page)<1000:break
            before=page[-1]['id']
        for action in sorted(actions,key=lambda a:(a['date'],a['id'])):
            data=action.get('data',{})
            if data.get('listAfter',{}).get('id')==TRIGGER:
                try:self.ingest(data['card']['id'],'action:'+action['id'])
                except Review:pass
            if action['date']>cursor:
                self.db.meta('cursor',action['date'])
        self.db.meta('last_poll',time.time())
    def run(self):
        # One worker owns the shared database even during a rolling deployment.
        lease=open(self.db.root/'worker.lock','a')
        while True:
            try:fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB);break
            except BlockingIOError:time.sleep(2)
        for interrupted in self.db.recover_interrupted():self.alert(interrupted,interrupted['error'])
        threading.Thread(target=self.watch,daemon=True).start()
        while True:
            for p in self.db.pending():
                if p['status'] not in ('queued','publish_queued'):continue
                try:
                    if p['status']=='publish_queued':
                        self.publish(p)
                    else:self.process(p)
                except Exception as e:
                    print('Neon job failed:',type(e).__name__,flush=True)
                    message=str(e) if isinstance(e,(Review,ValueError)) else 'Verarbeitung nicht bestätigt. Projekt öffnen und den letzten Schritt prüfen.'
                    self.fail(p['id'],message)
            time.sleep(2)
    def watch(self):
        while True:
            if os.getenv('NEON_WATCH_ENABLED')=='true':
                try:self.poll();self.db.meta('watch_error','')
                except Exception:
                    self.db.meta('watch_error','Trello-Abruf fehlgeschlagen.')
                    self.alert({'id':'watcher'},'Trello-Abruf fehlgeschlagen. Neue Anfragen werden erst nach erfolgreichem Abruf verarbeitet.')
            time.sleep(30)
