# Deploying TeamOS on Dokploy

One TeamOS container serves both the API and the web app on port 5173, behind the
domain `teamos.sentosh.com`. PostgreSQL and Redis are separate Dokploy services in
the same project, reached over the internal Docker network. Dokploy's build server
builds the image from this repository — no registry and no GitHub Actions involved.

## 1. Create the project and its databases

In Dokploy, create a project (for example `teamos`), then add two services to it:

**PostgreSQL**
- Database name: `teamos`
- User: `teamos`
- Password: generate one and keep it

**Redis**
- Generate a password and keep it

Deploy both. Open each service and copy the **internal** connection details
Dokploy shows — the hostname is the service's container name on the Docker
network, not `localhost`.

Redis is optional. A single TeamOS container falls back to in-memory WebSocket
fan-out. Add it now if you may ever run more than one container, or if you want
realtime delivery to survive a container restart mid-session.

## 2. Create the TeamOS application

Add a **Docker Compose** service to the same project:

- **Source**: this Git repository, branch `main`
- **Compose Path**: `compose.dokploy.yml`

## 3. Set the environment

In the compose service's **Environment** tab:

```env
KANEO_CLIENT_URL=https://teamos.sentosh.com
AUTH_SECRET=<openssl rand -hex 32>
DATABASE_URL=postgresql://teamos:<password>@<postgres-service-host>:5432/teamos
REDIS_URL=redis://default:<password>@<redis-service-host>:6379
```

Notes:

- `AUTH_SECRET` must stay the same forever. Changing it signs everyone out and
  makes the saved Resend API key unreadable.
- `KANEO_API_URL` is **not** set. The entrypoint derives it as
  `https://teamos.sentosh.com/api`, which keeps the API same-origin with the web
  app so session cookies work without any cross-site configuration.
- If the password contains `@`, `/`, `:` or `#`, percent-encode it in the URL.
- Email is **not** configured here. After the first deploy, sign in as the
  instance admin and set it in Settings → Account → Email → Email delivery. The
  Resend API key saved there is stored encrypted in the database and wins over
  any `RESEND_API_KEY` / `SMTP_*` environment variable.

Optional variables are listed with comments in
[`compose.dokploy.yml`](../../compose.dokploy.yml).

## 4. Assign the domain

In the compose service's **Domains** tab:

- Host: `teamos.sentosh.com`
- Service Name: `teamos`
- Container Port: `5173`
- HTTPS: on, certificate provider Let's Encrypt

Point an `A` record for `teamos.sentosh.com` at the VPS before deploying, or the
certificate request fails.

For another service later, use a subdomain of the same host —
`servicename.teamos.sentosh.com` — and add it as its own domain entry.

## 5. Deploy on push to `main`

In the compose service's **Deployments** tab, copy the webhook URL and add it in
GitHub under **Settings → Webhooks**:

- Payload URL: the Dokploy webhook URL
- Content type: `application/json`
- Events: just the push event

Dokploy then pulls, rebuilds and restarts on every push to `main`. There is no
GitHub Actions workflow in this repository; the build happens entirely on the
Dokploy build server.

## Build resources

`Dockerfile.kaneo` builds the API and the web app from source in one multi-stage
build. It needs roughly **4 GB of RAM** available to the builder and takes several
minutes on a cold cache. On a 2 GB VPS the web build (Vite + Sentry source maps)
is the step that gets OOM-killed. If that happens, add swap on the VPS:

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Docker's build cache makes later deploys much faster, so keep enough disk for it
and prune with `docker builder prune` rather than `docker system prune -a`.

## Database migrations

The API runs pending migrations at startup. A deploy that changes the schema
applies it when the new container boots, so take a snapshot of the PostgreSQL
service in Dokploy before deploying a schema change.

## Health and logs

The container is healthy once `GET /api/health` answers on port 5173. It is given
a 90 second start period because the API runs migrations first. Dokploy's **Logs**
tab shows the entrypoint output — it prints the derived `KANEO_API_URL` and
whether `DATABASE_URL` came from the environment or was derived.

## Checking it works

```bash
curl -fsS https://teamos.sentosh.com/api/health
curl -fsS https://teamos.sentosh.com/api/config | head -c 400
```

The first account created on a fresh instance becomes the instance admin, even
when registration is disabled.

## Desktop app

The desktop app in [`apps/desktop`](../../apps/desktop/README.md) points at this
instance and signs in through the system browser. Nothing extra is needed on the
server: the flow uses the same domain and the one-time token endpoint that is part
of the API.
