/** Counting semaphore with FIFO waiters and AbortSignal support. */
export class Semaphore {
  private waiters: { resolve: () => void; reject: (e: unknown) => void; signal?: AbortSignal; onAbort?: () => void }[] =
    [];
  private inUse = 0;

  constructor(private capacity: number) {
    if (capacity < 1) throw new Error('Semaphore capacity must be >= 1');
  }

  get available(): number {
    return Math.max(0, this.capacity - this.inUse);
  }

  get used(): number {
    return this.inUse;
  }

  get max(): number {
    return this.capacity;
  }

  /** Change capacity at runtime. Shrinking never interrupts current holders. */
  resize(capacity: number): void {
    this.capacity = Math.max(1, capacity);
    this.drain();
  }

  tryAcquire(): boolean {
    if (this.inUse < this.capacity) {
      this.inUse++;
      return true;
    }
    return false;
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.tryAcquire()) return Promise.resolve(this.releaser());
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: () => resolve(this.releaser()),
        reject,
        signal,
        onAbort: undefined as undefined | (() => void),
      };
      if (signal) {
        waiter.onAbort = () => {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          reject(abortError());
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inUse--;
      this.drain();
    };
  }

  private drain(): void {
    while (this.inUse < this.capacity && this.waiters.length > 0) {
      const w = this.waiters.shift()!;
      if (w.signal && w.onAbort) w.signal.removeEventListener('abort', w.onAbort);
      this.inUse++;
      w.resolve();
    }
  }
}

export function abortError(message = 'Operation aborted'): Error {
  const e = new Error(message);
  e.name = 'AbortError';
  return e;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || (err as { code?: string }).code === 'ABORT_ERR');
}

/** Sleep that rejects early when the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Combine several abort signals plus an optional timeout into one. */
export function combineSignals(signals: (AbortSignal | undefined)[], timeoutMs?: number): AbortSignal {
  const list = signals.filter((s): s is AbortSignal => !!s);
  if (timeoutMs !== undefined) list.push(AbortSignal.timeout(timeoutMs));
  return AbortSignal.any(list);
}

export const nowIso = (): string => new Date().toISOString();
