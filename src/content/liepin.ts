import { BriefcaseBusiness, createElement } from "lucide";
import {
  detectLiepinBlockedPage,
  executeLiepinReviewedSend,
  extractLiepinDetail,
  isLiepinDetailPage,
  isLiepinListPage,
  preflightLiepinReviewedSend,
  scanLiepinList
} from "../platforms/liepin";
import {
  liepinReviewedSendExecuteCommandSchema,
  liepinReviewedSendPreflightCommandSchema
} from "../domain/messages";

interface CommandResponse {
  ok: boolean;
  error?: string;
}

const REVIEWED_SEND_PREFLIGHT_TTL_MS = 5 * 60 * 1000;
const reviewedSendPreflights = new Map<string, { platformJobId: string; preparedAt: number }>();

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
    const response: CommandResponse = await chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
    if (!response.ok) button.title = response.error || "无法打开 JobFlow";
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
          command.needsGreeting
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

async function reportLeasedDetail(): Promise<void> {
  const leaseId = leaseFromLocation();
  if (!leaseId || !isLiepinDetailPage()) return;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const blocked = detectLiepinBlockedPage();
    if (blocked) {
      await chrome.runtime.sendMessage({
        type: "DETAIL_FAILED",
        jobId: location.pathname.match(/\/(?:job|a)\/(\d+)\.shtml/i)?.[1] || "",
        leaseId,
        error: blocked === "risk_control" ? "猎聘详情页需要安全验证" : "猎聘详情页需要登录"
      });
      return;
    }
    const job = extractLiepinDetail();
    if (job) {
      const response: CommandResponse = await chrome.runtime.sendMessage({ type: "DETAIL_READY", job, leaseId });
      if (!response.ok) {
        await chrome.runtime.sendMessage({
          type: "DETAIL_FAILED",
          jobId: job.jobId,
          leaseId,
          error: ("详情数据未被接受：" + (response.error || "后台校验失败")).slice(0, 500)
        });
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const jobId = location.pathname.match(/\/(?:job|a)\/(\d+)\.shtml/i)?.[1] || "";
  await chrome.runtime.sendMessage({
    type: "DETAIL_FAILED",
    jobId,
    leaseId,
    error: "详情 DOM 未在 30 秒内准备好"
  });
}

async function mountConfiguredLauncher(): Promise<void> {
  const response: CommandResponse & { data?: unknown } = await chrome.runtime.sendMessage({
    type: "GET_LAUNCHER_VISIBILITY"
  });
  const visible = response.ok && response.data !== false;
  if (visible && (isLiepinListPage() || isLiepinDetailPage())) mountLauncher();
}

void mountConfiguredLauncher();
void reportLeasedDetail();
