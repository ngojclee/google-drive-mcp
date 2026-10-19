from __future__ import annotations

import hashlib
import hmac
import re
import threading
import time
from dataclasses import dataclass
from typing import Any

"""Hub delegated-identity verification — byte-compatible with
business_mcp_hub/delegation.py (v3 nonce form) and the v4 app-binding
form. The connector never trusts tool arguments for caller identity:
client_id + scopes come only from headers the Hub signed."""


class DelegationError(Exception):
    """Raised when delegated identity headers are missing or invalid."""


CLIENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$")
APP_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
NONCE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{20,128}$")
SCOPE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:._*-]{0,63}$")

# Tool-facing scope groups. Hub registry client grants carry these strings;
# the connector re-checks them so a misconfigured grant cannot widen a
# caller silently.
READ_SCOPE = "ga:read"
WRITE_SCOPE = "ga:write"   # GA4 Editor role: property-config writes/reads
ADMIN_SCOPE = "ga:admin"   # GA4 Administrator role: access bindings + audit
KNOWN_SCOPES = frozenset({READ_SCOPE, WRITE_SCOPE, ADMIN_SCOPE})


def parse_client_id(value: Any) -> str:
    client_id = str(value or "").strip()
    if not CLIENT_ID_PATTERN.fullmatch(client_id):
        raise DelegationError("client id is invalid")
    return client_id


def parse_nonce(value: Any) -> str:
    nonce = str(value or "").strip()
    if not NONCE_PATTERN.fullmatch(nonce):
        raise DelegationError("delegation nonce is invalid")
    return nonce


def normalize_scopes(value: str | list[str] | None) -> tuple[str, ...]:
    raw = (
        str(value or "").split(",")
        if isinstance(value, str)
        else list(value or ())
    )
    scopes = tuple(
        sorted(
            {
                str(scope or "").strip()
                for scope in raw
                if str(scope or "").strip()
            }
        )
    )
    if not scopes or any(not SCOPE_PATTERN.fullmatch(s) for s in scopes):
        raise DelegationError("delegated scopes are invalid")
    return scopes


def canonical_delegation(
    *,
    audience: str,
    client_id: str,
    timestamp: int,
    nonce: str,
    scopes: str | list[str],
    app_id: str = "",
) -> bytes:
    """Recompute the exact payload the Hub signed — the envelope form is
    decided by the presence of the app header, never by a claimed version."""
    normalized_client_id = parse_client_id(client_id)
    normalized_nonce = parse_nonce(nonce)
    normalized_scopes = normalize_scopes(scopes)
    normalized_app_id = str(app_id or "").strip()
    if normalized_app_id:
        if not APP_ID_PATTERN.fullmatch(normalized_app_id):
            raise DelegationError("delegated app id is invalid")
        return (
            "v4\n"
            f"{audience}\n"
            f"{normalized_client_id}\n"
            f"{normalized_app_id}\n"
            f"{int(timestamp)}\n"
            f"{normalized_nonce}\n"
            f"{','.join(normalized_scopes)}"
        ).encode("utf-8")
    return (
        "v3\n"
        f"{audience}\n"
        f"{normalized_client_id}\n"
        f"{int(timestamp)}\n"
        f"{normalized_nonce}\n"
        f"{','.join(normalized_scopes)}"
    ).encode("utf-8")


@dataclass(frozen=True)
class DelegatedIdentity:
    client_id: str
    scopes: tuple[str, ...]
    nonce: str
    timestamp: int
    app_id: str = ""


class NonceReplayStore:
    """Small, process-local nonce window.

    The connector is intentionally stateless at the MCP session layer, but an
    accepted Hub envelope must still be single-use. Production replicas keep
    requests pinned to one connector instance by the proxy; distributed replay
    prevention is a future app-stack concern if replicas are introduced.
    """

    def __init__(self, window_seconds: int = 90) -> None:
        self._window_seconds = window_seconds
        self._accepted: dict[str, int] = {}
        self._lock = threading.Lock()

    def accept_once(self, nonce: str, *, now: int | None = None) -> None:
        current = int(time.time() if now is None else now)
        with self._lock:
            expired = [
                value for value, deadline in self._accepted.items()
                if deadline <= current
            ]
            for value in expired:
                del self._accepted[value]
            if nonce in self._accepted:
                raise DelegationError("delegation nonce has already been used")
            self._accepted[nonce] = current + self._window_seconds


def verify_delegation_headers(
    *,
    headers: Any,
    secret: str,
    audience: str,
    replay_store: NonceReplayStore | None = None,
    now: int | None = None,
    max_age_seconds: int = 90,
) -> DelegatedIdentity:
    try:
        client_id = parse_client_id(headers.get("x-mcp-hub-client-id", ""))
        scopes = normalize_scopes(headers.get("x-mcp-hub-client-scopes", ""))
        nonce = parse_nonce(headers.get("x-mcp-hub-client-nonce", ""))
        timestamp = int(str(headers.get("x-mcp-hub-client-timestamp", "")).strip())
        signature = str(headers.get("x-mcp-hub-client-signature", "")).strip().lower()
    except (TypeError, ValueError, DelegationError) as exc:
        raise DelegationError("delegated identity headers are invalid") from exc
    if not re.fullmatch(r"[0-9a-f]{64}", signature):
        raise DelegationError("delegation signature is invalid")
    current = int(time.time() if now is None else now)
    if abs(current - timestamp) > max(1, max_age_seconds):
        raise DelegationError("delegation is expired")
    app_id = str(headers.get("x-mcp-hub-app-id", "") or "").strip()
    payload = canonical_delegation(
        audience=audience,
        client_id=client_id,
        timestamp=timestamp,
        nonce=nonce,
        scopes=scopes,
        app_id=app_id,
    )
    expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise DelegationError("delegation signature is invalid")
    if replay_store is not None:
        replay_store.accept_once(nonce, now=current)
    return DelegatedIdentity(
        client_id=client_id,
        scopes=scopes,
        nonce=nonce,
        timestamp=timestamp,
        app_id=app_id,
    )


def require_scope(identity: DelegatedIdentity, scope: str) -> None:
    if scope not in identity.scopes:
        raise DelegationError(f"missing required scope {scope}")
