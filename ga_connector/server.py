from __future__ import annotations

from contextlib import asynccontextmanager
import hashlib
import hmac
import json
import os
from typing import Any

from mcp.server import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.types import Tool
from starlette.applications import Starlette
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse
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
from ga_connector.upstream import (
    TOOL_SCOPES,
    UnknownToolError,
    UpstreamError,
    UpstreamGa,
)

_DASHBOARD_COOKIE = "ga_connector_admin"
_MAX_CREDENTIAL_BYTES = 1 * 1024 * 1024


def _dashboard_signature(token: str) -> str:
    return hmac.new(
        token.encode("utf-8"), b"ga-connector-dashboard-v1", hashlib.sha256
    ).hexdigest()


def _dashboard_authorized(request: Request, config: GaConnectorConfig) -> bool:
    return hmac.compare_digest(
        request.cookies.get(_DASHBOARD_COOKIE, ""),
        _dashboard_signature(config.management_token),
    )


def _credentials_meta(path: str) -> dict[str, Any]:
    """Non-secret metadata about the mounted service-account key."""
    meta: dict[str, Any] = {"present": False, "client_email": "", "project_id": ""}
    if not os.path.isfile(path):
        return meta
    meta["present"] = True
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        meta["client_email"] = str(data.get("client_email", ""))
        meta["project_id"] = str(data.get("project_id", ""))
    except (OSError, ValueError):
        meta["parse_error"] = True
    return meta


def _validate_service_account(payload: bytes) -> dict[str, Any]:
    """Parse an uploaded key; raises ValueError on anything invalid."""
    if not payload or len(payload) > _MAX_CREDENTIAL_BYTES:
        raise ValueError("empty or oversized payload")
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise ValueError("JSON object expected")
    if data.get("type") != "service_account":
        raise ValueError('expected a service_account key (type="service_account")')
    for field in ("client_email", "private_key", "project_id"):
        if not isinstance(data.get(field), str) or not data[field].strip():
            raise ValueError(f"missing field: {field}")
    return {"client_email": data["client_email"], "project_id": data["project_id"]}


_DASHBOARD_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Google Analytics Connector</title>
<style>body{margin:0;background:#f2f5f2;color:#18352a;font:16px Georgia,serif}.shell{max-width:800px;margin:8vh auto;padding:36px;background:#fffdf7;box-shadow:0 16px 50px #18352a20;border-top:6px solid #cf5b35}h1{margin-top:0}.card{padding:18px;margin:16px 0;background:#e8f0e8;border-left:4px solid #2f7053}code{background:#dbe9de;padding:2px 5px}button{background:#18352a;color:white;border:0;padding:10px 16px;cursor:pointer}.muted{color:#52675c}</style>
</head><body><main class="shell"><h1>Google Analytics Connector</h1>
<p class="muted">Read-only operator status. Runtime secrets stay in Portainer; this page cannot display or modify them.</p>
<div class="card" id="status">Loading connector status...</div>
<h2>Service-account key</h2>
<p class="muted">Upload the JSON key downloaded from Google Cloud. It is validated, stored on the host bind mount, and never echoed back — only the client email and project id are shown.</p>
<input type="file" id="keyfile" accept="application/json,.json"><button id="upload" disabled>Upload key</button><span class="muted" id="upmsg"></span>
<h2>Google access</h2><ol><li>Create a dedicated Google Cloud service account.</li><li>Enable GA Data API + GA Admin API.</li><li>Add its email as Viewer/Analyst in GA4 Property access management.</li><li>Upload the JSON key above.</li></ol>
<p><a href="/health">Public health check</a> · <a href="/admin/logout">Sign out</a></p>
</main><script>
const st=document.querySelector('#status'),fi=document.querySelector('#keyfile'),up=document.querySelector('#upload'),msg=document.querySelector('#upmsg');
function render(s){st.innerHTML='<b>Connector:</b> '+(s.ok?'ready':'not ready')+'<br><b>Credentials:</b> '+(s.credentials.present?'installed':'<span style="color:#a33">missing — upload below</span>')+(s.credentials.client_email?'<br><b>Client email:</b> <code>'+s.credentials.client_email+'</code><br><b>Project:</b> <code>'+s.credentials.project_id+'</code>':'')+(s.credentials.parse_error?'<br><b>Warning:</b> file present but not valid JSON':'')+'<br><b>Upstream tool catalog:</b> '+s.tool_count+' read-only GA4 tools';}
function load(){fetch('/api/admin/status').then(r=>r.json()).then(render).catch(()=>location='/admin/login');}
fi.onchange=()=>{up.disabled=!fi.files.length;msg.textContent='';};
up.onclick=()=>{const f=fi.files[0];if(!f)return;f.text().then(t=>fetch('/api/admin/credentials',{method:'POST',body:t})).then(async r=>{const j=await r.json().catch(()=>({error:'upload failed'}));if(r.ok){msg.textContent=' installed for '+j.client_email;load();}else{msg.textContent=' rejected: '+(j.error||r.status);}}).catch(e=>msg.textContent=' upload error');};
load();
</script></body></html>"""

_LOGIN_HTML = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connector login</title><style>body{background:#f2f5f2;font:16px Georgia,serif;color:#18352a}.box{max-width:360px;margin:20vh auto;background:#fffdf7;padding:32px;border-top:6px solid #cf5b35;box-shadow:0 16px 50px #18352a20}input,button{box-sizing:border-box;width:100%;padding:10px;margin:8px 0}button{border:0;background:#18352a;color:white}</style></head><body><form class="box" method="post"><h1>Operator login</h1><p>Use the Portainer <code>MANAGEMENT_TOKEN</code>.</p><input name="token" type="password" autocomplete="current-password" required autofocus><button>Open dashboard</button></form></body></html>"""

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
        if not os.path.isfile(config.google_credentials_file):
            raise UpstreamError(
                "google service account not configured; upload the key via /admin"
            )
        return await upstream.call(name, arguments)

    session_manager = StreamableHTTPSessionManager(
        app=mcp_server,
        event_store=None,
        json_response=True,
        stateless=True,
    )

    async def health(_: Request) -> JSONResponse:
        return JSONResponse({"ok": True, "service": "ga-connector", "version": __version__})

    async def admin_login(request: Request):
        if request.method == "GET":
            return HTMLResponse(_LOGIN_HTML)
        form = await request.form()
        if not hmac.compare_digest(str(form.get("token", "")), config.management_token):
            return HTMLResponse(_LOGIN_HTML, status_code=401)
        response = RedirectResponse("/admin", status_code=303)
        response.set_cookie(
            _DASHBOARD_COOKIE,
            _dashboard_signature(config.management_token),
            httponly=True,
            secure=True,
            samesite="strict",
            path="/",
        )
        return response

    async def admin_dashboard(request: Request):
        if not _dashboard_authorized(request, config):
            return RedirectResponse("/admin/login", status_code=303)
        return HTMLResponse(_DASHBOARD_HTML)

    async def admin_status(request: Request) -> JSONResponse:
        if not _dashboard_authorized(request, config):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return JSONResponse(
            {
                "ok": True,
                "credentials": _credentials_meta(config.google_credentials_file),
                "tool_count": len(TOOL_SCOPES),
            }
        )

    async def admin_credentials(request: Request) -> JSONResponse:
        if not _dashboard_authorized(request, config):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        payload = await request.body()
        try:
            meta = _validate_service_account(payload)
        except (ValueError, json.JSONDecodeError) as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        target = config.google_credentials_file
        try:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
        except OSError as exc:
            return JSONResponse({"error": f"cannot write key file: {exc}"},
                                status_code=500)
        return JSONResponse({"installed": True, **meta})

    async def admin_logout(_: Request):
        response = RedirectResponse("/admin/login", status_code=303)
        response.delete_cookie(_DASHBOARD_COOKIE, path="/")
        return response

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
        Route("/admin/login", admin_login, methods=["GET", "POST"]),
        Route("/admin", admin_dashboard, methods=["GET"]),
        Route("/admin/logout", admin_logout, methods=["GET"]),
        Route("/api/admin/status", admin_status, methods=["GET"]),
        Route("/api/admin/credentials", admin_credentials, methods=["POST"]),
        Mount("/mcp", app=mcp_endpoint),
    ]
    app = Starlette(routes=routes, lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(config.allowed_hosts))
    return app
