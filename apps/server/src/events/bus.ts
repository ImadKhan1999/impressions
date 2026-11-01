import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@impressions/shared';

/** Typed in-process event bus. The SSE route fans these out to browsers. */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Each SSE client adds a listener; allow many dashboards to be open at once.
    this.emitter.setMaxListeners(1000);
  }

  emit(event: ServerEvent): void {
    this.emitter.emit('event', event);
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  get listenerCount(): number {
    return this.emitter.listenerCount('event');
  }
}
