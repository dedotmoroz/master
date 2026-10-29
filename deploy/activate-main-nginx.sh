#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root: sudo bash /srv/naitimastera/activate-main-nginx.sh" >&2
  exit 1
fi

source_config=/srv/naitimastera/nginx/naitimastera.ru.conf
active_config=/etc/nginx/sites-available/naitimastera.ru

systemctl is-active --quiet server-admin-mcp-oauth.service
curl --fail --silent --show-error http://127.0.0.1:3000/health/ready >/dev/null
curl --fail --silent --show-error http://127.0.0.1:8080/healthz >/dev/null
grep -qF 'proxy_pass http://127.0.0.1:3002/mcp;' "$source_config"

backup="$active_config.pre-app.$(date +%Y%m%d%H%M%S)"
cp -a "$active_config" "$backup"
install -o root -g root -m 0644 "$source_config" "$active_config"

if nginx -t; then
  systemctl reload nginx
else
  cp -a "$backup" "$active_config"
  nginx -t
  echo "Nginx validation failed; restored $backup" >&2
  exit 1
fi

systemctl is-active --quiet server-admin-mcp-oauth.service
ss -lnt | grep -q '127.0.0.1:3002'
echo "Main site activated. Backup: $backup"
