import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { BACKEND_CONFIG } from "./config";
import { reportModelOutputDiagnostic } from "./model-diagnostics";
import { STORAGE_KEYS } from "../defaults";
import type {
  AuthProjection,
  DetailJob,
  EvaluationRecord,
  JdRuleSettings,
  ListCandidate,
  DeliveryAttempt,
  DeliveryRecord,
  MessageDraft,
  OpportunityEvent,
  OpportunityRecord,
  OpportunityStatus,
  PlatformKey,
  ResumeProfile
} from "../types";

const profileRowSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int(),
  state: z.enum(["draft", "active", "stale"]),
  source_hash: z.string(),
  source_name: z.string(),
  source_kind: z.enum(["pdf", "docx", "text", "markdown", "pasted"]),
  summary: z.string(),
  target_roles: z.array(z.string()),
  skills: z.array(z.string()),
  constraints: z.array(z.string()),
  analyzed_at: z.string(),
  activated_at: z.string().nullable()
});

const factRowSchema = z.object({
  profile_id: z.string().uuid(),
  fact_key: z.string(),
  text: z.string(),
  keywords: z.array(z.string()),
  evidence: z.string(),
  approved: z.boolean()
});

const opportunityRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  platform: z.enum(["liepin", "zhaopin"]),
  platform_job_id: z.string(),
  canonical_url: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  salary: z.string(),
  experience: z.string(),
  education: z.string(),
  card_text: z.string(),
  description: z.string().nullable(),
  recruiter: z.string().nullable(),
  recruiter_title: z.string().nullable(),
  jd_hash: z.string().nullable(),
  current_status: z.enum([
    "discovered", "queued", "extracting", "deterministic_excluded",
    "evaluating", "model_excluded", "review_required", "generating",
    "draft_ready", "user_excluded", "failed"
  ]),
  latest_reason: z.string().nullable(),
  first_seen_at: z.string(),
  last_seen_at: z.string()
});

const opportunitySummaryRowSchema = opportunityRowSchema.omit({
  card_text: true, description: true, recruiter: true, recruiter_title: true, jd_hash: true
});
const opportunitySummaryColumns = Object.keys(opportunitySummaryRowSchema.shape).join(",");
const opportunityIdentityRowSchema = opportunityRowSchema.pick({
  id: true, platform: true, platform_job_id: true, current_status: true
});

const draftRowSchema = z.object({
  opportunity_id: z.string().uuid(),
  current_text: z.string(),
  updated_at: z.string()
});

const revisionRowSchema = z.object({
  id: z.string().uuid(),
  opportunity_id: z.string().uuid(),
  kind: z.enum(["generated", "user_edit"]),
  text: z.string(),
  jd_evidence: z.array(z.string()),
  fact_ids: z.array(z.string()),
  model_metadata: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string()
});

const evaluationRowSchema = z.object({
  id: z.string().uuid(),
  opportunity_id: z.string().uuid(),
  outcome: z.enum(["proceed", "review", "exclude"]),
  score: z.coerce.number().nullable(),
  reasons: z.array(z.string()),
  jd_evidence: z.array(z.string()),
  fact_ids: z.array(z.string()),
  profile_id: z.string().uuid(),
  rule_version: z.number().int(),
  prompt_version: z.string(),
  model_route: z.enum(["managed", "byok"]),
  provider: z.enum(["openai", "deepseek", "openrouter", "custom"]),
  model: z.string(),
  created_at: z.string()
});

const deliveryRecordRowSchema = z.object({
  opportunity_id: z.string().uuid(),
  platform: z.literal("liepin"),
  platform_job_id: z.string(),
  resume_mode: z.literal("platform_default"),
  overall_status: z.enum(["ready", "preflighting", "awaiting_confirmation", "in_progress", "partial", "succeeded", "failed", "review_required"]),
  application_status: z.enum(["pending", "attempted", "verified", "failed"]),
  greeting_status: z.enum(["pending", "attempted", "verified", "failed"]),
  draft_revision_id: z.string().uuid().nullable(),
  draft_sha256: z.string().nullable(),
  reservation_id: z.string().uuid().nullable(),
  latest_reason: z.string().nullable(),
  updated_at: z.string()
});

const deliveryAttemptRowSchema = z.object({
  id: z.string().uuid(),
  request_id: z.string().uuid(),
  opportunity_id: z.string().uuid(),
  event_kind: z.string(),
  evidence_code: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  created_at: z.string()
});

const eventRowSchema = z.object({
  id: z.string().uuid(),
  opportunity_id: z.string().uuid(),
  kind: z.enum([
    "opportunity_observed", "details_captured", "deterministic_excluded",
    "evaluation_started", "evaluation_completed", "review_requested",
    "user_excluded", "user_override", "generation_started",
    "generation_completed", "draft_edited", "processing_failed"
  ]),
  schema_version: z.literal(1),
  actor: z.enum(["system", "model", "user"]),
  payload: z.record(z.string(), z.unknown()),
  created_at: z.string()
});

const chromeAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const stored: unknown = (await chrome.storage.local.get(STORAGE_KEYS.supabaseSession))[STORAGE_KEYS.supabaseSession];
    if (!stored || typeof stored !== "object") return null;
    const sessions = stored as Record<string, unknown>;
    return typeof sessions[key] === "string" ? sessions[key] : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    const stored: unknown = (await chrome.storage.local.get(STORAGE_KEYS.supabaseSession))[STORAGE_KEYS.supabaseSession];
    const sessions = stored && typeof stored === "object"
      ? { ...(stored as Record<string, unknown>) }
      : {};
    sessions[key] = value;
    await chrome.storage.local.set({ [STORAGE_KEYS.supabaseSession]: sessions });
  },
  async removeItem(key: string): Promise<void> {
    const stored: unknown = (await chrome.storage.local.get(STORAGE_KEYS.supabaseSession))[STORAGE_KEYS.supabaseSession];
    if (!stored || typeof stored !== "object") return;
    const sessions = { ...(stored as Record<string, unknown>) };
    delete sessions[key];
    await chrome.storage.local.set({ [STORAGE_KEYS.supabaseSession]: sessions });
  }
};

let clientPromise: Promise<SupabaseClient> | null = null;
let authProjectionEpoch = 0;
let authProjectionCache: { key: string; expiresAt: number; value: AuthProjection } | undefined;
let authProjectionFlight: { key: string; epoch: number; promise: Promise<AuthProjection> } | undefined;

function invalidateAuthProjection(): void {
  authProjectionEpoch += 1;
  authProjectionCache = undefined;
  authProjectionFlight = undefined;
}

export function getSupabaseClient(): Promise<SupabaseClient> {
  if (!BACKEND_CONFIG.configured) {
    return Promise.reject(new Error("尚未配置 Supabase 后端"));
  }
  clientPromise ??= Promise.resolve(createClient(
    BACKEND_CONFIG.supabaseUrl,
    BACKEND_CONFIG.publishableKey,
    {
      auth: {
        storage: chromeAuthStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    }
  )).then((client) => {
    client.auth.onAuthStateChange(() => invalidateAuthProjection());
    return client;
  });
  return clientPromise;
}

export async function register(email: string, password: string): Promise<AuthProjection> {
  const client = await getSupabaseClient();
  invalidateAuthProjection();
  const { error } = await client.auth.signUp({ email, password });
  invalidateAuthProjection();
  if (error) throw new Error("无法注册，请检查输入后重试");
  return getAuthProjection();
}

export async function login(email: string, password: string): Promise<AuthProjection> {
  const client = await getSupabaseClient();
  invalidateAuthProjection();
  const { error } = await client.auth.signInWithPassword({ email, password });
  invalidateAuthProjection();
  if (error) throw new Error("邮箱或密码不正确");
  return getAuthProjection();
}

export async function logout(): Promise<void> {
  const client = await getSupabaseClient();
  invalidateAuthProjection();
  await client.auth.signOut();
  invalidateAuthProjection();
  await chrome.storage.local.remove(STORAGE_KEYS.supabaseSession);
}

// Only display reads opt into this cache. Send/model authorization keeps the
// default fresh read and remains enforced by the authenticated server RPCs.
export async function getAuthProjection(options: { cached?: boolean } = {}): Promise<AuthProjection> {
  if (!BACKEND_CONFIG.configured) {
    return { status: "unavailable", error: "尚未配置 Supabase 后端" };
  }
  const client = await getSupabaseClient();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session?.user) {
      invalidateAuthProjection();
      return { status: "signed_out" };
    }
    const session = data.session;
    const key = session.user.id + ":" + session.access_token;
    const epoch = authProjectionEpoch;
    if (options.cached && authProjectionCache?.key === key && authProjectionCache.expiresAt > Date.now()) {
      return authProjectionCache.value;
    }
    let flight = options.cached && authProjectionFlight?.key === key && authProjectionFlight.epoch === epoch
      ? authProjectionFlight
      : undefined;
    if (!flight) {
      flight = { key, epoch, promise: loadAuthProjection(client, session.user) };
      if (options.cached) authProjectionFlight = flight;
    }
    let value: AuthProjection;
    try {
      value = await flight.promise;
    } finally {
      if (authProjectionFlight === flight) authProjectionFlight = undefined;
    }
    const current = await client.auth.getSession();
    if (epoch !== authProjectionEpoch || current.error || current.data.session?.user.id !== session.user.id
      || current.data.session.access_token !== session.access_token) continue;
    if (options.cached) authProjectionCache = { key, expiresAt: Date.now() + 30_000, value };
    return value;
  }
  throw new Error("登录状态已变化，请重试");
}

async function loadAuthProjection(client: SupabaseClient, user: { id: string; email?: string }): Promise<AuthProjection> {
  const [profileResult, entitlementResult] = await Promise.all([
    client.from("profiles").select("email_verification_status").eq("user_id", user.id).maybeSingle(),
    client.rpc("get_my_entitlement")
  ]);
  if (profileResult.error || entitlementResult.error) throw new Error("读取账号状态失败");
  const profile = profileResult.data && typeof profileResult.data === "object"
    ? profileResult.data as { email_verification_status?: unknown }
    : null;
  const entitlement = Array.isArray(entitlementResult.data)
    ? entitlementResult.data[0] as { managed_model_enabled?: unknown } | undefined
    : undefined;
  return {
    status: "signed_in",
    userId: user.id,
    email: user.email ?? "",
    emailVerificationStatus: profile?.email_verification_status === "verified" ? "verified" : "unverified",
    vip: entitlement?.managed_model_enabled === true
  };
}

export async function saveDraftProfile(profile: ResumeProfile): Promise<string> {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc("save_draft_resume_profile", { profile });
  if (error || typeof data !== "string") throw new Error("保存简历画像失败");
  return data;
}

export async function updateDraftProfile(profile: ResumeProfile): Promise<void> {
  const client = await getSupabaseClient();
  const { error: profileError } = await client.from("resume_profiles")
    .update({
      summary: profile.summary,
      target_roles: profile.targetRoles,
      skills: profile.skills,
      constraints: profile.constraints
    })
    .eq("id", profile.id)
    .eq("state", "draft");
  if (profileError) throw new Error("更新简历画像失败");
  for (const fact of profile.facts) {
    const { error } = await client.from("resume_facts")
      .update({
        text: fact.text,
        keywords: fact.keywords,
        approved: fact.approved
      })
      .eq("profile_id", profile.id)
      .eq("fact_key", fact.id);
    if (error) throw new Error("更新简历事实失败");
  }
}

export async function activateProfile(profileId: string): Promise<void> {
  const client = await getSupabaseClient();
  const { error } = await client.rpc("activate_resume_profile", { target_profile_id: profileId });
  if (error) throw new Error("启用简历画像失败");
}

export async function listResumeProfiles(): Promise<ResumeProfile[]> {
  const client = await getSupabaseClient();
  const [profilesResult, factsResult] = await Promise.all([
    client.from("resume_profiles").select("*").order("version", { ascending: false }),
    client.from("resume_facts").select("*").order("sort_order", { ascending: true })
  ]);
  if (profilesResult.error || factsResult.error) throw new Error("读取简历画像失败");
  const facts = z.array(factRowSchema).parse(factsResult.data);
  return z.array(profileRowSchema).parse(profilesResult.data).map((row) => ({
    id: row.id,
    version: row.version,
    state: row.state,
    sourceHash: row.source_hash,
    sourceName: row.source_name,
    sourceKind: row.source_kind,
    analyzedAt: row.analyzed_at,
    activatedAt: row.activated_at ?? undefined,
    summary: row.summary,
    targetRoles: row.target_roles,
    skills: row.skills,
    facts: facts.filter((fact) => fact.profile_id === row.id).map((fact) => ({
      id: fact.fact_key,
      text: fact.text,
      keywords: fact.keywords,
      evidence: fact.evidence,
      approved: fact.approved
    })),
    constraints: row.constraints
  }));
}

export async function loadActiveFilterConfig(): Promise<JdRuleSettings | null> {
  const client = await getSupabaseClient();
  const { data, error } = await client.from("filter_configs")
    .select("config")
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error("读取 JD 规则失败");
  if (!data || typeof data !== "object") return null;
  const parsed = z.object({
    config: z.object({
      version: z.literal(1),
      schoolPedigree: z.enum(["disabled", "reject_mandatory"]),
      travel: z.enum(["disabled", "none", "occasional", "unrestricted"]),
      rejectOutsourcing: z.boolean(),
      rejectDispatch: z.boolean(),
      rejectLongTermClientSite: z.boolean(),
      rejectNightShift: z.boolean(),
      rejectRotatingShift: z.boolean(),
      rejectBigSmallWeek: z.boolean(),
      rejectSingleRestDay: z.boolean(),
      rejectLongTermOnCall: z.boolean(),
      rejectedPrimaryTechnologies: z.array(z.string())
    }).strict()
  }).parse(data);
  return parsed.config;
}

export async function saveFilterConfig(config: JdRuleSettings): Promise<void> {
  const client = await getSupabaseClient();
  const { error } = await client.rpc("save_filter_config", { filter_config: config });
  if (error) throw new Error("保存 JD 规则失败");
}

export async function deleteMyProductData(): Promise<void> {
  const client = await getSupabaseClient();
  const { error } = await client.rpc("delete_my_product_data");
  if (error) throw new Error("删除云端数据失败");
}

export async function upsertCandidates(candidates: ListCandidate[]): Promise<OpportunityRecord[]> {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc("observe_job_opportunities", {
    observations: candidates.map((item) => ({
      platform: item.platform,
      platform_job_id: item.jobId,
      canonical_url: item.canonicalUrl,
      title: item.title,
      company: item.company,
      location: item.location,
      salary: item.salary,
      experience: item.experience,
      education: item.education,
      card_text: item.cardText
    }))
  }).select(opportunitySummaryColumns);
  if (error) throw new Error("保存职位列表失败");
  return z.array(opportunitySummaryRowSchema).parse(data).map(mapOpportunitySummary);
}

export async function recordJobDetails(
  opportunityId: string,
  requestId: string,
  job: DetailJob,
  jdHash: string
): Promise<void> {
  const client = await getSupabaseClient();
  const { error } = await client.rpc("record_job_details", {
    target_opportunity_id: opportunityId,
    target_request_id: requestId,
    job,
    target_jd_hash: jdHash
  });
  if (error) throw new Error("保存职位详情失败");
}

export async function listOpportunities(): Promise<OpportunityRecord[]> {
  const rows = await readAllRows("job_opportunities", opportunityRowSchema, "id", "读取职位记录失败");
  return rows.sort((left, right) => right.last_seen_at.localeCompare(left.last_seen_at))
    .map(mapOpportunity);
}

export async function getOpportunity(opportunityId: string): Promise<OpportunityRecord | null> {
  const client = await getSupabaseClient();
  const { data, error } = await client.from("job_opportunities").select("*")
    .eq("id", opportunityId).maybeSingle();
  if (error) throw new Error("读取职位记录失败");
  return data ? mapOpportunity(opportunityRowSchema.parse(data)) : null;
}

export async function getOpportunityByPlatform(platform: PlatformKey, jobId: string): Promise<OpportunityRecord | null> {
  const client = await getSupabaseClient();
  const { data, error } = await client.from("job_opportunities").select("*")
    .eq("platform", platform).eq("platform_job_id", jobId).maybeSingle();
  if (error) throw new Error("读取职位记录失败");
  return data ? mapOpportunity(opportunityRowSchema.parse(data)) : null;
}

export async function listOpportunityPage(input: {
  page: number;
  status?: OpportunityStatus;
  search?: string;
  pageSize?: number;
}): Promise<{ opportunities: OpportunityRecord[]; hasNext: boolean }> {
  const page = z.number().int().min(0).max(100_000).parse(input.page);
  const pageSize = Math.min(50, z.number().int().min(1).parse(input.pageSize ?? 50));
  const client = await getSupabaseClient();
  const rows: z.infer<typeof opportunitySummaryRowSchema>[] = [];
  const search = input.search?.trim();
  // Quote the PostgREST operand as well as escaping SQL LIKE metacharacters:
  // commas/parentheses cannot become filter syntax and %/_ remain literal.
  const pattern = search ? JSON.stringify("%" + search.replace(/[\\%_]/g, "\\$&") + "%") : undefined;
  while (rows.length <= pageSize) {
    let query = client.from("job_opportunities").select(opportunitySummaryColumns)
      .order("last_seen_at", { ascending: false }).order("id", { ascending: false })
      .range(page * pageSize + rows.length, page * pageSize + pageSize);
    if (input.status) query = query.eq("current_status", opportunityRowSchema.shape.current_status.parse(input.status));
    if (pattern) query = query.or("title.ilike." + pattern + ",company.ilike." + pattern + ",platform_job_id.ilike." + pattern);
    const { data, error } = await query;
    if (error) throw new Error("读取职位记录失败");
    const result = z.array(opportunitySummaryRowSchema).parse(data);
    if (!result.length) break;
    if (result.some((row) => rows.some((previous) => previous.id === row.id))) throw new Error("职位列表已变化，请刷新重试");
    rows.push(...result);
  }
  return { opportunities: rows.slice(0, pageSize).map(mapOpportunitySummary), hasNext: rows.length > pageSize };
}

export async function listCandidateIdentities(candidates: ListCandidate[]): Promise<Array<Pick<OpportunityRecord,
  "id" | "platform" | "platformJobId" | "status">>> {
  if (!candidates.length) return [];
  const client = await getSupabaseClient();
  const rows: z.infer<typeof opportunityIdentityRowSchema>[] = [];
  for (const platform of new Set(candidates.map((candidate) => candidate.platform))) {
    const ids = [...new Set(candidates.filter((candidate) => candidate.platform === platform).map((candidate) => candidate.jobId))];
    for (let index = 0; index < ids.length; index += 100) {
      let cursor: string | undefined;
      while (true) {
        let query = client.from("job_opportunities").select("id,platform,platform_job_id,current_status")
          .eq("platform", platform).in("platform_job_id", ids.slice(index, index + 100))
          .order("id", { ascending: true }).limit(100);
        if (cursor) query = query.gt("id", cursor);
        const { data, error } = await query;
        if (error) throw new Error("读取职位去重记录失败");
        const result = z.array(opportunityIdentityRowSchema).parse(data);
        if (!result.length) break;
        const next = result.at(-1)!.id;
        if (cursor && next <= cursor) throw new Error("读取职位去重记录失败");
        rows.push(...result);
        cursor = next;
        if (result.length === ids.slice(index, index + 100).length) break;
      }
    }
  }
  return rows.map((row) => ({ id: row.id, platform: row.platform, platformJobId: row.platform_job_id, status: row.current_status }));
}

// Advance by an immutable unique key, not by the requested page size: hosted
// PostgREST may cap a response below our limit. A short page is not EOF.
async function readAllRows<T extends Record<string, unknown>>(
  table: string,
  schema: z.ZodType<T>,
  cursorColumn: keyof T & string,
  errorMessage: string,
  opportunityId?: string
): Promise<T[]> {
  const client = await getSupabaseClient();
  const rows: T[] = [];
  let cursor: string | undefined;
  while (true) {
    let query = client.from(table).select("*").order(cursorColumn, { ascending: true }).limit(500);
    if (opportunityId) query = query.eq("opportunity_id", opportunityId);
    if (cursor) query = query.gt(cursorColumn, cursor);
    const { data, error } = await query;
    if (error) throw new Error(errorMessage);
    const page = z.array(schema).parse(data);
    if (page.length === 0) return rows;
    const nextCursor = z.string().parse(page[page.length - 1]![cursorColumn]);
    if (cursor && nextCursor <= cursor) throw new Error(errorMessage);
    rows.push(...page);
    cursor = nextCursor;
  }
}

function mapDraft(row: z.infer<typeof draftRowSchema>, revisions: z.infer<typeof revisionRowSchema>[]): MessageDraft {
  return {
    opportunityId: row.opportunity_id,
    currentText: row.current_text,
    revisions: revisions.sort((left, right) => left.created_at.localeCompare(right.created_at)
      || left.id.localeCompare(right.id)).map((revision) => {
      const metadata = revision.model_metadata;
      const route = metadata?.route;
      const provider = metadata?.provider;
      const model = metadata?.model;
      const promptVersion = metadata?.promptVersion;
      return {
        id: revision.id,
        kind: revision.kind,
        text: revision.text,
        createdAt: revision.created_at,
        jdEvidence: revision.jd_evidence,
        factIds: revision.fact_ids,
        model: route === "managed" || route === "byok"
          ? {
              route,
              provider: provider === "openai" || provider === "deepseek" || provider === "openrouter" || provider === "custom"
                ? provider
                : "custom",
              model: typeof model === "string" ? model : "",
              promptVersion: typeof promptVersion === "string" ? promptVersion : "",
              createdAt: revision.created_at
            }
          : undefined
      };
    }),
    updatedAt: row.updated_at
  };
}

export async function listDrafts(): Promise<MessageDraft[]> {
  const [drafts, revisions] = await Promise.all([
    readAllRows("message_drafts", draftRowSchema, "opportunity_id", "读取待发消息失败"),
    readAllRows("draft_revisions", revisionRowSchema, "id", "读取待发消息失败")
  ]);
  const revisionsByOpportunity = new Map<string, z.infer<typeof revisionRowSchema>[]>();
  for (const revision of revisions) {
    const group = revisionsByOpportunity.get(revision.opportunity_id) ?? [];
    group.push(revision);
    revisionsByOpportunity.set(revision.opportunity_id, group);
  }
  return drafts.map((row) => mapDraft(row, revisionsByOpportunity.get(row.opportunity_id) ?? []));
}

// Authoritative send lookups are scoped to this opportunity through the signed-in
// client's RLS. A management-list window must never determine whether it exists.
export async function getDraft(opportunityId: string): Promise<MessageDraft | null> {
  const client = await getSupabaseClient();
  const { data, error } = await client.from("message_drafts").select("*")
    .eq("opportunity_id", opportunityId).maybeSingle();
  if (error) throw new Error("读取待发消息失败");
  if (!data) return null;
  const row = draftRowSchema.parse(data);
  const revisions = await readAllRows("draft_revisions", revisionRowSchema, "id", "读取待发消息失败", opportunityId);
  return mapDraft(row, revisions);
}

// Send validation needs only the newest revision. Do not filter by current_text:
// that puts private message content in request URLs and could hide a stale row.
export async function getCurrentDraft(opportunityId: string): Promise<MessageDraft | null> {
  const client = await getSupabaseClient();
  const { data, error } = await client.from("message_drafts").select("opportunity_id,current_text,updated_at")
    .eq("opportunity_id", opportunityId).maybeSingle();
  if (error) throw new Error("读取待发消息失败");
  if (!data) return null;
  const row = draftRowSchema.parse(data);
  const result = await client.from("draft_revisions").select("*").eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
  if (result.error) throw new Error("读取待发消息失败");
  return mapDraft(row, z.array(revisionRowSchema).parse(result.data));
}

export async function prepareReviewedDelivery(
  opportunityId: string,
  draftRevisionId: string,
  draftSha256: string
): Promise<DeliveryRecord> {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc("prepare_reviewed_delivery", {
    target_opportunity_id: opportunityId,
    target_draft_revision_id: draftRevisionId,
    target_draft_sha256: draftSha256
  });
  if (error) throw new Error("准备投递记录失败");
  return mapDeliveryRecord(deliveryRecordRowSchema.parse(data));
}

export async function reserveReviewedDeliveryQuota(
  opportunityId: string,
  requestId: string,
  dailyLimit: number
): Promise<string> {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc("reserve_delivery_daily_unit", {
    target_opportunity_id: opportunityId,
    target_request_id: requestId,
    target_daily_limit: dailyLimit
  });
  if (error || typeof data !== "string") throw new Error("今日投递额度已满或无法预留");
  return data;
}

export async function markReviewedDeliveryWriteStarted(
  opportunityId: string,
  reservationId: string
): Promise<void> {
  const client = await getSupabaseClient();
  const { error } = await client.rpc("mark_delivery_write_started", {
    target_opportunity_id: opportunityId,
    target_reservation_id: reservationId
  });
  if (error) throw new Error("无法确认投递写入边界");
}

export async function releaseReviewedDeliveryQuota(
  opportunityId: string,
  reservationId: string
): Promise<boolean> {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc("release_delivery_daily_unit", {
    target_opportunity_id: opportunityId,
    target_reservation_id: reservationId
  });
  if (error || typeof data !== "boolean") throw new Error("无法释放未使用的投递额度");
  return data;
}

export async function recordReviewedDeliveryAttempt(input: {
  opportunityId: string;
  requestId: string;
  eventKind: string;
  component?: "application" | "greeting";
  status?: "pending" | "attempted" | "verified" | "failed";
  evidenceCode: string;
  evidence?: Record<string, unknown>;
  reason?: string;
  draftRevisionId?: string;
  draftSha256?: string;
  reservationId?: string;
}): Promise<DeliveryRecord> {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc("record_reviewed_delivery_attempt", {
    target_opportunity_id: input.opportunityId,
    target_request_id: input.requestId,
    event_kind: input.eventKind,
    component_name: input.component ?? null,
    component_status: input.status ?? null,
    evidence_code: input.evidenceCode,
    evidence_payload: input.evidence ?? {},
    reason_text: input.reason ?? null,
    target_draft_revision_id: input.draftRevisionId ?? null,
    target_draft_sha256: input.draftSha256 ?? null,
    target_reservation_id: input.reservationId ?? null
  });
  if (error) {
    const safeCodes = [
      "invalid_delivery_attempt",
      "invalid_delivery_evidence",
      "delivery_not_found",
      "stale_delivery_revision",
      "stale_delivery_hash",
      "delivery_reservation_not_found"
    ];
    const safeCode = safeCodes.find((code) => error.message.includes(code));
    throw new Error("记录投递进度失败" + (safeCode ? "（" + safeCode + "）" : ""));
  }
  return mapDeliveryRecord(deliveryRecordRowSchema.parse(data));
}

export async function listDeliveryRecords(opportunityIds?: string[]): Promise<DeliveryRecord[]> {
  if (opportunityIds?.length === 0) return [];
  const client = await getSupabaseClient();
  if (opportunityIds) {
    const rows: z.infer<typeof deliveryRecordRowSchema>[] = [];
    const ids = [...new Set(opportunityIds)];
    for (let index = 0; index < ids.length; index += 100) {
      let cursor: string | undefined;
      while (true) {
        let query = client.from("delivery_records").select("*").in("opportunity_id", ids.slice(index, index + 100))
          .order("opportunity_id", { ascending: true }).limit(100);
        if (cursor) query = query.gt("opportunity_id", cursor);
        const { data, error } = await query;
        if (error) throw new Error("读取投递记录失败");
        const result = z.array(deliveryRecordRowSchema).parse(data);
        if (!result.length) break;
        const next = result.at(-1)!.opportunity_id;
        if (cursor && next <= cursor) throw new Error("读取投递记录失败");
        rows.push(...result);
        cursor = next;
        if (result.length === ids.slice(index, index + 100).length) break;
      }
    }
    return rows.sort((left, right) => right.updated_at.localeCompare(left.updated_at)).map(mapDeliveryRecord);
  }
  const { data, error } = await client.from("delivery_records")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new Error("读取投递记录失败");
  return z.array(deliveryRecordRowSchema).parse(data).map(mapDeliveryRecord);
}

export async function listDeliveryAttempts(): Promise<DeliveryAttempt[]> {
  const client = await getSupabaseClient();
  const { data, error } = await client.from("delivery_attempts")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) throw new Error("读取投递历史失败");
  return z.array(deliveryAttemptRowSchema).parse(data).map((row) => ({
    id: row.id,
    requestId: row.request_id,
    opportunityId: row.opportunity_id,
    eventKind: row.event_kind,
    evidenceCode: row.evidence_code,
    evidence: row.evidence,
    createdAt: row.created_at
  }));
}

export async function listEvaluations(opportunityId?: string): Promise<EvaluationRecord[]> {
  const client = await getSupabaseClient();
  const { data, error } = opportunityId
    ? { data: await readAllRows("evaluations", evaluationRowSchema, "id", "读取模型评估失败", opportunityId), error: null }
    : await client.from("evaluations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error("读取模型评估失败");
  return z.array(evaluationRowSchema).parse(data).sort((left, right) => right.created_at.localeCompare(left.created_at)).map((row) => ({
    id: row.id,
    opportunityId: row.opportunity_id,
    outcome: row.outcome,
    score: row.score ?? undefined,
    reasons: row.reasons,
    jdEvidence: row.jd_evidence,
    factIds: row.fact_ids,
    profileId: row.profile_id,
    ruleVersion: row.rule_version,
    promptVersion: row.prompt_version,
    model: {
      route: row.model_route,
      provider: row.provider,
      model: row.model,
      promptVersion: row.prompt_version,
      createdAt: row.created_at
    },
    createdAt: row.created_at
  }));
}

export async function listOpportunityEvents(opportunityId?: string): Promise<OpportunityEvent[]> {
  const client = await getSupabaseClient();
  const { data, error } = opportunityId
    ? { data: await readAllRows("opportunity_events", eventRowSchema, "id", "读取职位历史失败", opportunityId), error: null }
    : await client.from("opportunity_events")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) throw new Error("读取职位历史失败");
  return z.array(eventRowSchema).parse(data).sort((left, right) => left.created_at.localeCompare(right.created_at)).map((row) => ({
    id: row.id,
    opportunityId: row.opportunity_id,
    kind: row.kind,
    version: row.schema_version,
    actor: row.actor,
    payload: row.payload,
    createdAt: row.created_at
  }));
}

export async function invokeModelGateway(
  body: Record<string, unknown>,
  byokKey?: string
): Promise<unknown> {
  const client = await getSupabaseClient();
  const headers = byokKey ? { "x-jobflow-byok-key": byokKey } : undefined;
  const { data, error } = await client.functions.invoke("model-gateway", { body, headers });
  if (error) {
    let code = "request_failed";
    let diagnosticMessage = "";
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const payload: unknown = await context.clone().json();
        if (payload && typeof payload === "object") {
          const value = (payload as { error?: { code?: unknown } }).error?.code;
          if (typeof value === "string") code = value;
          diagnosticMessage = reportModelOutputDiagnostic(
            (payload as { error?: { diagnostics?: unknown } }).error?.diagnostics
          );
        }
      } catch {
        code = "request_failed";
      }
    }
    const messages: Record<string, string> = {
      unauthorized: "登录状态无效，请重新登录",
      managed_quota_unavailable: "VIP 托管模型额度不可用",
      managed_not_configured: "托管模型尚未配置",
      missing_byok_key: "当前设备没有 BYOK Key",
      blocked_endpoint: "自定义模型地址不符合公网安全要求",
      dns_failed: "自定义模型域名无法解析",
      redirect_rejected: "模型地址重定向次数过多",
      cross_origin_redirect: "模型地址尝试跨域重定向",
      provider_http_error: "模型供应商拒绝了请求",
      provider_response_too_large: "模型供应商响应过大",
      invalid_schema: "模型输出结构无效",
      model_output_invalid: "模型输出结构无效",
      invalid_request_schema: "模型网关请求结构无效",
      invalid_operation_payload: "模型操作数据结构无效",
      trusted_data_invalid: "云端画像或职位数据结构无效",
      provider_envelope_invalid: "模型供应商响应协议不兼容",
      invalid_model_json: "模型没有返回有效 JSON",
      ungrounded_profile: "模型画像包含无法定位的简历证据",
      ungrounded_jd_evidence: "模型结果包含无法定位的 JD 证据",
      unapproved_resume_fact: "模型引用了未批准的简历事实",
      unsafe_greeting: "模型生成的招呼语未通过安全校验"
    };
    throw new Error(diagnosticMessage || messages[code] || "模型服务请求失败");
  }
  return data;
}

export async function appendUserEvent(
  opportunityId: string,
  kind: "user_excluded" | "user_override" | "draft_edited",
  payload: Record<string, unknown>
): Promise<void> {
  const client = await getSupabaseClient();
  const { error } = await client.rpc("append_user_opportunity_event", {
    target_opportunity_id: opportunityId,
    event_kind: kind,
    event_payload: payload
  });
  if (error) throw new Error("更新职位记录失败");
}

function mapOpportunitySummary(row: z.infer<typeof opportunitySummaryRowSchema>): OpportunityRecord {
  return mapOpportunity({ ...row, card_text: "", description: null, recruiter: null, recruiter_title: null, jd_hash: null });
}

function mapOpportunity(row: z.infer<typeof opportunityRowSchema>): OpportunityRecord {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    platformJobId: row.platform_job_id,
    canonicalUrl: row.canonical_url,
    title: row.title,
    company: row.company,
    location: row.location,
    salary: row.salary,
    experience: row.experience,
    education: row.education,
    cardText: row.card_text,
    description: row.description ?? undefined,
    recruiter: row.recruiter ?? undefined,
    recruiterTitle: row.recruiter_title ?? undefined,
    jdHash: row.jd_hash ?? undefined,
    status: row.current_status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    latestReason: row.latest_reason ?? undefined
  };
}

function mapDeliveryRecord(row: z.infer<typeof deliveryRecordRowSchema>): DeliveryRecord {
  return {
    opportunityId: row.opportunity_id,
    platform: row.platform,
    platformJobId: row.platform_job_id,
    resumeMode: row.resume_mode,
    overallStatus: row.overall_status,
    applicationStatus: row.application_status,
    greetingStatus: row.greeting_status,
    draftRevisionId: row.draft_revision_id ?? undefined,
    draftSha256: row.draft_sha256 ?? undefined,
    reservationId: row.reservation_id ?? undefined,
    latestReason: row.latest_reason ?? undefined,
    updatedAt: row.updated_at
  };
}
