import assert from 'node:assert/strict';
import { describe, it, before, after, beforeEach } from 'node:test';
import { setupTestServer, callTool, type TestContext } from '../helpers/setup-server.js';

describe('Gmail tools', () => {
  let ctx: TestContext;
  before(async () => { ctx = await setupTestServer(); });
  after(async () => { await ctx.cleanup(); });
  beforeEach(() => { ctx.mocks.gmail.tracker.reset(); });

  it('forwards search pagination and fetches metadata only', async () => {
    const result = await callTool(ctx.client, 'searchGmailMessages', {
      query: 'newer_than:7d', maxResults: 2, pageToken: 'next',
    });
    assert.equal(result.isError, false);
    const payload = JSON.parse(result.content[0].text!);
    assert.equal(payload.messages[0].subject, 'A Gmail message');
    assert.equal(payload.messages[0].bodyText, undefined);
    const tracker = ctx.mocks.gmail.tracker;
    assert.deepEqual(tracker.getCalls('messages.list')[0].args[0], {
      userId: 'me', q: 'newer_than:7d', maxResults: 2, pageToken: 'next',
    });
    assert.equal(tracker.getCalls('messages.get')[0].args[0].format, 'metadata');
  });

  it('extracts nested plain text, skips attachments and truncates', async () => {
    const get = ctx.mocks.gmail.service.users.messages.get;
    get._setImpl(async () => ({ data: { payload: { parts: [
      { mimeType: 'text/plain', filename: 'private.txt', body: { data: Buffer.from('attachment').toString('base64url') } },
      { parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('x'.repeat(150)).toString('base64url') } }] },
    ] } } }));
    try {
      const result = await callTool(ctx.client, 'getGmailMessage', { messageId: 'one', maxBodyCharacters: 100 });
      assert.equal(result.isError, false);
      const payload = JSON.parse(result.content[0].text!);
      assert.equal(payload.bodyText, 'x'.repeat(100));
      assert.equal(payload.bodyTruncated, true);
    } finally { get._resetImpl(); }
  });

  it('lists draft metadata, never full bodies', async () => {
    const result = await callTool(ctx.client, 'listGmailDrafts', { pageToken: 'draft-next' });
    assert.equal(result.isError, false);
    assert.equal(JSON.parse(result.content[0].text!).drafts[0].draftId, 'draft-1');
    assert.equal(ctx.mocks.gmail.tracker.getCalls('drafts.get')[0].args[0].format, 'metadata');
  });

  it('creates MIME draft through drafts.create only, never send', async () => {
    const result = await callTool(ctx.client, 'createGmailDraft', {
      to: 'recipient@example.com', subject: 'Xin chào', bodyText: 'First\nSecond',
    });
    assert.equal(result.isError, false);
    const calls = ctx.mocks.gmail.tracker.calls;
    assert.deepEqual(calls.map(c => c.method), ['drafts.create']);
    const mime = Buffer.from(calls[0].args[0].requestBody.message.raw, 'base64url').toString('utf8');
    assert.match(mime, /Subject: =\?UTF-8\?B\?/);
    assert.equal(Buffer.from(mime.split('\r\n\r\n')[1], 'base64').toString(), 'First\r\nSecond');
  });

  it('rejects header injection and invalid page size before API calls', async () => {
    for (const [name, args] of [
      ['createGmailDraft', { to: 'a@example.com', subject: 'hello\r\nBcc: x@example.com', bodyText: 'x' }],
      ['searchGmailMessages', { query: 'x', maxResults: 21 }],
    ] as const) {
      assert.equal((await callTool(ctx.client, name, args)).isError, true);
    }
    assert.equal(ctx.mocks.gmail.tracker.calls.length, 0);
  });

  it('does not retry draft creation after an ambiguous network failure', async () => {
    const create = ctx.mocks.gmail.service.users.drafts.create;
    create._setImpl(async () => { throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }); });
    try {
      const result = await callTool(ctx.client, 'createGmailDraft', { to: 'a@example.com', subject: 'Hello', bodyText: 'Body' });
      assert.equal(result.isError, true);
      assert.equal(ctx.mocks.gmail.tracker.getCalls('drafts.create').length, 1);
    } finally { create._resetImpl(); }
  });

  it('refuses Gmail access for accounts without Gmail grants', async () => {
    const mod = await import('../../src/index.js');
    await mod._addSyntheticAccountForTesting('driveonly', {}, { scope: 'https://www.googleapis.com/auth/drive.file' });
    const result = await callTool(ctx.client, 'searchGmailMessages', { account: 'driveonly', query: 'x' });
    assert.equal(result.isError, true);
    assert.equal(ctx.mocks.gmail.tracker.calls.length, 0);
    assert.match(result.content[0].text!, /required scope/);
  });
});
