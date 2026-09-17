#!/usr/bin/env node

import { closeSync, existsSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";

const repoRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const projectId = "jobflow-browser-extension";
const localSupabaseUrl = "http://127.0.0.1:54321";
const functionUrl = localSupabaseUrl + "/functions/v1/model-gateway";
const pidPath = join(tmpdir(), "jobflow-browser-extension-model-gateway.pid");
const logPath = join(tmpdir(), "jobflow-browser-extension-model-gateway.log");
const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  console.log([
    "Usage: node scripts/start-local.mjs [--dry-run]",
    "",
    "Restarts only this repository's local Supabase project, starts model-gateway,",
    "waits for local health, and rebuilds dist with .env.local's public key.",
    "The database volume is preserved; this command never runs supabase db reset.",
    "",
    "Options:",
    "  --dry-run  Print the planned actions without stopping or starting anything"
  ].join("\n"));
  process.exit(0);
}

function redact(value) {
  const sensitiveKey = "(?:ANON_KEY|PUBLISHABLE_KEY|SECRET_KEY|SERVICE_ROLE_KEY|JWT_SECRET|S3_PROTOCOL_ACCESS_KEY_ID|S3_PROTOCOL_ACCESS_KEY_SECRET)";
  return String(value || "")
    .replace(new RegExp(`((?:"?${sensitiveKey}"?)\\s*[:=]\\s*["']?)([^\\s"',}]+)`, "gi"), "$1<redacted>")
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, "<supabase-key-redacted>")
    .replace(/postgresql:\/\/[^\s"']+/g, "postgresql://<redacted>");
}

function printCommandOutput(label, result) {
  const output = redact([result.stdout, result.stderr].filter(Boolean).join("\n").trim());
  if (output) console.log("[" + label + "]\n" + output);
}

function run(command, commandArgs, label, allowFailure = false, commandEnv = process.env) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    env: commandEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  printCommandOutput(label, result);
  if (result.error) {
    if (!allowFailure) throw new Error(label + " 无法执行：" + result.error.message);
    return result;
  }
  if (result.status !== 0 && !allowFailure) {
    throw new Error(label + " 失败，退出码 " + String(result.status));
  }
  return result;
}

function parseEnvText(value) {
  const result = {};
  for (const line of String(value || "").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let parsed = match[2] || "";
    if (parsed.startsWith('"') && parsed.endsWith('"')) {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        parsed = parsed.slice(1, -1);
      }
    } else if (parsed.startsWith("'") && parsed.endsWith("'")) {
      parsed = parsed.slice(1, -1);
    }
    result[match[1]] = parsed;
  }
  return result;
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return parseEnvText(readFileSync(path, "utf8"));
}

function publicBuildConfig() {
  const fileValues = readEnvFile(join(repoRoot, ".env.local"));
  const status = run("supabase", ["status", "-o", "env"], "读取 Supabase 公共配置", true);
  const statusValues = parseEnvText(status.stdout);
  const supabaseUrl = fileValues.JOBFLOW_SUPABASE_URL || statusValues.API_URL || "";
  const publishableKey = fileValues.JOBFLOW_SUPABASE_PUBLISHABLE_KEY || statusValues.PUBLISHABLE_KEY || "";
  if (supabaseUrl !== localSupabaseUrl) {
    throw new Error("一键脚本只允许本地 Supabase：JOBFLOW_SUPABASE_URL 必须是 " + localSupabaseUrl);
  }
  if (!publishableKey) {
    throw new Error("没有找到本地 PUBLISHABLE_KEY，请先运行 supabase start 或填写 .env.local");
  }
  return { supabaseUrl, publishableKey };
}

function processCwd(pid) {
  const result = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
  if (result.status !== 0) return "";
  const line = result.stdout.split(/\r?\n/).find((entry) => entry.startsWith("n"));
  return line ? line.slice(1) : "";
}

function matchingFunctionProcesses() {
  const result = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (result.status !== 0) return [];
  const processes = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (!/\bsupabase\b.*\bfunctions\s+serve\s+model-gateway\b/.test(command)) continue;
    if (processCwd(pid) !== repoRoot) continue;
    processes.push({ pid, command });
  }
  return processes;
}

async function stopExistingFunctionProcesses() {
  const processes = matchingFunctionProcesses();
  if (processes.length === 0) {
    if (existsSync(pidPath)) unlinkSync(pidPath);
    return;
  }
  console.log("正在停止当前项目的旧 model-gateway 进程：" + processes.map((item) => String(item.pid)).join(", "));
  for (const item of processes) {
    try {
      process.kill(item.pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && matchingFunctionProcesses().length > 0) {
    await delay(100);
  }
  const remaining = matchingFunctionProcesses();
  for (const item of remaining) {
    try {
      process.kill(item.pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  if (existsSync(pidPath)) unlinkSync(pidPath);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitForHttp(url, acceptedStatuses, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (acceptedStatuses.includes(response.status)) return response.status;
      lastError = "HTTP " + String(response.status);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  throw new Error("等待服务就绪超时：" + url + "（最后状态：" + lastError + ")");
}

function startFunction(envFile) {
  const functionArgs = ["functions", "serve", "model-gateway"];
  if (envFile) functionArgs.push("--env-file", envFile);
  const logHandle = openSync(logPath, "a");
  const child = spawn("supabase", functionArgs, {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", logHandle, logHandle]
  });
  closeSync(logHandle);
  child.unref();
  if (typeof child.pid !== "number") throw new Error("无法启动 model-gateway");
  writeFileSync(pidPath, String(child.pid) + "\n", "utf8");
  return child.pid;
}

function tailLog() {
  if (!existsSync(logPath)) return "";
  const lines = readFileSync(logPath, "utf8").split(/\r?\n/);
  return redact(lines.slice(-30).join("\n"));
}

async function main() {
  if (args.has("--dry-run")) {
    console.log([
      "dry-run：",
      "1. 停止当前仓库目录下的 model-gateway 进程",
      "2. 重启 Supabase 项目 " + projectId + "（保留数据卷）",
      "3. 启动 supabase functions serve model-gateway",
      "4. 用 .env.local 的本地公开 PUBLISHABLE_KEY 重建 dist"
    ].join("\n"));
    return;
  }

  run("supabase", ["--version"], "检查 Supabase CLI");
  await stopExistingFunctionProcesses();
  run("supabase", ["stop", "--project-id", projectId], "停止当前 Supabase 项目", true);
  run("supabase", ["start", "--ignore-health-check"], "启动当前 Supabase 项目");
  await waitForHttp(localSupabaseUrl + "/rest/v1/", [200], 30_000);
  await waitForHttp(localSupabaseUrl + "/auth/v1/health", [200], 30_000);

  const config = publicBuildConfig();
  const functionEnvPath = process.env.JOBFLOW_FUNCTION_ENV_FILE
    ? resolve(repoRoot, process.env.JOBFLOW_FUNCTION_ENV_FILE)
    : join(repoRoot, "supabase", "model-gateway.env");
  const envFile = existsSync(functionEnvPath) ? functionEnvPath : "";
  const pid = startFunction(envFile);
  try {
    await waitForHttp(functionUrl, [200, 401, 405], 30_000);
  } catch (error) {
    const details = tailLog();
    throw new Error(error.message + (details ? "\nmodel-gateway 最近日志：\n" + details : ""));
  }

  run(
    "node",
    ["scripts/build.mjs"],
    "构建本地 Supabase 扩展",
    false,
    {
      ...process.env,
      JOBFLOW_SUPABASE_URL: config.supabaseUrl,
      JOBFLOW_SUPABASE_PUBLISHABLE_KEY: config.publishableKey
    }
  );
  console.log([
    "",
    "本地服务已就绪：",
    "- Supabase API: " + config.supabaseUrl,
    "- model-gateway: " + functionUrl,
    "- model-gateway PID: " + String(pid),
    "- model-gateway 日志: " + logPath,
    "- dist 已用本地 PUBLISHABLE_KEY 构建（未使用 ANON/SECRET/SERVICE_ROLE key）",
    "",
    "下一步：打开 chrome://extensions Reload JobFlow，然后完整刷新猎聘列表页；旧详情标签页请关闭后重新打开。",
    "该脚本不会执行 supabase db reset，因此不会删除本地账号、画像或职位记录。"
  ].join("\n"));
}

main().catch((error) => {
  console.error("[start-local] " + redact(error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
