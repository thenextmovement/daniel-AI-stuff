import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).with_name('restore_runtime_20261026.py')
spec=importlib.util.spec_from_file_location('repair',MODULE)
repair=importlib.util.module_from_spec(spec)
if MODULE.exists(): spec.loader.exec_module(repair)

OLD={'commit':'1f2ab96b8d5282f6eafc36ccf7b599cb3e33ccdf','image':'sha256:17b5adf13367eac5c52ad31c65d640c9d8e1624fccb3df416ef2abecd4211f6b','source_sha256':'b269417d90d2f9f152d0a78ed9dff6d19b1dd30af35aa8636cb640432da81bb8'}
NEW={**OLD,'image':'sha256:f0877895a77aba322f31afbd59bca618ba2869ce4b74075477ae5f7854dce0e5'}

class Docker:
 def __init__(self):self.container=None;self.calls=[];self.dead=False
 def __call__(self,args):
  self.calls.append(args)
  if args==['info','--format','{{.ID}}']:return 'daemon-id'
  if args[:2]==['ps','-a']:return 'fixture-id' if self.container else ''
  if args[:2]==['run','-d']:
   self.container={'Image':NEW['image'],'State':{'Running':not self.dead},'Path':'/bin/sleep','Args':['infinity'],'Mounts':[],
    'Config':{'User':'65534:65534','Labels':{'com.neontrip.purpose':'leo-runtime-retention'},'Healthcheck':{'Test':['NONE']}},
    'HostConfig':{'NetworkMode':'none','ReadonlyRootfs':True,'RestartPolicy':{'Name':'unless-stopped'},'CapDrop':['ALL'],'SecurityOpt':['no-new-privileges'],'Memory':16777216,'PidsLimit':16,'NanoCpus':50000000,'PortBindings':{},'Privileged':False}}
   return 'fixture-id'
  if args[:2]==['container','inspect']:return json.dumps([self.container])
  raise AssertionError(f'unexpected command {args}')

class RestoreTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.base=Path(self.temp.name)
  (self.base/'release.json').write_text(json.dumps(OLD));(self.base/'state').mkdir();(self.base/'state/state.json').write_text('quota unchanged')
  self.docker=Docker();self.checked=[]
 def validate(self,value):self.assertEqual(value,NEW);self.checked.append(value)
 def run_repair(self):
  self.assertTrue(hasattr(repair,'restore'),'Missing guarded runtime restore')
  return repair.restore(self.base,self.docker,self.validate)
 def manifest(self):return json.loads((self.base/'release.json').read_text())
 def test_restores_only_image_after_running_isolated_retainer(self):
  self.run_repair();self.assertEqual(self.manifest(),NEW);self.assertTrue(self.checked)
  self.assertEqual((self.base/'state/state.json').read_text(),'quota unchanged')
  run=next(c for c in self.docker.calls if c[:2]==['run','-d'])
  for flag in ['--pull=never','--network=none','--read-only','--no-healthcheck','--restart=unless-stopped','--user=65534:65534','--entrypoint=/bin/sleep']:self.assertIn(flag,run)
  self.assertFalse(any(x in run for x in ['--env','--mount','--volume','--publish']))
  self.assertEqual(run[-2:],[NEW['image'],'infinity'])
  self.assertEqual((self.base/'release.json').stat().st_mode & 0o777,0o600)
 def test_idempotent_second_run_does_not_start_another_container(self):
  self.run_repair();before=(self.base/'release.json').stat().st_mtime_ns
  self.run_repair();self.assertEqual(sum(x[:2]==['run','-d'] for x in self.docker.calls),1)
  self.assertEqual((self.base/'release.json').stat().st_mtime_ns,before)
 def test_unknown_manifest_is_never_replaced(self):
  (self.base/'release.json').write_text(json.dumps({**OLD,'commit':'a'*40}))
  with self.assertRaisesRegex(ValueError,'manifest'):self.run_repair()
  self.assertEqual(self.manifest()['commit'],'a'*40);self.assertEqual(self.docker.calls,[])
 def test_changed_source_or_missing_image_stops_before_container_and_manifest(self):
  def reject(_):raise ValueError('leo_release_changed')
  self.validate=reject
  with self.assertRaisesRegex(ValueError,'release_changed'):self.run_repair()
  self.assertEqual(self.manifest(),OLD);self.assertEqual(self.docker.calls,[])
 def test_dead_retainer_leaves_old_manifest_and_is_not_recreated_blindly(self):
  self.docker.dead=True
  with self.assertRaisesRegex(ValueError,'retainer'):self.run_repair()
  self.assertEqual(self.manifest(),OLD)
  with self.assertRaisesRegex(ValueError,'retainer'):self.run_repair()
  self.assertEqual(sum(x[:2]==['run','-d'] for x in self.docker.calls),1)
 def test_foreign_or_unsafe_existing_container_is_untouched(self):
  self.run_repair()
  for path,value in [(('Image',),'sha256:'+'0'*64),(('Mounts',),[{'Source':'/secret'}]),(('HostConfig','NetworkMode'),'host'),(('HostConfig','Privileged'),True),(('Config','Healthcheck'),{'Test':['CMD','curl','https://bad.invalid']})]:
   with self.subTest(path=path):
    self.docker.container=copy.deepcopy(self.docker.container);original=copy.deepcopy(self.docker.container)
    target=self.docker.container
    for key in path[:-1]:target=target[key]
    target[path[-1]]=value
    (self.base/'release.json').write_text(json.dumps(OLD))
    with self.assertRaisesRegex(ValueError,'retainer'):self.run_repair()
    self.assertEqual(self.manifest(),OLD);self.docker.container=original
 def test_concurrent_release_edit_is_not_overwritten(self):
  original=self.docker
  def racing(args):
   result=original(args)
   if args[:2]==['container','inspect']:(self.base/'release.json').write_text(json.dumps({**OLD,'commit':'b'*40}))
   return result
  self.docker=racing
  with self.assertRaisesRegex(ValueError,'manifest'):self.run_repair()
  self.assertEqual(self.manifest()['commit'],'b'*40)
 def test_worker_lock_prevents_change(self):
  import fcntl
  with (self.base/'run.lock').open('a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaises(BlockingIOError):self.run_repair()
  self.assertEqual(self.manifest(),OLD);self.assertEqual(self.docker.calls,[])

if __name__=='__main__':unittest.main(verbosity=2)
