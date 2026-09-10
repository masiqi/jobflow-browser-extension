import { z } from "zod";

const platformSchema = z.literal("liepin");

export const listCandidateSchema = z.object({
  platform: platformSchema,
  jobId: z.string().min(1).max(128),
  url: z.string().url().max(2048),
  canonicalUrl: z.string().url().max(2048),
  title: z.string().max(300),
  company: z.string().max(300),
  location: z.string().max(200),
  salary: z.string().max(100),
  experience: z.string().max(100),
  education: z.string().max(100),
  cardText: z.string().max(6000),
  index: z.number().int().nonnegative()
}).strict();

export const detailJobSchema = listCandidateSchema.extend({
  description: z.string().min(1).max(60_000),
  recruiter: z.string().max(200),
  recruiterTitle: z.string().max(200)
}).strict();

const ruleEvidenceSchema = z.object({
  text: z.string().max(220),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative()
}).strict();

const ruleDecisionSchema = z.object({
  ruleId: z.string(),
  ruleVersion: z.number().int().positive(),
  outcome: z.enum(["pass", "exclude", "review"]),
  reason: z.string(),
  evidence: z.array(ruleEvidenceSchema)
}).strict();

const filterDecisionSchema = z.object({
  outcome: z.enum(["pass", "exclude", "review"]),
  decisions: z.array(ruleDecisionSchema)
}).strict();

const suitabilityDecisionSchema = z.object({
  outcome: z.enum(["proceed", "exclude", "review"]),
  score: z.number().min(0).max(100).optional(),
  reasons: z.array(z.string()),
  jdEvidence: z.array(z.string()),
  factIds: z.array(z.string())
}).strict();

export const scanPreviewSchema = z.object({
  sourceUrl: z.string().url(),
  candidates: z.array(listCandidateSchema).max(500),
  observedCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
  excludedCount: z.number().int().nonnegative(),
  draftedCount: z.number().int().nonnegative(),
  processableJobIds: z.array(z.string()),
  selectedJobIds: z.array(z.string()).max(20)
}).strict();

const batchItemSchema = z.object({
  candidate: listCandidateSchema,
  status: z.enum([
    "queued", "opening", "extracting", "evaluating", "generating",
    "draft_ready", "excluded", "review_required", "failed"
  ]),
  filter: filterDecisionSchema.optional(),
  suitability: suitabilityDecisionSchema.optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  tabId: z.number().int().optional(),
  leaseId: z.string().uuid().optional(),
  attempt: z.number().int().nonnegative()
}).strict();

export const batchRunSchema = z.object({
  id: z.string().uuid(),
  platform: z.literal("liepin"),
  status: z.enum(["queued", "running", "paused", "completed", "cancelled", "failed"]),
  sourceUrl: z.string().url(),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentIndex: z.number().int().nonnegative(),
  items: z.array(batchItemSchema).max(20),
  draftCount: z.number().int().nonnegative(),
  excludedCount: z.number().int().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative()
}).strict();

const ruleSettingsSchema = z.object({
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
  rejectedPrimaryTechnologies: z.array(z.string().max(64)).max(32)
}).strict();

const modelSettingsSchema = z.object({
  route: z.enum(["managed", "byok"]),
  provider: z.enum(["openai", "deepseek", "openrouter", "custom"]),
  endpoint: z.string().url().max(2048),
  model: z.string().min(1).max(200),
  rememberKey: z.boolean(),
  connectionTestedAt: z.string().optional(),
  testedFingerprint: z.string().optional()
}).strict();

export const extensionSettingsSchema = z.object({
  rules: ruleSettingsSchema,
  model: modelSettingsSchema,
  maxJobsPerBatch: z.number().int().min(1).max(20),
  detailTimeoutSeconds: z.number().int().min(15).max(180),
  launcherVisible: z.boolean()
}).strict();

const sourceKindSchema = z.enum(["pdf", "docx", "text", "markdown", "pasted"]);

export const resumeProfileSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  state: z.enum(["draft", "active", "stale"]),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceName: z.string().min(1).max(255),
  sourceKind: sourceKindSchema,
  analyzedAt: z.string(),
  activatedAt: z.string().optional(),
  summary: z.string().min(1).max(2000),
  targetRoles: z.array(z.string().min(1).max(120)).max(20),
  skills: z.array(z.string().min(1).max(120)).max(80),
  facts: z.array(z.object({
    id: z.string().min(1).max(80),
    text: z.string().min(1).max(500),
    keywords: z.array(z.string().min(1).max(80)).max(20),
    evidence: z.string().min(1).max(800),
    approved: z.boolean()
  }).strict()).min(1).max(30),
  constraints: z.array(z.string().min(1).max(300)).max(30)
}).strict();

export const runtimeRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("OPEN_SIDE_PANEL") }).strict(),
  z.object({ type: z.literal("GET_LAUNCHER_VISIBILITY") }).strict(),
  z.object({ type: z.literal("CONTENT_SCAN") }).strict(),
  z.object({ type: z.literal("SCAN_CURRENT_TAB") }).strict(),
  z.object({ type: z.literal("START_BATCH"), selectedJobIds: z.array(z.string().min(1).max(128)).min(1).max(20) }).strict(),
  z.object({ type: z.literal("PAUSE_BATCH") }).strict(),
  z.object({ type: z.literal("RESUME_BATCH") }).strict(),
  z.object({ type: z.literal("CANCEL_BATCH") }).strict(),
  z.object({ type: z.literal("GET_APP_STATE") }).strict(),
  z.object({ type: z.literal("UPDATE_SETTINGS"), settings: extensionSettingsSchema }).strict(),
  z.object({ type: z.literal("AUTH_REGISTER"), email: z.string().email().max(320), password: z.string().min(8).max(128) }).strict(),
  z.object({ type: z.literal("AUTH_LOGIN"), email: z.string().email().max(320), password: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal("AUTH_LOGOUT") }).strict(),
  z.object({ type: z.literal("SET_BYOK_KEY"), apiKey: z.string().min(1).max(4096), remember: z.boolean() }).strict(),
  z.object({ type: z.literal("CLEAR_BYOK_KEY") }).strict(),
  z.object({ type: z.literal("TEST_MODEL") }).strict(),
  z.object({
    type: z.literal("IMPORT_RESUME"),
    sourceName: z.string().min(1).max(255),
    sourceKind: sourceKindSchema,
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    normalizedText: z.string().min(100).max(100_000)
  }).strict(),
  z.object({ type: z.literal("SAVE_PROFILE"), profile: resumeProfileSchema }).strict(),
  z.object({ type: z.literal("ACTIVATE_PROFILE"), profileId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("DETAIL_READY"), job: detailJobSchema, leaseId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("DETAIL_FAILED"), jobId: z.string().max(128), leaseId: z.string().uuid(), error: z.string().max(500) }).strict(),
  z.object({ type: z.literal("EDIT_DRAFT"), opportunityId: z.string().uuid(), text: z.string().min(1).max(200) }).strict(),
  z.object({ type: z.literal("REGENERATE_DRAFT"), opportunityId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("REVIEW_DECISION"), opportunityId: z.string().uuid(), decision: z.enum(["continue_generation", "permanently_exclude"]) }).strict(),
  z.object({ type: z.literal("CONTINUE_AS_EXCEPTION"), opportunityId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("CLEAR_LEGACY_DATA") }).strict(),
  z.object({ type: z.literal("DELETE_MY_DATA") }).strict(),
  z.object({ type: z.literal("RUN_UPDATED") }).strict()
]);

export type RuntimeRequest = z.infer<typeof runtimeRequestSchema>;

export function decodeRuntimeRequest(input: unknown): RuntimeRequest {
  return runtimeRequestSchema.parse(input);
}
