# ee-sync — account & progress-sync API

Tiny Cloudflare Worker + D1 backend for optional accounts on the EE Knowledge Base.
Stores per user: username, salted PBKDF2 password hash, salted recovery-code hash,
progress JSON, timestamps, revision counter. No email, no IPs persisted, no cookies.

## API

Base URL: `https://ee-sync.<your-subdomain>.workers.dev` — all bodies JSON.

| Endpoint | Auth | Body | Success | Errors |
|---|---|---|---|---|
| `POST /api/register` | – | `{username, password}` | `201 {token, username, recoveryCode}` | 400 invalid, 409 taken |
| `POST /api/login` | – | `{username, password}` | `200 {token, username, progress, rev}` | 401 |
| `GET /api/progress` | Bearer | – | `200 {progress, rev, updatedAt}` | 401 |
| `PUT /api/progress` | Bearer | `{progress, baseRev}` | `200 {rev}` | 400, 401, `409 {progress, rev}` stale |
| `POST /api/recover` | – | `{username, recoveryCode, newPassword}` | `200 {token, username, recoveryCode}` (new code) | 400, 401 |
| `DELETE /api/account` | Bearer | `{password}` | `204` | 401 |

Username: `^[a-z0-9_-]{3,32}$` (lowercased). Password: 8–200 chars. The recovery code
is shown once at registration (and re-issued on every recovery); it is the only way to
reset a forgotten password — there is no email reset.

## Deploy (once)

```bash
npm i -g wrangler            # or use npx wrangler
wrangler login               # opens browser
cd worker
wrangler d1 create ee-sync-db --location weur
#   → copy the printed database_id into wrangler.toml
wrangler d1 migrations apply ee-sync-db --remote
openssl rand -base64 32 | wrangler secret put AUTH_SECRET
wrangler deploy              # prints the workers.dev URL
```

Then paste the printed URL into `API_BASE` in `assets/js/sync.js`, commit, push
(GitHub Pages redeploys the site).

## Local development

```bash
cd worker
wrangler d1 migrations apply ee-sync-db --local
wrangler dev                 # serves http://127.0.0.1:8787 with a local D1
```

`.dev.vars` provides a dev-only `AUTH_SECRET`. In another terminal, serve the site
(`python3 -m http.server 8080` in the repo root) — `sync.js` automatically targets
`127.0.0.1:8787` when the site is opened from localhost.

## Peek at stored data / delete everything

```bash
wrangler d1 execute ee-sync-db --remote --command \
  "SELECT username, length(progress), created_at FROM users"
wrangler d1 execute ee-sync-db --remote --command "DELETE FROM users"   # wipe
```
