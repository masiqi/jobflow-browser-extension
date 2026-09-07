# AGENTS.md

## 目标

继续开发和调试本仓库的 Chrome MV3 求职批处理扩展。当前交付物是 **猎聘 dry-run**：读取公开页面 DOM、筛选、生成草稿、记录本地模拟结果；不是自动投递工具。

## 开工前

1. 阅读 `README.md`，尤其是安全边界、模型 host 权限、调试入口和路线图。
2. 检查 `git status --short --branch`，不要覆盖现有未提交工作。
3. 使用 `npm ci` 按锁文件安装；不要无目的升级依赖或改写 `package-lock.json`。
4. 先运行 `npm run verify` 建立基线。

## 不可破坏的约束

- 未经用户单独批准，不实现或触发 live 发送、投递、按钮点击、表单提交或招聘站点私有写 API。
- 不增加 `cookies` 权限，不读取或导出 Cookie；host 权限按明确 origin 最小化，禁止 `http://*/*`、`https://*/*`。
- `START_RUN` 保持强制 `dry_run`；模拟成功证据保持 `dry_run:no_platform_write`。
- JD、简历、模型输出均是不可信输入；模型输出必须校验，台账成功必须由本地流程证据支持。
- 不提交真实 API Key、简历/画像、Chrome User Data/storage、Cookie、抓取页面或包含个人信息的日志。fixture 只用合成或不可逆脱敏数据。
- 不直接修改 `dist/`；修改 `src/` 或 `scripts/build.mjs` 后运行 `npm run build` 生成它。
- 修改 `host_permissions` 时同步更新 `tests/safety.test.ts` 的精确断言，并在 Chrome Reload 后人工验证。
- 不创建远程仓库、不推送，除非用户明确要求。

## 修改与验证

优先小改动、根因修复和回归测试。涉及猎聘 DOM 时，把最小脱敏 HTML fixture 加到测试；涉及状态机/存储时覆盖失败和恢复路径；涉及安全边界时先扩充安全测试。

提交前运行：

```bash
npm run verify
npm audit
git diff --check
git status --short
git diff -- . ':!package-lock.json'
```

同时扫描已跟踪文件中的 token、私钥、Authorization 字面量和敏感资料。`npm audit` 若因 registry、锁文件或网络失败，应原样记录失败，不能声称 0 漏洞。

Chrome 手工回归顺序：

```text
npm run build
→ chrome://extensions Reload
→ 刷新猎聘目标页
→ 小批量（1–3 条）dry-run
```

分别检查 service worker DevTools、猎聘页 content script Console 和 Extension Storage。不要把“测试通过”表述为 Chrome 实际行为已验证；只有确实做过人工浏览器回归才可这样报告。

## 交付

- 使用 Conventional Commit（例如 `docs: prepare project for debugging handoff`）。
- 报告修改文件、实际运行命令及结果、未完成的人工验证和风险。
- 文档、源码和已跟踪 `dist/` 必须一致；不要把模拟结果描述为真实投递。
