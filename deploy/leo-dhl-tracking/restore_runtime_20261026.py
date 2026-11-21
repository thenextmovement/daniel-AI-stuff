#!/usr/bin/env python3
"""Explicitly approved, one-time Leo runtime recovery; never starts a DHL poll."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

BASE = Path('/opt/neontrip/leo')
OLD = {
    'commit': '1f2ab96b8d5282f6eafc36ccf7b599cb3e33ccdf',
    'image': 'sha256:17b5adf13367eac5c52ad31c65d640c9d8e1624fccb3df416ef2abecd4211f6b',
    'source_sha256': 'b269417d90d2f9f152d0a78ed9dff6d19b1dd30af35aa8636cb640432da81bb8',
}
NEW = {**OLD, 'image': 'sha256:f0877895a77aba322f31afbd59bca618ba2869ce4b74075477ae5f7854dce0e5'}
NAME = 'leo-dhl-runtime-retainer'


def verify_retainer(value):
    config = value.get('Config', {})
    host = value.get('HostConfig', {})
    required = {
        'NetworkMode': 'none', 'ReadonlyRootfs': True,
        'RestartPolicy': {'Name': 'unless-stopped'},
        'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges'],
        'Memory': 16777216, 'PidsLimit': 16, 'NanoCpus': 50000000,
        'Privileged': False,
    }
    # Docker adds MaximumRetryCount:0 to the restart policy at inspection.
    policy = host.get('RestartPolicy', {})
    if (value.get('Image') != NEW['image'] or not value.get('State', {}).get('Running')
        or value.get('Path') != '/bin/sleep' or value.get('Args') != ['infinity']
        or value.get('Mounts') != [] or config.get('User') != '65534:65534'
        or config.get('Labels', {}).get('com.neontrip.purpose') != 'leo-runtime-retention'
        or config.get('Healthcheck', {}).get('Test') != ['NONE']
        or host.get('PortBindings') not in (None, {})
        or policy.get('Name') != 'unless-stopped' or policy.get('MaximumRetryCount', 0) != 0
        or any(host.get(k) != v for k, v in required.items() if k != 'RestartPolicy')):
        raise ValueError('leo_retainer_unconfirmed')


def restore(base, docker, validate_release):
    """CAS the manifest only after the exact image/source and its keeper are proven."""
    with (base / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path = base / 'release.json'
        before = path.read_bytes()
        manifest = json.loads(before)
        if manifest not in (OLD, NEW):
            raise ValueError('leo_manifest_changed')
        validate_release(NEW)
        docker(['info', '--format', '{{.ID}}'])
        existing = docker(['ps', '-a', '--filter', 'name=^/' + NAME + '$', '--format', '{{.ID}}']).splitlines()
        if len(existing) > 1:
            raise ValueError('leo_retainer_ambiguous')
        if not existing:
            docker([
                'run', '-d', '--pull=never', '--name=' + NAME,
                '--restart=unless-stopped', '--network=none', '--read-only',
                '--cap-drop=ALL', '--security-opt=no-new-privileges',
                '--pids-limit=16', '--memory=16m', '--cpus=0.05',
                '--user=65534:65534', '--no-healthcheck', '--entrypoint=/bin/sleep',
                '--label=com.neontrip.purpose=leo-runtime-retention', NEW['image'], 'infinity',
            ])
        values = json.loads(docker(['container', 'inspect', NAME]))
        if len(values) != 1:
            raise ValueError('leo_retainer_ambiguous')
        verify_retainer(values[0])
        validate_release(NEW)
        if path.read_bytes() != before:
            raise ValueError('leo_manifest_changed')
        if manifest == NEW:
            return 'already_restored'
        # Atomic same-directory replacement; source/quota/report files are never written.
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', dir=base, prefix='.release-', delete=False) as handle:
                temporary = Path(handle.name)
                os.fchmod(handle.fileno(), 0o600)
                json.dump(NEW, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
            directory = os.open(base, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()
        return 'restored'


def docker(args):
    return subprocess.check_output(['docker', *args], text=True, stderr=subprocess.DEVNULL, timeout=30).strip()


def main():
    if sys.argv[1:] != ['--apply-approved-recovery']:
        raise ValueError('explicit_approved_recovery_required')
    if os.geteuid() != 0:
        raise ValueError('root_required')
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location('leo_installed_runner', BASE / 'runner.py')
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    print(json.dumps({'status': restore(BASE, docker, runner.validate_release), 'image': NEW['image']}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('leo_runtime_restore_unconfirmed', file=sys.stderr)
        sys.exit(1)
