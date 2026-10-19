import unittest

from starlette.testclient import TestClient

from ga_connector.config import GaConnectorConfig
from ga_connector.server import create_app
from ga_connector.upstream import UpstreamGa


class FakeCoordinator:
    async def list_tools(self):
        return []


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
