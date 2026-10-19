import hashlib
import hmac
import unittest

from ga_connector.delegation import (
    DelegationError,
    NonceReplayStore,
    canonical_delegation,
    verify_delegation_headers,
)


SECRET = "a" * 40
AUDIENCE = "google-analytics"
NOW = 1_700_000_000
NONCE = "A" * 24


def headers(*, scopes="ga:read", audience=AUDIENCE, nonce=NONCE, app_id=""):
    payload = canonical_delegation(
        audience=audience,
        client_id="codex-10-11-1-1",
        timestamp=NOW,
        nonce=nonce,
        scopes=scopes,
        app_id=app_id,
    )
    signature = hmac.new(SECRET.encode(), payload, hashlib.sha256).hexdigest()
    value = {
        "x-mcp-hub-client-id": "codex-10-11-1-1",
        "x-mcp-hub-client-scopes": scopes,
        "x-mcp-hub-client-timestamp": str(NOW),
        "x-mcp-hub-client-nonce": nonce,
        "x-mcp-hub-client-signature": signature,
    }
    if app_id:
        value["x-mcp-hub-app-id"] = app_id
    return value


class DelegationTests(unittest.TestCase):
    def test_valid_v3_is_accepted_once(self):
        replay = NonceReplayStore()
        identity = verify_delegation_headers(
            headers=headers(),
            secret=SECRET,
            audience=AUDIENCE,
            replay_store=replay,
            now=NOW,
        )
        self.assertEqual(identity.client_id, "codex-10-11-1-1")
        with self.assertRaisesRegex(DelegationError, "already"):
            verify_delegation_headers(
                headers=headers(),
                secret=SECRET,
                audience=AUDIENCE,
                replay_store=replay,
                now=NOW,
            )

    def test_wrong_audience_and_expiry_are_denied(self):
        with self.assertRaises(DelegationError):
            verify_delegation_headers(
                headers=headers(audience="wrong"),
                secret=SECRET,
                audience=AUDIENCE,
                now=NOW,
            )
        with self.assertRaisesRegex(DelegationError, "expired"):
            verify_delegation_headers(
                headers=headers(),
                secret=SECRET,
                audience=AUDIENCE,
                now=NOW + 91,
            )

    def test_v4_app_binding_is_signed(self):
        identity = verify_delegation_headers(
            headers=headers(app_id="analytics-app"),
            secret=SECRET,
            audience=AUDIENCE,
            now=NOW,
        )
        self.assertEqual(identity.app_id, "analytics-app")
        broken = headers(app_id="analytics-app")
        broken["x-mcp-hub-app-id"] = "different-app"
        with self.assertRaises(DelegationError):
            verify_delegation_headers(
                headers=broken, secret=SECRET, audience=AUDIENCE, now=NOW
            )
