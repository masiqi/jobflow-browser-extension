import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "../src/defaults";
import { canonicalJobUrl, evaluateRules, jobKey } from "../src/filters";
import type { DetailJob, JdRuleSettings } from "../src/types";

const job = (description: string, title = "平台研发工程师"): DetailJob => ({
  platform: "liepin",
  jobId: "synthetic-job-1",
  url: "https://www.liepin.com/job/10001.shtml?source=test",
  canonicalUrl: "https://www.liepin.com/job/10001.shtml",
  title,
  company: "合成科技公司",
  location: "杭州",
  salary: "25-40k",
  experience: "3-5年",
  education: "本科",
  cardText: "合成测试职位",
  index: 0,
  description,
  recruiter: "测试招聘方",
  recruiterTitle: "招聘经理"
});

const rules = (overrides: Partial<JdRuleSettings>): JdRuleSettings => ({
  ...structuredClone(DEFAULT_RULES),
  ...overrides
});

describe("closed JD rule catalog", () => {
  it("starts every rule disabled", () => {
    expect(evaluateRules(job("要求能够设计可靠的服务架构，需偶尔出差。"), DEFAULT_RULES)).toEqual({
      outcome: "pass",
      decisions: []
    });
  });

  it("distinguishes mandatory, preferred, and negated school language", () => {
    const setting = rules({ schoolPedigree: "reject_mandatory" });
    expect(evaluateRules(job("候选人必须毕业于 985 或 211 院校。"), setting).outcome).toBe("exclude");
    expect(evaluateRules(job("985、211 或双一流院校优先。"), setting).outcome).toBe("review");
    expect(evaluateRules(job("不要求 985、211 学校背景。"), setting).outcome).toBe("pass");
  });

  it("applies selected travel tolerance", () => {
    expect(evaluateRules(job("需要长期、高频出差。"), rules({ travel: "occasional" })).outcome).toBe("exclude");
    expect(evaluateRules(job("工作中可能需要出差。"), rules({ travel: "occasional" })).outcome).toBe("review");
    expect(evaluateRules(job("偶尔短期出差。"), rules({ travel: "occasional" })).outcome).toBe("pass");
    expect(evaluateRules(job("无需出差。"), rules({ travel: "none" })).outcome).toBe("pass");
    expect(evaluateRules(job("需要偶尔出差。"), rules({ travel: "none" })).outcome).toBe("exclude");
  });

  it("handles employment and schedule rules with evidence", () => {
    const setting = rules({
      rejectOutsourcing: true,
      rejectLongTermClientSite: true,
      rejectBigSmallWeek: true
    });
    const result = evaluateRules(job("该职位属于外包项目，需要长期客户现场驻场开发，工作采用大小周。"), setting);
    expect(result.outcome).toBe("exclude");
    expect(result.decisions.map((item) => item.ruleId)).toEqual([
      "engagement:outsourcing",
      "engagement:client_site",
      "schedule:big_small_week"
    ]);
    expect(result.decisions.every((item) => item.evidence[0]?.text.length)).toBeTruthy();
  });

  it("excludes only core selected technologies", () => {
    const setting = rules({ rejectedPrimaryTechnologies: ["java"] });
    expect(evaluateRules(job("必须精通 Java 和 Spring Boot，负责核心服务开发。", "高级 Java 工程师"), setting).outcome).toBe("exclude");
    expect(evaluateRules(job("负责 Python 服务，与现有 Java 系统对接；Java 经验非必需。"), setting).outcome).toBe("pass");
    expect(evaluateRules(job("项目技术栈中提到 Java。"), setting).outcome).toBe("review");
  });

  it("uses only platform and platform job ID for identity", () => {
    const first = job("第一版内容");
    const changed = { ...job("完全不同的内容"), canonicalUrl: "https://www.liepin.com/a/else.shtml" };
    expect(jobKey(first)).toBe("liepin:synthetic-job-1");
    expect(jobKey(changed)).toBe(jobKey(first));
    expect(canonicalJobUrl(first.url)).toBe("https://www.liepin.com/job/10001.shtml");
  });
});
