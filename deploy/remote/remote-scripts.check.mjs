// Run with node --test; deliberately separate from Vitest's test-file glob.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scripts = dirname(fileURLToPath(import.meta.url));
const code = resolve(scripts, "../..");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "jobflow-remote-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const service = join(root, "runtime");
  const bin = join(root, "bin");
  mkdirSync(service);
  mkdirSync(bin);
  const log = join(root, "commands.log");
  writeFileSync(log, "");
  const mock = (name, body) => writeFileSync(join(bin, name), `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o755 });
  mock("systemctl", 'printf "systemctl %s\\n" "$*" >> "$MOCK_LOG"');
  mock("curl", 'printf "curl %s\\n" "$*" >> "$MOCK_LOG"');
  mock("supabase", `
printf 'supabase %s\\n' "$*" >> "$MOCK_LOG"
case "$*" in
  *"status -o env"*) printf 'API_URL="http://127.0.0.1:15421"\\nSECRET_KEY="synthetic-secret"\\nJWT_SECRET="synthetic-jwt"\\n' ;;
  *"migration up"*) printf 'synthetic-sensitive-sql\\n'; exit "$MOCK_MIGRATION_EXIT" ;;
  *" start "*) printf 'synthetic-secret\\n' ;;
esac`);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    JOBFLOW_SERVICE_DIR: service,
    JOBFLOW_CODE_DIR: code,
    JOBFLOW_SUPABASE_CLI: join(bin, "supabase"),
    XDG_CONFIG_HOME: join(root, "config"),
    MOCK_LOG: log,
    MOCK_MIGRATION_EXIT: "0",
  };
  const run = (name, overrides = {}) => spawnSync("bash", [join(scripts, name)], { env: { ...env, ...overrides }, encoding: "utf8" });
  const install = () => {
    const result = run("install-user-services.sh");
    assert.equal(result.status, 0, result.stderr);
    writeFileSync(log, "");
  };
  const config = join(service, "runtime.env");
  return { root, service, bin, env, run, install, config, log: () => readFileSync(log, "utf8") };
}

test("installed config owns stop identity; ambient variables cannot stop another project", (t) => {
  const f = fixture(t);
  f.install();
  const result = f.run("stop-supabase.sh", { JOBFLOW_PROJECT_ID: "other-project" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.log(), /stop --project-id jobflow-browser-extension-remote/);
  assert.doesNotMatch(f.log(), /other-project|--all|--no-backup|reset|prune/);
});

test("startup applies migrations and suppresses CLI credentials/SQL output", (t) => {
  const f = fixture(t);
  f.install();
  const result = f.run("start-supabase.sh");
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.log(), /start --ignore-health-check/);
  assert.match(f.log(), /migration up --local/);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-/);
  assert.doesNotMatch(f.log(), / stop /);
});

test("migration failure stops only this project without reset or volume deletion", (t) => {
  const f = fixture(t);
  f.install();
  const result = f.run("start-supabase.sh", { MOCK_MIGRATION_EXIT: "1" });
  assert.notEqual(result.status, 0);
  assert.match(f.log(), /stop --project-id jobflow-browser-extension-remote/);
  assert.doesNotMatch(f.log(), /--all|--no-backup|reset|prune/);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-/);
});

test("status only exposes endpoint allowlist; model service keeps JWT verification", (t) => {
  const f = fixture(t);
  f.install();
  const result = f.run("status.sh");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /API_URL=/);
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET|synthetic-/);
  const serve = f.run("start-model-gateway.sh");
  assert.equal(serve.status, 0, serve.stderr);
  assert.match(f.log(), /functions serve model-gateway --env-file /);
  assert.doesNotMatch(f.log(), /no-verify-jwt/);
  assert.match(readFileSync(join(f.service, "supabase/config.toml"), "utf8"), /verify_jwt = true/);
});

test("runtime configuration is parsed as data, never executed", (t) => {
  const f = fixture(t);
  f.install();
  const marker = join(f.root, "executed");
  writeFileSync(f.config, readFileSync(f.config, "utf8") + `\ntouch ${marker}\n`);
  const result = f.run("install-user-services.sh");
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(marker), false);
  assert.equal(f.log(), "");
});

test("reject duplicate ports, duplicate assignments, and identity drift before invoking CLI", (t) => {
  const f = fixture(t);
  f.install();
  const original = readFileSync(f.config, "utf8");
  for (const config of [
    original.replace("JOBFLOW_DB_PORT=15422", "JOBFLOW_DB_PORT=15421"),
    original + "\nJOBFLOW_API_PORT=15421\n",
    original.replace("JOBFLOW_API_PORT=15421", "JOBFLOW_API_PORT=015421"),
    original.replace("jobflow-browser-extension-remote", "different-project"),
  ]) {
    writeFileSync(f.config, config);
    assert.notEqual(f.run("stop-supabase.sh").status, 0);
  }
  assert.equal(f.log(), "");
});

test("installer rejects path syntax that could alter systemd or sed commands", (t) => {
  const f = fixture(t);
  const result = f.run("install-user-services.sh", { JOBFLOW_CODE_DIR: `${code}/bad &path` });
  assert.notEqual(result.status, 0);
  assert.equal(f.log(), "");
});

test("reinstall retains runtime settings and optional model credentials", (t) => {
  const f = fixture(t);
  f.install();
  const model = join(f.service, "model-gateway.env");
  writeFileSync(model, "MANAGED_MODEL_API_KEY=synthetic-existing-key\n");
  const config = readFileSync(f.config, "utf8").replace("JOBFLOW_API_PORT=15421", "JOBFLOW_API_PORT=16421");
  writeFileSync(f.config, config);
  const result = f.run("install-user-services.sh");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(f.config, "utf8"), config);
  assert.match(readFileSync(model, "utf8"), /synthetic-existing-key/);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-existing-key/);
  assert.match(readFileSync(join(f.service, "supabase/config.toml"), "utf8"), /port = 16421/);
});

for (const matches of [true, false]) {
  test(`CLI installer ${matches ? "accepts verified archive" : "rejects checksum mismatch and retains existing binary"}`, (t) => {
    const f = fixture(t);
    const hash = "a".repeat(64);
    const mock = (name, body) => writeFileSync(join(f.bin, name), `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o755 });
    mock("uname", 'if [[ "$1" == -s ]]; then echo Linux; else echo x86_64; fi');
    mock("curl", `
url=''
output=''
while (( $# )); do
  case "$1" in
    https:*) url="$1" ;;
    --output) shift; output="$1" ;;
  esac
  shift
done
if [[ "$url" == */checksums.txt ]]; then
  printf '%s  supabase_linux_amd64.tar.gz\\n' '${matches ? hash : "b".repeat(64)}' > "$output"
else
  printf 'synthetic archive' > "$output"
fi`);
    mock("sha256sum", `printf '${hash}  %s\\n' "$1"`);
    mock("tar", `printf 'tar called\\n' >> "$MOCK_LOG"; printf '#!/usr/bin/env bash\\necho 2.109.1\\n'`);
    const installed = join(f.service, "bin/supabase");
    mkdirSync(dirname(installed));
    writeFileSync(installed, "old-cli");
    const result = f.run("install-supabase-cli.sh", { SUPABASE_CLI_VERSION: "2.109.1" });
    if (matches) {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /2\.109\.1/);
      assert.match(f.log(), /tar called/);
    } else {
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(installed, "utf8"), "old-cli");
      assert.doesNotMatch(f.log(), /tar called/);
    }
  });
}
