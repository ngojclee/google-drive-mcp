# Gmail authorization and management UI

## Authorize Gmail with the currently published image

1. Open Google Cloud Console for the project that owns the existing OAuth
   client. In APIs & Services > Library, enable Gmail API.
2. In Google Auth Platform > Data Access (older UI: OAuth consent screen >
   Scopes), add `https://www.googleapis.com/auth/gmail.readonly`. Only if draft
   creation is wanted, also add `https://www.googleapis.com/auth/gmail.compose`.
   The compose scope permits sending at Google's API layer, although this fork
   does not expose a send tool. Retain existing Drive/Workspace scopes.
3. Under Audience, verify the intended Google account is allowed. If the app
   is External / Testing, add it to Test Users. Gmail grants in Testing can
   expire after seven days. Publishing/verification depends on Google's rules;
   do not promise permanent consent by changing the status alone.
4. Stop google-drive-mcp through Portainer during CLI consent. Back up
   `/home/Docker/google-drive-mcp/config` with restrictive permissions first.
   Do not delete tokens.json or replace the OAuth client to add scopes.
5. On Windows, keep this terminal open:

   ```powershell
   ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:3300:127.0.0.1:3300 root@10.21.4.101
   ```

6. In a separate SSH terminal on the VPS, run:

   ```bash
   docker run --rm -it --network host \
     --mount type=bind,src=/home/Docker/google-drive-mcp/config,dst=/config \
     -e GOOGLE_DRIVE_MCP_AUTH_PORT=3300 \
     -e GOOGLE_DRIVE_MCP_SCOPES=drive,drive.file,drive.readonly,documents,spreadsheets,presentations,calendar,calendar.events,gmail.readonly \
     gitea.lengoc.me/automations/google-drive-mcp:2.12.0-lnc.gmail.20261016.1 auth --no-browser
   ```

   For draft creation, append `,gmail.compose` to the scope env above. These
   scopes preserve this installation's previous Workspace capabilities.
7. Open the printed Google URL on Windows, select the correct account and
   approve the requested scopes. If the printed callback port is not 3300,
   reopen the tunnel with that port on both sides. Cancel on a wrong account.
8. Start the existing service through Portainer. Configure MCP bearer on each
   calling client or Hub upstream. Check account scopes and one bounded Gmail
   search (`maxResults: 1`). A healthcheck does not prove Google access.

## Optional admin UI in the next image

### Optional Gmail filter permission

To manage filters later, add
`https://www.googleapis.com/auth/gmail.settings.basic` in Google Cloud Data
Access, then append that full URL to `GOOGLE_DRIVE_MCP_SCOPES` in the auth
command above and re-consent. The currently published Gmail image accepts the
full URL; the next build also recognizes the alias `gmail.settings.basic`.
For this installation's requested read/draft/filter grant, the full value is:

```ini
drive,drive.file,drive.readonly,documents,spreadsheets,presentations,calendar,calendar.events,gmail.readonly,gmail.compose,https://www.googleapis.com/auth/gmail.settings.basic
```

This permission covers more settings than filters. It is not enabled by default
and does not add filter tools. Forwarding destinations must already be verified
in each source mailbox; do not enable whole-mailbox forwarding implicitly.

### Management setup

This section requires an image containing `src/admin.ts`; the Gmail release
above does not contain the UI. Do not change production image until CI passes
and the new image is published.

Create a DIFFERENT management key on the VPS, once:

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

Keep this file server-local and transfer to the authorized administrator only
through a trusted channel. Do not print it to chat or reuse the MCP bearer.
Set this Portainer variable to enable management, then redeploy yourself:

```ini
GOOGLE_MCP_ADMIN_KEY_FILE=/config/admin-key
```

Open `http://10.21.4.101:3110/admin/`. Admin login uses an HttpOnly, SameSite
cookie, expires after one hour and is lost on service restart. MCP bearer does
not authenticate the UI. Paths/account metadata require admin login. Nothing
returns OAuth secrets, access tokens, refresh tokens or bearer contents.

- Accounts: alias, email, granted scopes, refresh-token presence.
- Server Files: configured path, presence, size and modification time from API.
- Upload Credentials: Desktop OAuth JSON only; backs up the previous file,
  writes atomically with mode 600. Existing account tokens are not imported or
  deleted. Changing OAuth projects can invalidate refresh-token compatibility;
  re-authorize affected accounts with the intended project.
- Google Consent: existing alias to re-consent; use a new non-reserved alias
  such as `primary` for a new account. Choose read-only or read + drafts. Existing
  scopes are retained in the request. Requested scopes are not granted until
  Google approves. Identity lookup must succeed before writing credentials.
- Copy the displayed SSH tunnel command to Windows, keep it open, then follow
  Open Google Consent. Callback port mappings bind only to VPS 127.0.0.1;
  never publish 3300-3304 to the LAN. Refresh after finishing; flows expire
  after ten minutes or can be cancelled. No recurring background probes.

Only protected LAN/VPN HTTP is acceptable; HTTPS is required on untrusted
networks. Do not expose the UI publicly. Existing OAuth files remain the
upstream plaintext mode-600 store, not an encrypted vault. This first UI does
not add multi-tenant roles, per-agent keys, secret export, key rotation or
Business grant management. Use the Hub for per-client policy.
