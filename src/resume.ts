import { z } from "zod";
import type { ResumeFact, ResumeProfile } from "./types";

const modelFactSchema = z.object({
  id: z.string().min(1).max(80),
  text: z.string().min(1).max(500),
  keywords: z.array(z.string().min(1).max(80)).max(20),
  evidence: z.string().min(1).max(800)
}).strict();

const modelProfileSchema = z.object({
  summary: z.string().min(1).max(2000),
  targetRoles: z.array(z.string().min(1).max(120)).max(20),
  skills: z.array(z.string().min(1).max(120)).max(80),
  facts: z.array(modelFactSchema).min(1).max(30),
  constraints: z.array(z.string().min(1).max(300)).max(30).default([])
}).strict();

export async function sourceHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.replace(/\r\n/g, "\n").trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  let stripped = raw.trim();
  const fence = String.fromCharCode(96).repeat(3);
  if (stripped.startsWith(fence)) {
    const firstLineEnd = stripped.indexOf("\n");
    stripped = firstLineEnd >= 0 ? stripped.slice(firstLineEnd + 1) : "";
    if (stripped.endsWith(fence)) stripped = stripped.slice(0, -fence.length).trim();
  }
  try {
    return JSON.parse(stripped);
  } catch {
    throw new Error("模型未返回有效的简历画像 JSON");
  }
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

export function createDraftResumeProfile(input: {
  sourceName: string;
  sourceKind: ResumeProfile["sourceKind"];
  sourceHash: string;
  normalizedText: string;
  modelOutput: unknown;
  version?: number;
}): ResumeProfile {
  const parsed = modelProfileSchema.parse(parseJson(input.modelOutput));
  const normalizedSource = comparable(input.normalizedText);
  const seenIds = new Set<string>();
  const facts: ResumeFact[] = parsed.facts.map((fact) => {
    if (seenIds.has(fact.id)) throw new Error("模型返回了重复的简历事实 ID");
    seenIds.add(fact.id);
    if (!normalizedSource.includes(comparable(fact.evidence))) {
      throw new Error("简历事实证据无法在导入文本中定位");
    }
    return { ...fact, approved: false };
  });
  return {
    id: crypto.randomUUID(),
    version: input.version ?? 1,
    state: "draft",
    sourceHash: input.sourceHash,
    sourceName: input.sourceName,
    sourceKind: input.sourceKind,
    analyzedAt: new Date().toISOString(),
    summary: parsed.summary,
    targetRoles: [...new Set(parsed.targetRoles)],
    skills: [...new Set(parsed.skills)],
    facts,
    constraints: [...new Set(parsed.constraints)]
  };
}

export function activateResumeProfile(profile: ResumeProfile): ResumeProfile {
  const approvedFacts = profile.facts.filter((fact) => fact.approved);
  if (!approvedFacts.length) throw new Error("至少确认一条简历事实后才能启用画像");
  return {
    ...profile,
    state: "active",
    activatedAt: new Date().toISOString(),
    facts: approvedFacts
  };
}
