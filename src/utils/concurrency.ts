export class ToolQueueOverloadedError extends Error {
  constructor(maxConcurrent: number, maxQueued: number) {
    super(
      `Server is busy: ${maxConcurrent} tool calls are running and the queue limit ` +
      `of ${maxQueued} has been reached. Retry shortly or reduce parallel requests.`,
    );
    this.name = 'ToolQueueOverloadedError';
  }
}

export class ToolQueueTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Server is busy: the tool call waited ${timeoutMs}ms for a worker slot. ` +
      `Retry shortly or reduce parallel requests.`,
    );
    this.name = 'ToolQueueTimeoutError';
  }
}

interface Waiter {
  enqueuedAt: number;
  resolve: (waitMs: number) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class ToolConcurrencyLimiter {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    readonly maxConcurrent: number,
    readonly maxQueued: number,
    readonly queueTimeoutMs: number,
  ) {}

  get inFlight(): number {
    return this.active;
  }

  get queued(): number {
    return this.queue.length;
  }

  async run<T>(task: (waitMs: number) => Promise<T>): Promise<T> {
    if (this.maxConcurrent === 0) {
      return task(0);
    }

    const waitMs = await this.acquire();
    try {
      return await task(waitMs);
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<number> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(0);
    }

    if (this.queue.length >= this.maxQueued) {
      return Promise.reject(new ToolQueueOverloadedError(this.maxConcurrent, this.maxQueued));
    }

    return new Promise<number>((resolve, reject) => {
      const waiter: Waiter = {
        enqueuedAt: Date.now(),
        resolve,
        reject,
      };

      if (this.queueTimeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new ToolQueueTimeoutError(this.queueTimeoutMs));
        }, this.queueTimeoutMs);
      }

      this.queue.push(waiter);
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const waiter = this.queue.shift();
    if (!waiter) return;

    if (waiter.timer) clearTimeout(waiter.timer);
    this.active += 1;
    waiter.resolve(Date.now() - waiter.enqueuedAt);
  }
}
