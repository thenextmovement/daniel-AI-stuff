"""Local static preview + same-origin 3D persistence API proxy (no live writes)."""
import argparse
from functools import partial
from http.client import HTTPConnection
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
class Handler(SimpleHTTPRequestHandler):
    def api(self):
        path=urlsplit(self.path).path
        if path not in ['/api/public/configurator-3d/drafts','/api/public/configurator-3d/handoff']:
            return False
        size=int(self.headers.get('Content-Length','0'))
        if size>2000000:
            self.send_error(413);return True
        try:
            connection=HTTPConnection('127.0.0.1',18879,timeout=25)
            headers={k:v for k,v in self.headers.items() if k.lower() in ['host','origin','authorization','content-type']}
            connection.request(self.command,path,self.rfile.read(size) if size else None,headers)
            response=connection.getresponse();data=response.read()
            self.send_response(response.status)
            for key,value in response.getheaders():
                if key.lower() not in ['connection','transfer-encoding','content-length']:
                    self.send_header(key,value)
            self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);connection.close()
        except (OSError,TimeoutError):
            self.send_response(503);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"error":{"code":"STORAGE_UNAVAILABLE"}}')
        return True
    def do_GET(self):
        if not self.api():super().do_GET()
    def do_PUT(self):
        if not self.api():self.send_error(405)
    def do_POST(self):
        if not self.api():self.send_error(405)
    def end_headers(self):
        self.send_header('Cache-Control','no-store');super().end_headers()
    def log_message(self,*args):pass
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True);parser.add_argument('--port',type=int,default=18877);parser.add_argument('--bind',default='127.0.0.1');args=parser.parse_args()
    ThreadingHTTPServer((args.bind,args.port),partial(Handler,directory=args.root)).serve_forever()
