#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root: sudo ./deploy/provision.sh" >&2
  exit 1
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
deploy_dir="$repo_root/deploy"
app_dir=/srv/naitimastera
deploy_user=${SUDO_USER:-pi}
main_site=/etc/nginx/sites-available/naitimastera.ru
storage_site=/etc/nginx/sites-available/storage.naitimastera.ru

if ! systemctl is-active --quiet server-admin-mcp-oauth.service; then
  echo "Refusing to continue: server-admin-mcp-oauth.service is not active" >&2
  exit 1
fi
if ! grep -qF 'proxy_pass http://127.0.0.1:3002/mcp;' "$main_site"; then
  echo "Refusing to continue: the existing /mcp proxy route was not found" >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose
systemctl enable --now docker
usermod -aG docker "$deploy_user"

install -d -o root -g docker -m 0775 "$app_dir"
install -o root -g docker -m 0664 "$deploy_dir/production.compose.yml" "$app_dir/production.compose.yml"

if [[ ! -e "$app_dir/.env" ]]; then
  install -o root -g docker -m 0640 "$deploy_dir/.env.production.example" "$app_dir/.env"
  postgres_password=$(openssl rand -hex 32)
  verification_secret=$(openssl rand -hex 64)
  storage_access_key=$(openssl rand -hex 16)
  storage_secret_key=$(openssl rand -hex 32)
  sed -i \
    -e "s/replace-with-a-random-password/$postgres_password/" \
    -e "s/replace-with-at-least-32-random-bytes/$verification_secret/" \
    -e "s/replace-with-a-random-access-key/$storage_access_key/" \
    -e "s/replace-with-a-random-secret-key/$storage_secret_key/" \
    "$app_dir/.env"
fi

if grep -q 'replace-with-' "$app_dir/.env"; then
  echo "Docker is installed, but production secrets are incomplete in $app_dir/.env" >&2
  echo "Set Turnstile and SMTP values, then run this script again." >&2
  exit 2
fi
if [[ ! -f /etc/letsencrypt/live/storage.naitimastera.ru/fullchain.pem ]]; then
  echo "TLS certificate for storage.naitimastera.ru is missing" >&2
  echo "Create its DNS record and certificate, then run this script again." >&2
  exit 2
fi

cd "$app_dir"
docker compose -f production.compose.yml pull
docker compose -f production.compose.yml up -d --wait postgres storage clamav
docker compose -f production.compose.yml run --rm backend node scripts/migrate.ts
docker compose -f production.compose.yml run --rm \
  -e STORAGE_ENDPOINT=http://storage:9000 \
  backend node scripts/init-storage.ts
docker compose -f production.compose.yml run --rm \
  -e STORAGE_ENDPOINT=http://storage:9000 \
  backend node scripts/storage-cors.ts https://naitimastera.ru
docker compose -f production.compose.yml up -d --wait backend frontend

main_backup="$main_site.pre-app.$(date +%Y%m%d%H%M%S)"
cp -a "$main_site" "$main_backup"
install -o root -g root -m 0644 "$deploy_dir/nginx/naitimastera.ru.conf" "$main_site"
install -o root -g root -m 0644 "$deploy_dir/nginx/storage.naitimastera.ru.conf" "$storage_site"
ln -sfn "$storage_site" /etc/nginx/sites-enabled/storage.naitimastera.ru
if nginx -t; then
  systemctl reload nginx
else
  cp -a "$main_backup" "$main_site"
  rm -f /etc/nginx/sites-enabled/storage.naitimastera.ru
  nginx -t
  echo "Nginx validation failed; the previous main-site config was restored" >&2
  exit 1
fi

curl --fail --silent --show-error http://127.0.0.1:3000/health/ready >/dev/null
curl --fail --silent --show-error http://127.0.0.1:8080/healthz >/dev/null
systemctl is-active --quiet server-admin-mcp-oauth.service
ss -lnt | grep -q '127.0.0.1:3002'
echo "Provisioning complete. Open a new SSH session before running Docker without sudo."
