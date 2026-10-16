# Connector Release 2026-10-16

## Published

- Repository: https://gitea.lengoc.me/automations/google-drive-mcp
- Source branch: master
- Image source revision: `3c3a32643af9f27acb29559143fa8327b3e1a235`
- CI: https://gitea.lengoc.me/automations/google-drive-mcp/actions/runs/328
- CI result: success, 1179 tests passed, zero failures, zero skips.
- Image: `gitea.lengoc.me/automations/google-workspace-connector:1.0.0-lnc.20261016.1`
- Registry manifest digest: `sha256:139192f06e04187b7226e568ea8eb5e0036274d622a1ecd9562d50c36c873b2d`
- Platform: linux/amd64 (current Docker build runner).

Recommended owner stack value:

```ini
GOOGLE_CONNECTOR_IMAGE=gitea.lengoc.me/automations/google-workspace-connector@sha256:139192f06e04187b7226e568ea8eb5e0036274d622a1ecd9562d50c36c873b2d
```

Compose syntax also validated locally with synthetic env, no runtime deployment.
134 actual upstream tools classified: 108 scope-gated, 26 denied. Generated Hub
catalog is a review artifact, not an applied grant or registry mutation.

## Not Deployed / Not Verified Live

- No TLS certificates generated on production; public CA still owner-supplied.
- No Hub connector created/saved, pairing issued, catalog imported or route enabled.
- No OAuth, Google credentials, consent scopes, grants or containers changed.
- No live HTTPS handshake, disabled-Hub Test or through-Hub Google read yet.
- Existing direct Google MCP clients remain unchanged.

Use `GOOGLE-WORKSPACE-CONNECTOR.md`, `connector.env.example` and
`portainer-business.yml` for owner deployment in the EXISTING Google stack.
Public CA, matching pairing and exact existing account alias are required first.
Rollback instructions are in the same runbook; preserve Google data and secrets.

## Preserved Uncommitted Work

Not included in image/source commit: existing changes to `deploy/README.md`,
`deploy/portainer.yml`, `src/auth/server.ts`, `src/index.ts`; untracked
`deploy/GMAIL-ADMIN.md`, `src/admin.ts`, `src/adminHtml.ts`, `test/admin.test.ts`.
Local full suite included this UI work (1179 passed, one skip); clean CI above
is authoritative for the published connector revision.
