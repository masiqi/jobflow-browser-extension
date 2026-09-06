import type { DetailJob, FilterDecision, FilterSettings, ListCandidate } from "./types";

const compact = (value: string) => value.toLowerCase().replace(/\s+/g, " ");
const hits = (text: string, words: string[]) => words.filter((word) => word.trim() && text.includes(word.trim().toLowerCase()));

export function parseSalaryMaxK(salary: string): number | null {
  const text = salary.toLowerCase().replace(/,/g, "");
  const range = text.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*k/);
  if (range) return Number(range[2]);
  const single = text.match(/(\d+(?:\.\d+)?)\s*k/);
  if (single) return Number(single[1]);
  const yearly = text.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*万/);
  if (yearly) return Math.round(Number(yearly[2]) / 12 * 10) / 10;
  return null;
}

export function evaluateRules(job: ListCandidate | DetailJob, settings: FilterSettings, detail = false): FilterDecision {
  const title = compact(job.title);
  const body = compact(`${job.title} ${job.cardText} ${detail && "description" in job ? job.description : ""}`);
  const reasons: string[] = [];
  const matchedDirections: string[] = [];

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

export function canonicalJobUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  url.search = "";
  return url.toString();
}

export function jobKey(job: Pick<ListCandidate, "platform" | "jobId" | "canonicalUrl">): string {
  return `${job.platform}:${job.jobId || job.canonicalUrl}`;
}
