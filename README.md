# 五站求职批处理 Chrome 扩展

当前可运行版本为 **猎聘模拟批处理 v0.1**。架构预留 BOSS、前程无忧、智联、拉勾，但尚未把真实页面适配与发送流程扩展到这些站。

## 为什么改成 Chrome MV3 扩展

列表页 → 后台持久队列 → 后台打开详情页 → 读取 JD → 模型筛选/招呼 → 回到队列，这类跨标签、跨页面、暂停恢复任务比 Tampermonkey 更适合由 MV3 background service worker 管理。

## 当前做到了

- 猎聘 `/zhaopin/` 列表读取并按职位 ID 去重；
- 列表硬筛选后逐个后台打开详情页；
- 详情页二次硬筛选；
- BYOK 调用 OpenAI-compatible `/chat/completions`；
- 生成匹配决策和 100–160 字招呼语；
- 模拟结果与失败原因记录到 Chrome 本机存储；
- 暂停、继续、取消；
- Markdown/TXT/PDF 简历导入，按 SHA-256 建立版本化事实画像；
- 有 API Key 时，模型只在导入时做一次结构化事实抽取，异常时安全退回本地确定性抽取；
- 后续 JD 请求只发送画像，不重复发送原始简历；
- 学校和方向规则可灵活配置。

## 灵活筛选

每个方向都能设置：

- 忽略
- 偏好
- 必选
- 排除
- 复核

预置方向包括 Agent/智能体、Java/Spring、GPU/CUDA、芯片、移动端、AI 产品；可以增加任何自定义方向和关键词。

985/211/双一流等学校条件可设置：忽略、命中复核、命中排除、只保留明确要求。

## 安全边界

此版本只有 `dry_run`：

- 不点击“聊一聊”；
- 不发送消息；
- 不投递；
- 不上传简历；
- 不调用站点私有写接口；
- 模拟成功记录 `dry_run:no_platform_write` 证据。

真实发送入口故意没有实现。必须先由用户验收模拟结果，再单独实现“一次一批、输入确认短语解锁、页面回读成功才记账”的 live 模式。

## 安装

```bash
cd /Users/siqi/jobflow-browser-extension
npm install
npm run verify
```

Chrome 打开 `chrome://extensions`：

1. 开启开发者模式；
2. 点击“加载已解压的扩展程序”；
3. 选择 `/Users/siqi/jobflow-browser-extension/dist`；
4. 打开扩展详情 → 扩展程序选项，配置模型、筛选条件和简历画像；
5. 打开猎聘搜索列表页，右下角出现“批量模拟”。

## Cloudflare

当前无需部署 Cloudflare。单台 Mac/Chrome 使用时，`chrome.storage.local` 足够保存设置、队列和台账。Hono + D1 只在多电脑同步、远程报表或与其他 JobFlow 程序共享台账时再接入；它不应接管招聘网站会话或存储 Cookie。
