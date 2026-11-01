#!/usr/bin/env bash
# Source after cd /srv/naitimastera. Never print rendered config: it contains secrets.
app_compose() {
  local -a compose_files=(-f production.compose.yml)
  if [[ -e .mail-enabled ]]; then
    if [[ ! -f mail.compose.yml ]]; then
      echo 'Local mail is enabled, but mail.compose.yml is missing; refusing to drop SMTP settings.' >&2
      return 1
    fi
    if ! docker network inspect naitimastera-mail >/dev/null 2>&1; then
      echo 'Local mail network is unavailable; refusing to deploy without SMTP.' >&2
      return 1
    fi
    # Maintenance one-offs must NOT claim the running backend's fixed mail IP.
    # They load config but don't send mail; retain safe SMTP values explicitly.
    if [[ ${1:-} == run ]]; then
      shift
      docker compose -f production.compose.yml run \
        -e MAIL_TRANSPORT=smtp -e SMTP_HOST=172.30.25.1 -e SMTP_PORT=25 \
        -e SMTP_SECURE=false -e SMTP_USER= -e SMTP_PASSWORD= \
        -e 'SMTP_FROM=Найти мастера <no-reply@naitimastera.ru>' "$@"
      return
    fi
    compose_files+=(-f mail.compose.yml)
  fi
  docker compose "${compose_files[@]}" "$@"
}
