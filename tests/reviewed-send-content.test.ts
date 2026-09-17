// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.liepin.com/a/1980000301.shtml"}

import { beforeEach, expect, it, vi } from "vitest";

type ContentListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean;

let listener: ContentListener | undefined;
let actionClicks = 0;

async function loadContent(): Promise<void> {
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi.fn(async () => ({ ok: true, data: false })),
      onMessage: { addListener: vi.fn((value: ContentListener) => { listener = value; }) }
    }
  });
  await import("../src/content/liepin");
  expect(listener).toBeTypeOf("function");
}

function dispatch(message: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    listener?.(message, {} as chrome.runtime.MessageSender, (response) => {
      resolve(response as Record<string, unknown>);
    });
  });
}

beforeEach(() => {
  vi.resetModules();
  listener = undefined;
  actionClicks = 0;
  document.body.innerHTML = `
    <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
    <section id="chat"></section>`;
  document.querySelector(".btn-main")?.addEventListener("click", () => { actionClicks += 1; });
});

it("rejects execute commands that were not unlocked by the same successful preflight lease", async () => {
  await loadContent();
  const execute = (leaseId: string, draftSha256 = "a".repeat(64)) => dispatch({
    type: "CONTENT_REVIEWED_SEND_EXECUTE",
    leaseId,
    platformJobId: "1980000301",
    draftText: "合成招呼语",
    draftSha256,
    needsApplication: true,
    needsGreeting: true
  });

  expect(await execute("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"))
    .toMatchObject({ ok: false, reason: expect.stringContaining("检查") });
  expect(actionClicks).toBe(0);

  expect(await dispatch({
    type: "CONTENT_REVIEWED_SEND_PREFLIGHT",
    leaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    platformJobId: "1980000301"
  })).toMatchObject({ ok: true });
  expect(await execute("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"))
    .toMatchObject({ ok: false, reason: expect.stringContaining("草稿") });
  expect(actionClicks).toBe(0);
  expect(await execute("cccccccc-cccc-4ccc-8ccc-cccccccccccc"))
    .toMatchObject({ ok: false, reason: expect.stringContaining("检查") });
  expect(actionClicks).toBe(0);
});

it("waits for a delayed Liepin action before completing content preflight", async () => {
  await loadContent();
  document.querySelector(".btn-main")?.remove();
  setTimeout(() => {
    const action = document.createElement("button");
    action.className = "btn-main";
    action.dataset.selector = "chat-chat";
    action.dataset.jobid = "1980000301";
    action.textContent = "聊一聊";
    document.body.append(action);
  }, 100);

  const result = await dispatch({
    type: "CONTENT_REVIEWED_SEND_PREFLIGHT",
    leaseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    platformJobId: "1980000301"
  });

  expect(result).toMatchObject({
    ok: true,
    platformJobId: "1980000301",
    actionTier: "primary"
  });
});
