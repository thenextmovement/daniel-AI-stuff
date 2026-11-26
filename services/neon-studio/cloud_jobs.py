import base64,fcntl,json,math,os,re,threading,time,traceback
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from requests.exceptions import RequestException
from datetime import datetime,timezone,timedelta
from pathlib import Path
from cloud_trello import Trello,BOARD,TRIGGER,HOLDING,READY,REQUEST,USAGE,FIELDS,eligible,field_value,size_field,color_field,decimal,PROCESSING,NEEDS_REVIEW,plain_title,copy_title,ServiceError
from cloud_ai import generate,validate_spec,Review,drawing_model,smallest_title_widths,size_only_issue
from colors import artwork_neon_color, NEON_COLORS
from geometry import path_bounds
from cloud_exports import artifacts,CUT
from minimum_size import PROFILE, SpacingLimitExceeded, measure, minimum_size, widths_for_heights, target_width


def size_variants(store,model,settings,spec):
    widths=spec.get('widths_mm',[])
    if not isinstance(widths,list) or any(type(w) not in (int,float) or not 80<=w<=20000 for w in widths):
        raise Review('Ungültige Angebotsbreite.')
    manual=spec.get('minimum_width_mm')
    reference=spec.get('reference_match',{}).get('size',{}).get('width_mm')
    floor=manual or reference
    targets=list(dict.fromkeys(widths))
    if spec.get('smallest_requested') or not targets:
        if not floor:raise Review('Keine passende Größenreferenz. Bitte manuell prüfen.')
        if floor not in targets:targets.append(floor)
    if manual and any(w<manual for w in targets):raise Review('Wunschgröße liegt unter der manuellen Mindestbreite.')
    if spec.get('minimum_first') and floor:
        targets=[floor,*[w for w in targets if w!=floor]]
    if len(targets)>4:raise Review('Es sind mehr als vier Angebotsvarianten angefragt.')
    verified=[];reports=[]
    for width in targets:
        options={**settings,**PROFILE,'width':width}
        drawing=store.drawing(model,json.dumps(options,sort_keys=True))
        if floor and drawing['width'] < min(targets)-.001:raise Review('Die Zeichnung unterschreitet die Mindestbreite.')
        report={'recommendedWidth':manual} if manual else measure(drawing)
        if report['recommendedWidth']>width:
            if 'spacing' in report.get('limitingReasons',[]):
                raise SpacingLimitExceeded('Abstand in der Angebotszeichnung zu klein.')
            raise Review('Abstand oder Innenöffnung in der Angebotszeichnung zu klein.')
        verified.append(width)
        reports.append({**report,'recommendedWidth':floor,'referenceBased':bool(reference)})
    return verified,reports


class Jobs:
    def __init__(self,db,store,trello=None):
        self.db=db;self.store=store;self.t=trello or Trello();self.lock=threading.RLock();self.project_locks={}
    def project_lock(self,id):
        with self.lock:
            return self.project_locks.setdefault(id,threading.RLock())
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
    def fail(self,id,error,*,public_reason=None):
        p=self.db.save(id,{'error':error},status='review');self.alert(p,error)
        comment=None
        if error.startswith('Bitte prüfen: ') and p.get('copy_verified'):
            issues=p.get('spec',{}).get('issues',[])
            if p.get('additional_designs'):
                issues=[f"{record['spec']['design_name']}: {issue}" for record in [p,*p['additional_designs']]
                        for issue in record['spec'].get('issues',[])]
            if issues:comment='Noch zu klären\n'+'\n'.join('• '+str(i) for i in issues)
        if not comment and p.get('copy_verified'):
            comment='Auto-Quote angehalten: '+(public_reason or 'Technischer Fehler. Bitte die Fehlermeldung im verlinkten Studio-Projekt prüfen.')
        try:self.mark_copy(p,NEEDS_REVIEW,comment)
        except Exception as exc:print('Review title update failed:',type(exc).__name__,flush=True)
    def ingest(self,source,event):
        card=self.t.card(source)
        source=card['id']
        existing=self.db.for_card(source)
        if existing:return existing
        if not eligible(card['name']):raise Review('Nur LED/Neon-Anfragen ohne 3D werden verarbeitet.')
        if card['idBoard']!=BOARD and not event.startswith('action:'):raise Review('Karte gehört nicht zum Anfrage-Board.')
        p=self.db.enqueue(source,event,card)
        with self.project_lock(p['id']):
            p=self.db.get(p['id'])
            if p['status']=='queued' and not p.get('copy'):
                try:
                    self.ensure_copy(p,card)
                    p=self.db.save(p['id'],{},status='queued')
                except Exception:
                    self.fail(p['id'],'Kartenerstellung nicht bestätigt. Bitte den Kopierstatus im Studio prüfen.')
                    raise
        return p
    def ensure_copy(self,p,source):
        id=p['id']
        if not p.get('copy'):
            if p.get('copy_intent'):raise Review('Kartenerstellung war nicht bestätigt. Vor Wiederholung in Trello prüfen.')
            self.db.save(id,{'copy_intent':True},status='copying')
            copy=self.t.copy(source)
            p=self.db.save(id,{'copy':copy['id'],'copy_url':copy['url']},status='copying')
        if not p.get('copy_verified'):self.t.verify_copy(source,p['copy'])
        return self.db.save(id,{'copy_verified':True})
    def process(self,p):
        id=p['id'];source=p.get('snapshot') or self.t.card(p['source'])
        if not eligible(source['name']):raise Review('Diese Anfrage ist keine LED/Neon-Anfrage.')
        # The normal intake already created the copy; also support older queued jobs.
        p=self.ensure_copy(p,source)
        self.mark_copy(p,PROCESSING)
        self.db.save(id,{},status='generating')
        marker='Neon-Studio-Projekt '+id
        self.t.comment_once(p['copy'],marker+'\nhttps://ops.neontrip.de/ops/neon-studio?project='+id+'\nInterner Auto-Quote-Entwurf; kein Kundenversand.',marker)
        data,metrics=generate(self.t,source,p.get('selected_attachments'))
        designs=data.get('designs',[data])
        records=[self.design_record(design) for design in designs]
        p=self.db.save(id,{**records[0],'additional_designs':records[1:],'metrics':metrics},status='draft')
        self.publish(p, generated=True)

    def reread(self,p):
        card=self.t.card(p[p['reread']])
        if p.get('update_action'):
            if card['idBoard']!=BOARD or card['idList']!=READY:
                raise Review('Update abgebrochen: Karte steht nicht mehr in AutoQuote Ready.')
            comments=[];before=None
            while True:
                page=self.t.call('GET',f"cards/{card['id']}/actions?filter=commentCard&limit=1000"+('&before='+before if before else ''))
                comments.extend(page)
                if len(page)<1000:break
                before=page[-1]['id']
            notes=[]
            for action in sorted(comments,key=lambda a:(a['date'],a['id'])):
                text=action.get('data',{}).get('text','')
                if action['date']<=p.get('update_since','') or action['date']>p['update_action']['date']:continue
                if text.startswith(('Neon Studio ','Neon-Studio-Projekt ','Auto-Quote ','Noch zu klären')):continue
                notes.append(action['date']+'\n'+text)
            if notes:card['desc']+='\n\nAktuelle Änderungskommentare (chronologisch):\n'+'\n\n'.join(notes)
            card['update_context']=[]
            for design in [p,*p.get('additional_designs',[])]:
                if not design.get('model'):continue
                image=self.store.info(design['model']).get('image','')
                svg=base64.b64decode(image.split(',',1)[1]).decode('utf-8') if image.startswith('data:image/svg+xml;base64,') else None
                card['update_context'].append({'spec':design.get('spec',{}),
                                              'settings':design.get('settings',{}),'drawing':svg})
        if p['reread']=='copy':
            card['name']=plain_title(card['name'])
            outputs=set(p.get('generated_attachments',[]))
            # Previous uploads also remain on the copy. Trello IDs preserve creation time.
            quotes=[a['id'] for a in card['attachments'] if re.match(r'(?:Design_\d+_)?auto_quote_',a['name'],re.I)]
            card['attachments']=[a for a in card['attachments'] if a['id'] not in outputs
                and not (quotes and a['id']>=min(quotes) and re.fullmatch(r'(?:Design_\d+_)?image\.png',a['name'],re.I))]
            output_fields={field for group in FIELDS for field in group}
            card['customFieldItems']=[item for item in card.get('customFieldItems',[]) if item['idCustomField'] not in output_fields]
        data,metrics=generate(self.t,card)
        designs=data.get('designs',[data])
        records=[self.design_record(design) for design in designs]
        for record in records:
            try:self.size_design(record,card)
            except SpacingLimitExceeded:
                fallback=self.png_centerlines(record,card) if len(records)==1 else None
                if fallback is None:raise
                self.size_design(fallback,card)
                record.update(fallback)
        changes={**records[0],'metrics':{**metrics,**records[0].get('metrics',{})},'additional_designs':records[1:],
                 'snapshot':card,'selected_attachments':[],'reread':None,'error':''}
        self.db.save(p['id'],changes,expected=p['revision'],status='draft')

    def design_record(self,data):
        # Persist even an incomplete spec so a staff member can correct it.
        model,part_modes=drawing_model(data)
        info=self.store.add_model(model,'KI-Zeichnung.svg')
        spec={k:v for k,v in data.items() if k!='svg'}
        if spec.get('usage')=='Außen' and spec.get('waterproof_psus') is None:
            spec['waterproof_psus']=1
            spec['issues']=[*(spec.get('issues') or []),'Ein wasserdichtes Netzteil je Schild ist vorläufig eingerechnet. Wie viele werden benötigt?']
        settings={'mode':'single','partModes':part_modes,'shape':spec.get('shape') or 'shape','width':(spec.get('widths_mm') or [600])[0],'gap':15,'tube':6,'radius':3,'depth':20,'reserve':.1,'scale':None}
        if spec.get('fixed_board'):
            settings.update(fixedBoard=dict(spec['fixed_board']),shape='rectangle',width=spec['fixed_board']['width_mm'])
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
        if p.get('model') and p['settings'].get('fixedBoard'):
            settings={**p['settings'],**PROFILE,'shape':'rectangle'}
            board=settings['fixedBoard']
            settings['width']=board['width_mm']
            drawing=self.store.drawing(p['model'],json.dumps(settings,sort_keys=True))
            issues={};measure(drawing,issues);report=measure(drawing)
            previous=spec.get('fixed_fit_notes',[])
            notes=[f"Feste Wunschgröße: {len(issues)} enge Stelle(n) im Neonmotiv. Maße bleiben erhalten; Konturen vor Fertigung prüfen."] if issues else []
            spec.update(fixed_board=dict(board),shape='rectangle',widths_mm=[board['width_mm']],
                        sized_widths_mm=[board['width_mm']],requested_widths_mm=[board['width_mm']],
                        minimum_first=False,smallest_requested=False,auto_minimum_mm=None,
                        fixed_fit_notes=notes,issues=[i for i in spec.get('issues',[]) if i not in previous]+notes)
            p.update(spec=spec,settings=settings,metrics={**(p.get('metrics') or {}),'manufacturing':report})
            return
        if p.get('model'):
            from reference_matching import select
            match=select(self.t,self.store,self.db,p,snapshot)
            spec['reference_match']=match
            if match.get('cut'):
                p['settings']={**p['settings'],'referenceContour':'follow'}
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
                height_notes=[]
                if spec.get('size_axis')=='height' and spec.get('heights_mm') and spec.get('manual_height_mm') is None:
                    for height,target in zip(spec['heights_mm'],converted):
                        if any(abs(w-target)<=.01 for w in widths):continue
                        reason=f'Wunschhöhe {height/10:g} cm: Die aktuellen Konturen benötigen mehr Platz.'
                        height_notes.append(reason+' Bitte Wunschhöhe und Referenzgröße prüfen.')
                previous_notes=spec.get('height_fit_notes',[])
                issues=[i for i in spec.get('issues',[]) if not size_only_issue(i) and i not in previous_notes]
                if height_notes or previous_notes:
                    spec['height_fit_notes']=height_notes
                spec.update(requested_widths_mm=requested,widths_mm=widths,sized_widths_mm=widths)
                spec.update(auto_minimum_mm=None,reference_width_mm=match.get('size',{}).get('width_mm'),minimum_tube_mm=6,
                            issues=issues+height_notes)
                settings['width']=widths[0]
                p.update(spec=spec,settings=settings,metrics={**(p.get('metrics') or {}),'manufacturing':reports[0]})

    def design_artifacts(self,p,snapshot):
        spec=validate_spec(p['spec'],draft=True)
        widths=spec['widths_mm'];settings=dict(p['settings'])
        variants=[]
        for i,width in enumerate(widths):
            options={**settings,'width':width,'tube':6,'shape':spec['shape']}
            if i>0 or abs(float(settings.get('width',0))-width)>.1:options['scale']=None
            d=self.store.drawing(p['model'],json.dumps(options,sort_keys=True))
            if not d.get('exportable') or not d['paths']:raise Review('Zeichnung enthält noch ungeklärte Pfade.')
            if spec.get('minimum_width_mm') is not None and d['width']<spec['minimum_width_mm']-.1:raise Review('Die Zeichnung liegt unter der manuell eingetragenen Mindestbreite.')
            if 'requested_widths_mm' in spec and not spec.get('minimum_width_mm') and not spec.get('fixed_board'):
                if measure(d)['recommendedWidth']>width:raise Review('Zeichnung passt bei dieser Größe nicht. Bitte prüfen; keine automatische Vergrößerung.')
            variants.append(d)
        sources=spec.get('source_attachment_ids') or p.get('selected_attachments') or []
        filename=next((a['name'] for a in snapshot.get('attachments',[])
                       if a.get('id') in sources and a.get('name')), '')
        stem=Path(filename).stem
        motif=re.sub(r'(?i)[ _-]+logo\d*$', '', stem).replace('_',' ')[:60]
        files,quotes=artifacts(variants,spec,spec.get('design_name') or motif)
        return files,quotes,variants,spec

    def png_centerlines(self,record,snapshot):
        spec=record['spec']
        if spec.get('excluded_regions'):
            return None  # A full-image trace would restore intentionally omitted artwork.
        plan=spec.get('line_plan',[])
        if not plan or any(r['mode']!='single' or r.get('dot_ids') for r in plan):return None
        ids=spec.get('source_attachment_ids',[])
        if len(set(ids))!=1:return None
        attachment=next((a for a in snapshot.get('attachments',[]) if a['id']==ids[0] and a.get('isUpload')),None)
        if not attachment:return None
        name=attachment.get('fileName') or attachment['name']
        if Path(name).suffix.lower()!='.png':return None
        raw=self.t.download(snapshot['id'],attachment)
        if not raw.startswith(b'\x89PNG\r\n\x1a\n'):return None
        from tracing import analyze_image
        model=analyze_image(raw)
        paths=model['modes']['single']
        if not paths or any(path.get('method')=='silhouette' for path in paths):return None
        info=self.store.add_model(model,name)
        settings={**record['settings'],'partModes':{},'pathColors':{}}
        drawing=self.store.drawing(info['id'],json.dumps(settings,sort_keys=True))
        keys=drawing['pathKeys']
        colors=spec.get('colors','')
        if isinstance(colors,list):colors=' + '.join(colors)
        color=next((c['id'] for c in NEON_COLORS if colors in (c['name'],c['english'])),None)
        if color:
            settings['pathColors']=dict.fromkeys(keys,color)
        elif spec.get('colors_from_artwork'):
            settings['pathColors']={key:artwork_neon_color(drawing['colorSources'][key])['id'] for key in keys}
            names={c['name'] for c in NEON_COLORS if c['id'] in settings['pathColors'].values()}
            if names!=set(colors.split(' + ')):return None
        else:
            # Retain the explicit colour from the AI design if it has a single ink.
            if not colors or '+' in colors:return None
            previous=self.store.drawing(record['model'],json.dumps(record['settings'],sort_keys=True))
            inks={c['id'] for c in previous['pathColors']}
            if len(inks)!=1:return None
            settings['pathColors']=dict.fromkeys(keys,inks.pop())
        region={'name':Path(name).stem,'mode':'single','reason':'Mittellinien aus der Original-PNG nach Abstandsprüfung.',
                'path_ids':keys,'dot_ids':[]}
        return {**record,'model':info['id'],'settings':settings,'spec':{**spec,'line_plan':[region]}}

    def publish(self,p,generated=False):
        with self.project_lock(p['id']):
            p=self.db.get(p['id'])
            if p['status'] in ('publishing','generating','copying','queued'):raise Review('Projekt wird bereits verarbeitet.')
            if not p.get('copy') or not p.get('model'):raise Review('Kopie oder Zeichnung fehlt.')
            records=[p,*p.get('additional_designs',[])]
            for record in records:
                try:self.size_design(record,p['snapshot'])
                except SpacingLimitExceeded:
                    if not generated or len(records)!=1:raise
                    retry=self.png_centerlines(record,p['snapshot'])
                    if retry is None:raise
                    self.size_design(retry,p['snapshot'])
                    record.update(retry)
            p=self.db.save(p['id'],{key:p[key] for key in ('model','settings','spec','metrics') if key in p}
                           | {'additional_designs':records[1:]})
            card=self.t.card(p['copy'])
            if card['idBoard']!=BOARD or card['idList'] not in (HOLDING,READY):raise Review('Karte wurde weiterbearbeitet. Veröffentlichung hier gesperrt.')
            files=[];quotes=[];variants=[];specs=[];design_notes=[]
            for index,record in enumerate(records,1):
                batch,prices,drawings,spec=self.design_artifacts(record,p['snapshot'])
                from reference_matching import check_contour
                for drawing in drawings:
                    check_contour(self.t,drawing,spec.get('reference_match',{}))
                if len(records)>1:
                    batch=[(f'mockup{index}.jpg' if name=='mockup1.jpg' else f'Design_{index}_{name}',mime,data) for name,mime,data in batch]
                    design_notes.append(f"Design {index} · {spec['design_name']} · "+
                        ', '.join(decimal(d['width']/10)+' cm / '+q['total_usd']+' USD' for d,q in zip(drawings,prices)))
                for kind,reference in spec.get('reference_match',{}).items():
                    if isinstance(reference,dict) and reference.get('card_url'):
                        design_notes.append(('Größenreferenz' if kind=='size' else 'Zuschnittreferenz')+': '+reference['card_url']+' · '+reference['reason'])
                if spec.get('issues'):
                    heading=f"Design {index} · " if len(records)>1 else ''
                    design_notes.append(heading+'Offen im Entwurf ('+spec['colors']+', '+spec['usage']+')')
                    design_notes.extend('• '+str(question) for question in spec['issues'])
                files.extend(batch);quotes.extend(prices);variants.extend(drawings);specs.extend([spec]*len(drawings))
            if len(variants)>len(FIELDS):
                design_notes.append('Die ersten vier Varianten stehen in den Preisfeldern. Alle weiteren Varianten stehen oben und in den zugehörigen Angebots-PDFs.')
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
                        values=[quotes[i]['total_usd'],size_field(drawing['width'],drawing['height']),color_field(specs[i]['colors']),CUT[specs[i]['shape']]]
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
                if len(records)==1 and spec.get('reference_width_mm'):
                    minimum_note+='\nEmpfohlene Breite nach Lieferantenreferenz: '+decimal(spec['reference_width_mm']/10)+' cm. Keine Fertigungsfreigabe.'
                self.t.comment_once(p['copy'],marker+'\n'+('\n'.join(changes)+'\n' if changes else '')+('\n'.join(design_notes)+'\n' if design_notes else '')+f'{len(files)} Dateien erstellt. EK inklusive Versand in USD; Formel-Schätzung, Lieferantenpreis noch nicht bestätigt.'+minimum_note+'\nBearbeiten: https://ops.neontrip.de/ops/neon-studio?project='+p['id'],marker)
                self.t.call('PUT',f"cards/{p['copy']}",json={'name':copy_title(p['snapshot']['name']),'idList':READY,'pos':'bottom'})
                checked=self.t.card(p['copy'])
                if checked['idList']!=READY or checked['name']!=copy_title(p['snapshot']['name']):raise Review('Zielliste oder Abschlusstitel nicht bestätigt.')
                return self.db.save(p['id'],{'published_revision':revision,'generated_attachments':new,'pending_attachments':[],'cleanup_pending':[],'quotes':quotes,'error':''},status='ready')
            except Exception:
                # Preserve intent and IDs for reconciliation. Never repeat an uncertain upload.
                raise
    def queue_update(self,action):
        data=action.get('data',{});label=data.get('label',{})
        if label.get('name','').strip().casefold()!='updates autoquote':return
        event='label:'+action['id']
        with self.db.connect() as c:
            if c.execute('SELECT 1 FROM events WHERE id=?',(event,)).fetchone():return
        card=self.t.card(data['card']['id'])
        if card['idBoard']!=BOARD or card['idList']!=READY or label['id'] not in card.get('idLabels',[]):return
        p=self.db.for_card(card['id'])
        if not p or p.get('copy')!=card['id']:return
        with self.project_lock(p['id']):
            p=self.db.get(p['id'])
            if p['status'] in ('copying','generating','publishing','queued','publish_queued'):
                raise ServiceError('Update wartet auf den laufenden Auftrag.')
            if p.get('upload_intent') or p.get('pending_attachments'):
                raise ServiceError('Vor dem Update muss die unbestätigte Übertragung abgeglichen werden.')
            with self.lock:self.t.update_status(card['id'],'processing')
            # Claim the action and queue its job atomically; overlapping polls and
            # service restarts must not generate or upload a second set of files.
            with self.db.connect() as c:
                c.execute('BEGIN IMMEDIATE')
                if c.execute('SELECT 1 FROM events WHERE id=?',(event,)).fetchone():return
                row=c.execute('SELECT data FROM projects WHERE id=?',(p['id'],)).fetchone()
                saved=json.loads(row[0]);saved.update(reread='copy',error='',update_action={
                    'id':action['id'],'date':action['date'],'label':label['id']})
                c.execute("UPDATE projects SET data=?,status='queued',revision=revision+1,updated=? WHERE id=?",(json.dumps(saved),time.time(),p['id']))
                c.execute('INSERT INTO events VALUES(?,?)',(event,p['id']))

    def poll_update_labels(self):
        # Trello label webhook events are not reliably returned by /actions.
        # Observe the labels themselves and persist one claim per application.
        with self.lock:
            cards=self.t.call('GET',f'lists/{READY}/cards?fields=id,labels')
            previous=json.loads(self.db.meta('update_labels') or '{}')
            current={};actions=[]
            for card in cards:
                label=next((l for l in card.get('labels',[]) if l.get('name','').strip().casefold()=='updates autoquote'),None)
                if not label:continue
                claim=previous.get(card['id']) or {'id':'present:'+uuid4().hex,'date':datetime.now(timezone.utc).isoformat()}
                current[card['id']]=claim
                actions.append({**claim,'data':{'card':{'id':card['id']},'label':label}})
            self.db.meta('update_labels',json.dumps(current))
        for action in actions:
            p=self.db.for_card(action['data']['card']['id'])
            if p and p['status'] in ('copying','generating','publishing','queued','publish_queued'):continue
            self.queue_update(action)

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
        self.poll_update_labels()
        self.db.meta('last_poll',time.time())
    def run(self):
        # One worker owns the shared database even during a rolling deployment.
        lease=open(self.db.root/'worker.lock','a')
        while True:
            try:fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB);break
            except BlockingIOError:time.sleep(2)
        for interrupted in self.db.recover_interrupted():self.fail(interrupted['id'],interrupted['error'])
        threading.Thread(target=self.watch,daemon=True).start()
        with ThreadPoolExecutor(max_workers=3,thread_name_prefix='neon-job') as pool:
            active={}
            while True:
                self.dispatch(pool,active)
                time.sleep(2)
    def dispatch(self,pool,active):
        for id,future in list(active.items()):
            if future.done():
                future.result()
                del active[id]
        for p in self.db.pending():
            if len(active)>=3:break
            if p['id'] not in active:active[p['id']]=pool.submit(self.execute,p)
    def execute(self,p):
        with self.project_lock(p['id']):
            p=self.db.get(p['id'])
            if p['status'] not in ('queued','publish_queued'):return
            try:
                if p.get('reread'):
                    self.reread(p)
                    if p.get('update_action'):
                        self.publish(self.db.get(p['id']),generated=True)
                        update=p['update_action']
                        self.t.call('DELETE',f"cards/{p['copy']}/idLabels/{update['label']}")
                        with self.lock:
                            self.t.update_status(p['copy'],'completed')
                            claims=json.loads(self.db.meta('update_labels') or '{}')
                            claims.pop(p['copy'],None)
                            self.db.meta('update_labels',json.dumps(claims))
                        self.db.save(p['id'],{'update_since':update['date'],'update_action':None})
                elif p['status']=='publish_queued':
                    self.publish(p)
                else:self.process(p)
            except Exception as e:
                print('Neon job failed:',type(e).__name__,flush=True)
                if isinstance(e,(ServiceError,Review,ValueError)):
                    message=str(e)
                else:
                    stage=next((f.name for f in reversed(traceback.extract_tb(e.__traceback__)) if Path(f.filename).name in ('cloud_jobs.py','cloud_ai.py','cloud_trello.py','cloud_exports.py')),'process')
                    message=f'Verarbeitung angehalten ({stage}, {type(e).__name__}). Bitte den Schritt im Studio prüfen.'
                if p.get('reread'):
                    self.db.save(p['id'],{'reread':None,'error':'Neu einlesen fehlgeschlagen. '+message},status='review')
                    if p.get('update_action'):
                        try:
                            with self.lock:self.t.update_status(p['copy'],None)
                        except Exception:pass
                        marker='Auto-Quote Update '+p['update_action']['id']
                        try:self.t.comment_once(p['copy'],marker+'\nUpdate nicht vollständig bestätigt. Die bisherigen Dateien bleiben erhalten. Bitte den Projektstatus im Studio prüfen.',marker)
                        except Exception:pass
                else:self.fail(p['id'],message,public_reason=message if isinstance(e,(Review,SpacingLimitExceeded)) else None)
    def watch(self):
        while True:
            if os.getenv('NEON_WATCH_ENABLED')=='true':
                try:self.poll();self.db.meta('watch_error','')
                except Exception:
                    self.db.meta('watch_error','Trello-Abruf fehlgeschlagen.')
                    self.alert({'id':'watcher'},'Trello-Abruf fehlgeschlagen. Neue Anfragen werden erst nach erfolgreichem Abruf verarbeitet.')
            time.sleep(30)
