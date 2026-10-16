import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createHttpApp, _setAuthClientForTesting } from '../../src/index.js';

test('remote single-identity HTTP requires host allowlist and bearer', async () => {
  assert.throws(() => createHttpApp('0.0.0.0'), /at least 32 bytes/);
  assert.throws(() => createHttpApp('0.0.0.0', { bearerToken: 'x'.repeat(64) }), /MCP_HTTP_ALLOWED_HOSTS/);
  const dir = await mkdtemp(join(tmpdir(), 'mcp-bearer-'));
  const tokenPath = join(dir, 'bearer');
  await writeFile(tokenPath, 'x'.repeat(64) + '\n');
  process.env.MCP_HTTP_BEARER_TOKEN_FILE = tokenPath;
  try {
    assert.throws(() => createHttpApp('0.0.0.0', { bearerToken: 'y'.repeat(64) }), /only one/);
    _setAuthClientForTesting({});
    const { app, sessions } = createHttpApp('0.0.0.0', { allowedHosts: ['10.21.4.101'] });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}`;
    try {
      assert.equal((await fetch(`${url}/healthz`)).status, 200);
      for (const method of ['GET', 'POST', 'DELETE']) {
        for (const authorization of ['', 'Bearer wrong']) {
          const res = await fetch(`${url}/mcp`, { method, headers: { Authorization: authorization } });
          assert.equal(res.status, 401);
          await res.text();
        }
      }
      const badHostStatus = await new Promise<number>((resolve, reject) => {
        const req = http.request(`${url}/mcp`, { headers: { Host: 'evil.example', Authorization: `Bearer ${'x'.repeat(64)}` } }, res => {
          res.resume();
          resolve(res.statusCode!);
        });
        req.on('error', reject);
        req.end();
      });
      assert.equal(badHostStatus, 403);
      const res = await fetch(`${url}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${'x'.repeat(64)}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
      });
      assert.equal(res.status, 200);
      assert.ok(res.headers.get('mcp-session-id'));
      await res.text();
    } finally {
      for (const session of sessions.values()) {
        await session.transport.close();
        await session.server.close();
      }
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  } finally {
    delete process.env.MCP_HTTP_BEARER_TOKEN_FILE;
    await rm(dir, { recursive: true, force: true });
  }
});
