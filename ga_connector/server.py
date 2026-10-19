from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from mcp.server import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.types import Tool
from starlette.applications import Starlette
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse
from starlette.routing import Mount, Route

from ga_connector import __version__
from ga_connector.config import GaConnectorConfig
from ga_connector.delegation import (
    DelegatedIdentity,
    DelegationError,
    NonceReplayStore,
    require_scope,
    verify_delegation_headers,
)
from ga_connector.upstream import TOOL_SCOPES, UnknownToolError, UpstreamGa

def _identity_from_request(
    request: Request,
    config: GaConnectorConfig,
    replay_store: NonceReplayStore,
) -> DelegatedIdentity:
    identity = verify_delegation_headers(
        headers=request.headers,
        secret=config.hub_delegation_secret,
        audience=config.hub_audience,
        replay_store=replay_store,
    )
    # Optional app binding: when the Hub pins a connector record to an app id,
    # require the signed envelope to carry it.
    return identity


def create_app(
    config: GaConnectorConfig,
    upstream: UpstreamGa | None = None,
) -> Starlette:
    upstream = upstream or UpstreamGa()
    mcp_server: Server = Server(f"ga-connector/{__version__}")
    replay_store = NonceReplayStore()

    @mcp_server.list_tools()
    async def _list_tools() -> list[Tool]:
        # tools/list is identity-checked too — a caller without a valid
        # delegation envelope gets an empty surface, not the catalog.
        request = mcp_server.request_context.request
        identity = _identity_from_request(request, config, replay_store)
        require_scope(identity, "ga:read")
        return await upstream.list_tools()

    @mcp_server.call_tool(validate_input=False)
    async def _call_tool(name: str, arguments: dict[str, Any]) -> list[Any]:
        request = mcp_server.request_context.request
        if name not in TOOL_SCOPES:
            raise UnknownToolError(f"unknown tool: {name}")
        identity = _identity_from_request(request, config, replay_store)
        require_scope(identity, TOOL_SCOPES[name])
        return await upstream.call(name, arguments)

    session_manager = StreamableHTTPSessionManager(
        app=mcp_server,
        event_store=None,
        json_response=True,
        stateless=True,
    )

    async def health(_: Request) -> JSONResponse:
        return JSONResponse({"ok": True, "service": "ga-connector", "version": __version__})

    async def mcp_endpoint(scope: Any, receive: Any, send: Any) -> None:
        request = Request(scope)
        auth = request.headers.get("authorization", "")
        if auth != f"Bearer {config.mcp_bearer_token}":
            response = JSONResponse({"error": "unauthorized"}, status_code=401)
            await response(scope, receive, send)
            return
        await session_manager.handle_request(scope, receive, send)

    @asynccontextmanager
    async def lifespan(_: Any):
        async with session_manager.run():
            yield

    routes = [
        Route("/health", health, methods=["GET"]),
        Route("/healthz", health, methods=["GET"]),
        Mount("/mcp", app=mcp_endpoint),
    ]
    app = Starlette(routes=routes, lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(config.allowed_hosts))
    return app
