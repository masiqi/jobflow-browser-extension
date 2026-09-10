import * as mammoth from "mammoth";
import type { ResumeProfile } from "./types";

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const MIN_RESUME_CHARACTERS = 100;

export interface ParsedResumeSource {
  sourceName: string;
  sourceKind: ResumeProfile["sourceKind"];
  mimeType: string;
  size: number;
  normalizedText: string;
}

export function normalizeResumeText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function validateText(text: string): string {
  const normalized = normalizeResumeText(text);
  if (normalized.length < MIN_RESUME_CHARACTERS) {
    throw new Error("简历可提取文本不足，请使用带文本层的 PDF、DOCX、TXT、Markdown 或粘贴文本");
  }
  return normalized;
}

function extension(name: string): string {
  return name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");
  }
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
  }
  return validateText(pages.join("\n"));
}

async function extractDocx(buffer: ArrayBuffer): Promise<string> {
  const input = typeof window === "undefined"
    ? { buffer: Buffer.from(buffer) }
    : { arrayBuffer: buffer };
  const result = await mammoth.extractRawText(input);
  return validateText(result.value);
}

function decodeUtf8(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new Error("文本简历包含不支持的二进制内容");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("TXT 和 Markdown 简历必须使用 UTF-8 编码");
  }
}

export async function readResumeFile(file: File): Promise<ParsedResumeSource> {
  if (file.size > MAX_RESUME_BYTES) throw new Error("简历文件不能超过 10 MiB");
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const ext = extension(file.name);
  const isPdf = hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  const isZip = hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]);

  if (ext === "doc") throw new Error("不支持旧版 .doc，请另存为 DOCX 或 PDF");
  if (ext === "pdf" && !isPdf) throw new Error("文件扩展名为 PDF，但实际内容不是有效 PDF");
  if (ext === "docx" && !isZip) throw new Error("文件扩展名为 DOCX，但实际内容不是有效 DOCX");

  if (isPdf) {
    return {
      sourceName: file.name,
      sourceKind: "pdf",
      mimeType: "application/pdf",
      size: file.size,
      normalizedText: await extractPdf(bytes)
    };
  }
  if (isZip && ext === "docx") {
    return {
      sourceName: file.name,
      sourceKind: "docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: file.size,
      normalizedText: await extractDocx(buffer)
    };
  }
  if (ext !== "txt" && ext !== "md" && ext !== "markdown") {
    throw new Error("只支持 PDF、DOCX、TXT、Markdown 或粘贴文本");
  }
  const normalizedText = validateText(decodeUtf8(bytes));
  return {
    sourceName: file.name,
    sourceKind: ext === "txt" ? "text" : "markdown",
    mimeType: "text/plain",
    size: file.size,
    normalizedText
  };
}

export function readPastedResume(text: string): ParsedResumeSource {
  const normalizedText = validateText(text);
  return {
    sourceName: "粘贴文本",
    sourceKind: "pasted",
    mimeType: "text/plain",
    size: new TextEncoder().encode(normalizedText).byteLength,
    normalizedText
  };
}
