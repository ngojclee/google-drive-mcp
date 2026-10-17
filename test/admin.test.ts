import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mountAdmin, validDesktopCredentials } from '../src/admin.js';
import type { AuthSystem } from '../src/auth.js';

test('admin denies MCP bearer, rejects cross-origin login, authenticates cookie without secret disclosure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workspace-admin-'));
  const old = process.env.MCP_ADMIN_KEY_FILE;
  const key = 'admin-test-secret-'.repeat(4);
  process.env.MCP_ADMIN_KEY_FILE = join(dir, 'admin-key');
  await writeFile(process.env.MCP_ADMIN_KEY_FILE, key);
  const app = express();
  let unavailable = true;
  mountAdmin(app, {
    getSystem: async () => {
      if (unavailable) throw new Error('test unavailable');
      return { store: { list: () => [{ alias: 'default', email: 'demo@example.com', scope: 'gmail.readonly', refreshToken: 'never-return-this-token', expiryDate: 1 }],
        getDefault: () => 'default', getFilePath: () => join(dir, 'tokens.json') } } as unknown as AuthSystem;
    },
    startConsent: async () => { throw new Error('not called'); },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const denied = await fetch(`${url}/admin/status`, { headers: { Authorization: `Bearer ${key}` } });
    assert.equal(denied.status, 401);
    const cross = await fetch(`${url}/admin/login`, { method: 'POST', headers: {
      'Content-Type': 'application/json', Origin: 'http://attacker.invalid', 'X-Admin-Request': '1',
    }, body: JSON.stringify({ key }) });
    assert.equal(cross.status, 403);
    const login = await fetch(`${url}/admin/login`, { method: 'POST', headers: {
      'Content-Type': 'application/json', Origin: url, 'X-Admin-Request': '1',
    }, body: JSON.stringify({ key }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const status = await fetch(`${url}/admin/status`, { headers: { Cookie: cookie.split(';')[0] } });
    assert.equal(status.status, 503);
    assert.equal(await status.text(), '{"error":"account_store_unavailable"}');
    unavailable = false;
    const ok = await fetch(`${url}/admin/status`, { headers: { Cookie: cookie.split(';')[0] } });
    const payload = await ok.text();
    assert.equal(ok.status, 200);
    assert.equal(payload.includes('never-return-this-token'), false);
    assert.equal(payload.includes(key), false);
    assert.equal(JSON.parse(payload).access.management.source, 'file');
    assert.equal(JSON.parse(payload).accounts[0].hasRefreshToken, true);
    const html = await (await fetch(`${url}/admin/`)).text();
    for (const tab of ['accounts', 'oauth', 'access', 'settings']) assert.ok(html.includes(`data-page="${tab}"`));
    assert.ok(!html.includes('__NONCE__'));
    assert.equal(validDesktopCredentials({ installed: { client_id: 'x.apps.googleusercontent.com', client_secret: 'test' } }), true);
    assert.equal(validDesktopCredentials({ web: { client_id: 'x' } }), false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (old === undefined) delete process.env.MCP_ADMIN_KEY_FILE; else process.env.MCP_ADMIN_KEY_FILE = old;
    await rm(dir, { recursive: true, force: true });
  }
});
