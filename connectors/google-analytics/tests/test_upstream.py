import asyncio
import unittest

from ga_connector.admin_api import ADMIN_TOOLS
from ga_connector.upstream import TOOL_SCOPES, UnknownToolError, UpstreamGa


class FakeTool:
    def __init__(self, name):
        self.name = name


class FakeCoordinator:
    async def list_tools(self):
        return [FakeTool("get_account_summaries"), FakeTool("unclassified")]

    async def call_mcp_tool(self, name, arguments):
        return [{"name": name, "arguments": arguments}]


class UpstreamTests(unittest.TestCase):
    def test_unclassified_tools_are_hidden_and_denied(self):
        proxy = UpstreamGa(FakeCoordinator())
        tools = asyncio.run(proxy.list_tools())
        self.assertEqual(
            [tool.name for tool in tools],
            ["get_account_summaries"] + list(ADMIN_TOOLS),
        )
        with self.assertRaises(UnknownToolError):
            asyncio.run(proxy.call("unclassified", {}))

    def test_catalog_is_closed(self):
        self.assertEqual(set(TOOL_SCOPES), {
            "get_account_summaries",
            "list_google_ads_links",
            "get_property_details",
            "list_property_annotations",
            "get_custom_dimensions_and_metrics",
            "run_report",
            "run_realtime_report",
            "run_funnel_report",
            "run_conversions_report",
            *ADMIN_TOOLS,
        })
