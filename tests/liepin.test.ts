// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { detailJobSchema } from "../src/domain/messages";
import {
  detectLiepinBlockedPage,
  executeLiepinReviewedSend,
  extractLiepinDetail,
  isLiepinListPage,
  preflightLiepinReviewedSend,
  scanLiepinList
} from "../src/platforms/liepin";

describe("Liepin list extraction", () => {
  it("accepts explicit public and candidate-home list routes only", () => {
    const locationAt = (hostname: string, pathname: string) => ({ hostname, pathname }) as Location;
    expect(isLiepinListPage(locationAt("www.liepin.com", "/zhaopin/"))).toBe(true);
    expect(isLiepinListPage(locationAt("c.liepin.com", "/"))).toBe(true);
    expect(isLiepinListPage(locationAt("c.liepin.com", "/job/record/apply"))).toBe(false);
    expect(isLiepinListPage(locationAt("example.com", "/zhaopin/"))).toBe(false);
  });

  it("deduplicates and extracts semantic card fields", () => {
    document.body.innerHTML = `<div class="job-card-pc-container"><div class="job-detail-box"><a href="https://www.liepin.com/a/79104715.shtml?ckId=x"><div><div title="招聘医疗AI Agent业务研发工程师">医疗AI Agent业务研发工程师</div><span>【</span><span>北京</span><span>】</span><span>30-45k·16薪</span></div><div><span>3-5年</span><span>统招本科</span></div></a><div data-nick="job-detail-company-info"><span>示例医疗公司</span><span>医疗</span></div></div><div class="recruiter-info-box">刘先生·猎头顾问</div></div>`;
    const items = scanLiepinList();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ jobId: "79104715", title: "医疗AI Agent业务研发工程师", company: "示例医疗公司", location: "北京", salary: "30-45k·16薪", experience: "3-5年", education: "统招本科" });
    expect(items[0]!.canonicalUrl).toBe("https://www.liepin.com/a/79104715.shtml");
  });

  it("extracts synthetic candidate-home cards without interacting with the page", () => {
    document.body.innerHTML = `
      <main class="candidate-home">
        <article class="job-card-pc-container">
          <div class="job-detail-box">
            <a href="https://www.liepin.com/job/1980000101.shtml?from=c-home">
              <div><strong title="招聘合成智能体工程师">合成智能体工程师</strong><span>【 北京-昌平区 】</span><em>25-40k·16薪</em></div>
              <div><span>3-5年</span><span>本科</span></div>
            </a>
            <div data-nick="job-detail-company-info"><span>合成智能科技公司</span><span>软件服务</span></div>
          </div>
        </article>
      </main>`;
    const items = scanLiepinList();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      jobId: "1980000101",
      title: "合成智能体工程师",
      company: "合成智能科技公司",
      location: "北京-昌平区",
      salary: "25-40k·16薪",
      experience: "3-5年",
      education: "本科"
    });
  });
  it("extracts the current live Liepin detail shape even when the title is not an h1", () => {
    document.title = "【北京 高级Android开发工程师招聘】-合成点云科技有限公司北京招聘信息-猎聘";
    document.body.innerHTML = "<div class=\"job-properties\">北京-海淀区 3-5年 统招本科 招1人</div><div>林女士 3天前在线 已认证</div><div>HRBP · 合成点云科技有限公司</div><div class=\"job-intro-container\"><div class=\"paragraph\">职位介绍 岗位职责 负责AI Agent客户端核心功能开发。任职要求 精通Android与Kotlin。</div></div>";
    const item = extractLiepinDetail(document, "https://www.liepin.com/job/1980000001.shtml");
    expect(item).toMatchObject({ jobId: "1980000001", title: "高级Android开发工程师", company: "合成点云科技有限公司", location: "北京-海淀区", experience: "3-5年", education: "统招本科", recruiter: "林女士", recruiterTitle: "HRBP" });
    expect(() => detailJobSchema.parse(item)).not.toThrow();
    expect(item?.index).toBe(0);
  });
  it("classifies login and risk-control pages without bypassing them", () => {
    document.body.innerHTML = "<main>请先登录，登录后查看职位详情</main>";
    expect(detectLiepinBlockedPage()).toBe("login_required");
    document.body.innerHTML = "<main>访问异常，请完成安全验证并拖动滑块</main>";
    expect(detectLiepinBlockedPage()).toBe("risk_control");
    document.body.innerHTML = "<main>当前访问需要完成验证</main>";
    expect(detectLiepinBlockedPage(document, {
      hostname: "safe.liepin.com",
      pathname: "/v/intercept/verifysms"
    } as Location)).toBe("risk_control");
    document.title = "安全中心-风险提示";
    document.body.innerHTML = "<main>当前访问需要完成验证</main>";
    expect(detectLiepinBlockedPage(document, {
      hostname: "www.liepin.com",
      pathname: "/a/1980000999.shtml"
    } as Location)).toBe("risk_control");
    document.title = "";
  });

  it("classifies a paused recruitment page as permanently unavailable", () => {
    document.body.innerHTML = `
      <main>
        <header class="stop-apply-header">该职位已暂停招聘</header>
        <section class="recommendations">投递过该职位的人还浏览了其他合成职位</section>
      </main>`;

    expect(detectLiepinBlockedPage()).toBe("job_unavailable");
    expect(extractLiepinDetail(document, "https://www.liepin.com/job/1980000999.shtml")).toBeNull();
    expect(preflightLiepinReviewedSend(
      document,
      "https://www.liepin.com/job/1980000999.shtml",
      "1980000999"
    )).toMatchObject({ ok: false, blocker: "job_unavailable", reason: "猎聘职位已暂停招聘或不可用" });
  });

  it("preflights exactly one primary reviewed-send action without interacting", () => {
    let clicked = 0;
    document.body.innerHTML = `
      <main>
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
        <a class="btn-chat" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
      </main>`;
    document.querySelector(".btn-main")?.addEventListener("click", () => {
      clicked += 1;
    });
    expect(preflightLiepinReviewedSend(document, "https://www.liepin.com/a/1980000301.shtml", "1980000301"))
      .toMatchObject({ ok: true, actionTier: "primary", resumeMode: "platform_default" });
    expect(clicked).toBe(0);
  });

  it("binds a full Liepin URL job ID to its verified eight-digit action suffix", () => {
    document.body.innerHTML = `
      <main>
        <a class="btn-main" data-selector="chat-chat" data-jobid="80000301">聊一聊</a>
        <button class="ant-btn" data-selector="chat-chat" data-jobid="89999999">聊一聊</button>
      </main>`;

    expect(preflightLiepinReviewedSend(
      document,
      "https://www.liepin.com/job/1980000301.shtml",
      "1980000301"
    )).toMatchObject({ ok: true, actionTier: "primary" });
    expect(preflightLiepinReviewedSend(
      document,
      "https://www.liepin.com/job/1980000302.shtml",
      "1980000302"
    )).toMatchObject({ ok: false, blocker: "missing_action" });
  });

  it("fails closed for ambiguous selected-tier actions and resume pickers", () => {
    document.body.innerHTML = `
      <main>
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
      </main>`;
    expect(preflightLiepinReviewedSend(document, "https://www.liepin.com/a/1980000301.shtml", "1980000301"))
      .toMatchObject({ ok: false, blocker: "ambiguous_action" });
    document.body.innerHTML = `
      <main>
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
        <section>请选择简历 合成简历 A 合成简历 B</section>
      </main>`;
    expect(preflightLiepinReviewedSend(document, "https://www.liepin.com/a/1980000301.shtml", "1980000301"))
      .toMatchObject({ ok: false, blocker: "ambiguous_resume" });
  });

  it("executes one reviewed action, sends a greeting, and verifies only rendered outbound evidence", async () => {
    const draft = "您好，我关注到这个合成智能体岗位，过往做过 TypeScript 任务平台和稳定性建设，想进一步沟通匹配度。";
    document.body.innerHTML = `
      <main>
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
        <section id="chat"></section>
      </main>`;
    document.querySelector(".btn-main")?.addEventListener("click", (event) => {
      event.preventDefault();
      document.querySelector("#chat")!.innerHTML = `
        <div data-jobid="1980000301">已投递 1980000301</div>
        <textarea></textarea>
        <button>发送</button>`;
      document.querySelector("button")?.addEventListener("click", () => {
        const text = (document.querySelector("textarea") as HTMLTextAreaElement).value;
        const bubble = document.createElement("div");
        bubble.className = "outgoing-row";
        bubble.textContent = text;
        document.querySelector("#chat")?.append(bubble);
      });
    });
    const result = await executeLiepinReviewedSend(document, "https://www.liepin.com/a/1980000301.shtml", "1980000301", draft);
    expect(result).toMatchObject({
      ok: true,
      application: "verified",
      greeting: "verified"
    });
    expect(result.evidenceCodes).toEqual(expect.arrayContaining([
      "application_status_verified",
      "outbound_greeting_exact_match"
    ]));
  });

  it("does not fill or resend a greeting that is already verified", async () => {
    let sendClicks = 0;
    document.body.innerHTML = `
      <main>
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
        <section id="chat"></section>
      </main>`;
    document.querySelector(".btn-main")?.addEventListener("click", () => {
      document.querySelector("#chat")!.innerHTML = `
        <div data-jobid="1980000301">已投递 1980000301</div>
        <textarea></textarea>
        <button>发送</button>`;
      document.querySelector("button")?.addEventListener("click", () => {
        sendClicks += 1;
      });
    });
    const result = await executeLiepinReviewedSend(
      document,
      "https://www.liepin.com/a/1980000301.shtml",
      "1980000301",
      "这条已验证招呼语不应重复发送。",
      true,
      false
    );
    expect(result).toMatchObject({ application: "verified", greeting: "verified" });
    expect(sendClicks).toBe(0);
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("uses only the newly opened chat surface and never fills an existing page input", async () => {
    const draft = "您好，这是一条只允许写入新聊天面板的合成招呼语。";
    document.body.innerHTML = `
      <input id="page-search" type="text">
      <button id="page-send">发送</button>
      <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
      <section id="chat-host"></section>`;
    let pageSendClicks = 0;
    let chatSendClicks = 0;
    document.querySelector("#page-send")?.addEventListener("click", () => { pageSendClicks += 1; });
    document.querySelector(".btn-main")?.addEventListener("click", () => {
      document.querySelector("#chat-host")!.innerHTML = `
        <section class="chat-panel">
          <div data-jobid="1980000301">已投递 1980000301</div>
          <textarea class="chat-composer"></textarea>
          <button class="chat-send">发送</button>
        </section>`;
      document.querySelector(".chat-send")?.addEventListener("click", () => {
        chatSendClicks += 1;
        const bubble = document.createElement("div");
        bubble.className = "message-self";
        bubble.textContent = (document.querySelector(".chat-composer") as HTMLTextAreaElement).value;
        document.querySelector(".chat-panel")?.append(bubble);
      });
    });

    const result = await executeLiepinReviewedSend(
      document,
      "https://www.liepin.com/a/1980000301.shtml",
      "1980000301",
      draft
    );

    expect(result.greeting).toBe("verified");
    expect((document.querySelector("#page-search") as HTMLInputElement).value).toBe("");
    expect(pageSendClicks).toBe(0);
    expect(chatSendClicks).toBe(1);
  });

  it("uses the current Liepin IM composer and send-control classes", async () => {
    vi.useFakeTimers();
    try {
      const draft = "您好，这是一条发送到猎聘专属 IM 编辑器的合成招呼语。";
      document.body.innerHTML = `
        <input id="page-search" type="text">
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
        <section id="chat-host"></section>`;
      let sendClicks = 0;
      document.querySelector(".btn-main")?.addEventListener("click", () => {
        document.querySelector("#chat-host")!.innerHTML = `
          <section class="im-ui-chat-input">
            <div data-jobid="1980000301">简历已发送 1980000301</div>
            <input class="emoji-search" type="text">
            <textarea class="im-ui-textarea"></textarea>
            <div class="im-ui-basic-send-btn">发送</div>
            <div class="messages"></div>
          </section>`;
        document.querySelector(".im-ui-basic-send-btn")?.addEventListener("click", () => {
          sendClicks += 1;
          const bubble = document.createElement("div");
          bubble.className = "message-self";
          bubble.textContent = (document.querySelector(".im-ui-textarea") as HTMLTextAreaElement).value;
          document.querySelector(".messages")?.append(bubble);
        });
      });

      const execution = executeLiepinReviewedSend(
        document,
        "https://www.liepin.com/a/1980000301.shtml",
        "1980000301",
        draft
      );
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await execution;

      expect(result).toMatchObject({ ok: true, application: "verified", greeting: "verified" });
      expect((document.querySelector("#page-search") as HTMLInputElement).value).toBe("");
      expect((document.querySelector(".emoji-search") as HTMLInputElement).value).toBe("");
      expect(sendClicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("finds a Liepin IM surface mounted in an open shadow root", async () => {
    vi.useFakeTimers();
    try {
      const draft = "您好，这是一条发送到 Shadow DOM 聊天编辑器的合成招呼语。";
      document.body.innerHTML = `
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
        <div id="im-host"></div>`;
      let sendClicks = 0;
      document.querySelector(".btn-main")?.addEventListener("click", () => {
        const shadow = document.querySelector("#im-host")!.attachShadow({ mode: "open" });
        shadow.innerHTML = `
          <section class="im-ui-chat-input">
            <div data-jobid="1980000301">简历已发送 1980000301</div>
            <textarea class="im-ui-textarea"></textarea>
            <button class="im-ui-basic-send-btn">发送</button>
            <div class="messages"></div>
          </section>`;
        shadow.querySelector(".im-ui-basic-send-btn")?.addEventListener("click", () => {
          sendClicks += 1;
          const bubble = shadow.ownerDocument.createElement("div");
          bubble.className = "message-self";
          bubble.textContent = (shadow.querySelector(".im-ui-textarea") as HTMLTextAreaElement).value;
          shadow.querySelector(".messages")?.append(bubble);
        });
      });

      const execution = executeLiepinReviewedSend(
        document,
        "https://www.liepin.com/a/1980000301.shtml",
        "1980000301",
        draft
      );
      await vi.advanceTimersByTimeAsync(16_000);
      const result = await execution;

      expect(result).toMatchObject({ ok: true, application: "verified", greeting: "verified" });
      expect(sendClicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("finds a same-origin Liepin IM surface mounted in an iframe", async () => {
    vi.useFakeTimers();
    try {
      const draft = "您好，这是一条发送到同源 iframe 聊天编辑器的合成招呼语。";
      document.body.innerHTML = `
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
        <iframe id="im-frame"></iframe>`;
      const frame = document.querySelector("#im-frame") as HTMLIFrameElement;
      const frameDocument = frame.contentDocument!;
      let sendClicks = 0;
      document.querySelector(".btn-main")?.addEventListener("click", () => {
        frameDocument.body.innerHTML = `
          <section class="im-ui-chat-input">
            <div data-jobid="1980000301">简历已发送 1980000301</div>
            <textarea class="im-ui-textarea"></textarea>
            <button class="im-ui-basic-send-btn">发送</button>
            <div class="messages"></div>
          </section>`;
        frameDocument.querySelector(".im-ui-basic-send-btn")?.addEventListener("click", () => {
          sendClicks += 1;
          const bubble = frameDocument.createElement("div");
          bubble.className = "message-self";
          bubble.textContent = (frameDocument.querySelector(".im-ui-textarea") as HTMLTextAreaElement).value;
          frameDocument.querySelector(".messages")?.append(bubble);
        });
      });

      const execution = executeLiepinReviewedSend(
        document,
        "https://www.liepin.com/a/1980000301.shtml",
        "1980000301",
        draft
      );
      await vi.advanceTimersByTimeAsync(16_000);
      const result = await execution;

      expect(result).toMatchObject({ ok: true, application: "verified", greeting: "verified" });
      expect(sendClicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("finds a visible chat surface while its send button is disabled", async () => {
    vi.useFakeTimers();
    try {
      const draft = "您好，这是一条发送到暂时禁用发送按钮的合成聊天编辑器的招呼语。";
      document.body.innerHTML = `
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
        <section id="chat-host"></section>`;
      let sendClicks = 0;
      document.querySelector(".btn-main")?.addEventListener("click", () => {
        document.querySelector("#chat-host")!.innerHTML = `
          <section class="im-ui-chat-input">
            <div data-jobid="1980000301">简历已发送 1980000301</div>
            <textarea class="im-ui-textarea"></textarea>
            <button class="im-ui-basic-send-btn" disabled style="pointer-events: none">发送</button>
            <div class="messages"></div>
          </section>`;
        document.querySelector(".im-ui-textarea")?.addEventListener("input", () => {
          const send = document.querySelector(".im-ui-basic-send-btn") as HTMLButtonElement;
          send.disabled = false;
          send.style.pointerEvents = "auto";
        });
        document.querySelector(".im-ui-basic-send-btn")?.addEventListener("click", () => {
          sendClicks += 1;
          const bubble = document.createElement("div");
          bubble.className = "message-self";
          bubble.textContent = (document.querySelector(".im-ui-textarea") as HTMLTextAreaElement).value;
          document.querySelector(".messages")?.append(bubble);
        });
      });

      const execution = executeLiepinReviewedSend(
        document,
        "https://www.liepin.com/a/1980000301.shtml",
        "1980000301",
        draft
      );
      await vi.advanceTimersByTimeAsync(16_000);
      const result = await execution;

      expect(result).toMatchObject({ ok: true, application: "verified", greeting: "verified" });
      expect(sendClicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("verifies an outbound greeting rendered beside the chat input", async () => {
    const draft = "您好，这是一条渲染在消息列表中的合成招呼语。";
    let sendClicks = 0;
    document.body.innerHTML = `
      <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
      <section id="chat-host"></section>`;
    document.querySelector(".btn-main")?.addEventListener("click", () => {
      document.querySelector("#chat-host")!.innerHTML = `
        <section class="im-ui-chat-container">
          <div class="im-ui-message-list-wrapper"><div class="messages"></div></div>
          <section class="im-ui-chat-input">
            <div data-jobid="1980000301">简历已发送 1980000301</div>
            <textarea class="im-ui-textarea"></textarea>
            <button class="im-ui-basic-send-btn">发送</button>
          </section>
        </section>`;
      document.querySelector(".im-ui-basic-send-btn")?.addEventListener("click", () => {
        sendClicks += 1;
        const bubble = document.createElement("div");
        bubble.className = "message-self";
        bubble.textContent = (document.querySelector(".im-ui-textarea") as HTMLTextAreaElement).value;
        document.querySelector(".messages")?.append(bubble);
      });
    });

    const result = await executeLiepinReviewedSend(
      document,
      "https://www.liepin.com/a/1980000301.shtml",
      "1980000301",
      draft
    );

    expect(result).toMatchObject({ ok: true, application: "verified", greeting: "verified" });
    expect(result.evidenceCodes).toContain("outbound_greeting_exact_match");
    expect(sendClicks).toBe(1);
  });

  it("waits for a delayed outbound message and joins split text nodes", async () => {
    vi.useFakeTimers();
    try {
      const draft = "您好，这是一条在异步消息列表中分段渲染的合成招呼语。";
      let sendClicks = 0;
      document.body.innerHTML = `
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
        <section id="chat-host"></section>`;
      document.querySelector(".btn-main")?.addEventListener("click", () => {
        document.querySelector("#chat-host")!.innerHTML = `
          <section class="im-ui-chat-container">
            <div data-jobid="1980000301">简历已发送 1980000301</div>
            <div class="im-ui-message-list-wrapper"><div class="messages"></div></div>
            <section class="im-ui-chat-input">
              <textarea class="im-ui-textarea"></textarea>
              <button class="im-ui-basic-send-btn">发送</button>
            </section>
          </section>`;
        document.querySelector(".im-ui-basic-send-btn")?.addEventListener("click", () => {
          sendClicks += 1;
          setTimeout(() => {
            const bubble = document.createElement("div");
            bubble.className = "im-ui-txt im-ui-send";
            bubble.innerHTML = `<span>您好，这是一条在异步消息列表中分段渲染的</span><span>合成招呼语。</span>`;
            document.querySelector(".messages")?.append(bubble);
          }, 6_000);
        });
      });

      const execution = executeLiepinReviewedSend(
        document,
        "https://www.liepin.com/a/1980000301.shtml",
        "1980000301",
        draft
      );
      await vi.advanceTimersByTimeAsync(16_000);
      const result = await execution;

      expect(result).toMatchObject({ ok: true, application: "verified", greeting: "verified" });
      expect(result.evidenceCodes).toContain("outbound_greeting_exact_match");
      expect(sendClicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recognizes an existing exact outbound greeting without sending it again", async () => {
    const draft = "您好，这是一条已经存在于当前会话中的合成招呼语。";
    let sendClicks = 0;
    document.body.innerHTML = `
      <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">继续聊</a>
      <section class="im-ui-chat-container">
        <div data-jobid="1980000301">简历已发送 1980000301</div>
        <div class="im-ui-message-list-wrapper">
          <div class="messages"><div data-direction="outgoing"><span>${draft}</span></div></div>
        </div>
        <section class="im-ui-chat-input">
          <textarea class="im-ui-textarea"></textarea>
          <button class="im-ui-basic-send-btn">发送</button>
        </section>
      </section>`;
    document.querySelector(".im-ui-basic-send-btn")?.addEventListener("click", () => { sendClicks += 1; });

    const result = await executeLiepinReviewedSend(
      document,
      "https://www.liepin.com/a/1980000301.shtml",
      "1980000301",
      draft
    );

    expect(result).toMatchObject({ ok: true, application: "verified", greeting: "verified" });
    expect(result.evidenceCodes).toContain("outbound_greeting_exact_match");
    expect(sendClicks).toBe(0);
    expect((document.querySelector(".im-ui-textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("does not treat an inbound message with the same text as outbound evidence", async () => {
    vi.useFakeTimers();
    try {
      const draft = "您好，这是一条由招聘方发来的同文消息，不能作为我的发送证据。";
      let sendClicks = 0;
      document.body.innerHTML = `
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">继续聊</a>
        <section class="im-ui-chat-container">
          <div data-jobid="1980000301">简历已发送 1980000301</div>
          <div class="im-ui-message-list-wrapper">
            <div class="messages"><div data-direction="incoming"><span>${draft}</span></div></div>
          </div>
          <section class="im-ui-chat-input">
            <textarea class="im-ui-textarea"></textarea>
            <button class="im-ui-basic-send-btn">发送</button>
          </section>
        </section>`;
      document.querySelector(".im-ui-basic-send-btn")?.addEventListener("click", () => { sendClicks += 1; });

      const execution = executeLiepinReviewedSend(
        document,
        "https://www.liepin.com/a/1980000301.shtml",
        "1980000301",
        draft
      );
      await vi.advanceTimersByTimeAsync(16_000);
      const result = await execution;

      expect(result.greeting).toBe("attempted");
      expect(result.ok).toBe(false);
      expect(sendClicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the remote Liepin IM surface to load for longer than four seconds", async () => {
    vi.useFakeTimers();
    try {
      const draft = "您好，这是一条等待远程聊天组件加载后发送的合成招呼语。";
      document.body.innerHTML = `
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
        <section id="chat-host"></section>`;
      document.querySelector(".btn-main")?.addEventListener("click", () => {
        setTimeout(() => {
          document.querySelector("#chat-host")!.innerHTML = `
            <section class="chat-panel">
              <div data-jobid="1980000301">简历已发送 1980000301</div>
              <textarea class="chat-composer"></textarea>
              <button class="chat-send">发送</button>
              <div class="messages"></div>
            </section>`;
          document.querySelector(".chat-send")?.addEventListener("click", () => {
            const bubble = document.createElement("div");
            bubble.className = "message-self";
            bubble.textContent = (document.querySelector(".chat-composer") as HTMLTextAreaElement).value;
            document.querySelector(".messages")?.append(bubble);
          });
        }, 5_000);
      });

      const execution = executeLiepinReviewedSend(
        document,
        "https://www.liepin.com/a/1980000301.shtml",
        "1980000301",
        draft
      );
      await vi.advanceTimersByTimeAsync(16_000);

      await expect(execution).resolves.toMatchObject({ ok: true, application: "verified", greeting: "verified" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns after the automatic send click without waiting for greeting read-back", async () => {
    vi.useFakeTimers();
    try {
      const draft = "您好，这是一条按点击成功计入的自动批次合成招呼语。";
      let sendClicks = 0;
      document.body.innerHTML = `
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
        <section id="chat-host"></section>`;
      document.querySelector(".btn-main")?.addEventListener("click", () => {
        document.querySelector("#chat-host")!.innerHTML = `
          <section class="im-ui-chat-container">
            <div data-jobid="1980000301">简历已发送 1980000301</div>
            <section class="im-ui-chat-input">
              <textarea class="im-ui-textarea"></textarea>
              <button class="im-ui-basic-send-btn">发送</button>
            </section>
          </section>`;
        document.querySelector(".im-ui-basic-send-btn")?.addEventListener("click", () => { sendClicks += 1; });
      });

      const execution = executeLiepinReviewedSend(
        document,
        "https://www.liepin.com/a/1980000301.shtml",
        "1980000301",
        draft,
        true,
        true,
        true
      );
      await vi.advanceTimersByTimeAsync(2_500);
      const result = await execution;

      expect(result).toMatchObject({ ok: false, application: "verified", greeting: "attempted" });
      expect(result.evidenceCodes).toContain("outbound_greeting_unverified");
      expect(sendClicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reuse a chat surface hidden by an ancestor before the action opens it", async () => {
    const draft = "您好，这是一条只发送到已经打开的可见会话中的合成招呼语。";
    let actionClicks = 0;
    document.body.innerHTML = `
      <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
      <section class="chat-panel" style="display: none">
        <div data-jobid="1980000301">简历已发送 1980000301</div>
        <textarea class="chat-composer"></textarea>
        <button class="chat-send">发送</button>
        <div class="messages"></div>
      </section>`;
    document.querySelector(".btn-main")?.addEventListener("click", () => {
      actionClicks += 1;
      (document.querySelector(".chat-panel") as HTMLElement).style.display = "block";
    });
    document.querySelector(".chat-send")?.addEventListener("click", () => {
      const bubble = document.createElement("div");
      bubble.className = "message-self";
      bubble.textContent = (document.querySelector(".chat-composer") as HTMLTextAreaElement).value;
      document.querySelector(".messages")?.append(bubble);
    });

    const result = await executeLiepinReviewedSend(
      document,
      "https://www.liepin.com/a/1980000301.shtml",
      "1980000301",
      draft
    );

    expect(result).toMatchObject({ ok: true, application: "verified", greeting: "verified" });
    expect(actionClicks).toBe(1);
  });

  it("does not count a conversation-only state as formal application evidence", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
        <section id="state"></section>`;
      document.querySelector(".btn-main")?.addEventListener("click", () => {
        document.querySelector("#state")!.innerHTML = '<div data-jobid="1980000301">已沟通 1980000301</div>';
      });

      const execution = executeLiepinReviewedSend(
        document,
        "https://www.liepin.com/a/1980000301.shtml",
        "1980000301",
        "合成招呼语",
        true,
        false
      );
      await vi.advanceTimersByTimeAsync(16_000);
      const result = await execution;

      expect(result.application).toBe("attempted");
      expect(result.ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a distinct application click marker only after the final resume submit control is clicked", async () => {
    vi.useFakeTimers();
    try {
      let applicationClicks = 0;
      document.body.innerHTML = `
        <section class="resume-dialog">
          <h2>选择附件简历</h2>
          <label><input type="radio" name="resume" checked>合成附件简历</label>
          <button>立即投递</button>
        </section>
        <section class="im-ui-chat-container">
          <section class="im-ui-chat-input">
            <textarea class="im-ui-textarea"></textarea>
            <button class="im-ui-basic-send-btn">发送</button>
          </section>
        </section>`;
      document.querySelector(".resume-dialog button")?.addEventListener("click", () => { applicationClicks += 1; });

      const execution = executeLiepinReviewedSend(
        document,
        "https://www.liepin.com/a/1980000301.shtml",
        "1980000301",
        "不应在没有页面回读时重复提交的合成招呼语",
        true,
        false
      );
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await execution;

      expect(result.application).toBe("attempted");
      expect(result.evidenceCodes).toContain("application_submit_clicked");
      expect(applicationClicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops after the native action when resume selection becomes ambiguous", async () => {
    let sendClicks = 0;
    document.body.innerHTML = `
      <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
      <section id="chat"></section>`;
    document.querySelector(".btn-main")?.addEventListener("click", () => {
      document.querySelector("#chat")!.innerHTML = `
        <div>请选择简历</div><div class="resume-option">合成简历 A</div><div class="resume-option">合成简历 B</div>
        <textarea></textarea><button>发送</button>`;
      document.querySelector("button")?.addEventListener("click", () => { sendClicks += 1; });
    });

    const result = await executeLiepinReviewedSend(
      document,
      "https://www.liepin.com/a/1980000301.shtml",
      "1980000301",
      "不应发送的合成招呼语"
    );

    expect(result.greeting).toBe("failed");
    expect(result.evidenceCodes).toContain("ambiguous_resume");
    expect(sendClicks).toBe(0);
  });

  it("reuses an open chat, sends the default resume, and does not click chat again", async () => {
    const draft = "您好，这是复用现有聊天窗口后发送的合成招呼语。";
    let chatActionClicks = 0;
    let resumeClicks = 0;
    let sendClicks = 0;
    document.body.innerHTML = `
      <main>
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
        <section class="chat-panel">
          <div class="resume-action"><span>发简历</span></div>
          <textarea class="chat-composer"></textarea>
          <button class="chat-send" disabled>发送</button>
          <div class="messages"></div>
        </section>
      </main>`;
    document.querySelector(".btn-main")?.addEventListener("click", () => { chatActionClicks += 1; });
    document.querySelector(".resume-action span")?.addEventListener("click", () => {
      resumeClicks += 1;
      const evidence = document.createElement("div");
      evidence.dataset.jobid = "1980000301";
      evidence.textContent = "简历已发送 1980000301";
      document.querySelector(".messages")?.append(evidence);
    });
    document.querySelector(".chat-composer")?.addEventListener("input", () => {
      (document.querySelector(".chat-send") as HTMLButtonElement).disabled = false;
    });
    document.querySelector(".chat-send")?.addEventListener("click", () => {
      sendClicks += 1;
      const bubble = document.createElement("div");
      bubble.className = "outgoing-row";
      bubble.textContent = (document.querySelector(".chat-composer") as HTMLTextAreaElement).value;
      document.querySelector(".messages")?.append(bubble);
    });

    const result = await executeLiepinReviewedSend(
      document,
      "https://www.liepin.com/a/1980000301.shtml",
      "1980000301",
      draft
    );

    expect(result).toMatchObject({ ok: true, application: "verified", greeting: "verified" });
    expect(result.evidenceCodes).toContain("chat_surface_reused");
    expect(chatActionClicks).toBe(0);
    expect(resumeClicks).toBe(1);
    expect(sendClicks).toBe(1);
  });

  it("resumes from one selected attachment and verifies the immediate application", async () => {
    let applicationClicks = 0;
    document.body.innerHTML = `
      <section class="resume-dialog">
        <h2>选择附件简历</h2>
        <p>招聘方将同时收到您的默认在线简历和附件简历</p>
        <label><input type="radio" name="resume" checked>合成附件简历</label>
        <button>立即投递</button>
      </section>
      <section class="chat-messages"></section>`;
    document.querySelector("button")?.addEventListener("click", () => {
      applicationClicks += 1;
      document.querySelector(".resume-dialog")?.remove();
      const evidence = document.createElement("div");
      evidence.textContent = "简历已发送";
      document.querySelector(".chat-messages")?.append(evidence);
    });

    expect(preflightLiepinReviewedSend(
      document,
      "https://www.liepin.com/a/1980000301.shtml",
      "1980000301"
    )).toMatchObject({ ok: true, actionTier: "application_confirmation" });

    const result = await executeLiepinReviewedSend(
      document,
      "https://www.liepin.com/a/1980000301.shtml",
      "1980000301",
      "已经发送过的合成招呼语",
      true,
      false
    );

    expect(result).toMatchObject({ ok: true, application: "verified", greeting: "verified" });
    expect(applicationClicks).toBe(1);
  });

  it("verifies an existing job-bound resume card without sending the resume again", async () => {
    let resumeClicks = 0;
    document.body.innerHTML = `
      <main>
        <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">继续聊</a>
        <section class="chat-panel">
          <div class="messages"><div>这是我的简历，合适的话可以随时联系我</div><div>在线简历</div><div>附件简历</div></div>
          <div class="resume-action"><span>发简历</span></div>
          <textarea></textarea><button disabled>发送</button>
        </section>
      </main>`;
    document.querySelector(".resume-action span")?.addEventListener("click", () => { resumeClicks += 1; });

    const result = await executeLiepinReviewedSend(
      document,
      "https://www.liepin.com/a/1980000301.shtml",
      "1980000301",
      "已经发送过的合成招呼语",
      true,
      false
    );

    expect(result).toMatchObject({ ok: true, application: "verified", greeting: "verified" });
    expect(result.evidenceCodes).toContain("chat_surface_reused");
    expect(resumeClicks).toBe(0);
  });
});
