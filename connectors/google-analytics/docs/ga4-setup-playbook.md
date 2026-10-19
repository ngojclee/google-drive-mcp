# GA4 Setup & Permissions Playbook

Operator reference for the `google_analytics` connector: service-account roles,
what the connector can/can't do, and the GA4 + website configuration needed for
campaign tagging, key events and funnels.

## 1. Service-account roles (per GA4 property)

Set under GA4 **Admin → Property access management**. One service account can be
added to any number of properties, across accounts.

| GA4 role | What it unlocks |
|---|---|
| Viewer | Read reports + read property config (minimum for `ga:read` tools) |
| Analyst | Viewer + share/create UI explorations (same API surface as Viewer) |
| Editor | + create/edit property config: data streams, key events, custom dimensions, channel groups, measurement-protocol secrets |
| Administrator | Editor + manage users (access bindings) on the property |

Google OAuth scopes the service account uses (JWT bearer — granted by the
property role, no consent screen):

- `analytics.readonly` — all current read tools (Data API) + Admin API reads
- `analytics.edit` — required for any write call (`createKeyEvent`,
  `updateProperty`, data streams, custom dims/metrics, MP secrets)
- `analytics.manage.users` — required only for user/access-binding management

**Recommended:** grant the service account **Editor** on properties where the
connector should configure things. Reserve **Administrator** for properties
where it should also grant/revoke user access. Keep Viewer elsewhere.

## 2. Connector scope plan

Current: 9 read-only tools, all `ga:read`. Proposed expansion:

| Hub scope | Role needed | Tools |
|---|---|---|
| `ga:read` | Viewer | run_report, run_realtime_report, run_funnel_report, run_conversions_report, get_account_summaries, get_property_details, get_custom_dimensions_and_metrics, list_google_ads_links, list_property_annotations |
| `ga:write` | Editor | list/create/update key events, custom dimensions & metrics, data streams (enhanced measurement), property settings, channel groups, measurement-protocol API secrets |
| `ga:admin` | Administrator | list/create/delete access bindings (grant users on the property), search change history |

Writes stay deny-by-default: a `ga:read`-scoped Hub client can never reach a
`ga:write` tool, and `ga:admin` is a separate opt-in grant.

## 3. Onboarding a new website (checklist)

1. GA4: create property + web data stream → note **Measurement ID `G-XXXX`**.
2. Add service-account email to the property (Viewer for read-only; Editor if
   the connector will configure it).
3. Website plugin/theme: paste `G-XXXX` (or GTM container) — one line, no DNS.
4. WooCommerce shops: enable the plugin's GA4 e-commerce events
   (`view_item`, `add_to_cart`, `begin_checkout`, `purchase`) — GA4 expects the
   standard `items[]` payload, the connector can verify via `run_report`.
5. EU-facing sites: Consent Mode v2 (CMP/banner) or GA4 drops data for
   declined users — configure in the same plugin.

## 4. Campaign tagging — what to configure where

**GA4 side: nothing required.** UTMs are auto-collected; reports expose them
through dimensions `sessionSource`, `sessionMedium`, `sessionCampaignName`,
`sessionManualAdContent`, `firstUserCampaignName` (Data API names —
`run_report` accepts `sessionCampaignName` etc.).

**Link side (the real work):** tag every inbound link consistently.

```
?utm_source=newsletter&utm_medium=email&utm_campaign=202610_launch&utm_content=hero_cta
?utm_source=facebook&utm_medium=paid&utm_campaign=holiday_sale
```

- Google Ads: prefer **auto-tagging `gclid`** — never hand-UTM ad URLs.
- Naming convention: lowercase, `_` separators, `source` = where
  (facebook/newsletter/partner-name), `medium` = how (paid/email/social/qr),
  `campaign` = initiative id. Drift in casing splits rows — pick one sheet.
- Optional GA4 edits (need Editor/`ga:write`): custom channel group to roll
  `utm_medium=qr|partner` into own channels; session-scoped custom dimension
  if the plugin sends extra params.

## 5. Key events & funnels

- **Key events** (old "conversions"): Admin → Events → mark events like
  `purchase`, `generate_lead`, `form_submit` → they feed `run_conversions_report`,
  Ads links and funnel reports. Creatable via Admin API once `ga:write` exists
  (`createKeyEvent`) — until then mark them in the GA4 UI.
- **Funnels**: `run_funnel_report` takes steps (event names/dimension filters)
  in the request — **no pre-config needed**, connector can run any funnel
  today. A saved funnel *exploration* in the UI is a separate manual step and
  not required for API reporting.
- Custom event params the site sends (e.g. `plan_tier`) must be **registered**
  as custom dimensions before they appear in reports (Admin → Custom
  definitions, or `ga:write` tools later).

## 6. Hygiene settings worth setting once per property

- Data retention: event data → **14 months** (default 2).
- Internal traffic filter: office IPs + `internal` traffic param.
- Referral exclusion list: payment gateways (stripe.com, paypal.com…) or
  checkout sessions restart as new sessions.
- Cross-domain: if checkout lives on another domain, add it in the data stream.
- Server-side events (form→CRM, offline orders): Measurement Protocol —
  create an MP API secret (Admin → Data stream → Measurement Protocol) — this
  is exactly what `ga:write` tools can automate later.
