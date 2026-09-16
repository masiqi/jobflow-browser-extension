import { BriefcaseBusiness, createElement } from "lucide";
import {
  detectLiepinBlockedPage,
  executeLiepinReviewedSend,
  extractLiepinDetail,
  isLiepinDetailPage,
  isLiepinListPage,
  liepinBlockedPageReason,
  preflightLiepinReviewedSend,
  scanLiepinList
} from "../platforms/liepin";
import {
  liepinReviewedSendExecuteCommandSchema,
  liepinReviewedSendPreflightCommandSchema,
  type DetailFailureCode
} from "../domain/messages";

interface CommandResponse {
  ok: boolean;
  error?: string;
  data?: unknown;
}

type RuntimeMessageResult<T> =
  | { kind: "response"; value: T }
  | { kind: "context_unavailable" }
  | { kind: "transport_error"; error: string };

const REVIEWED_SEND_PREFLIGHT_TTL_MS = 5 * 60 * 1000;
const DETAIL_LEASE_HANDSHAKE_ATTEMPTS = 20;
const DETAIL_LEASE_HANDSHAKE_INTERVAL_MS = 250;
const reviewedSendPreflights = new Map<string, { platformJobId: string; preparedAt: number }>();

function errorMessage(error: unknown, fallback: string): string {
  return (error instanceof Error && error.message ? error.message : fallback).slice(0, 300);
}

function isExtensionContextInvalidated(error: unknown): boolean {
  return error instanceof Error && /extension context invalidated/i.test(error.message);
}

async function sendRuntimeMessage<T>(message: object): Promise<RuntimeMessageResult<T>> {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime || typeof runtime.sendMessage !== "function") return { kind: "context_unavailable" };
  try {
    return { kind: "response", value: await runtime.sendMessage(message) as T };
  } catch (error) {
    if (isExtensionContextInvalidated(error)) return { kind: "context_unavailable" };
    return { kind: "transport_error", error: errorMessage(error, "扩展后台通信失败") };
  }
}

function isCommandResponse(value: unknown): value is CommandResponse {
  return !!value && typeof value === "object" && typeof (value as { ok?: unknown }).ok === "boolean";
}

function reportUnexpectedError(operation: string, error: unknown): void {
  console.warn(`[JobFlow] ${operation}：${errorMessage(error, "未知错误")}`);
}

async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mountLauncher(): void {
  if (document.querySelector("#jobflow-launcher-root")) return;
  const host = document.createElement("div");
  host.id = "jobflow-launcher-root";
  const shadow = host.attachShadow({ mode: "open" });
  const button = document.createElement("button");
  button.type = "button";
  button.title = "打开 JobFlow";
  button.setAttribute("aria-label", "打开 JobFlow 侧边栏");
  button.append(createElement(BriefcaseBusiness, {
    width: 20,
    height: 20,
    "stroke-width": 2
  }));
  button.addEventListener("click", async () => {
    const result = await sendRuntimeMessage<unknown>({ type: "OPEN_SIDE_PANEL" });
    if (result.kind === "context_unavailable") return;
    if (result.kind === "transport_error") {
      button.title = result.error;
      return;
    }
    if (!isCommandResponse(result.value) || !result.value.ok) {
      button.title = isCommandResponse(result.value) ? result.value.error || "无法打开 JobFlow" : "扩展后台返回无效响应";
    }
  });
  const style = document.createElement("style");
  style.textContent = [
    ":host{all:initial}",
    "button{position:fixed;right:0;top:42%;z-index:2147483646;width:42px;height:42px;",
    "display:grid;place-items:center;border:1px solid #b8c0cc;border-right:0;border-radius:6px 0 0 6px;",
    "background:#17324d;color:#fff;box-shadow:0 4px 16px #0002;cursor:pointer}",
    "button:hover{background:#20496d}",
    "button:focus-visible{outline:3px solid #f2b84b;outline-offset:2px}",
    "svg{display:block}"
  ].join("");
  shadow.append(style, button);
  document.documentElement.append(host);
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const type = (message as { type?: unknown }).type;
  if (type === "CONTENT_SCAN") {
    if (!isLiepinListPage()) {
      sendResponse({ sourceUrl: location.href, candidates: [] });
      return false;
    }
    sendResponse({ sourceUrl: location.href, candidates: scanLiepinList() });
    return false;
  }
  if (type === "CONTENT_REVIEWED_SEND_PREFLIGHT") {
    try {
      const command = liepinReviewedSendPreflightCommandSchema.parse(message);
      const result = preflightLiepinReviewedSend(document, location.href, command.platformJobId);
      if (result.ok) {
        reviewedSendPreflights.set(command.leaseId, {
          platformJobId: command.platformJobId,
          preparedAt: Date.now()
        });
      } else {
        reviewedSendPreflights.delete(command.leaseId);
      }
      sendResponse(result);
    } catch (error) {
      sendResponse({
        ok: false,
        platformJobId: "",
        resumeMode: "platform_default",
        blocker: "missing_action",
        reason: error instanceof Error ? "发送前检查命令无效" : "发送前检查失败"
      });
    }
    return false;
  }
  if (type === "CONTENT_REVIEWED_SEND_EXECUTE") {
    void (async () => {
      try {
        const command = liepinReviewedSendExecuteCommandSchema.parse(message);
        const preflight = reviewedSendPreflights.get(command.leaseId);
        if (!preflight
          || preflight.platformJobId !== command.platformJobId
          || Date.now() - preflight.preparedAt > REVIEWED_SEND_PREFLIGHT_TTL_MS) {
          sendResponse({
            ok: false,
            application: "failed",
            greeting: "failed",
            evidenceCodes: ["preflight_lease_invalid"],
            reason: "发送前检查不存在或已过期"
          });
          return;
        }
        if (await sha256Text(command.draftText) !== command.draftSha256) {
          reviewedSendPreflights.delete(command.leaseId);
          sendResponse({
            ok: false,
            application: "failed",
            greeting: "failed",
            evidenceCodes: ["draft_hash_mismatch"],
            reason: "待发送草稿与已确认版本不一致"
          });
          return;
        }
        reviewedSendPreflights.delete(command.leaseId);
        sendResponse(await executeLiepinReviewedSend(
          document,
          location.href,
          command.platformJobId,
          command.draftText,
          command.needsApplication,
          command.needsGreeting,
          command.assumeClickSuccess
        ));
      } catch (error) {
        sendResponse({
          ok: false,
          application: "failed",
          greeting: "failed",
          evidenceCodes: ["content_command_failed"],
          reason: error instanceof Error ? error.message : "发送命令失败"
        });
      }
    })();
    return true;
  }
  return false;
});

function leaseFromLocation(): string | null {
  const value = new URLSearchParams(location.hash.slice(1)).get("jobflow-lease");
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

function jobIdFromLiepinDetailUrl(value: string): string {
  try {
    const url = new URL(value);
    const isLiepinHost = url.hostname === "liepin.com" || url.hostname.endsWith(".liepin.com");
    if (url.protocol !== "https:" || !isLiepinHost) return "";
    return url.pathname.match(/\/(?:job|a)\/(\d+)\.shtml/i)?.[1] || "";
  } catch {
    return "";
  }
}

function jobIdFromLocation(): string {
  const direct = jobIdFromLiepinDetailUrl(location.href);
  if (direct) return direct;
  const backUrl = new URLSearchParams(location.search).get("backurl");
  return backUrl ? jobIdFromLiepinDetailUrl(backUrl) : "";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestDetailLease(jobId: string): Promise<{ leaseId: string | null; shouldRetry: boolean }> {
  if (!jobId) return { leaseId: null, shouldRetry: false };
  const result = await sendRuntimeMessage<unknown>({
    type: "DETAIL_PAGE_READY",
    jobId
  });
  if (result.kind === "context_unavailable") return { leaseId: null, shouldRetry: false };
  if (result.kind === "transport_error") return { leaseId: null, shouldRetry: true };
  const response = result.value;
  return {
    leaseId: isCommandResponse(response)
      && response.ok
      && typeof response.data === "string"
      && /^[0-9a-f-]{36}$/i.test(response.data)
      ? response.data
      : null,
    shouldRetry: true
  };
}

async function detailLeaseForCurrentPage(): Promise<string | null> {
  const hashLease = leaseFromLocation();
  if (hashLease) return hashLease;
  const jobId = jobIdFromLocation();
  for (let attempt = 0; attempt < DETAIL_LEASE_HANDSHAKE_ATTEMPTS; attempt += 1) {
    const result = await requestDetailLease(jobId);
    if (result.leaseId) return result.leaseId;
    if (!result.shouldRetry) return null;
    if (attempt < DETAIL_LEASE_HANDSHAKE_ATTEMPTS - 1) await delay(DETAIL_LEASE_HANDSHAKE_INTERVAL_MS);
  }
  return null;
}

async function reportDetailFailure(
  code: DetailFailureCode,
  jobId: string,
  leaseId: string,
  error: string
): Promise<void> {
  const result = await sendRuntimeMessage<unknown>({
    type: "DETAIL_FAILED",
    code,
    jobId,
    leaseId,
    error
  });
  if (result.kind === "transport_error") reportUnexpectedError("详情失败状态上报失败", result.error);
}

async function reportLeasedDetail(): Promise<void> {
  const isDetailPage = isLiepinDetailPage();
  const blocked = detectLiepinBlockedPage(document, location);
  if (!isDetailPage && !blocked) return;
  const jobId = jobIdFromLocation();
  if (!jobId) return;
  const leaseId = await detailLeaseForCurrentPage();
  if (!leaseId) return;
  if (blocked) {
    await reportDetailFailure(blocked, jobId, leaseId, liepinBlockedPageReason(blocked));
    return;
  }
  if (!isDetailPage) {
    await reportDetailFailure("unexpected_redirect", jobId, leaseId, "猎聘详情页跳转到无法识别的页面");
    return;
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const currentBlocker = detectLiepinBlockedPage();
    if (currentBlocker) {
      await reportDetailFailure(
        currentBlocker,
        jobId,
        leaseId,
        liepinBlockedPageReason(currentBlocker)
      );
      return;
    }
    const job = extractLiepinDetail();
    if (job) {
      const result = await sendRuntimeMessage<unknown>({ type: "DETAIL_READY", job, leaseId });
      if (result.kind === "context_unavailable") return;
      if (result.kind === "transport_error") {
        reportUnexpectedError("详情数据上报失败", result.error);
        return;
      }
      if (!isCommandResponse(result.value) || !result.value.ok) {
        await reportDetailFailure(
          "detail_rejected",
          job.jobId,
          leaseId,
          ("详情数据未被接受：" + (isCommandResponse(result.value) ? result.value.error || "后台校验失败" : "后台返回无效响应")).slice(0, 500)
        );
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await reportDetailFailure("dom_timeout", jobId, leaseId, "详情 DOM 未在 30 秒内准备好");
}

async function mountConfiguredLauncher(): Promise<void> {
  const result = await sendRuntimeMessage<unknown>({
    type: "GET_LAUNCHER_VISIBILITY"
  });
  if (result.kind === "context_unavailable") return;
  if (result.kind === "transport_error") {
    reportUnexpectedError("读取入口设置失败", result.error);
    return;
  }
  if (!isCommandResponse(result.value)) {
    reportUnexpectedError("读取入口设置失败", "扩展后台返回无效响应");
    return;
  }
  const response = result.value;
  const visible = response.ok && response.data !== false;
  if (visible && (isLiepinListPage() || isLiepinDetailPage())) mountLauncher();
}

void mountConfiguredLauncher().catch((error) => reportUnexpectedError("挂载入口失败", error));
void reportLeasedDetail().catch((error) => reportUnexpectedError("读取详情失败", error));
