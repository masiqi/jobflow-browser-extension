import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const profileDirectory = await mkdtemp(join(tmpdir(), "jobflow-smoke-"));
const artifactDirectory = resolve(".artifacts");
await mkdir(artifactDirectory, { recursive: true });

const errors = [];
let context;

try {
  context = await chromium.launchPersistentContext(profileDirectory, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      "--disable-extensions-except=" + resolve("dist"),
      "--load-extension=" + resolve("dist")
    ]
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("chrome-extension://" + extensionId + "/options.html");
  await page.getByRole("heading", { name: "职位记录" }).waitFor();
  await page.getByRole("button", { name: "账号" }).click();
  await page.locator("#email").fill("smoke-" + Date.now() + "@example.invalid");
  await page.locator("#password").fill("Synthetic-pass-123");
  await page.getByRole("button", { name: "注册" }).click();
  await page.getByText("账号数据由 Supabase RLS 隔离。").waitFor();
  await page.screenshot({
    path: join(artifactDirectory, "dashboard-account.png"),
    fullPage: true
  });
  await page.getByRole("button", { name: "模型服务" }).click();
  await page.getByRole("heading", { name: "模型服务" }).waitFor();
  await page.screenshot({
    path: join(artifactDirectory, "dashboard-model.png"),
    fullPage: true
  });
  await page.setViewportSize({ width: 760, height: 900 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) {
    throw new Error("Management page has horizontal overflow at 760px");
  }
  await page.screenshot({
    path: join(artifactDirectory, "dashboard-model-narrow.png"),
    fullPage: true
  });

  const sidePanel = await context.newPage();
  sidePanel.on("pageerror", (error) => errors.push(error.message));
  await sidePanel.setViewportSize({ width: 380, height: 800 });
  await sidePanel.goto("chrome-extension://" + extensionId + "/sidepanel.html");
  await sidePanel.getByRole("heading", { name: "JobFlow" }).waitFor();
  await sidePanel.getByText("仅生成草稿").waitFor();
  if (await sidePanel.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) {
    throw new Error("Side panel has horizontal overflow");
  }
  await sidePanel.screenshot({
    path: join(artifactDirectory, "sidepanel.png"),
    fullPage: true
  });

  const liepin = await context.newPage();
  liepin.on("pageerror", (error) => errors.push(error.message));
  await liepin.goto("https://www.liepin.com/zhaopin/", {
    waitUntil: "domcontentloaded",
    timeout: 30_000
  });
  await liepin.waitForSelector("#jobflow-launcher-root", { state: "attached", timeout: 15_000 });
  const launcherSize = await liepin.locator("#jobflow-launcher-root").evaluate((host) => {
    const button = host.shadowRoot?.querySelector("button");
    const rect = button?.getBoundingClientRect();
    return rect ? { width: rect.width, height: rect.height } : null;
  });
  if (!launcherSize || launcherSize.width !== 42 || launcherSize.height !== 42) {
    throw new Error("Liepin launcher is not rendered at its stable 42px size");
  }

  if (errors.length) throw new Error("Extension page errors: " + errors.join(" | "));
  console.log("Chrome extension synthetic smoke: PASS");
} finally {
  await context?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
