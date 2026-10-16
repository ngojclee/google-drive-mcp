import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as httpsServer, request as httpsRequest } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { verifier } from '../src/connector/security.js';
import { authorized, policy, blocked, scopes } from '../src/connector/policy.js';
import { connector } from '../src/connector/server.js';
import { TOOL_META } from '../src/tools/toolMeta.js';

const token = 'pairing-secret-for-synthetic-tests-only';
const secret = 'delegation-secret-for-synthetic-tests-only';
const upstreamToken = 'upstream-secret-for-synthetic-tests-only';
function signed(granted = 'workspace:read', client = 'alice', audience = 'google-workspace', timestamp = Math.floor(Date.now() / 1000), app?: string) {
  const nonce = randomBytes(20).toString('hex');
  const list = [...new Set(granted.split(',').map(s => s.trim()).filter(Boolean))].sort().join(',');
  const parts = app === undefined ? ['v3', audience, client] : ['v4', audience, client, app];
  return {
    authorization: `Bearer ${token}`, 'x-mcp-hub-client-id': client,
    'x-mcp-hub-client-scopes': granted, 'x-mcp-hub-client-timestamp': String(timestamp),
    'x-mcp-hub-client-nonce': nonce,
    'x-mcp-hub-client-signature': createHmac('sha256', secret).update([...parts, String(timestamp), nonce, list].join('\n')).digest('hex'),
    ...(app === undefined ? {} : { 'x-mcp-hub-app-id': app }),
  };
}

test('delegation v3/v4, normalization, auth, audience, expiry, replay and bounded capacity', () => {
  const verify = verifier(token, secret, 'google-workspace');
  assert.deepEqual(verify(signed('workspace:read,workspace:read')).scopes, ['workspace:read']);
  assert.equal(verify(signed('gmail:read', 'bob', 'google-workspace', undefined, 'mail-app')).app, 'mail-app');
  for (const h of [
    { ...signed(), authorization: 'Bearer wrong' },
    { ...signed(), 'x-mcp-hub-client-signature': '0'.repeat(64) },
    signed('workspace:read', 'alice', 'wrong'),
    signed('workspace:read', 'alice', undefined, Math.floor(Date.now() / 1000) - 91),
    signed('workspace:read', 'alice', undefined, Math.floor(Date.now() / 1000) + 91),
    signed('admin'), signed(''),
    { ...signed(), 'x-mcp-hub-app-id': 'injected' },
    { ...signed(), 'x-mcp-hub-app-id': '' },
    { ...signed(), 'x-mcp-hub-client-id': 'bad\nactor' },
  ]) assert.throws(() => verify(h), /unauthorized/);
  const v4 = signed('workspace:read', 'alice', undefined, undefined, 'mail-app');
  delete (v4 as Record<string, string>)['x-mcp-hub-app-id'];
  assert.throws(() => verify(v4));
  const replay = signed(); verify(replay); assert.throws(() => verify(replay));
  const now = Math.floor(Date.now() / 1000);
  const bounded = verifier(token, secret, 'google-workspace', 1);
  const future = signed('workspace:read', 'alice', undefined, now + 90);
  bounded(future, now);
  assert.throws(() => bounded(future, now + 179));
  assert.throws(() => bounded(signed(), now));
  bounded(signed('workspace:read', 'alice', undefined, now + 181), now + 181);
});

test('closed policy covers every actual tool, operations and account selection fail closed', () => {
  assert.deepEqual(Object.keys({ ...policy, ...blocked }).sort(), Object.keys(TOOL_META).sort());
  for (const name of Object.keys(blocked)) assert.equal(authorized(name, scopes, {}), false, name);
  assert.equal(authorized('futureTool', scopes, {}), false);
  assert.equal(authorized('__proto__', scopes, {}), false);
  assert.equal(authorized('createGmailDraft', ['gmail:read'], {}), false);
  assert.equal(authorized('uploadFile', ['workspace:write'], { localPath: '/config/tokens.json', contentBase64: 'YQ==' }), false);
  assert.equal(authorized('uploadFile', ['workspace:write'], { contentBase64: 'YQ==' }), true);
  assert.equal(authorized('setElementZOrder', ['workspace:write'], { operation: 'DELETE' }), false);
  for (const operation of ['BRING_TO_FRONT', 'BRING_FORWARD', 'SEND_BACKWARD', 'SEND_TO_BACK']) assert.equal(authorized('setElementZOrder', ['workspace:write'], { operation }), true);
  assert.equal(authorized('updateGoogleSheetIfUnchanged', ['workspace:read'], { dryRun: true }), false);
  assert.equal(authorized('replyToComment', ['workspace:read'], { resolve: true }), false);
  assert.equal(authorized('search', ['workspace:read'], { account: ['other'] }), false);
});

test('SDK protocol, scoped discovery, direct denial, session isolation, concurrent correlation and redaction', async () => {
  let calls = 0;
  const upstreamApp = express(); upstreamApp.use(express.json());
  upstreamApp.all('/mcp', async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${upstreamToken}`);
    assert.equal(req.headers['x-mcp-hub-client-id'], undefined);
    const s = new Server({ name: 'fake-google', version: '1' }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ['search', 'createGmailDraft', 'manage_accounts', 'futureTool'].map(name => ({ name, inputSchema: { type: 'object', properties: { account: { type: 'string' } } } })) }));
    s.setRequestHandler(CallToolRequestSchema, async request => {
      calls++;
      assert.equal(request.params.arguments?.account, 'pinned');
      if (request.params.arguments?.query === 'error') throw new Error(`${secret} ${upstreamToken}`);
      if (request.params.arguments?.query === 'secret') return { content: [{ type: 'text', text: `refresh_token: should-never-escape` }] };
      await new Promise(resolve => setTimeout(resolve, request.params.arguments?.query === 'slow' ? 50 : 1));
      return { content: [{ type: 'text', text: String(request.params.arguments?.query ?? request.params.name) }] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.once('close', () => { void s.close(); });
    await s.connect(transport); await transport.handleRequest(req, res, req.body);
  });
  const upstreamServer = createServer(upstreamApp);
  await new Promise<void>(resolve => upstreamServer.listen(0, '127.0.0.1', resolve));
  const address = upstreamServer.address() as { port: number };
  const audit: unknown[] = [];
  const app = connector({ token, secret, upstreamToken, upstream: `http://127.0.0.1:${address.port}/mcp`, audience: 'google-workspace', account: 'pinned', audit: e => audit.push(e) });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = new URL(`http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`);
  const clients: Client[] = [];
  const connect = async (granted: string, caller: string) => {
    const client = new Client({ name: caller, version: '1' }); clients.push(client);
    const transport = new StreamableHTTPClientTransport(url, {
      fetch: (input, init) => fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), ...signed(granted, caller) } }),
    });
    await client.connect(transport); return client;
  };
  try {
    const alice = await connect('workspace:read', 'alice');
    const bob = await connect('gmail:draft:create', 'bob');
    assert.deepEqual((await alice.listTools()).tools.map(t => t.name), ['search']);
    assert.deepEqual((await bob.listTools()).tools.map(t => t.name), ['createGmailDraft']);
    const denied = await alice.callTool({ name: 'createGmailDraft', arguments: {} });
    assert.equal(denied.isError, true); assert.equal(calls, 0);
    assert.equal((await alice.callTool({ name: 'manage_accounts', arguments: { action: 'list' } })).isError, true);
    const results = await Promise.all([
      alice.callTool({ name: 'search', arguments: { query: 'slow' } }),
      bob.callTool({ name: 'createGmailDraft', arguments: {} }),
      alice.callTool({ name: 'search', arguments: { query: 'fast' } }),
    ]);
    assert.deepEqual(results.map(r => (r.content as { text: string }[])[0].text), ['slow', 'createGmailDraft', 'fast']);
    const failure = await alice.callTool({ name: 'search', arguments: { query: 'error' } });
    assert.equal(failure.isError, true);
    const leaked = await alice.callTool({ name: 'search', arguments: { query: 'secret' } });
    assert.equal(leaked.isError, true);
    assert.equal(JSON.stringify(leaked).includes('should-never-escape'), false);
    const response = await fetch(url, { method: 'POST', headers: { ...signed(), 'mcp-session-id': 'other-caller-session', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 400);
    const replay = signed();
    assert.equal((await fetch(url, { method: 'GET', headers: { ...replay, accept: 'text/event-stream' } })).status, 405);
    assert.equal((await fetch(url, { method: 'GET', headers: replay })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { ...signed(), authorization: 'Bearer invalid' } })).status, 401);
    assert.equal((await fetch(new URL('/health', url))).status, 200);
    const text = JSON.stringify({ audit, failure });
    for (const forbidden of [token, secret, upstreamToken, 'slow', 'fast', 'signature', 'bodyText']) assert.equal(text.includes(forbidden), false);
    assert.ok(audit.some(e => JSON.stringify(e).includes('bob')));
  } finally {
    await Promise.all(clients.map(c => c.close()));
    await Promise.all([server, upstreamServer].map(s => new Promise<void>(resolve => { s.closeAllConnections(); s.close(() => resolve()); })));
  }
});

test('real TLS validates CA and SAN; incorrect CA or name fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'google-connector-tls-'));
  const openssl = process.env.OPENSSL_BIN || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const generate = (prefix: string, san: string) => execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, `${prefix}.key`), '-out', join(dir, `${prefix}.crt`), '-days', '1', '-subj', '/CN=localhost', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
  generate('server', 'DNS:localhost,IP:127.0.0.1'); generate('wrong', 'DNS:localhost');
  const server = httpsServer({ cert: readFileSync(join(dir, 'server.crt')), key: readFileSync(join(dir, 'server.key')) }, (_req, res) => res.end('ok'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const probe = (ca: Buffer, servername: string) => new Promise<string>((resolve, reject) => {
    const req = httpsRequest({ hostname: '127.0.0.1', port: (server.address() as { port: number }).port, ca, servername, agent: false }, res => { res.resume(); res.on('end', () => resolve('ok')); }); req.on('error', reject); req.end();
  });
  try {
    const ca = readFileSync(join(dir, 'server.crt'));
    assert.equal(await probe(ca, 'localhost'), 'ok');
    await assert.rejects(probe(readFileSync(join(dir, 'wrong.crt')), 'localhost'));
    await assert.rejects(probe(ca, 'wrong.example'));
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); rmSync(dir, { recursive: true, force: true }); }
});
