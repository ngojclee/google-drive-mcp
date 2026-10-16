# Google Workspace Connector v1

App id and audience: `google-workspace`. Hub namespace: `google_workspace`.
MCP: `https://10.21.4.101:3443/mcp`.
Health: `https://10.21.4.101:3443/health` (process readiness, not Google/OAuth proof).
Port 3443 had no TCP listener at read-only inspection on 2026-10-16; recheck before deploying.

## Boundaries

One added service in the existing Google stack. No Business stack changes.
Existing Google MCP image and OAuth store remain unchanged. Connector has no
OAuth mount, no API implementation, no credential-management tools.
Google bearer stays in this stack; Hub receives only its own pairing.

Four proposed scopes: `workspace:read`, `workspace:write`, `gmail:read`,
`gmail:draft:create`. No grants have been changed. See
`GOOGLE-WORKSPACE-TOOLS.md` for EVERY upstream tool and its OAuth ceiling;
`google-workspace-tool-catalog.json` is the proposed strict Hub catalog.
Business lane must review this catalog before onboarding. Unknown tools deny.
No send/filter implementation. `gmail.settings.basic` consent does not add one.
Workspace write grants authorize content replacement and ordinary writes;
they are not read-only previews. High-risk delete/sharing/revision tools remain
blocked until a separate approval contract exists.
`uploadFile` accepts base64 only, never server paths. `setElementZOrder` checks
its four operation values. `replyToComment` including resolve requires write;
`updateGoogleSheetIfUnchanged` requires write even for dryRun.
All allowed tools pin `GOOGLE_CONNECTOR_ACCOUNT`; caller `account` is denied.
This version has no per-account grants. Use only when every granted caller may
access the same pinned account. Existing direct Google clients remain untouched.

## Credentials

Set names from `connector.env.example` in protected Portainer stack env.
`GOOGLE_CONNECTOR_PAIRING_TOKEN` and `GOOGLE_CONNECTOR_DELEGATION_SECRET`
come from a disabled managed Hub record, not random Google credentials.
`MCP_HTTP_BEARER_TOKEN` is the EXISTING Google bearer. Connector receives it as
`GOOGLE_CONNECTOR_UPSTREAM_TOKEN`. These three secrets must differ.
For file-based deployments each connector credential supports a `_FILE` suffix;
mount only the individual required files, never the Google OAuth directory.
Do not paste secrets into Git, tools, chat, logs or Hub tool arguments.

## Owner Preparation And TLS

These commands are instructions only; no production changes were applied.
Run on the Docker host with root access. This creates a NEW dedicated CA,
not another service's CA. Keep CA private key outside the mounted TLS folder.
Never overwrite existing certificates blindly; back up directory first.

```sh
ss -ltn | grep ':3443 ' || true
install -d -m 700 /home/Docker/google-drive-mcp/connector-ca
install -d -m 750 -o 1000 -g 1000 /home/Docker/google-drive-mcp/connector-tls
cd /home/Docker/google-drive-mcp/connector-ca
test ! -e ca.key && test ! -e ../connector-tls/server.key || exit 1
umask 077
openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -keyout ca.key -out ca.crt -subj '/CN=Google Workspace Connector CA' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign'
openssl req -new -newkey rsa:2048 -nodes -keyout ../connector-tls/server.key -out server.csr -subj '/CN=10.21.4.101'
printf '%s\n' 'subjectAltName=IP:10.21.4.101' 'basicConstraints=critical,CA:FALSE' 'keyUsage=critical,digitalSignature,keyEncipherment' 'extendedKeyUsage=serverAuth' > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 365 -out ../connector-tls/server.crt -extfile server.ext
cp ca.crt ../connector-tls/ca.crt
chown 1000:1000 ../connector-tls/*
chmod 600 ../connector-tls/server.key
chmod 644 ../connector-tls/server.crt ../connector-tls/ca.crt
openssl verify -CAfile ca.crt -verify_ip 10.21.4.101 ../connector-tls/server.crt
```

Expected last line: `../connector-tls/server.crt: OK`.
Give Hub ONLY public `connector-tls/ca.crt`. Never share `ca.key` or `server.key`.
SAN is IP `10.21.4.101`; using another host/IP requires issuing a matching cert.
Rotate server certificate before 365-day expiry. Do not disable TLS checks.

## Owner Deployment And Acceptance

1. Back up current Portainer stack YAML/env securely. Keep current Google image,
   bearer, scopes and OAuth mounts unchanged. If current bearer uses a file,
   preserve that mode and mount that ONE bearer file into connector separately.
2. Business operator creates DISABLED managed connector with URLs/audience above,
   four allowed scopes and public CA. Transfer pairing via approved secret channel.
   This preparation does not grant permission to change existing agent grants.
3. Set exact existing Google account alias in `GOOGLE_CONNECTOR_ACCOUNT`.
   Do not guess email/default alias or publish tokens to find it.
4. Use `deploy/portainer-business.yml` in EXISTING `google-drive-mcp` stack.
   It is a full env-bearer example, not a second stack or standalone deployment.
   Review differences against current stack before redeploying.
5. Verify health and TLS below. Business lane imports reviewed strict catalog,
   runs disabled-connector admin Test, negative auth tests and approved through-Hub
   safe read. Only owner approves grants and enabling route.

```sh
curl --cacert /home/Docker/google-drive-mcp/connector-tls/ca.crt https://10.21.4.101:3443/health
docker compose -f deploy/portainer-business.yml config --quiet
docker compose -f deploy/portainer-business.yml ps
docker compose -f deploy/portainer-business.yml logs --tail=50 google-workspace-connector
```

Health expected: `{"status":"ok","app":"google-workspace","version":"1.0.0"}`.
Unsigned `/mcp` must return 401. After approved onboarding, safe example:
`google_workspace__searchGmailMessages` with narrow query and `maxResults:1`,
using an agent's existing Business bearer, never connector/Google bearer.
Health and synthetic tests are not evidence of live Hub or Google API success.

## Session And Replay Limits

Stateless Streamable HTTP: no MCP session id issued; any supplied session id
is rejected. New SDK server per HTTP request, separate upstream MCP session per
operation, closed/terminated afterwards. Parallel request ids cannot share a
response map. Caller identity is immutable per request, never global.
Hub delegation auth must sign every HTTP request with fresh nonce (current Hub
does). v3/v4 HMAC match canonical Hub payload; +/-90 sec skew. Replay entries
kept through timestamp+90 sec, capacity 10,000 fails closed. Process-local nonce
store resets on restart: captured still-valid requests can replay after restart.
Run ONE replica; durable replay requires a shared atomic store before scaling.
Pairing bearer is Hub-only. Restrict host firewall access to intended Hub hosts.
Max 8 simultaneous HTTP requests; overload 503, no unbounded connector queue.
Audit is metadata-only stdout, bounded Docker rotation; not durable audit DB.
Tool argument bodies/provider content are never logged by connector; existing
upstream app logging remains its own boundary. Upstream errors become generic.

## Source Verification And Publication

```sh
npm ci --ignore-scripts
npm run lint
npm run test:build
MCP_TESTING=1 node --test --test-concurrency=2 '.tmp-test/test/**/*.test.js'
MCP_TESTING=1 node scripts/connector-catalog.js --check
node scripts/build-connector.js
```

Workflow `.gitea/workflows/build-workspace-connector.yml` publishes connector
only, immutable tag, OCI revision labels. No latest promotion, no auto-deploy.
Google app image remains previous published revision, excluding dirty admin UI.
Release status/image digest are recorded separately after CI completion.

## Rollback

Disable ONLY new managed connector route (owner action), preserve pairing,
grants and audit. Restore previous stack YAML/env or previous connector digest.
Removing connector service must not delete Google volumes/config or rotate
OAuth/bearer. Do not run `down -v`, global prune or remove Google container data.
