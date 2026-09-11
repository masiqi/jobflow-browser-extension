// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.liepin.com/a/1980000301.shtml#jobflow-lease=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}

import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  document.title = "【北京 合成智能体工程师招聘】-合成科技北京招聘信息-猎聘";
  document.body.innerHTML = `
    <div class="job-properties">北京-海淀区 3-5年 本科 招1人</div>
    <div class="job-title">合成智能体工程师</div>
    <div class="company-name">合成科技</div>
    <div class="job-intro-container"><div class="paragraph">职位介绍 岗位职责 负责合成智能体平台研发、任务编排和稳定性建设。任职要求 熟悉 TypeScript 与分布式系统。</div></div>`;
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
