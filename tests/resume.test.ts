import { describe, expect, it } from "vitest";
import { activateResumeProfile, createDraftResumeProfile, sourceHash } from "../src/resume";

const text = [
  "合成候选人简历",
  "在示例软件公司负责高可用任务平台设计和交付。",
  "使用 TypeScript 建设可恢复任务队列，并编写自动化测试。",
  "参与需求分析、故障复盘和稳定性治理工作。"
].join("\n");

describe("resume profile lifecycle", () => {
  it("creates only a reviewable draft with traceable evidence", async () => {
    const profile = createDraftResumeProfile({
      sourceName: "synthetic.txt",
      sourceKind: "text",
      sourceHash: await sourceHash(text),
      normalizedText: text,
      modelOutput: {
        summary: "具备平台研发经验。",
        targetRoles: ["平台研发"],
        skills: ["TypeScript"],
        facts: [{
          id: "fact-1",
          text: "负责高可用任务平台。",
          keywords: ["高可用", "任务平台"],
          evidence: "在示例软件公司负责高可用任务平台设计和交付。"
        }],
        constraints: []
      }
    });
    expect(profile.state).toBe("draft");
    expect(profile.facts[0]?.approved).toBe(false);
  });

  it("requires an approved fact before activation", async () => {
    const profile = createDraftResumeProfile({
      sourceName: "synthetic.txt",
      sourceKind: "text",
      sourceHash: await sourceHash(text),
      normalizedText: text,
      modelOutput: {
        summary: "具备平台研发经验。",
        targetRoles: [],
        skills: [],
        facts: [{
          id: "fact-1",
          text: "负责高可用任务平台。",
          keywords: [],
          evidence: "在示例软件公司负责高可用任务平台设计和交付。"
        }],
        constraints: []
      }
    });
    expect(() => activateResumeProfile(profile)).toThrow("至少确认一条");
    profile.facts[0]!.approved = true;
    expect(activateResumeProfile(profile).state).toBe("active");
  });

  it("rejects evidence that does not occur in the imported text", async () => {
    const hash = await sourceHash(text);
    expect(() => createDraftResumeProfile({
      sourceName: "synthetic.txt",
      sourceKind: "text",
      sourceHash: hash,
      normalizedText: text,
      modelOutput: {
        summary: "具备平台研发经验。",
        targetRoles: [],
        skills: [],
        facts: [{
          id: "fact-1",
          text: "虚构事实。",
          keywords: [],
          evidence: "担任不存在的职位"
        }],
        constraints: []
      }
    })).toThrow("证据");
  });
});
