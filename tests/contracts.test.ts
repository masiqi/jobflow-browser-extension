import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { DEFAULT_SETTINGS } from "../src/defaults";
import {
  decodeRuntimeRequest,
  executionPolicySchema,
  extensionSettingsSchema,
  liepinReviewedSendExecuteCommandSchema
} from "../src/domain/messages";
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

  it("binds batch start to an explicit expected execution policy", () => {
    expect(decodeRuntimeRequest({
      type: "START_BATCH",
      selectedJobIds: ["one", "two"],
      expectedExecutionPolicy: "automatic_send"
    }).type).toBe("START_BATCH");
    expect(() => decodeRuntimeRequest({
      type: "START_BATCH",
      selectedJobIds: ["one"]
    })).toThrow();
    expect(() => decodeRuntimeRequest({
      type: "START_BATCH",
      selectedJobIds: ["one"],
      mode: "live"
    })).toThrow();
    expect(() => decodeRuntimeRequest({
      type: "START_BATCH",
      selectedJobIds: Array.from({ length: 21 }, (_, index) => String(index)),
      expectedExecutionPolicy: "reviewed_send"
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

  it("accepts only a strict detail-page lease handshake command", () => {
    expect(decodeRuntimeRequest({
      type: "DETAIL_PAGE_READY",
      jobId: "1980000301"
    })).toEqual({ type: "DETAIL_PAGE_READY", jobId: "1980000301" });
    expect(() => decodeRuntimeRequest({
      type: "DETAIL_PAGE_READY",
      jobId: ""
    })).toThrow();
    expect(() => decodeRuntimeRequest({
      type: "DETAIL_PAGE_READY",
      jobId: "1980000301",
      leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    })).toThrow();
  });

  it("accepts only classified detail failures", () => {
    const command = {
      type: "DETAIL_FAILED",
      code: "job_unavailable",
      jobId: "1980000301",
      leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      error: "猎聘职位已暂停招聘或不可用"
    } as const;
    expect(decodeRuntimeRequest(command)).toEqual(command);
    expect(() => decodeRuntimeRequest({ ...command, code: "arbitrary_page_error" })).toThrow();
    const { code: _code, ...withoutCode } = command;
    expect(() => decodeRuntimeRequest(withoutCode)).toThrow();
  });

  it("accepts only strict reviewed-send identities without page-supplied content", () => {
    const command = {
      type: "PREPARE_REVIEWED_SEND",
      opportunityId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      draftRevisionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      draftSha256: "a".repeat(64)
    };
    expect(decodeRuntimeRequest(command)).toEqual(command);
    expect(decodeRuntimeRequest({ ...command, type: "CONFIRM_REVIEWED_SEND" }).type).toBe("CONFIRM_REVIEWED_SEND");
    expect(() => decodeRuntimeRequest({ ...command, opportunityId: "not-a-uuid" })).toThrow();
    expect(() => decodeRuntimeRequest({ ...command, draftText: "不能由页面提供话术" })).toThrow();
    expect(() => decodeRuntimeRequest({ ...command, platformJobId: "1980000301" })).toThrow();
  });

  it("requires reviewed-send execute leases to declare missing components", () => {
    expect(liepinReviewedSendExecuteCommandSchema.parse({
      type: "CONTENT_REVIEWED_SEND_EXECUTE",
      leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      platformJobId: "1980000301",
      draftText: "合成招呼语",
      draftSha256: "a".repeat(64),
      needsApplication: true,
      needsGreeting: false
    }).needsGreeting).toBe(false);
    expect(() => liepinReviewedSendExecuteCommandSchema.parse({
      type: "CONTENT_REVIEWED_SEND_EXECUTE",
      leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      platformJobId: "1980000301",
      draftText: "合成招呼语",
      draftSha256: "a".repeat(64)
    })).toThrow();
  });

  it("rechecks preflight and records both attempts before the reviewed platform command", async () => {
    const source = await readFile("src/background.ts", "utf8");
    const handler = source.slice(
      source.indexOf("async function executeReviewedDeliveryCore"),
      source.indexOf("async function prepareReviewedSend")
    );
    const finalPreflight = handler.indexOf('type: "CONTENT_REVIEWED_SEND_PREFLIGHT"');
    const reserve = handler.indexOf("reserveReviewedDeliveryQuota(");
    const markWrite = handler.indexOf("markReviewedDeliveryWriteStarted(");
    const applicationAttempt = handler.indexOf('eventKind: "application_attempted"');
    const greetingAttempt = handler.indexOf('eventKind: "greeting_attempted"');
    const execute = handler.indexOf('type: "CONTENT_REVIEWED_SEND_EXECUTE"');
    expect(finalPreflight).toBeGreaterThan(0);
    expect(finalPreflight).toBeLessThan(reserve);
    expect(reserve).toBeLessThan(markWrite);
    expect(markWrite).toBeLessThan(applicationAttempt);
    expect(applicationAttempt).toBeLessThan(execute);
    expect(greetingAttempt).toBeLessThan(execute);
    expect(handler).toContain("releaseReviewedDeliveryQuota(");
    const confirm = source.slice(
      source.indexOf("async function confirmReviewedSend"),
      source.indexOf("async function handleReviewDecision")
    );
    expect(confirm).toContain("reviewedSendLeases.delete(opportunityId)");
  });

  it("rejects legacy free-form settings", () => {
    expect(extensionSettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(executionPolicySchema.parse("draft_only")).toBe("draft_only");
    expect(executionPolicySchema.parse("reviewed_send")).toBe("reviewed_send");
    expect(executionPolicySchema.parse("automatic_send")).toBe("automatic_send");
    expect(() => extensionSettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      customExcludeAny: ["synthetic"]
    })).toThrow();
  });

  it("requires valid automatic-send interval settings", () => {
    expect(extensionSettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      executionPolicy: "automatic_send",
      automaticSendDelayMinSeconds: 5,
      automaticSendDelayMaxSeconds: 600
    })).toMatchObject({
      executionPolicy: "automatic_send",
      automaticSendDelayMinSeconds: 5,
      automaticSendDelayMaxSeconds: 600
    });
    expect(() => extensionSettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      automaticSendDelayMinSeconds: 4,
      automaticSendDelayMaxSeconds: 20
    })).toThrow();
    expect(() => extensionSettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      automaticSendDelayMinSeconds: 10.5,
      automaticSendDelayMaxSeconds: 20
    })).toThrow();
    expect(() => extensionSettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      automaticSendDelayMinSeconds: 30,
      automaticSendDelayMaxSeconds: 20
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
