from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Callable

"""GA4 Admin API tool surface (google.analytics.admin_v1beta).

The upstream `analytics-mcp` package is read-only, so property-configuration
tools are implemented directly here:

- ga:write  — GA4 "Editor" property role; config reads + writes (data streams,
  key events, custom dimensions/metrics, channel groups, property settings,
  Measurement Protocol secrets).
- ga:admin  — GA4 "Administrator" role; access bindings (granting users) and
  change-history audit.

All calls go through one lazy AnalyticsAdminServiceClient and are serialized
by the caller's lock (see UpstreamGa)."""


class AdminToolError(Exception):
    pass


_PROPERTY_ID = re.compile(r"^\d+$")
_ACCOUNT_PARENT = re.compile(r"^accounts/\d+$")
_ENTITY_PARENT = re.compile(r"^(accounts|properties)/\d+$")
_RESOURCE_NAME = re.compile(r"^(accounts|properties)/[A-Za-z0-9/_-]+$")


def _property(a: dict[str, Any]) -> str:
    pid = str(a.get("property_id", "")).strip()
    if not _PROPERTY_ID.fullmatch(pid):
        raise AdminToolError("property_id must be the numeric GA4 property id")
    return f"properties/{pid}"


def _parent(a: dict[str, Any]) -> str:
    parent = str(a.get("parent", "")).strip()
    if not _ENTITY_PARENT.fullmatch(parent):
        raise AdminToolError("parent must look like properties/123 or accounts/456")
    return parent


def _account(a: dict[str, Any]) -> str:
    parent = str(a.get("parent", "")).strip()
    if not _ACCOUNT_PARENT.fullmatch(parent):
        raise AdminToolError("parent must look like accounts/456")
    return parent


def _name(a: dict[str, Any]) -> str:
    name = str(a.get("name", "")).strip()
    if not _RESOURCE_NAME.fullmatch(name):
        raise AdminToolError("name must be a full GA4 resource name")
    return name


def _dump(obj: Any) -> dict[str, Any]:
    from google.protobuf.json_format import MessageToDict

    return MessageToDict(obj._pb, preserving_proto_field_name=True)


def _page(pager: Any) -> list[dict[str, Any]]:
    return [_dump(item) for item in pager]


# ---- ga:write handlers ---------------------------------------------------


def _list_data_streams(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    return {
        "data_streams": _page(
            c.list_data_streams(request={"parent": _property(a)})
        )
    }


def _list_key_events(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    return {
        "key_events": _page(c.list_key_events(request={"parent": _property(a)}))
    }


def _create_key_event(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    event_name = str(a.get("event_name", "")).strip()
    if not event_name:
        raise AdminToolError("event_name is required")
    return {
        "key_event": _dump(
            c.create_key_event(
                request={
                    "parent": _property(a),
                    "key_event": {
                        "event_name": event_name,
                        "counting_method": str(
                            a.get("counting_method") or "ONCE_PER_EVENT"
                        ),
                    },
                }
            )
        )
    }


def _update_key_event(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    body: dict[str, Any] = {}
    if a.get("counting_method"):
        body["counting_method"] = str(a["counting_method"])
    if not body:
        raise AdminToolError("nothing to update (only counting_method is mutable)")
    return {
        "key_event": _dump(
            c.update_key_event(
                request={"key_event": {"name": _name(a), **body}}
            )
        )
    }


def _delete_key_event(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    c.delete_key_event(request={"name": _name(a)})
    return {"deleted": True}


def _list_custom_dimensions(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    return {
        "custom_dimensions": _page(
            c.list_custom_dimensions(request={"parent": _property(a)})
        )
    }


def _create_custom_dimension(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    for field in ("parameter_name", "display_name", "scope"):
        if not str(a.get(field, "")).strip():
            raise AdminToolError(f"{field} is required")
    body: dict[str, Any] = {
        "parameter_name": str(a["parameter_name"]),
        "display_name": str(a["display_name"]),
        "scope": str(a["scope"]),
    }
    for optional in ("description", "disallow_ads_personalization"):
        if a.get(optional) is not None:
            body[optional] = a[optional]
    return {
        "custom_dimension": _dump(
            c.create_custom_dimension(
                request={"parent": _property(a), "custom_dimension": body}
            )
        )
    }


def _archive_custom_dimension(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    c.archive_custom_dimension(request={"name": _name(a)})
    return {"archived": True}


def _list_custom_metrics(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    return {
        "custom_metrics": _page(
            c.list_custom_metrics(request={"parent": _property(a)})
        )
    }


def _create_custom_metric(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    for field in ("parameter_name", "display_name", "measurement_unit"):
        if not str(a.get(field, "")).strip():
            raise AdminToolError(f"{field} is required")
    body: dict[str, Any] = {
        "parameter_name": str(a["parameter_name"]),
        "display_name": str(a["display_name"]),
        "measurement_unit": str(a["measurement_unit"]),
        "scope": str(a.get("scope") or "EVENT"),
    }
    if a.get("description"):
        body["description"] = str(a["description"])
    return {
        "custom_metric": _dump(
            c.create_custom_metric(
                request={"parent": _property(a), "custom_metric": body}
            )
        )
    }


def _archive_custom_metric(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    c.archive_custom_metric(request={"name": _name(a)})
    return {"archived": True}


def _update_property(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    fields = {}
    for field in ("display_name", "time_zone", "currency_code"):
        if a.get(field) is not None:
            fields[field] = a[field]
    if not fields:
        raise AdminToolError(
            "nothing to update (display_name/time_zone/currency_code)"
        )
    return {
        "property": _dump(
            c.update_property(
                request={
                    "property": {"name": _property(a), **fields},
                    "update_mask": {"paths": sorted(fields)},
                }
            )
        )
    }


def _list_channel_groups(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    return {
        "channel_groups": _page(
            c.list_channel_groups(request={"parent": _property(a)})
        )
    }


def _mp_parent(a: dict[str, Any]) -> str:
    stream = str(a.get("data_stream", "")).strip()
    if not _RESOURCE_NAME.fullmatch(stream) or "dataStreams/" not in stream:
        raise AdminToolError(
            "data_stream must look like properties/123/dataStreams/456"
        )
    return stream


def _list_mp_secrets(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    return {
        "measurement_protocol_secrets": _page(
            c.list_measurement_protocol_secrets(
                request={"parent": _mp_parent(a)}
            )
        )
    }


def _create_mp_secret(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    nickname = str(a.get("nickname", "")).strip() or "connector"
    return {
        "measurement_protocol_secret": _dump(
            c.create_measurement_protocol_secret(
                request={
                    "parent": _mp_parent(a),
                    "measurement_protocol_secret": {"nickname": nickname},
                }
            )
        )
    }


def _delete_mp_secret(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    c.delete_measurement_protocol_secret(request={"name": _name(a)})
    return {"deleted": True}


# ---- ga:admin handlers ---------------------------------------------------


def _list_access_bindings(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    return {
        "access_bindings": _page(
            c.list_access_bindings(request={"parent": _parent(a)})
        )
    }


def _create_access_binding(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    user = str(a.get("user", "")).strip()
    roles = a.get("roles")
    if not user or "@" not in user:
        raise AdminToolError("user must be an email address")
    if not isinstance(roles, list) or not roles:
        raise AdminToolError(
            "roles must be a list, e.g. [\"predefinedRoles/editor\"]"
        )
    return {
        "access_binding": _dump(
            c.create_access_binding(
                request={
                    "parent": _parent(a),
                    "access_binding": {
                        "user": user,
                        "access_roles": [str(r) for r in roles],
                    },
                }
            )
        )
    }


def _delete_access_binding(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    c.delete_access_binding(request={"name": _name(a)})
    return {"deleted": True}


def _search_change_history(c: Any, a: dict[str, Any]) -> dict[str, Any]:
    request: dict[str, Any] = {"account": _account(a)}
    for field, key in (
        ("resource_name", "resource_name"),
        ("actor_email", "actor_email"),
        ("earliest_change_time", "earliest_change_time"),
        ("latest_change_time", "latest_change_time"),
    ):
        if a.get(field):
            request[key] = a[field]
    if a.get("resource_type"):
        request["resource_type"] = [str(t) for t in a["resource_type"]]
    if a.get("action"):
        request["action"] = [str(x) for x in a["action"]]
    return {
        "change_history_events": _page(
            c.search_change_history_events(request=request)
        )
    }


# ---- registry ------------------------------------------------------------


@dataclass(frozen=True)
class AdminToolSpec:
    scope: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[[Any, dict[str, Any]], dict[str, Any]]


def _props(req: list[str], props: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": props,
        "required": req,
        "additionalProperties": False,
    }


_PID = {"property_id": {"type": "string", "description": "Numeric GA4 property id"}}
_NAME = {"name": {"type": "string", "description": "Full GA4 resource name"}}
_PARENT = {"parent": {"type": "string", "description": "properties/123 or accounts/456"}}
_STREAM = {"data_stream": {"type": "string", "description": "properties/123/dataStreams/456"}}

WRITE = "ga:write"
ADMIN = "ga:admin"

ADMIN_TOOLS: dict[str, AdminToolSpec] = {
    "list_data_streams": AdminToolSpec(
        WRITE,
        "List GA4 data streams of a property (includes web measurement ids).",
        _props(["property_id"], _PID),
        _list_data_streams,
    ),
    "list_key_events": AdminToolSpec(
        WRITE,
        "List key events (conversions) configured on a property.",
        _props(["property_id"], _PID),
        _list_key_events,
    ),
    "create_key_event": AdminToolSpec(
        WRITE,
        "Mark an event name as a key event. counting_method: ONCE_PER_EVENT|ONCE_PER_SESSION.",
        _props(
            ["property_id", "event_name"],
            {
                **_PID,
                "event_name": {"type": "string"},
                "counting_method": {"type": "string"},
            },
        ),
        _create_key_event,
    ),
    "update_key_event": AdminToolSpec(
        WRITE,
        "Update a key event's counting_method.",
        _props(["name"], {**_NAME, "counting_method": {"type": "string"}}),
        _update_key_event,
    ),
    "delete_key_event": AdminToolSpec(
        WRITE,
        "Remove a key event marking (the underlying event keeps collecting).",
        _props(["name"], _NAME),
        _delete_key_event,
    ),
    "list_custom_dimensions": AdminToolSpec(
        WRITE,
        "List registered custom dimensions on a property.",
        _props(["property_id"], _PID),
        _list_custom_dimensions,
    ),
    "create_custom_dimension": AdminToolSpec(
        WRITE,
        "Register a custom dimension. scope: EVENT|USER|ITEM.",
        _props(
            ["property_id", "parameter_name", "display_name", "scope"],
            {
                **_PID,
                "parameter_name": {"type": "string"},
                "display_name": {"type": "string"},
                "scope": {"type": "string"},
                "description": {"type": "string"},
                "disallow_ads_personalization": {"type": "boolean"},
            },
        ),
        _create_custom_dimension,
    ),
    "archive_custom_dimension": AdminToolSpec(
        WRITE,
        "Archive a custom dimension (frees the slot; data stops collecting).",
        _props(["name"], _NAME),
        _archive_custom_dimension,
    ),
    "list_custom_metrics": AdminToolSpec(
        WRITE,
        "List registered custom metrics on a property.",
        _props(["property_id"], _PID),
        _list_custom_metrics,
    ),
    "create_custom_metric": AdminToolSpec(
        WRITE,
        "Register a custom metric (scope is EVENT-only in GA4).",
        _props(
            ["property_id", "parameter_name", "display_name", "measurement_unit"],
            {
                **_PID,
                "parameter_name": {"type": "string"},
                "display_name": {"type": "string"},
                "measurement_unit": {
                    "type": "string",
                    "description": "e.g. STANDARD, CURRENCY_<ISO>, FEET, MILES, METERS, SECONDS, MILLISECONDS",
                },
                "scope": {"type": "string"},
                "description": {"type": "string"},
            },
        ),
        _create_custom_metric,
    ),
    "archive_custom_metric": AdminToolSpec(
        WRITE,
        "Archive a custom metric (frees the slot).",
        _props(["name"], _NAME),
        _archive_custom_metric,
    ),
    "update_property": AdminToolSpec(
        WRITE,
        "Update property display_name, time_zone or currency_code.",
        _props(
            ["property_id"],
            {
                **_PID,
                "display_name": {"type": "string"},
                "time_zone": {"type": "string", "description": "e.g. Europe/Paris"},
                "currency_code": {"type": "string", "description": "e.g. EUR"},
            },
        ),
        _update_property,
    ),
    "list_channel_groups": AdminToolSpec(
        WRITE,
        "List channel groups on a property.",
        _props(["property_id"], _PID),
        _list_channel_groups,
    ),
    "list_measurement_protocol_secrets": AdminToolSpec(
        WRITE,
        "List Measurement Protocol secrets of a data stream.",
        _props(["data_stream"], _STREAM),
        _list_mp_secrets,
    ),
    "create_measurement_protocol_secret": AdminToolSpec(
        WRITE,
        "Create a Measurement Protocol API secret for server-side tracking.",
        _props(["data_stream"], {**_STREAM, "nickname": {"type": "string"}}),
        _create_mp_secret,
    ),
    "delete_measurement_protocol_secret": AdminToolSpec(
        WRITE,
        "Delete a Measurement Protocol secret.",
        _props(["name"], _NAME),
        _delete_mp_secret,
    ),
    "list_access_bindings": AdminToolSpec(
        ADMIN,
        "List user access bindings on a property or account.",
        _props(["parent"], _PARENT),
        _list_access_bindings,
    ),
    "create_access_binding": AdminToolSpec(
        ADMIN,
        "Grant a user access. roles e.g. predefinedRoles/viewer|analyst|editor|admin.",
        _props(
            ["parent", "user", "roles"],
            {
                **_PARENT,
                "user": {"type": "string", "description": "email address"},
                "roles": {"type": "array", "items": {"type": "string"}},
            },
        ),
        _create_access_binding,
    ),
    "delete_access_binding": AdminToolSpec(
        ADMIN,
        "Remove a user's access binding.",
        _props(["name"], _NAME),
        _delete_access_binding,
    ),
    "search_change_history": AdminToolSpec(
        ADMIN,
        "Audit config changes on an account (who changed what, when).",
        _props(
            ["parent"],
            {
                "parent": {"type": "string", "description": "accounts/456"},
                "resource_name": {"type": "string"},
                "actor_email": {"type": "string"},
                "action": {"type": "array", "items": {"type": "string"}},
                "resource_type": {"type": "array", "items": {"type": "string"}},
                "earliest_change_time": {"type": "string"},
                "latest_change_time": {"type": "string"},
            },
        ),
        _search_change_history,
    ),
}


def new_admin_client() -> Any:
    from google.analytics import admin_v1beta  # deferred: heavy grpc import

    return admin_v1beta.AnalyticsAdminServiceClient()


def invoke(client: Any, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    spec = ADMIN_TOOLS[name]
    try:
        return spec.handler(client, arguments)
    except AdminToolError:
        raise
    except Exception as exc:  # grpc/Google API errors surface as tool error
        raise AdminToolError(f"{type(exc).__name__}: {exc}") from exc
