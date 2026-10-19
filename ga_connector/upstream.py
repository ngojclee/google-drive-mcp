from __future__ import annotations

import asyncio
from typing import Any

"""In-process adapter over the official `analytics-mcp` package
(analytics_mcp.coordinator). Calls are serialized through a single lock —
the underlying google-analytics-data/admin grpc clients are shared and the
upstream package keeps module-level state, so concurrent fan-out is kept
sequential per connector process. Scale horizontally with replicas."""


class UpstreamError(Exception):
    pass


class UnknownToolError(UpstreamError):
    pass


# Explicit tool -> scope classification. Unknown/unclassified tools deny by
# default: the connector refuses to advertise or invoke anything not in this
# map, so a new upstream tool can never leak through unscoped.
TOOL_SCOPES: dict[str, str] = {
    "get_account_summaries": "ga:read",
    "list_google_ads_links": "ga:read",
    "get_property_details": "ga:read",
    "list_property_annotations": "ga:read",
    "get_custom_dimensions_and_metrics": "ga:read",
    "run_report": "ga:read",
    "run_realtime_report": "ga:read",
    "run_funnel_report": "ga:read",
    "run_conversions_report": "ga:read",
}


class UpstreamGa:
    """Lazy, serialized proxy to analytics_mcp.coordinator."""

    def __init__(self, coordinator: Any | None = None) -> None:
        self._coordinator = coordinator
        self._lock = asyncio.Lock()
        self._tools_cache: list[Any] | None = None

    def _get_coordinator(self) -> Any:
        if self._coordinator is None:
            from analytics_mcp import coordinator  # deferred: imports grpc stack

            self._coordinator = coordinator
        return self._coordinator

    async def list_tools(self) -> list[Any]:
        async with self._lock:
            if self._tools_cache is None:
                coordinator = self._get_coordinator()
                upstream = await coordinator.list_tools()
                upstream_by_name = {t.name: t for t in upstream}
                # Advertise only classified tools, upstream schema verbatim.
                self._tools_cache = [
                    upstream_by_name[name]
                    for name in TOOL_SCOPES
                    if name in upstream_by_name
                ]
            return list(self._tools_cache)

    async def call(self, name: str, arguments: dict[str, Any]) -> list[Any]:
        if name not in TOOL_SCOPES:
            raise UnknownToolError(f"unknown tool: {name}")
        coordinator = self._get_coordinator()
        async with self._lock:
            result = await coordinator.call_mcp_tool(
                name, dict(arguments or {})
            )
        return result
