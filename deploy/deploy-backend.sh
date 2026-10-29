#!/usr/bin/env bash
set -euo pipefail

ghcr_user=${1:?GitHub Container Registry username is required}
docker_config=$(mktemp -d /tmp/naitimastera-docker-config.XXXXXX)
trap 'rm -rf "$docker_config"' EXIT
export DOCKER_CONFIG="$docker_config"

docker login ghcr.io --username "$ghcr_user" --password-stdin
cd /srv/naitimastera
docker compose -f production.compose.yml pull postgres storage clamav backend
docker compose -f production.compose.yml up -d --wait postgres storage clamav
docker compose -f production.compose.yml run --rm backend node scripts/migrate.ts

# Bootstrap RustFS over the private Compose network. The running API still
# signs browser URLs against the public storage.naitimastera.ru endpoint.
docker compose -f production.compose.yml run --rm \
  -e STORAGE_ENDPOINT=http://storage:9000 \
  backend node scripts/init-storage.ts
docker compose -f production.compose.yml run --rm \
  -e STORAGE_ENDPOINT=http://storage:9000 \
  backend node scripts/storage-cors.ts https://naitimastera.ru

docker compose -f production.compose.yml up -d --no-deps --wait backend
docker image prune -f --filter 'until=168h'
