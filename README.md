# Google Analytics Connector

The app-owned boundary between Business MCP Hub and the official
[`analytics-mcp`](https://github.com/googleanalytics/google-analytics-mcp)
package. It exposes only Google Analytics 4 read tools through Streamable HTTP:

| Upstream tool | Required scope |
| --- | --- |
| `get_account_summaries` | `ga:read` |
| `list_google_ads_links` | `ga:read` |
| `get_property_details` | `ga:read` |
| `list_property_annotations` | `ga:read` |
| `get_custom_dimensions_and_metrics` | `ga:read` |
| `run_report` | `ga:read` |
| `run_realtime_report` | `ga:read` |
| `run_funnel_report` | `ga:read` |
| `run_conversions_report` | `ga:read` |

Business MCP Hub publishes those as `google_analytics__<tool>`. The connector
does not expose account configuration, OAuth, arbitrary Google API calls, or
any mutation operations.

## Operator Dashboard

`https://<final-hostname>/admin` is a deliberately small status and setup
dashboard. Log in using the independent `MANAGEMENT_TOKEN` configured in
Portainer. It confirms only whether the service-account file is mounted and
whether the closed GA tool catalog loaded; it never displays, edits, or exports
pairing values, Google keys, or GA property data. Runtime configuration remains
declarative in Portainer so every change is auditable.

## Security Contract

- `/mcp` accepts only the connector bearer issued by a **disabled** managed
  connector record in Business MCP Hub.
- It verifies Hub v3/v4 signed delegation headers, timestamp, scope, and
  single-use nonce. Unclassified tools deny by default.
- It is MCP-session-stateless; no caller identity is stored globally.
- `/health` deliberately exposes no Google credentials or property metadata.
- Deploy behind a real HTTPS reverse proxy. The Hub must validate its exact
  CA chain and hostname/SAN; plain HTTP is not accepted for a new record.

## Google Login (recommended: service account)

This is a server-to-server connector, so do **not** use a browser login or
personal refresh token in Portainer.

1. In Google Cloud Console, create or select a dedicated project.
2. Enable **Google Analytics Data API** and **Google Analytics Admin API**.
3. Create a dedicated service account, then create one JSON key.
4. In GA4: **Admin → Property access management**, add the service-account
   email with **Viewer** (reports) or **Analyst** (explorations/funnels) on
   each property the connector may read. Prefer property-level access, never
   Account Administrator unless a GA Admin API read requires it.
5. Save its JSON only on the Portainer host under the stack's `DATA_DIR`:
   `${DATA_DIR:-/home/Docker}/google-analytics-connector/secrets/google-analytics-service-account.json`,
   owned by root, mode `0600`. Never commit, paste into the Hub, or add to a
   client MCP configuration.
6. Set `GOOGLE_APPLICATION_CREDENTIALS` to the mounted read-only file path.

If the official upstream later gains a secure device/OAuth credential store,
it can be added as a separate explicit mode. Do not bake `gcloud auth
application-default login` files into an image.

## Portainer Owner Deployment

This repository intentionally supplies a template only; it does not deploy or
restart anything.

1. Choose the final HTTPS hostname, then open Business MCP Hub
   `http://10.21.4.101:8790/admin` and create a **disabled** connector:

   ```text
   namespace:       google_analytics
   endpoint:         https://<final-hostname>/mcp
   health endpoint:  https://<final-hostname>/health
   audience:         google-analytics
   allowed scopes:   ga:read
   ```

   Add the nine-tool catalog above with `required_scopes: ["ga:read"]` for
   each tool. Copy the connector bearer and delegation secret from the
   one-time pairing reveal into Portainer in the next step. Do not enable or
   test the route yet.
2. On `https://10.21.4.101:9443`, create a Stack in **Repository** mode:

   ```text
   Repository URL: https://gitea.lengoc.me/apps/google-analytics-connector.git
   Reference:      refs/heads/main
   Compose path:   stack.yml
   Authentication: leave empty (the internal Gitea repository is public)
   ```

   Portainer builds source with `stack.yml`; no registry image is needed.
3. In the Portainer Stack environment panel, enter the values from
   `.env.example` — pairing values revealed once by Business MCP Hub,
   `MANAGEMENT_TOKEN`, final HTTPS hostname, and optional project id. The
   compose file explicitly passes each variable to the container.
   The required names are:

   ```text
   DATA_DIR=/home/Docker
   GA_MCP_BEARER_TOKEN
   GA_HUB_DELEGATION_SECRET
   GA_HUB_AUDIENCE=google-analytics
   GA_PRIVATE_MCP_URL=https://<hostname>/mcp
   GA_ALLOWED_HOSTS=<hostname>
   GA_HOST_PORT=3444
   GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/google-analytics-service-account.json
   GOOGLE_PROJECT_ID=<optional>
   MANAGEMENT_TOKEN=<unique-32+-character-operator-password>
   ```
4. Create an NPM/reverse-proxy host for the final hostname, upstream
   `http://10.21.4.101:3444`, with a certificate whose SAN includes the
   hostname. `GA_HOST_PORT` defaults to `3444`; restrict it to LAN/proxy
   access and do not add WAN/firewall exposure.
5. Deploy the stack while the Hub route remains disabled. Verify
   `GET /health` through the internal network and exact HTTPS hostname.
6. Use **Test** while disabled: certificate, `/health`, authenticated MCP
   initialize, tools/list, then negative bearer/signature/scope/replay cases.
7. Only after an approved agent receives `ga:read`, enable the connector and
   run one safe `google_analytics__get_account_summaries` call via the normal
   Business MCP endpoint.

## Rollback

Disable only the `google_analytics` connector in Hub, leaving grants and
pairing intact. Roll back the Portainer image tag if necessary. Do not rotate
keys, delete the service account key, or alter other connectors as rollback.
