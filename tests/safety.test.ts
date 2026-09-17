import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const readDist = (name: string) => readFile(resolve("dist", name), "utf8");
const readSource = (name: string) => readFile(resolve(name), "utf8");

describe("MV3 safety gate", () => {
  it("builds the approved side-panel surfaces with exact permissions", async () => {
    const files = await readdir(resolve("dist"));
    expect(files).toEqual(expect.arrayContaining([
      "manifest.json",
      "background.js",
      "options.html",
      "options.js",
      "sidepanel.html",
      "sidepanel.js"
    ]));
    const manifest = JSON.parse(await readDist("manifest.json"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["storage", "tabs", "alarms", "sidePanel"]);
    expect(manifest.permissions).not.toContain("cookies");
    expect(manifest.host_permissions[0]).toBe("https://*.liepin.com/*");
    for (const permission of manifest.host_permissions.slice(1)) {
      expect(
        permission === "http://127.0.0.1:54321/*"
          || /^https:\/\/[a-z0-9-]+\.supabase\.co\/\*$/i.test(permission)
      ).toBe(true);
    }
    expect(manifest.host_permissions.length).toBeLessThanOrEqual(2);
    expect(manifest.host_permissions).not.toContain("http://*/*");
    expect(manifest.host_permissions).not.toContain("https://*/*");
    expect(manifest.side_panel.default_path).toBe("sidepanel.html");
  });

  it("contains no private Liepin API, scrolling, form, or cookie implementation", async () => {
    const content = await readDist("content/liepin.js");
    const background = await readDist("background.js");
    const adapter = await readSource("src/platforms/liepin.ts");
    const backgroundSource = await readSource("src/background.ts");
    for (const forbidden of [
      "requestSubmit",
      "scrollTo(",
      "scrollBy(",
      "FormData(",
      "chrome.cookies",
      "friend/add.json",
      "ChatWebsocket",
      "GeekChatCore"
    ]) {
      expect(content).not.toContain(forbidden);
    }
    expect(adapter).toContain("executeLiepinReviewedSend");
    expect(adapter).toContain('data-selector="chat-chat"');
    expect(adapter).toContain('element.focus({ preventScroll: true });');
    expect(adapter).toContain("element.click();");
    expect(adapter).not.toContain('dispatchEvent(new ViewMouseEvent("click"');
    for (const forbidden of [
      "chrome.cookies",
      "friend/add.json",
      "ChatWebsocket",
      "GeekChatCore"
    ]) {
      expect(background).not.toContain(forbidden);
    }
    expect(content).toContain("打开 JobFlow 侧边栏");
    expect(content).not.toContain("chrome.storage");
    expect(background).toContain("TRUSTED_CONTEXTS");
    expect(background).not.toContain("liveUnlocked");
    expect(backgroundSource).toContain("isTrustedOptionsSender");
  });

  it("allowlists only explicit sidepanel and options paths into live Liepin execution", async () => {
    const backgroundSource = await readSource("src/background.ts");
    const messagesSource = await readSource("src/domain/messages.ts");
    const contentSource = await readSource("src/content/liepin.ts");
    const sidepanelSource = await readSource("src/sidepanel.ts");

    expect(messagesSource).toContain('type: z.literal("START_BATCH")');
    expect(messagesSource).toContain("expectedExecutionPolicy: executionPolicySchema");
    expect(backgroundSource).toContain('isTrustedExtensionPageSender(sender, "sidepanel.html")');
    expect(backgroundSource).toContain("expectedExecutionPolicy");
    expect(backgroundSource).toContain('authorizationEvidenceCode: "automatic_batch_authorized"');
    expect(backgroundSource).toContain("executeReviewedDeliveryCore({");
    expect(backgroundSource).toContain("guardAutomaticBeforeWrite(");

    expect(backgroundSource).toContain('isTrustedExtensionPageSender(sender, "options.html")');
    expect(backgroundSource).toContain('case "PREPARE_REVIEWED_SEND"');
    expect(backgroundSource).toContain('case "CONFIRM_REVIEWED_SEND"');

    expect(contentSource).toContain("CONTENT_REVIEWED_SEND_EXECUTE");
    expect(contentSource).toContain("liepinReviewedSendExecuteCommandSchema.parse");
    expect(contentSource).toContain("executeLiepinReviewedSend(");
    expect(contentSource).not.toContain("CONFIRM_REVIEWED_SEND");
    expect(contentSource).not.toContain("START_BATCH");

    const scanHandler = backgroundSource.slice(
      backgroundSource.indexOf("async function scanCurrentTab"),
      backgroundSource.indexOf("function isTrustedExtensionPageSender")
    );
    const settingsHandler = backgroundSource.slice(
      backgroundSource.indexOf('case "UPDATE_SETTINGS"'),
      backgroundSource.indexOf('case "AUTH_REGISTER"')
    );
    const recoverHandler = backgroundSource.slice(
      backgroundSource.indexOf("async function recoverRun"),
      backgroundSource.indexOf("chrome.runtime.onStartup")
    );
    for (const source of [scanHandler, settingsHandler, recoverHandler]) {
      expect(source).not.toContain("executeReviewedDeliveryCore");
      expect(source).not.toContain("CONTENT_REVIEWED_SEND_EXECUTE");
      expect(source).not.toContain("markReviewedDeliveryWriteStarted");
    }

    expect(sidepanelSource).toContain('type: "START_BATCH"');
    expect(sidepanelSource).toContain("expectedExecutionPolicy: state.settings.executionPolicy");
  });

  it("removes personal assumptions, free-form rules, and environment-specific model hosts", async () => {
    const source = (await Promise.all([
      "src/defaults.ts",
      "src/resume.ts",
      "src/prompt.ts",
      "src/filters.ts",
      "src/background.ts",
      "src/options.ts",
      "scripts/build.mjs"
    ].map(readSource))).join("\n");
    for (const forbidden of [
      "新浪",
      "新致",
      "我确认真实发送",
      "10.1.0.231",
      "customIncludeAny",
      "customIncludeAll",
      "customExcludeAny",
      "customReviewAny",
      "liveUnlocked",
      "sentCount"
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
