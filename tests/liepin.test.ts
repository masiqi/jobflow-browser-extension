// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractLiepinDetail, scanLiepinList } from "../src/platforms/liepin";

describe("Liepin list extraction", () => {
  it("deduplicates and extracts semantic card fields", () => {
    document.body.innerHTML = `<div class="job-card-pc-container"><div class="job-detail-box"><a href="https://www.liepin.com/a/79104715.shtml?ckId=x"><div><div title="招聘医疗AI Agent业务研发工程师">医疗AI Agent业务研发工程师</div><span>【</span><span>北京</span><span>】</span><span>30-45k·16薪</span></div><div><span>3-5年</span><span>统招本科</span></div></a><div data-nick="job-detail-company-info"><span>示例医疗公司</span><span>医疗</span></div></div><div class="recruiter-info-box">刘先生·猎头顾问</div></div>`;
    const items = scanLiepinList();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ jobId: "79104715", title: "医疗AI Agent业务研发工程师", company: "示例医疗公司", location: "北京", salary: "30-45k·16薪", experience: "3-5年", education: "统招本科" });
    expect(items[0]!.canonicalUrl).toBe("https://www.liepin.com/a/79104715.shtml");
  });
  it("extracts the current live Liepin detail shape even when the title is not an h1", () => {
    document.title = "【北京 高级Android开发工程师招聘】-北京点富科技有限公司北京招聘信息-猎聘";
    document.body.innerHTML = `<div class="job-properties">北京-海淀区 3-5年 统招本科 招1人</div><div>郭女士 3天前在线 已认证</div><div>HRBP · 北京点富科技有限公司</div><div class="job-intro-container"><div class="paragraph">职位介绍 岗位职责 负责AI Agent客户端核心功能开发。任职要求 精通Android与Kotlin。</div></div>`;
    const item = extractLiepinDetail(document, "https://www.liepin.com/job/1977895941.shtml");
    expect(item).toMatchObject({ jobId: "1977895941", title: "高级Android开发工程师", company: "北京点富科技有限公司", location: "北京-海淀区", experience: "3-5年", education: "统招本科", recruiter: "郭女士", recruiterTitle: "HRBP" });
  });
});
