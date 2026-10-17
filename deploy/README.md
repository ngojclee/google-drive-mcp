# Shared Workspace MCP deployment

For exact Gmail consent steps and optional management UI setup, read
[GMAIL-ADMIN.md](GMAIL-ADMIN.md).

Use the existing Gitea repository in Portainer, branch `master`, compose path
`deploy/portainer.yml`, stack name `google-drive-mcp`. Update the existing stack;
do not deploy a second stack with the same container name or port.

This stack requires the fork build containing Gmail, HTTP bearer protection and
`/healthz`. Do not deploy it against an older image. Build a unique immutable
tag first and set `GOOGLE_MCP_IMAGE` to that image. Keep Watchtower disabled
through migration. A source push does not mean an image was published.

## Access model

Google OAuth login authorizes the server to access one mailbox. The separate MCP
bearer token authorizes agents to use that account. Every bearer holder shares
all tools/accounts exposed by this deployment, including account-management
tools; this is not per-agent isolation. Never distribute Google refresh tokens.
Use team mode or a policy gateway when agents need distinct permissions/keys.

Plain HTTP does not encrypt bearer tokens or email. Restrict port 3110 to trusted
hosts on a protected LAN/VPN; use HTTPS before crossing an untrusted network.
Host allowlisting is not a client-IP firewall.

## Prepare on the VPS

Back up the config directory to a restricted server-local location before login.
Do not move OAuth files into Git or shared client configuration.

```bash
sudo sh -eu -c '
  dir=/home/Docker/google-drive-mcp/config
  test -d "$dir"
  umask 077
  backup="/home/Docker/google-drive-mcp/config-backup-$(date +%Y%m%d-%H%M%S)"
  test ! -e "$backup"
  cp -a "$dir" "$backup"
  chmod 700 "$backup"
  token="$dir/mcp-http-bearer-token"
  if [ ! -e "$token" ]; then
    (set -C; openssl rand -hex 32 > "$token")
  fi
  chown 1000:1000 "$token"
  chmod 600 "$token"
'
```

Transfer only the MCP bearer into the existing client secret store through a
trusted channel, without printing it into chat/logs. Clients send
`Authorization: Bearer <MCP bearer>` to `http://10.21.4.101:3110/mcp`.
This is not the Google access token or refresh token.

## Google login / additional Gmail consent

1. In the existing Google Cloud project, enable **Gmail API**. Add
   `gmail.readonly` to the OAuth consent screen. For draft creation also add
   `gmail.compose`. That Google scope authorizes sending too, although this
   fork exposes no send/delete/update tool. Testing-mode grants can expire
   after seven days. Gmail restricted scopes have Google verification rules;
   review these before distributing the OAuth app beyond personal use.
2. Stop the existing service during consent to avoid two processes writing the
   token store. From Windows open this SSH tunnel and keep it open:

   ```powershell
   ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:3300:127.0.0.1:3300 root@10.21.4.101
   ```

3. In another VPS shell, run the tested image (replace `TESTED_TAG`). Host
   networking is only for this temporary loopback OAuth callback, not the stack:

   ```bash
   docker run --rm -it --network host \
     --mount type=bind,src=/home/Docker/google-drive-mcp/config,dst=/config \
     -e GOOGLE_DRIVE_MCP_AUTH_PORT=3300 \
     -e GOOGLE_DRIVE_MCP_SCOPES=drive.file,documents,spreadsheets,presentations,gmail.readonly \
     gitea.lengoc.me/automations/google-drive-mcp:TESTED_TAG auth --no-browser
   ```

   For drafts, append `,gmail.compose` both here and in `GOOGLE_MCP_SCOPES`.
   Open the printed Google consent URL on Windows. Select the correct account
   and approve permissions. The callback must use the actual printed port;
   if 3300 is busy, the program may choose 3301-3304, so adjust the tunnel.
   Existing accounts re-consent in place; a fresh headless install uses alias
   `primary`. Do not delete tokens to broaden scopes. Cancel if account picker
   shows the wrong account.
4. Redeploy the existing stack after successful login, then reconnect clients
   with the MCP bearer configured. Run `manage_accounts list`, `authListScopes`,
   a small Drive read and `searchGmailMessages` with `maxResults: 1`.

```bash
docker inspect --format '{{.State.Health.Status}}' google-drive-mcp
docker logs --tail 60 google-drive-mcp
```

Expected: health `healthy`; unauthenticated `/mcp` returns 401; authenticated
initialize returns 200; unknown Host returns 403. Health alone does not prove
Google consent or Gmail access. Do not create a real draft as a healthcheck.

## Portainer variables

```ini
GOOGLE_MCP_IMAGE=gitea.lengoc.me/automations/google-drive-mcp:TESTED_TAG
GOOGLE_MCP_ALLOWED_HOSTS=10.21.4.101
GOOGLE_MCP_SCOPES=drive.file,documents,spreadsheets,presentations,gmail.readonly
```

No secret value belongs in these variables. After migration and client checks,
tracking `lnc-latest` is optional; immutable tags make rollback predictable.
