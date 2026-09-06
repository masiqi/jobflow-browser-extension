import { chatCompletion } from "./llm";
import type { ModelSettings, ResumeFact, ResumeProfile } from "./types";

export async function sourceHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.replace(/\r\n/g, "\n").trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function factsFromText(text: string): ResumeFact[] {
  const lines = text.split(/\n+/).map((line) => line.replace(/^[-*#\d.\s]+/, "").trim()).filter((line) => line.length >= 10);
  return lines.slice(0, 30).map((line, index) => ({ id: `resume_${index + 1}`, text: line.slice(0, 300), keywords: line.split(/[，。；、\s/()（）]+/).filter((word) => word.length >= 2).slice(0, 12), evidence: line.slice(0, 500) }));
}

export async function buildResumeProfile(sourceName: string, sourceText: string, model?: ModelSettings): Promise<ResumeProfile> {
  const clean = sourceText.replace(/\u0000/g, "").trim();
  if (clean.length < 100) throw new Error("简历文本太短，无法建立画像");
  if (model?.apiKey.trim()) {
    const raw = await chatCompletion({ ...model, temperature: 0.1 }, [
      { role: "system", content: "你是严谨的简历事实抽取器。只抽取文本中明确出现的事实，不推断、不美化、不输出联系方式。只返回JSON对象：{summary,targetRoles,skills,facts:[{id,text,keywords,evidence}],prohibitions}。facts最多30条，evidence必须是原文短摘录。特别禁止把新浪经历写成CTO/技术负责人，禁止把当前新致职位写成CTO/技术负责人/架构师。" },
      { role: "user", content: `<untrusted_resume>\n${clean.slice(0, 30000)}\n</untrusted_resume>` }
    ]);
    try {
      const value = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Partial<ResumeProfile>;
      const facts = Array.isArray(value.facts) ? value.facts.filter((item): item is ResumeFact => Boolean(item && typeof item.id === "string" && typeof item.text === "string" && typeof item.evidence === "string" && Array.isArray(item.keywords))).slice(0, 30) : [];
      if (typeof value.summary === "string" && facts.length > 0) {
        return {
          version: 1, sourceHash: await sourceHash(clean), sourceName, analyzedAt: new Date().toISOString(), summary: value.summary.slice(0, 2000),
          targetRoles: Array.isArray(value.targetRoles) ? value.targetRoles.filter((item): item is string => typeof item === "string").slice(0, 20) : [],
          skills: Array.isArray(value.skills) ? value.skills.filter((item): item is string => typeof item === "string").slice(0, 80) : [], facts,
          prohibitions: [...new Set([...(Array.isArray(value.prohibitions) ? value.prohibitions.filter((item): item is string => typeof item === "string") : []), "新浪经历不得写成CTO或技术负责人", "当前新致正式职位只能写Agent开发工程师", "不得虚构Java能力、百分比指标、薪资到岗或出差承诺"])]
        };
      }
    } catch { /* invalid model output falls back to deterministic local extraction */ }
  }
  const facts = factsFromText(clean);
  return {
    version: 1,
    sourceHash: await sourceHash(clean),
    sourceName,
    analyzedAt: new Date().toISOString(),
    summary: clean.slice(0, 1200),
    targetRoles: ["Agent开发", "AI应用研发", "Agent平台架构", "技术负责人", "CTO"],
    skills: [...new Set(facts.flatMap((fact) => fact.keywords))].slice(0, 60),
    facts,
    prohibitions: ["新浪经历不得写成CTO或技术负责人", "当前新致正式职位只能写Agent开发工程师", "不得虚构Java能力、百分比指标、薪资到岗或出差承诺"]
  };
}
