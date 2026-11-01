import type { PendingTask } from '../db/repositories/runs.js';

/**
 * In-memory window of pending tasks, bucketed by domain and served
 * round-robin. A throttled domain is skipped instead of blocking the queue,
 * so one large domain cannot starve the others.
 */
export class TaskQueue {
  private readonly buckets = new Map<string, PendingTask[]>();
  private order: string[] = [];
  private cursor = 0;
  private count = 0;

  get size(): number {
    return this.count;
  }

  push(task: PendingTask): void {
    let b = this.buckets.get(task.domain);
    if (!b) {
      b = [];
      this.buckets.set(task.domain, b);
      this.order.push(task.domain);
    }
    b.push(task);
    this.count++;
  }

  /** Put a task back at the front of its domain bucket (e.g. a retry). */
  unshift(task: PendingTask): void {
    this.push(task);
    const b = this.buckets.get(task.domain)!;
    b.unshift(b.pop()!);
  }

  /**
   * Returns the next runnable task, visiting domains round-robin.
   * `canRun` decides per task (domain limits, engine slots).
   */
  next(canRun: (t: PendingTask) => boolean): PendingTask | null {
    const n = this.order.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.cursor + i) % n;
      const domain = this.order[idx]!;
      const bucket = this.buckets.get(domain)!;
      // Look a little past the head so a busy engine type does not block other work for the domain.
      const look = Math.min(bucket.length, 8);
      for (let j = 0; j < look; j++) {
        const t = bucket[j]!;
        if (!canRun(t)) continue;
        bucket.splice(j, 1);
        this.count--;
        if (bucket.length === 0) {
          this.buckets.delete(domain);
          this.order.splice(idx, 1);
          this.cursor = this.order.length ? idx % this.order.length : 0;
        } else {
          this.cursor = (idx + 1) % this.order.length;
        }
        return t;
      }
    }
    return null;
  }

  domains(): string[] {
    return [...this.order];
  }

  clear(): PendingTask[] {
    const all = [...this.buckets.values()].flat();
    this.buckets.clear();
    this.order = [];
    this.cursor = 0;
    this.count = 0;
    return all;
  }
}
