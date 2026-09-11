import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildGreetingMessages,
  buildSuitabilityMessages,
  parseGreetingDecision,
  parseSuitabilityDecision
} from "../src/prompt";
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
  it("states every suitability array cardinality in both provider prompts", async () => {
    const clientPrompt = buildSuitabilityMessages(job, profile, { outcome: "pass", decisions: [] })[0]?.content ?? "";
    expect(clientPrompt).toContain("outcome 只能是 proceed、review 或 exclude 之一");
    expect(clientPrompt).toContain("score 可省略，如提供必须是 0 到 100 的数字");
    expect(clientPrompt).toContain("reasons 必须包含 1 到 6 项");
    expect(clientPrompt).toContain("jdEvidence 最多包含 6 项，exclude 时至少包含 1 项");
    expect(clientPrompt).toContain("必须逐字复制职位描述中的连续原文片段，不得改写、概括或添加省略号");
    expect(clientPrompt).toContain("factIds 最多包含 6 个");

    const edgeSource = await readFile("supabase/functions/model-gateway/index.ts", "utf8");
    const edgePrompt = edgeSource.slice(
      edgeSource.indexOf("function suitabilityMessages"),
      edgeSource.indexOf("function greetingMessages")
    );
    expect(edgePrompt).toContain("outcome 只能是 proceed、review 或 exclude 之一");
    expect(edgePrompt).toContain("score 可省略，如提供必须是 0 到 100 的数字");
    expect(edgePrompt).toContain("reasons 必须包含 1 到 6 项");
    expect(edgePrompt).toContain("jdEvidence 最多包含 6 项，exclude 时至少包含 1 项");
    expect(edgePrompt).toContain("必须逐字复制职位描述中的连续原文片段，不得改写、概括或添加省略号");
    expect(edgePrompt).toContain("factIds 最多包含 6 个");
  });

  it("requires exact JD excerpts in both greeting provider prompts", async () => {
    const clientPrompt = buildGreetingMessages(job, profile)[0]?.content ?? "";
    expect(clientPrompt).toContain("jdEvidence 必须包含 1 到 3 项");
    expect(clientPrompt).toContain("必须逐字复制职位描述中的连续原文片段，不得改写、概括或添加省略号");
    expect(clientPrompt).toContain("factIds 必须包含 1 到 2 个");

    const edgeSource = await readFile("supabase/functions/model-gateway/index.ts", "utf8");
    const edgePrompt = edgeSource.slice(
      edgeSource.indexOf("function greetingMessages"),
      edgeSource.indexOf("async function hydrateTrustedOpportunityPayload")
    );
    expect(edgePrompt).toContain("jdEvidence 必须包含 1 到 3 项");
    expect(edgePrompt).toContain("必须逐字复制职位描述中的连续原文片段，不得改写、概括或添加省略号");
    expect(edgePrompt).toContain("factIds 必须包含 1 到 2 个");
  });

  it("rejects suitability output outside the documented array bounds", () => {
    const expandedProfile: ResumeProfile = {
      ...profile,
      facts: Array.from({ length: 7 }, (_, index) => ({
        id: "fact-" + index,
        text: "合成事实 " + index,
        keywords: ["合成"],
        evidence: "合成事实证据 " + index,
        approved: true
      }))
    };
    expect(() => parseSuitabilityDecision({
      outcome: "proceed",
      reasons: ["平台经验相关"],
      jdEvidence: ["建设高可用任务平台"],
      factIds: Array.from({ length: 7 }, (_, index) => "fact-" + index)
    }, job, expandedProfile)).toThrow();
  });

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
