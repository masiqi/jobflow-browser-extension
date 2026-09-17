// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { detailJobSchema } from "../src/domain/messages";
import {
  canonicalZhaopinJobUrl,
  detectZhaopinBlockedPage,
  extractZhaopinDetail,
  isZhaopinDetailPage,
  isZhaopinListPage,
  scanZhaopinList,
  zhaopinJobIdFromUrl
} from "../src/platforms/zhaopin";

beforeEach(() => {
  document.title = "";
  document.body.innerHTML = "";
});
describe("Zhaopin route and identity handling", () => {
  it("accepts only explicit list and detail routes", () => {
    const at = (hostname: string, pathname: string) => ({ hostname, pathname }) as Location;
    expect(isZhaopinListPage(at("www.zhaopin.com", "/sou/"))).toBe(true);
    expect(isZhaopinListPage(at("www.zhaopin.com", "/sou/北京/"))).toBe(true);
    expect(isZhaopinListPage(at("www.zhaopin.com", "/jobs"))).toBe(true);
    expect(isZhaopinListPage(at("www.zhaopin.com", "/account"))).toBe(false);
    expect(isZhaopinListPage(at("passport.zhaopin.com", "/sou/"))).toBe(false);
    expect(isZhaopinDetailPage(at("www.zhaopin.com", "/jobdetail/CCL1501502560J40877030814.htm"))).toBe(true);
    expect(isZhaopinDetailPage(at("www.zhaopin.com", "/jobdetail/123"))).toBe(false);
  });

  it("preserves the complete platform job ID and canonicalizes tracking URLs to HTTPS", () => {
    const raw = "http://www.zhaopin.com/jobdetail/CCL1501502560J40877030814.htm?sid=synthetic#section";
    expect(zhaopinJobIdFromUrl(raw)).toBe("CCL1501502560J40877030814");
    expect(canonicalZhaopinJobUrl(raw)).toBe("https://www.zhaopin.com/jobdetail/CCL1501502560J40877030814.htm");
  });
});

describe("Zhaopin list extraction", () => {
  it("extracts Vue-backed split-page cards without confusing the right detail panel for a list item", () => {
    document.body.innerHTML = `
      <main class="jobs-split-page">
        <div class="job-list-panel">
          <div class="job-card job-card--active"><div class="job-card__title-row"><span>当前职位</span></div></div>
          <div class="job-card"><div class="job-card__title-row"><span>第二个职位</span></div></div>
        </div>
        <aside><a href="https://www.zhaopin.com/jobdetail/CCLdetailJ001.htm">查看更多职位信息</a></aside>
      </main>`;
    const cards = [...document.querySelectorAll<HTMLElement>(".job-card")];
    Object.defineProperty(cards[0], "__vue__", {
      value: {
        _props: {
          job: {
            number: "CCL000000001J400000001",
            name: "当前职位",
            salary60: "20-30K",
            education: "本科",
            workingExp: "3-5年",
            companyName: "第一合成公司",
            workCity: "北京",
            cityDistrict: "朝阳",
            streetName: "麦子店",
            positionUrl: "http://www.zhaopin.com/jobdetail/CCL000000001J400000001.htm"
          }
        }
      }
    });
    Object.defineProperty(cards[1], "__vue__", {
      value: {
        _props: {
          job: {
            number: "CCL000000002J400000002",
            name: "第二个职位",
            salary60: "15-25K",
            education: "硕士",
            workingExp: "5年以上",
            companyName: "第二合成公司",
            workCity: "北京",
            cityDistrict: "海淀",
            streetName: "上地",
            positionUrl: "http://www.zhaopin.com/jobdetail/CCL000000002J400000002.htm"
          }
        }
      }
    });

    const items = scanZhaopinList();
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.jobId)).toEqual([
      "CCL000000001J400000001",
      "CCL000000002J400000002"
    ]);
    expect(items[0]).toMatchObject({
      title: "当前职位",
      company: "第一合成公司",
      location: "北京 朝阳 麦子店",
      salary: "20-30K",
      experience: "3-5年",
      education: "本科"
    });
  });

  it("merges page-world bridge records by card index", () => {
    document.body.innerHTML = `
      <main><div class="job-card"></div><div class="job-card"></div></main>`;
    const items = scanZhaopinList(document, [
      {
        index: 0,
        number: "CCLbridgeJ400000001",
        name: "桥接职位一",
        salary: "20-30K",
        education: "本科",
        experience: "3-5年",
        company: "桥接公司一",
        location: "北京 朝阳",
        positionUrl: "http://www.zhaopin.com/jobdetail/CCLbridgeJ400000001.htm"
      },
      {
        index: 1,
        number: "CCLbridgeJ400000002",
        name: "桥接职位二",
        salary: "15-25K",
        education: "硕士",
        experience: "5年以上",
        company: "桥接公司二",
        location: "北京 海淀",
        positionUrl: "http://www.zhaopin.com/jobdetail/CCLbridgeJ400000002.htm"
      }
    ]);
    expect(items.map((item) => item.jobId)).toEqual([
      "CCLbridgeJ400000001",
      "CCLbridgeJ400000002"
    ]);
    expect(items[1]).toMatchObject({ title: "桥接职位二", company: "桥接公司二", education: "硕士" });
  });

  it("reads current DOM cards, extracts semantic fields, and deduplicates by full ID", () => {
    document.body.innerHTML = `
      <main>
        <article class="joblist-box__item">
          <a href="http://www.zhaopin.com/jobdetail/CCL1501502560J40877030814.htm?sid=first">
            <div class="jobinfo__name">AI 平台工程师</div>
            <div class="jobinfo__salary">20-30K·13薪</div>
            <div class="jobinfo__tag"><span>本科</span><span>3-5年</span></div>
            <div class="jobinfo__other-info-item">北京</div>
            <div class="companyinfo__name">合成智联科技公司</div>
          </a>
        </article>
        <article class="joblist-box__item">
          <a href="https://www.zhaopin.com/jobdetail/CCL1501502560J40877030814.htm?sid=duplicate">
            <div class="jobinfo__name">重复职位卡</div>
          </a>
        </article>
      </main>`;

    const items = scanZhaopinList();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      platform: "zhaopin",
      jobId: "CCL1501502560J40877030814",
      title: "AI 平台工程师",
      company: "合成智联科技公司",
      location: "北京",
      salary: "20-30K·13薪",
      experience: "3-5年",
      education: "本科",
      canonicalUrl: "https://www.zhaopin.com/jobdetail/CCL1501502560J40877030814.htm"
    });
  });
});

describe("Zhaopin detail extraction", () => {
  it("extracts a semantic detail section and validates the shared DetailJob contract", () => {
    document.title = "AI 平台工程师-北京招聘信息-智联招聘";
    document.body.innerHTML = `
      <header>
        <h1 class="job-header__title">AI 平台工程师</h1>
        <div class="job-header__info">北京 20-30K·13薪 3-5年 本科</div>
        <div class="companyinfo__name">合成智联科技公司</div>
      </header>
      <section class="job-description-section">
        <h2>职位描述</h2>
        <div>负责高可用任务平台研发和稳定性建设，参与服务治理、故障排查与工程效率改进。</div>
      </section>
      <section class="recruiter-info"><span class="name">陈女士</span><span class="title">招聘顾问</span></section>`;

    const item = extractZhaopinDetail(document, "https://www.zhaopin.com/jobdetail/CCL1501502560J40877030814.htm");
    expect(item).toMatchObject({
      platform: "zhaopin",
      jobId: "CCL1501502560J40877030814",
      title: "AI 平台工程师",
      company: "合成智联科技公司",
      location: "北京",
      experience: "3-5年",
      education: "本科",
      recruiter: "陈女士",
      recruiterTitle: "招聘顾问"
    });
    expect(item?.description).toContain("高可用任务平台");
    expect(() => detailJobSchema.parse(item)).not.toThrow();
  });

  it("does not treat the normal detail-page login widget as a blocker", () => {
    document.body.innerHTML = `
      <main class="main-jobs">
        <section class="job-summary"><h1 class="summary-planes__title">真实详情职位</h1></section>
        <section class="describtion-card seo-card"><h3>职位描述</h3><div class="seo-card__content">负责平台研发和稳定性建设，参与服务治理与工程效率改进。</div></section>
        <aside class="main-jobs__right-content"><div class="login-before">验证码登录/注册 登录/注册</div></aside>
      </main>`;
    expect(detectZhaopinBlockedPage()).toBeNull();
    expect(extractZhaopinDetail(document, "https://www.zhaopin.com/jobdetail/CCL1501502560J40877030814.htm"))
      .toMatchObject({ title: "真实详情职位", jobId: "CCL1501502560J40877030814" });
  });

  it("classifies login, risk, and unavailable pages without trying to recover them", () => {
    document.body.innerHTML = "<main>请先登录，登录后查看完整职位信息</main>";
    expect(detectZhaopinBlockedPage()).toBe("login_required");
    document.body.innerHTML = "<main>验证码登录/注册 登录/注册</main>";
    expect(detectZhaopinBlockedPage()).toBe("login_required");
    document.body.innerHTML = "<main>访问异常，请完成安全验证</main>";
    expect(detectZhaopinBlockedPage()).toBe("risk_control");
    document.body.innerHTML = "<main>当前职位审核中或已下线</main>";
    expect(detectZhaopinBlockedPage()).toBe("job_unavailable");
    expect(extractZhaopinDetail(document, "https://www.zhaopin.com/jobdetail/CCL1501502560J40877030814.htm")).toBeNull();
  });
});
