export type DiagnosticOperation =
  | "test_provider"
  | "extract_resume_profile"
  | "evaluate_opportunity"
  | "generate_greeting";

export type JsonValueKind = "array" | "boolean" | "null" | "number" | "object" | "string" | "undefined";
export type DiagnosticFieldName =
  | "ok"
  | "summary"
  | "targetRoles"
  | "skills"
  | "facts"
  | "constraints"
  | "outcome"
  | "score"
  | "reasons"
  | "jdEvidence"
  | "factIds"
  | "greeting";

export interface ModelOutputDiagnostic {
  requestId: string;
  operation: DiagnosticOperation;
  provider: "openai" | "deepseek" | "openrouter" | "custom";
  model: string;
  stage: "model_output";
  outputKind: JsonValueKind;
  fields: Array<{ name: DiagnosticFieldName; kind: JsonValueKind }>;
  missingFields: DiagnosticFieldName[];
  unknownFieldCount: number;
  issues: Array<{ path: string; code: string }>;
}

interface IssueLike {
  path: PropertyKey[];
  code: string;
}

const FIELD_CONTRACTS: Record<DiagnosticOperation, {
  expected: DiagnosticFieldName[];
  required: DiagnosticFieldName[];
}> = {
  test_provider: { expected: ["ok"], required: ["ok"] },
  extract_resume_profile: {
    expected: ["summary", "targetRoles", "skills", "facts", "constraints"],
    required: ["summary", "targetRoles", "skills", "facts", "constraints"]
  },
  evaluate_opportunity: {
    expected: ["outcome", "score", "reasons", "jdEvidence", "factIds"],
    required: ["outcome", "reasons", "jdEvidence", "factIds"]
  },
  generate_greeting: {
    expected: ["greeting", "jdEvidence", "factIds"],
    required: ["greeting", "jdEvidence", "factIds"]
  }
};

const ALLOWED_PATH_PARTS = new Set([
  "ok", "summary", "targetRoles", "skills", "facts", "constraints",
  "outcome", "score", "reasons", "jdEvidence", "factIds", "greeting",
  "id", "text", "keywords", "evidence"
]);

function valueKind(value: unknown): JsonValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const kind = typeof value;
  return kind === "boolean" || kind === "number" || kind === "string" || kind === "undefined"
    ? kind
    : "object";
}

function safePath(path: PropertyKey[]): string {
  if (!path.length) return "<root>";
  const parts: string[] = [];
  for (const part of path.slice(0, 6)) {
    if (typeof part === "number") {
      parts.push("[" + Math.max(0, Math.min(part, 99)) + "]");
    } else if (typeof part === "string" && ALLOWED_PATH_PARTS.has(part)) {
      parts.push(part);
    } else {
      parts.push("<unknown>");
    }
  }
  return parts.join(".").replace(/\.\[/g, "[");
}

export function createModelOutputDiagnostics(
  context: {
    requestId: string;
    operation: DiagnosticOperation;
    provider: ModelOutputDiagnostic["provider"];
    model: string;
  },
  output: unknown,
  issues: IssueLike[]
): ModelOutputDiagnostic {
  const contract = FIELD_CONTRACTS[context.operation];
  const record = output && typeof output === "object" && !Array.isArray(output)
    ? output as Record<string, unknown>
    : {};
  const actualKeys = Object.keys(record);
  const expected = new Set<string>(contract.expected);
  return {
    requestId: context.requestId,
    operation: context.operation,
    provider: context.provider,
    model: context.model.slice(0, 200),
    stage: "model_output",
    outputKind: valueKind(output),
    fields: contract.expected
      .filter((name) => Object.hasOwn(record, name))
      .map((name) => ({ name, kind: valueKind(record[name]) })),
    missingFields: contract.required.filter((name) => !Object.hasOwn(record, name)),
    unknownFieldCount: actualKeys.filter((name) => !expected.has(name)).length,
    issues: issues.slice(0, 6).map((issue) => ({
      path: safePath(issue.path),
      code: issue.code.slice(0, 40)
    }))
  };
}
