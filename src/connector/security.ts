import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { scopes as allowedScopes } from './policy.js';

export function equal(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

export function verifier(token: string, secret: string, audience: string, capacity = 10000) {
  const nonces = new Map<string, number>();
  return (headers: IncomingHttpHeaders, now = Math.floor(Date.now() / 1000)) => {
    const get = (name: string): string => {
      const value = headers[name];
      if (typeof value !== 'string' || value.length > 1024) throw new Error('unauthorized');
      return value.trim();
    };
    if (!equal(get('authorization'), `Bearer ${token}`)) throw new Error('unauthorized');
    const client = get('x-mcp-hub-client-id');
    const app = headers['x-mcp-hub-app-id'] === undefined ? undefined : get('x-mcp-hub-app-id');
    const timestamp = get('x-mcp-hub-client-timestamp');
    const nonce = get('x-mcp-hub-client-nonce');
    const signature = get('x-mcp-hub-client-signature').toLowerCase();
    const scopes = [...new Set(get('x-mcp-hub-client-scopes').split(',').map(s => s.trim()).filter(Boolean))].sort();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/.test(client) ||
        (app !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(app)) ||
        !/^\d{1,12}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 90 ||
        !/^[A-Za-z0-9_-]{20,128}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature) ||
        !scopes.length || scopes.some(s => !(allowedScopes as readonly string[]).includes(s))) throw new Error('unauthorized');
    const parts = app === undefined ? ['v3', audience, client] : ['v4', audience, client, app];
    const expected = createHmac('sha256', secret).update([...parts, String(Number(timestamp)), nonce, scopes.join(',')].join('\n')).digest('hex');
    if (!equal(signature, expected)) throw new Error('unauthorized');
    for (const [key, expires] of nonces) if (expires < now) nonces.delete(key);
    // Keep future-skew signatures until their final valid second; capacity fails closed.
    if (nonces.has(nonce) || nonces.size >= capacity) throw new Error('unauthorized');
    nonces.set(nonce, Number(timestamp) + 90);
    return { client, app, scopes };
  };
}
