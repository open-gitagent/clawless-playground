// ─── Typed Event Emitter ────────────────────────────────────────────────────

export class TypedEventEmitter<T extends Record<string, unknown[]> = Record<string, unknown[]>> {
  private handlers = new Map<keyof T, Set<(...args: any[]) => void>>();

  on<K extends keyof T>(event: K, fn: (...args: T[K]) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
  }

  off<K extends keyof T>(event: K, fn: (...args: T[K]) => void): void {
    this.handlers.get(event)?.delete(fn);
  }

  once<K extends keyof T>(event: K, fn: (...args: T[K]) => void): void {
    const wrapper = (...args: T[K]) => {
      this.off(event, wrapper);
      fn(...args);
    };
    this.on(event, wrapper);
  }

  protected emit<K extends keyof T>(event: K, ...args: T[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) fn(...args);
  }
}
