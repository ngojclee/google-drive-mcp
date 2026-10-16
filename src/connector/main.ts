import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { connector } from './server.js';

function secret(name: string): string {
  const file = process.env[`${name}_FILE`];
  const value = (file ? readFileSync(file, 'utf8') : process.env[name])?.trim();
  if (!value || value.length < 32) throw new Error(`Missing or short ${name}`);
  return value;
}
try {
  const app = connector({
    token: secret('GOOGLE_CONNECTOR_PAIRING_TOKEN'),
    secret: secret('GOOGLE_CONNECTOR_DELEGATION_SECRET'),
    upstreamToken: secret('GOOGLE_CONNECTOR_UPSTREAM_TOKEN'),
    audience: 'google-workspace',
    upstream: process.env.GOOGLE_CONNECTOR_UPSTREAM_URL || 'http://google-drive-mcp:3110/mcp',
    account: process.env.GOOGLE_CONNECTOR_ACCOUNT || '',
    audit: event => console.log(JSON.stringify(event)),
  });
  const server = createServer({
    cert: readFileSync(process.env.GOOGLE_CONNECTOR_TLS_CERT || '/tls/server.crt'),
    key: readFileSync(process.env.GOOGLE_CONNECTOR_TLS_KEY || '/tls/server.key'),
    minVersion: 'TLSv1.2', requestTimeout: 150000, headersTimeout: 15000,
  }, app);
  server.maxConnections = 64;
  server.listen(3443, '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
} catch { console.error('Connector startup failed; check credentials and TLS files'); process.exit(1); }
