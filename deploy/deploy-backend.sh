#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/compose-command.sh"

ghcr_user=${1:?GitHub Container Registry username is required}
docker_config=$(mktemp -d /tmp/naitimastera-docker-config.XXXXXX)
trap 'rm -rf "$docker_config"' EXIT
export DOCKER_CONFIG="$docker_config"

docker login ghcr.io --username "$ghcr_user" --password-stdin
cd /srv/naitimastera
# Regular application updates must not recreate infrastructure or change S3 CORS.
# Initial provisioning/bootstrap remains in provision.sh.
for service in postgres storage clamav; do
  dependency_id=$(app_compose ps -q "$service")
  if [[ -z "$dependency_id" ]] || [[ $(docker inspect -f '{{.State.Running}}' "$dependency_id") != true ]]; then
    echo "Required dependency $service is not running; refusing to start or replace it during backend deploy." >&2
    exit 1
  fi
done
app_compose pull backend
app_compose run --rm --no-deps backend node scripts/migrate.ts

app_compose up -d --no-deps --wait backend
# Keep old images available for rollback; no global image pruning here.
