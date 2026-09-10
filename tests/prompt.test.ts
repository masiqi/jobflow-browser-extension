import { describe, expect, it } from "vitest";
import { parseGreetingDecision, parseSuitabilityDecision } from "../src/prompt";
import type { DetailJob, ResumeProfile } from "../src/types";

const profile: ResumeProfile = {
  id: "00000000-0000-4000-8000-000000000010",
  version: 1,
  state: "active",
  sourceHash: "a".repeat(64),
  sourceName: "synthetic.txt",
  sourceKind: "text",
  analyzedAt: "2026-01-01T00:00:00.000Z",
  activatedAt: "2026-01-01T00:01:00.000Z",
  summary: "合成候选人拥有平台工程经验。",
  targetRoles: ["平台研发"],
  skills: ["TypeScript"],
  facts: [{
    id: "fact-1",
    text: "负责过高可用任务平台。",
    keywords: ["平台", "高可用"],
    evidence: "负责过高可用任务平台",
    approved: true
  }],
  constraints: []
};

const job: DetailJob = {
  platform: "liepin",
  jobId: "synthetic-job",
  url: "https://www.liepin.com/job/1.shtml",
  canonicalUrl: "https://www.liepin.com/job/1.shtml",
  title: "平台研发工程师",
  company: "合成公司",
  location: "上海",
  salary: "20-30k",
  experience: "3年",
  education: "本科",
  cardText: "",
  index: 0,
  description: "负责建设高可用任务平台和稳定性体系。",
  recruiter: "测试招聘方",
  recruiterTitle: "招聘经理"
};

describe("model output validation", () => {
  it("accepts grounded suitability and rejects missing JD evidence", () => {
    expect(parseSuitabilityDecision({
      outcome: "proceed",
      score: 82,
      reasons: ["平台经验相关"],
      jdEvidence: ["建设高可用任务平台"],
      factIds: ["fact-1"]
    }, job, profile).outcome).toBe("proceed");
    expect(() => parseSuitabilityDecision({
      outcome: "exclude",
      reasons: ["不匹配"],
      jdEvidence: ["不存在的要求"],
      factIds: []
    }, job, profile)).toThrow("JD 证据");
  });

  it("accepts a grounded plain greeting", () => {
    const greeting = "您好，看到贵司希望建设高可用任务平台，我此前负责过同类任务平台的稳定性设计与交付，对可靠性治理有直接实践。期待了解当前团队在任务规模和稳定性目标上的重点，也希望进一步交流岗位需求。";
    expect(parseGreetingDecision({
      greeting,
      jdEvidence: ["建设高可用任务平台"],
      factIds: ["fact-1"]
    }, job, profile).greeting).toBe(greeting);
  });

  it("rejects contact details, commitments, Markdown, and unapproved facts", () => {
    const base = {
      jdEvidence: ["建设高可用任务平台"],
      factIds: ["fact-1"]
    };
    expect(() => parseGreetingDecision({ ...base, greeting: "您好，我有相关经验，微信 vx:test，期待进一步沟通这个岗位的具体工作与团队目标。" }, job, profile)).toThrow("联系方式");
    expect(() => parseGreetingDecision({ ...base, greeting: "您好，我有相关经验并且可以出差，希望进一步沟通这个岗位的具体工作内容和团队目标。" }, job, profile)).toThrow("求职承诺");
    expect(() => parseGreetingDecision({ ...base, greeting: "- 您好，我有相关平台经验，也参与过稳定性治理，希望进一步沟通这个岗位的具体工作内容、任务规模和团队目标。" }, job, profile)).toThrow("Markdown");
    expect(() => parseGreetingDecision({ ...base, greeting: "您好，我有相关平台经验，希望进一步沟通这个岗位的具体工作内容、稳定性目标和团队协作方式。", factIds: ["unknown"] }, job, profile)).toThrow("简历事实");
  });
});
