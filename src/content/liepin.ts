import { evaluateRules } from "../filters";
import { loadSettings } from "../storage";
import { extractLiepinDetail, isLiepinDetailPage, isLiepinListPage, scanLiepinList } from "../platforms/liepin";
import type { ListCandidate, RuntimeMessage } from "../types";

const ROOT_ID = "jobflow-batch-root";

function esc(value: unknown): string { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c)); }

async function send<T>(message: RuntimeMessage): Promise<T> { return chrome.runtime.sendMessage(message) as Promise<T>; }

async function renderListPanel(): Promise<void> {
  if (!isLiepinListPage() || document.getElementById(ROOT_ID)) return;
  let settings = await loadSettings();
  const host = document.createElement("div"); host.id = ROOT_ID; const root = host.attachShadow({ mode: "open" }); document.documentElement.append(host);
  const scan = () => scanLiepinList();
  const draw = (candidates: ListCandidate[]) => {
    const evaluated = candidates.map((candidate) => ({ candidate, decision: evaluateRules(candidate, settings.filters, false) }));
    const actionable = evaluated.filter((item) => item.decision.decision !== "skip").map((item) => item.candidate);
    root.innerHTML = `<style>${STYLE}</style><button id="open">批量模拟</button><section id="panel"><header><strong>猎聘批处理 · 模拟模式</strong><button id="close">×</button></header><p class="safe">不会发送、不会投递、不会点击“聊一聊”；逐岗读取详情、筛选、生成招呼并记录模拟结果。</p><div class="stats">列表去重 ${candidates.length}｜硬规则后 ${actionable.length}｜本批最多 ${settings.maxJobsPerRun}</div><div class="actions"><button id="refresh">重新扫描</button><button id="start">开始模拟</button><button id="pause">暂停</button><button id="resume">继续</button><button id="cancel">取消</button><button id="options">筛选与简历设置</button></div><div id="state">尚未运行</div><ol>${evaluated.slice(0, 40).map(({ candidate, decision }) => `<li class="${decision.decision}"><b>${esc(candidate.title)}</b> · ${esc(candidate.company)} · ${esc(candidate.salary)}<small>${esc(decision.reasons.join("；"))}</small></li>`).join("")}</ol></section>`;
    root.querySelector("#open")?.addEventListener("click", () => root.querySelector("#panel")?.classList.toggle("hidden"));
    root.querySelector("#close")?.addEventListener("click", () => root.querySelector("#panel")?.classList.add("hidden"));
    root.querySelector("#refresh")?.addEventListener("click", async () => { settings = await loadSettings(); draw(scan()); });
    root.querySelector("#options")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
    root.querySelector("#start")?.addEventListener("click", async () => { if (!settings.resumeProfile) { (root.querySelector("#state") as HTMLElement).textContent = "请先在设置中导入简历并生成/保存画像"; return; } await send({ type: "START_RUN", candidates: actionable, mode: "dry_run", sourceUrl: location.href }); await refreshState(); });
    root.querySelector("#pause")?.addEventListener("click", async () => { await send({ type: "PAUSE_RUN" }); await refreshState(); });
    root.querySelector("#resume")?.addEventListener("click", async () => { await send({ type: "RESUME_RUN" }); await refreshState(); });
    root.querySelector("#cancel")?.addEventListener("click", async () => { await send({ type: "CANCEL_RUN" }); await refreshState(); });
  };
  async function refreshState() { const data = await send<{ run?: { status: string; currentIndex: number; items: unknown[]; simulatedCount: number; failedCount: number } | null }>({ type: "GET_STATE" }); const node = root.querySelector<HTMLElement>("#state"); if (node) node.textContent = data.run ? `状态 ${data.run.status}｜进度 ${data.run.currentIndex}/${data.run.items.length}｜模拟成功 ${data.run.simulatedCount}｜失败 ${data.run.failedCount}` : "尚未运行"; }
  draw(scan()); await refreshState(); setInterval(() => void refreshState(), 1500);
}

async function reportDetail(): Promise<void> {
  if (!isLiepinDetailPage()) return;
  let attempts = 0;
  const timer = setInterval(async () => {
    attempts += 1;
    const job = extractLiepinDetail();
    if (job) { clearInterval(timer); await send({ type: "DETAIL_READY", job }); }
    else if (attempts >= 30) { clearInterval(timer); const id = location.pathname.match(/\/(?:job|a)\/(\d+)\.shtml/i)?.[1] || ""; await send({ type: "DETAIL_FAILED", jobId: id, error: "详情DOM未在30秒内准备好" }); }
  }, 1000);
}

void renderListPanel();
void reportDetail();

const STYLE = `:host{all:initial;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#open{position:fixed;right:22px;bottom:88px;z-index:2147483646;border:0;border-radius:999px;background:#6d28d9;color:#fff;padding:12px 17px;font-weight:700;cursor:pointer}#panel{position:fixed;right:22px;bottom:140px;z-index:2147483647;width:min(620px,calc(100vw - 30px));max-height:calc(100vh - 165px);overflow:auto;background:#fff;color:#172033;border:1px solid #ddd;border-radius:14px;box-shadow:0 16px 50px #0004;padding:14px}.hidden{display:none}header,.actions{display:flex;gap:8px;align-items:center;justify-content:space-between}header button{border:0;background:none;font-size:20px}.safe{padding:8px;background:#ecfdf5;color:#166534;border-radius:8px}.stats,#state{margin:8px 0;color:#475569}.actions{justify-content:flex-start;flex-wrap:wrap}.actions button{border:1px solid #cbd5e1;background:#f8fafc;padding:6px 9px;border-radius:6px;cursor:pointer}li{padding:6px;margin:4px 0;background:#f8fafc;border-radius:6px}li.skip{opacity:.55}li.review{background:#fff7ed}small{display:block;color:#64748b;margin-top:2px}`;
