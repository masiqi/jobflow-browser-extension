import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const out = resolve("dist");
const supabaseUrl = (process.env.JOBFLOW_SUPABASE_URL || "").replace(/\/+$/, "");
const supabasePublishableKey = process.env.JOBFLOW_SUPABASE_PUBLISHABLE_KEY || "";
if (supabaseUrl && !(/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)
  || supabaseUrl === "http://127.0.0.1:54321")) {
  throw new Error("JOBFLOW_SUPABASE_URL must be one exact Supabase project origin");
}
if (Boolean(supabaseUrl) !== Boolean(supabasePublishableKey)) {
  throw new Error("Supabase URL and publishable key must be configured together");
}
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin + "/*" : null;
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: {
    background: resolve("src/background.ts"),
    "content/liepin": resolve("src/content/liepin.ts"),
    options: resolve("src/options.ts"),
    sidepanel: resolve("src/sidepanel.ts")
  },
  outdir: out,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  charset: "utf8",
  loader: { ".mjs": "js" },
  define: {
    __JOBFLOW_SUPABASE_URL__: JSON.stringify(supabaseUrl),
    __JOBFLOW_SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabasePublishableKey)
  }
});
for (const relativePath of ["background.js", "content/liepin.js", "options.js", "sidepanel.js"]) {
  const path = resolve("dist", relativePath);
  const source = await readFile(path, "utf8");
  await writeFile(path, source.replace(/[ \t]+$/gm, ""), "utf8");
}
await cp(resolve("src/options.html"), resolve("dist/options.html"));
await cp(resolve("src/options.css"), resolve("dist/options.css"));
await cp(resolve("src/sidepanel.html"), resolve("dist/sidepanel.html"));
await cp(resolve("src/sidepanel.css"), resolve("dist/sidepanel.css"));
await cp(resolve("node_modules/pdfjs-dist/build/pdf.worker.min.mjs"), resolve("dist/pdf.worker.min.mjs"));

const manifest = {
  manifest_version: 3,
  name: "JobFlow 猎聘草稿助手",
  version: "0.2.0",
  description: "读取猎聘公开页面并生成可审核草稿；不会发送或投递",
  permissions: ["storage", "tabs", "alarms", "sidePanel"],
  host_permissions: ["https://*.liepin.com/*", ...(supabaseOrigin ? [supabaseOrigin] : [])],
  background: { service_worker: "background.js" },
  content_scripts: [{ matches: ["https://*.liepin.com/*"], js: ["content/liepin.js"], run_at: "document_idle" }],
  side_panel: { default_path: "sidepanel.html" },
  options_page: "options.html",
  action: { default_title: "打开 JobFlow" }
};
await writeFile(resolve("dist/manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
