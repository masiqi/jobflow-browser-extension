import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authFixture = vi.hoisted(() => ({
  session: null as { user: { id: string; email: string }; access_token: string } | null,
  change: undefined as (() => void) | undefined,
  from: vi.fn(), rpc: vi.fn(), signOut: vi.fn(), signIn: vi.fn(), signUp: vi.fn()
}));
vi.mock("../src/backend/config", () => ({
  BACKEND_CONFIG: { configured: true, supabaseUrl: "https://synthetic.supabase.co", publishableKey: "synthetic-public-key" }
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: authFixture.session }, error: null }),
      onAuthStateChange: (callback: () => void) => { authFixture.change = callback; },
      signOut: authFixture.signOut, signInWithPassword: authFixture.signIn, signUp: authFixture.signUp
    },
    from: authFixture.from, rpc: authFixture.rpc
  })
}));

function setSession(id: string, token = "synthetic-token"): void {
  authFixture.session = { user: { id, email: id + "@example.test" }, access_token: token };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  setSession("owner-a");
  authFixture.change = undefined;
  authFixture.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { email_verification_status: "verified" }, error: null }) }) })
  }));
  authFixture.rpc.mockResolvedValue({ data: [{ managed_model_enabled: false }], error: null });
  authFixture.signOut.mockImplementation(async () => {
    authFixture.session = null;
    authFixture.change?.();
    return { error: null };
  });
  authFixture.signIn.mockImplementation(async () => { setSession("owner-b"); authFixture.change?.(); return { error: null }; });
  authFixture.signUp.mockImplementation(async () => { setSession("owner-c"); authFixture.change?.(); return { error: null }; });
  vi.stubGlobal("chrome", { storage: { local: { remove: vi.fn() } } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("display-only auth cache", () => {
  it("coalesces concurrent UI reads and caches for 30s while authoritative calls remain fresh", async () => {
    const { getAuthProjection } = await import("../src/backend/supabase");
    const states = await Promise.all(Array.from({ length: 30 }, () => getAuthProjection({ cached: true })));
    expect(states.every((state) => state.status === "signed_in" && state.userId === "owner-a")).toBe(true);
    expect(authFixture.from).toHaveBeenCalledTimes(1);
    expect(authFixture.rpc).toHaveBeenCalledTimes(1);
    await getAuthProjection({ cached: true });
    expect(authFixture.rpc).toHaveBeenCalledTimes(1);
    await getAuthProjection();
    await getAuthProjection();
    expect(authFixture.rpc).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_001);
    await getAuthProjection({ cached: true });
    expect(authFixture.rpc).toHaveBeenCalledTimes(4);
  });

  it("does not return a cached account across user or token changes", async () => {
    const { getAuthProjection } = await import("../src/backend/supabase");
    await getAuthProjection({ cached: true });
    setSession("owner-b");
    expect(await getAuthProjection({ cached: true })).toMatchObject({ userId: "owner-b" });
    setSession("owner-b", "new-token");
    await getAuthProjection({ cached: true });
    expect(authFixture.rpc).toHaveBeenCalledTimes(3);
    authFixture.session = null;
    expect(await getAuthProjection({ cached: true })).toEqual({ status: "signed_out" });
  });

  it("discards an in-flight response after owner switch and never serves it under the new owner", async () => {
    let release: ((value: { data: { managed_model_enabled: boolean }[]; error: null }) => void) | undefined;
    const pendingEntitlement = new Promise((resolve) => { release = resolve; });
    authFixture.rpc.mockReturnValueOnce(pendingEntitlement);
    const { getAuthProjection } = await import("../src/backend/supabase");
    const oldRequest = getAuthProjection({ cached: true });
    await vi.waitFor(() => expect(authFixture.rpc).toHaveBeenCalledTimes(1));
    setSession("owner-b");
    authFixture.change?.();
    expect(await getAuthProjection({ cached: true })).toMatchObject({ userId: "owner-b", vip: false });
    release!({ data: [{ managed_model_enabled: true }], error: null });
    expect(await oldRequest).toMatchObject({ userId: "owner-b", vip: false });
    expect(await getAuthProjection({ cached: true })).toMatchObject({ userId: "owner-b", vip: false });
  });

  it("invalidates explicitly on register, login and logout", async () => {
    const { getAuthProjection, register, login, logout } = await import("../src/backend/supabase");
    await getAuthProjection({ cached: true });
    expect(await login("owner-b@example.test", "synthetic-password")).toMatchObject({ userId: "owner-b" });
    expect(await getAuthProjection({ cached: true })).toMatchObject({ userId: "owner-b" });
    expect(await register("owner-c@example.test", "synthetic-password")).toMatchObject({ userId: "owner-c" });
    expect(await getAuthProjection({ cached: true })).toMatchObject({ userId: "owner-c" });
    await logout();
    expect(await getAuthProjection({ cached: true })).toEqual({ status: "signed_out" });
  });

  it("does not cache a failed entitlement response as a false VIP projection", async () => {
    const { getAuthProjection } = await import("../src/backend/supabase");
    authFixture.rpc.mockResolvedValueOnce({ data: null, error: { message: "synthetic failure" } });
    await expect(getAuthProjection({ cached: true })).rejects.toThrow("读取账号状态失败");
    authFixture.rpc.mockResolvedValueOnce({ data: [{ managed_model_enabled: true }], error: null });
    expect(await getAuthProjection({ cached: true })).toMatchObject({ vip: true });
    expect(authFixture.rpc).toHaveBeenCalledTimes(2);
  });
});
