import type { ExtensionSettings, FilterSettings } from "./types";

export const FILTERS: FilterSettings = {
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

export const DEFAULT_SETTINGS: ExtensionSettings = {
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

export const STORAGE_KEYS = {
  settings: "jobflow.settings.v1",
  run: "jobflow.run.v1",
  ledger: "jobflow.ledger.v1",
  secret: "jobflow.apiKey.v1"
} as const;

export const LIVE_CONFIRMATION_PHRASE = "我确认真实发送";
export const PROFILE_PROMPT_VERSION = "resume-profile-v1";
