import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/defaults";
import { decodeRuntimeRequest, extensionSettingsSchema } from "../src/domain/messages";
import { normalizeChatCompletionsEndpoint } from "../src/llm";

describe("runtime and endpoint contracts", () => {
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
