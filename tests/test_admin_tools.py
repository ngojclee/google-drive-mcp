import hashlib
import hmac
import json
import time
import unittest

from google.analytics import admin_v1beta
from starlette.testclient import TestClient

from ga_connector.admin_api import ADMIN_TOOLS, AdminToolError, invoke
from ga_connector.config import GaConnectorConfig
from ga_connector.delegation import canonical_delegation
from ga_connector.server import create_app
from ga_connector.upstream import TOOL_SCOPES, UpstreamGa


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
        management_token="d" * 40,
    )


def headers(nonce: str, scopes: str):
    timestamp = int(time.time())
    payload = canonical_delegation(
        audience="google-analytics",
        client_id="codex-10-11-1-1",
        timestamp=timestamp,
        nonce=nonce,
        scopes=scopes,
    )
    return {
        "authorization": "Bearer " + ("b" * 40),
        "content-type": "application/json",
        "accept": "application/json",
        "x-mcp-hub-client-id": "codex-10-11-1-1",
        "x-mcp-hub-client-scopes": scopes,
        "x-mcp-hub-client-timestamp": str(timestamp),
        "x-mcp-hub-client-nonce": nonce,
        "x-mcp-hub-client-signature": hmac.new(
            ("c" * 40).encode(), payload, hashlib.sha256
        ).hexdigest(),
    }


class FakeAdminClient:
    def list_key_events(self, request=None):
        assert request["parent"] == "properties/123"
        return iter(
            [
                admin_v1beta.KeyEvent(
                    name="properties/123/keyEvents/9", event_name="purchase"
                )
            ]
        )

    def boom(self, request=None):
        raise RuntimeError("backend exploded")


class FakeCoordinator:
    async def list_tools(self):
        return []


class AdminToolRegistryTests(unittest.TestCase):
    def test_all_admin_tools_are_scoped_and_schematized(self):
        self.assertTrue(ADMIN_TOOLS)
        for name, spec in ADMIN_TOOLS.items():
            self.assertIn(spec.scope, {"ga:write", "ga:admin"}, name)
            self.assertEqual(spec.input_schema["type"], "object", name)
            self.assertEqual(TOOL_SCOPES[name], spec.scope, name)

    def test_admin_and_upstream_names_do_not_collide(self):
        upstream_only = {
            "get_account_summaries",
            "run_report",
            "run_realtime_report",
            "run_funnel_report",
            "run_conversions_report",
        }
        self.assertTrue(upstream_only.isdisjoint(ADMIN_TOOLS))


class InvokeDispatchTests(unittest.TestCase):
    def test_invoke_serializes_pager_results(self):
        out = invoke(FakeAdminClient(), "list_key_events", {"property_id": "123"})
        self.assertEqual(out["key_events"][0]["event_name"], "purchase")

    def test_invoke_validates_property_id(self):
        with self.assertRaises(AdminToolError):
            invoke(
                FakeAdminClient(),
                "list_key_events",
                {"property_id": "../../etc"},
            )

    def test_invoke_requires_roles_for_access_binding(self):
        with self.assertRaises(AdminToolError):
            invoke(
                FakeAdminClient(),
                "create_access_binding",
                {"parent": "properties/123", "user": "a@b.c", "roles": []},
            )

    def test_invoke_wraps_upstream_errors(self):
        setattr(FakeAdminClient, "delete_key_event", FakeAdminClient.boom)
        try:
            with self.assertRaises(AdminToolError):
                invoke(FakeAdminClient(), "delete_key_event", {"name": "properties/1/keyEvents/2"})
        finally:
            delattr(FakeAdminClient, "delete_key_event")

    def test_upstream_call_routes_admin_tools(self):
        import asyncio

        upstream = UpstreamGa(FakeCoordinator(), admin_client=FakeAdminClient())
        out = asyncio.run(
            upstream.call("list_key_events", {"property_id": "123"})
        )
        self.assertIn("purchase", out[0].text)

    def test_upstream_call_rejects_unknown_tool(self):
        import asyncio

        upstream = UpstreamGa(FakeCoordinator(), admin_client=FakeAdminClient())
        with self.assertRaises(Exception):
            asyncio.run(upstream.call("delete_everything", {}))


class ScopeFilteredListingTests(unittest.TestCase):
    def _tool_names(self, client, scopes, nonce):
        response = client.post(
            "/mcp",
            headers=headers(nonce, scopes),
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
        )
        self.assertEqual(response.status_code, 200)
        return {t["name"] for t in response.json()["result"]["tools"]}

    def test_read_only_caller_sees_no_admin_tools(self):
        app = create_app(config(), UpstreamGa(FakeCoordinator(), FakeAdminClient()))
        with TestClient(app) as client:
            names = self._tool_names(client, "ga:read", "R" * 24)
            self.assertTrue(names.isdisjoint(ADMIN_TOOLS))

    def test_full_scope_caller_sees_admin_tools(self):
        app = create_app(config(), UpstreamGa(FakeCoordinator(), FakeAdminClient()))
        with TestClient(app) as client:
            names = self._tool_names(
                client, "ga:read,ga:write,ga:admin", "S" * 24
            )
            self.assertTrue(set(ADMIN_TOOLS).issubset(names))

    def test_write_only_grant_hides_admin_only_tools(self):
        app = create_app(config(), UpstreamGa(FakeCoordinator(), FakeAdminClient()))
        with TestClient(app) as client:
            names = self._tool_names(client, "ga:read,ga:write", "T" * 24)
            self.assertIn("create_key_event", names)
            self.assertNotIn("create_access_binding", names)

    def test_admin_tool_call_without_scope_is_denied(self):
        app = create_app(config(), UpstreamGa(FakeCoordinator(), FakeAdminClient()))
        with TestClient(app) as client:
            response = client.post(
                "/mcp",
                headers=headers("U" * 24, "ga:read"),
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": "list_key_events",
                        "arguments": {"property_id": "123"},
                    },
                },
            )
            body = json.dumps(response.json()).lower()
            self.assertIn("scope", body)


if __name__ == "__main__":
    unittest.main()
