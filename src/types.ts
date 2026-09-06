export type PlatformKey = "liepin" | "boss" | "job51" | "zhaopin" | "lagou";
export type RunMode = "dry_run" | "live";
export type RunStatus = "idle" | "running" | "paused" | "completed" | "cancelled" | "blocked";
export type ItemStatus = "queued" | "opening" | "extracting" | "filtered" | "generating" | "simulated" | "sent" | "failed" | "needs_review";
export type RuleMode = "ignore" | "prefer" | "require" | "exclude" | "review";
export type MatchMode = "any" | "all";

export interface DirectionRule {
  id: string;
  label: string;
  mode: RuleMode;
  keywords: string[];
}

export interface FilterSettings {
  cityKeywords: string[];
  minSalaryK: number;
  requiredDirectionMatch: MatchMode;
  schoolRestrictionMode: Exclude<RuleMode, "prefer" | "require"> | "include_only";
  schoolRestrictionKeywords: string[];
  directions: DirectionRule[];
  customIncludeAny: string[];
  customIncludeAll: string[];
  customExcludeAny: string[];
  customReviewAny: string[];
}

export interface ModelSettings {
  endpoint: string;
  model: string;
  apiKey: string;
  persistApiKey: boolean;
  timeoutSeconds: number;
  temperature: number;
  extraHeaders: Record<string, string>;
}

export interface ResumeFact {
  id: string;
  text: string;
  keywords: string[];
  evidence: string;
}

export interface ResumeProfile {
  version: 1;
  sourceHash: string;
  sourceName: string;
  analyzedAt: string;
  summary: string;
  targetRoles: string[];
  skills: string[];
  facts: ResumeFact[];
  prohibitions: string[];
}

export interface ExtensionSettings {
  model: ModelSettings;
  filters: FilterSettings;
  resumeProfile: ResumeProfile | null;
  liveUnlocked: boolean;
  maxJobsPerRun: number;
  detailTimeoutSeconds: number;
}

export interface ListCandidate {
  platform: PlatformKey;
  jobId: string;
  url: string;
  canonicalUrl: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  experience: string;
  education: string;
  cardText: string;
  index: number;
}

export interface DetailJob extends ListCandidate {
  description: string;
  recruiter: string;
  recruiterTitle: string;
}

export interface FilterDecision {
  decision: "pass" | "skip" | "review";
  reasons: string[];
  matchedDirections: string[];
}

export interface ModelDecision {
  decision: "apply" | "review" | "skip";
  score: number;
  reasons: string[];
  greeting: string;
  factIds: string[];
  question: string;
}

export interface RunItem {
  candidate: ListCandidate;
  status: ItemStatus;
  filter?: FilterDecision;
  model?: ModelDecision;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  tabId?: number;
  attempt: number;
}

export interface BatchRun {
  id: string;
  platform: PlatformKey;
  mode: RunMode;
  status: RunStatus;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
  currentIndex: number;
  items: RunItem[];
  sentCount: number;
  simulatedCount: number;
  failedCount: number;
  liveConfirmation?: string;
}

export interface LedgerEntry {
  key: string;
  platform: PlatformKey;
  jobId: string;
  canonicalUrl: string;
  title: string;
  company: string;
  status: "simulated" | "sent" | "failed" | "skipped" | "needs_review";
  runId: string;
  greeting?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  evidence?: string;
}

export type RuntimeMessage =
  | { type: "SCAN_LIST" }
  | { type: "LIST_SCANNED"; candidates: ListCandidate[] }
  | { type: "START_RUN"; candidates: ListCandidate[]; mode: RunMode; sourceUrl: string }
  | { type: "PAUSE_RUN" }
  | { type: "RESUME_RUN" }
  | { type: "CANCEL_RUN" }
  | { type: "GET_STATE" }
  | { type: "DETAIL_READY"; job: DetailJob }
  | { type: "DETAIL_FAILED"; jobId: string; error: string }
  | { type: "RUN_UPDATED" };
