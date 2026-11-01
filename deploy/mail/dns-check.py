#!/usr/bin/env python3
"""Public DNS verification. Requires python3-dnspython; never sends mail."""
import pathlib
import re
import sys
import dns.resolver

DOMAIN = 'naitimastera.ru'
SELECTOR = 'nm202611'
IP = '77.37.150.17'


def records(name, kind):
    resolver = dns.resolver.Resolver()
    resolver.lifetime = 5
    try:
        response = resolver.resolve(name, kind)
        if kind == 'TXT':
            return [b''.join(item.strings).decode() for item in response]
        return [str(item) for item in response]
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return []


def main():
    failures = []
    if IP not in records('mail.' + DOMAIN, 'A'):
        failures.append('mail A must contain ' + IP)
    spf = [r for r in records(DOMAIN, 'TXT') if r.startswith('v=spf1')]
    if len(spf) != 1 or ('ip4:' + IP) not in spf[0].split():
        failures.append('publish ONE SPF record including ip4:' + IP)
    key_path = pathlib.Path('/etc/opendkim/keys/naitimastera.ru/nm202611.txt')
    expected = ''.join(re.findall(r'"([^"]*)"', key_path.read_text()))
    expected_key = re.search(r'(?:^|;)\s*p=([^;\s]+)', expected)
    actual = records(SELECTOR + '._domainkey.' + DOMAIN, 'TXT')
    if not expected_key or not any(
        re.search(r'(?:^|;)\s*p=' + re.escape(expected_key[1]) + r'(?:;|\s|$)', value)
        for value in actual
    ):
        failures.append('DKIM TXT must match the public key generated on THIS host')
    if not any(r.startswith('v=DMARC1;') and re.search(r'(?:^|;)\s*p=(none|quarantine|reject)(?:;|\s|$)', r)
               for r in records('_dmarc.' + DOMAIN, 'TXT')):
        failures.append('publish a valid DMARC record (start with p=none)')
    if failures:
        for failure in failures:
            print('FAIL:', failure)
        return 1
    print('PASS: mail A, SPF, DKIM public key and DMARC match expected DNS settings.')
    print('This checks configuration, NOT inbox placement or IP reputation.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('DNS check failed:', type(error).__name__, str(error), file=sys.stderr)
        sys.exit(1)
