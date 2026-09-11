import { canonicalJobUrl } from "../filters";
import type { DetailJob, ListCandidate } from "../types";

const text = (root: ParentNode, selector: string): string => (root.querySelector<HTMLElement>(selector)?.innerText || root.querySelector(selector)?.textContent || "").replace(/\s+/g, " ").trim();

export function isLiepinListPage(location: Location = window.location): boolean {
  if (!/(^|\.)liepin\.com$/.test(location.hostname)) return false;
  return location.pathname === "/zhaopin/"
    || (location.hostname === "c.liepin.com" && location.pathname === "/");
}

export function isLiepinDetailPage(location: Location = window.location): boolean {
  return /(^|\.)liepin\.com$/.test(location.hostname) && /\/(?:job|a)\/\d+\.shtml/i.test(location.pathname);
}

export function detectLiepinBlockedPage(root: ParentNode = document): "login_required" | "risk_control" | null {
  const source = root instanceof Document ? root.body?.textContent : root.textContent;
  const value = (source || "").replace(/\s+/g, " ").slice(0, 20_000);
  if (/安全验证|拖动滑块|访问异常|操作频繁|验证码|风险验证/.test(value)) return "risk_control";
  if (/登录后查看|请先登录|扫码登录|密码登录/.test(value)) return "login_required";
  return null;
}

function jobIdFromUrl(url: string): string {
  return url.match(/\/(?:job|a)\/(\d+)\.shtml/i)?.[1] || "";
}

function pageTitleJob(href: string): string {
  if (!jobIdFromUrl(href)) return "";
  return document.title.match(/【[^】]*\s+(.+?)招聘】/)?.[1]?.trim() || "";
}

function bodyLine(body: Element | ParentNode, predicate: (line: string) => boolean): string {
  const root = body instanceof Document ? body : body.ownerDocument || document;
  const leafLines = [...root.querySelectorAll<HTMLElement>("body *")]
    .filter((node) => node.children.length === 0)
    .map((node) => (node.innerText || node.textContent || "").trim())
    .filter(Boolean);
  const line = leafLines.find((value) => predicate(value));
  if (line) return line;
  const source = body instanceof Element ? ((body as HTMLElement).innerText || body.textContent || "") : (root.body?.innerText || body.textContent || "");
  return source.split(/\n+/).map((value) => value.trim()).find((value) => predicate(value)) || "";
}

export function scanLiepinList(root: ParentNode = document): ListCandidate[] {
  const anchors = [...root.querySelectorAll<HTMLAnchorElement>('a[href*=".shtml"]')].filter((anchor) => /\/(?:job|a)\/\d+\.shtml/i.test(anchor.href));
  const seen = new Set<string>();
  const candidates: ListCandidate[] = [];
  for (const anchor of anchors) {
    const jobId = jobIdFromUrl(anchor.href);
    if (!jobId || seen.has(jobId)) continue;
    const card = anchor.closest<HTMLElement>(".job-card-pc-container") || anchor.parentElement?.parentElement?.parentElement;
    if (!card) continue;
    const detailBox = anchor.closest<HTMLElement>(".job-detail-box") || anchor;
    const lines = [...anchor.querySelectorAll<HTMLElement>("*")]
      .filter((node) => node.children.length === 0)
      .map((node) => (node.innerText || node.textContent || "").trim())
      .filter(Boolean)
      .filter((value) => value !== "【" && value !== "】" && value !== "急聘");
    const recruiter = text(card, ".recruiter-info-box");
    const companyArea = text(card, '[data-nick="job-detail-company-info"]');
    const title = text(anchor, '[title^="招聘"]') || lines[0] || "";
    const location = (lines.find((value) => /北京|上海|广州|深圳|杭州|成都|武汉|西安|南京|天津|重庆|苏州|全国/.test(value)) || "")
      .replace(/[【】]/g, "")
      .trim();
    const salary = lines.find((value) => /\d+(?:\.\d+)?\s*[-~至]\s*\d+(?:\.\d+)?\s*k|\d+\s*[-~至]\s*\d+\s*万|面议/i.test(value)) || "";
    const experience = lines.find((value) => /经验不限|应届|实习|\d+年以上|\d+-\d+年/.test(value)) || "";
    const education = lines.find((value) => /本科|硕士|博士|大专|学历不限/.test(value)) || "";
    const company = [...card.querySelectorAll<HTMLElement>('[data-nick="job-detail-company-info"] span')].map((node) => (node.innerText || node.textContent || "").trim()).find(Boolean) || companyArea.split(/\s+/)[0] || "";
    const canonicalUrl = canonicalJobUrl(anchor.href);
    seen.add(jobId);
    const cardText = ((card.innerText || card.textContent || "") + " " + recruiter)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
    candidates.push({ platform: "liepin", jobId, url: anchor.href, canonicalUrl, title, company, location, salary, experience, education, cardText, index: candidates.length });
  }
  return candidates;
}

export function extractLiepinDetail(root: ParentNode = document, href = location.href): DetailJob | null {
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
    platform: "liepin", jobId, url: href, canonicalUrl: canonicalJobUrl(href), title, company,
    location: locationText, salary,
    experience: propertyText.match(/经验不限|应届|实习|\d+年以上|\d+-\d+年/)?.[0] || "",
    education: propertyText.match(/统招本科|本科|硕士|博士|大专|学历不限/)?.[0] || "",
    cardText: bodyText.slice(0, 1500), index: 0, description: description.slice(0, 60_000),
    recruiter,
    recruiterTitle: text(root, ".recruiter-info .title") || text(root, ".recruiter-card .position") || text(root, ".hunter-info .title") || recruiterCareer.split(/[·]/)[0]?.trim() || ""
  };
}
