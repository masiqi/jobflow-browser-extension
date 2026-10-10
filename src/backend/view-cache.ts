// Display data only. Never use this cache to authorize a platform write.
export class ViewCache {
  private owner = "";
  private entries = new Map<string, { expiresAt: number; value: Promise<unknown> }>();
  version = 0;

  setOwner(owner: string): void {
    if (this.owner === owner) return;
    this.owner = owner;
    this.invalidate();
  }

  invalidate(prefix = ""): void {
    this.version += 1;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  async read<T>(key: string, load: () => Promise<T>, ttlMs = 30_000): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > Date.now()) return existing.value as Promise<T>;
    const entry = { expiresAt: Number.POSITIVE_INFINITY, value: Promise.resolve().then(load) };
    this.entries.set(key, entry);
    // Keep memory bounded when a user explores many pages/details.
    if (this.entries.size > 100) this.entries.delete(this.entries.keys().next().value!);
    try {
      const value = await entry.value;
      entry.expiresAt = Date.now() + ttlMs;
      return value;
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }
  }
}
