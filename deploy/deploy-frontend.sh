#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/compose-command.sh"

ghcr_user=${1:?GitHub Container Registry username is required}
docker_config=$(mktemp -d /tmp/naitimastera-docker-config.XXXXXX)
trap 'rm -rf "$docker_config"' EXIT
export DOCKER_CONFIG="$docker_config"

docker login ghcr.io --username "$ghcr_user" --password-stdin
cd /srv/naitimastera
app_compose pull frontend
app_compose up -d --no-deps --wait frontend
docker image prune -f --filter 'until=168h'
