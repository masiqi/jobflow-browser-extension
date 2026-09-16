// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.liepin.com/a/1980000301.shtml#jobflow-lease=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}

import { beforeEach, expect, it, vi } from "vitest";

async function captureUnhandledRejections(action: () => Promise<void>): Promise<unknown[]> {
  const reasons: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    reasons.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    await action();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return reasons;
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
}

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "https://www.liepin.com/a/1980000301.shtml#jobflow-lease=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  document.title = "【北京 合成智能体工程师招聘】-合成科技北京招聘信息-猎聘";
  document.body.innerHTML = `
    <div class="job-properties">北京-海淀区 3-5年 本科 招1人</div>
    <div class="job-title">合成智能体工程师</div>
    <div class="company-name">合成科技</div>
	    <div class="job-intro-container"><div class="paragraph">职位介绍 岗位职责 负责合成智能体平台研发、任务编排和稳定性建设。任职要求 熟悉 TypeScript 与分布式系统。</div></div>`;
});

it("obtains a detail lease by handshake when the detail URL has no hash", async () => {
  history.replaceState(null, "", "https://www.liepin.com/a/1980000301.shtml");
  const sendMessage = vi.fn(async (request: { type: string }) => {
    if (request.type === "GET_LAUNCHER_VISIBILITY") return { ok: true, data: false };
    if (request.type === "DETAIL_PAGE_READY") return { ok: true, data: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    if (request.type === "DETAIL_READY") return { ok: true };
    return { ok: true };
  });
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn() }
    }
  });

  await import("../src/content/liepin");

  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: "DETAIL_READY",
    leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    job: expect.objectContaining({ jobId: "1980000301" })
  })));
});

it("retries the detail lease handshake briefly and reports detail only once", async () => {
  vi.useFakeTimers();
  history.replaceState(null, "", "https://www.liepin.com/a/1980000301.shtml");
  let handshakeCount = 0;
  const sendMessage = vi.fn(async (request: { type: string }) => {
    if (request.type === "GET_LAUNCHER_VISIBILITY") return { ok: true, data: false };
    if (request.type === "DETAIL_PAGE_READY") {
      handshakeCount += 1;
      return { ok: true, data: handshakeCount >= 2 ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : null };
    }
    if (request.type === "DETAIL_READY") return { ok: true };
    return { ok: true };
  });
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn() }
    }
  });

  try {
    await import("../src/content/liepin");
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "DETAIL_PAGE_READY",
      jobId: "1980000301"
    })));
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "DETAIL_READY",
      leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    })));
    expect(sendMessage.mock.calls.filter(([request]) => request.type === "DETAIL_READY")).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it("reports an explicit detail failure when DETAIL_READY is rejected", async () => {
  const sendMessage = vi.fn(async (request: { type: string }) => {
    if (request.type === "GET_LAUNCHER_VISIBILITY") return { ok: true, data: false };
    if (request.type === "DETAIL_READY") return { ok: false, error: "消息格式无效" };
    return { ok: true };
  });
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn() }
    }
  });

  await import("../src/content/liepin");

  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: "DETAIL_FAILED",
    jobId: "1980000301",
    error: expect.stringContaining("消息格式无效")
  })));
});

it("reports a paused recruitment page immediately as permanently unavailable", async () => {
  document.body.innerHTML = `
    <main>
      <header class="stop-apply-header">该职位已暂停招聘</header>
      <section class="recommendations">投递过该职位的人还浏览了其他合成职位</section>
    </main>`;
  const sendMessage = vi.fn(async (request: { type: string }) => {
    if (request.type === "GET_LAUNCHER_VISIBILITY") return { ok: true, data: false };
    return { ok: true };
  });
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn() }
    }
  });

  await import("../src/content/liepin");

  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
    type: "DETAIL_FAILED",
    code: "job_unavailable",
    jobId: "1980000301",
    leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    error: "猎聘职位已暂停招聘或不可用"
  }), { timeout: 300 });
});

it("does not leave an unhandled rejection when Reload invalidates the launcher context", async () => {
  history.replaceState(null, "", "https://www.liepin.com/zhaopin/");
  const sendMessage = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn() }
    }
  });

  await import("../src/content/liepin");
  await vi.waitFor(() => expect(document.querySelector("#jobflow-launcher-root")).not.toBeNull());
  const button = document.querySelector<HTMLElement>("#jobflow-launcher-root")?.shadowRoot?.querySelector<HTMLButtonElement>("button");
  expect(button).not.toBeNull();

  const unhandled = await captureUnhandledRejections(async () => {
    vi.stubGlobal("chrome", {});
    button?.click();
  });

  expect(unhandled).toEqual([]);
});

it("does not leave an unhandled rejection when Reload rejects a startup message", async () => {
  history.replaceState(null, "", "https://www.liepin.com/zhaopin/");
  const sendMessage = vi.fn(async () => {
    throw new Error("Extension context invalidated.");
  });
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn() }
    }
  });

  const unhandled = await captureUnhandledRejections(async () => {
    await import("../src/content/liepin");
  });

  expect(unhandled).toEqual([]);
});

it("stops leased detail reporting quietly when Reload removes the runtime", async () => {
  const sendMessage = vi.fn(async (request: { type: string }) => {
    if (request.type === "GET_LAUNCHER_VISIBILITY") {
      vi.stubGlobal("chrome", {});
      return { ok: true, data: false };
    }
    return { ok: true };
  });
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn() }
    }
  });

  const unhandled = await captureUnhandledRejections(async () => {
    await import("../src/content/liepin");
  });

  expect(unhandled).toEqual([]);
  expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "DETAIL_READY" }));
});

it("keeps a valid-context launcher transport failure visible on the button", async () => {
  history.replaceState(null, "", "https://www.liepin.com/zhaopin/");
  const sendMessage = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn() }
    }
  });

  await import("../src/content/liepin");
  await vi.waitFor(() => expect(document.querySelector("#jobflow-launcher-root")).not.toBeNull());
  const button = document.querySelector<HTMLElement>("#jobflow-launcher-root")?.shadowRoot?.querySelector<HTMLButtonElement>("button");
  expect(button).not.toBeNull();
  sendMessage.mockRejectedValueOnce(new Error("Service worker unavailable"));

  button?.click();

  await vi.waitFor(() => expect(button?.title).toBe("Service worker unavailable"));
});
