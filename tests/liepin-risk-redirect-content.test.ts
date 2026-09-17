// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://safe.liepin.com/v/intercept/verifysms?backurl=https%3A%2F%2Fwww.liepin.com%2Fa%2F1980000999.shtml#jobflow-lease=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}

import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  history.replaceState(
    null,
    "",
    "https://safe.liepin.com/v/intercept/verifysms?backurl=https%3A%2F%2Fwww.liepin.com%2Fa%2F1980000999.shtml#jobflow-lease=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  );
  document.title = "安全中心-风险提示";
  document.body.innerHTML = "<main>当前访问需要完成短信验证</main>";
});

it("reports a leased Liepin risk redirect immediately with its original job identity", async () => {
  const sendMessage = vi.fn(async () => ({ ok: true, data: false }));
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn() }
    }
  });

  await import("../src/content/liepin");

  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
    type: "DETAIL_FAILED",
    code: "risk_control",
    jobId: "1980000999",
    leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    error: "猎聘详情页需要安全验证"
  }), { timeout: 300 });
});

it("recovers the risk redirect lease by handshake when the fragment is removed", async () => {
  history.replaceState(
    null,
    "",
    "https://safe.liepin.com/intercept/user/dispatch?backurl=https%3A%2F%2Fwww.liepin.com%2Fa%2F1980000999.shtml"
  );
  const sendMessage = vi.fn(async (request: { type: string }) => {
    if (request.type === "DETAIL_PAGE_READY") {
      return { ok: true, data: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    }
    return { ok: true, data: false };
  });
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn() }
    }
  });

  await import("../src/content/liepin");

  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
    type: "DETAIL_PAGE_READY",
    jobId: "1980000999"
  }));
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: "DETAIL_FAILED",
    code: "risk_control",
    jobId: "1980000999",
    leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  })));
});
