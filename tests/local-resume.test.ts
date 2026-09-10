import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { readPastedResume, readResumeFile } from "../src/pdf";
import {
  deleteResume,
  getResumeMetadata,
  storeResumeFile,
  storeResumeText
} from "../src/local/resume-store";
import { sourceHash } from "../src/resume";

const longText = [
  "合成简历",
  "在示例公司负责平台工程与任务调度系统设计。",
  "使用 TypeScript 实现可恢复队列、状态机和自动化测试。",
  "参与需求分析、代码评审、故障复盘和稳定性治理。",
  "所有内容仅用于自动测试，不包含真实个人信息。"
].join("\n");

async function syntheticDocx(): Promise<File> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    "</Types>"
  ].join(""));
  zip.folder("_rels")?.file(".rels", [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    "</Relationships>"
  ].join(""));
  const paragraphs = longText.split("\n").map((line) =>
    '<w:p><w:r><w:t>' + line + "</w:t></w:r></w:p>"
  ).join("");
  zip.folder("word")?.file("document.xml", [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    paragraphs,
    "</w:body></w:document>"
  ].join(""));
  zip.folder("word")?.folder("_rels")?.file("document.xml.rels", [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  ].join(""));
  return new File([await zip.generateAsync({ type: "arraybuffer" })], "synthetic.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
}

describe("client-local resume sources", () => {
  it("normalizes pasted and UTF-8 text sources", async () => {
    const pasted = readPastedResume(longText.replace(/\n/g, "\r\n"));
    const file = new File([longText], "synthetic.txt", { type: "text/plain" });
    const parsed = await readResumeFile(file);
    expect(parsed.normalizedText).toBe(pasted.normalizedText);
    expect(parsed.sourceKind).toBe("text");
  });

  it("rejects spoofed and oversized files before model processing", async () => {
    await expect(readResumeFile(new File(["not a pdf"], "synthetic.pdf", { type: "application/pdf" })))
      .rejects.toThrow("实际内容不是有效 PDF");
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "oversized.txt");
    await expect(readResumeFile(oversized)).rejects.toThrow("10 MiB");
  });

  it("extracts text from an actual DOCX container", async () => {
    const parsed = await readResumeFile(await syntheticDocx());
    expect(parsed.sourceKind).toBe("docx");
    expect(parsed.normalizedText).toContain("可恢复队列");
    expect(parsed.normalizedText).toContain("仅用于自动测试");
  });

  it("stores files and pasted text by user and source hash", async () => {
    const userId = "00000000-0000-4000-8000-000000000020";
    const hash = await sourceHash(longText);
    const metadata = {
      userId,
      sourceHash: hash,
      sourceName: "synthetic.txt",
      sourceKind: "text" as const,
      mimeType: "text/plain",
      size: longText.length,
      storedAt: "2026-01-01T00:00:00.000Z"
    };
    const file = new File([longText], metadata.sourceName, { type: metadata.mimeType });
    await storeResumeFile(metadata, file);
    expect(await getResumeMetadata(userId, hash)).toEqual(metadata);
    await deleteResume(userId, hash);
    expect(await getResumeMetadata(userId, hash)).toBeNull();
    await storeResumeText({ ...metadata, sourceName: "粘贴文本", sourceKind: "pasted" }, longText);
    expect((await getResumeMetadata(userId, hash))?.sourceKind).toBe("pasted");
  });
});
