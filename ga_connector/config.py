from __future__ import annotations

import os
import re
from dataclasses import dataclass

_PLACEHOLDER_MARKERS = (
    "replace-with",
    "change-me",
    "changeme",
    "example-token",
)
_AUDIENCE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:._-]{0,95}$")


def _required_secret(name: str) -> str:
    value = os.getenv(name, "").strip()
    if len(value) < 32 or any(
        marker in value.lower() for marker in _PLACEHOLDER_MARKERS
    ):
        raise RuntimeError(
            f"{name} must contain a distinct non-placeholder secret "
            "with at least 32 characters"
        )
    return value


def _required_value(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _audience(name: str, default: str) -> str:
    value = os.getenv(name, default).strip()
    if not _AUDIENCE_PATTERN.fullmatch(value):
        raise RuntimeError(f"{name} is invalid")
    return value


def _port(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    port = int(raw)
    if not (1 <= port <= 65535):
        raise RuntimeError(f"{name} is out of range")
    return port


def _csv(name: str) -> tuple[str, ...]:
    raw = os.getenv(name, "").strip()
    items = {p.strip() for p in raw.split(",") if p.strip()}
    if not items:
        raise RuntimeError(f"{name} is required (comma-separated hostnames)")
    # Loopback + container-internal names must always be allowed: the Docker
    # healthcheck and in-cluster probes hit 127.0.0.1/localhost, which are
    # never operator-facing hostnames.
    items.update({"127.0.0.1", "localhost", "::1"})
    return tuple(sorted(items))


@dataclass(frozen=True)
class GaConnectorConfig:
    mcp_bearer_token: str          # Hub -> connector bearer (POST/GET /mcp)
    hub_delegation_secret: str     # HMAC key for X-MCP-Hub-* envelope
    hub_audience: str              # audience bound into the signature
    private_mcp_url: str           # canonical HTTPS URL exposed to the Hub
    bind_host: str
    bind_port: int
    allowed_hosts: tuple[str, ...] # hostnames the service answers for
    google_credentials_file: str   # mounted service-account JSON
    google_project_id: str
    management_token: str          # protects the local operator dashboard

    @classmethod
    def from_env(cls) -> "GaConnectorConfig":
        # The file itself is optional at boot: the service starts in a
        # degraded state so the operator dashboard can upload it. Tool calls
        # are rejected until the file exists.
        creds = _required_value("GOOGLE_APPLICATION_CREDENTIALS")
        return cls(
            mcp_bearer_token=_required_secret("GA_MCP_BEARER_TOKEN"),
            hub_delegation_secret=_required_secret("GA_HUB_DELEGATION_SECRET"),
            hub_audience=_audience("GA_HUB_AUDIENCE", "google-analytics"),
            private_mcp_url=_required_value("GA_PRIVATE_MCP_URL"),
            bind_host=os.getenv("GA_BIND_HOST", "0.0.0.0").strip() or "0.0.0.0",
            bind_port=_port("GA_BIND_PORT", 3050),
            allowed_hosts=_csv("GA_ALLOWED_HOSTS"),
            google_credentials_file=creds,
            google_project_id=os.getenv("GOOGLE_PROJECT_ID", "").strip(),
            management_token=_required_secret("MANAGEMENT_TOKEN"),
        )
