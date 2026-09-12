// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
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

  it("does not count a conversation-only state as formal application evidence", async () => {
    document.body.innerHTML = `
      <a class="btn-main" data-selector="chat-chat" data-jobid="1980000301">聊一聊</a>
      <section id="state"></section>`;
    document.querySelector(".btn-main")?.addEventListener("click", () => {
      document.querySelector("#state")!.innerHTML = '<div data-jobid="1980000301">已沟通 1980000301</div>';
    });

    const result = await executeLiepinReviewedSend(
      document,
      "https://www.liepin.com/a/1980000301.shtml",
      "1980000301",
      "合成招呼语",
      true,
      false
    );

    expect(result.application).toBe("attempted");
    expect(result.ok).toBe(false);
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
