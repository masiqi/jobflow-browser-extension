import { describe, expect, it } from "vitest";
import { evaluateRules, parseSalaryMaxK } from "../src/filters";
import { FILTERS } from "../src/defaults";
import type { ListCandidate } from "../src/types";

const job = (overrides: Partial<ListCandidate> = {}): ListCandidate => ({ platform: "liepin", jobId: "1", url: "https://www.liepin.com/a/1.shtml", canonicalUrl: "https://www.liepin.com/a/1.shtml", title: "AI Agent开发工程师", company: "示例公司", location: "北京", salary: "30-50k", experience: "5-10年", education: "本科", cardText: "AI Agent Python RAG MCP", index: 0, ...overrides });

describe("flexible filters", () => {
  it("parses monthly and annual salary upper bounds", () => { expect(parseSalaryMaxK("30-50k·15薪")).toBe(50); expect(parseSalaryMaxK("31-50万")).toBeCloseTo(4.2, 1); });
  it("passes Agent jobs by default", () => { expect(evaluateRules(job(), FILTERS).decision).toBe("pass"); });
  it("excludes Java-primary and mobile jobs by configured direction", () => { expect(evaluateRules(job({ title: "Java Agent研发工程师", cardText: "Spring Boot Java Agent" }), FILTERS).decision).toBe("skip"); expect(evaluateRules(job({ title: "Android Agent开发", cardText: "Android Kotlin Agent" }), FILTERS).decision).toBe("skip"); });
  it("supports GPU/chip as required, excluded, or ignored", () => { const filters = structuredClone(FILTERS); const gpu = filters.directions.find((x) => x.id === "gpu")!; gpu.mode = "require"; filters.directions.find((x) => x.id === "agent")!.mode = "ignore"; expect(evaluateRules(job({ title: "CUDA GPU研发", cardText: "CUDA 推理加速" }), filters).decision).toBe("pass"); gpu.mode = "exclude"; expect(evaluateRules(job({ title: "CUDA GPU研发", cardText: "CUDA 推理加速" }), filters).decision).toBe("skip"); });
  it("supports 985/211 review, exclude, include-only, and ignore", () => { const filters = structuredClone(FILTERS); expect(evaluateRules(job({ cardText: "要求985或211院校" }), filters).decision).toBe("review"); filters.schoolRestrictionMode = "exclude"; expect(evaluateRules(job({ cardText: "要求985或211院校" }), filters).decision).toBe("skip"); filters.schoolRestrictionMode = "include_only"; expect(evaluateRules(job({ cardText: "普通本科" }), filters).decision).toBe("review"); filters.schoolRestrictionMode = "ignore"; expect(evaluateRules(job({ cardText: "要求985或211院校" }), filters).decision).toBe("pass"); });
 it("defers missing detail-only requirements on list cards, then enforces them on the full JD", () => {
    const base = job();
    const school = { ...FILTERS, schoolRestrictionMode: "include_only" as const };
   expect(evaluateRules(base, school, false).decision).toBe("review");
   expect(evaluateRules({ ...base, description: "岗位要求本科，熟悉Agent", recruiter: "", recruiterTitle: "" }, school, true).decision).toBe("skip");
   expect(evaluateRules({ ...base, description: "岗位要求985或211本科，熟悉Agent", recruiter: "", recruiterTitle: "" }, school, true).decision).not.toBe("skip");
 });
 });
