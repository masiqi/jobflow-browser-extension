import { z } from "zod";
import {
  activateProfile,
  appendUserEvent,
  deleteMyProductData,
  getAuthProjection,
  invokeModelGateway,
  loadActiveFilterConfig,
  listDrafts,
  listEvaluations,
  listOpportunities,
  listOpportunityEvents,
  listResumeProfiles,
  login,
  logout,
  register,
  recordJobDetails,
  saveDraftProfile,
  saveFilterConfig,
  updateDraftProfile,
  upsertCandidates
} from "./backend/supabase";
import { DEFAULT_SETTINGS } from "./defaults";
import { completeCurrentItem, createBatchRun, isAutomaticallyTerminal } from "./domain/batch";
import { detailJobSchema, decodeRuntimeRequest, listCandidateSchema, type RuntimeRequest } from "./domain/messages";
import { evaluateRules, jobKey } from "./filters";
import { normalizeChatCompletionsEndpoint } from "./llm";
import { deleteUserResumes, getResumeMetadata } from "./local/resume-store";
import {
  parseGreetingDecision,
  parseSuitabilityDecision
} from "./prompt";
import { createDraftResumeProfile, sourceHash } from "./resume";
import {
  clearByokKey,
  clearDeviceOwner,
  clearLegacyData,
  getByokKey,
  getRun,
  getScanPreview,
  ensureDeviceOwner,
  loadSettings,
  saveRun,
  saveScanPreview,
  saveSettings,
  setByokKey
} from "./storage";
import type {
  AppState,
  BatchItem,
  BatchRun,
  DetailJob,
  ExtensionSettings,
  ListCandidate,
  OpportunityRecord,
  ResumeProfile,
  ScanPreview
} from "./types";

const QUEUE_ALARM = "jobflow:queue";
const DETAIL_ALARM_PREFIX = "jobflow:detail:";

type PostDetailStage = "evaluating" | "generating";
interface PostDetailResult {
  status: "draft_ready" | "excluded" | "review_required";
  reason?: string;
  filter: NonNullable<BatchItem["filter"]>;
  suitability?: NonNullable<BatchItem["suitability"]>;
}

function now(): string {
  return new Date().toISOString();
}

function responseData(data?: unknown): { ok: true; data?: unknown } {
  return data === undefined ? { ok: true } : { ok: true, data };
}

function responseError(error: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "操作失败"
  };
}

function unwrapGateway(value: unknown): unknown {
  if (!value || typeof value !== "object") throw new Error("模型服务响应无效");
  const envelope = value as { ok?: unknown; result?: unknown; error?: { message?: unknown } };
  if (envelope.ok !== true) {
    throw new Error(typeof envelope.error?.message === "string" ? envelope.error.message : "模型服务处理失败");
  }
  return envelope.result;
}

async function modelFingerprint(settings: ExtensionSettings): Promise<string> {
  return sourceHash(JSON.stringify({
    provider: settings.model.provider,
    endpoint: settings.model.endpoint,
    model: settings.model.model
  }));
}

async function invokeModel(
  operation: "test_provider" | "extract_resume_profile" | "evaluate_opportunity" | "generate_greeting" | "record_filter" | "record_failure" | "edit_draft",
  payload: Record<string, unknown>,
  settings: ExtensionSettings,
  needsModel = true
): Promise<unknown> {
  let byokKey = "";
  if (settings.model.route === "byok" && needsModel) {
    const auth = await getAuthProjection();
    if (auth.status !== "signed_in" || !auth.userId) throw new Error("请先登录");
    byokKey = await getByokKey(auth.userId);
    if (!byokKey) throw new Error("请先配置 BYOK 模型密钥");
    if (operation !== "test_provider"
      && (!settings.model.connectionTestedAt || settings.model.testedFingerprint !== await modelFingerprint(settings))) {
      throw new Error("模型配置变更后需要重新连接测试");
    }
  }
  return invokeModelGateway({
    operation,
    requestId: crypto.randomUUID(),
    route: settings.model.route,
    provider: settings.model.provider,
    endpoint: settings.model.endpoint,
    model: settings.model.model || "managed",
    payload
  }, byokKey || undefined);
}

async function activeProfile(): Promise<ResumeProfile | null> {
  const profiles = await listResumeProfiles();
  const profile = profiles.find((item) => item.state === "active");
  return profile ? { ...profile, facts: profile.facts.filter((fact) => fact.approved) } : null;
}

async function getLocalResumeState(profile: ResumeProfile | null, userId?: string) {
  if (!profile || !userId) return "missing" as const;
  const metadata = await getResumeMetadata(userId, profile.sourceHash);
  if (!metadata) return "missing" as const;
  return metadata.sourceHash === profile.sourceHash ? "available" as const : "version_mismatch" as const;
}

async function getAppState(): Promise<AppState> {
  const auth = await getAuthProjection();
  if (auth.status !== "signed_in" || !auth.userId) {
    return {
      auth,
      settings: structuredClone(DEFAULT_SETTINGS),
      resumeProfile: null,
      resumeProfiles: [],
      localResumeState: "missing",
      scanPreview: null,
      run: null,
      opportunities: [],
      evaluations: [],
      events: [],
      drafts: []
    };
  }
  await ensureDeviceOwner(auth.userId);
  let settings = await loadSettings();
  const cloudRules = await loadActiveFilterConfig();
  if (cloudRules) {
    settings = { ...settings, rules: cloudRules };
    await saveSettings(settings);
  }
  const [profiles, opportunities, evaluations, events, drafts] = await Promise.all([
    listResumeProfiles(),
    listOpportunities(),
    listEvaluations(),
    listOpportunityEvents(),
    listDrafts()
  ]);
  const profile = profiles.find((item) => item.state === "draft")
    ?? profiles.find((item) => item.state === "active")
    ?? null;
  return {
    auth,
    settings,
    resumeProfile: profile,
    resumeProfiles: profiles,
    localResumeState: await getLocalResumeState(profile, auth.userId),
    scanPreview: await getScanPreview(),
    run: await getRun(),
    opportunities,
    evaluations,
    events,
    drafts
  };
}

async function openSidePanel(sender: chrome.runtime.MessageSender): Promise<void> {
  const tabId = sender.tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (typeof tabId !== "number") throw new Error("无法确定当前标签页");
  await chrome.sidePanel.open({ tabId });
}

async function scanCurrentTab(): Promise<ScanPreview> {
  const auth = await getAuthProjection();
  if (auth.status !== "signed_in") throw new Error("请先登录");
  const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (typeof tab?.id !== "number" || !tab.url?.includes(".liepin.com/")) {
    throw new Error("请在猎聘职位列表页扫描");
  }
  const raw: unknown = await chrome.tabs.sendMessage(tab.id, { type: "CONTENT_SCAN" });
  const result = z.object({
    sourceUrl: z.string().url(),
    candidates: z.array(listCandidateSchema).max(500)
  }).strict().parse(raw);
  const existing = await listOpportunities();
  const existingByKey = new Map(existing.map((item) => [item.platform + ":" + item.platformJobId, item]));
  const stored = await upsertCandidates(result.candidates);
  const settings = await loadSettings();
  const processable = result.candidates.filter((candidate) => {
    const prior = existingByKey.get(jobKey(candidate));
    return !prior || prior.status === "discovered" || prior.status === "failed";
  });
  const preview: ScanPreview = {
    sourceUrl: result.sourceUrl,
    candidates: result.candidates,
    observedCount: result.candidates.length,
    newCount: result.candidates.filter((item) => !existingByKey.has(jobKey(item))).length,
    duplicateCount: result.candidates.filter((item) => existingByKey.has(jobKey(item))).length,
    excludedCount: stored.filter((item) =>
      item.status === "deterministic_excluded"
      || item.status === "model_excluded"
      || item.status === "user_excluded"
    ).length,
    draftedCount: stored.filter((item) => item.status === "draft_ready").length,
    processableJobIds: processable.map((item) => item.jobId),
    selectedJobIds: processable.slice(0, settings.maxJobsPerBatch).map((item) => item.jobId)
  };
  await saveScanPreview(preview);
  await notifyState();
  return preview;
}

async function startBatch(selectedJobIds: string[]): Promise<BatchRun> {
  const profile = await activeProfile();
  if (!profile) throw new Error("请先审核并启用简历画像");
  const preview = await getScanPreview();
  if (!preview) throw new Error("请先扫描当前职位列表");
  const settings = await loadSettings();
  const processable = new Set(preview.processableJobIds);
  if (selectedJobIds.some((jobId) => !processable.has(jobId))) {
    throw new Error("只能选择尚未处理的新职位");
  }
  if (selectedJobIds.length > settings.maxJobsPerBatch || selectedJobIds.length > 20) {
    throw new Error("本批职位数量超过设置上限");
  }
  const auth = await getAuthProjection();
  if (settings.model.route === "byok"
    && (auth.status !== "signed_in" || !auth.userId || !(await getByokKey(auth.userId)))) {
    throw new Error("请先配置 BYOK 模型密钥");
  }
  const createdAt = now();
  const run = createBatchRun(preview, selectedJobIds, createdAt, crypto.randomUUID());
  await saveRun(run);
  await scheduleQueue(100);
  await notifyState();
  return run;
}

function detailAlarmName(runId: string, leaseId: string): string {
  return DETAIL_ALARM_PREFIX + runId + ":" + leaseId;
}

async function scheduleQueue(delayMs = 300): Promise<void> {
  await chrome.alarms.create(QUEUE_ALARM, { when: Date.now() + delayMs });
}

async function closeItemTab(item: BatchItem): Promise<void> {
  if (typeof item.tabId === "number") await chrome.tabs.remove(item.tabId).catch(() => undefined);
  item.tabId = undefined;
  item.leaseId = undefined;
}

async function persistProcessingFailure(
  opportunityId: string,
  error: unknown,
  settings?: ExtensionSettings
): Promise<void> {
  const errorCode = (error instanceof Error ? error.message : "处理失败").slice(0, 200);
  try {
    await invokeModel("record_failure", {
      opportunityId,
      errorCode
    }, settings ?? await loadSettings(), false);
  } catch {
    // Failure recording is best-effort and must not block queue or retry cleanup.
  }
}

async function finishItem(
  run: BatchRun,
  item: BatchItem,
  status: BatchItem["status"],
  error?: string
): Promise<void> {
  const leaseId = item.leaseId;
  if (leaseId) await chrome.alarms.clear(detailAlarmName(run.id, leaseId));
  await closeItemTab(item);
  if (status === "failed" && error) {
    const record = (await listOpportunities().catch(() => []))
      .find((candidate) => candidate.platform === item.candidate.platform
        && candidate.platformJobId === item.candidate.jobId);
    if (record) {
      await persistProcessingFailure(record.id, error);
    }
  }
  const updated = completeCurrentItem(run, status, now(), error);
  const latest = await getRun();
  if (latest?.id === updated.id && (latest.status === "paused" || latest.status === "cancelled")) {
    updated.status = latest.status;
  }
  await saveRun(updated);
  await notifyState();
  if (updated.status === "running") await scheduleQueue();
}

async function processNext(): Promise<void> {
  const run = await getRun();
  if (!run || run.status !== "running") return;
  if (run.currentIndex >= run.items.length) {
    run.status = "completed";
    await saveRun(run);
    await notifyState();
    return;
  }
  const item = run.items[run.currentIndex];
  if (!item || item.status !== "queued") return;
  const records = await listOpportunities();
  const record = records.find((candidate) =>
    candidate.platform === item.candidate.platform
    && candidate.platformJobId === item.candidate.jobId
  );
  if (!record) return finishItem(run, item, "failed", "职位记录不存在");
  if (isAutomaticallyTerminal(record.status)) {
    const status = record.status === "review_required"
      ? "review_required"
      : record.status === "draft_ready"
        ? "draft_ready"
        : "excluded";
    return finishItem(run, item, status, "已存在持久处理记录");
  }
  item.status = "opening";
  item.startedAt = now();
  item.attempt += 1;
  item.leaseId = crypto.randomUUID();
  const url = new URL(item.candidate.url);
  url.hash = "jobflow-lease=" + item.leaseId;
  const tab = await chrome.tabs.create({ url: url.toString(), active: false });
  if (typeof tab.id !== "number") return finishItem(run, item, "failed", "无法创建详情标签页");
  item.tabId = tab.id;
  await saveRun(run);
  await chrome.alarms.create(detailAlarmName(run.id, item.leaseId), {
    when: Date.now() + (await loadSettings()).detailTimeoutSeconds * 1000
  });
  await notifyState();
}

function opportunityForJob(records: OpportunityRecord[], job: DetailJob): OpportunityRecord | undefined {
  return records.find((item) => item.platform === job.platform && item.platformJobId === job.jobId);
}

async function processPostDetail(
  opportunityId: string,
  job: DetailJob,
  settings: ExtensionSettings,
  profile: ResumeProfile,
  onStage: (stage: PostDetailStage) => Promise<void> = async () => undefined
): Promise<PostDetailResult> {
  const filter = evaluateRules(job, settings.rules);
  if (filter.outcome !== "pass") {
    await invokeModel("record_filter", {
      opportunityId,
      job,
      filter
    }, settings, false);
    return {
      status: filter.outcome === "exclude" ? "excluded" : "review_required",
      reason: filter.decisions.map((decision) => decision.reason).join("；"),
      filter
    };
  }

  await onStage("evaluating");
  const suitabilityRaw = unwrapGateway(await invokeModel("evaluate_opportunity", {
    opportunityId,
    job,
    profile,
    filter
  }, settings));
  const suitability = parseSuitabilityDecision(suitabilityRaw, job, profile);
  if (suitability.outcome === "exclude") {
    return { status: "excluded", reason: suitability.reasons.join("；"), filter, suitability };
  }
  if (suitability.outcome === "review") {
    return { status: "review_required", reason: suitability.reasons.join("；"), filter, suitability };
  }

  await onStage("generating");
  const greetingRaw = unwrapGateway(await invokeModel("generate_greeting", {
    opportunityId,
    job,
    profile
  }, settings));
  parseGreetingDecision(greetingRaw, job, profile);
  return { status: "draft_ready", filter, suitability };
}

async function handleDetail(job: DetailJob, leaseId: string): Promise<void> {
  const run = await getRun();
  if (!run || (run.status !== "running" && run.status !== "paused")) return;
  const item = run.items[run.currentIndex];
  if (!item || item.leaseId !== leaseId || item.candidate.jobId !== job.jobId) return;
  if (item.status !== "opening" && item.status !== "extracting") return;
  await chrome.alarms.clear(detailAlarmName(run.id, leaseId));
  item.status = "extracting";
  item.candidate = { ...item.candidate, ...job };
  await saveRun(run);
  const records = await listOpportunities();
  const opportunity = opportunityForJob(records, job);
  if (!opportunity) return finishItem(run, item, "failed", "职位记录不存在");

  try {
    await recordJobDetails(opportunity.id, crypto.randomUUID(), job, await sourceHash(job.description));
    const settings = await loadSettings();
    const profile = await activeProfile();
    if (!profile) return finishItem(run, item, "review_required", "已启用画像不存在");
    const result = await processPostDetail(opportunity.id, job, settings, profile, async (status) => {
      item.status = status;
      await saveRun(run);
      await notifyState();
    });
    item.filter = result.filter;
    item.suitability = result.suitability;
    return finishItem(run, item, result.status, result.reason);
  } catch (error) {
    return finishItem(run, item, "failed", error instanceof Error ? error.message : "处理失败");
  }
}

async function pauseBatch(): Promise<void> {
  const run = await getRun();
  if (run?.status === "running") {
    run.status = "paused";
    await saveRun(run);
    await notifyState();
  }
}

async function resumeBatch(): Promise<void> {
  const run = await getRun();
  if (run?.status === "paused") {
    run.status = "running";
    await saveRun(run);
    await scheduleQueue(100);
    await notifyState();
  }
}

async function cancelBatch(): Promise<void> {
  const run = await getRun();
  if (!run || run.status === "completed" || run.status === "cancelled" || run.status === "failed") return;
  run.status = "cancelled";
  const item = run.items[run.currentIndex];
  if (item?.leaseId) await chrome.alarms.clear(detailAlarmName(run.id, item.leaseId));
  if (item) await closeItemTab(item);
  await saveRun(run);
  await notifyState();
}

async function testModel(): Promise<void> {
  const settings = await loadSettings();
  unwrapGateway(await invokeModel("test_provider", {}, settings));
  settings.model.connectionTestedAt = now();
  settings.model.testedFingerprint = await modelFingerprint(settings);
  await saveSettings(settings);
}

async function importResume(request: Extract<RuntimeRequest, { type: "IMPORT_RESUME" }>): Promise<ResumeProfile> {
  const settings = await loadSettings();
  const existing = (await listResumeProfiles()).find((profile) => profile.sourceHash === request.sourceHash);
  if (existing) return existing;
  const result = unwrapGateway(await invokeModel("extract_resume_profile", {
    normalizedText: request.normalizedText
  }, settings));
  const profiles = await listResumeProfiles();
  const profile = createDraftResumeProfile({
    sourceName: request.sourceName,
    sourceKind: request.sourceKind,
    sourceHash: request.sourceHash,
    normalizedText: request.normalizedText,
    modelOutput: result,
    version: profiles.length + 1
  });
  const savedId = await saveDraftProfile(profile);
  return (await listResumeProfiles()).find((item) => item.id === savedId) ?? profile;
}

function detailJobFromOpportunity(opportunity: OpportunityRecord): DetailJob {
  return detailJobSchema.parse({
    platform: opportunity.platform,
    jobId: opportunity.platformJobId,
    url: opportunity.canonicalUrl,
    canonicalUrl: opportunity.canonicalUrl,
    title: opportunity.title,
    company: opportunity.company,
    location: opportunity.location,
    salary: opportunity.salary,
    experience: opportunity.experience,
    education: opportunity.education,
    cardText: opportunity.cardText,
    index: 0,
    description: opportunity.description,
    recruiter: opportunity.recruiter ?? "",
    recruiterTitle: opportunity.recruiterTitle ?? ""
  });
}

async function findOpportunityAndProfile(opportunityId: string) {
  const [opportunities, profile] = await Promise.all([listOpportunities(), activeProfile()]);
  const opportunity = opportunities.find((item) => item.id === opportunityId);
  if (!opportunity || !opportunity.description) throw new Error("职位详情不可用");
  if (!profile) throw new Error("已启用画像不存在");
  const job = detailJobFromOpportunity(opportunity);
  return { opportunity, profile, job };
}

async function requireRetryModelReady(
  settings: ExtensionSettings,
  userId: string,
  hasManagedEntitlement: boolean
): Promise<void> {
  if (settings.model.route === "managed") {
    if (!hasManagedEntitlement) throw new Error("当前账号没有托管模型权益");
    return;
  }
  if (!(await getByokKey(userId))) throw new Error("请先配置 BYOK 模型密钥");
  if (!settings.model.connectionTestedAt
    || settings.model.testedFingerprint !== await modelFingerprint(settings)) {
    throw new Error("请先完成当前 BYOK 模型连接测试");
  }
}

async function retryStoredOpportunity(opportunityId: string): Promise<PostDetailResult> {
  const auth = await getAuthProjection();
  if (auth.status !== "signed_in" || !auth.userId) throw new Error("请先登录");
  const opportunity = (await listOpportunities()).find((item) => item.id === opportunityId);
  if (!opportunity || opportunity.userId !== auth.userId) throw new Error("职位记录不存在或不属于当前账号");
  if (opportunity.status !== "failed") throw new Error("只有处理失败的职位可以重试");
  if (!opportunity.description?.trim()) throw new Error("职位详情不可用，无法从已保存记录重试");

  const [settings, profile] = await Promise.all([loadSettings(), activeProfile()]);
  if (!profile || !profile.facts.some((fact) => fact.approved)) {
    throw new Error("请先审核并启用包含可引用事实的简历画像");
  }
  await requireRetryModelReady(settings, auth.userId, auth.vip === true);

  try {
    let job: DetailJob;
    try {
      job = detailJobFromOpportunity(opportunity);
    } catch {
      throw new Error("已保存职位详情格式无效");
    }
    const result = await processPostDetail(opportunity.id, job, settings, profile);
    await notifyState();
    return result;
  } catch (error) {
    await persistProcessingFailure(opportunity.id, error, settings);
    await notifyState();
    throw error;
  }
}

async function generateForOpportunity(opportunityId: string): Promise<void> {
  const settings = await loadSettings();
  const { profile, job } = await findOpportunityAndProfile(opportunityId);
  const output = unwrapGateway(await invokeModel("generate_greeting", {
    opportunityId,
    job,
    profile
  }, settings));
  parseGreetingDecision(output, job, profile);
}

async function handleReviewDecision(
  opportunityId: string,
  decision: "continue_generation" | "permanently_exclude"
): Promise<void> {
  if (decision === "permanently_exclude") {
    await appendUserEvent(opportunityId, "user_excluded", { reason: "用户在复核中永久排除" });
    return;
  }
  const evaluations = await listEvaluations();
  if (!evaluations.some((evaluation) => evaluation.opportunityId === opportunityId)) {
    const settings = await loadSettings();
    const { profile, job } = await findOpportunityAndProfile(opportunityId);
    const output = unwrapGateway(await invokeModel("evaluate_opportunity", {
      opportunityId,
      job,
      profile,
      filter: { outcome: "review", decisions: [] }
    }, settings));
    const suitability = parseSuitabilityDecision(output, job, profile);
    if (suitability.outcome !== "proceed") return;
  }
  await generateForOpportunity(opportunityId);
}

async function notifyState(): Promise<void> {
  await chrome.runtime.sendMessage({ type: "RUN_UPDATED" }).catch(() => undefined);
}

async function handleRequest(
  request: RuntimeRequest,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (request.type) {
    case "OPEN_SIDE_PANEL":
      await openSidePanel(sender);
      return undefined;
    case "GET_LAUNCHER_VISIBILITY":
      return (await loadSettings()).launcherVisible;
    case "SCAN_CURRENT_TAB":
      return scanCurrentTab();
    case "START_BATCH":
      return startBatch(request.selectedJobIds);
    case "PAUSE_BATCH":
      await pauseBatch();
      return undefined;
    case "RESUME_BATCH":
      await resumeBatch();
      return undefined;
    case "CANCEL_BATCH":
      await cancelBatch();
      return undefined;
    case "GET_APP_STATE":
      return getAppState();
    case "UPDATE_SETTINGS": {
      const prior = await loadSettings();
      request.settings.model.endpoint = normalizeChatCompletionsEndpoint(request.settings.model.endpoint);
      const modelChanged = prior.model.route !== request.settings.model.route
        || prior.model.provider !== request.settings.model.provider
        || prior.model.endpoint !== request.settings.model.endpoint
        || prior.model.model !== request.settings.model.model;
      if (modelChanged) {
        request.settings.model.connectionTestedAt = undefined;
        request.settings.model.testedFingerprint = undefined;
      } else {
        request.settings.model.connectionTestedAt = prior.model.connectionTestedAt;
        request.settings.model.testedFingerprint = prior.model.testedFingerprint;
      }
      if ((await getAuthProjection()).status === "signed_in") {
        const activeRules = await loadActiveFilterConfig();
        if (JSON.stringify(activeRules) !== JSON.stringify(request.settings.rules)) {
          await saveFilterConfig(request.settings.rules);
        }
      }
      return saveSettings(request.settings);
    }
    case "AUTH_REGISTER": {
      const auth = await register(request.email, request.password);
      if (auth.userId) await ensureDeviceOwner(auth.userId);
      return auth;
    }
    case "AUTH_LOGIN": {
      const auth = await login(request.email, request.password);
      if (auth.userId) await ensureDeviceOwner(auth.userId);
      return auth;
    }
    case "AUTH_LOGOUT":
      await cancelBatch();
      await logout();
      await clearDeviceOwner();
      return undefined;
    case "SET_BYOK_KEY": {
      const auth = await getAuthProjection();
      if (auth.status !== "signed_in" || !auth.userId) throw new Error("请先登录");
      await setByokKey(request.apiKey, request.remember, auth.userId);
      return undefined;
    }
    case "CLEAR_BYOK_KEY":
      await clearByokKey();
      return undefined;
    case "TEST_MODEL":
      await testModel();
      return undefined;
    case "IMPORT_RESUME":
      return importResume(request);
    case "SAVE_PROFILE":
      await updateDraftProfile(request.profile);
      return undefined;
    case "ACTIVATE_PROFILE":
      await activateProfile(request.profileId);
      return undefined;
    case "DETAIL_READY":
      await handleDetail(request.job, request.leaseId);
      return undefined;
    case "DETAIL_FAILED": {
      const run = await getRun();
      const item = run?.items[run.currentIndex];
      if (run && item?.leaseId === request.leaseId && item.candidate.jobId === request.jobId) {
        await finishItem(run, item, "failed", request.error);
      }
      return undefined;
    }
    case "RETRY_STORED_OPPORTUNITY":
      await retryStoredOpportunity(request.opportunityId);
      return undefined;
    case "EDIT_DRAFT": {
      const settings = await loadSettings();
      await invokeModel("edit_draft", {
        opportunityId: request.opportunityId,
        text: request.text
      }, settings, false);
      return undefined;
    }
    case "REGENERATE_DRAFT":
      await generateForOpportunity(request.opportunityId);
      return undefined;
    case "REVIEW_DECISION":
      await handleReviewDecision(request.opportunityId, request.decision);
      return undefined;
    case "CONTINUE_AS_EXCEPTION":
      await appendUserEvent(request.opportunityId, "user_override", { reason: "用户选择作为例外继续" });
      await generateForOpportunity(request.opportunityId);
      return undefined;
    case "CLEAR_LEGACY_DATA":
      await clearLegacyData();
      return undefined;
    case "DELETE_MY_DATA": {
      const auth = await getAuthProjection();
      if (auth.status !== "signed_in" || !auth.userId) throw new Error("请先登录");
      await deleteMyProductData();
      await deleteUserResumes(auth.userId);
      await clearDeviceOwner();
      await ensureDeviceOwner(auth.userId);
      return undefined;
    }
    case "CONTENT_SCAN":
    case "RUN_UPDATED":
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  let request: RuntimeRequest;
  try {
    request = decodeRuntimeRequest(message);
  } catch {
    sendResponse(responseError(new Error("消息格式无效")));
    return false;
  }
  void handleRequest(request, sender)
    .then((data) => sendResponse(responseData(data)))
    .catch((error) => sendResponse(responseError(error)));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === QUEUE_ALARM) {
    void processNext();
    return;
  }
  if (!alarm.name.startsWith(DETAIL_ALARM_PREFIX)) return;
  void (async () => {
    const run = await getRun();
    const item = run?.items[run.currentIndex];
    if ((run?.status === "running" || run?.status === "paused")
      && item?.leaseId
      && detailAlarmName(run.id, item.leaseId) === alarm.name) {
      await finishItem(run, item, "failed", "详情页读取超时");
    }
  })();
});

async function recoverRun(): Promise<void> {
  const run = await getRun();
  if (!run || run.status !== "running") return;
  const item = run.items[run.currentIndex];
  if (item?.status === "opening" && typeof item.tabId === "number") {
    const exists = await chrome.tabs.get(item.tabId).then(() => true).catch(() => false);
    if (!exists) await finishItem(run, item, "failed", "详情标签页已关闭");
    return;
  }
  await scheduleQueue(250);
}

chrome.runtime.onStartup.addListener(() => { void recoverRun(); });
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void recoverRun();
});

void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
