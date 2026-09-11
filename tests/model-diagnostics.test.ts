import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createModelOutputDiagnostics } from "../supabase/functions/model-gateway/diagnostics";
import {
  formatModelOutputDiagnostic,
  reportModelOutputDiagnostic
} from "../src/backend/model-diagnostics";

const sensitiveEmail = "candidate@example.invalid";
const sensitivePhone = "13800000000";
const sensitiveValue = "SENSITIVE_TOKEN_VALUE";

function diagnostic() {
  return createModelOutputDiagnostics({
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    operation: "evaluate_opportunity",
    provider: "custom",
    model: "synthetic-model"
  }, {
    outcome: "maybe",
    reasons: sensitiveEmail,
    factIds: [sensitivePhone],
    [sensitiveEmail]: sensitiveValue
  }, [
    { path: ["outcome"], code: "invalid_value" },
    { path: ["reasons"], code: "invalid_type" },
    { path: [sensitiveEmail], code: "unrecognized_keys" }
  ]);
}

describe("safe model-output diagnostics", () => {
  it("wires sanitized diagnostics into the Edge output boundary without raw-output logging", async () => {
    const source = await readFile("supabase/functions/model-gateway/index.ts", "utf8");
    expect(source).toContain("outputSchema.safeParse(result.output)");
    expect(source).toContain("createModelOutputDiagnostics");
    expect(source).toContain('code: "model_output_invalid"');
    expect(source).not.toMatch(/console\.(?:log|warn|error)\([^\n]*(?:result\.output|message\.content)/);
  });

  it("keeps only allowlisted field names, JSON types, and sanitized issue paths", () => {
    const result = diagnostic();
    expect(result).toMatchObject({
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      operation: "evaluate_opportunity",
      provider: "custom",
      model: "synthetic-model",
      stage: "model_output",
      outputKind: "object",
      fields: [
        { name: "outcome", kind: "string" },
        { name: "reasons", kind: "string" },
        { name: "factIds", kind: "array" }
      ],
      missingFields: ["jdEvidence"],
      unknownFieldCount: 1,
      issues: [
        { path: "outcome", code: "invalid_value" },
        { path: "reasons", code: "invalid_type" },
        { path: "<unknown>", code: "unrecognized_keys" }
      ]
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(sensitiveEmail);
    expect(serialized).not.toContain(sensitivePhone);
    expect(serialized).not.toContain(sensitiveValue);
    expect(serialized.length).toBeLessThan(2000);
  });

  it("formats a compact visible reason without including model values", () => {
    const message = formatModelOutputDiagnostic(diagnostic());
    expect(message).toContain("适配度评估");
    expect(message).toContain("reasons:invalid_type");
    expect(message).toContain("缺少 jdEvidence");
    expect(message).toContain("请求 aaaaaaaa");
    expect(message).not.toContain(sensitiveEmail);
    expect(message).not.toContain(sensitivePhone);
    expect(message.length).toBeLessThanOrEqual(200);
  });

  it("logs only the validated safe diagnostic in the Service Worker console", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const message = reportModelOutputDiagnostic(diagnostic());
    expect(message).toContain("适配度评估");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toBe("[JobFlow:model-output-validation]");
    const serializedArguments = JSON.stringify(warn.mock.calls[0]);
    expect(serializedArguments).not.toContain(sensitiveEmail);
    expect(serializedArguments).not.toContain(sensitivePhone);
    expect(serializedArguments).not.toContain(sensitiveValue);
    warn.mockRestore();
  });
});
