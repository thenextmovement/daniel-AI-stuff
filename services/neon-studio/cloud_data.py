"""Private durable studio data. Only server-created models are deserialized."""
import json, os, pickle, sqlite3, time, uuid
from pathlib import Path
from server import Store

class Conflict(ValueError): pass

class Database:
    def __init__(self, root):
        self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True)
        self.path=self.root/'studio.sqlite3'
        with self.connect() as c:
            c.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, source TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, data TEXT NOT NULL, updated REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS models(id TEXT PRIMARY KEY, model BLOB NOT NULL, info TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, project TEXT);
            """)
    def recover_interrupted(self):
        with self.connect() as c:
            ids=[r[0] for r in c.execute("SELECT id FROM projects WHERE status IN ('copying','generating','publishing')")]
            c.execute("UPDATE projects SET status='review', data=json_set(data,'$.error','Verarbeitung durch Neustart unterbrochen. Zustand vor erneutem Start prüfen.') WHERE status IN ('copying','generating','publishing')")
        return [self.get(id) for id in ids]
    def connect(self):
        c=sqlite3.connect(self.path,timeout=30);c.row_factory=sqlite3.Row;return c
    def get(self,id):
        with self.connect() as c:r=c.execute("SELECT * FROM projects WHERE id=?",(id,)).fetchone()
        if not r:raise ValueError('Projekt nicht gefunden.')
        return {**json.loads(r['data']),**{k:r[k] for k in ('id','source','revision','status','updated')}}
    def for_card(self,card):
        with self.connect() as c:
            r=c.execute("SELECT id FROM projects WHERE source=? OR json_extract(data,'$.copy')=? LIMIT 1",(card,card)).fetchone()
        return self.get(r[0]) if r else None
    def save(self,id,data,expected=None,status=None):
        with self.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            r=c.execute("SELECT * FROM projects WHERE id=?",(id,)).fetchone()
            if not r:raise ValueError('Projekt nicht gefunden.')
            if expected is not None and expected!=r['revision']:raise Conflict('Projekt wurde inzwischen geändert. Bitte neu öffnen.')
            old=json.loads(r['data']);old.update(data)
            c.execute("UPDATE projects SET data=?,revision=revision+1,status=?,updated=? WHERE id=?",(json.dumps(old),status or r['status'],time.time(),id))
        return self.get(id)
    def enqueue(self,source,event,snapshot=None):
        with self.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            c.execute("INSERT OR IGNORE INTO projects VALUES(?,?,0,'queued',?,?)",(uuid.uuid4().hex,source,json.dumps({'snapshot':snapshot}),time.time()))
            id=c.execute("SELECT id FROM projects WHERE source=?",(source,)).fetchone()[0]
            c.execute("INSERT OR IGNORE INTO events VALUES(?,?)",(event,id))
        return self.get(id)
    def pending(self):
        with self.connect() as c:ids=[r[0] for r in c.execute("SELECT id FROM projects WHERE status IN ('queued','publish_queued') ORDER BY updated LIMIT 20")]
        return [self.get(id) for id in ids]
    def list(self):
        with self.connect() as c:ids=[r[0] for r in c.execute("SELECT id FROM projects ORDER BY updated DESC LIMIT 200")]
        return [self.get(id) for id in ids]
    def meta(self,key,value=None):
        with self.connect() as c:
            if value is not None:c.execute("INSERT OR REPLACE INTO meta VALUES(?,?)",(key,str(value)))
            r=c.execute("SELECT value FROM meta WHERE key=?",(key,)).fetchone()
        return r[0] if r else None

class DurableStore(Store):
    def __init__(self,db):
        super().__init__();self.db=db
    def add_model(self,model,name):
        info=super().add_model(model,name)
        with self.db.connect() as c:c.execute("INSERT INTO models VALUES(?,?,?)",(info['id'],pickle.dumps(model),json.dumps(info)))
        return info
    def model(self,token):
        with self.lock:
            if token in self.models:return super().model(token)
        with self.db.connect() as c:r=c.execute("SELECT model FROM models WHERE id=?",(token,)).fetchone()
        if not r:raise ValueError('Motiv nicht gefunden.')
        # Database is private, never writable through an upload or API.
        model=pickle.loads(r[0])
        with self.lock:
            self.models[token]=model
            while len(self.models)>12:self.models.popitem(last=False)
        return model
    def info(self,token):
        with self.db.connect() as c:r=c.execute("SELECT info FROM models WHERE id=?",(token,)).fetchone()
        if not r:raise ValueError('Motiv nicht gefunden.')
        return json.loads(r[0])
