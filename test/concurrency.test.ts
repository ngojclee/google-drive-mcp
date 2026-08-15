import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  ToolConcurrencyLimiter,
  ToolQueueOverloadedError,
  ToolQueueTimeoutError,
} from '../src/utils/concurrency.js';

test('runs no more than the configured number of tasks concurrently', async () => {
  const limiter = new ToolConcurrencyLimiter(8, 20, 1_000);
  let active = 0;
  let peak = 0;

  await Promise.all(Array.from({ length: 20 }, (_, index) => limiter.run(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await delay(10 + (index % 3));
    active -= 1;
  })));

  assert.equal(peak, 8);
  assert.equal(limiter.inFlight, 0);
  assert.equal(limiter.queued, 0);
});

test('rejects immediately when the bounded queue is full', async () => {
  const limiter = new ToolConcurrencyLimiter(1, 1, 1_000);
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });

  const first = limiter.run(async () => blocker);
  const second = limiter.run(async () => 'queued');
  await assert.rejects(
    limiter.run(async () => 'overflow'),
    ToolQueueOverloadedError,
  );

  release();
  await first;
  assert.equal(await second, 'queued');
});

test('times out a queued task without consuming a worker slot', async () => {
  const limiter = new ToolConcurrencyLimiter(1, 2, 20);
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });

  const first = limiter.run(async () => blocker);
  await assert.rejects(
    limiter.run(async () => 'late'),
    ToolQueueTimeoutError,
  );

  release();
  await first;
  assert.equal(limiter.inFlight, 0);
  assert.equal(limiter.queued, 0);
});
