"use strict";
(() => {
  // src/filters.ts
  var compact = (value) => value.toLowerCase().replace(/\s+/g, " ");
  var hits = (text2, words) => words.filter((word) => word.trim() && text2.includes(word.trim().toLowerCase()));
  function parseSalaryMaxK(salary) {
    const text2 = salary.toLowerCase().replace(/,/g, "");
    const range = text2.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*k/);
    if (range) return Number(range[2]);
    const single = text2.match(/(\d+(?:\.\d+)?)\s*k/);
    if (single) return Number(single[1]);
    const yearly = text2.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*万/);
    if (yearly) return Math.round(Number(yearly[2]) / 12 * 10) / 10;
    return null;
  }
  function evaluateRules(job, settings, detail = false) {
    const title = compact(job.title);
    const body = compact(`${job.title} ${job.cardText} ${detail && "description" in job ? job.description : ""}`);
    const reasons = [];
    const matchedDirections = [];
    if (settings.cityKeywords.length && !hits(compact(`${job.location} ${job.cardText}`), settings.cityKeywords.map((x) => x.toLowerCase())).length) {
      return { decision: "skip", reasons: ["地点不符合限定"], matchedDirections };
    }
    const salaryMax = parseSalaryMaxK(job.salary);
    if (settings.minSalaryK > 0 && salaryMax !== null && salaryMax < settings.minSalaryK) {
      return { decision: "skip", reasons: [`薪资上限 ${salaryMax}K 低于 ${settings.minSalaryK}K`], matchedDirections };
    }
    const required = settings.directions.filter((rule) => rule.mode === "require");
    const requiredMatches = required.map((rule) => ({ rule, found: hits(body, rule.keywords.map((x) => x.toLowerCase())) })).filter((x) => x.found.length);
    if (required.length) {
      const ok = settings.requiredDirectionMatch === "all" ? requiredMatches.length === required.length : requiredMatches.length > 0;
      if (!ok) {
        const reason = settings.requiredDirectionMatch === "all" ? "未匹配全部必选方向" : "未匹配任一必选方向";
        if (detail) return { decision: "skip", reasons: [reason], matchedDirections };
        reasons.push(`${reason}，待详情复核`);
      }
    }
    for (const rule of settings.directions) {
      const found = hits(body, rule.keywords.map((x) => x.toLowerCase()));
      if (!found.length) continue;
      matchedDirections.push(rule.label);
      if (rule.mode === "exclude") return { decision: "skip", reasons: [`命中排除方向：${rule.label}（${found.join("、")}）`], matchedDirections };
      if (rule.mode === "review") reasons.push(`命中复核方向：${rule.label}`);
      if (rule.mode === "prefer") reasons.push(`命中偏好方向：${rule.label}`);
    }
    const customExclude = hits(body, settings.customExcludeAny.map((x) => x.toLowerCase()));
    if (customExclude.length) return { decision: "skip", reasons: [`命中自定义排除词：${customExclude.join("、")}`], matchedDirections };
    if (settings.customIncludeAny.length && !hits(body, settings.customIncludeAny.map((x) => x.toLowerCase())).length) {
      if (detail) return { decision: "skip", reasons: ["未命中自定义任一包含词"], matchedDirections };
      reasons.push("自定义任一包含词待详情复核");
    }
    const missingAll = settings.customIncludeAll.filter((word) => !body.includes(word.toLowerCase()));
    if (missingAll.length) {
      if (detail) return { decision: "skip", reasons: [`缺少自定义必含词：${missingAll.join("、")}`], matchedDirections };
      reasons.push(`自定义必含词待详情复核：${missingAll.join("、")}`);
    }
    const schoolHits = hits(body, settings.schoolRestrictionKeywords.map((x) => x.toLowerCase()));
    if (settings.schoolRestrictionMode === "include_only" && !schoolHits.length) {
      if (detail) return { decision: "skip", reasons: ["未命中985/211等学校限定"], matchedDirections };
      reasons.push("985/211等学校限定待详情复核");
    }
    if (schoolHits.length && settings.schoolRestrictionMode === "exclude") return { decision: "skip", reasons: [`命中学校限制：${schoolHits.join("、")}`], matchedDirections };
    if (schoolHits.length && settings.schoolRestrictionMode === "review") reasons.push(`学校限制需复核：${schoolHits.join("、")}`);
    const reviewHits = hits(body, settings.customReviewAny.map((x) => x.toLowerCase()));
    if (reviewHits.length) reasons.push(`命中自定义复核词：${reviewHits.join("、")}`);
    const isReview = reasons.some((reason) => reason.includes("复核") || reason.includes("限制"));
    return { decision: isReview ? "review" : "pass", reasons: reasons.length ? reasons : [detail ? "详情硬规则通过" : "列表硬规则通过"], matchedDirections };
  }
  function canonicalJobUrl(rawUrl) {
    const url = new URL(rawUrl);
    url.hash = "";
    url.search = "";
    return url.toString();
  }

  // src/defaults.ts
  var FILTERS = {
    cityKeywords: ["北京"],
    minSalaryK: 25,
    requiredDirectionMatch: "any",
    schoolRestrictionMode: "review",
    schoolRestrictionKeywords: ["985", "211", "双一流", "QS100", "QS前100", "top2", "清北"],
    directions: [
      { id: "agent", label: "Agent / 智能体", mode: "require", keywords: ["agent", "智能体", "大模型", "llm", "rag", "mcp", "知识库", "ai应用"] },
      { id: "java", label: "Java 主导", mode: "exclude", keywords: ["java", "spring", "springboot", "spring cloud"] },
      { id: "gpu", label: "GPU / CUDA", mode: "ignore", keywords: ["gpu", "cuda", "算子", "推理加速", "并行计算"] },
      { id: "chip", label: "芯片研发", mode: "ignore", keywords: ["芯片", "asic", "fpga", "eda", "rtl", "流片", "数字前端", "模拟电路"] },
      { id: "mobile", label: "移动端", mode: "exclude", keywords: ["android", "ios", "kotlin", "swift"] },
      { id: "product", label: "AI 产品", mode: "review", keywords: ["产品经理", "产品设计", "增长投放"] }
    ],
    customIncludeAny: [],
    customIncludeAll: [],
    customExcludeAny: [],
    customReviewAny: []
  };
  var DEFAULT_SETTINGS = {
    model: {
      endpoint: "http://10.1.0.231:28080/v1",
      model: "gpt-5.5",
      apiKey: "",
      persistApiKey: false,
      timeoutSeconds: 120,
      temperature: 0.35,
      extraHeaders: {}
    },
    filters: FILTERS,
    resumeProfile: null,
    liveUnlocked: false,
    maxJobsPerRun: 40,
    detailTimeoutSeconds: 90
  };
  var STORAGE_KEYS = {
    settings: "jobflow.settings.v1",
    run: "jobflow.run.v1",
    ledger: "jobflow.ledger.v1",
    secret: "jobflow.apiKey.v1"
  };

  // src/storage.ts
  async function loadSettings() {
    const saved = (await chrome.storage.local.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings];
    const secret = (await chrome.storage.session.get(STORAGE_KEYS.secret))[STORAGE_KEYS.secret];
    const merged = {
      ...DEFAULT_SETTINGS,
      ...saved,
      model: { ...DEFAULT_SETTINGS.model, ...saved?.model },
      filters: { ...DEFAULT_SETTINGS.filters, ...saved?.filters, directions: saved?.filters?.directions || DEFAULT_SETTINGS.filters.directions },
      resumeProfile: saved?.resumeProfile || null,
      liveUnlocked: false
    };
    if (!merged.model.persistApiKey) merged.model.apiKey = typeof secret === "string" ? secret : "";
    return merged;
  }

  // src/platforms/liepin.ts
  var text = (root, selector) => (root.querySelector(selector)?.innerText || root.querySelector(selector)?.textContent || "").replace(/\s+/g, " ").trim();
  function isLiepinListPage(location2 = window.location) {
    return /(^|\.)liepin\.com$/.test(location2.hostname) && location2.pathname === "/zhaopin/";
  }
  function isLiepinDetailPage(location2 = window.location) {
    return /(^|\.)liepin\.com$/.test(location2.hostname) && /\/(?:job|a)\/\d+\.shtml/i.test(location2.pathname);
  }
  function jobIdFromUrl(url) {
    return url.match(/\/(?:job|a)\/(\d+)\.shtml/i)?.[1] || "";
  }
  function pageTitleJob(href) {
    if (!jobIdFromUrl(href)) return "";
    return document.title.match(/【[^】]*\s+(.+?)招聘】/)?.[1]?.trim() || "";
  }
  function bodyLine(body, predicate) {
    const root = body instanceof Document ? body : body.ownerDocument || document;
    const leafLines = [...root.querySelectorAll("body *")].filter((node) => node.children.length === 0).map((node) => (node.innerText || node.textContent || "").trim()).filter(Boolean);
    const line = leafLines.find((value) => predicate(value));
    if (line) return line;
    const source = body instanceof Element ? body.innerText || body.textContent || "" : root.body?.innerText || body.textContent || "";
    return source.split(/\n+/).map((value) => value.trim()).find((value) => predicate(value)) || "";
  }
  function scanLiepinList(root = document) {
    const anchors = [...root.querySelectorAll('a[href*=".shtml"]')].filter((anchor) => /\/(?:job|a)\/\d+\.shtml/i.test(anchor.href));
    const seen = /* @__PURE__ */ new Set();
    const candidates = [];
    for (const anchor of anchors) {
      const jobId = jobIdFromUrl(anchor.href);
      if (!jobId || seen.has(jobId)) continue;
      const card = anchor.closest(".job-card-pc-container") || anchor.parentElement?.parentElement?.parentElement;
      if (!card) continue;
      const detailBox = anchor.closest(".job-detail-box") || anchor;
      const lines = [...anchor.querySelectorAll("*")].filter((node) => node.children.length === 0).map((node) => (node.innerText || node.textContent || "").trim()).filter(Boolean).filter((value) => value !== "【" && value !== "】" && value !== "急聘");
      const recruiter = text(card, ".recruiter-info-box");
      const companyArea = text(card, '[data-nick="job-detail-company-info"]');
      const title = text(anchor, '[title^="招聘"]') || lines[0] || "";
      const location2 = lines.find((value) => /北京|上海|广州|深圳|杭州|成都|武汉|西安|南京|天津|重庆|苏州|全国/.test(value)) || "";
      const salary = lines.find((value) => /\d+(?:\.\d+)?\s*[-~至]\s*\d+(?:\.\d+)?\s*k|\d+\s*[-~至]\s*\d+\s*万|面议/i.test(value)) || "";
      const experience = lines.find((value) => /经验不限|应届|实习|\d+年以上|\d+-\d+年/.test(value)) || "";
      const education = lines.find((value) => /本科|硕士|博士|大专|学历不限/.test(value)) || "";
      const company = [...card.querySelectorAll('[data-nick="job-detail-company-info"] span')].map((node) => (node.innerText || node.textContent || "").trim()).find(Boolean) || companyArea.split(/\s+/)[0] || "";
      const canonicalUrl = canonicalJobUrl(anchor.href);
      seen.add(jobId);
      candidates.push({ platform: "liepin", jobId, url: anchor.href, canonicalUrl, title, company, location: location2, salary, experience, education, cardText: `${card.innerText || card.textContent || ""} ${recruiter}`.replace(/\s+/g, " ").trim(), index: candidates.length });
    }
    return candidates;
  }
  function extractLiepinDetail(root = document, href = location.href) {
    const jobId = jobIdFromUrl(href);
    if (!jobId) return null;
    const body = root instanceof Document ? root.body : root.querySelector("body") || root;
    const bodyText = (body.textContent || "").replace(/\s+/g, " ").trim();
    const title = text(root, ".job-apply-content h1") || text(root, ".job-title-box h1") || text(root, ".job-detail-header h1") || text(root, ".job-title") || pageTitleJob(href) || bodyLine(body, (line) => line.length <= 80 && !/首页|职位|登录|招聘/.test(line));
    const description = text(root, ".job-intro-container .paragraph") || text(root, ".job-description .content") || text(root, ".job-detail-content") || text(root, ".job-intro-container");
    if (!title || description.length < 20) return null;
    const salary = text(root, ".job-salary") || bodyText.match(/\d+(?:\.\d+)?\s*[-~至]\s*\d+(?:\.\d+)?\s*k(?:·\d+薪)?/i)?.[0] || "";
    const propertyText = text(root, ".job-properties") || text(root, ".job-info");
    const locationText = propertyText.match(/北京(?:-[^\s]+)?|上海(?:-[^\s]+)?|广州(?:-[^\s]+)?|深圳(?:-[^\s]+)?|杭州(?:-[^\s]+)?/)?.[0] || "";
    const recruiterCareer = bodyLine(body, (line) => /(?:HR|招聘|猎头|顾问).*[·]|[·].*(?:HR|招聘|猎头|顾问)/i.test(line));
    const company = text(root, ".company-card .company-name") || text(root, ".company-info .company-name") || text(root, ".job-company-info h3") || text(root, ".company-name") || recruiterCareer.split(/[·]/).slice(-1)[0]?.trim() || "";
    const recruiterLine = bodyLine(body, (line) => /^[\p{Script=Han}]{1,4}(?:先生|女士)/u.test(line));
    const recruiter = text(root, ".recruiter-info .name") || text(root, ".recruiter-card .name") || text(root, ".hunter-info .name") || recruiterLine.match(/^[\p{Script=Han}]{1,4}(?:先生|女士)/u)?.[0] || "";
    return {
      platform: "liepin",
      jobId,
      url: href,
      canonicalUrl: canonicalJobUrl(href),
      title,
      company,
      location: locationText,
      salary,
      experience: propertyText.match(/经验不限|应届|实习|\d+年以上|\d+-\d+年/)?.[0] || "",
      education: propertyText.match(/统招本科|本科|硕士|博士|大专|学历不限/)?.[0] || "",
      cardText: bodyText.slice(0, 1500),
      index: -1,
      description,
      recruiter,
      recruiterTitle: text(root, ".recruiter-info .title") || text(root, ".recruiter-card .position") || text(root, ".hunter-info .title") || recruiterCareer.split(/[·]/)[0]?.trim() || ""
    };
  }

  // src/content/liepin.ts
  var ROOT_ID = "jobflow-batch-root";
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);
  }
  async function send(message) {
    return chrome.runtime.sendMessage(message);
  }
  async function renderListPanel() {
    if (!isLiepinListPage() || document.getElementById(ROOT_ID)) return;
    let settings = await loadSettings();
    const host = document.createElement("div");
    host.id = ROOT_ID;
    const root = host.attachShadow({ mode: "open" });
    document.documentElement.append(host);
    const scan = () => scanLiepinList();
    const draw = (candidates) => {
      const evaluated = candidates.map((candidate) => ({ candidate, decision: evaluateRules(candidate, settings.filters, false) }));
      const actionable = evaluated.filter((item) => item.decision.decision !== "skip").map((item) => item.candidate);
      root.innerHTML = `<style>${STYLE}</style><button id="open">批量模拟</button><section id="panel"><header><strong>猎聘批处理 · 模拟模式</strong><button id="close">×</button></header><p class="safe">不会发送、不会投递、不会点击“聊一聊”；逐岗读取详情、筛选、生成招呼并记录模拟结果。</p><div class="stats">列表去重 ${candidates.length}｜硬规则后 ${actionable.length}｜本批最多 ${settings.maxJobsPerRun}</div><div class="actions"><button id="refresh">重新扫描</button><button id="start">开始模拟</button><button id="pause">暂停</button><button id="resume">继续</button><button id="cancel">取消</button><button id="options">筛选与简历设置</button></div><div id="state">尚未运行</div><ol>${evaluated.slice(0, 40).map(({ candidate, decision }) => `<li class="${decision.decision}"><b>${esc(candidate.title)}</b> · ${esc(candidate.company)} · ${esc(candidate.salary)}<small>${esc(decision.reasons.join("；"))}</small></li>`).join("")}</ol></section>`;
      root.querySelector("#open")?.addEventListener("click", () => root.querySelector("#panel")?.classList.toggle("hidden"));
      root.querySelector("#close")?.addEventListener("click", () => root.querySelector("#panel")?.classList.add("hidden"));
      root.querySelector("#refresh")?.addEventListener("click", async () => {
        settings = await loadSettings();
        draw(scan());
      });
      root.querySelector("#options")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
      root.querySelector("#start")?.addEventListener("click", async () => {
        if (!settings.resumeProfile) {
          root.querySelector("#state").textContent = "请先在设置中导入简历并生成/保存画像";
          return;
        }
        await send({ type: "START_RUN", candidates: actionable, mode: "dry_run", sourceUrl: location.href });
        await refreshState();
      });
      root.querySelector("#pause")?.addEventListener("click", async () => {
        await send({ type: "PAUSE_RUN" });
        await refreshState();
      });
      root.querySelector("#resume")?.addEventListener("click", async () => {
        await send({ type: "RESUME_RUN" });
        await refreshState();
      });
      root.querySelector("#cancel")?.addEventListener("click", async () => {
        await send({ type: "CANCEL_RUN" });
        await refreshState();
      });
    };
    async function refreshState() {
      const data = await send({ type: "GET_STATE" });
      const node = root.querySelector("#state");
      if (node) node.textContent = data.run ? `状态 ${data.run.status}｜进度 ${data.run.currentIndex}/${data.run.items.length}｜模拟成功 ${data.run.simulatedCount}｜失败 ${data.run.failedCount}` : "尚未运行";
    }
    draw(scan());
    await refreshState();
    setInterval(() => void refreshState(), 1500);
  }
  async function reportDetail() {
    if (!isLiepinDetailPage()) return;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      const job = extractLiepinDetail();
      if (job) {
        clearInterval(timer);
        await send({ type: "DETAIL_READY", job });
      } else if (attempts >= 30) {
        clearInterval(timer);
        const id = location.pathname.match(/\/(?:job|a)\/(\d+)\.shtml/i)?.[1] || "";
        await send({ type: "DETAIL_FAILED", jobId: id, error: "详情DOM未在30秒内准备好" });
      }
    }, 1e3);
  }
  void renderListPanel();
  void reportDetail();
  var STYLE = `:host{all:initial;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#open{position:fixed;right:22px;bottom:88px;z-index:2147483646;border:0;border-radius:999px;background:#6d28d9;color:#fff;padding:12px 17px;font-weight:700;cursor:pointer}#panel{position:fixed;right:22px;bottom:140px;z-index:2147483647;width:min(620px,calc(100vw - 30px));max-height:calc(100vh - 165px);overflow:auto;background:#fff;color:#172033;border:1px solid #ddd;border-radius:14px;box-shadow:0 16px 50px #0004;padding:14px}.hidden{display:none}header,.actions{display:flex;gap:8px;align-items:center;justify-content:space-between}header button{border:0;background:none;font-size:20px}.safe{padding:8px;background:#ecfdf5;color:#166534;border-radius:8px}.stats,#state{margin:8px 0;color:#475569}.actions{justify-content:flex-start;flex-wrap:wrap}.actions button{border:1px solid #cbd5e1;background:#f8fafc;padding:6px 9px;border-radius:6px;cursor:pointer}li{padding:6px;margin:4px 0;background:#f8fafc;border-radius:6px}li.skip{opacity:.55}li.review{background:#fff7ed}small{display:block;color:#64748b;margin-top:2px}`;
})();
