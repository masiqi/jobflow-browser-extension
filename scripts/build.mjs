import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const out = resolve("dist");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: {
    background: resolve("src/background.ts"),
    "content/liepin": resolve("src/content/liepin.ts"),
    options: resolve("src/options.ts")
  },
  outdir: out,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  sourcemap: false,
  legalComments: "none",
  charset: "utf8",
  loader: { ".mjs": "js" }
});
await cp(resolve("src/options.html"), resolve("dist/options.html"));
await cp(resolve("src/options.css"), resolve("dist/options.css"));
await cp(resolve("node_modules/pdfjs-dist/build/pdf.worker.min.mjs"), resolve("dist/pdf.worker.min.mjs"));

const manifest = {
  manifest_version: 3,
  name: "求职批处理助手（模拟版）",
  version: "0.1.0",
  description: "五站架构，首期猎聘列表批处理模拟；不会发送或投递",
  permissions: ["storage", "tabs"],
  host_permissions: [
    "https://*.liepin.com/*",
    "http://10.1.0.231:28080/*",
    "http://localhost/*",
    "http://127.0.0.1/*"
  ],
  background: { service_worker: "background.js" },
  content_scripts: [{ matches: ["https://*.liepin.com/*"], js: ["content/liepin.js"], run_at: "document_idle" }],
  options_page: "options.html",
  action: { default_title: "求职批处理设置" }
};
await writeFile(resolve("dist/manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
