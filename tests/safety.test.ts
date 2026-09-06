import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

describe("MV3 safety gate", () => {
  it("builds an extension with Liepin list support and no send/apply mutation code", async () => {
    const files = await readdir(resolve("dist"));
    expect(files).toContain("manifest.json"); expect(files).toContain("background.js"); expect(files).toContain("options.html");
    const manifest = JSON.parse(await readFile(resolve("dist/manifest.json"), "utf8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).not.toContain("cookies");
    expect(manifest.host_permissions).not.toContain("http://*/*");
    expect(manifest.host_permissions).not.toContain("https://*/*");
    expect(manifest.host_permissions).toEqual(["https://*.liepin.com/*", "http://10.1.0.231:28080/*", "http://localhost/*", "http://127.0.0.1/*"]);
    const code = (await Promise.all(["background.js", "content/liepin.js"].map((name) => readFile(resolve("dist", name), "utf8")))).join("\n");
    for (const forbidden of ["friend/add.json", "chrome.cookies", "requestSubmit", ".click()", "ChatWebsocket", "GeekChatCore"]) expect(code).not.toContain(forbidden);
    expect(code).toContain("真实发送尚未实现");
    expect(code).toContain("dry_run:no_platform_write");
  });
});
