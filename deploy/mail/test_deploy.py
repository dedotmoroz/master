"""Offline tests for mail persistence in deployment. Does not invoke Docker."""
import pathlib
import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('connect_mail', ROOT / 'mail/connect-mail.py')
connect_mail = importlib.util.module_from_spec(spec)
spec.loader.exec_module(connect_mail)


class DeploymentTests(unittest.TestCase):
    def test_activation_requires_root_before_reading_env(self):
        with patch.object(connect_mail.os, 'geteuid', return_value=1000):
            with self.assertRaisesRegex(RuntimeError, 'sudo'):
                connect_mail.apply()

    def test_smtp_changes_are_allowed_without_exposing_secrets(self):
        connect_mail.no_unrelated_env_changes(
            {'DATABASE_URL': 'same-private-url', 'SMTP_HOST': '172.30.25.1'},
            {'DATABASE_URL': 'same-private-url', 'SMTP_HOST': 'old-host'})

    def test_unrelated_config_drift_is_blocked_without_secret_output(self):
        with self.assertRaises(RuntimeError) as error:
            connect_mail.no_unrelated_env_changes({'DATABASE_URL': 'new-private-url'}, {'DATABASE_URL': 'old-private-url'})
        self.assertIn('DATABASE_URL', str(error.exception))
        self.assertNotIn('private-url', str(error.exception))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='nm-mail-deploy-')
        self.addCleanup(self.temp.cleanup)
        self.cwd = pathlib.Path(self.temp.name)
        shutil.copyfile(ROOT / 'compose-command.sh', self.cwd / 'compose-command.sh')

    def run_compose(self, args, *, mail=False, missing_file=False, missing_network=False):
        if mail:
            (self.cwd / '.mail-enabled').touch()
            if not missing_file:
                (self.cwd / 'mail.compose.yml').touch()
        code = '''set -euo pipefail
docker() {
  if [[ $1 == network ]]; then return NETWORK_STATUS; fi
  printf '%s\\n' "$@"
}
source ./compose-command.sh
app_compose "$@"
'''.replace('NETWORK_STATUS', '1' if missing_network else '0')
        return subprocess.run(['bash', '-c', code, 'test', *args], cwd=self.cwd, text=True, capture_output=True)

    def test_external_smtp_unchanged(self):
        result = self.run_compose(['up', '-d', '--no-deps', '--wait', 'backend'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('mail.compose.yml', result.stdout)

    def test_backend_keeps_mail_overlay(self):
        result = self.run_compose(['up', '-d', '--no-deps', '--wait', 'backend'], mail=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('mail.compose.yml', result.stdout)

    def test_frontend_deploy_uses_same_model(self):
        result = self.run_compose(['up', '-d', '--no-deps', '--wait', 'frontend'], mail=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('mail.compose.yml', result.stdout)

    def test_missing_overlay_fails_closed(self):
        result = self.run_compose(['up', 'backend'], mail=True, missing_file=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('up\n', result.stdout)

    def test_missing_network_fails_closed(self):
        result = self.run_compose(['up', 'backend'], mail=True, missing_network=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('up\n', result.stdout)

    def test_maintenance_run_does_not_claim_backend_mail_ip(self):
        result = self.run_compose(['run', '--rm', 'backend', 'node', 'scripts/migrate.ts'], mail=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('mail.compose.yml', result.stdout)
        self.assertIn('SMTP_HOST=172.30.25.1', result.stdout)
        self.assertIn('scripts/migrate.ts', result.stdout)

    def test_scripts_source_shared_compose_helper(self):
        for filename in ['deploy-backend.sh', 'deploy-frontend.sh', 'provision.sh']:
            text = (ROOT / filename).read_text()
            self.assertIn('compose-command.sh', text)
            self.assertIn('app_compose ', text)
            self.assertNotIn('docker compose -f production.compose.yml', text)
            subprocess.run(['bash', '-n', str(ROOT / filename)], check=True)

    def test_ci_uploads_mail_files(self):
        for name in ['backend', 'frontend']:
            text = (ROOT.parent / '.github/workflows' / (name + '-production.yml')).read_text()
            self.assertIn('deploy/compose-command.sh', text)
            self.assertIn('deploy/mail/mail.compose.yml', text)

    def test_backend_update_does_not_recreate_dependencies_or_change_storage(self):
        text = (ROOT / 'deploy-backend.sh').read_text()
        self.assertIn('app_compose pull backend', text)
        self.assertIn('app_compose run --rm --no-deps backend node scripts/migrate.ts', text)
        self.assertNotIn('up -d --wait postgres', text)
        self.assertNotIn('pull postgres', text)
        self.assertNotIn('scripts/init-storage.ts', text)
        self.assertNotIn('scripts/storage-cors.ts', text)
        self.assertNotIn('docker image prune', text)


if __name__ == '__main__':
    unittest.main()
