import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename, unlink, lstat, link } from 'node:fs/promises';

interface RecordKey { version: number; salt: string; hash: string; createdAt: string }
export class AdminKey {
  private pending = Promise.resolve();
  private initialized = false;
  constructor(private path: string, private bootstrap: string) {}
  private encode(key: string): RecordKey {
    if (key.length < 32 || key.length > 256) throw new Error('key_length');
    const salt = randomBytes(32).toString('hex');
    return { version: 1, salt, hash: scryptSync(key, salt, 32).toString('hex'), createdAt: new Date().toISOString() };
  }
  private async load(): Promise<RecordKey> {
    try {
      const s = await lstat(this.path);
      if (!s.isFile() || s.isSymbolicLink()) throw new Error('unsafe_store');
      const row = JSON.parse(await readFile(this.path, 'utf8')) as RecordKey;
      if (row.version !== 1 || !/^[a-f0-9]{64}$/.test(row.salt) || !/^[a-f0-9]{64}$/.test(row.hash) || typeof row.createdAt !== 'string') throw new Error('invalid_store');
      this.initialized = true;
      return row;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (this.initialized) throw new Error('store_disappeared');
      // Only absence bootstraps. Corruption/permissions never restore an old key.
      const row = this.encode(this.bootstrap);
      const tmp = `${this.path}.tmp-${randomBytes(12).toString('hex')}`;
      try {
        await writeFile(tmp, JSON.stringify(row), { flag: 'wx', mode: 0o600 });
        try { await link(tmp, this.path); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      } finally { await unlink(tmp).catch(() => {}); }
      return this.load();
    }
  }
  async verify(key: string): Promise<boolean> {
    const row = await this.load();
    if (key.length > 256) return false;
    return timingSafeEqual(scryptSync(key, row.salt, 32), Buffer.from(row.hash, 'hex'));
  }
  async inventory() {
    const row = await this.load();
    return { configured: true, source: 'runtime', path: this.path, createdAt: row.createdAt, bootstrapIgnored: !!this.bootstrap };
  }
  async rotate(current: string, replacement: string): Promise<void> {
    const task = this.pending.then(async () => {
      if (!await this.verify(current)) throw new Error('invalid_current_key');
      const row = this.encode(replacement);
      const tmp = `${this.path}.tmp-${randomBytes(12).toString('hex')}`;
      try {
        await writeFile(tmp, JSON.stringify(row), { flag: 'wx', mode: 0o600 });
        await rename(tmp, this.path);
      } finally { await unlink(tmp).catch(() => {}); }
    });
    this.pending = task.catch(() => {});
    return task;
  }
}
