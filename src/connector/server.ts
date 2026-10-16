import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { authorized } from './policy.js';
import { verifier } from './security.js';

export interface Config {
  token: string; secret: string; audience: string; upstream: string; upstreamToken: string; account: string;
  audit?: (event: { caller: string; tool: string; outcome: string }) => void;
}

export function connector(config: Config) {
  if (!config.token || !config.secret || !config.upstreamToken || !config.account || !config.audience || new Set([config.token, config.secret, config.upstreamToken]).size !== 3) throw new Error('distinct credentials and pinned account required');
  const url = new URL(config.upstream);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('invalid upstream URL');
  const verify = verifier(config.token, config.secret, config.audience);
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ status: 'ok', app: 'google-workspace', version: '1.0.0' }));
  let active = 0;
  app.all('/mcp', (req, res, next) => {
    try { res.locals.identity = verify(req.headers); } catch { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (req.headers['mcp-session-id'] !== undefined) { res.status(400).json({ error: 'Sessions are not accepted' }); return; }
    // Stateless JSON responses need no persistent GET stream or DELETE session.
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).end(); return; }
    if (active >= 8) { res.status(503).json({ error: 'Connector busy' }); return; }
    active++;
    res.once('close', () => { active--; });
    next();
  }, express.json({ limit: '2mb' }), async (req, res) => {
    const identity = res.locals.identity as ReturnType<ReturnType<typeof verifier>>;
    const server = new Server({ name: 'google-workspace', version: '1.0.0' }, { capabilities: { tools: {} } });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const clients = new Set<Client>();
    const upstream = async <T>(fn: (client: Client) => Promise<T>) => {
      const client = new Client({ name: 'google-workspace-connector', version: '1.0.0' });
      const upstreamTransport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${config.upstreamToken}` }, redirect: 'error', signal: AbortSignal.timeout(135000) },
      });
      clients.add(client);
      try {
        await client.connect(upstreamTransport, { timeout: 15000 });
        return await fn(client);
      } finally {
        await upstreamTransport.terminateSession().catch(() => {});
        await client.close().catch(() => {}); clients.delete(client);
      }
    };
    const audit = (tool: string, outcome: string) => config.audit?.({ caller: identity.client, tool, outcome });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      try {
        return await upstream(async client => {
          const tools = [];
          let cursor: string | undefined;
          const seen = new Set<string>();
          do {
            const page = await client.listTools({ cursor }, { timeout: 15000 });
            for (const tool of page.tools) if (authorized(tool.name, identity.scopes)) {
              const properties = { ...tool.inputSchema.properties };
              delete properties.account;
              if (tool.name === 'uploadFile') delete properties.localPath;
              tools.push({ ...tool, inputSchema: { ...tool.inputSchema, properties } });
            }
            cursor = page.nextCursor;
            if (cursor && (seen.has(cursor) || seen.size >= 20)) throw new Error('invalid pagination');
            if (cursor) seen.add(cursor);
          } while (cursor);
          audit('tools/list', 'ok');
          return { tools };
        });
      } catch { audit('tools/list', 'failed'); throw new Error('Upstream discovery failed'); }
    });
    server.setRequestHandler(CallToolRequestSchema, async request => {
      const { name, arguments: args = {} } = request.params;
      if (!authorized(name, identity.scopes, args)) {
        audit('tools/call', 'denied');
        return { isError: true, content: [{ type: 'text', text: 'Unknown or unauthorized MCP tool' }] };
      }
      try {
        const result = await upstream(client => client.callTool({ name, arguments: { ...args, account: config.account } }, undefined, { timeout: 120000 }));
        if (result.isError) throw new Error('upstream rejected');
        // Never forward upstream exception text or credential material.
        const serialized = JSON.stringify(result);
        if ([config.token, config.secret, config.upstreamToken].some(s => serialized.includes(s)) || /(?:access_token|refresh_token|client_secret|private_key)\s*\\?"?\s*[:=]/i.test(serialized)) throw new Error('secret in response');
        audit(name, 'ok');
        return result;
      } catch {
        audit(name, 'failed');
        return { isError: true, content: [{ type: 'text', text: 'Google MCP operation failed' }] };
      }
    });
    res.once('close', () => {
      void server.close().catch(() => {});
      for (const client of clients) void client.close().catch(() => {});
    });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ error: 'Connector request failed' }); }
  });
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: 'Invalid request' });
  });
  return app;
}
