import os,re,time,requests
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
def eligible(name):
    return bool(re.search(r'\b(?:LED|NEON)\b',name,re.I)) and not re.search(r'\b3D\b',name,re.I) and '🤖' not in name
def decimal(value):
    return ('%.2f'%float(value)).replace('.',',')
def field_value(card,id):
    return next((x.get('value',{}).get('text','') for x in card.get('customFieldItems',[]) if x['idCustomField']==id),'')
class Trello:
    def __init__(self):
        self.key=os.environ['TRELLO_API_KEY'];self.token=os.environ['TRELLO_TOKEN']
    def call(self,method,path,**kwargs):
        # Never retry mutations: an interrupted response may already have succeeded.
        r=requests.request(method,'https://api.trello.com/1/'+path,
            params={'key':self.key,'token':self.token},timeout=(15,90),**kwargs)
        if not r.ok:raise RuntimeError('Trello bestätigt den Schritt nicht (HTTP %s).'%r.status_code)
        return r.json() if r.content else {}
    def card(self,id):
        if not re.fullmatch(r'[a-f0-9]{24}',id):raise ValueError('Ungültige Karten-ID.')
        return self.call('GET',f'cards/{id}?attachments=true&customFieldItems=true&checklists=all&members=true&fields=all')
    def field(self,id,field,value):
        return self.call('PUT',f'cards/{id}/customField/{field}/item',json=({'value':'','idValue':''} if value=='' else {'value':{'text':str(value)}}))
    def copy(self,source):
        return self.call('POST','cards',json={'idCardSource':source['id'],'idList':HOLDING,'keepFromSource':'all','name':source['name'],'desc':source['desc'],'dueComplete':False})
    def verify_copy(self,source,copyid):
        copy=self.card(copyid)
        if copy['name']!=source['name'] or copy['desc']!=source['desc']:raise RuntimeError('Kopie stimmt nicht mit Titel und Beschreibung überein.')
        src=sorted((a['name'],a.get('bytes',0)) for a in source.get('attachments',[]))
        dst=sorted((a['name'],a.get('bytes',0)) for a in copy.get('attachments',[]))
        if src!=dst:raise RuntimeError('Anhänge der Kopie sind nicht vollständig.')
        for item in source.get('customFieldItems',[]):
            field=item['idCustomField']
            body={k:item[k] for k in ('value','idValue') if k in item}
            self.call('PUT',f'cards/{copyid}/customField/{field}/item',json=body)
        copy=self.card(copyid)
        if field_value(source,REQUEST)!=field_value(copy,REQUEST):raise RuntimeError('Request-ID konnte nicht bestätigt werden.')
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
