#!/usr/bin/env bash
# Run manually as root on Raspberry Pi. Does not bypass MCP privilege restrictions.
set -Eeuo pipefail
umask 077
TASK_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
STATE_DIR=/var/lib/naitimastera-mail
KEY_DIR=/etc/opendkim/keys/naitimastera.ru
MODE=${1:---install}
[[ $# -le 1 && "$MODE" =~ ^--(install|check|enable-delivery)$ ]] || {
  echo 'Usage: sudo bash install-mail.sh [--install|--check|--enable-delivery]' >&2; exit 2;
}
[[ $EUID == 0 ]] || { echo 'Run from your own terminal with sudo. Root is required.' >&2; exit 1; }
[[ -d /run/systemd/system ]] || { echo 'Requires the Debian host with systemd, not a container.' >&2; exit 1; }

check_services() {
  postfix check
  opendkim -n -x /etc/opendkim.conf
  systemctl is-active --quiet opendkim
  systemctl is-active --quiet postfix
  postfix status
  [[ $(postconf -h inet_interfaces) == '127.0.0.1, 172.30.25.1' ]]
  [[ $(postconf -h mynetworks) == '127.0.0.1/32, 172.30.25.2/32' ]]
  [[ $(postconf -h smtpd_relay_restrictions) == 'permit_mynetworks, reject' ]]
  echo 'PASS: services/configuration; only loopback and dedicated Docker IP may relay.'
  printf 'Delivery deferred: '; postconf -h defer_transports
  ss -lnt '( sport = :25 or sport = :465 or sport = :587 or sport = :8891 )'
}

if [[ $MODE != --install ]]; then
  [[ -f "$STATE_DIR/managed" ]] || { echo 'Managed mail installation not found.' >&2; exit 1; }
  check_services
  if [[ $MODE == --enable-delivery ]]; then
    python3 "$TASK_DIR/dns-check.py"
    echo 'Review queued messages with sudo postqueue -p before enabling delivery.'
    [[ $(postqueue -j | wc -l) == 0 ]] || { echo 'Queue is not empty. Review it; no automatic flush.' >&2; exit 1; }
    postconf -e 'defer_transports ='
    postfix reload
    [[ -z $(postconf -h defer_transports) ]]
    echo 'Delivery enabled. No test message has been sent.'
  fi
  exit 0
fi

# Never overwrite another mail system or operate on a machine with queued mail.
. /etc/os-release
[[ $ID == debian && $VERSION_ID == 13 ]] || { echo 'Supported target: Debian 13.' >&2; exit 1; }
for file in main.cf opendkim.conf dns-check.py; do
  [[ -f "$TASK_DIR/$file" ]] || { echo "Missing installer file: $file" >&2; exit 1; }
done
if [[ -f "$STATE_DIR/managed" ]]; then
  echo 'Already installed: use --check; reruns do not rotate keys or pause delivery.'
  check_services; exit 0
fi
if dpkg-query -W -f='${Status}' postfix 2>/dev/null | grep -q 'install ok installed'; then
  echo 'An unmanaged Postfix already exists. Refusing to replace it.' >&2; exit 1
fi
[[ ! -e /etc/opendkim.conf && ! -e /etc/opendkim/naitimastera ]] || {
  echo 'An unmanaged OpenDKIM configuration exists. Refusing to replace it.' >&2; exit 1;
}
[[ ! -e /usr/sbin/policy-rc.d ]] || { echo 'Existing policy-rc.d: manual review required.' >&2; exit 1; }
command -v docker >/dev/null || { echo 'Docker must already be installed.' >&2; exit 1; }
docker info >/dev/null
python3 - <<'PY'
import ipaddress,json,subprocess
target=ipaddress.ip_network('172.30.25.0/28')
for route in json.loads(subprocess.check_output(['ip','-j','-4','route','show'],text=True)):
    dst=route.get('dst','default')
    if dst != 'default' and target.overlaps(ipaddress.ip_network(dst)):
        raise SystemExit('Reserved mail network overlaps existing route: '+dst)
PY
ss -H -lnt '( sport = :25 or sport = :8891 )' | grep -q . && {
  echo 'Port 25/8891 already in use. Refusing to continue.' >&2; exit 1;
}
install -d -m 0700 "$STATE_DIR"
BACKUP_DIR=$(mktemp -d /var/lib/naitimastera-mail/backup.XXXXXXXX)
for path in /etc/postfix /etc/mailname /etc/aliases /etc/default/opendkim; do
  if [[ -e "$path" ]]; then cp -a --parents "$path" "$BACKUP_DIR/"; fi
done
printf '%s\n' "$BACKUP_DIR" > "$STATE_DIR/last-backup"
echo "Backup: $BACKUP_DIR"

# Prevent package post-install scripts from opening SMTP before the safe config exists.
printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
chmod 0755 /usr/sbin/policy-rc.d
TASK_POLICY_CREATED=true
on_exit() {
  local status=$?
  if [[ ${TASK_POLICY_CREATED:-false} == true ]]; then rm -- /usr/sbin/policy-rc.d; fi
  if [[ $status != 0 ]]; then
    # Only these newly installed mail services are stopped; other services are untouched.
    systemctl stop postfix postfix@- opendkim 2>/dev/null || true
    echo "Setup incomplete; new mail services stopped. Backup: $BACKUP_DIR" >&2
  fi
}
trap on_exit EXIT
export DEBIAN_FRONTEND=noninteractive
printf 'postfix postfix/main_mailer_type select No configuration\n' | debconf-set-selections
apt-get update
apt-get install -y --no-install-recommends postfix opendkim opendkim-tools ca-certificates python3-dnspython
if [[ ! -f /etc/postfix/master.cf ]]; then
  install -m 0644 /usr/share/postfix/master.cf.dist /etc/postfix/master.cf
fi

# A dedicated bridge; only the backend may be attached with 172.30.25.2.
docker network create --driver bridge --internal --subnet 172.30.25.0/28 --gateway 172.30.25.1 naitimastera-mail
install -m 0644 "$TASK_DIR/main.cf" /etc/postfix/main.cf
printf 'naitimastera.ru\n' > /etc/mailname
printf '/^no-reply@naitimastera[.]ru$/ OK\n/^<>$/ OK\n/.*/ REJECT Use the configured no-reply sender\n' > /etc/postfix/naitimastera-senders
chmod 0644 /etc/postfix/naitimastera-senders
if [[ ! -s /etc/aliases ]]; then printf 'postmaster: root\n' > /etc/aliases; fi
newaliases
install -d -o opendkim -g opendkim -m 0700 "$KEY_DIR" /etc/opendkim/naitimastera
[[ ! -e "$KEY_DIR/nm202611.private" && ! -e "$KEY_DIR/nm202611.txt" ]] || {
  echo 'DKIM key files already exist; refusing to overwrite.' >&2; exit 1;
}
opendkim-genkey -b 2048 -d naitimastera.ru -s nm202611 -D "$KEY_DIR"
chown opendkim:opendkim "$KEY_DIR"/nm202611.*
chmod 0600 "$KEY_DIR/nm202611.private"
chmod 0644 "$KEY_DIR/nm202611.txt"
printf 'nm202611._domainkey.naitimastera.ru naitimastera.ru:nm202611:%s/nm202611.private\n' "$KEY_DIR" > /etc/opendkim/naitimastera/KeyTable
printf 'no-reply@naitimastera.ru nm202611._domainkey.naitimastera.ru\n' > /etc/opendkim/naitimastera/SigningTable
printf '127.0.0.1\n172.30.25.2\n' > /etc/opendkim/naitimastera/TrustedHosts
chown opendkim:opendkim /etc/opendkim/naitimastera/*
chmod 0600 /etc/opendkim/naitimastera/*
install -m 0644 "$TASK_DIR/opendkim.conf" /etc/opendkim.conf
for unit in postfix.service postfix@.service; do
  install -d -m 0755 "/etc/systemd/system/$unit.d"
  printf '[Unit]\nRequires=docker.service\nWants=opendkim.service\nAfter=docker.service opendkim.service\n' > "/etc/systemd/system/$unit.d/naitimastera-mail.conf"
done
systemctl daemon-reload
postfix check
opendkim -n -x /etc/opendkim.conf
rm -- /usr/sbin/policy-rc.d
TASK_POLICY_CREATED=false
systemctl enable opendkim postfix
systemctl start opendkim
systemctl start postfix
check_services
printf 'Managed naitimastera outbound mail\n' > "$STATE_DIR/managed"
echo 'Installed. SMTP DELIVERY IS PAUSED until DNS is published and --enable-delivery succeeds.'
echo "Public DKIM record (safe to copy to DNS): $KEY_DIR/nm202611.txt"
echo 'Never copy or share nm202611.private.'
