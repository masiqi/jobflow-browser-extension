import { evaluateRules, jobKey } from "./filters";
import { getRun, listLedger, saveRun, upsertLedger } from "./ledger";
import { chatCompletion } from "./llm";
import { buildEvaluationMessages, parseModelDecision } from "./prompt";
import { loadSettings } from "./storage";
import type { BatchRun, DetailJob, LedgerEntry, ListCandidate, RuntimeMessage, RunItem, RunMode } from "./types";

let wakeTimer: ReturnType<typeof setTimeout> | null = null;
const iso = () => new Date().toISOString();

function newRun(candidates: ListCandidate[], mode: RunMode, sourceUrl: string): BatchRun {
  const now = iso();
  return { id: crypto.randomUUID(), platform: "liepin", mode, status: "running", sourceUrl, createdAt: now, updatedAt: now, currentIndex: 0, items: candidates.map((candidate): RunItem => ({ candidate, status: "queued", attempt: 0 })), sentCount: 0, simulatedCount: 0, failedCount: 0 };
}

async function notifyState(): Promise<void> {
  await chrome.runtime.sendMessage({ type: "RUN_UPDATED" } satisfies RuntimeMessage).catch(() => undefined);
}

function scheduleNext(delay = 500): void {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => { void processNext(); }, delay);
}

async function closeItemTab(item: RunItem): Promise<void> {
  if (typeof item.tabId === "number") await chrome.tabs.remove(item.tabId).catch(() => undefined);
  item.tabId = undefined;
}

async function finishItem(run: BatchRun, item: RunItem, status: RunItem["status"], error?: string): Promise<void> {
  item.status = status; item.error = error; item.finishedAt = iso();
  await closeItemTab(item);
  run.currentIndex += 1;
  if (status === "failed") run.failedCount += 1;
  if (status === "simulated") run.simulatedCount += 1;
  await saveRun(run); await notifyState(); scheduleNext();
}

async function processNext(): Promise<void> {
  const run = await getRun();
  if (!run || run.status !== "running") return;
  if (run.currentIndex >= run.items.length) { run.status = "completed"; await saveRun(run); await notifyState(); return; }
  const item = run.items[run.currentIndex]!;
  if (item.status !== "queued") return;
  const settings = await loadSettings();
  const ledger = await listLedger();
  if (ledger[jobKey(item.candidate)]?.status === "sent") return finishItem(run, item, "filtered", "已存在成功发送记录");
  const filter = evaluateRules(item.candidate, settings.filters, false); item.filter = filter;
  if (filter.decision === "skip") return finishItem(run, item, "filtered", filter.reasons.join("；"));
  item.status = "opening"; item.startedAt = iso(); item.attempt += 1;
  const tab = await chrome.tabs.create({ url: item.candidate.url, active: false });
  if (typeof tab.id !== "number") return finishItem(run, item, "failed", "无法创建详情标签页");
  item.tabId = tab.id; await saveRun(run); await notifyState();
  setTimeout(async () => {
    const current = await getRun(); const active = current?.items[current.currentIndex];
    if (current?.status === "running" && active?.status === "opening" && active.tabId === tab.id) await finishItem(current, active, "failed", "详情页读取超时");
  }, settings.detailTimeoutSeconds * 1000);
}

async function handleDetail(job: DetailJob): Promise<void> {
  const run = await getRun(); if (!run || run.status !== "running") return;
  const item = run.items[run.currentIndex]; if (!item || item.candidate.jobId !== job.jobId || !["opening", "extracting"].includes(item.status)) return;
  const settings = await loadSettings();
  item.status = "extracting"; item.candidate = { ...item.candidate, ...job }; item.filter = evaluateRules(job, settings.filters, true);
  if (item.filter.decision === "skip") return finishItem(run, item, "filtered", item.filter.reasons.join("；"));
  if (!settings.resumeProfile) return finishItem(run, item, "needs_review", "尚未导入并生成简历画像");
  item.status = "generating"; await saveRun(run); await notifyState();
  try {
    const raw = await chatCompletion(settings.model, buildEvaluationMessages(job, settings.resumeProfile, item.filter));
    item.model = parseModelDecision(raw);
    if (item.model.decision === "skip") return finishItem(run, item, "filtered", item.model.reasons.join("；"));
    if (item.model.decision === "review") return finishItem(run, item, "needs_review", item.model.reasons.join("；"));
    if (run.mode !== "dry_run") return finishItem(run, item, "needs_review", "真实发送尚未实现；必须先完成模拟验收和独立人工解锁");
    const now = iso();
    const record: LedgerEntry = { key: jobKey(job), platform: "liepin", jobId: job.jobId, canonicalUrl: job.canonicalUrl, title: job.title, company: job.company, status: "simulated", runId: run.id, greeting: item.model.greeting, reason: item.model.reasons.join("；"), createdAt: now, updatedAt: now, evidence: "dry_run:no_platform_write" };
    await upsertLedger(record);
    return finishItem(run, item, "simulated");
  } catch (error) { return finishItem(run, item, "failed", error instanceof Error ? error.message : "模型处理失败"); }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  void (async () => {
    if (message.type === "START_RUN") { const settings = await loadSettings(); const run = newRun(message.candidates.slice(0, settings.maxJobsPerRun), "dry_run", message.sourceUrl); await saveRun(run); scheduleNext(100); sendResponse({ ok: true, run }); }
    else if (message.type === "GET_STATE") sendResponse({ ok: true, run: await getRun(), ledger: await listLedger(), settings: await loadSettings() });
    else if (message.type === "PAUSE_RUN") { const run = await getRun(); if (run && run.status === "running") { run.status = "paused"; await saveRun(run); } sendResponse({ ok: true }); }
    else if (message.type === "RESUME_RUN") { const run = await getRun(); if (run && run.status === "paused") { run.status = "running"; await saveRun(run); scheduleNext(100); } sendResponse({ ok: true }); }
    else if (message.type === "CANCEL_RUN") { const run = await getRun(); if (run) { run.status = "cancelled"; const item = run.items[run.currentIndex]; if (item) await closeItemTab(item); await saveRun(run); } sendResponse({ ok: true }); }
    else if (message.type === "DETAIL_READY") { await handleDetail(message.job); sendResponse({ ok: true }); }
    else if (message.type === "DETAIL_FAILED") { const run = await getRun(); const item = run?.items[run.currentIndex]; if (run && item?.candidate.jobId === message.jobId) await finishItem(run, item, "failed", message.error); sendResponse({ ok: true }); }
    else sendResponse({ ok: false });
  })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

chrome.runtime.onStartup.addListener(() => scheduleNext(1000));
chrome.runtime.onInstalled.addListener(() => scheduleNext(1000));
