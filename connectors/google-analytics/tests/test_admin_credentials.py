import json
import os
import stat
import tempfile
import unittest

from starlette.testclient import TestClient

from ga_connector.config import GaConnectorConfig
from ga_connector.server import _dashboard_signature, create_app
from ga_connector.upstream import UpstreamGa


class FakeCoordinator:
    async def list_tools(self):
        return []


def config(path: str) -> GaConnectorConfig:
    return GaConnectorConfig(
        mcp_bearer_token="b" * 40,
        hub_delegation_secret="c" * 40,
        hub_audience="google-analytics",
        private_mcp_url="https://ga-mcp.example.internal/mcp",
        bind_host="127.0.0.1",
        bind_port=3050,
        allowed_hosts=("testserver",),
        google_credentials_file=path,
        google_project_id="",
        management_token="d" * 40,
    )


def auth() -> dict[str, str]:
    return {"ga_connector_admin": _dashboard_signature("d" * 40)}


SA_KEY = json.dumps(
    {
        "type": "service_account",
        "project_id": "lnc-ga",
        "private_key": "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
        "client_email": "ga-connector@lnc-ga.iam.gserviceaccount.com",
    }
)


class AdminCredentialsTests(unittest.TestCase):
    def test_boots_without_credentials_and_reports_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = create_app(
                config(os.path.join(tmp, "secrets", "key.json")),
                UpstreamGa(FakeCoordinator()),
            )
            with TestClient(app) as client:
                status = client.get("/api/admin/status", cookies=auth()).json()
                self.assertFalse(status["credentials"]["present"])
                self.assertEqual(status["credentials"]["client_email"], "")

    def test_upload_requires_dashboard_auth_and_valid_service_account(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = create_app(
                config(os.path.join(tmp, "secrets", "key.json")),
                UpstreamGa(FakeCoordinator()),
            )
            with TestClient(app) as client:
                endpoint = "/api/admin/credentials"
                self.assertEqual(client.post(endpoint, content=SA_KEY).status_code, 401)
                bad = client.post(endpoint, content="{}", cookies=auth())
                self.assertEqual(bad.status_code, 400)
                self.assertIn("service_account", bad.json()["error"])
                junk = client.post(endpoint, content="not json", cookies=auth())
                self.assertEqual(junk.status_code, 400)
                oversized = client.post(
                    endpoint, content=" " * (2 * 1024 * 1024), cookies=auth()
                )
                self.assertEqual(oversized.status_code, 400)

    def test_valid_upload_writes_0600_and_status_shows_meta(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "secrets", "key.json")
            app = create_app(config(target), UpstreamGa(FakeCoordinator()))
            with TestClient(app) as client:
                response = client.post(
                    "/api/admin/credentials", content=SA_KEY, cookies=auth()
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.json()["client_email"],
                    "ga-connector@lnc-ga.iam.gserviceaccount.com",
                )
                self.assertTrue(os.path.isfile(target))
                if os.name == "posix":
                    mode = stat.S_IMODE(os.stat(target).st_mode)
                    self.assertEqual(mode, 0o600)
                status = client.get("/api/admin/status", cookies=auth()).json()
                self.assertTrue(status["credentials"]["present"])
                self.assertEqual(
                    status["credentials"]["project_id"], "lnc-ga"
                )


if __name__ == "__main__":
    unittest.main()
