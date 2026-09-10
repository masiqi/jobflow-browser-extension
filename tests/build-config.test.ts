import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function runBuild(environment: Record<string, string>) {
  return spawnSync(process.execPath, [resolve("scripts/build.mjs")], {
    cwd: resolve("."),
    env: {
      ...process.env,
      JOBFLOW_SUPABASE_URL: "",
      JOBFLOW_SUPABASE_PUBLISHABLE_KEY: "",
      ...environment
    },
    encoding: "utf8"
  });
}

describe("build-time Supabase origin policy", () => {
  it("rejects non-Supabase and broad origins before touching dist", () => {
    const result = runBuild({
      JOBFLOW_SUPABASE_URL: "https://example.com",
      JOBFLOW_SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key"
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exact Supabase project origin");
  });

  it("requires URL and publishable key together", () => {
    const result = runBuild({
      JOBFLOW_SUPABASE_URL: "https://synthetic.supabase.co"
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("configured together");
  });
});
