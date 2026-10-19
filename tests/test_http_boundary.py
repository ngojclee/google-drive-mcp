import hashlib
import hmac
import time
import unittest

from starlette.testclient import TestClient

from ga_connector.config import GaConnectorConfig
from ga_connector.server import create_app
from ga_connector.upstream import UpstreamGa
from ga_connector.delegation import canonical_delegation


class FakeCoordinator:
    async def list_tools(self):
        return []


def headers(nonce: str):
    timestamp = int(time.time())
    payload = canonical_delegation(
        audience="google-analytics",
        client_id="codex-10-11-1-1",
        timestamp=timestamp,
        nonce=nonce,
        scopes="ga:read",
    )
    return {
        "authorization": "Bearer " + ("b" * 40),
        "content-type": "application/json",
        "accept": "application/json",
        "x-mcp-hub-client-id": "codex-10-11-1-1",
        "x-mcp-hub-client-scopes": "ga:read",
        "x-mcp-hub-client-timestamp": str(timestamp),
        "x-mcp-hub-client-nonce": nonce,
        "x-mcp-hub-client-signature": hmac.new(
            ("c" * 40).encode(), payload, hashlib.sha256
        ).hexdigest(),
    }


def config():
    return GaConnectorConfig(
        mcp_bearer_token="b" * 40,
        hub_delegation_secret="c" * 40,
        hub_audience="google-analytics",
        private_mcp_url="https://ga-mcp.example.internal/mcp",
        bind_host="127.0.0.1",
        bind_port=3050,
        allowed_hosts=("testserver",),
        google_credentials_file="/run/secrets/does-not-matter-in-this-test.json",
        google_project_id="",
    )


class HttpBoundaryTests(unittest.TestCase):
    def test_health_is_safe_and_mcp_requires_connector_bearer(self):
        app = create_app(config(), UpstreamGa(FakeCoordinator()))
        with TestClient(app) as client:
            health = client.get("/health")
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json()["service"], "ga-connector")
            denied = client.post("/mcp", json={})
            self.assertEqual(denied.status_code, 401)

    def test_scoped_tool_discovery_works(self):
        app = create_app(config(), UpstreamGa(FakeCoordinator()))
        with TestClient(app) as client:
            response = client.post(
                "/mcp",
                headers=headers("A" * 24),
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/list",
                    "params": {},
                },
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["result"]["tools"], [])
