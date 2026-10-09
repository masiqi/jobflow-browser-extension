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
let responseBytes: number;

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
  responseBytes = 0;
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
      if (value.startsWith("in.(")) {
        const values = value.slice(4, -1).split(",").map((value) => value.replace(/^"|"$/g, ""));
        rows = rows.filter((row) => values.includes(String(row[field])));
      }
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
    const offset = Number(url.searchParams.get("offset") ?? 0);
    rows = rows.slice(offset, offset + limit);
    const select = url.searchParams.get("select");
    if (select && select !== "*") rows = rows.map((row) => Object.fromEntries(select.split(",").map((key) => [key, row[key]!])));
    const body = JSON.stringify(rows);
    responseBytes += new TextEncoder().encode(body).byteLength;
    return new Response(body, {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  });
});

describe("bounded egress reads", () => {
  it.each([1000, 17, 1])("fills a summary page and detects the next page under server cap %s", async (cap) => {
    serverCap = cap;
    const { listOpportunityPage } = await import("../src/backend/supabase");
    const first = await listOpportunityPage({ page: 0 });
    expect(first.opportunities).toHaveLength(50);
    expect(first.hasNext).toBe(true);
    expect(first.opportunities[0]?.id).toBe(uuid(1250));
    const second = await listOpportunityPage({ page: 1 });
    expect(second.opportunities[0]?.id).toBe(uuid(1200));
    const last = await listOpportunityPage({ page: 24 });
    expect(last.opportunities).toHaveLength(50);
    expect(last.hasNext).toBe(false);
    expect((await listOpportunityPage({ page: 25 })).opportunities).toHaveLength(0);
    for (const [input] of transport.fetch.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get("order")).toBe("last_seen_at.desc,id.desc");
      expect(url.searchParams.get("select")).not.toMatch(/description|card_text|recruiter|jd_hash/);
    }
  });

  it("keeps response bytes and requests independent of historical JD volume", async () => {
    const { listOpportunityPage } = await import("../src/backend/supabase");
    const before = await listOpportunityPage({ page: 0 });
    const bytes = responseBytes;
    const requests = transport.fetch.mock.calls.length;
    for (const row of tables.job_opportunities!) {
      row.description = "Huge historical JD ".repeat(5000);
      row.card_text = "Historical card ".repeat(2000);
    }
    tables.job_opportunities!.push(...Array.from({ length: 6000 }, (_, index) => ({
      ...opportunity(index + 2000), last_seen_at: timestamp(0), description: "Huge unrelated JD ".repeat(5000)
    })));
    transport.fetch.mockClear();
    responseBytes = 0;
    const after = await listOpportunityPage({ page: 0, pageSize: 500 });
    expect(after).toEqual(before);
    expect(responseBytes).toBe(bytes);
    expect(responseBytes).toBeLessThan(35_000);
    expect(transport.fetch.mock.calls).toHaveLength(requests);
    expect(after.opportunities[0]?.cardText).toBe("");
    expect(after.opportunities[0]?.description).toBeUndefined();
  });

  it("quotes search operands and escapes literal percent, underscore, quotes and backslashes", async () => {
    const { listOpportunityPage } = await import("../src/backend/supabase");
    const search = 'agent%,_foo"\\),current_status.eq.draft_ready';
    await listOpportunityPage({ page: 0, status: "user_excluded", search });
    const url = new URL(String(transport.fetch.mock.calls[0]![0]));
    const pattern = JSON.stringify('%agent\\%,\\_foo"\\\\),current\\_status.eq.draft\\_ready%');
    expect(url.searchParams.get("or")).toBe("(title.ilike." + pattern + ",company.ilike." + pattern + ",platform_job_id.ilike." + pattern + ")");
    expect(url.searchParams.get("current_status")).toBe("eq.user_excluded");
  });

  it("deduplicates only exact scanned platform IDs including very old exclusions under server caps", async () => {
    serverCap = 1;
    const { listCandidateIdentities } = await import("../src/backend/supabase");
    const candidates = [1, 1250, 9000].map((id) => ({
      platform: "liepin" as const, jobId: String(id), canonicalUrl: "https://www.liepin.com/job/" + id + ".shtml",
      url: "https://www.liepin.com/job/" + id + ".shtml", index: id,
      title: "Synthetic role", company: "Synthetic company", location: "", salary: "", experience: "", education: "", cardText: ""
    }));
    const result = await listCandidateIdentities(candidates);
    expect(result).toEqual([
      { id: uuid(1), platform: "liepin", platformJobId: "1", status: "user_excluded" },
      { id: uuid(1250), platform: "liepin", platformJobId: "1250", status: "draft_ready" }
    ]);
    expect(responseBytes).toBeLessThan(400);
    for (const [input] of transport.fetch.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get("platform")).toBe("eq.liepin");
      expect(url.searchParams.get("platform_job_id")).toBe("in.(1,1250,9000)");
      expect(url.searchParams.get("select")).toBe("id,platform,platform_job_id,current_status");
    }
    transport.fetch.mockClear();
    expect(await listCandidateIdentities([])).toEqual([]);
    expect(transport.fetch).not.toHaveBeenCalled();
  });

  it("reads only the current revision even with thousands of historical revisions", async () => {
    const { getCurrentDraft } = await import("../src/backend/supabase");
    const initial = await getCurrentDraft(uuid(620));
    const bytes = responseBytes;
    expect(initial?.revisions.map((revision) => revision.id)).toEqual([uuid(1240)]);
    tables.draft_revisions!.push(...Array.from({ length: 2000 }, (_, index) => ({
      ...revision(index + 5000, 620, "Long old message".repeat(1000)), created_at: timestamp(0)
    })));
    transport.fetch.mockClear();
    responseBytes = 0;
    expect(await getCurrentDraft(uuid(620))).toEqual(initial);
    expect(transport.fetch).toHaveBeenCalledTimes(2);
    expect(responseBytes).toBe(bytes);
    expect(responseBytes).toBeLessThan(1000);
    for (const [input] of transport.fetch.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get("opportunity_id")).toBe("eq." + uuid(620));
      expect(url.searchParams.has("text")).toBe(false);
      expect(url.searchParams.has("current_text")).toBe(false);
    }
    tables.draft_revisions!.push(revision(9000, 620, "Newer inconsistent revision"));
    const stale = await getCurrentDraft(uuid(620));
    expect(stale?.revisions.at(-1)?.text).not.toBe(stale?.currentText);
  });

  it("scopes full lookup by platform and job ID and respects RLS-hidden records", async () => {
    const { getOpportunityByPlatform, getCurrentDraft } = await import("../src/backend/supabase");
    expect(await getOpportunityByPlatform("liepin", "1")).toMatchObject({ id: uuid(1), description: "Synthetic description" });
    expect(await getOpportunityByPlatform("zhaopin", "1")).toBeNull();
    tables.job_opportunities![0]!.user_id = foreignOwnerId;
    tables.message_drafts![0]!.user_id = foreignOwnerId;
    expect(await getOpportunityByPlatform("liepin", "1")).toBeNull();
    expect(await getCurrentDraft(uuid(1))).toBeNull();
  });

  it("never issues a global delivery query for an empty page and fills scoped capped results", async () => {
    const { listDeliveryRecords } = await import("../src/backend/supabase");
    expect(await listDeliveryRecords([])).toEqual([]);
    expect(transport.fetch).not.toHaveBeenCalled();
    tables.delivery_records = [1, 2, 3].map((id) => ({
      user_id: ownerId, opportunity_id: uuid(id), platform: "liepin", platform_job_id: String(id),
      resume_mode: "platform_default", overall_status: "succeeded", application_status: "verified", greeting_status: "verified",
      draft_revision_id: uuid(id), draft_sha256: "synthetic", reservation_id: null, latest_reason: null, updated_at: timestamp(id)
    }));
    serverCap = 1;
    expect((await listDeliveryRecords([uuid(1), uuid(3)])).map((record) => record.opportunityId)).toEqual([uuid(3), uuid(1)]);
    for (const [input] of transport.fetch.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get("opportunity_id")).toBe("in.(" + uuid(1) + "," + uuid(3) + ")");
    }
  });

  it("paginates all selected-opportunity events and evaluations without unrelated history", async () => {
    serverCap = 1;
    tables.opportunity_events = [1, 2, 3].map((id) => ({
      user_id: ownerId, id: uuid(id), opportunity_id: uuid(id === 2 ? 2 : 1),
      kind: "opportunity_observed", schema_version: 1, actor: "system", payload: {}, created_at: timestamp(id)
    }));
    tables.evaluations = [1, 2, 3].map((id) => ({
      user_id: ownerId, id: uuid(id), opportunity_id: uuid(id === 2 ? 2 : 1), outcome: "review", score: 50,
      reasons: ["Synthetic reason"], jd_evidence: [], fact_ids: [], profile_id: uuid(1), rule_version: 1,
      prompt_version: "v1", model_route: "byok", provider: "openai", model: "synthetic", created_at: timestamp(id)
    }));
    const { listEvaluations, listOpportunityEvents } = await import("../src/backend/supabase");
    expect((await listOpportunityEvents(uuid(1))).map((event) => event.id)).toEqual([uuid(1), uuid(3)]);
    expect((await listEvaluations(uuid(1))).map((evaluation) => evaluation.id)).toEqual([uuid(3), uuid(1)]);
    for (const [input] of transport.fetch.mock.calls) expect(new URL(String(input)).searchParams.get("opportunity_id")).toBe("eq." + uuid(1));
  });

  it("projects scan observation RPC responses instead of returning existing JDs", async () => {
    tables.observe_job_opportunities = [opportunity(1)];
    const { upsertCandidates } = await import("../src/backend/supabase");
    expect((await upsertCandidates([]))[0]).toMatchObject({ id: uuid(1), cardText: "" });
    const url = new URL(String(transport.fetch.mock.calls[0]![0]));
    expect(url.searchParams.get("select")).not.toMatch(/description|card_text|recruiter|jd_hash/);
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
