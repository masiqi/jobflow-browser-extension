import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewCache } from "../src/backend/view-cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("display view cache", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces an in-flight burst and expires 30 seconds after completion", async () => {
    vi.useFakeTimers();
    const cache = new ViewCache();
    const pending = deferred<string>();
    const load = vi.fn(() => pending.promise);
    const requests = Array.from({ length: 20 }, () => cache.read("page:0", load));
    await vi.advanceTimersByTimeAsync(60_000);
    const lateRequest = cache.read("page:0", load);
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve("summary");
    expect(await Promise.all([...requests, lateRequest])).toEqual(Array(21).fill("summary"));
    await vi.advanceTimersByTimeAsync(29_999);
    await cache.read("page:0", load);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await cache.read("page:0", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("invalidates only a requested prefix and keeps unrelated view data", async () => {
    const cache = new ViewCache();
    const page = vi.fn(async () => "page");
    const profile = vi.fn(async () => "profile");
    await cache.read("page:0", page);
    await cache.read("profiles", profile);
    cache.invalidate("page:");
    await cache.read("page:0", page);
    await cache.read("profiles", profile);
    expect(page).toHaveBeenCalledTimes(2);
    expect(profile).toHaveBeenCalledTimes(1);
  });

  it("never reuses a prior account's values after owner changes", async () => {
    const cache = new ViewCache();
    const load = vi.fn(async () => "owner-data");
    cache.setOwner("owner-a");
    await cache.read("profiles", load);
    cache.setOwner("owner-a");
    await cache.read("profiles", load);
    expect(load).toHaveBeenCalledTimes(1);
    cache.setOwner("owner-b");
    await cache.read("profiles", load);
    expect(load).toHaveBeenCalledTimes(2);
    cache.setOwner("");
    await cache.read("profiles", load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("retries failed reads rather than caching the error", async () => {
    const cache = new ViewCache();
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("recovered");
    await expect(cache.read("page:0", load)).rejects.toThrow("offline");
    await expect(cache.read("page:0", load)).resolves.toBe("recovered");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("an invalidated old rejection cannot evict the replacement entry", async () => {
    const cache = new ViewCache();
    const pending = deferred<string>();
    const old = cache.read("page:0", () => pending.promise);
    const rejection = expect(old).rejects.toThrow("old failure");
    cache.invalidate("page:");
    const loadNew = vi.fn(async () => "fresh");
    await expect(cache.read("page:0", loadNew)).resolves.toBe("fresh");
    pending.reject(new Error("old failure"));
    await rejection;
    await expect(cache.read("page:0", loadNew)).resolves.toBe("fresh");
    expect(loadNew).toHaveBeenCalledTimes(1);
  });

  it("an old pending success cannot replace data loaded after invalidation", async () => {
    const cache = new ViewCache();
    const pending = deferred<string>();
    const old = cache.read("detail:job", () => pending.promise);
    cache.invalidate("detail:");
    const loadNew = vi.fn(async () => "current draft");
    await cache.read("detail:job", loadNew);
    pending.resolve("old draft");
    await old;
    await expect(cache.read("detail:job", loadNew)).resolves.toBe("current draft");
    expect(loadNew).toHaveBeenCalledTimes(1);
  });

  it("bounds retained entries when browsing many record pages", async () => {
    const cache = new ViewCache();
    const load = vi.fn(async () => "summary");
    for (let page = 0; page <= 100; page += 1) await cache.read("page:" + page, load);
    await cache.read("page:100", load);
    expect(load).toHaveBeenCalledTimes(101);
    await cache.read("page:0", load);
    expect(load).toHaveBeenCalledTimes(102);
  });
});
