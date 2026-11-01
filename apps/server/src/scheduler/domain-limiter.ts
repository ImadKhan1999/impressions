import { LIMITS } from '@impressions/shared';

export interface DomainLimits {
  requestsPerSecond: number;
  maxConcurrent: number;
}

interface DomainState {
  active: number;
  nextAllowedAt: number;
  lastUsed: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Re-applies the hard caps so a limiter can never be configured looser than allowed. */
export function clampLimits(l: DomainLimits): DomainLimits {
  return {
    requestsPerSecond: clamp(
      l.requestsPerSecond,
      LIMITS.requestsPerSecondPerDomain.min,
      LIMITS.requestsPerSecondPerDomain.max,
    ),
    maxConcurrent: Math.round(clamp(l.maxConcurrent, LIMITS.maxConcurrentPerDomain.min, LIMITS.maxConcurrentPerDomain.max)),
  };
}

/**
 * Process-wide per-domain limiter shared by every run, so two runs that hit
 * the same site never add up to more than the configured rate.
 *
 * Starts are spaced at least 1/rps seconds apart (no bursts), and at most
 * `maxConcurrent` tasks for a domain are in flight at once.
 */
export class DomainLimiter {
  private readonly domains = new Map<string, DomainState>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private state(domain: string): DomainState {
    let s = this.domains.get(domain);
    if (!s) {
      s = { active: 0, nextAllowedAt: 0, lastUsed: this.now() };
      this.domains.set(domain, s);
    }
    return s;
  }

  /** Milliseconds until `domain` may start another task (0 = now, Infinity = blocked on concurrency). */
  waitTime(domain: string, limits: DomainLimits): number {
    const l = clampLimits(limits);
    const s = this.domains.get(domain);
    if (!s) return 0;
    if (s.active >= l.maxConcurrent) return Number.POSITIVE_INFINITY;
    return Math.max(0, s.nextAllowedAt - this.now());
  }

  tryAcquire(domain: string, limits: DomainLimits): boolean {
    if (this.waitTime(domain, limits) > 0) return false;
    const l = clampLimits(limits);
    const s = this.state(domain);
    const now = this.now();
    s.active++;
    s.nextAllowedAt = now + 1000 / l.requestsPerSecond;
    s.lastUsed = now;
    return true;
  }

  release(domain: string): void {
    const s = this.domains.get(domain);
    if (!s) return;
    s.active = Math.max(0, s.active - 1);
    s.lastUsed = this.now();
    this.gc();
  }

  activeFor(domain: string): number {
    return this.domains.get(domain)?.active ?? 0;
  }

  /** Drop idle entries so memory stays bounded across millions of domains. */
  private gc(): void {
    if (this.domains.size < 5000) return;
    const cutoff = this.now() - 60_000;
    for (const [d, s] of this.domains) {
      if (s.active === 0 && s.lastUsed < cutoff && s.nextAllowedAt < this.now()) this.domains.delete(d);
    }
  }
}
