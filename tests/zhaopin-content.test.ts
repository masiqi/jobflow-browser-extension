// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.zhaopin.com/jobdetail/CCL1501502560J40877030814.htm#jobflow-lease=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}

import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "https://www.zhaopin.com/jobdetail/CCL1501502560J40877030814.htm#jobflow-lease=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  document.title = "AI 平台工程师-北京招聘信息-智联招聘";
  document.body.innerHTML = `
    <h1 class="job-header__title">AI 平台工程师</h1>
    <div class="job-header__info">北京 20-30K 3-5年 本科</div>
    <div class="companyinfo__name">合成智联科技公司</div>
    <section><h2>职位描述</h2><div>负责高可用任务平台研发和稳定性建设，参与服务治理与工程效率改进。</div></section>`;
});
it("reports leased detail content through the shared read-only handshake", async () => {
  const sendMessage = vi.fn(async (request: { type: string }) => {
    if (request.type === "GET_LAUNCHER_VISIBILITY") return { ok: true, data: false };
    if (request.type === "DETAIL_READY") return { ok: true };
    return { ok: true };
  });
  const addListener = vi.fn();
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: { addListener }
    }
  });

  await import("../src/content/zhaopin");

  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: "DETAIL_READY",
    leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    job: expect.objectContaining({
      platform: "zhaopin",
      jobId: "CCL1501502560J40877030814"
    })
  })));
  const source = await import("node:fs/promises").then(({ readFile }) => readFile("src/content/zhaopin.ts", "utf8"));
  expect(source).not.toContain("CONTENT_REVIEWED_SEND_EXECUTE");
  expect(source).not.toContain("CONTENT_REVIEWED_SEND_PREFLIGHT");
});
