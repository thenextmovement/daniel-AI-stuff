import hashlib,math,os,re,time,requests
from collections import Counter
from urllib.parse import urlparse,quote
BOARD='63d10c34105771f01ccf4296'
TRIGGER='63d10c34105771f01ccf42a0'
HOLDING='6a6333cc280a31504fa3ff05'
READY='6abe16986e5a34daddc5c656'
REQUEST='67a200bd23b1ffd304e63335'
USAGE='67b714e5a7b5e806684eb8be'
FIELDS=[
 ['67ab3fba2e8c6d28a877db45','67989c3214f0ccb08ff6bea4','67989cac3cb7e28e19d3dbfe','67ab333359b643271da233e1'],
 ['67ab3fc552ca87d0b4d96044','67989c83b14e7b89fb545dc4','67989cb3c85879336601b578','67ab333c476749520e9e31ec'],
 ['67f4fa9720c565f324c945b8','67f4faad01083793715a3aac','67f4fab7590a76e3d66734ff','67f4fac25f71afb659744bce'],
 ['67f4faf657f304d308f1435b','67f4fb02b7f3aaf40ae0636d','67f4fb0c593bcdebe2a99775','67f4fb1601e710fe13ee8f23']]
PROCESSING='🕒 Processing 🕒 '
NEEDS_REVIEW='🔎 Prüfung erforderlich · '

class ServiceError(RuntimeError):
    """Safe service diagnostics, without request URLs or credentials."""

def plain_title(name):
    return name.removeprefix('🤖 ').removesuffix(' 🤖').removeprefix(PROCESSING).removeprefix(NEEDS_REVIEW)

def copy_title(name,status=''):
    return '🤖 '+status+plain_title(name)+' 🤖'

def eligible(name):
    return bool(re.search(r'\b(?:LED|NEON)\b',name,re.I)) and not re.search(r'\b3D\b',name,re.I) and '🤖' not in name and name==plain_title(name)
def card_reference(value):
    value=value.strip()
    if re.fullmatch(r'(?:[a-f0-9]{24}|[A-Za-z0-9]{8})',value):return value
    parsed=urlparse(value)
    match=re.fullmatch(r'/c/([A-Za-z0-9]{8}|[a-f0-9]{24})(?:/[^/]*)?/?',parsed.path)
    if parsed.scheme=='https' and parsed.netloc.lower() in ('trello.com','www.trello.com') and match:
        return match[1]
    raise ValueError('Bitte einen Trello-Kartenlink einfügen, zum Beispiel https://trello.com/c/AbCd1234.')
def decimal(value):
    return ('%.2f'%float(value)).replace('.',',')
def size_field(width_mm,height_mm):
    # Geometry calculations can leave floating point dust on a whole centimetre.
    return 'x'.join(str(math.ceil(round(mm/10,9))) for mm in (width_mm,height_mm))+'cm'

def color_field(value):
    value=re.sub(r'\b(?:(?:hell(?:e[sr]?)?|dunkel(?:e[sr]?)?)\s*[- ]?)(grün|rot|blau|pink|gelb|orange|lila)\b|\b(zitronengelb)\b',
                 lambda m: m.group(1).capitalize() if m.group(1) else 'Gelb',value,flags=re.I)
    return ' + '.join(dict.fromkeys(part.strip() for part in re.split(r'[+,;/]',value) if part.strip()))

def field_value(card,id):
    return next((x.get('value',{}).get('text','') for x in card.get('customFieldItems',[]) if x['idCustomField']==id),'')
def request_id(card):
    definitions=card.get('field_definitions',[])
    field=next((f['id'] for f in definitions if f['name']=='Nerdy-Forms_ID' and f['type']=='text'),REQUEST)
    return field_value(card,field)
def named_fields(card):
    definitions={f['id']:f for f in card.get('field_definitions',[])}
    result=[]
    for item in card.get('customFieldItems',[]):
        definition=definitions.get(item['idCustomField'])
        if not definition:continue
        if definition['type']=='list':
            option=next((o for o in definition.get('options',[]) if (o.get('id') or o.get('_id'))==item.get('idValue')),None)
            value=option.get('value',{}).get('text') if option else None
        else:
            value=next(iter(item.get('value',{}).values()),None)
        if value is not None:
            result.append({'name':definition['name'],'type':definition['type'],'value':value})
    return result
class Trello:
    def __init__(self):
        self.key=os.environ['TRELLO_API_KEY'];self.token=os.environ['TRELLO_TOKEN'];self._fields={}
    def call(self,method,path,**kwargs):
        # Never retry mutations: an interrupted response may already have succeeded.
        r=requests.request(method,'https://api.trello.com/1/'+path,
            params={'key':self.key,'token':self.token},timeout=(15,90),**kwargs)
        if not r.ok:raise ServiceError('Trello bestätigt den Schritt nicht (HTTP %s).'%r.status_code)
        return r.json() if r.content else {}
    def fields(self,board,refresh=False):
        if refresh or board not in self._fields:
            self._fields[board]=self.call('GET',f'boards/{board}/customFields')
        return self._fields[board]
    def card(self,id):
        id=card_reference(id)
        card=self.call('GET',f'cards/{id}?attachments=true&customFieldItems=true&checklists=all&members=true&fields=all')
        card['field_definitions']=self.fields(card['idBoard'])
        return card
    def field(self,id,field,value):
        return self.call('PUT',f'cards/{id}/customField/{field}/item',json=({'value':'','idValue':''} if value=='' else {'value':{'text':str(value)}}))
    def copy(self,source):
        return self.call('POST','cards',json={'idCardSource':source['id'],'idList':HOLDING,'keepFromSource':'all','name':copy_title(source['name'],PROCESSING),'desc':source['desc'],'dueComplete':False})
    def verify_copy(self,source,copyid):
        copy=self.card(copyid)
        if plain_title(copy['name'])!=source['name'] or copy['desc']!=source['desc']:raise ServiceError('Kopie stimmt nicht mit Titel und Beschreibung überein.')
        def inventory(card):
            return Counter((a['name'],a.get('bytes',0),bool(a.get('isUpload'))) for a in card.get('attachments',[]))
        src=inventory(source)
        if src!=inventory(copy) or any(count>1 and key[2] for key,count in src.items()):
            # Repeated uploads can appear while Trello is copying the card.
            # Only accept a mismatch when every distinct payload is accounted for.
            def contents(card,card_id):
                uploads=set()
                links=[]
                for a in card.get('attachments',[]):
                    if a.get('isUpload'):
                        uploads.add(hashlib.sha256(self.download(card_id,a)).digest())
                    else:
                        links.append((a['name'],a.get('url','')))
                return uploads,sorted(links)
            if contents(source,source['id'])!=contents(copy,copyid):
                raise ServiceError('Anhänge der Kopie weichen vom Original ab. Bitte die Dateien vergleichen.')
        # Trello remaps IDs when Quentin's automation moves the original to another board.
        # Match semantic fields/options, never write a foreign board's ID into this copy.
        source_defs={f['id']:f for f in source.get('field_definitions',[]) or self.fields(source['idBoard'])}
        target_defs=self.fields(copy['idBoard'],refresh=True)
        expected_request=request_id({**source,'field_definitions':list(source_defs.values())})
        if not expected_request:raise ServiceError('Request-ID fehlt auf der Originalkarte.')
        expected=[]
        for item in source.get('customFieldItems',[]):
            definition=source_defs.get(item['idCustomField'])
            if not definition:raise ServiceError('Feld der Originalkarte konnte nicht zugeordnet werden.')
            matches=[f for f in target_defs if (f['name'],f['type'])==(definition['name'],definition['type'])]
            if len(matches)!=1:raise ServiceError('Feld der Kopie ist nicht eindeutig zugeordnet.')
            target=matches[0];field=target['id']
            if definition['type']=='list':
                option=next((o for o in definition.get('options',[]) if (o.get('id') or o.get('_id'))==item.get('idValue')),None)
                choices=[o for o in target.get('options',[]) if option and o['value']==option['value']]
                if len(choices)!=1:raise ServiceError('Auswahlwert der Kopie konnte nicht zugeordnet werden.')
                body={'idValue':choices[0].get('id') or choices[0]['_id']}
            else:body={'value':item.get('value',{})}
            self.call('PUT',f'cards/{copyid}/customField/{field}/item',json=body)
            expected.append((field,body))
        copy=self.card(copyid)
        if field_value(copy,REQUEST)!=expected_request:raise ServiceError('Request-ID konnte nicht bestätigt werden.')
        for field,body in expected:
            actual=next((i for i in copy.get('customFieldItems',[]) if i['idCustomField']==field),{})
            if any(actual.get(k)!=v for k,v in body.items()):raise ServiceError('Felder der Kopie nicht bestätigt.')
        return copy
    def comment_once(self,id,text,marker):
        comments=self.call('GET',f'cards/{id}/actions?filter=commentCard&limit=1000')
        if any(marker in x.get('data',{}).get('text','') for x in comments):return
        self.call('POST',f'cards/{id}/actions/comments',json={'text':text})
    def download(self,card,attachment):
        if not attachment.get('isUpload'):raise ValueError('Externe Datei bitte direkt als Trello-Anhang hochladen.')
        url='https://api.trello.com/1/cards/%s/attachments/%s/download/%s'%(card,attachment['id'],quote(attachment.get('fileName') or attachment['name'],safe=''))
        headers={'Authorization':f'OAuth oauth_consumer_key="{self.key}", oauth_token="{self.token}"'}
        for _ in range(4):
            host=urlparse(url).hostname or ''
            if not (host in ('api.trello.com','trello.com','attachments.trello.services') or re.fullmatch(r'trello-attachments[.a-z0-9-]*\.amazonaws\.com',host)):
                raise ValueError('Nicht unterstütztes Downloadziel.')
            r=requests.get(url,headers=headers if host in ('api.trello.com','trello.com') else {},timeout=60,allow_redirects=False)
            if r.status_code in (301,302,303,307,308):url=r.headers['Location'];continue
            if not r.ok:raise ValueError('Kundenanhang konnte nicht geladen werden.')
            if len(r.content)>35*1024*1024:raise ValueError('Kundenanhang ist zu groß.')
            return r.content
        raise ValueError('Kundenanhang konnte nicht geladen werden.')
