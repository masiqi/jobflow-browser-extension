import { MODEL_PROVIDER_PRESETS, TECHNOLOGY_CATALOG } from "./defaults";
import { projectRuleEvidence } from "./domain/events";
import { readPastedResume, readResumeFile } from "./pdf";
import { sourceHash } from "./resume";
import { deleteResume, storeResumeFile, storeResumeText } from "./local/resume-store";
import { escapeHtml, formatTime, sendCommand } from "./ui/command";
import type {
  AppState,
  ExtensionSettings,
  OpportunityRecord,
  ResumeProfile
} from "./types";

type ViewName = "records" | "resume" | "rules" | "model" | "account";
type ResumeImportFeedback = {
  kind: "idle" | "progress" | "success" | "error";
  message: string;
};
type StoredRetryFeedback = {
  opportunityId: string;
  kind: "idle" | "progress" | "success" | "error";
  message: string;
};

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("管理台根节点不存在");
const app: HTMLDivElement = appElement;

let currentView: ViewName = "records";
let selectedOpportunityId = "";
let recordFilter = "all";
let recordSearch = "";
let resumeImportBusy = false;
let resumeImportFeedback: ResumeImportFeedback = { kind: "idle", message: "" };
let storedRetryBusyOpportunityId = "";
let storedRetryFeedback: StoredRetryFeedback = { opportunityId: "", kind: "idle", message: "" };

const STATUS_LABELS: Record<string, string> = {
  discovered: "待处理",
  queued: "队列中",
  extracting: "读取详情",
  deterministic_excluded: "规则排除",
  evaluating: "模型评估",
  model_excluded: "模型淘汰",
  review_required: "待复核",
  generating: "生成中",
  draft_ready: "待发草稿",
  user_excluded: "用户排除",
  failed: "处理失败"
};

function navMarkup(): string {
  const entries: Array<[ViewName, string]> = [
    ["records", "职位记录"],
    ["resume", "简历画像"],
    ["rules", "JD 规则"],
    ["model", "模型服务"],
    ["account", "账号"]
  ];
  return entries.map(([value, label]) =>
    '<button type="button" data-view="' + value + '" class="' + (currentView === value ? "active" : "") + '">'
    + label + "</button>"
  ).join("");
}

function accountView(state: AppState): string {
  if (state.auth.status !== "signed_in") {
    return [
      '<div class="page-heading"><h2>账号</h2><p>使用邮箱和密码注册或登录。邮箱暂不验证，也不提供自助找回。</p></div>',
      '<div class="form-grid auth-form">',
      '<label>邮箱<input id="email" type="email" autocomplete="username"></label>',
      '<label>密码<input id="password" type="password" minlength="8" autocomplete="current-password"></label>',
      '</div><div class="actions"><button class="primary" data-action="login">登录</button>',
      '<button data-action="register">注册</button></div>'
    ].join("");
  }
  return [
    '<div class="page-heading"><h2>账号</h2><p>账号数据由 Supabase RLS 隔离。</p></div>',
    '<dl class="details"><dt>邮箱</dt><dd>' + escapeHtml(state.auth.email) + '</dd>',
    '<dt>邮箱认证</dt><dd>' + escapeHtml(state.auth.emailVerificationStatus) + '</dd>',
    '<dt>模型权益</dt><dd>' + (state.auth.vip ? "VIP 托管模型" : "BYOK") + '</dd></dl>',
    '<label class="check"><input id="launcherVisible" type="checkbox" ' + (state.settings.launcherVisible ? "checked" : "")
      + '><span>在猎聘页面显示侧边栏入口</span></label>',
    '<div class="actions"><button data-action="save-interface">保存界面设置</button><button data-action="logout">退出登录</button>',
    '<button class="danger-quiet" data-action="delete-my-data">删除我的求职数据</button></div>'
  ].join("");
}

function resumeView(state: AppState): string {
  if (state.auth.status !== "signed_in") return '<div class="empty-state">登录后管理简历画像。</div>';
  const profile = state.resumeProfile;
  const allFactsApproved = profile
    ? profile.facts.length > 0 && profile.facts.every((fact) => fact.approved)
    : false;
  const profileMarkup = profile ? [
    '<div class="profile-status"><span class="badge ' + escapeHtml(profile.state) + '">' + escapeHtml(profile.state)
      + '</span><b>' + escapeHtml(profile.sourceName) + '</b><small>版本 ' + profile.version + " · 本地原件 "
      + escapeHtml(state.localResumeState) + '</small></div>',
    '<label>画像摘要<textarea id="profileSummary" ' + (profile.state === "draft" ? "" : "disabled") + '>'
      + escapeHtml(profile.summary) + '</textarea></label>',
    '<div class="form-grid"><label>目标岗位<input id="targetRoles" value="' + escapeHtml(profile.targetRoles.join(", "))
      + '" ' + (profile.state === "draft" ? "" : "disabled") + '></label>',
    '<label>技能<input id="profileSkills" value="' + escapeHtml(profile.skills.join(", "))
      + '" ' + (profile.state === "draft" ? "" : "disabled") + '></label></div>',
    '<label>明确限制<textarea id="profileConstraints" ' + (profile.state === "draft" ? "" : "disabled") + '>'
      + escapeHtml(profile.constraints.join("\n")) + '</textarea></label>',
    '<div class="fact-list-heading"><h3>可引用事实</h3>',
    profile.state === "draft"
      ? '<label class="check"><input id="approveAllFacts" type="checkbox" '
        + (allFactsApproved ? "checked" : "") + '><span>全部允许引用</span></label>'
      : "",
    '</div><div class="fact-list">',
    profile.facts.map((fact) =>
      '<div class="fact"><label class="check"><input type="checkbox" data-fact-approved="' + escapeHtml(fact.id)
      + '" ' + (fact.approved ? "checked" : "") + " " + (profile.state === "draft" ? "" : "disabled")
      + '><span>允许引用</span></label><input data-fact-text="' + escapeHtml(fact.id) + '" value="'
      + escapeHtml(fact.text) + '" ' + (profile.state === "draft" ? "" : "disabled")
      + '><small>证据：' + escapeHtml(fact.evidence) + '</small></div>'
    ).join(""),
    '</div>',
    profile.state === "draft"
      ? '<div class="actions"><button data-action="save-profile">保存修改</button><button class="primary" data-action="activate-profile">确认并启用</button></div>'
      : "",
    '<div class="actions"><button class="danger-quiet" data-action="delete-local-resume">删除本地原件</button></div>'
  ].join("") : '<div class="empty-state">导入简历后，模型会生成一份必须审核的结构化画像。</div>';

  return [
    '<div class="page-heading"><h2>简历画像</h2><p>原始文件只保存在当前 Chrome profile，云端仅保存结构化画像。</p></div>',
    '<p class="route-disclosure">本次模型路径：' + escapeHtml(state.settings.model.route.toUpperCase()) + " · "
      + escapeHtml(state.settings.model.provider) + " / " + escapeHtml(state.settings.model.model) + "</p>",
    '<div class="import-band" aria-busy="' + String(resumeImportBusy) + '"><label>选择文件<input id="resumeFile" type="file" '
      + (resumeImportBusy ? "disabled " : "") + 'accept=".pdf,.docx,.txt,.md,.markdown"></label>',
    '<span>或</span><label class="paste">粘贴简历文本<textarea id="pastedResume" '
      + (resumeImportBusy ? "disabled " : "") + 'placeholder="粘贴纯文本简历"></textarea></label>',
    '<button class="primary import-button" data-action="import-resume" data-busy="' + String(resumeImportBusy) + '" '
      + (resumeImportBusy ? "disabled" : "") + '>' + escapeHtml(resumeImportBusy ? resumeImportFeedback.message : "解析并生成画像")
      + '</button></div>',
    '<div id="resumeImportStatus" class="import-status ' + escapeHtml(resumeImportFeedback.kind)
      + '" role="status" aria-live="polite">' + escapeHtml(resumeImportFeedback.message) + "</div>",
    profileMarkup
  ].join("");
}

function rulesView(state: AppState): string {
  const rules = state.settings.rules;
  return [
    '<div class="page-heading"><h2>JD 细筛规则</h2><p>规则默认关闭，只支持以下五类结构化条件。</p></div>',
    '<div class="settings-list">',
    '<label class="setting"><span><b>学校背景</b><small>排除明确强制要求 985/211/双一流等职位</small></span>',
    '<select id="schoolPedigree"><option value="disabled">关闭</option><option value="reject_mandatory" '
      + (rules.schoolPedigree === "reject_mandatory" ? "selected" : "") + '>排除强制要求</option></select></label>',
    '<label class="setting"><span><b>出差与流动</b><small>表达不明确时进入人工复核</small></span>',
    '<select id="travel"><option value="disabled">关闭</option><option value="none" ' + (rules.travel === "none" ? "selected" : "")
      + '>不接受出差</option><option value="occasional" ' + (rules.travel === "occasional" ? "selected" : "")
      + '>只接受偶尔出差</option><option value="unrestricted" ' + (rules.travel === "unrestricted" ? "selected" : "")
      + '>不限制</option></select></label>',
    toggle("rejectOutsourcing", "外包", rules.rejectOutsourcing),
    toggle("rejectDispatch", "劳务派遣", rules.rejectDispatch),
    toggle("rejectLongTermClientSite", "长期客户驻场", rules.rejectLongTermClientSite),
    toggle("rejectNightShift", "夜班", rules.rejectNightShift),
    toggle("rejectRotatingShift", "倒班或轮班", rules.rejectRotatingShift),
    toggle("rejectBigSmallWeek", "大小周", rules.rejectBigSmallWeek),
    toggle("rejectSingleRestDay", "单休", rules.rejectSingleRestDay),
    toggle("rejectLongTermOnCall", "长期 on-call", rules.rejectLongTermOnCall),
    '</div><h3>排除的核心技术</h3><div class="technology-grid">',
    TECHNOLOGY_CATALOG.map((technology) =>
      '<label class="check"><input type="checkbox" data-technology="' + technology.id + '" '
      + (rules.rejectedPrimaryTechnologies.includes(technology.id) ? "checked" : "")
      + '><span>' + escapeHtml(technology.label) + '</span></label>'
    ).join(""),
    '</div><div class="actions"><button class="primary" data-action="save-rules">保存规则</button></div>'
  ].join("");
}

function toggle(id: string, label: string, checked: boolean): string {
  return '<label class="setting"><span><b>' + escapeHtml(label)
    + '</b><small>明确要求时排除，含糊时复核</small></span><input id="' + id
    + '" type="checkbox" ' + (checked ? "checked" : "") + "></label>";
}

function modelView(state: AppState): string {
  const model = state.settings.model;
  return [
    '<div class="page-heading"><h2>模型服务</h2><p>当前路由会在发送任何简历或 JD 文本前明确显示。</p></div>',
    '<div class="form-grid">',
    '<label>路由<select id="modelRoute"><option value="byok">BYOK</option><option value="managed" '
      + (model.route === "managed" ? "selected" : "") + " " + (state.auth.vip ? "" : "disabled")
      + '>VIP 托管模型</option></select></label>',
    '<label>供应商<select id="provider">',
    ["openai", "deepseek", "openrouter", "custom"].map((provider) =>
      '<option value="' + provider + '" ' + (model.provider === provider ? "selected" : "") + ">"
      + escapeHtml(provider) + "</option>"
    ).join(""),
    '</select></label>',
    '<label>HTTPS Endpoint<input id="endpoint" value="' + escapeHtml(model.endpoint) + '"></label>',
    '<label>模型<input id="model" value="' + escapeHtml(model.model) + '"></label>',
    '<label>API Key<input id="apiKey" type="password" autocomplete="off" placeholder="不会同步到云端"></label>',
    '<label class="check remember"><input id="rememberKey" type="checkbox" ' + (model.rememberKey ? "checked" : "")
      + '><span>记住在此设备</span></label></div>',
    '<p class="disclosure">记住的 Key 位于 Chrome 扩展本地存储，不是系统 Keychain。新设备无法恢复。</p>',
    '<div class="actions"><button data-action="save-model">保存配置</button>',
    '<button class="primary" data-action="test-model">连接测试</button>',
    '<button class="danger-quiet" data-action="clear-key">删除本机 Key</button></div>',
    '<dl class="details"><dt>测试状态</dt><dd>' + (model.connectionTestedAt ? "已通过 " + formatTime(model.connectionTestedAt) : "未测试")
      + '</dd><dt>当前数据路径</dt><dd>' + (model.route === "managed" ? "VIP 托管模型" : "BYOK 临时代理")
      + '</dd></dl>'
  ].join("");
}

function recordView(state: AppState): string {
  const query = recordSearch.trim().toLowerCase();
  const records = state.opportunities.filter((record) => {
    const matchesStatus = recordFilter === "all" || record.status === recordFilter;
    const matchesSearch = !query || (record.title + " " + record.company).toLowerCase().includes(query);
    return matchesStatus && matchesSearch;
  });
  const selected = state.opportunities.find((record) => record.id === selectedOpportunityId) ?? records[0];
  if (selected && !selectedOpportunityId) selectedOpportunityId = selected.id;
  return [
    '<div class="page-heading"><h2>职位记录</h2><p>所有判断、草稿和人工操作都保留追加式历史。</p></div>',
    '<div class="record-toolbar"><select id="recordFilter"><option value="all">全部状态</option>',
    Object.entries(STATUS_LABELS).map(([value, label]) =>
      '<option value="' + value + '" ' + (recordFilter === value ? "selected" : "") + ">" + label + "</option>"
    ).join(""),
    '</select><input id="recordSearch" type="search" value="' + escapeHtml(recordSearch) + '" placeholder="搜索职位或公司"></div>',
    '<div class="record-layout"><div class="record-table">',
    records.map((record) => recordRow(record, selected?.id === record.id)).join("")
      || '<div class="empty-state">没有符合条件的职位记录。</div>',
    '</div><div class="record-detail">', selected ? recordDetail(state, selected) : '<div class="empty-state">选择一条记录查看详情。</div>',
    '</div></div>'
  ].join("");
}

function recordRow(record: OpportunityRecord, selected: boolean): string {
  return '<button type="button" class="record-row ' + (selected ? "selected" : "") + '" data-record-id="'
    + escapeHtml(record.id) + '"><span class="status-dot ' + escapeHtml(record.status)
    + '"></span><span><b>' + escapeHtml(record.title) + '</b><small>' + escapeHtml(record.company)
    + " · " + escapeHtml(STATUS_LABELS[record.status] || record.status) + '</small></span><time>'
    + escapeHtml(formatTime(record.lastSeenAt)) + "</time></button>";
}

function recordDetail(state: AppState, record: OpportunityRecord): string {
  const evaluation = state.evaluations.find((item) => item.opportunityId === record.id);
  const evaluationProfile = evaluation
    ? state.resumeProfiles.find((profile) => profile.id === evaluation.profileId)
    : undefined;
  const citedFacts = evaluationProfile?.facts.filter((fact) => evaluation?.factIds.includes(fact.id)) ?? [];
  const events = state.events.filter((event) => event.opportunityId === record.id).slice().reverse();
  const ruleEvidence = projectRuleEvidence(events);
  const draft = state.drafts.find((item) => item.opportunityId === record.id);
  const canOverride = ["deterministic_excluded", "model_excluded", "user_excluded"].includes(record.status);
  const canRetryStored = record.status === "failed" && Boolean(record.description?.trim());
  const retryBusy = Boolean(storedRetryBusyOpportunityId);
  const retryFeedback = storedRetryFeedback.opportunityId === record.id ? storedRetryFeedback : null;
  return [
    '<div class="detail-heading"><div><span class="badge ' + escapeHtml(record.status) + '">'
      + escapeHtml(STATUS_LABELS[record.status] || record.status) + '</span><h3>' + escapeHtml(record.title)
      + '</h3><p>' + escapeHtml(record.company) + " · " + escapeHtml(record.location) + " · "
      + escapeHtml(record.salary) + '</p></div><button data-action="open-job" data-url="' + escapeHtml(record.canonicalUrl)
      + '">打开职位</button></div>',
    record.latestReason ? '<div class="reason"><b>当前原因</b><p>' + escapeHtml(record.latestReason) + "</p></div>" : "",
    canRetryStored || retryFeedback
      ? '<div class="stored-retry" aria-busy="' + String(retryBusy) + '">'
        + (canRetryStored
          ? '<button class="primary" type="button" data-action="retry-stored-opportunity" data-id="'
            + escapeHtml(record.id) + '" ' + (retryBusy ? "disabled" : "") + '>'
            + (retryBusy ? "正在重试" : "使用已保存详情重试") + "</button>"
          : "")
        + '<p id="storedRetryStatus" class="stored-retry-status ' + escapeHtml(retryFeedback?.kind ?? "idle")
        + '" role="status" aria-live="polite" aria-atomic="true">'
        + escapeHtml(retryFeedback?.message ?? "") + "</p></div>"
      : "",
    ruleEvidence.length ? '<div class="detail-section"><h4>JD 规则证据</h4>'
      + ruleEvidence.map((item) => '<div class="evidence-item"><b>' + escapeHtml(item.ruleId)
        + '</b><p>' + escapeHtml(item.reason) + '</p><blockquote>' + escapeHtml(item.evidence.join("\n"))
        + "</blockquote></div>").join("") + "</div>" : "",
    record.description ? '<div class="detail-section"><h4>已保存职位详情</h4>'
      + (record.recruiter || record.recruiterTitle
        ? '<p class="recruiter-metadata"><b>招聘方</b> ' + escapeHtml(record.recruiter || "未提供")
          + (record.recruiterTitle ? " · " + escapeHtml(record.recruiterTitle) : "") + "</p>"
        : "")
      + '<div class="job-description">' + escapeHtml(record.description) + "</div>"
      + (record.jdHash ? '<small class="detail-hash">JD SHA-256：' + escapeHtml(record.jdHash) + "</small>" : "")
      + "</div>" : "",
    evaluation ? '<div class="detail-section"><h4>模型评估</h4><p>' + escapeHtml(evaluation.reasons.join("；"))
      + '</p><small>' + escapeHtml(evaluation.model.provider) + " / " + escapeHtml(evaluation.model.model)
      + '</small><blockquote>' + escapeHtml(evaluation.jdEvidence.join("\n")) + "</blockquote>"
      + (citedFacts.length ? '<div class="cited-facts">' + citedFacts.map((fact) =>
        '<p><b>' + escapeHtml(fact.id) + '</b> ' + escapeHtml(fact.text) + '</p>'
      ).join("") + "</div>" : "") + "</div>" : "",
    draft ? '<div class="detail-section"><h4>当前草稿</h4><textarea id="draftText" maxlength="200">'
      + escapeHtml(draft.currentText) + '</textarea><div class="actions"><button data-action="save-draft" data-id="'
      + escapeHtml(record.id) + '">保存修改</button><button data-action="regenerate" data-id="'
      + escapeHtml(record.id) + '">重新生成</button></div><details><summary>修订历史 '
      + draft.revisions.length + '</summary>' + draft.revisions.slice().reverse().map((revision) =>
        '<div class="revision"><b>' + (revision.kind === "generated" ? "模型生成" : "用户编辑")
        + '</b><time>' + escapeHtml(formatTime(revision.createdAt)) + '</time><p>' + escapeHtml(revision.text) + "</p></div>"
      ).join("") + "</details></div>" : "",
    record.status === "review_required"
      ? '<div class="actions"><button class="primary" data-action="review-continue" data-id="' + escapeHtml(record.id)
        + '">继续生成</button><button data-action="review-exclude" data-id="' + escapeHtml(record.id)
        + '">永久排除</button></div>' : "",
    canOverride
      ? '<div class="actions"><button class="primary" data-action="override" data-id="' + escapeHtml(record.id)
        + '">作为例外继续</button></div>' : "",
    '<div class="detail-section"><h4>历史</h4><ol class="timeline">',
    events.map((event) =>
      '<li><span></span><div><b>' + escapeHtml(event.kind) + '</b><time>' + escapeHtml(formatTime(event.createdAt))
      + '</time><small>' + escapeHtml(event.actor) + "</small></div></li>"
    ).join("") || '<li>暂无事件</li>',
    '</ol></div>'
  ].join("");
}

function mainView(state: AppState): string {
  switch (currentView) {
    case "records": return recordView(state);
    case "resume": return resumeView(state);
    case "rules": return rulesView(state);
    case "model": return modelView(state);
    case "account": return accountView(state);
  }
}

async function render(): Promise<void> {
  let state: AppState;
  try {
    state = await sendCommand<AppState>({ type: "GET_APP_STATE" });
  } catch (error) {
    app.innerHTML = '<div class="fatal">' + escapeHtml(error instanceof Error ? error.message : error) + "</div>";
    return;
  }
  app.innerHTML = [
    '<aside><div class="brand"><span>JF</span><div><b>JobFlow</b><small>猎聘草稿助手</small></div></div>',
    '<nav>', navMarkup(), '</nav><div class="mode"><span></span><div><b>仅生成草稿</b><small>无平台写操作</small></div></div></aside>',
    '<main><header><div><b>' + escapeHtml(state.auth.email || "未登录") + '</b><small>'
      + (state.auth.vip ? "VIP · " : "") + escapeHtml(state.settings.model.route.toUpperCase()) + " · "
      + escapeHtml(state.settings.model.provider) + " / " + escapeHtml(state.settings.model.model)
      + '</small></div></header>',
    '<div class="content">', mainView(state), '</div><div id="toast" role="status" aria-live="polite"></div></main>'
  ].join("");
  bindActions(state);
}

function inputValue(id: string): string {
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement>("#" + id)?.value.trim() ?? "";
}

function checked(id: string): boolean {
  return document.querySelector<HTMLInputElement>("#" + id)?.checked ?? false;
}

function csv(value: string): string[] {
  return value.split(/[,，\n]+/).map((item) => item.trim()).filter(Boolean);
}

function collectProfile(profile: ResumeProfile): ResumeProfile {
  return {
    ...profile,
    summary: inputValue("profileSummary"),
    targetRoles: csv(inputValue("targetRoles")),
    skills: csv(inputValue("profileSkills")),
    constraints: csv(inputValue("profileConstraints")),
    facts: profile.facts.map((fact) => ({
      ...fact,
      approved: document.querySelector<HTMLInputElement>('[data-fact-approved="' + CSS.escape(fact.id) + '"]')?.checked ?? false,
      text: document.querySelector<HTMLInputElement>('[data-fact-text="' + CSS.escape(fact.id) + '"]')?.value.trim() || fact.text
    }))
  };
}

function collectRules(settings: ExtensionSettings): ExtensionSettings {
  const school = document.querySelector<HTMLSelectElement>("#schoolPedigree")?.value;
  const travel = document.querySelector<HTMLSelectElement>("#travel")?.value;
  return {
    ...settings,
    rules: {
      version: 1,
      schoolPedigree: school === "reject_mandatory" ? "reject_mandatory" : "disabled",
      travel: travel === "none" || travel === "occasional" || travel === "unrestricted" ? travel : "disabled",
      rejectOutsourcing: checked("rejectOutsourcing"),
      rejectDispatch: checked("rejectDispatch"),
      rejectLongTermClientSite: checked("rejectLongTermClientSite"),
      rejectNightShift: checked("rejectNightShift"),
      rejectRotatingShift: checked("rejectRotatingShift"),
      rejectBigSmallWeek: checked("rejectBigSmallWeek"),
      rejectSingleRestDay: checked("rejectSingleRestDay"),
      rejectLongTermOnCall: checked("rejectLongTermOnCall"),
      rejectedPrimaryTechnologies: [...document.querySelectorAll<HTMLInputElement>("[data-technology]:checked")]
        .map((input) => input.dataset.technology || "")
        .filter(Boolean)
    }
  };
}

function collectModel(settings: ExtensionSettings): ExtensionSettings {
  const route = document.querySelector<HTMLSelectElement>("#modelRoute")?.value === "managed" ? "managed" : "byok";
  const providerValue = document.querySelector<HTMLSelectElement>("#provider")?.value;
  const provider = providerValue === "deepseek" || providerValue === "openrouter" || providerValue === "custom"
    ? providerValue
    : "openai";
  return {
    ...settings,
    model: {
      route,
      provider,
      endpoint: inputValue("endpoint"),
      model: inputValue("model"),
      rememberKey: checked("rememberKey")
    }
  };
}

function bindActions(state: AppState): void {
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      currentView = (button.dataset.view || "records") as ViewName;
      void render();
    });
  });
  document.querySelectorAll<HTMLElement>("[data-record-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedOpportunityId = button.dataset.recordId || "";
      void render();
    });
  });
  document.querySelector("#recordFilter")?.addEventListener("change", (event) => {
    recordFilter = (event.currentTarget as HTMLSelectElement).value;
    selectedOpportunityId = "";
    void render();
  });
  document.querySelector("#recordSearch")?.addEventListener("change", (event) => {
    recordSearch = (event.currentTarget as HTMLInputElement).value;
    selectedOpportunityId = "";
    void render();
  });
  document.querySelector("#provider")?.addEventListener("change", (event) => {
    const provider = (event.currentTarget as HTMLSelectElement).value;
    if (provider === "openai" || provider === "deepseek" || provider === "openrouter") {
      const preset = MODEL_PROVIDER_PRESETS[provider];
      const endpoint = document.querySelector<HTMLInputElement>("#endpoint");
      const model = document.querySelector<HTMLInputElement>("#model");
      if (endpoint) endpoint.value = preset.endpoint;
      if (model) model.value = preset.defaultModel;
    }
  });
  const factApprovals = [...document.querySelectorAll<HTMLInputElement>("[data-fact-approved]")];
  const approveAllFacts = document.querySelector<HTMLInputElement>("#approveAllFacts");
  const syncFactApprovalMaster = () => {
    if (!approveAllFacts) return;
    const approvedCount = factApprovals.filter((input) => input.checked).length;
    approveAllFacts.checked = factApprovals.length > 0 && approvedCount === factApprovals.length;
    approveAllFacts.indeterminate = approvedCount > 0 && approvedCount < factApprovals.length;
  };
  approveAllFacts?.addEventListener("change", () => {
    for (const input of factApprovals) input.checked = approveAllFacts.checked;
    syncFactApprovalMaster();
  });
  for (const input of factApprovals) input.addEventListener("change", syncFactApprovalMaster);
  syncFactApprovalMaster();
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => void handleAction(button.dataset.action || "", button, state));
  });
}

async function handleAction(action: string, target: HTMLElement, state: AppState): Promise<void> {
  if (action === "import-resume") {
    await runResumeImport(state);
    return;
  }
  if (action === "retry-stored-opportunity") {
    await runStoredOpportunityRetry(target.dataset.id || "");
    return;
  }
  try {
    if (action === "login" || action === "register") {
      await sendCommand({
        type: action === "login" ? "AUTH_LOGIN" : "AUTH_REGISTER",
        email: inputValue("email"),
        password: inputValue("password")
      });
    } else if (action === "logout") {
      await sendCommand({ type: "AUTH_LOGOUT" });
    } else if (action === "save-interface") {
      await sendCommand({
        type: "UPDATE_SETTINGS",
        settings: { ...state.settings, launcherVisible: checked("launcherVisible") }
      });
    } else if (action === "delete-my-data") {
      if (confirm("永久删除云端画像、规则、职位、草稿和当前设备简历原件？此操作无法恢复。")) {
        await sendCommand({ type: "DELETE_MY_DATA" });
      }
    } else if (action === "save-rules") {
      await sendCommand({ type: "UPDATE_SETTINGS", settings: collectRules(state.settings) });
    } else if (action === "save-model" || action === "test-model") {
      const settings = collectModel(state.settings);
      await sendCommand({ type: "UPDATE_SETTINGS", settings });
      const apiKey = inputValue("apiKey");
      if (apiKey) await sendCommand({ type: "SET_BYOK_KEY", apiKey, remember: settings.model.rememberKey });
      if (action === "test-model") await sendCommand({ type: "TEST_MODEL" });
    } else if (action === "clear-key") {
      await sendCommand({ type: "CLEAR_BYOK_KEY" });
    } else if (action === "save-profile" && state.resumeProfile) {
      await sendCommand({ type: "SAVE_PROFILE", profile: collectProfile(state.resumeProfile) });
    } else if (action === "activate-profile" && state.resumeProfile) {
      const profile = collectProfile(state.resumeProfile);
      await sendCommand({ type: "SAVE_PROFILE", profile });
      await sendCommand({ type: "ACTIVATE_PROFILE", profileId: profile.id });
    } else if (action === "delete-local-resume" && state.resumeProfile && state.auth.userId) {
      if (confirm("只删除当前设备上的简历原件？云端结构化画像会保留。")) {
        await deleteResume(state.auth.userId, state.resumeProfile.sourceHash);
      }
    } else if (action === "save-draft") {
      await sendCommand({
        type: "EDIT_DRAFT",
        opportunityId: target.dataset.id || "",
        text: inputValue("draftText")
      });
    } else if (action === "regenerate") {
      await sendCommand({ type: "REGENERATE_DRAFT", opportunityId: target.dataset.id || "" });
    } else if (action === "review-continue" || action === "review-exclude") {
      await sendCommand({
        type: "REVIEW_DECISION",
        opportunityId: target.dataset.id || "",
        decision: action === "review-continue" ? "continue_generation" : "permanently_exclude"
      });
    } else if (action === "override") {
      if (confirm("保留原排除记录，并作为例外继续生成草稿？")) {
        await sendCommand({ type: "CONTINUE_AS_EXCEPTION", opportunityId: target.dataset.id || "" });
      }
    } else if (action === "open-job") {
      const url = target.dataset.url;
      if (url) await chrome.tabs.create({ url, active: true });
    }
    await render();
    showToast("已保存");
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), true);
  }
}

function updateStoredRetryFeedback(feedback: StoredRetryFeedback, busy: boolean): void {
  storedRetryFeedback = feedback;
  storedRetryBusyOpportunityId = busy ? feedback.opportunityId : "";
  const panel = document.querySelector<HTMLElement>(".stored-retry");
  const status = document.querySelector<HTMLElement>("#storedRetryStatus");
  const button = document.querySelector<HTMLButtonElement>('[data-action="retry-stored-opportunity"]');
  panel?.setAttribute("aria-busy", String(busy));
  if (status) {
    status.textContent = feedback.message;
    status.className = "stored-retry-status " + feedback.kind;
  }
  if (button && button.dataset.id === feedback.opportunityId) {
    button.disabled = busy;
    button.textContent = busy ? "正在重试" : "使用已保存详情重试";
  }
}

async function runStoredOpportunityRetry(opportunityId: string): Promise<void> {
  if (!opportunityId || storedRetryBusyOpportunityId) return;
  updateStoredRetryFeedback({
    opportunityId,
    kind: "progress",
    message: "正在使用已保存的职位详情重试"
  }, true);
  try {
    await sendCommand({ type: "RETRY_STORED_OPPORTUNITY", opportunityId });
    storedRetryFeedback = {
      opportunityId,
      kind: "success",
      message: "重试完成，职位处理记录已更新"
    };
    storedRetryBusyOpportunityId = "";
    await render();
  } catch (error) {
    storedRetryFeedback = {
      opportunityId,
      kind: "error",
      message: error instanceof Error ? error.message : String(error)
    };
    storedRetryBusyOpportunityId = "";
    await render();
  }
}

function updateResumeImportFeedback(feedback: ResumeImportFeedback, busy: boolean): void {
  resumeImportFeedback = feedback;
  resumeImportBusy = busy;
  const band = document.querySelector<HTMLElement>(".import-band");
  const status = document.querySelector<HTMLElement>("#resumeImportStatus");
  const button = document.querySelector<HTMLButtonElement>('[data-action="import-resume"]');
  const file = document.querySelector<HTMLInputElement>("#resumeFile");
  const pasted = document.querySelector<HTMLTextAreaElement>("#pastedResume");
  band?.setAttribute("aria-busy", String(busy));
  if (status) {
    status.textContent = feedback.message;
    status.className = "import-status " + feedback.kind;
  }
  if (button) {
    button.disabled = busy;
    button.dataset.busy = String(busy);
    button.textContent = busy ? feedback.message : "解析并生成画像";
  }
  if (file) file.disabled = busy;
  if (pasted) pasted.disabled = busy;
}

async function runResumeImport(state: AppState): Promise<void> {
  if (resumeImportBusy) return;
  updateResumeImportFeedback({ kind: "progress", message: "正在读取简历" }, true);
  try {
    await importResume(state);
    updateResumeImportFeedback({ kind: "progress", message: "正在加载画像" }, true);
    await render();
    updateResumeImportFeedback({
      kind: "success",
      message: "画像已生成，请审核并确认允许引用的事实"
    }, false);
    showToast("画像已生成");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateResumeImportFeedback({ kind: "error", message }, false);
    showToast(message, true);
  }
}

async function importResume(state: AppState): Promise<void> {
  if (state.auth.status !== "signed_in" || !state.auth.userId) throw new Error("请先登录");
  const file = document.querySelector<HTMLInputElement>("#resumeFile")?.files?.[0];
  const pasted = inputValue("pastedResume");
  if (!file && !pasted) throw new Error("请选择简历文件或粘贴文本");
  const parsed = file ? await readResumeFile(file) : readPastedResume(pasted);
  updateResumeImportFeedback({ kind: "progress", message: "正在保存本地原件" }, true);
  const hash = await sourceHash(parsed.normalizedText);
  const metadata = {
    userId: state.auth.userId,
    sourceHash: hash,
    sourceName: parsed.sourceName,
    sourceKind: parsed.sourceKind,
    mimeType: parsed.mimeType,
    size: parsed.size,
    storedAt: new Date().toISOString()
  };
  if (file) await storeResumeFile(metadata, file);
  else await storeResumeText(metadata, parsed.normalizedText);
  updateResumeImportFeedback({ kind: "progress", message: "正在调用模型生成画像" }, true);
  await sendCommand({
    type: "IMPORT_RESUME",
    sourceName: parsed.sourceName,
    sourceKind: parsed.sourceKind,
    sourceHash: hash,
    normalizedText: parsed.normalizedText
  });
}

function showToast(message: string, error = false): void {
  const toast = document.querySelector<HTMLElement>("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = error ? "error" : "success";
  window.setTimeout(() => {
    toast.textContent = "";
    toast.className = "";
  }, 3500);
}

void render();
