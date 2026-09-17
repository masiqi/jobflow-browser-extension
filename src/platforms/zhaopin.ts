import type { DetailJob, ListCandidate } from "../types";

const ZHAOPIN_HOSTS = new Set(["www.zhaopin.com"]);
type LocationLike = Pick<Location, "hostname" | "pathname">;

export interface ZhaopinPageJob {
  index: number;
  number: string;
  name: string;
  salary: string;
  education: string;
  experience: string;
  company: string;
  location: string;
  positionUrl: string;
}

function isZhaopinHost(hostname: string): boolean {
  return ZHAOPIN_HOSTS.has(hostname.toLowerCase());
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function elementText(element: Element | null | undefined): string {
  if (!element) return "";
  const candidate = element as HTMLElement;
  return normalizeText(candidate.innerText || candidate.textContent || "");
}

function text(root: ParentNode, selector: string): string {
  return elementText(root.querySelector(selector));
}

function firstText(root: ParentNode, selectors: readonly string[]): string {
  for (const selector of selectors) {
    const value = text(root, selector);
    if (value) return value;
  }
  return "";
}

function bodyText(root: ParentNode): string {
  const body = root instanceof Document ? root.body : root.querySelector("body") || root;
  return normalizeText(body.textContent || "");
}

function cardLeafTexts(card: HTMLElement): string[] {
  return [...card.querySelectorAll<HTMLElement>("*")]
    .filter((element) => element.children.length === 0)
    .map(elementText)
    .filter(Boolean);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedValue(value: unknown, maxLength = 500): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return normalizeText(String(value)).slice(0, maxLength);
}

function readPageJobFromCard(card: HTMLElement, index: number): ZhaopinPageJob | null {
  try {
    const host = card as HTMLElement & {
      __vue__?: { _props?: { job?: unknown } };
    };
    const job = recordValue(host.__vue__?._props?.job);
    if (!job) return null;
    return {
      index,
      number: boundedValue(job.number, 128),
      name: boundedValue(job.name, 300),
      salary: boundedValue(job.salary60, 100),
      education: boundedValue(job.education, 100),
      experience: boundedValue(job.workingExp, 100),
      company: boundedValue(job.companyName, 300),
      location: [job.workCity, job.cityDistrict, job.streetName]
        .map((value) => boundedValue(value, 80))
        .filter(Boolean)
        .join(" ")
        .slice(0, 200),
      positionUrl: boundedValue(job.positionUrl || job.positionURL, 2048)
    };
  } catch {
    return null;
  }
}

function jobIdFromPath(pathname: string): string {
  const jobId = pathname.match(/^\/jobdetail\/([A-Za-z0-9_-]{1,128})\.htm$/i)?.[1] || "";
  return jobId;
}

export function zhaopinJobIdFromUrl(href: string): string {
  try {
    const url = new URL(href);
    if (!isZhaopinHost(url.hostname)) return "";
    return jobIdFromPath(url.pathname);
  } catch {
    return "";
  }
}

export function isZhaopinListPage(location: LocationLike = window.location): boolean {
  if (!isZhaopinHost(location.hostname)) return false;
  return /^\/(?:sou(?:\/|$)|jobs(?:\/|$)|recommend(?:\/|$))/i.test(location.pathname);
}

export function isZhaopinDetailPage(location: LocationLike = window.location): boolean {
  return isZhaopinHost(location.hostname) && Boolean(jobIdFromPath(location.pathname));
}

export type ZhaopinBlockedPage = "login_required" | "risk_control" | "job_unavailable";

function hasZhaopinDetailContent(root: ParentNode): boolean {
  return Boolean(root.querySelector(
    "h1.summary-planes__title, .job-header__title, .jobinfo__name, .job-detail__title, .describtion-card, .job-description, .jobdescription"
  ));
}

export function detectZhaopinBlockedPage(
  root: ParentNode = document,
  pageLocation: LocationLike = window.location
): ZhaopinBlockedPage | null {
  const source = bodyText(root).slice(0, 20_000);
  const title = root instanceof Document ? normalizeText(root.title) : "";
  const hasDetail = hasZhaopinDetailContent(root);
  if (/(?:职位|岗位).*(?:已下线|不存在|已结束|暂停招聘|停止招聘|已关闭)|当前职位审核中或已下线/.test(source)) {
    return "job_unavailable";
  }
  if (/安全验证|访问异常|操作频繁|风险提示|滑块验证|人机验证/.test(source)
    || /安全中心|安全验证|风险提示/.test(title)
    || (!hasDetail && /(?:请输入|请完成|需要).{0,12}(?:验证码|验证)/.test(source))) {
    return "risk_control";
  }
  if (!hasDetail && /登录后查看|请先登录|立即登录|扫码登录|登录\/注册|手机号登录/.test(source)) {
    return "login_required";
  }
  return null;
}

export function zhaopinBlockedPageReason(blocked: ZhaopinBlockedPage): string {
  if (blocked === "risk_control") return "智联招聘详情页需要安全验证";
  if (blocked === "login_required") return "智联招聘详情页需要登录";
  return "智联招聘职位已下线或不可用";
}

export function canonicalZhaopinJobUrl(rawUrl: string): string {
  const jobId = zhaopinJobIdFromUrl(rawUrl);
  if (!jobId) throw new Error("智联招聘职位地址无效");
  return "https://www.zhaopin.com/jobdetail/" + jobId + ".htm";
}

function metadataText(card: HTMLElement): string {
  return [
    ...card.querySelectorAll<HTMLElement>(
      ".jobinfo__other-info-item, .jobinfo__tag, .jobinfo__other-info, [class*='jobinfo']"
    )
  ].map(elementText).filter(Boolean).join(" ");
}

function matchLocation(value: string): string {
  return value.match(/北京(?:市|[-·][^\s]+)?|上海(?:市|[-·][^\s]+)?|广州(?:市|[-·][^\s]+)?|深圳(?:市|[-·][^\s]+)?|杭州(?:市|[-·][^\s]+)?|成都(?:市|[-·][^\s]+)?|武汉(?:市|[-·][^\s]+)?|南京(?:市|[-·][^\s]+)?|天津(?:市|[-·][^\s]+)?|重庆(?:市|[-·][^\s]+)?|西安(?:市|[-·][^\s]+)?|苏州(?:市|[-·][^\s]+)?|全国/)?.[0] || "";
}

function matchSalary(value: string): string {
  return value.match(/\d+(?:\.\d+)?\s*[-~至]\s*\d+(?:\.\d+)?\s*(?:k|K|千|万)(?:\s*[·/]?\s*\d+薪|\/月)?|面议/)?.[0] || "";
}

function matchExperience(value: string): string {
  return value.match(/经验不限|无经验|应届|实习|\d+\s*[-~至]\s*\d+\s*年|\d+\s*年(?:以上)?/)?.[0] || "";
}

function matchEducation(value: string): string {
  return value.match(/学历不限|大专|本科|硕士|博士|中专|高中/)?.[0] || "";
}

function listCards(root: ParentNode): HTMLElement[] {
  const cards = [...root.querySelectorAll<HTMLElement>(".job-card")];
  if (cards.length) return cards;
  const legacyCards = [...root.querySelectorAll<HTMLElement>(".joblist-box__item")];
  if (legacyCards.length) return legacyCards;
  return [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/jobdetail/"]')]
    .map((anchor) => anchor.closest<HTMLElement>("article,li") || anchor.parentElement)
    .filter((card): card is HTMLElement => Boolean(card));
}

export function scanZhaopinList(
  root: ParentNode = document,
  pageJobs: readonly ZhaopinPageJob[] = []
): ListCandidate[] {
  const seen = new Set<string>();
  const candidates: ListCandidate[] = [];
  const pageJobsByIndex = new Map(pageJobs.map((job) => [job.index, job]));
  for (const [index, card] of listCards(root).entries()) {
    const pageJob = pageJobsByIndex.get(index) || readPageJobFromCard(card, index);
    const anchor = card.querySelector<HTMLAnchorElement>('a[href*="/jobdetail/"]');
    const rawUrl = pageJob?.positionUrl || anchor?.href || anchor?.getAttribute("href") || "";
    const pageJobId = pageJob?.number && /^[A-Za-z0-9_-]{1,128}$/.test(pageJob.number)
      ? pageJob.number
      : "";
    const jobId = pageJobId || zhaopinJobIdFromUrl(rawUrl);
    if (!jobId || seen.has(jobId)) continue;
    let canonicalUrl: string;
    try {
      canonicalUrl = pageJobId && !rawUrl
        ? "https://www.zhaopin.com/jobdetail/" + pageJobId + ".htm"
        : canonicalZhaopinJobUrl(rawUrl);
    } catch {
      continue;
    }
    const metadata = metadataText(card);
    const leaves = cardLeafTexts(card);
    const title = pageJob?.name || firstText(card, [".jobinfo__name", "[data-job-name]"]) || elementText(anchor?.querySelector("h1,h2,h3,strong")) || leaves[0] || "";
    const company = pageJob?.company || firstText(card, [".companyinfo__name", "[class*='companyinfo'] [class*='name']"]);
    const cardText = normalizeText((card.innerText || card.textContent || "")).slice(0, 6000);
    const details = metadata + " " + cardText;
    const location = pageJob?.location || matchLocation(details);
    seen.add(jobId);
    candidates.push({
      platform: "zhaopin",
      jobId,
      url: rawUrl || canonicalUrl,
      canonicalUrl,
      title,
      company,
      location,
      salary: pageJob?.salary || firstText(card, [".jobinfo__salary"]) || matchSalary(details),
      experience: pageJob?.experience || matchExperience(details),
      education: pageJob?.education || matchEducation(details),
      cardText,
      index: candidates.length
    });
  }
  return candidates;
}

function descriptionFromSelectors(root: ParentNode): string {
  const selectors = [
    ".describtion__detail",
    ".describtion-card",
    ".describtion-card__content",
    ".seo-card__content",
    ".job-description",
    ".jobdescription",
    ".job-detail__content",
    ".job-detail-content",
    "[class*='job-description']",
    "[class*='jobdescription']",
    "[class*='describ']"
  ];
  const values = selectors.flatMap((selector) =>
    [...root.querySelectorAll<HTMLElement>(selector)].map(elementText)
  ).filter((value) => value.length >= 20);
  return values.sort((left, right) => right.length - left.length)[0] || "";
}

function descriptionFromHeading(root: ParentNode): string {
  const headings = [...root.querySelectorAll<HTMLElement>("h2,h3,h4,strong,div,p,span")]
    .filter((element) => /^职位描述|^岗位职责|^任职要求/.test(elementText(element)));
  for (const heading of headings) {
    const next = heading.nextElementSibling;
    const nextText = elementText(next);
    if (nextText.length >= 20) return nextText;
    const parentText = elementText(heading.parentElement);
    const withoutHeading = normalizeText(parentText.replace(elementText(heading), ""));
    if (withoutHeading.length >= 20) return withoutHeading;
  }
  const source = bodyText(root);
  const marker = source.search(/职位描述|岗位职责|任职要求/);
  if (marker >= 0) {
    return (source.slice(marker).split(/公司简介|工商信息|职位推荐/)[0] || "").slice(0, 60_000).trim();
  }
  return "";
}

function detailTitle(root: ParentNode): string {
  const title = firstText(root, [".job-header__title", ".summary-planes__title", ".jobinfo__name", ".job-detail__title", "h1"]);
  if (title) return title;
  const documentTitle = root instanceof Document ? normalizeText(root.title) : "";
  return documentTitle.split(/[-|｜]/)[0]?.replace(/招聘信息|招聘$/, "").trim() || "";
}

export function extractZhaopinDetail(root: ParentNode = document, href = location.href): DetailJob | null {
  const jobId = zhaopinJobIdFromUrl(href);
  if (!jobId || !isZhaopinDetailPage(new URL(href))) return null;
  if (detectZhaopinBlockedPage(root, new URL(href))) return null;
  const source = bodyText(root);
  const description = descriptionFromSelectors(root) || descriptionFromHeading(root);
  if (description.length < 20) return null;
  const title = detailTitle(root);
  if (!title) return null;
  const metadata = [
    firstText(root, [".job-header__info", ".jobinfo__other-info", ".jobinfo__tag"]),
    source.slice(0, 6000)
  ].join(" ");
  const recruiter = firstText(root, [".recruiter-name", ".recruiter-info .name", ".hr-name", "[class*='recruiter'] [class*='name']"]);
  const recruiterTitle = firstText(root, [".recruiter-title", ".recruiter-info .title", ".hr-title", "[class*='recruiter'] [class*='title']"]);
  const company = firstText(root, [".companyinfo__name", ".company-name", ".job-company", "[class*='company'] [class*='name']"]);
  return {
    platform: "zhaopin",
    jobId,
    url: href,
    canonicalUrl: canonicalZhaopinJobUrl(href),
    title,
    company,
    location: matchLocation(metadata),
    salary: firstText(root, [".jobinfo__salary", ".job-header__salary"]) || matchSalary(metadata),
    experience: matchExperience(metadata),
    education: matchEducation(metadata),
    cardText: source.slice(0, 1500),
    index: 0,
    description: description.slice(0, 60_000),
    recruiter,
    recruiterTitle
  };
}
