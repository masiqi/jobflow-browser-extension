import type { ExtensionSettings, JdRuleSettings, ModelProvider } from "./types";

export const TECHNOLOGY_CATALOG = [
  { id: "java", label: "Java", aliases: ["java", "spring", "spring boot", "springcloud", "spring cloud"] },
  { id: "dotnet", label: ".NET", aliases: [".net", "c#", "asp.net"] },
  { id: "php", label: "PHP", aliases: ["php", "laravel", "thinkphp"] },
  { id: "android", label: "Android", aliases: ["android", "kotlin"] },
  { id: "ios", label: "iOS", aliases: ["ios", "swift", "objective-c"] },
  { id: "cpp", label: "C / C++", aliases: ["c++", "cpp"] }
] as const;

export const MODEL_PROVIDER_PRESETS: Record<
  Exclude<ModelProvider, "custom">,
  { endpoint: string; defaultModel: string }
> = {
  openai: { endpoint: "https://api.openai.com/v1", defaultModel: "gpt-5-mini" },
  deepseek: { endpoint: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  openrouter: { endpoint: "https://openrouter.ai/api/v1", defaultModel: "" }
};

export const DEFAULT_RULES: JdRuleSettings = {
  version: 1,
  schoolPedigree: "disabled",
  travel: "disabled",
  rejectOutsourcing: false,
  rejectDispatch: false,
  rejectLongTermClientSite: false,
  rejectNightShift: false,
  rejectRotatingShift: false,
  rejectBigSmallWeek: false,
  rejectSingleRestDay: false,
  rejectLongTermOnCall: false,
  rejectedPrimaryTechnologies: []
};

export const LIEPIN_DETAIL_NAVIGATION_DELAY_MIN_SECONDS = 15;
export const LIEPIN_DETAIL_NAVIGATION_DELAY_MAX_SECONDS = 30;
export const LIEPIN_DETAIL_MIN_DWELL_SECONDS = 8;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  rules: DEFAULT_RULES,
  model: {
    route: "byok",
    provider: "openai",
    endpoint: MODEL_PROVIDER_PRESETS.openai.endpoint,
    model: MODEL_PROVIDER_PRESETS.openai.defaultModel,
    rememberKey: false
  },
  executionPolicy: "reviewed_send",
  maxJobsPerBatch: 500,
  dailySendLimit: 150,
  automaticSendDelayMinSeconds: 10,
  automaticSendDelayMaxSeconds: 20,
  detailTimeoutSeconds: 90,
  launcherVisible: true
};

export const STORAGE_KEYS = {
  settings: "jobflow.settings.v2",
  run: "jobflow.run.v2",
  scanPreview: "jobflow.scanPreview.v2",
  automaticWriteThrottle: "jobflow.automaticWriteThrottle.v1",
  liepinNavigationThrottle: "jobflow.liepinNavigationThrottle.v1",
  sessionKey: "jobflow.byok.session.v2",
  rememberedKey: "jobflow.byok.remembered.v2",
  deviceOwner: "jobflow.deviceOwner.v2",
  supabaseSession: "jobflow.supabase.session.v1"
} as const;

export const LEGACY_STORAGE_KEYS = [
  "jobflow.settings.v1",
  "jobflow.run.v1",
  "jobflow.ledger.v1",
  "jobflow.apiKey.v1"
] as const;

export const PROMPT_VERSIONS = {
  resume: "resume-profile-v2",
  suitability: "job-suitability-v2",
  greeting: "greeting-v2"
} as const;
