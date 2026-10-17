import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdminKey } from '../src/adminKey.js';

test('bootstrap once, rotation persists, changed env ignored, corrupted store fails closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'admin-key-'));
  const path = join(dir, 'key.json');
  const a = 'A'.repeat(48), b = 'B'.repeat(48), c = 'C'.repeat(48);
  try {
    const store = new AdminKey(path, a);
    assert.equal(await store.verify(a), true);
    await assert.rejects(store.rotate('wrong', b));
    await store.rotate(a, b);
    assert.equal(await store.verify(a), false);
    const restarted = new AdminKey(path, c);
    assert.equal(await restarted.verify(b), true);
    assert.equal(await restarted.verify(c), false);
    assert.equal(await new AdminKey(path, '').verify(b), true);
    const text = await readFile(path, 'utf8');
    for (const secret of [a,b,c]) assert.equal(text.includes(secret), false);
    await writeFile(path, '{}');
    await assert.rejects(new AdminKey(path, c).verify(c));
    await assert.rejects(new AdminKey(join(dir, 'missing.json'), '').verify(''));
  } finally { await rm(dir, {recursive:true,force:true}); }
});
