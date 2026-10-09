// @ts-nocheck
export class TimedCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry || Date.now() - entry.createdAt >= this.ttlMs) return null;
    return entry.value;
  }

  set(key, value) {
    this.entries.set(key, { createdAt: Date.now(), value });
    return value;
  }
}
