import fcntl,json,math,os,re,threading,time,traceback
from datetime import datetime,timezone,timedelta
from pathlib import Path
from cloud_trello import Trello,BOARD,TRIGGER,HOLDING,READY,REQUEST,USAGE,FIELDS,eligible,field_value,decimal,PROCESSING,NEEDS_REVIEW,copy_title,ServiceError
from cloud_ai import generate,validate_spec,Review,drawing_model,smallest_title_widths,size_only_issue
from colors import artwork_neon_color
from cloud_exports import artifacts,CUT
from minimum_size import PROFILE, measure, minimum_size, widths_for_heights


def size_variants(store,model,settings,spec):
    widths=spec.get('widths_mm',[])
    if not isinstance(widths,list) or any(type(w) not in (int,float) or not 80<=w<=20000 for w in widths):
        raise Review('Ungültige Angebotsbreite.')
    manual=spec.get('minimum_width_mm')
    floor=manual or minimum_size(store,model,settings)['recommendedWidth']
    targets=list(dict.fromkeys(max(w,floor) for w in widths))
    if (spec.get('smallest_requested') or not targets) and floor not in targets:targets.append(floor)
    if spec.get('minimum_first'):
        targets=[floor,*[w for w in targets if w>floor]]
    if len(targets)>4:raise Review('Es sind mehr als vier Angebotsvarianten angefragt.')
    verified=[];reports=[]
    for width in targets:
        options={**settings,**PROFILE,'width':width}
        drawing=store.drawing(model,json.dumps(options,sort_keys=True))
        if drawing['width'] < floor-.001:raise Review('Die Zeichnung unterschreitet die Mindestbreite.')
        report={'recommendedWidth':manual} if manual else measure(drawing)
        if report['recommendedWidth']>width and spec.get('minimum_first') and width>floor:continue
        if report['recommendedWidth']>width:raise Review('Abstand oder Innenöffnung in der Angebotszeichnung zu klein.')
        verified.append(width)
        reports.append({**report,'recommendedWidth':floor})
    return verified,reports


class Jobs:
    def __init__(self,db,store,trello=None):
        self.db=db;self.store=store;self.t=trello or Trello();self.lock=threading.RLock()
    def alert(self,p,error):
        # User opt-out, 2026-11-04: project/watch errors stay in Studio only.
        # Do not contact the email webhook, even if old credentials remain set.
        self.db.meta('alert_error','')
    def mark_copy(self,p,prefix,comment=None):
        if not p.get('copy') or p['copy']==p['source']:return
        card=self.t.card(p['copy'])
        if card['idBoard']!=BOARD or card['idList']!=HOLDING:return
        name=card['name']
        if prefix==NEEDS_REVIEW and not name.removeprefix('🤖 ').startswith((PROCESSING,NEEDS_REVIEW)):return
        title=copy_title(name,prefix)
        if title!=name:self.t.call('PUT',f"cards/{p['copy']}",json={'name':title})
        if comment:self.t.comment_once(p['copy'],comment,comment)
    def fail(self,id,error):
        p=self.db.save(id,{'error':error},status='review');self.alert(p,error)
        comment=None
        if error.startswith('Bitte prüfen: ') and p.get('copy_verified'):
            issues=p.get('spec',{}).get('issues',[])
            if p.get('additional_designs'):
                issues=[f"{record['spec']['design_name']}: {issue}" for record in [p,*p['additional_designs']]
                        for issue in record['spec'].get('issues',[])]
            if issues:comment='Noch zu klären\n'+'\n'.join('• '+str(i) for i in issues)
        try:self.mark_copy(p,NEEDS_REVIEW,comment)
        except Exception as exc:print('Review title update failed:',type(exc).__name__,flush=True)
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
            self.mark_copy(p,PROCESSING)
            if not p.get('copy_verified'):self.t.verify_copy(source,p['copy'])
            self.db.save(id,{},status='generating')
        self.db.save(id,{'copy_verified':True})
        marker='Neon-Studio-Projekt '+id
        self.t.comment_once(p['copy'],marker+'\nhttps://ops.neontrip.de/ops/neon-studio?project='+id+'\nInterner Auto-Quote-Entwurf; kein Kundenversand.',marker)
        data,metrics=generate(self.t,source,p.get('selected_attachments'))
        designs=data.get('designs',[data])
        records=[self.design_record(design) for design in designs]
        p=self.db.save(id,{**records[0],'additional_designs':records[1:],'metrics':metrics},status='draft')
        self.publish(p)

    def design_record(self,data):
        # Persist even an incomplete spec so a staff member can correct it.
        model,part_modes=drawing_model(data)
        info=self.store.add_model(model,'KI-Zeichnung.svg')
        spec={k:v for k,v in data.items() if k!='svg'}
        settings={'mode':'single','partModes':part_modes,'shape':spec.get('shape') or 'shape','width':(spec.get('widths_mm') or [600])[0],'gap':15,'tube':6,'radius':3,'depth':20,'reserve':.1,'scale':None}
        if spec.get('colors_from_artwork') is True:
            drawing=self.store.drawing(info['id'],json.dumps(settings,sort_keys=True))
            assigned={key:artwork_neon_color(source) for key,source in drawing['colorSources'].items()}
            settings['pathColors']={key:color['id'] for key,color in assigned.items()}
            spec['colors']=' + '.join(dict.fromkeys(assigned[key]['name'] for key in drawing['pathKeys']))
        return {'model':info['id'],'spec':spec,'settings':settings}

    def size_design(self,p,snapshot):
        spec=dict(p.get('spec') or {})
        from cloud_ai import manual_minimum_width
        manual_minimum_width(spec)
        if p.get('model'):
            requested=spec.get('requested_widths_mm',spec.get('widths_mm',[]))
            # Adopt the title rule for existing smallest-only projects on their next export.
            if 'minimum_first' not in spec and not requested:
                extras=smallest_title_widths(snapshot['name'])
                if extras is not None:
                    requested=extras
                    spec.update(minimum_first=True,smallest_requested=True)
            # Preserve deliberate edits to previously sized variants.
            if spec.get('sized_widths_mm')!=spec.get('widths_mm') and 'sized_widths_mm' in spec:
                requested=spec['widths_mm']
            settings={**p['settings'],**PROFILE}
            if spec.get('size_axis')=='height' and spec.get('heights_mm'):
                converted=widths_for_heights(self.store,p['model'],settings,spec['heights_mm'])
                if spec.get('manual_height_mm') is not None:
                    spec['minimum_width_mm']=converted[0]
                    requested=converted[1:]
                else:requested=converted
            widths,reports=size_variants(self.store,p['model'],settings,{**spec,'widths_mm':requested})
            if widths:
                spec.update(requested_widths_mm=requested,widths_mm=widths,sized_widths_mm=widths)
                spec.update(auto_minimum_mm=None if spec.get('minimum_width_mm') else reports[0]['recommendedWidth'],minimum_tube_mm=6,
                            issues=[i for i in spec.get('issues',[]) if not size_only_issue(i)])
                settings['width']=widths[0]
                p.update(spec=spec,settings=settings,metrics={**(p.get('metrics') or {}),'manufacturing':reports[0]})

    def design_artifacts(self,p,snapshot):
        spec=validate_spec(p['spec'])
        widths=spec['widths_mm'];settings=dict(p['settings'])
        variants=[]
        for i,width in enumerate(widths):
            options={**settings,'width':width,'tube':6,'shape':spec['shape']}
            if i>0 or abs(float(settings.get('width',0))-width)>.1:options['scale']=None
            d=self.store.drawing(p['model'],json.dumps(options,sort_keys=True))
            if not d.get('exportable') or not d['paths']:raise Review('Zeichnung enthält noch ungeklärte Pfade.')
            if spec.get('minimum_width_mm') is not None and d['width']<spec['minimum_width_mm']-.1:raise Review('Die Zeichnung liegt unter der manuell eingetragenen Mindestbreite.')
            if 'requested_widths_mm' in spec and not spec.get('minimum_width_mm'):
                if measure(d)['recommendedWidth']>width:raise Review('Geometrische Mindestbreite unterschritten.')
            variants.append(d)
        sources=spec.get('source_attachment_ids') or p.get('selected_attachments') or []
        filename=next((a['name'] for a in snapshot.get('attachments',[])
                       if a.get('id') in sources and a.get('name')), '')
        stem=Path(filename).stem
        motif=re.sub(r'(?i)[ _-]+logo\d*$', '', stem).replace('_',' ')[:60]
        files,quotes=artifacts(variants,spec,spec.get('design_name') or motif)
        return files,quotes,variants,spec

    def publish(self,p):
        with self.lock:
            p=self.db.get(p['id'])
            if p['status'] in ('publishing','generating','copying','queued'):raise Review('Projekt wird bereits verarbeitet.')
            if not p.get('copy') or not p.get('model'):raise Review('Kopie oder Zeichnung fehlt.')
            records=[p,*p.get('additional_designs',[])]
            for record in records:self.size_design(record,p['snapshot'])
            p=self.db.save(p['id'],{key:p[key] for key in ('settings','spec','metrics') if key in p}
                           | {'additional_designs':records[1:]})
            card=self.t.card(p['copy'])
            if card['idBoard']!=BOARD or card['idList'] not in (HOLDING,READY):raise Review('Karte wurde weiterbearbeitet. Veröffentlichung hier gesperrt.')
            files=[];quotes=[];variants=[];specs=[];design_notes=[]
            for index,record in enumerate(records,1):
                batch,prices,drawings,spec=self.design_artifacts(record,p['snapshot'])
                if len(records)>1:
                    batch=[(f'Design_{index}_{name}',mime,data) for name,mime,data in batch]
                    design_notes.append(f"Design {index} · {spec['design_name']} · "+
                        ', '.join(decimal(d['width']/10)+' cm / '+q['total_usd']+' USD' for d,q in zip(drawings,prices)))
                files.extend(batch);quotes.extend(prices);variants.extend(drawings);specs.extend([spec]*len(drawings))
            if len(variants)>len(FIELDS):raise Review('Die Karte hat vier Preisfelder. Bitte die Anzahl der Größen je Design reduzieren.')
            spec=specs[0]
            revision=p['revision'];marker='Neon Studio '+p['id']+' Revision '+str(revision)
            p=self.db.save(p['id'],{'publish_revision':revision,'error':'','upload_intent':False},status='publishing')
            new=[]
            cover_id=None
            try:
                for name,mime,data in files:
                    self.db.save(p['id'],{'upload_intent':True})
                    technical=not cover_id and Path(name).stem.endswith('technische_zeichnung') and mime in ('image/jpeg','image/png')
                    endpoint=f"cards/{p['copy']}/attachments"
                    a=self.t.call('POST',endpoint+('?setCover=true' if technical else ''),files={'file':(name,data,mime)},data={'name':name})
                    if technical:cover_id=a['id']
                    new.append(a['id'])
                    self.db.save(p['id'],{'pending_attachments':new,'upload_intent':False})
                desired={USAGE:spec['usage']}
                labels={USAGE:'Einsatz'}
                for i,fields in enumerate(FIELDS):
                    values=['']*4
                    if i<len(variants):
                        drawing=variants[i]
                        values=[quotes[i]['total_usd'],decimal(drawing['width']/10)+' × '+decimal(drawing['height']/10)+' cm',specs[i]['colors'],CUT[specs[i]['shape']]]
                    desired.update(zip(fields,values))
                    labels.update(zip(fields,[f'Preis {i+1} (USD)',f'Größe {i+1}',f'Farbe {i+1}',f'Zuschnitt {i+1}']))
                changes=[]
                for field,value in desired.items():
                    before=field_value(card,field)
                    if before!=value:
                        changes.append(f"{labels[field]}: {before or 'leer'} → {value or 'leer'}")
                        self.t.field(p['copy'],field,value)
                checked=self.t.card(p['copy'])
                if not cover_id or checked.get('idAttachmentCover')!=cover_id:raise Review('Technische Zeichnung als Trello-Titelbild nicht bestätigt.')
                if not set(new).issubset({a['id'] for a in checked.get('attachments',[])}):raise Review('Trello-Anhänge nicht bestätigt.')
                if any(field_value(checked,k)!=v for k,v in desired.items()):raise Review('Custom Fields nicht bestätigt.')
                minimum_note=('\nMindestbreite (manuell): '+decimal(spec['minimum_width_mm']/10)+' cm. Keine automatische Fertigungsfreigabe.') if len(records)==1 and spec.get('minimum_width_mm') is not None else ''
                if len(records)==1 and spec.get('size_axis')=='height' and spec.get('manual_height_mm') is not None:
                    minimum_note='\nMindesthöhe (manuell): '+decimal(spec['manual_height_mm']/10)+' cm. Keine automatische Fertigungsfreigabe.'
                if len(records)==1 and spec.get('auto_minimum_mm'):
                    minimum_note+='\nKleinste geprüfte Breite mit 6-mm-Neonflex: '+decimal(spec['auto_minimum_mm']/10)+' cm.'
                self.t.comment_once(p['copy'],marker+'\n'+('\n'.join(changes)+'\n' if changes else '')+('\n'.join(design_notes)+'\n' if design_notes else '')+f'{len(files)} Dateien erstellt. EK inklusive Versand in USD; Formel-Schätzung, Lieferantenpreis noch nicht bestätigt.'+minimum_note+'\nBearbeiten: https://ops.neontrip.de/ops/neon-studio?project='+p['id'],marker)
                self.t.call('PUT',f"cards/{p['copy']}",json={'name':copy_title(p['snapshot']['name']),'idList':READY})
                checked=self.t.card(p['copy'])
                if checked['idList']!=READY or checked['name']!=copy_title(p['snapshot']['name']):raise Review('Zielliste oder Abschlusstitel nicht bestätigt.')
                return self.db.save(p['id'],{'published_revision':revision,'generated_attachments':new,'pending_attachments':[],'cleanup_pending':[],'quotes':quotes,'error':''},status='ready')
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
        for interrupted in self.db.recover_interrupted():self.fail(interrupted['id'],interrupted['error'])
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
                    if isinstance(e,(ServiceError,Review,ValueError)):
                        message=str(e)
                    else:
                        stage=next((f.name for f in reversed(traceback.extract_tb(e.__traceback__)) if Path(f.filename).name in ('cloud_jobs.py','cloud_ai.py','cloud_trello.py','cloud_exports.py')),'process')
                        message=f'Verarbeitung angehalten ({stage}, {type(e).__name__}). Bitte den Schritt im Studio prüfen.'
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
