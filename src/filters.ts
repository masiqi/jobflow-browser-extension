import { TECHNOLOGY_CATALOG } from "./defaults";
import type {
  DetailJob,
  FilterDecision,
  JdRuleSettings,
  ListCandidate,
  RuleDecision,
  RuleEvidence,
  RuleOutcome
} from "./types";

const RULE_VERSION = 1;
const NEGATIONS = ["无需", "不需要", "无须", "不要求", "不涉及", "没有"];
const PREFERENCES = ["优先", "加分", "更佳", "可选", "非必需", "了解即可", "熟悉即可"];
const MANDATORY = ["必须", "要求", "仅限", "需要", "需具备", "能够接受", "能接受", "精通", "熟练掌握"];

interface Segment {
  text: string;
  normalized: string;
  start: number;
  end: number;
}

function splitSegments(value: string): Segment[] {
  const output: Segment[] = [];
  for (const match of value.matchAll(/[^。！？!?；;\n]+/g)) {
    const text = match[0].trim();
    if (!text) continue;
    const start = (match.index ?? 0) + Math.max(0, match[0].indexOf(text));
    output.push({
      text,
      normalized: text.toLowerCase().replace(/\s+/g, " "),
      start,
      end: start + text.length
    });
  }
  return output;
}

function includesAny(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term.toLowerCase()));
}

function findSegments(source: Segment[], terms: readonly string[]): Segment[] {
  return source.filter((segment) => includesAny(segment.normalized, terms));
}

function isNegated(segment: Segment): boolean {
  return includesAny(segment.normalized, NEGATIONS);
}

function isPreferred(segment: Segment): boolean {
  return includesAny(segment.normalized, PREFERENCES);
}

function isMandatory(segment: Segment): boolean {
  return includesAny(segment.normalized, MANDATORY);
}

function toEvidence(segment: Segment): RuleEvidence {
  return { text: segment.text.slice(0, 220), start: segment.start, end: segment.end };
}

function makeDecision(
  ruleId: string,
  outcome: RuleOutcome,
  reason: string,
  matched: Segment[]
): RuleDecision {
  return {
    ruleId,
    ruleVersion: RULE_VERSION,
    outcome,
    reason,
    evidence: matched.slice(0, 3).map(toEvidence)
  };
}

function schoolDecision(source: Segment[], settings: JdRuleSettings): RuleDecision | null {
  if (settings.schoolPedigree === "disabled") return null;
  const matched = findSegments(source, ["985", "211", "双一流", "重点院校", "名校"]).filter(
    (segment) => !isNegated(segment)
  );
  if (!matched.length) return null;
  if (matched.some(isPreferred)) {
    return makeDecision("school_pedigree", "review", "学校背景仅为偏好或表达不明确", matched);
  }
  if (matched.some(isMandatory)) {
    return makeDecision("school_pedigree", "exclude", "职位明确要求特定学校背景", matched);
  }
  return makeDecision("school_pedigree", "review", "发现学校背景表述，需确认是否为硬性要求", matched);
}

function travelDecision(source: Segment[], settings: JdRuleSettings): RuleDecision | null {
  if (settings.travel === "disabled" || settings.travel === "unrestricted") return null;
  const matched = findSegments(source, ["出差", "驻点", "外派", "异地调动"]).filter(
    (segment) => !isNegated(segment)
  );
  if (!matched.length) return null;
  const frequent = matched.filter((segment) =>
    includesAny(segment.normalized, ["长期", "高频", "频繁", "经常", "常驻", "驻点", "外派", "异地调动"])
  );
  const occasional = matched.filter((segment) =>
    includesAny(segment.normalized, ["偶尔", "偶发", "短期", "低频", "少量"])
  );
  if (settings.travel === "occasional") {
    if (frequent.length) {
      return makeDecision("travel_mobility", "exclude", "职位要求高频、长期或异地流动", frequent);
    }
    if (occasional.length === matched.length) return null;
    return makeDecision("travel_mobility", "review", "职位要求出差但频率或范围不明确", matched);
  }
  if (frequent.length || occasional.length === matched.length || matched.some(isMandatory)) {
    return makeDecision("travel_mobility", "exclude", "职位包含明确出差或流动要求", matched);
  }
  return makeDecision("travel_mobility", "review", "发现出差或流动表述，需人工确认", matched);
}

function booleanDecision(
  source: Segment[],
  enabled: boolean,
  ruleId: string,
  terms: readonly string[],
  reason: string
): RuleDecision | null {
  if (!enabled) return null;
  const matched = findSegments(source, terms).filter((segment) => !isNegated(segment));
  if (!matched.length) return null;
  if (matched.some(isPreferred) && !matched.some(isMandatory)) {
    return makeDecision(ruleId, "review", reason + "，但表达可能是可选或偏好", matched);
  }
  return makeDecision(ruleId, "exclude", reason, matched);
}

function technologyDecisions(
  job: DetailJob,
  source: Segment[],
  settings: JdRuleSettings
): RuleDecision[] {
  const title = job.title.toLowerCase();
  return settings.rejectedPrimaryTechnologies.flatMap((technologyId) => {
    const technology = TECHNOLOGY_CATALOG.find((item) => item.id === technologyId);
    if (!technology) return [];
    const titleMatch = includesAny(title, technology.aliases);
    const matched = findSegments(source, technology.aliases).filter((segment) => !isNegated(segment));
    if (!titleMatch && !matched.length) return [];
    const incidental = matched.every((segment) =>
      isPreferred(segment) ||
      includesAny(segment.normalized, ["对接", "迁移", "替换", "非必需", "了解即可", "熟悉即可"])
    );
    if (!titleMatch && incidental) return [];
    const core = titleMatch || matched.some((segment) =>
      isMandatory(segment) || includesAny(segment.normalized, ["核心", "主要", "负责", "开发", "架构", "主导"])
    );
    return [makeDecision(
      "primary_technology:" + technology.id,
      core ? "exclude" : "review",
      core
        ? technology.label + " 是职位核心或必需技术"
        : "职位提及 " + technology.label + "，但无法确认是否为核心要求",
      matched
    )];
  });
}

export function evaluateRules(job: DetailJob, settings: JdRuleSettings): FilterDecision {
  const source = splitSegments(job.title + "\n" + job.description);
  const decisions: RuleDecision[] = [
    schoolDecision(source, settings),
    travelDecision(source, settings),
    booleanDecision(source, settings.rejectOutsourcing, "engagement:outsourcing", ["外包"], "职位明确为外包用工"),
    booleanDecision(source, settings.rejectDispatch, "engagement:dispatch", ["派遣", "劳务派遣"], "职位明确为派遣用工"),
    booleanDecision(source, settings.rejectLongTermClientSite, "engagement:client_site", ["驻场开发", "乙方驻场", "客户现场", "长期驻场"], "职位明确要求长期客户现场工作"),
    booleanDecision(source, settings.rejectNightShift, "schedule:night_shift", ["夜班"], "职位明确要求夜班"),
    booleanDecision(source, settings.rejectRotatingShift, "schedule:rotating_shift", ["倒班", "轮班"], "职位明确要求倒班或轮班"),
    booleanDecision(source, settings.rejectBigSmallWeek, "schedule:big_small_week", ["大小周"], "职位明确要求大小周"),
    booleanDecision(source, settings.rejectSingleRestDay, "schedule:single_rest_day", ["单休"], "职位明确要求单休"),
    booleanDecision(source, settings.rejectLongTermOnCall, "schedule:long_term_on_call", ["长期 on-call", "长期on-call", "长期值班", "长期待命"], "职位明确要求长期 on-call")
  ].filter((item): item is RuleDecision => item !== null);
  decisions.push(...technologyDecisions(job, source, settings));
  const outcome: RuleOutcome = decisions.some((item) => item.outcome === "exclude")
    ? "exclude"
    : decisions.some((item) => item.outcome === "review")
      ? "review"
      : "pass";
  return { outcome, decisions };
}

export function canonicalJobUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  url.search = "";
  return url.toString();
}

export function jobKey(job: Pick<ListCandidate, "platform" | "jobId">): string {
  return job.platform + ":" + job.jobId;
}
