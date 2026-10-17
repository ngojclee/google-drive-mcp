# Workspace Admin UI

Owner deploys; no production settings, OAuth grants or pairing changed by this release.
UI uses existing Google MCP process and port: `http://10.21.4.101:3110/admin/`.

## Scope

Blueprint shape B, no frontend framework/dependencies. Accounts, OAuth & Files,
API Access, Settings; light/dark, responsive tabs, empty/error states, credential
replacement confirmation. Management session is separate from MCP auth, with
HttpOnly/SameSite cookie, same-origin mutations, CSP nonce and login rate limit.
No secret values returned in inventory. OAuth uploads back up existing file.

This is a single-owner control panel over existing Google storage, NOT a full
blueprint credential vault. API Access and runtime settings are READ ONLY.
Pairing, agent keys and grants stay in Business; no misleading key create/copy/
revoke controls. Existing mode-600 OAuth store is preserved, not migrated to an
encrypted vault. No multi-tenant roles or hash-chain durable audit in this version.
These require a separate storage/auth migration before offering UI key management.

OAuth JSON upload currently accepts Desktop client JSON (`installed`) only.
Do not replace the working Web OAuth client merely to use this form. Existing
Web client authorization remains supported by the underlying Google auth flow.
Replace client credentials only deliberately; restart after replacement before
starting consent so cached OAuth configuration cannot be mistaken for new config.

## Owner Setup

Create dedicated management key file on server; never reuse any existing token:

```bash
sudo bash -euo pipefail <<'BASH'
umask 077
p=/home/Docker/google-drive-mcp/config/admin-key
if [ -L "$p" ]; then echo 'STOP: symlink'; exit 1; fi
if [ ! -e "$p" ]; then (set -o noclobber; openssl rand -hex 32 > "$p"); fi
test -f "$p" && test -s "$p"
chown 1000:1000 "$p"
chmod 600 "$p"
BASH
```

Set `GOOGLE_MCP_ADMIN_KEY_FILE=/config/admin-key` in Portainer. Use updated
`deploy/portainer-business.yml` in EXISTING stack, preserve all connector env,
Google bearer/scopes and data. Set `GOOGLE_MCP_IMAGE` to the tested published UI
tag after CI succeeds. Connector image does not need rebuilding or changing.
Callback ports 3300-3304 publish only on host loopback; consent UI supplies SSH
tunnel command. Keep tunnel open during Google consent. No automatic re-consent.

Get management key only through trusted server terminal, never chat/Git; login
at `/admin/`. HTTP is protected LAN/VPN only; do not expose it publicly. HTTPS
termination is required for untrusted networks. No new admin bypass on connector.

Rollback: restore previous Google image and unset admin key env; preserve data,
connector pairing, grants and callback mounts. No `down -v` or key rotation.

## Source Checks

```sh
npm run lint
npm run test:build
MCP_TESTING=1 node --test --test-concurrency=2 '.tmp-test/test/**/*.test.js'
node scripts/preview-admin.js
# Separate terminal, using an existing Playwright installation:
PLAYWRIGHT_MODULE=/path/to/playwright node scripts/check-admin-ui.js
```

Preview is SYNTHETIC and loopback-only. No credentials, live Google calls,
consent mutations or production writes. Screenshots in ignored `.tmp-test/`.
Optional `BROWSER_BIN` selects an installed browser executable.
