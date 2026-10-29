# Production deployment on Raspberry Pi

Production runs five containers on the Raspberry Pi:

- PostgreSQL 17 with a persistent volume;
- RustFS object storage with persistent data and logs;
- ClamAV with persistent signatures;
- the backend image from `ghcr.io/dedotmoroz/naitimastera-backend`;
- the static frontend image from `ghcr.io/dedotmoroz/naitimastera-frontend`.

Only localhost ports are published. Host Nginx serves `naitimastera.ru`, while
the existing Server Admin MCP keeps `/mcp`, OAuth discovery and token routes.
Object storage uses `storage.naitimastera.ru` because browser-facing signed S3
URLs cannot safely be placed behind an arbitrary path prefix.

## Required external setup

Before provisioning:

1. Point `storage.naitimastera.ru` to the Raspberry Pi and obtain its Let's
   Encrypt certificate.
2. Configure production SMTP values and a Cloudflare Turnstile secret in
   `/srv/naitimastera/.env`. The script deliberately refuses test/bypass values.
3. Configure GitHub repository secrets `SSH_HOST`, `SSH_USER`, `SSH_KEY`,
   optional `SSH_PORT`, and the public `TURNSTILE_SITE_KEY` used during the
   frontend build. `SSH_HOST` must reach this Raspberry Pi, not another host
   behind the same router.

The workflows pin the Raspberry Pi ED25519 fingerprint and publish only
`linux/arm64` images. Backend and frontend have separate change filters,
concurrency groups, builds and deploy jobs. During each deploy the short-lived
workflow token is streamed only to `docker login` and stored in a temporary
Docker config, so GHCR images may remain private.

The deploy jobs use the runner's OpenSSH client rather than downloading an SSH
action binary. They accept only the server's ED25519 host key, verify its pinned
SHA256 fingerprint, and stream the short-lived GHCR token over the encrypted
SSH connection directly to `docker login`.

## One-time server setup

From a checkout on the Raspberry Pi:

```sh
sudo ./deploy/provision.sh
```

The script verifies the current MCP service and Nginx route before changing
anything, installs Debian's Docker packages, generates database/storage/token
secrets, runs migrations and storage initialization, validates Nginx, and uses
a graceful reload. It never edits SSH configuration. If required external
secrets or the storage certificate are missing, it stops before starting the
application or changing Nginx.

If the application containers were deployed before the storage DNS/certificate
was ready, activate only the main site with:

```sh
sudo bash /srv/naitimastera/activate-main-nginx.sh
```

That helper checks both application health endpoints and the MCP service,
creates a timestamped backup, validates Nginx, and restores the backup if
validation fails. It deliberately does not enable the storage virtual host.
