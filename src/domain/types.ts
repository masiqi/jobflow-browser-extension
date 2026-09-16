export type PlatformKey = "liepin";
export type ResumeProfileState = "draft" | "active" | "stale";
export type LocalResumeState = "available" | "missing" | "version_mismatch";
export type RuleOutcome = "pass" | "exclude" | "review";
export type SuitabilityOutcome = "proceed" | "exclude" | "review";
export type OpportunityStatus =
  | "discovered"
  | "queued"
  | "extracting"
  | "deterministic_excluded"
  | "evaluating"
  | "model_excluded"
  | "review_required"
  | "generating"
  | "draft_ready"
  | "user_excluded"
  | "failed";
export type BatchStatus = "queued" | "running" | "paused" | "completed" | "cancelled" | "failed";
export type ExecutionPolicy = "draft_only" | "reviewed_send" | "automatic_send";
export type BatchItemStatus =
  | "queued"
  | "opening"
  | "extracting"
  | "evaluating"
  | "generating"
  | "draft_ready"
  | "delivery_ready"
  | "waiting_navigation"
  | "waiting_interval"
  | "delivery_preflighting"
  | "delivery_in_progress"
  | "delivery_succeeded"
  | "delivery_partial"
  | "blocked"
  | "excluded"
  | "review_required"
  | "failed";
export type ModelProvider = "openai" | "deepseek" | "openrouter" | "custom";
export type ModelRoute = "managed" | "byok";

export interface ResumeFact {
  id: string;
  text: string;
  keywords: string[];
  evidence: string;
  approved: boolean;
}

export interface ResumeProfile {
  id: string;
  version: number;
  state: ResumeProfileState;
  sourceHash: string;
  sourceName: string;
  sourceKind: "pdf" | "docx" | "text" | "markdown" | "pasted";
  analyzedAt: string;
  activatedAt?: string;
  summary: string;
  targetRoles: string[];
  skills: string[];
  facts: ResumeFact[];
  constraints: string[];
}

export interface LocalResumeMetadata {
  userId: string;
  sourceHash: string;
  sourceName: string;
  sourceKind: ResumeProfile["sourceKind"];
  mimeType: string;
  size: number;
  storedAt: string;
}

export interface ModelRouteSettings {
  route: ModelRoute;
  provider: ModelProvider;
  endpoint: string;
  model: string;
  rememberKey: boolean;
  connectionTestedAt?: string;
  testedFingerprint?: string;
}

export type TravelTolerance = "disabled" | "none" | "occasional" | "unrestricted";

export interface JdRuleSettings {
  version: 1;
  schoolPedigree: "disabled" | "reject_mandatory";
  travel: TravelTolerance;
  rejectOutsourcing: boolean;
  rejectDispatch: boolean;
  rejectLongTermClientSite: boolean;
  rejectNightShift: boolean;
  rejectRotatingShift: boolean;
  rejectBigSmallWeek: boolean;
  rejectSingleRestDay: boolean;
  rejectLongTermOnCall: boolean;
  rejectedPrimaryTechnologies: string[];
}

export interface ExtensionSettings {
  rules: JdRuleSettings;
  model: ModelRouteSettings;
  executionPolicy: ExecutionPolicy;
  maxJobsPerBatch: number;
  dailySendLimit: number;
  automaticSendDelayMinSeconds: number;
  automaticSendDelayMaxSeconds: number;
  detailTimeoutSeconds: number;
  launcherVisible: boolean;
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

export interface RuleEvidence {
  text: string;
  start: number;
  end: number;
}

export interface RuleDecision {
  ruleId: string;
  ruleVersion: number;
  outcome: RuleOutcome;
  reason: string;
  evidence: RuleEvidence[];
}

export interface FilterDecision {
  outcome: RuleOutcome;
  decisions: RuleDecision[];
}

export interface SuitabilityDecision {
  outcome: SuitabilityOutcome;
  score?: number;
  reasons: string[];
  jdEvidence: string[];
  factIds: string[];
}

export interface EvaluationRecord extends SuitabilityDecision {
  id: string;
  opportunityId: string;
  profileId: string;
  ruleVersion: number;
  promptVersion: string;
  model: ModelMetadata;
  createdAt: string;
}

export interface GreetingDecision {
  greeting: string;
  jdEvidence: string[];
  factIds: string[];
}

export interface ModelMetadata {
  route: ModelRoute;
  provider: ModelProvider;
  model: string;
  promptVersion: string;
  createdAt: string;
}

export interface DraftRevision {
  id: string;
  kind: "generated" | "user_edit";
  text: string;
  createdAt: string;
  model?: ModelMetadata;
  jdEvidence: string[];
  factIds: string[];
}

export interface MessageDraft {
  opportunityId: string;
  currentText: string;
  revisions: DraftRevision[];
  updatedAt: string;
}

export type DeliveryComponentStatus = "pending" | "attempted" | "verified" | "failed";
export type DeliveryOverallStatus =
  | "ready"
  | "preflighting"
  | "awaiting_confirmation"
  | "in_progress"
  | "partial"
  | "succeeded"
  | "failed"
  | "review_required";
export type DeliveryResumeMode = "platform_default";

export interface DeliveryRecord {
  opportunityId: string;
  platform: PlatformKey;
  platformJobId: string;
  resumeMode: DeliveryResumeMode;
  overallStatus: DeliveryOverallStatus;
  applicationStatus: DeliveryComponentStatus;
  greetingStatus: DeliveryComponentStatus;
  draftRevisionId?: string;
  draftSha256?: string;
  reservationId?: string;
  latestReason?: string;
  updatedAt: string;
}

export interface DeliveryAttempt {
  id: string;
  requestId: string;
  opportunityId: string;
  eventKind: string;
  evidenceCode: string;
  evidence: Record<string, unknown>;
  createdAt: string;
}

export interface OpportunityRecord {
  id: string;
  userId: string;
  platform: PlatformKey;
  platformJobId: string;
  canonicalUrl: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  experience: string;
  education: string;
  cardText: string;
  description?: string;
  recruiter?: string;
  recruiterTitle?: string;
  jdHash?: string;
  status: OpportunityStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  latestReason?: string;
}

export type OpportunityEventKind =
  | "opportunity_observed"
  | "details_captured"
  | "deterministic_excluded"
  | "evaluation_started"
  | "evaluation_completed"
  | "review_requested"
  | "user_excluded"
  | "user_override"
  | "generation_started"
  | "generation_completed"
  | "draft_edited"
  | "processing_failed";

export interface OpportunityEvent {
  id: string;
  opportunityId: string;
  kind: OpportunityEventKind;
  version: 1;
  actor: "system" | "model" | "user";
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface BatchItem {
  candidate: ListCandidate;
  status: BatchItemStatus;
  opportunityId?: string;
  draftRevisionId?: string;
  draftSha256?: string;
  blockerPhase?: "pre_write" | "post_write";
  blockerCode?: string;
  filter?: FilterDecision;
  suitability?: SuitabilityDecision;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  tabId?: number;
  leaseId?: string;
  attempt: number;
}

export interface BatchRun {
  id: string;
  platform: PlatformKey;
  status: BatchStatus;
  sourceUrl: string;
  executionPolicy: ExecutionPolicy;
  authorizedAt: string;
  createdAt: string;
  updatedAt: string;
  currentIndex: number;
  items: BatchItem[];
  draftCount: number;
  excludedCount: number;
  reviewCount: number;
  failedCount: number;
  deliverySucceededCount: number;
  deliveryPartialCount: number;
  pauseReason?: string;
  nextNavigationEligibleAt?: string;
  nextWriteEligibleAt?: string;
}

export interface AutomaticWriteThrottle {
  ownerId: string;
  platform: PlatformKey;
  lastWriteStartedAt: string;
  scheduledDelaySeconds: number;
  nextWriteEligibleAt: string;
}

export interface LiepinNavigationThrottle {
  ownerId: string;
  platform: PlatformKey;
  lastNavigationStartedAt: string;
  scheduledDelaySeconds: number;
  nextNavigationEligibleAt: string;
}

export interface AuthProjection {
  status: "signed_out" | "signed_in" | "unavailable";
  userId?: string;
  email?: string;
  emailVerificationStatus?: "unverified" | "verified";
  vip?: boolean;
  error?: string;
}

export interface ScanPreview {
  sourceUrl: string;
  candidates: ListCandidate[];
  observedCount: number;
  newCount: number;
  duplicateCount: number;
  excludedCount: number;
  draftedCount: number;
  processableJobIds: string[];
  selectedJobIds: string[];
}

export interface AppState {
  auth: AuthProjection;
  settings: ExtensionSettings;
  resumeProfile: ResumeProfile | null;
  resumeProfiles: ResumeProfile[];
  localResumeState: LocalResumeState;
  scanPreview: ScanPreview | null;
  run: BatchRun | null;
  opportunities: OpportunityRecord[];
  evaluations: EvaluationRecord[];
  events: OpportunityEvent[];
  drafts: MessageDraft[];
  deliveries: DeliveryRecord[];
}
