import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { DEFAULT_SETTINGS } from "../src/defaults";
import { decodeRuntimeRequest, extensionSettingsSchema } from "../src/domain/messages";
import { normalizeChatCompletionsEndpoint } from "../src/llm";

describe("runtime and endpoint contracts", () => {
  it("clears the detail-readiness alarm before filtering or model work", async () => {
    const source = await readFile("src/background.ts", "utf8");
    const handler = source.slice(
      source.indexOf("async function handleDetail"),
      source.indexOf("async function pauseBatch")
    );
    const postDetail = source.slice(
      source.indexOf("async function processPostDetail"),
      source.indexOf("async function handleDetail")
    );
    const clearAlarm = handler.indexOf("await chrome.alarms.clear(detailAlarmName(run.id, leaseId))");
    const persistDetails = handler.indexOf("await recordJobDetails(");
    const continueProcessing = handler.indexOf("await processPostDetail(");
    expect(clearAlarm).toBeGreaterThan(0);
    expect(persistDetails).toBeGreaterThan(clearAlarm);
    expect(persistDetails).toBeLessThan(handler.indexOf("await activeProfile()"));
    expect(continueProcessing).toBeGreaterThan(persistDetails);
    expect(postDetail).toContain("evaluateRules(job, settings.rules)");
    expect(postDetail).toContain('invokeModel("evaluate_opportunity"');
    expect(postDetail).not.toContain("chrome.tabs");
  });

  it("accepts only the draft-only batch command shape", () => {
    expect(decodeRuntimeRequest({
      type: "START_BATCH",
      selectedJobIds: ["one", "two"]
    }).type).toBe("START_BATCH");
    expect(() => decodeRuntimeRequest({
      type: "START_BATCH",
      selectedJobIds: ["one"],
      mode: "live"
    })).toThrow();
    expect(() => decodeRuntimeRequest({
      type: "START_BATCH",
      selectedJobIds: Array.from({ length: 21 }, (_, index) => String(index))
    })).toThrow();
  });

  it("accepts only a strict stored-opportunity retry command", () => {
    const opportunityId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    expect(decodeRuntimeRequest({
      type: "RETRY_STORED_OPPORTUNITY",
      opportunityId
    })).toEqual({ type: "RETRY_STORED_OPPORTUNITY", opportunityId });
    expect(() => decodeRuntimeRequest({
      type: "RETRY_STORED_OPPORTUNITY",
      opportunityId: "not-a-uuid"
    })).toThrow();
    expect(() => decodeRuntimeRequest({
      type: "RETRY_STORED_OPPORTUNITY",
      opportunityId,
      description: "不能由页面提供 JD"
    })).toThrow();
  });

  it("rejects legacy free-form settings", () => {
    expect(extensionSettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(() => extensionSettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      customExcludeAny: ["synthetic"]
    })).toThrow();
  });

  it("normalizes supported public HTTPS endpoints", () => {
    expect(normalizeChatCompletionsEndpoint("https://api.openai.com/v1"))
      .toBe("https://api.openai.com/v1/chat/completions");
    expect(normalizeChatCompletionsEndpoint("https://example.com/gateway/chat/completions?token=bad"))
      .toBe("https://example.com/gateway/chat/completions");
  });

  it("rejects local, IP-literal, credentialed, and HTTP endpoints", () => {
    for (const endpoint of [
      "http://example.com/v1",
      "https://localhost/v1",
      "https://127.0.0.1/v1",
      "https://[::1]/v1",
      "https://user:secret@example.com/v1",
      "https://metadata.google.internal/v1"
    ]) {
      expect(() => normalizeChatCompletionsEndpoint(endpoint)).toThrow();
    }
  });
});
