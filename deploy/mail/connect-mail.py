#!/usr/bin/env python3
"""Manually run with sudo on the Pi. No credential output, no mail requests."""
import argparse
import datetime
import grp
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import urllib.request

APP = pathlib.Path('/srv/naitimastera')
SOURCE = pathlib.Path(__file__).resolve().parent
FILES = ['compose-command.sh', 'mail.compose.yml', 'deploy-backend.sh', 'deploy-frontend.sh']
MAIL_KEYS = {'MAIL_TRANSPORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'}
EXPECTED_MAIL = {'MAIL_TRANSPORT': 'smtp', 'SMTP_HOST': '172.30.25.1', 'SMTP_PORT': '25',
                 'SMTP_SECURE': 'false', 'SMTP_USER': '', 'SMTP_PASSWORD': '',
                 'SMTP_FROM': 'Найти мастера <no-reply@naitimastera.ru>'}


def run(args, *, cwd=APP, timeout=30):
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        # Docker diagnostics can contain environment details. Do not print them.
        raise RuntimeError('Command failed: ' + ' '.join(args[:2]) + '; code=' + str(result.returncode))
    return result.stdout


def compose(*args, overlay=None):
    command = ['docker', 'compose', '-f', str(APP / 'production.compose.yml')]
    if overlay:
        command += ['-f', str(overlay)]
    return run(command + list(args), timeout=120 if 'up' in args else 30)


def env_dict(container):
    return dict(entry.split('=', 1) for entry in container['Config']['Env'])


def no_unrelated_env_changes(configured, actual):
    changed = sorted(k for k, v in configured.items() if k not in MAIL_KEYS and str(v) != actual.get(k))
    if changed:
        raise RuntimeError('Unrelated backend configuration drift; review these setting NAMES: ' + ', '.join(changed))


def atomic_write(path, data, mode=0o664):
    fd, temporary = tempfile.mkstemp(prefix='.mail-connect-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
        os.chmod(temporary, mode)
        os.chown(temporary, 0, grp.getgrnam('docker').gr_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def apply():
    if os.geteuid() != 0:
        raise RuntimeError('Run in your own Pi terminal with sudo. MCP privileges are not modified.')
    if (APP / '.mail-enabled').exists():
        raise RuntimeError('Mail marker already exists. Refusing a second activation; inspect the running configuration.')
    manifest = json.loads((SOURCE / 'manifest.json').read_text())
    for name in FILES:
        if hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() != manifest['files'][name]:
            raise RuntimeError('Installer checksum mismatch: ' + name)
    for name, expected in manifest['originalScripts'].items():
        if hashlib.sha256((APP / name).read_bytes()).hexdigest() != expected:
            raise RuntimeError('Server deploy script differs from reviewed version: ' + name)
    run(['systemctl', 'is-active', '--quiet', 'postfix', 'opendkim'])
    run(['/usr/sbin/postfix', 'check'])
    if run(['/usr/sbin/postconf', '-h', 'defer_transports']).strip():
        raise RuntimeError('Postfix delivery is still paused.')
    run(['python3', '/home/pi/naitimastera-mail-setup/dns-check.py'])
    if run(['/usr/sbin/postqueue', '-j']).strip():
        raise RuntimeError('Mail queue is not empty. Review it first; no automatic flush.')
    network = json.loads(run(['docker', 'network', 'inspect', 'naitimastera-mail']))[0]
    if not network['Internal'] or network['IPAM']['Config'][0]['Subnet'] != '172.30.25.0/28':
        raise RuntimeError('Unexpected mail network configuration.')
    if network.get('Containers'):
        raise RuntimeError('Mail network already has attached containers. Review before activation.')
    base = json.loads(compose('config', '--format', 'json'))
    merged = json.loads(compose('config', '--format', 'json', overlay=SOURCE / 'mail.compose.yml'))
    old_service = base['services']['backend']
    new_service = merged['services']['backend']
    for key in set(old_service) | set(new_service):
        if key not in {'networks', 'environment'} and old_service.get(key) != new_service.get(key):
            raise RuntimeError('Unexpected compose change outside SMTP/networks: ' + key)
    for key, value in EXPECTED_MAIL.items():
        if str(new_service['environment'].get(key, '')) != value:
            raise RuntimeError('Unexpected SMTP parameter: ' + key)
    ids = compose('ps', '-q', 'backend').split()
    if len(ids) != 1:
        raise RuntimeError('Exactly one running backend is required.')
    actual = json.loads(run(['docker', 'inspect', ids[0]]))[0]
    no_unrelated_env_changes(new_service['environment'], env_dict(actual))
    image = json.loads(run(['docker', 'image', 'inspect', old_service['image']]))[0]
    if image['Id'] != actual['Image']:
        raise RuntimeError('Image tag changed. Refusing an unrelated application upgrade.')
    # Never start old notification/auth mail jobs merely by fixing SMTP.
    count = compose('exec', '-T', 'postgres', 'sh', '-c',
                    'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT count(*) FROM outbox_events WHERE processed_at IS NULL"').strip()
    if count != '0':
        raise RuntimeError('Pending outbox events: ' + count + '. Review before connecting real SMTP.')
    others_before = {v['Id'] for v in json.loads(run(['docker', 'inspect', *compose('ps', '-q').split()])) if v['Id'] != ids[0]}
    # Snapshot only deployment files, never .env or mail keys.
    backup = pathlib.Path(tempfile.mkdtemp(prefix='mail-connect-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + '-', dir=APP / 'backups'))
    os.chmod(backup, 0o700)
    existed = {}
    for name in FILES:
        path = APP / name
        if path.is_symlink():
            raise RuntimeError('Refusing to replace symlink: ' + name)
        existed[name] = path.exists()
        if path.exists():
            shutil.copy2(path, backup / name)
    (backup / 'manifest.json').write_text(json.dumps({'existed': existed, 'backendId': ids[0]}, indent=2))
    print('Backup:', backup, flush=True)
    try:
        for name in FILES:
            atomic_write(APP / name, (SOURCE / name).read_bytes())
        compose('config', '--quiet', overlay=APP / 'mail.compose.yml')
        atomic_write(APP / '.mail-enabled', b'Local Postfix SMTP enabled\n')
        compose('up', '-d', '--no-deps', '--pull', 'never', '--wait', '--wait-timeout', '90', 'backend', overlay=APP / 'mail.compose.yml')
        new_id = compose('ps', '-q', 'backend', overlay=APP / 'mail.compose.yml').strip()
        running = json.loads(run(['docker', 'inspect', new_id]))[0]
        if running['NetworkSettings']['Networks']['naitimastera-mail']['IPAddress'] != '172.30.25.2':
            raise RuntimeError('Backend mail IP does not match trusted Postfix address.')
        if any(env_dict(running).get(k) != v for k, v in EXPECTED_MAIL.items()):
            raise RuntimeError('Running SMTP settings do not match.')
        # Verify SMTP from INSIDE the real backend, without sending any mail.
        verify = "import nodemailer from 'nodemailer'; const t=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT),secure:false}); try{await t.verify();console.log('SMTP verified, no email sent')}finally{t.close()}"
        compose('exec', '-T', 'backend', 'node', '--input-type=module', '-e', verify, overlay=APP / 'mail.compose.yml')
        with urllib.request.urlopen('http://127.0.0.1:3000/health/ready', timeout=5) as response:
            if response.status != 200:
                raise RuntimeError('Backend readiness failed.')
        others_after = {v['Id'] for v in json.loads(run(['docker', 'inspect', *compose('ps', '-q', overlay=APP / 'mail.compose.yml').split()])) if v['Id'] != new_id}
        if others_before != others_after:
            raise RuntimeError('Unexpected change to other application containers.')
        print('PASS: backend healthy, SMTP verified from container, other containers unchanged. No email sent.')
    except Exception:
        print('Activation failed. Restoring deployment files and the previous backend configuration.', file=sys.stderr)
        for name in FILES:
            if existed[name]:
                shutil.copy2(backup / name, APP / name)
            elif (APP / name).exists():
                (APP / name).unlink()
        (APP / '.mail-enabled').unlink(missing_ok=True)
        compose('up', '-d', '--no-deps', '--pull', 'never', '--wait', '--wait-timeout', '90', 'backend')
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', required=True)
    parser.parse_args()
    try:
        apply()
    except Exception as error:
        # No subprocess stdout/stderr or environment values are printed.
        print('STOP:', type(error).__name__, str(error), file=sys.stderr)
        sys.exit(1)
