import { build } from 'esbuild';
await build({ entryPoints: ['src/connector/main.ts'], bundle: true, platform: 'node', target: 'node22', outfile: 'dist/connector.js', format: 'esm', packages: 'external' });
