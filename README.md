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
5. Save its JSON only on the Portainer host:
   `/home/Docker/google-analytics-connector/secrets/google-analytics-service-account.json`,
   owned by root, mode `0600`. Never commit, paste into the Hub, or add to a
   client MCP configuration.
6. Set `GOOGLE_APPLICATION_CREDENTIALS` to the mounted read-only file path.

If the official upstream later gains a secure device/OAuth credential store,
it can be added as a separate explicit mode. Do not bake `gcloud auth
application-default login` files into an image.

## Portainer Owner Deployment

This repository intentionally supplies a template only; it does not deploy or
restart anything.

1. Publish a signed/tagged CI image to GHCR, then use the immutable image tag
   or digest in `deploy/stack.yml`.
2. Copy `.env.example` to the root-owned host file
   `/home/Docker/google-analytics-connector/env/google-analytics-connector.env`
   (`0600`). Fill only the pairing values revealed once by Business MCP Hub
   plus the final HTTPS hostname; no value belongs in Git or Portainer UI text.
3. Create an NPM/reverse-proxy host for the final hostname, upstream
   `google-analytics-connector:3050`, with a certificate whose SAN includes
   the hostname. Do not expose port 3050 publicly.
4. Deploy the stack **without adding any Hub route yet**. Verify
   `GET /health` through the internal network and exact HTTPS hostname.
5. In Business MCP Hub `/admin`, create a **disabled** connector:

   ```text
   namespace:       google_analytics
   endpoint:         https://<final-hostname>/mcp
   health endpoint:  https://<final-hostname>/health
   audience:         google-analytics
   allowed scopes:   ga:read
   ```

   Add the nine-tool catalog above with `required_scopes: ["ga:read"]` for
   each tool. Copy pairing bearer + delegation secret once into the host env.
6. Use **Test** while disabled: certificate, `/health`, authenticated MCP
   initialize, tools/list, then negative bearer/signature/scope/replay cases.
7. Only after an approved agent receives `ga:read`, enable the connector and
   run one safe `google_analytics__get_account_summaries` call via the normal
   Business MCP endpoint.

## Rollback

Disable only the `google_analytics` connector in Hub, leaving grants and
pairing intact. Roll back the Portainer image tag if necessary. Do not rotate
keys, delete the service account key, or alter other connectors as rollback.
