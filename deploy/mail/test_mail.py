"""Offline regression checks. No root, network calls or mail delivery."""
import contextlib
import importlib.util
import io
import pathlib
import re
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parent
dns_stub = types.ModuleType('dns')
resolver_stub = types.ModuleType('dns.resolver')
dns_stub.resolver = resolver_stub
with patch.dict(sys.modules, {'dns': dns_stub, 'dns.resolver': resolver_stub}):
    spec = importlib.util.spec_from_file_location('mail_dns_check', ROOT / 'dns-check.py')
    dns_check = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dns_check)


class MailSetupTests(unittest.TestCase):
    def setUp(self):
        self.answers = {
            ('mail.naitimastera.ru', 'A'): ['77.37.150.17'],
            ('naitimastera.ru', 'TXT'): ['v=spf1 ip4:77.37.150.17 ~all'],
            ('nm202611._domainkey.naitimastera.ru', 'TXT'): ['v=DKIM1; k=rsa; p=TEST_PUBLIC_KEY'],
            ('_dmarc.naitimastera.ru', 'TXT'): ['v=DMARC1; p=none'],
        }

    def check_dns(self):
        with patch.object(dns_check, 'records', side_effect=lambda n, k: self.answers.get((n, k), [])), \
             patch.object(pathlib.Path, 'read_text', return_value='("v=DKIM1; k=rsa; " "p=TEST_PUBLIC_KEY")'), \
             contextlib.redirect_stdout(io.StringIO()):
            return dns_check.main()

    def test_valid_dns(self):
        self.assertEqual(self.check_dns(), 0)

    def test_no_mail_a_blocks_delivery(self):
        self.answers[('mail.naitimastera.ru', 'A')] = []
        self.assertEqual(self.check_dns(), 1)

    def test_duplicate_spf_blocks_delivery(self):
        self.answers[('naitimastera.ru', 'TXT')].append('v=spf1 -all')
        self.assertEqual(self.check_dns(), 1)

    def test_wrong_dkim_key_blocks_delivery(self):
        self.answers[('nm202611._domainkey.naitimastera.ru', 'TXT')] = ['v=DKIM1; p=OTHER_KEY']
        self.assertEqual(self.check_dns(), 1)

    def test_no_dmarc_blocks_delivery(self):
        self.answers[('_dmarc.naitimastera.ru', 'TXT')] = []
        self.assertEqual(self.check_dns(), 1)

    def test_wrong_spf_ip_blocks_delivery(self):
        self.answers[('naitimastera.ru', 'TXT')] = ['v=spf1 ip4:77.37.150.170 ~all']
        self.assertEqual(self.check_dns(), 1)

    def test_installer_bash_syntax(self):
        subprocess.run(['bash', '-n', str(ROOT / 'install-mail.sh')], check=True)

    def test_invalid_arguments_fail_before_mutation(self):
        result = subprocess.run(['bash', str(ROOT / 'install-mail.sh'), '--wrong'], capture_output=True)
        self.assertEqual(result.returncode, 2)

    def test_no_root_fails_before_mutation(self):
        if hasattr(__import__('os'), 'geteuid') and __import__('os').geteuid() == 0:
            self.skipTest('This guard test requires an unprivileged test runner')
        result = subprocess.run(['bash', str(ROOT / 'install-mail.sh')], capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn(b'Root is required', result.stderr)

    def test_config_private_and_paused(self):
        data = dict(re.findall(r'^([a-z_]+)\s*=\s*(.*)$', (ROOT / 'main.cf').read_text(), re.M))
        self.assertEqual(data['inet_interfaces'], '127.0.0.1, 172.30.25.1')
        self.assertEqual(data['mynetworks'], '127.0.0.1/32, 172.30.25.2/32')
        self.assertEqual(data['smtpd_relay_restrictions'], 'permit_mynetworks, reject')
        self.assertEqual(data['defer_transports'], 'smtp')
        self.assertEqual(data['milter_default_action'], 'tempfail')
        self.assertEqual(data['smtp_tls_security_level'], 'encrypt')
        dkim = (ROOT / 'opendkim.conf').read_text()
        self.assertIn('Socket inet:8891@127.0.0.1', dkim)


if __name__ == '__main__':
    unittest.main()
