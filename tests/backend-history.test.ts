import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../src/backend/config", () => ({
  BACKEND_CONFIG: { configured: true, supabaseUrl: "https://synthetic.supabase.co", publishableKey: "synthetic-public-key" }
}));
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/supabase-js")>();
  return {
    ...actual,
    createClient: () => actual.createClient("https://synthetic.supabase.co", "synthetic-public-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: transport.fetch }
    })
  };
});

type Row = Record<string, string | number | boolean | null | string[] | Record<string, unknown>>;
const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreignOwnerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const uuid = (index: number) => "00000000-0000-4000-8000-" + index.toString(16).padStart(12, "0");
const timestamp = (index: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
let tables: Record<string, Row[]>;
let serverCap: number;

function revision(index: number, opportunityIndex: number, text: string): Row {
  return {
    id: uuid(index), user_id: ownerId, opportunity_id: uuid(opportunityIndex), kind: "generated", text,
    created_at: timestamp(index), jd_evidence: ["synthetic JD evidence"], fact_ids: ["fact-1"],
    model_metadata: { route: "byok", provider: "openai", model: "synthetic-model", promptVersion: "v1" }
  };
}

function opportunity(index: number): Row {
  return {
    id: uuid(index), user_id: ownerId, platform: "liepin", platform_job_id: String(index),
    canonical_url: "https://www.liepin.com/job/" + index + ".shtml", title: "Synthetic role", company: "Synthetic company",
    location: "", salary: "", experience: "", education: "", card_text: "", description: "Synthetic description",
    recruiter: null, recruiter_title: null, jd_hash: null, latest_reason: null,
    current_status: index === 1 ? "user_excluded" : "draft_ready",
    first_seen_at: timestamp(index), last_seen_at: timestamp(index)
  };
}

beforeEach(() => {
  vi.resetModules();
  transport.fetch.mockReset();
  serverCap = 127;
  tables = {
    message_drafts: Array.from({ length: 620 }, (_, index) => ({
      user_id: ownerId, opportunity_id: uuid(index + 1), current_text: "Synthetic greeting " + (index + 1),
      updated_at: timestamp(index + 1)
    })),
    draft_revisions: Array.from({ length: 1240 }, (_, index) => {
      const opportunityIndex = index % 620 + 1;
      return revision(index + 1, opportunityIndex,
        index < 620 ? "Old greeting " + opportunityIndex : "Synthetic greeting " + opportunityIndex);
    }),
    job_opportunities: Array.from({ length: 1250 }, (_, index) => opportunity(index + 1))
  };
  // Exercise the real Supabase query builder against a capped, owner-filtered
  // transport, including stable order and cursor filters across multiple pages.
  transport.fetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").at(-1)!;
    let rows = (tables[table] ?? []).filter((row) => row.user_id === ownerId);
    for (const [field, value] of url.searchParams) {
      if (value.startsWith("eq.")) rows = rows.filter((row) => String(row[field]) === value.slice(3));
      if (value.startsWith("gt.")) rows = rows.filter((row) => String(row[field]) > value.slice(3));
    }
    const ordering = url.searchParams.get("order");
    if (ordering) rows = [...rows].sort((left, right) => {
      for (const clause of ordering.split(",")) {
        const [field, direction] = clause.split(".");
        const compared = String(left[field!]).localeCompare(String(right[field!]));
        if (compared) return direction === "desc" ? -compared : compared;
      }
      return 0;
    });
    const limit = Math.min(serverCap, Number(url.searchParams.get("limit") ?? serverCap));
    return new Response(JSON.stringify(rows.slice(0, limit)), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  });
});

describe("owner-scoped backend history", () => {
  it.each([1000, 127])("loads drafts beyond 500 and revisions beyond server cap %s without truncation or metadata loss", async (cap) => {
    serverCap = cap;
    const { listDrafts } = await import("../src/backend/supabase");
    const drafts = await listDrafts();
    expect(drafts).toHaveLength(620);
    expect(drafts.reduce((count, draft) => count + draft.revisions.length, 0)).toBe(1240);
    expect(drafts.at(-1)).toMatchObject({ opportunityId: uuid(620), currentText: "Synthetic greeting 620" });
    expect(drafts.at(-1)!.revisions.map((item) => item.id)).toEqual([uuid(620), uuid(1240)]);
    expect(drafts.at(-1)!.revisions[1]).toMatchObject({
      text: "Synthetic greeting 620", factIds: ["fact-1"], jdEvidence: ["synthetic JD evidence"],
      model: { route: "byok", provider: "openai", model: "synthetic-model", promptVersion: "v1" }
    });
    expect(new Set(drafts.map((item) => item.opportunityId)).size).toBe(620);
  });

  it("keeps old excluded opportunities available for record history and scan deduplication", async () => {
    const { listOpportunities } = await import("../src/backend/supabase");
    const opportunities = await listOpportunities();
    expect(opportunities).toHaveLength(1250);
    expect(opportunities[0]?.id).toBe(uuid(1250));
    expect(opportunities.at(-1)).toMatchObject({ id: uuid(1), status: "user_excluded" });
    expect(new Set(opportunities.map((item) => item.id)).size).toBe(1250);
  });

  it("loads an exact draft and opportunity regardless of unrelated history size", async () => {
    const { getDraft, getOpportunity } = await import("../src/backend/supabase");
    const draft = await getDraft(uuid(620));
    expect(draft?.currentText).toBe("Synthetic greeting 620");
    expect(draft?.revisions.map((item) => item.id)).toEqual([uuid(620), uuid(1240)]);
    expect(await getOpportunity(uuid(1))).toMatchObject({ id: uuid(1), status: "user_excluded" });
    for (const [input] of transport.fetch.mock.calls) {
      const url = new URL(String(input));
      const field = url.pathname.endsWith("job_opportunities") ? "id" : "opportunity_id";
      expect(url.searchParams.get(field)).toMatch(/^eq\./);
      expect(url.searchParams.has("text")).toBe(false);
    }
  });

  it("loads all revisions for one opportunity even when the server caps its history to a single row", async () => {
    serverCap = 1;
    const { getDraft } = await import("../src/backend/supabase");
    const result = await getDraft(uuid(620));
    expect(result?.revisions).toHaveLength(2);
    expect(result?.revisions.at(-1)?.text).toBe(result?.currentText);
  });

  it("returns null for missing or RLS-hidden exact records and never substitutes another opportunity", async () => {
    tables.message_drafts![619]!.user_id = foreignOwnerId;
    tables.job_opportunities![619]!.user_id = foreignOwnerId;
    const { getDraft, getOpportunity } = await import("../src/backend/supabase");
    expect(await getDraft(uuid(620))).toBeNull();
    expect(await getOpportunity(uuid(620))).toBeNull();
    expect(await getDraft(uuid(3000))).toBeNull();
    expect(await getOpportunity(uuid(3000))).toBeNull();
  });

  it.each(["message_drafts", "draft_revisions", "job_opportunities"])("rejects a later %s page failure instead of returning partial history", async (table) => {
    const original = transport.fetch.getMockImplementation()!;
    transport.fetch.mockImplementation(async (...args) => {
      const url = new URL(String(args[0]));
      if (url.pathname.endsWith(table) && [...url.searchParams.values()].some((value) => value.startsWith("gt."))) {
        return new Response(JSON.stringify({ message: "synthetic failure" }), { status: 400 });
      }
      return original(...args);
    });
    const { listDrafts, listOpportunities } = await import("../src/backend/supabase");
    await expect(table === "job_opportunities" ? listOpportunities() : listDrafts()).rejects.toThrow("读取");
  });
});
