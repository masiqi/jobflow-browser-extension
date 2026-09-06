import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");

export async function readResumeFile(file: File): Promise<string> {
  if (file.size > 10_000_000) throw new Error("简历文件须小于10MB");
  if (/\.(?:md|txt)$/i.test(file.name)) return file.text();
  if (!/\.pdf$/i.test(file.name)) throw new Error("只支持 Markdown、TXT 或 PDF");
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
  }
  const text = pages.join("\n").trim();
  if (text.length < 100) throw new Error("PDF没有足够的可提取文本；请改用Markdown版简历");
  return text;
}
