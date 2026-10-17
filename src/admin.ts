import express, { type Express } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat, lstat, copyFile, writeFile, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { AuthSystem } from './auth.js';
import type { AddAccountResult } from './types.js';
import { SCOPE_ALIASES, USERINFO_SCOPES } from './auth/scopes.js';
import { ALIAS_PATTERN } from './auth/types.js';
import { adminHtml } from './adminHtml.js';

interface Dependencies {
  getSystem: () => Promise<AuthSystem>;
  startConsent: (alias: string, scopes: readonly string[]) => Promise<AddAccountResult>;
}

export function validDesktopCredentials(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const installed = (value as Record<string, unknown>).installed;
  if (!installed || typeof installed !== 'object') return false;
  const keys = installed as Record<string, unknown>;
  return typeof keys.client_id === 'string' && keys.client_id.endsWith('.apps.googleusercontent.com') &&
    typeof keys.client_secret === 'string' && keys.client_secret.length > 0;
}

export function mountAdmin(app: Express, deps: Dependencies): void {
  const keyFile = process.env.MCP_ADMIN_KEY_FILE;
  if (!keyFile) return; // Opt-in; MCP credentials never authorize management.
  const sessions = new Map<string, number>();
  const attempts = new Map<string, { count: number; until: number }>();
  let pending: { state: string; alias: string; callbackPort?: number } | undefined;
  let active: AddAccountResult | undefined;
  let writing = false;
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    next();
  });
  router.get('/', (_req, res) => {
    const nonce = randomBytes(18).toString('base64');
    res.set('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
    res.type('html').send(adminHtml.split('__NONCE__').join(nonce));
  });
  // Custom header plus same-origin check prevents cross-site mutations on LAN HTTP.
  router.use((req, res, next) => {
    if (req.method !== 'GET' && (req.get('X-Admin-Request') !== '1' ||
      req.get('Origin') !== `${req.protocol}://${req.get('host')}`)) {
      res.status(403).json({ error: 'origin_rejected' }); return;
    }
    next();
  });
  router.use(express.json({ limit: '64kb' }));
  router.post('/login', async (req, res) => {
    const now = Date.now();
    for (const [ip, row] of attempts) if (row.until < now) attempts.delete(ip);
    for (const [id, expiry] of sessions) if (expiry < now) sessions.delete(id);
    const ip = req.ip ?? 'unknown';
    const row = attempts.get(ip) ?? { count: 0, until: now + 300000 };
    if (row.count >= 10 || attempts.size >= 1000 || sessions.size >= 100) {
      res.status(429).json({ error: 'login_rate_limited' }); return;
    }
    row.count++; attempts.set(ip, row);
    try {
      const expected = Buffer.from((await readFile(keyFile, 'utf8')).trim());
      const mcpToken = process.env.MCP_HTTP_BEARER_TOKEN_FILE
        ? (await readFile(process.env.MCP_HTTP_BEARER_TOKEN_FILE, 'utf8')).trim()
        : process.env.MCP_HTTP_BEARER_TOKEN;
      if (mcpToken && expected.toString() === mcpToken) {
        res.status(503).json({ error: 'separate_admin_key_required' }); return;
      }
      const supplied = Buffer.from(typeof req.body?.key === 'string' ? req.body.key : '');
      if (expected.length < 32 || supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) {
        res.status(401).json({ error: 'invalid_admin_key' }); return;
      }
      const id = randomBytes(32).toString('hex');
      sessions.set(id, now + 3600000);
      res.cookie('workspace_admin', id, { httpOnly: true, sameSite: 'strict', secure: req.secure,
        path: '/admin', maxAge: 3600000 });
      res.json({ ok: true });
    } catch { res.status(503).json({ error: 'admin_key_unavailable' }); }
  });
  router.use((req, res, next) => {
    const id = req.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('workspace_admin='))?.slice(16);
    if (!id || (sessions.get(id) ?? 0) <= Date.now()) {
      res.status(401).json({ error: 'admin_login_required' }); return;
    }
    res.locals.sessionId = id;
    next();
  });
  router.post('/logout', (_req, res) => {
    sessions.delete(res.locals.sessionId);
    res.clearCookie('workspace_admin', { path: '/admin' }).json({ ok: true });
  });
  router.get('/status', async (_req, res) => {
    try {
      const sys = await deps.getSystem();
      const files = await Promise.all([
        ['oauth', process.env.GOOGLE_DRIVE_OAUTH_CREDENTIALS],
        ['accounts', sys.store.getFilePath()], ['mcpBearer', process.env.MCP_HTTP_BEARER_TOKEN_FILE],
      ].map(async ([kind, path]) => {
        try { const s = await stat(path ?? ''); return { kind, path, present: true, bytes: s.size, modifiedAt: s.mtime.toISOString() }; }
        catch { return { kind, path, present: false }; }
      }));
      res.json({ access: {
        api: { configured: !!(process.env.MCP_HTTP_BEARER_TOKEN || process.env.MCP_HTTP_BEARER_TOKEN_FILE), source: 'environment', endpoint: '/mcp' },
        management: { configured: true, source: 'file', path: keyFile },
      }, settings: { resourcesDisabled: process.env.GOOGLE_DRIVE_MCP_DISABLE_RESOURCES === '1' || process.argv.includes('--no-resources'),
        allowedHosts: process.env.MCP_HTTP_ALLOWED_HOSTS || '', callbackHost: '127.0.0.1' },
      accounts: sys.store.list().map(a => ({ alias: a.alias, email: a.email,
        pendingIdentity: !!a.pendingIdentity, scopes: a.scope.split(/\s+/),
        isDefault: sys.store.getDefault() === a.alias, hasRefreshToken: !!a.refreshToken,
        expiryDate: a.expiryDate })), files, consent: pending ?? null });
    } catch { res.status(503).json({ error: 'account_store_unavailable' }); }
  });
  router.post('/credentials', async (req, res) => {
    if (!validDesktopCredentials(req.body)) { res.status(400).json({ error: 'desktop_oauth_json_required' }); return; }
    const path = process.env.GOOGLE_DRIVE_OAUTH_CREDENTIALS;
    if (!path) { res.status(503).json({ error: 'oauth_path_not_configured' }); return; }
    if (writing || active) { res.status(409).json({ error: 'configuration_busy' }); return; }
    writing = true;
    const tmp = `${path}.tmp-${randomBytes(8).toString('hex')}`;
    try {
      try {
        const s = await lstat(path);
        if (!s.isFile() || s.isSymbolicLink()) throw new Error('unsafe_path');
        await copyFile(path, `${path}.bak-${Date.now()}`, constants.COPYFILE_EXCL);
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      await writeFile(tmp, JSON.stringify(req.body), { mode: 0o600, flag: 'wx' });
      await rename(tmp, path);
      res.json({ ok: true });
    } catch { res.status(500).json({ error: 'credentials_write_failed' }); }
    finally { writing = false; await unlink(tmp).catch(() => undefined); }
  });
  router.post('/consent', async (req, res) => {
    const { alias, gmail } = req.body ?? {};
    if (typeof alias !== 'string' || !ALIAS_PATTERN.test(alias) || !['read', 'drafts'].includes(gmail)) {
      res.status(400).json({ error: 'invalid_consent_request' }); return;
    }
    if (active || writing || pending?.state === 'starting') { res.status(409).json({ error: 'consent_busy' }); return; }
    pending = { state: 'starting', alias };
    try {
      const sys = await deps.getSystem();
      const scopes = [...new Set([...(sys.store.get(alias)?.scope.split(/\s+/).filter(Boolean) ??
        ['drive.file', 'documents', 'spreadsheets', 'presentations'].map(s => SCOPE_ALIASES[s])),
        SCOPE_ALIASES['gmail.readonly'], ...(gmail === 'drafts' ? [SCOPE_ALIASES['gmail.compose']] : []), ...USERINFO_SCOPES])];
      const flow = await deps.startConsent(alias, scopes);
      active = flow;
      pending = { state: 'waiting', alias, callbackPort: flow.callbackPort };
      const timer = setTimeout(() => {
        if (active === flow) { active = undefined; pending = { state: 'expired', alias }; void flow.cancel(); }
      }, 600000);
      timer.unref();
      flow.completion.then(() => {
        if (active === flow) pending = { state: 'completed', alias };
      }, () => { if (active === flow) pending = { state: 'failed', alias }; }).finally(() => {
        clearTimeout(timer); if (active === flow) active = undefined;
      });
      res.json({ authUrl: flow.authUrl, callbackPort: flow.callbackPort });
    } catch { pending = { state: 'failed', alias }; res.status(500).json({ error: 'consent_start_failed' }); }
  });
  router.post('/consent/cancel', async (_req, res) => {
    const flow = active;
    if (pending?.state === 'starting') { res.status(409).json({ error: 'consent_starting' }); return; }
    active = undefined;
    if (flow) await flow.cancel();
    pending = undefined;
    res.json({ ok: true });
  });
  router.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: 'invalid_admin_request' });
  });
  app.use('/admin', router);
}
