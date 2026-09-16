import { z } from "zod";
import {
  activateProfile,
  appendUserEvent,
  deleteMyProductData,
  getAuthProjection,
  invokeModelGateway,
  loadActiveFilterConfig,
  listDeliveryRecords,
  listDrafts,
  listEvaluations,
  listOpportunities,
  listOpportunityEvents,
  listResumeProfiles,
  login,
  logout,
  markReviewedDeliveryWriteStarted,
  register,
  recordJobDetails,
  prepareReviewedDelivery,
  recordReviewedDeliveryAttempt,
  releaseReviewedDeliveryQuota,
  reserveReviewedDeliveryQuota,
  saveDraftProfile,
  saveFilterConfig,
  updateDraftProfile,
  upsertCandidates
} from "./backend/supabase";
import {
  DEFAULT_SETTINGS,
  LIEPIN_DETAIL_NAVIGATION_DELAY_MAX_SECONDS,
  LIEPIN_DETAIL_NAVIGATION_DELAY_MIN_SECONDS,
  LIEPIN_DETAIL_MIN_DWELL_SECONDS
} from "./defaults";
import {
  completeCurrentItem,
  completeDeliveryPartialAndPause,
  completeDeliverySucceeded,
  createBatchRun,
  isAutomaticallyTerminal,
  pauseCurrentItemBeforeWrite,
  secureRandomIntegerInRange,
  startDeliveryWait
} from "./domain/batch";
import { deliveryPartialReason } from "./domain/delivery";
import {
  detailJobSchema,
  decodeRuntimeRequest,
  listCandidateSchema,
  type DetailFailureCode,
  type RuntimeRequest
} from "./domain/messages";
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
  clearAutomaticWriteThrottle,
  clearLiepinNavigationThrottle,
  getAutomaticWriteThrottle,
  getByokKey,
  getLiepinNavigationThrottle,
  getRun,
  getScanPreview,
  ensureDeviceOwner,
  loadSettings,
  saveAutomaticWriteThrottle,
  saveLiepinNavigationThrottle,
  saveRun,
  saveScanPreview,
  saveSettings,
  setByokKey
} from "./storage";
import type {
  AppState,
  BatchItem,
  BatchRun,
  DeliveryRecord,
  DetailJob,
  ExtensionSettings,
  LiepinNavigationThrottle,
  ListCandidate,
  OpportunityRecord,
  ResumeProfile,
  ScanPreview
} from "./types";

const QUEUE_ALARM = "jobflow:queue";
const DETAIL_ALARM_PREFIX = "jobflow:detail:";
const AUTO_WRITE_ALARM_PREFIX = "jobflow:auto-write:";
const REVIEWED_SEND_LEASE_TTL_MS = 5 * 60 * 1000;
const REVIEWED_SEND_CONTENT_READY_TIMEOUT_MS = 15_000;
const REVIEWED_SEND_CONTENT_RETRY_INTERVAL_MS = 250;
const DELIVERY_CONTENT_TIMEOUT_MS = 120_000;

type PostDetailStage = "evaluating" | "generating";
interface PostDetailResult {
  status: "draft_ready" | "excluded" | "review_required";
  reason?: string;
  filter: NonNullable<BatchItem["filter"]>;
  suitability?: NonNullable<BatchItem["suitability"]>;
}

interface ReviewedSendLease {
  opportunityId: string;
  platformJobId: string;
  tabId: number;
  leaseId: string;
  draftRevisionId: string;
  draftSha256: string;
  preparedAt: number;
  openedByExtension: boolean;
}

const reviewedSendLeases = new Map<string, ReviewedSendLease>();
const reviewedSendExecuting = new Set<string>();
const userGenerationInFlight = new Set<string>();
let liepinLiveWriteLockOwner: string | null = null;

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
      drafts: [],
      deliveries: []
    };
  }
  await ensureDeviceOwner(auth.userId);
  let settings = await loadSettings();
  const cloudRules = await loadActiveFilterConfig();
  if (cloudRules) {
    settings = { ...settings, rules: cloudRules };
    await saveSettings(settings);
  }
  const [profiles, opportunities, evaluations, events, drafts, deliveries] = await Promise.all([
    listResumeProfiles(),
    listOpportunities(),
    listEvaluations(),
    listOpportunityEvents(),
    listDrafts(),
    listDeliveryRecords()
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
    drafts,
    deliveries
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

function isTrustedExtensionPageSender(sender: chrome.runtime.MessageSender, page: string): boolean {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  const expected = chrome.runtime.getURL(page);
  try {
    const senderUrl = new URL(sender.url);
    const expectedUrl = new URL(expected);
    return senderUrl.origin === expectedUrl.origin && senderUrl.pathname === expectedUrl.pathname;
  } catch {
    return false;
  }
}

function isTrustedSidePanelSender(sender: chrome.runtime.MessageSender): boolean {
  return isTrustedExtensionPageSender(sender, "sidepanel.html");
}

function jobIdFromTrustedLiepinPageUrl(value: string): string {
  try {
    const url = new URL(value);
    const isLiepinHost = url.hostname === "liepin.com" || url.hostname.endsWith(".liepin.com");
    if (url.protocol !== "https:" || !isLiepinHost) return "";
    const direct = url.pathname.match(/^\/(?:job|a)\/(\d+)\.shtml$/i)?.[1] || "";
    if (direct) return direct;
    const backUrl = url.searchParams.get("backurl");
    if (!backUrl) return "";
    const original = new URL(backUrl);
    const originalIsLiepin = original.hostname === "liepin.com" || original.hostname.endsWith(".liepin.com");
    if (original.protocol !== "https:" || !originalIsLiepin) return "";
    return original.pathname.match(/^\/(?:job|a)\/(\d+)\.shtml$/i)?.[1] || "";
  } catch {
    return "";
  }
}

function isTrustedLiepinContentSender(sender: chrome.runtime.MessageSender, jobId: string): boolean {
  if (sender.id !== chrome.runtime.id || typeof sender.tab?.id !== "number" || !sender.url) return false;
  return jobIdFromTrustedLiepinPageUrl(sender.url) === jobId;
}

async function startBatch(
  sender: chrome.runtime.MessageSender,
  selectedJobIds: string[],
  expectedExecutionPolicy: ExtensionSettings["executionPolicy"]
): Promise<BatchRun> {
  if (!isTrustedSidePanelSender(sender)) throw new Error("只能从扩展侧边栏启动批次");
  const existingRun = await getRun();
  if (existingRun && ["queued", "running", "paused"].includes(existingRun.status)) {
    throw new Error("已有批次正在进行，请先暂停、取消或等待完成");
  }
  const profile = await activeProfile();
  if (!profile) throw new Error("请先审核并启用简历画像");
  const preview = await getScanPreview();
  if (!preview) throw new Error("请先扫描当前职位列表");
  const settings = await loadSettings();
  if (settings.executionPolicy !== expectedExecutionPolicy) {
    throw new Error("执行策略已变化，请刷新侧边栏后重新开始");
  }
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
  const run = createBatchRun(preview, selectedJobIds, createdAt, crypto.randomUUID(), settings.executionPolicy);
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

function automaticWriteAlarmName(runId: string): string {
  return AUTO_WRITE_ALARM_PREFIX + runId;
}

async function persistNextAutomaticWriteThrottle(
  ownerId: string,
  platform: "liepin",
  writeStartedAt: string
): Promise<void> {
  const settings = await loadSettings();
  const scheduledDelaySeconds = secureRandomIntegerInRange(
    settings.automaticSendDelayMinSeconds,
    settings.automaticSendDelayMaxSeconds
  );
  await saveAutomaticWriteThrottle({
    ownerId,
    platform,
    lastWriteStartedAt: writeStartedAt,
    scheduledDelaySeconds,
    nextWriteEligibleAt: new Date(new Date(writeStartedAt).getTime() + scheduledDelaySeconds * 1000).toISOString()
  });
}

async function waitForLiepinNavigationSlot(run: BatchRun, item: BatchItem): Promise<boolean> {
  const auth = await getAuthProjection();
  if (auth.status !== "signed_in" || !auth.userId) {
    await finishItem(run, item, "failed", "JobFlow 登录状态无效");
    return false;
  }
  const throttle = await getLiepinNavigationThrottle(auth.userId, "liepin");
  if (throttle) {
    const waitUntil = new Date(throttle.nextNavigationEligibleAt).getTime();
    if (Number.isFinite(waitUntil) && waitUntil > Date.now()) {
      item.status = "waiting_navigation";
      run.nextNavigationEligibleAt = throttle.nextNavigationEligibleAt;
      await saveRun(run);
      await chrome.alarms.create(QUEUE_ALARM, { when: waitUntil });
      await notifyState();
      return false;
    }
    await clearLiepinNavigationThrottle();
  }

  const lastNavigationStartedAt = now();
  const scheduledDelaySeconds = secureRandomIntegerInRange(
    LIEPIN_DETAIL_NAVIGATION_DELAY_MIN_SECONDS,
    LIEPIN_DETAIL_NAVIGATION_DELAY_MAX_SECONDS
  );
  const nextThrottle: LiepinNavigationThrottle = {
    ownerId: auth.userId,
    platform: "liepin",
    lastNavigationStartedAt,
    scheduledDelaySeconds,
    nextNavigationEligibleAt: new Date(
      new Date(lastNavigationStartedAt).getTime() + scheduledDelaySeconds * 1000
    ).toISOString()
  };
  await saveLiepinNavigationThrottle(nextThrottle);
  run.nextNavigationEligibleAt = undefined;
  item.status = "opening";
  return true;
}

async function closeItemTab(item: BatchItem): Promise<void> {
  if (typeof item.tabId === "number") await chrome.tabs.remove(item.tabId).catch(() => undefined);
  item.tabId = undefined;
  item.leaseId = undefined;
}

async function waitForMinimumDetailDwell(item: BatchItem): Promise<void> {
  if (typeof item.tabId !== "number" || !item.startedAt) return;
  const startedAt = new Date(item.startedAt).getTime();
  if (!Number.isFinite(startedAt)) return;
  const remainingMs = startedAt + LIEPIN_DETAIL_MIN_DWELL_SECONDS * 1000 - Date.now();
  if (remainingMs > 0) await new Promise((resolve) => setTimeout(resolve, remainingMs));
}

async function acquireLiepinLiveWriteLock(owner: string): Promise<() => void> {
  if (liepinLiveWriteLockOwner) {
    throw new Error("已有猎聘真实写入正在执行，请稍后再试");
  }
  liepinLiveWriteLockOwner = owner;
  return () => {
    if (liepinLiveWriteLockOwner === owner) liepinLiveWriteLockOwner = null;
  };
}

function clearItemBlocker(item: BatchItem): void {
  item.blockerPhase = undefined;
  item.blockerCode = undefined;
  item.error = undefined;
  item.finishedAt = undefined;
}

async function openCurrentItemTab(run: BatchRun, item: BatchItem): Promise<boolean> {
  item.startedAt = now();
  item.attempt += 1;
  item.leaseId = crypto.randomUUID();
  const url = new URL(item.candidate.url);
  url.hash = "jobflow-lease=" + item.leaseId;
  const tab = await chrome.tabs.create({ url: url.toString(), active: false });
  if (typeof tab.id !== "number") {
    if (run.executionPolicy === "automatic_send") {
      await pauseAutomaticRunBeforeWrite(run, "detail_tab_unavailable", "无法创建详情标签页");
      return false;
    }
    await finishItem(run, item, "failed", "无法创建详情标签页");
    return false;
  }
  item.tabId = tab.id;
  return true;
}

async function pauseAutomaticRunBeforeWrite(
  run: BatchRun,
  blockerCode: string,
  reason: string,
  preserveTabForUser = false
): Promise<void> {
  if (run.status !== "running") {
    run.status = "paused";
    run.pauseReason = run.pauseReason ?? reason;
    await saveRun(run);
    await notifyState();
    return;
  }
  const item = run.items[run.currentIndex];
  if (item && preserveTabForUser) {
    if (item.leaseId) await chrome.alarms.clear(detailAlarmName(run.id, item.leaseId));
    if (typeof item.tabId === "number") await chrome.tabs.update(item.tabId, { active: true }).catch(() => undefined);
    item.tabId = undefined;
    item.leaseId = undefined;
  } else if (item) {
    await closeItemTab(item);
  }
  await saveRun(pauseCurrentItemBeforeWrite(run, blockerCode, reason, now()));
  await notifyState();
}

async function saveOpeningRunAndDetailAlarm(run: BatchRun, item: BatchItem): Promise<void> {
  await saveRun(run);
  if (!item.leaseId) return;
  await chrome.alarms.create(detailAlarmName(run.id, item.leaseId), {
    when: Date.now() + (await loadSettings()).detailTimeoutSeconds * 1000
  });
  await notifyState();
}

async function reopenAutomaticItemForFreshDetail(run: BatchRun, item: BatchItem): Promise<void> {
  await closeItemTab(item);
  clearItemBlocker(item);
  run.pauseReason = undefined;
  run.nextNavigationEligibleAt = undefined;
  run.nextWriteEligibleAt = undefined;
  run.status = "running";
  item.status = "queued";
  await saveRun(run);
  await scheduleQueue(100);
  await notifyState();
}

async function assertAutomaticRunStillWritable(runId: string, jobId: string): Promise<BatchRun> {
  const latestRun = await getRun();
  if (!latestRun || latestRun.id !== runId) throw new DeliveryControlStoppedError();
  if (latestRun.status !== "running") {
    throw new DeliveryControlStoppedError(latestRun.status === "cancelled" ? "批次已取消" : "批次已暂停");
  }
  if (latestRun.executionPolicy !== "automatic_send") throw new DeliveryControlStoppedError("批次执行策略已变化");
  const latestItem = latestRun.items[latestRun.currentIndex];
  if (!latestItem || latestItem.candidate.jobId !== jobId) throw new DeliveryControlStoppedError();
  return latestRun;
}

async function guardAutomaticBeforeWrite(runId: string, jobId: string, ownerId: string): Promise<void> {
  const latestRun = await assertAutomaticRunStillWritable(runId, jobId);
  const settings = await loadSettings();
  if (settings.executionPolicy !== "automatic_send") {
    const item = latestRun.items[latestRun.currentIndex];
    if (item) await closeItemTab(item);
    const paused = pauseCurrentItemBeforeWrite(
      latestRun,
      "execution_policy_changed",
      "执行策略已变化，自动批次已暂停",
      now()
    );
    await saveRun(paused);
    await notifyState();
    throw new DeliveryControlStoppedError("执行策略已变化");
  }
  const throttle = await getAutomaticWriteThrottle(ownerId, "liepin");
  if (!throttle) return;
  const waitUntil = new Date(throttle.nextWriteEligibleAt).getTime();
  if (!Number.isFinite(waitUntil) || waitUntil <= Date.now()) return;
  const waiting = startDeliveryWait(latestRun, throttle.nextWriteEligibleAt, now());
  await saveRun(waiting);
  await chrome.alarms.create(automaticWriteAlarmName(runId), { when: waitUntil });
  await notifyState();
  throw new DeliveryControlStoppedError("等待新的投递间隔");
}

async function persistProcessingFailure(
  opportunityId: string,
  error: unknown,
  settings?: ExtensionSettings
): Promise<void> {
  const errorCode = (typeof error === "string"
    ? error
    : error instanceof Error ? error.message : "处理失败").slice(0, 200);
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
  await waitForMinimumDetailDwell(item);
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
  if (!item) return;
  if (item.status === "delivery_ready" || item.status === "waiting_interval") {
    return processAutomaticDelivery(run, item);
  }
  if (item.status !== "queued" && item.status !== "waiting_navigation") return;
  const records = await listOpportunities();
  const record = records.find((candidate) =>
    candidate.platform === item.candidate.platform
    && candidate.platformJobId === item.candidate.jobId
  );
  if (!record) return finishItem(run, item, "failed", "职位记录不存在");
  const hasAutomaticDraftIdentity = run.executionPolicy === "automatic_send"
    && Boolean(item.opportunityId && item.draftRevisionId && item.draftSha256);
  const needsFreshAutomaticProcessing = run.executionPolicy === "automatic_send"
    && item.opportunityId === record.id
    && !hasAutomaticDraftIdentity;
  if (isAutomaticallyTerminal(record.status) && !hasAutomaticDraftIdentity && !needsFreshAutomaticProcessing) {
    const status = record.status === "review_required"
      ? "review_required"
      : record.status === "draft_ready"
        ? "draft_ready"
        : "excluded";
    return finishItem(run, item, status, "已存在持久处理记录");
  }
  if (!(await waitForLiepinNavigationSlot(run, item))) return;
  if (!(await openCurrentItemTab(run, item))) return;
  if (!item.leaseId) return finishItem(run, item, "failed", "详情标签页租约不可用");
  await saveOpeningRunAndDetailAlarm(run, item);
}

async function processAutomaticDelivery(run: BatchRun, item: BatchItem): Promise<void> {
  if (run.executionPolicy !== "automatic_send") return;
  const auth = await getAuthProjection();
  if (auth.status !== "signed_in" || !auth.userId) {
    await pauseAutomaticRunBeforeWrite(run, "signed_out", "请先登录 JobFlow");
    return;
  }
  const ownerId = auth.userId;
  let releaseLiveWriteLock: (() => void) | null = null;
  try {
    releaseLiveWriteLock = await acquireLiepinLiveWriteLock("automatic:" + run.id + ":" + crypto.randomUUID());
  } catch {
    await scheduleQueue(500);
    return;
  }
  try {
  const throttle = await getAutomaticWriteThrottle(ownerId, "liepin");
  if (throttle) {
    const waitUntil = new Date(throttle.nextWriteEligibleAt).getTime();
    if (Number.isFinite(waitUntil) && waitUntil > Date.now()) {
      const waiting = startDeliveryWait(run, throttle.nextWriteEligibleAt, now());
      await saveRun(waiting);
      await chrome.alarms.create(automaticWriteAlarmName(run.id), { when: waitUntil });
      await notifyState();
      return;
    }
    await clearAutomaticWriteThrottle();
  }
  if (typeof item.tabId !== "number" || !item.opportunityId || !item.draftRevisionId || !item.draftSha256 || !item.leaseId) {
    await pauseAutomaticRunBeforeWrite(run, "automatic_identity_missing", "自动投递身份或详情标签页不可用");
    return;
  }
  const settings = await loadSettings();
  try {
    await assertAutomaticRunStillWritable(run.id, item.candidate.jobId);
  } catch (error) {
    if (error instanceof DeliveryControlStoppedError) return;
    throw error;
  }
  const opportunity = (await listOpportunities()).find((record) =>
    record.id === item.opportunityId
    && record.platform === item.candidate.platform
    && record.platformJobId === item.candidate.jobId
  );
  if (!opportunity || !["draft_ready", "extracting"].includes(opportunity.status)) {
    await pauseAutomaticRunBeforeWrite(run, "opportunity_not_ready", "职位状态已变化，自动投递授权失效");
    return;
  }
  let draftIdentity: Awaited<ReturnType<typeof loadCurrentDraftIdentity>>;
  try {
    draftIdentity = await loadCurrentDraftIdentity(opportunity.id);
  } catch (error) {
    await pauseAutomaticRunBeforeWrite(run, "draft_identity_missing", error instanceof Error ? error.message : "当前草稿修订不存在");
    return;
  }
  if (draftIdentity.draftRevisionId !== item.draftRevisionId || draftIdentity.draftSha256 !== item.draftSha256) {
    await pauseAutomaticRunBeforeWrite(run, "draft_identity_changed", "草稿修订已变化，自动批次授权失效");
    return;
  }
  item.status = "delivery_preflighting";
  await saveRun(run);
  await notifyState();
  let writeStarted = false;
  const tabToClose: BatchItem = { ...item };
  try {
    const delivery = await prepareReviewedDelivery(opportunity.id, item.draftRevisionId, item.draftSha256);
    const latest = await executeReviewedDeliveryCore({
      opportunity,
      draftText: draftIdentity.draftText,
      delivery,
      tabId: item.tabId,
      leaseId: item.leaseId,
      draftRevisionId: item.draftRevisionId,
      draftSha256: item.draftSha256,
      authorizationEvidenceCode: "automatic_batch_authorized",
      settings,
      assumeClickSuccess: true,
      beforeWrite: async () => {
        await guardAutomaticBeforeWrite(run.id, item.candidate.jobId, ownerId);
      },
      onWriteStarted: async () => {
        writeStarted = true;
        const latestRun = await getRun();
        if (!latestRun || latestRun.id !== run.id) return;
        const latestItem = latestRun.items[latestRun.currentIndex];
        if (!latestItem || latestItem.candidate.jobId !== item.candidate.jobId) return;
        latestItem.status = "delivery_in_progress";
        await saveRun(latestRun);
        await notifyState();
      }
    });
    const latestRun = await getRun();
    if (!latestRun || latestRun.id !== run.id) return;
    const completed = latest.applicationStatus === "verified" && latest.greetingStatus === "verified"
      ? completeDeliverySucceeded(latestRun, now())
      : completeDeliveryPartialAndPause(
        latestRun,
        "component_unverified",
        deliveryPartialReason(latest),
        now()
      );
    await waitForMinimumDetailDwell(tabToClose);
    await closeItemTab(tabToClose);
    await saveRun(completed);
    await notifyState();
    if (completed.status === "running") await scheduleQueue();
  } catch (error) {
    if (error instanceof DeliveryControlStoppedError) return;
    const latestRun = await getRun();
    if (!latestRun || latestRun.id !== run.id) return;
    const message = error instanceof Error ? error.message : "自动投递失败";
    const paused = writeStarted
      ? completeDeliveryPartialAndPause(latestRun, "write_result_unavailable", message, now())
      : pauseCurrentItemBeforeWrite(
        latestRun,
        error instanceof PreWriteDeliveryError ? error.blockerCode : "pre_write_failed",
        message,
        now()
      );
    await waitForMinimumDetailDwell(tabToClose);
    await closeItemTab(tabToClose);
    await saveRun(paused);
    await notifyState();
  }
  } finally {
    releaseLiveWriteLock?.();
  }
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
  await saveRun(run);
  const records = await listOpportunities();
  const opportunity = opportunityForJob(records, job);
  if (!opportunity) return finishItem(run, item, "failed", "职位记录不存在");

  try {
    if (run.executionPolicy === "automatic_send"
      && item.opportunityId
      && item.draftRevisionId
      && item.draftSha256) {
      const draftIdentity = await loadCurrentDraftIdentity(opportunity.id);
      if (draftIdentity.draftRevisionId !== item.draftRevisionId || draftIdentity.draftSha256 !== item.draftSha256) {
        return pauseAutomaticRunBeforeWrite(run, "draft_identity_changed", "草稿修订已变化，自动批次授权失效");
      }
      item.status = "delivery_ready";
      item.opportunityId = opportunity.id;
      item.draftRevisionId = draftIdentity.draftRevisionId;
      item.draftSha256 = draftIdentity.draftSha256;
      await saveRun(run);
      await notifyState();
      await scheduleQueue(0);
      return;
    }
    await recordJobDetails(opportunity.id, crypto.randomUUID(), job, await sourceHash(job.description));
    const settings = await loadSettings();
    const profile = await activeProfile();
    if (!profile) return finishItem(run, item, "review_required", "已启用画像不存在");
    const result = await processPostDetail(opportunity.id, job, settings, profile, async (status) => {
      if (run.executionPolicy === "automatic_send") {
        await assertAutomaticRunStillWritable(run.id, item.candidate.jobId);
      }
      item.status = status;
      await saveRun(run);
      await notifyState();
    });
    const latestRun = await getRun();
    if (run.executionPolicy === "automatic_send"
      && latestRun?.id === run.id
      && latestRun.status !== "running") {
      return;
    }
    item.filter = result.filter;
    item.suitability = result.suitability;
    if (run.executionPolicy === "automatic_send" && result.status === "draft_ready") {
      const draftIdentity = await loadCurrentDraftIdentity(opportunity.id);
      item.status = "delivery_ready";
      item.opportunityId = opportunity.id;
      item.draftRevisionId = draftIdentity.draftRevisionId;
      item.draftSha256 = draftIdentity.draftSha256;
      await saveRun(run);
      await notifyState();
      await scheduleQueue(0);
      return;
    }
    return finishItem(run, item, result.status, result.reason);
  } catch (error) {
    if (error instanceof DeliveryControlStoppedError) return;
    return finishItem(run, item, "failed", error instanceof Error ? error.message : "处理失败");
  }
}

async function handleDetailPageReady(
  sender: chrome.runtime.MessageSender,
  jobId: string
): Promise<string | null> {
  if (!isTrustedLiepinContentSender(sender, jobId)) return null;
  const run = await getRun();
  if (!run || (run.status !== "running" && run.status !== "paused")) return null;
  const item = run.items[run.currentIndex];
  if (!item || (item.status !== "opening" && item.status !== "extracting")) return null;
  if (item.candidate.jobId !== jobId) return null;
  if (item.tabId !== sender.tab?.id) return null;
  return item.leaseId ?? null;
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
    const item = run.items[run.currentIndex];
    if (run.executionPolicy === "automatic_send" && item?.status === "blocked" && item.blockerPhase === "pre_write") {
      if (item.opportunityId && item.draftRevisionId && item.draftSha256) {
        await reopenAutomaticItemForFreshDetail(run, item);
      } else {
        clearItemBlocker(item);
        run.pauseReason = undefined;
        run.nextNavigationEligibleAt = undefined;
        run.nextWriteEligibleAt = undefined;
        run.status = "running";
        item.status = "queued";
        item.tabId = undefined;
        item.leaseId = undefined;
        await saveRun(run);
        await scheduleQueue(100);
        await notifyState();
      }
      return;
    }
    if (run.executionPolicy === "automatic_send" && item && [
      "opening",
      "extracting",
      "evaluating",
      "generating",
      "delivery_preflighting"
    ].includes(item.status)) {
      await reopenAutomaticItemForFreshDetail(run, item);
      return;
    }
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
  await chrome.alarms.clear(automaticWriteAlarmName(run.id));
  const item = run.items[run.currentIndex];
  if (item?.leaseId) await chrome.alarms.clear(detailAlarmName(run.id, item.leaseId));
  if (item) await closeItemTab(item);
  await saveRun(run);
  await notifyState();
}

async function handleDetailFailure(
  run: BatchRun,
  item: BatchItem,
  error: string,
  code?: DetailFailureCode
): Promise<void> {
  if (run.executionPolicy === "automatic_send" && code !== "job_unavailable") {
    const userResolvable = code === "login_required" || code === "risk_control";
    await pauseAutomaticRunBeforeWrite(
      run,
      userResolvable ? code : "detail_unavailable",
      error,
      userResolvable
    );
    return;
  }
  await finishItem(run, item, "failed", error);
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

async function runUserGenerationOnce<T>(opportunityId: string, operation: () => Promise<T>): Promise<T> {
  if (userGenerationInFlight.has(opportunityId)) throw new Error("该职位正在生成草稿，请稍候");
  userGenerationInFlight.add(opportunityId);
  try {
    return await operation();
  } finally {
    userGenerationInFlight.delete(opportunityId);
  }
}

function currentDraftRevision(draft: { currentText: string; revisions: Array<{ id: string; text: string; createdAt: string }> }): { id: string; text: string } | null {
  const matching = draft.revisions
    .filter((revision) => revision.text === draft.currentText)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  return matching ? { id: matching.id, text: matching.text } : null;
}

async function loadCurrentDraftIdentity(opportunityId: string): Promise<{ draftText: string; draftRevisionId: string; draftSha256: string }> {
  const draft = (await listDrafts()).find((item) => item.opportunityId === opportunityId);
  const revision = draft ? currentDraftRevision(draft) : null;
  if (!draft || !revision) throw new Error("当前草稿修订不存在");
  return {
    draftText: draft.currentText,
    draftRevisionId: revision.id,
    draftSha256: await sourceHash(draft.currentText)
  };
}

async function loadReviewedSendIdentity(
  opportunityId: string,
  draftRevisionId: string,
  draftSha256: string
): Promise<{ opportunity: OpportunityRecord; draftText: string; delivery: DeliveryRecord }> {
  const auth = await getAuthProjection();
  if (auth.status !== "signed_in" || !auth.userId) throw new Error("请先登录");
  const [opportunities, drafts] = await Promise.all([listOpportunities(), listDrafts()]);
  const opportunity = opportunities.find((item) => item.id === opportunityId);
  if (!opportunity || opportunity.userId !== auth.userId) throw new Error("职位记录不存在或不属于当前账号");
  if (opportunity.platform !== "liepin") throw new Error("当前只支持猎聘职位");
  if (opportunity.status !== "draft_ready") throw new Error("只有已审核草稿可以投递并打招呼");
  const draft = drafts.find((item) => item.opportunityId === opportunityId);
  const revision = draft ? currentDraftRevision(draft) : null;
  if (!draft || !revision) throw new Error("当前草稿修订不存在");
  if (revision.id !== draftRevisionId) throw new Error("草稿修订已变化，请重新确认");
  if (await sourceHash(draft.currentText) !== draftSha256) throw new Error("草稿内容已变化，请重新确认");
  const delivery = await prepareReviewedDelivery(opportunityId, draftRevisionId, draftSha256);
  if (delivery.overallStatus === "succeeded") throw new Error("该职位已经完成投递和打招呼");
  return { opportunity, draftText: draft.currentText, delivery };
}

export function isTrustedOptionsSender(sender: chrome.runtime.MessageSender): boolean {
  return isTrustedExtensionPageSender(sender, "options.html");
}

function isExactLiepinDetailUrl(value: string, platformJobId: string): boolean {
  try {
    const url = new URL(value);
    const isLiepinHost = url.hostname === "liepin.com" || url.hostname.endsWith(".liepin.com");
    return url.protocol === "https:"
      && isLiepinHost
      && (url.pathname === "/job/" + platformJobId + ".shtml"
        || url.pathname === "/a/" + platformJobId + ".shtml");
  } catch {
    return false;
  }
}

async function findOrOpenLiepinDetailTab(opportunity: OpportunityRecord): Promise<{ tabId: number; openedByExtension: boolean }> {
  const tabs = await chrome.tabs.query({ url: ["https://*.liepin.com/job/*.shtml*", "https://*.liepin.com/a/*.shtml*"] });
  const tab = tabs.find((candidate) => {
    if (typeof candidate.id !== "number" || !candidate.url) return false;
    return isExactLiepinDetailUrl(candidate.url, opportunity.platformJobId);
  });
  if (typeof tab?.id === "number") return { tabId: tab.id, openedByExtension: false };
  if (!isExactLiepinDetailUrl(opportunity.canonicalUrl, opportunity.platformJobId)) {
    throw new Error("职位详情地址无效，无法执行发送前检查");
  }
  const opened = await chrome.tabs.create({ url: opportunity.canonicalUrl, active: false });
  if (typeof opened.id !== "number") throw new Error("无法打开猎聘职位详情页");
  return { tabId: opened.id, openedByExtension: true };
}

async function sendReviewedSendPreflightWhenReady(
  tabId: number,
  message: unknown,
  reloadStaleExistingTab: boolean
): Promise<unknown> {
  const deadline = Date.now() + REVIEWED_SEND_CONTENT_READY_TIMEOUT_MS;
  let lastError: unknown;
  let reloaded = false;
  while (Date.now() <= deadline) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      if (reloadStaleExistingTab && !reloaded) {
        await chrome.tabs.reload(tabId).catch(() => undefined);
        reloaded = true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, REVIEWED_SEND_CONTENT_RETRY_INTERVAL_MS));
  }
  throw lastError instanceof Error ? lastError : new Error("猎聘职位详情页尚未准备好");
}

function parseReviewedSendPreflight(raw: unknown): { ok: boolean; reason?: string; blocker?: string; actionTier?: string; resumeMode?: string } {
  return z.object({
    ok: z.boolean(),
    platformJobId: z.string().max(128),
    resumeMode: z.literal("platform_default"),
    actionTier: z.enum(["primary", "secondary", "application_confirmation"]).optional(),
    blocker: z.string().max(80).optional(),
    reason: z.string().max(200).optional()
  }).strict().parse(raw);
}

interface ReviewedSendExecution {
  ok: boolean;
  application: "attempted" | "verified" | "failed";
  greeting: "attempted" | "verified" | "failed";
  evidenceCodes: string[];
  reason?: string;
}

function parseReviewedSendExecution(raw: unknown): ReviewedSendExecution {
  return z.object({
    ok: z.boolean(),
    application: z.enum(["attempted", "verified", "failed"]),
    greeting: z.enum(["attempted", "verified", "failed"]),
    evidenceCodes: z.array(z.string().max(80)).max(8),
    reason: z.string().max(200).optional()
  }).strict().parse(raw);
}

const AUTOMATIC_APPLICATION_CLICK_ASSUMED_CODE = "application_click_assumed_success";
const AUTOMATIC_APPLICATION_GREETING_CLICK_ASSUMED_CODE = "application_greeting_click_assumed_success";
const AUTOMATIC_GREETING_CLICK_ASSUMED_CODE = "greeting_click_assumed_success";

function assumeAutomaticClickSuccess(result: ReviewedSendExecution): ReviewedSendExecution {
  const applicationAssumedBySubmit = result.application === "attempted"
    && result.evidenceCodes.includes("application_submit_clicked");
  const applicationAssumedByGreeting = result.application === "attempted"
    && result.evidenceCodes.includes("greeting_send_clicked");
  const applicationAssumptionCode = applicationAssumedBySubmit
    ? AUTOMATIC_APPLICATION_CLICK_ASSUMED_CODE
    : applicationAssumedByGreeting
      ? AUTOMATIC_APPLICATION_GREETING_CLICK_ASSUMED_CODE
      : undefined;
  const greetingAssumed = result.greeting === "attempted"
    && result.evidenceCodes.includes("outbound_greeting_unverified");
  const application = applicationAssumptionCode ? "verified" : result.application;
  const greeting = greetingAssumed ? "verified" : result.greeting;
  return {
    ...result,
    ok: application === "verified" && greeting === "verified",
    application,
    greeting,
    evidenceCodes: [
      ...result.evidenceCodes,
      ...(applicationAssumptionCode ? [applicationAssumptionCode] : []),
      ...(greetingAssumed ? [AUTOMATIC_GREETING_CLICK_ASSUMED_CODE] : [])
    ]
  };
}

function reviewedComponentReason(
  component: "application" | "greeting",
  status: "attempted" | "verified" | "failed",
  fallback?: string
): string {
  if (fallback) return fallback;
  if (component === "application") {
    if (status === "verified") return "正式投递已从猎聘页面验证";
    if (status === "attempted") return "已尝试正式投递，尚未取得独立平台证据";
    return "正式投递未完成";
  }
  if (status === "verified") return "招呼语已从猎聘页面验证";
  if (status === "attempted") return "已尝试发送招呼语，尚未取得独立平台证据";
  return "招呼语发送未完成";
}

function reviewedComponentReasonForResult(
  component: "application" | "greeting",
  result: ReviewedSendExecution
): string {
  if (component === "application" && result.evidenceCodes.includes(AUTOMATIC_APPLICATION_CLICK_ASSUMED_CODE)) {
    return clickAssumptionReason(component);
  }
  if (component === "application" && result.evidenceCodes.includes(AUTOMATIC_APPLICATION_GREETING_CLICK_ASSUMED_CODE)) {
    return "已点击猎聘招呼语发送控件，按开发阶段策略将投递并联系计为已发送（未等待页面回读）";
  }
  if (component === "greeting" && result.evidenceCodes.includes(AUTOMATIC_GREETING_CLICK_ASSUMED_CODE)) {
    return clickAssumptionReason(component);
  }
  return reviewedComponentReason(component, component === "application" ? result.application : result.greeting, result.reason);
}

function clickAssumptionReason(component: "application" | "greeting"): string {
  return component === "application"
    ? "已点击猎聘正式投递控件，按开发阶段策略记为已发送（未等待页面回读）"
    : "已点击猎聘招呼语发送控件，按开发阶段策略记为已发送（未等待页面回读）";
}

function reviewedComponentEvidenceCode(
  component: "application" | "greeting",
  result: ReviewedSendExecution
): string {
  const assumedCodes = component === "application"
    ? [AUTOMATIC_APPLICATION_CLICK_ASSUMED_CODE, AUTOMATIC_APPLICATION_GREETING_CLICK_ASSUMED_CODE]
    : [AUTOMATIC_GREETING_CLICK_ASSUMED_CODE];
  const assumedCode = assumedCodes.find((code) => result.evidenceCodes.includes(code));
  if (assumedCode) return assumedCode;
  if (component === "application") return result.evidenceCodes[0] || "application_observed";
  return result.evidenceCodes.find((code) => code.includes("greeting") || code.includes("composer") || code.includes("send_"))
    || "greeting_observed";
}

function reviewedDeliverySummary(result: ReviewedSendExecution): string {
  if (!result.evidenceCodes.some((code) => code === AUTOMATIC_APPLICATION_CLICK_ASSUMED_CODE
    || code === AUTOMATIC_APPLICATION_GREETING_CLICK_ASSUMED_CODE
    || code === AUTOMATIC_GREETING_CLICK_ASSUMED_CODE)) {
    return "";
  }
  return [
    reviewedComponentReasonForResult("application", result),
    reviewedComponentReasonForResult("greeting", result)
  ].join("；");
}

interface DeliveryCoreInput {
  opportunity: OpportunityRecord;
  draftText: string;
  delivery: DeliveryRecord;
  tabId: number;
  leaseId: string;
  draftRevisionId: string;
  draftSha256: string;
  authorizationEvidenceCode: "user_confirmed" | "automatic_batch_authorized";
  settings: ExtensionSettings;
  assumeClickSuccess?: boolean;
  beforeWrite?: () => Promise<void>;
  onWriteStarted?: () => Promise<void>;
}

class PreWriteDeliveryError extends Error {
  blockerCode: string;
  constructor(message: string, blockerCode: string) {
    super(message);
    this.blockerCode = blockerCode;
  }
}

class DeliveryControlStoppedError extends Error {
  constructor(message = "批次已暂停或取消") {
    super(message);
  }
}

async function sendDeliveryContentMessage(
  tabId: number,
  message: unknown,
  timeoutMessage: string
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, message),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), DELIVERY_CONTENT_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function executeReviewedDeliveryCore(input: DeliveryCoreInput): Promise<DeliveryRecord> {
  const {
    opportunity,
    draftText,
    delivery,
    tabId,
    leaseId,
    draftRevisionId,
    draftSha256,
    authorizationEvidenceCode,
    settings,
    assumeClickSuccess = false,
    beforeWrite,
    onWriteStarted
  } = input;
  if (delivery.applicationStatus === "verified" && delivery.greetingStatus === "verified") {
    throw new Error("该职位已经完成投递和打招呼");
  }
  const needsApplication = delivery.applicationStatus !== "verified";
  const needsGreeting = delivery.greetingStatus !== "verified";
  let preWriteReviewRecorded = false;
  const finalPreflight = parseReviewedSendPreflight(await sendDeliveryContentMessage(tabId, {
    type: "CONTENT_REVIEWED_SEND_PREFLIGHT",
    leaseId,
    platformJobId: opportunity.platformJobId
  }, "最终发送前检查超时"));
  if (!finalPreflight.ok) {
    await recordReviewedDeliveryAttempt({
      opportunityId: opportunity.id,
      requestId: crypto.randomUUID(),
      eventKind: "delivery_review_required",
      evidenceCode: finalPreflight.blocker || "final_preflight_failed",
      reason: finalPreflight.reason || "最终发送前检查失败",
      draftRevisionId,
      draftSha256
    });
    preWriteReviewRecorded = true;
    throw new PreWriteDeliveryError(
      finalPreflight.reason || "最终发送前检查失败",
      finalPreflight.blocker || "final_preflight_failed"
    );
  }
  await beforeWrite?.();
  await recordReviewedDeliveryAttempt({
    opportunityId: opportunity.id,
    requestId: crypto.randomUUID(),
    eventKind: "delivery_confirmed",
    evidenceCode: authorizationEvidenceCode,
    evidence: authorizationEvidenceCode === "automatic_batch_authorized" ? { source: "sidepanel_batch" } : undefined,
    draftRevisionId,
    draftSha256
  });
  let reservationId: string | undefined;
  let writeStarted = false;
  try {
    const reservationRequestId = crypto.randomUUID();
    reservationId = await reserveReviewedDeliveryQuota(
      opportunity.id,
      reservationRequestId,
      settings.dailySendLimit
    );
    await recordReviewedDeliveryAttempt({
      opportunityId: opportunity.id,
      requestId: reservationRequestId,
      eventKind: "daily_unit_reserved",
      evidenceCode: "quota_reserved",
      reservationId,
      draftRevisionId,
      draftSha256
    });
    await markReviewedDeliveryWriteStarted(opportunity.id, reservationId);
    writeStarted = true;
    await onWriteStarted?.();
    const auth = await getAuthProjection();
    if (auth.status === "signed_in" && auth.userId) {
      await persistNextAutomaticWriteThrottle(auth.userId, "liepin", now());
    }
    await recordReviewedDeliveryAttempt({
      opportunityId: opportunity.id,
      requestId: crypto.randomUUID(),
      eventKind: "delivery_write_started",
      evidenceCode: "write_boundary_entered",
      reservationId,
      draftRevisionId,
      draftSha256
    });
    if (needsApplication) {
      await recordReviewedDeliveryAttempt({
        opportunityId: opportunity.id,
        requestId: crypto.randomUUID(),
        eventKind: "application_attempted",
        component: "application",
        status: "attempted",
        evidenceCode: "native_action_attempting",
        reservationId,
        draftRevisionId,
        draftSha256
      });
    }
    if (needsGreeting) {
      await recordReviewedDeliveryAttempt({
        opportunityId: opportunity.id,
        requestId: crypto.randomUUID(),
        eventKind: "greeting_attempted",
        component: "greeting",
        status: "attempted",
        evidenceCode: "greeting_action_attempting",
        reservationId,
        draftRevisionId,
        draftSha256
      });
    }
    const observedResult = parseReviewedSendExecution(await sendDeliveryContentMessage(tabId, {
      type: "CONTENT_REVIEWED_SEND_EXECUTE",
      leaseId,
      platformJobId: opportunity.platformJobId,
      draftText,
      draftSha256,
      needsApplication,
      needsGreeting,
      assumeClickSuccess
    }, "真实投递结果读取超时"));
    const result = assumeClickSuccess ? assumeAutomaticClickSuccess(observedResult) : observedResult;
    const resultSummary = reviewedDeliverySummary(result);
    let latest = delivery;
    if (needsApplication) {
      latest = await recordReviewedDeliveryAttempt({
        opportunityId: opportunity.id,
        requestId: crypto.randomUUID(),
        eventKind: result.application === "verified" ? "application_verified" : result.application === "failed" ? "application_failed" : "application_attempted",
        component: "application",
        status: result.application,
        evidenceCode: reviewedComponentEvidenceCode("application", result),
        evidence: { codeCount: result.evidenceCodes.length },
        reason: resultSummary || reviewedComponentReasonForResult("application", result),
        reservationId,
        draftRevisionId,
        draftSha256
      });
    }
    if (needsGreeting) {
      latest = await recordReviewedDeliveryAttempt({
        opportunityId: opportunity.id,
        requestId: crypto.randomUUID(),
        eventKind: result.greeting === "verified" ? "greeting_verified" : result.greeting === "failed" ? "greeting_failed" : "greeting_attempted",
        component: "greeting",
        status: result.greeting,
        evidenceCode: reviewedComponentEvidenceCode("greeting", result),
        evidence: { textLength: Array.from(draftText).length },
        reason: resultSummary || reviewedComponentReasonForResult("greeting", result),
        reservationId,
        draftRevisionId,
        draftSha256
      });
    }
    return latest;
  } catch (error) {
    if (error instanceof DeliveryControlStoppedError) throw error;
    if (reservationId && !writeStarted) {
      const released = await releaseReviewedDeliveryQuota(opportunity.id, reservationId).catch(() => false);
      if (released) {
        await recordReviewedDeliveryAttempt({
          opportunityId: opportunity.id,
          requestId: crypto.randomUUID(),
          eventKind: "daily_unit_released",
          evidenceCode: "quota_released_before_write",
          draftRevisionId,
          draftSha256
        }).catch(() => undefined);
      }
      if (!preWriteReviewRecorded) {
        await recordReviewedDeliveryAttempt({
          opportunityId: opportunity.id,
          requestId: crypto.randomUUID(),
          eventKind: "delivery_review_required",
          evidenceCode: "pre_write_failed",
          reason: error instanceof Error ? error.message : "真实写入前失败",
          draftRevisionId,
          draftSha256
        }).catch(() => undefined);
      }
    } else if (!reservationId && !writeStarted && !preWriteReviewRecorded) {
      await recordReviewedDeliveryAttempt({
        opportunityId: opportunity.id,
        requestId: crypto.randomUUID(),
        eventKind: "delivery_review_required",
        evidenceCode: "pre_write_failed",
        reason: error instanceof Error ? error.message : "真实写入前失败",
        draftRevisionId,
        draftSha256
      }).catch(() => undefined);
    } else if (writeStarted) {
      await recordReviewedDeliveryAttempt({
        opportunityId: opportunity.id,
        requestId: crypto.randomUUID(),
        eventKind: "delivery_review_required",
        evidenceCode: "write_result_unavailable",
        reason: error instanceof Error ? error.message : "真实写入结果不可用",
        reservationId,
        draftRevisionId,
        draftSha256
      }).catch(() => undefined);
    }
    throw error;
  }
}

async function prepareReviewedSend(
  sender: chrome.runtime.MessageSender,
  opportunityId: string,
  draftRevisionId: string,
  draftSha256: string
): Promise<DeliveryRecord> {
  if (!isTrustedOptionsSender(sender)) throw new Error("只能从扩展管理页发起人工确认发送");
  if ((await loadSettings()).executionPolicy === "draft_only") {
    throw new Error("当前为仅生成模式，不能发起真实投递");
  }
  const { opportunity } = await loadReviewedSendIdentity(opportunityId, draftRevisionId, draftSha256);
  const detailTab = await findOrOpenLiepinDetailTab(opportunity);
  const leaseId = crypto.randomUUID();
  await recordReviewedDeliveryAttempt({
    opportunityId,
    requestId: crypto.randomUUID(),
    eventKind: "delivery_preflighting",
    evidenceCode: "preflight_started",
    draftRevisionId,
    draftSha256
  });
  let preflight: ReturnType<typeof parseReviewedSendPreflight>;
  try {
    preflight = parseReviewedSendPreflight(await sendReviewedSendPreflightWhenReady(detailTab.tabId, {
      type: "CONTENT_REVIEWED_SEND_PREFLIGHT",
      leaseId,
      platformJobId: opportunity.platformJobId
    }, !detailTab.openedByExtension));
  } catch {
    await recordReviewedDeliveryAttempt({
      opportunityId,
      requestId: crypto.randomUUID(),
      eventKind: "delivery_review_required",
      evidenceCode: "preflight_transport_failed",
      reason: "无法读取猎聘发送前状态",
      draftRevisionId,
      draftSha256
    });
    throw new Error("无法读取猎聘发送前状态");
  }
  if (!preflight.ok) {
    await recordReviewedDeliveryAttempt({
      opportunityId,
      requestId: crypto.randomUUID(),
      eventKind: "delivery_review_required",
      evidenceCode: preflight.blocker || "preflight_failed",
      reason: preflight.reason || "发送前检查失败",
      draftRevisionId,
      draftSha256
    });
    throw new Error(preflight.reason || "发送前检查失败");
  }
  reviewedSendLeases.set(opportunityId, {
    opportunityId,
    platformJobId: opportunity.platformJobId,
    tabId: detailTab.tabId,
    leaseId,
    draftRevisionId,
    draftSha256,
    preparedAt: Date.now(),
    openedByExtension: detailTab.openedByExtension
  });
  const prepared = await recordReviewedDeliveryAttempt({
    opportunityId,
    requestId: crypto.randomUUID(),
    eventKind: "delivery_preflighted",
    evidenceCode: "preflight_ok",
    evidence: { actionTier: preflight.actionTier, resumeMode: "platform_default" },
    draftRevisionId,
    draftSha256
  });
  await notifyState();
  return prepared;
}

async function confirmReviewedSend(
  sender: chrome.runtime.MessageSender,
  opportunityId: string,
  draftRevisionId: string,
  draftSha256: string
): Promise<DeliveryRecord> {
  if (!isTrustedOptionsSender(sender)) throw new Error("只能从扩展管理页确认人工发送");
  if ((await loadSettings()).executionPolicy === "draft_only") {
    throw new Error("当前为仅生成模式，不能确认真实投递");
  }
  if (reviewedSendExecuting.has(opportunityId)) throw new Error("该职位发送流程正在执行");
  reviewedSendExecuting.add(opportunityId);
  try {
  const { opportunity, draftText, delivery } = await loadReviewedSendIdentity(opportunityId, draftRevisionId, draftSha256);
  const lease = reviewedSendLeases.get(opportunityId);
  if (!lease
    || lease.draftRevisionId !== draftRevisionId
    || lease.draftSha256 !== draftSha256
    || lease.platformJobId !== opportunity.platformJobId
    || Date.now() - lease.preparedAt > REVIEWED_SEND_LEASE_TTL_MS) {
    throw new Error("发送前检查已过期，请重新准备");
  }
  let releaseLiveWriteLock: (() => void) | null = null;
  try {
    releaseLiveWriteLock = await acquireLiepinLiveWriteLock("manual:" + opportunityId);
    const latest = await executeReviewedDeliveryCore({
      opportunity,
      draftText,
      delivery,
      tabId: lease.tabId,
      leaseId: lease.leaseId,
      draftRevisionId,
      draftSha256,
      authorizationEvidenceCode: "user_confirmed",
      settings: await loadSettings()
    });
    await notifyState();
    if (lease.openedByExtension && latest.overallStatus === "succeeded") {
      await chrome.tabs.remove(lease.tabId).catch(() => undefined);
    }
    return latest;
  } finally {
    releaseLiveWriteLock?.();
    reviewedSendLeases.delete(opportunityId);
  }
  } finally {
    reviewedSendExecuting.delete(opportunityId);
  }
}

async function handleReviewDecision(
  opportunityId: string,
  decision: "continue_generation" | "permanently_exclude"
): Promise<void> {
  if (decision === "permanently_exclude") {
    await appendUserEvent(opportunityId, "user_excluded", { reason: "用户在复核中永久排除" });
    return;
  }
  await runUserGenerationOnce(opportunityId, async () => {
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
  });
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
      return startBatch(sender, request.selectedJobIds, request.expectedExecutionPolicy);
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
    case "DETAIL_PAGE_READY":
      return handleDetailPageReady(sender, request.jobId);
    case "DETAIL_READY":
      await handleDetail(request.job, request.leaseId);
      return undefined;
    case "DETAIL_FAILED": {
      const run = await getRun();
      const item = run?.items[run.currentIndex];
      if (run
        && item?.leaseId === request.leaseId
        && item.candidate.jobId === request.jobId
        && item.tabId === sender.tab?.id
        && isTrustedLiepinContentSender(sender, request.jobId)) {
        await handleDetailFailure(run, item, request.error, request.code);
      }
      return undefined;
    }
    case "RETRY_STORED_OPPORTUNITY":
      await retryStoredOpportunity(request.opportunityId);
      return undefined;
    case "PREPARE_REVIEWED_SEND":
      return prepareReviewedSend(sender, request.opportunityId, request.draftRevisionId, request.draftSha256);
    case "CONFIRM_REVIEWED_SEND":
      return confirmReviewedSend(sender, request.opportunityId, request.draftRevisionId, request.draftSha256);
    case "EDIT_DRAFT": {
      const settings = await loadSettings();
      await invokeModel("edit_draft", {
        opportunityId: request.opportunityId,
        text: request.text
      }, settings, false);
      return undefined;
    }
    case "REGENERATE_DRAFT":
      await runUserGenerationOnce(request.opportunityId, () => generateForOpportunity(request.opportunityId));
      return undefined;
    case "REVIEW_DECISION":
      await handleReviewDecision(request.opportunityId, request.decision);
      return undefined;
    case "CONTINUE_AS_EXCEPTION":
      await runUserGenerationOnce(request.opportunityId, async () => {
        await appendUserEvent(request.opportunityId, "user_override", { reason: "用户选择作为例外继续" });
        await generateForOpportunity(request.opportunityId);
      });
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

function reportAsyncError(error: unknown): void {
  console.warn("[JobFlow:background]", error instanceof Error ? error.message : error);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === QUEUE_ALARM) {
    void processNext().catch(reportAsyncError);
    return;
  }
  if (alarm.name.startsWith(AUTO_WRITE_ALARM_PREFIX)) {
    void (async () => {
      const run = await getRun();
      const runId = alarm.name.slice(AUTO_WRITE_ALARM_PREFIX.length);
      if (!run || run.id !== runId || run.status !== "running") return;
      await scheduleQueue(0);
    })().catch(reportAsyncError);
    return;
  }
  if (!alarm.name.startsWith(DETAIL_ALARM_PREFIX)) return;
  void (async () => {
    const run = await getRun();
    const item = run?.items[run.currentIndex];
    if ((run?.status === "running" || run?.status === "paused")
      && item?.leaseId
      && detailAlarmName(run.id, item.leaseId) === alarm.name) {
      await handleDetailFailure(run, item, "详情页读取超时", "dom_timeout");
    }
  })().catch(reportAsyncError);
});

async function recoverRun(): Promise<void> {
  const run = await getRun();
  if (!run) return;
  if (run.executionPolicy === "automatic_send") {
    const item = run.items[run.currentIndex];
    if (["running", "paused", "cancelled"].includes(run.status) && item?.status === "delivery_in_progress") {
      const leaseId = item.leaseId;
      if (leaseId) await chrome.alarms.clear(detailAlarmName(run.id, leaseId));
      if (item.tabId) await closeItemTab(item);
      if (item.opportunityId && item.draftRevisionId && item.draftSha256) {
        await recordReviewedDeliveryAttempt({
          opportunityId: item.opportunityId,
          requestId: crypto.randomUUID(),
          eventKind: "delivery_review_required",
          evidenceCode: "extension_restarted",
          reason: "扩展或浏览器重启，真实写入结果需要复核",
          draftRevisionId: item.draftRevisionId,
          draftSha256: item.draftSha256
        }).catch(reportAsyncError);
      }
      const recovered = completeDeliveryPartialAndPause(
        run,
        "extension_restarted",
        "扩展或浏览器重启，真实写入结果需要复核",
        now()
      );
      await saveRun(recovered);
      await notifyState();
      return;
    }
    if (run.status !== "running") return;
    run.status = "paused";
    run.pauseReason = "扩展或浏览器重启后需要手动继续自动批次";
    await saveRun(run);
    await notifyState();
    return;
  }
  if (run.status !== "running") return;
  const item = run.items[run.currentIndex];
  if (item?.status === "opening" && typeof item.tabId === "number") {
    const exists = await chrome.tabs.get(item.tabId).then(() => true).catch(() => false);
    if (!exists) await finishItem(run, item, "failed", "详情标签页已关闭");
    return;
  }
  await scheduleQueue(250);
}

chrome.runtime.onStartup.addListener(() => { void recoverRun().catch(reportAsyncError); });
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void recoverRun().catch(reportAsyncError);
});

void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
