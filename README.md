# JobFlow 猎聘草稿助手

JobFlow 是一个 Chrome Manifest V3 扩展。用户先使用猎聘自带的搜索和筛选器完成粗筛，扩展读取当前页面已经加载的职位卡片，串行打开公开详情页，执行有限且可解释的 JD 规则与 LLM 适配度判断，生成可审核、可编辑、可追溯的招呼语草稿，并可按执行策略选择仅生成、逐条确认发送，或在一次明确授权的选中批次内自动投递并打招呼。

> 当前开发版本默认执行策略是 `reviewed_send`。`automatic_send` 必须由用户在管理台显式选择，并且每次只由 side panel 的一次批次按钮授权当前选中的职位 ID；打开页面、扫描、刷新、修改设置、Chrome 启动或查看历史草稿都不会触发真实写入。不上传新的简历文件，不读取 Cookie，也不调用招聘平台私有写 API。

## 当前能力

### 账号与后端

- Supabase 邮箱 + 密码开放注册；
- 注册时不验证邮箱，不需要邀请码；
- 暂不提供密码找回、支付或自动 VIP 开通；
- Postgres + Row Level Security 隔离每个用户的画像、规则、职位、评估、草稿和历史；
- Edge Function 验证 JWT、代理模型请求并通过命名 RPC 写入受保护状态；
- VIP 权益与托管模型额度保存在 private schema，不能由扩展修改；
- 默认构建不绑定任何远程 Supabase 项目，必须在构建时显式提供公开项目配置。

### 简历与画像

- 支持带文本层的 PDF、DOCX、UTF-8 TXT、Markdown 和粘贴文本；
- 上传文件最大 10 MiB；
- 文件结构在客户端验证，不能只依赖扩展名；
- 原始文件只保存在当前 Chrome profile 的 IndexedDB；
- Supabase 不保存原始文件或完整规范化简历文本；
- 模型只接收客户端提取后的规范化文本；
- 模型结果先成为待审核画像；
- 用户必须审核事实并明确启用画像，才能处理职位；
- 更换本地原件后旧画像变为 stale；
- 相同内容哈希重复导入时复用已有画像，不重复调用模型；
- 扫描版 PDF、图片简历、旧版 DOC 和 OCR 暂不支持。

### 模型服务

- VIP 用户可使用产品托管模型与服务端额度；
- 用户也可以 BYOK；
- BYOK Key 默认仅保存在当前浏览器 session；
- 用户明确选择后可记住在当前设备，但不会同步到 Supabase；
- Edge Function 只在单次请求内临时使用 BYOK Key；
- 首期支持 OpenAI-compatible Chat Completions；
- 内置 OpenAI、DeepSeek、OpenRouter 预设；
- 支持经过连接测试的公开 HTTPS 自定义兼容 Endpoint；
- 不允许 HTTP、IP 字面量、localhost、私网、URL 凭证或任意请求头；
- 不在托管与 BYOK、供应商或模型之间静默降级。

### 猎聘发现与筛选

- 只识别猎聘职位列表和公开详情页；
- 用户自己操作猎聘原生搜索与筛选器；
- 扫描只读取触发时已存在于当前 DOM 的职位；
- 不自动滚动、不点击下一页、不修改筛选条件；
- 去重只使用当前用户下的平台 + 职位 ID；
- 不计算标题、公司、招聘方或 JD 相似度；
- 不判断疑似重发，也不合并不同职位 ID；
- 首期每批默认 10 条，允许设置 1 到 20 条；
- 详情标签页串行打开，一次最多一个；
- 扩展发起的猎聘详情导航使用跨批次、跨 Reload 的设备级随机冷却，当前固定为 15 到 30 秒；详情页从创建起至少保留 8 秒，模型处理时间计入停留和冷却；
- 猎聘安全中心、拦截和短信验证页会立即暂停批次并切到前台交给用户处理，不自动关闭、填写或绕过验证；
- 详情通过运行时校验后立即保存 JD、招聘方和内容哈希，不依赖后续模型是否成功；
- 明确显示“已暂停招聘”的职位会立即记录具体失败原因并继续下一条，不等待详情超时、不调用模型或占用投递额度；
- 管理页的职位记录可直接查看已保存的完整 JD，无需重新打开猎聘；
- 处理失败且已有完整 JD 的记录可直接在管理页重试，重试不会重新打开猎聘详情页；
- 队列支持暂停、继续、取消和基于 chrome.alarms 的 MV3 恢复。

### JD 细筛

用户只能通过结构化控件启用以下五类规则，不能填写任意自然语言、关键词或正则：

1. 强制 985、211、双一流等学校背景要求；
2. 出差、驻点、外派和异地流动；
3. 外包、劳务派遣和长期客户驻场；
4. 夜班、倒班、大小周、单休和长期 on-call；
5. 从有限目录选择的不接受核心技术栈。

明确命中会排除，否定句不会命中，偏好或歧义表达进入人工复核。每个结果保留规则版本、原因和最小 JD 证据。

### LLM 判断与草稿

- LLM 在硬规则后返回 proceed、review 或 exclude；
- 真实模型提示词会明确 outcome 枚举、数组上限和证据格式，避免提示词与运行时校验规则不一致；
- 数字分数不能单独决定淘汰；
- 标题不同、缺一个技能或只缺加分项不能单独淘汰；
- 模型淘汰必须引用核心 JD 证据和画像冲突；
- 同一职位 ID 的模型淘汰会永久阻止自动重复处理；
- 用户仍可在记录中心选择“作为例外继续”，原判断不会被删除；
- 每个可继续职位生成一条当前招呼语草稿；
- 目标长度 80 到 140 个中文字符，绝对上限 200；
- 草稿必须关联一项 JD 要求和一到两项已批准事实；
- 联系方式、未经确认的求职承诺、Markdown 和无证据事实会被拒绝；
- 模型生成、用户编辑和重新生成都形成不可覆盖的修订历史。

### 人工确认投递并打招呼

- 只有 `draft_ready` 或可恢复的部分完成记录显示逐条发送入口；
- 第一步“准备发送”只做职位、登录、控件和草稿身份预检，不点击猎聘、不占用额度；
- 如果对应详情页尚未打开，“准备发送”会在后台自动打开并等待；如果扩展 Reload 使已有页面的 content context 失效，会自动刷新精确匹配的职位页一次；
- 第二步“确认真实投递并发送”才进入不可撤回的平台写入边界；
- live 命令只能来自扩展管理台，并绑定当前草稿修订 ID 与 SHA-256；
- 首期只使用猎聘已经选中的默认在线简历和已选附件简历，不上传或替换客户端原件；
- 猎聘的首次“聊一聊”可能自动发送平台默认问候，JobFlow 将它与自己的已审核草稿区分；
- 正式投递与自定义招呼语分别保存 attempted、verified 或 failed 证据；
- 只有聊天中出现简历卡片且出现与当前草稿完全一致的己方消息时，整体才是 succeeded；
- 只验证一个组成动作时显示 partial，重试不会重复 verified 的组成动作；
- 每个用户的猎聘每日上限默认 150，可在账号页设置 1 到 500，按 Asia/Shanghai 自然日计数；
- 同一职位的恢复重试复用一个额度，进入真实写入边界后额度不可释放。

### 自动投递执行策略

- 执行策略为三态：`draft_only` 只生成草稿，`reviewed_send` 生成后在管理台逐条确认，`automatic_send` 对当前 side panel 批次中模型判定 `proceed` 且草稿有效的职位自动投递并发送招呼语；
- `automatic_send` 只处理本次 side panel 明确选中的职位 ID，并把策略、授权时间和职位列表固化到批次快照；
- 只有模型直接判定 `proceed` 且生成有效草稿的职位会自动投递；模型 `review` 经用户“继续生成”后属于人工确认流程，不会被自动发送；
- 已有历史草稿、用户作为例外继续的草稿、复核项和模型/规则排除项不会因为开启自动模式而自动发送；
- 自动模式复用逐条确认的职位身份、草稿修订 SHA-256、最终预检、每日额度、写入边界、投递/招呼语独立证据和 verified 组件不重放规则；
- 当前开发调试阶段，automatic_send 在真正点击职位绑定的 `立即投递` 或招呼语发送控件、但页面没有回读证据时，会用 `application_click_assumed_success` / `greeting_click_assumed_success` 记为已发送并继续批次；这不是平台回读验证，`reviewed_send` 仍保持严格核验；
- 自动批次授权审计只保存 `automatic_batch_authorized` 和固定来源 `sidepanel_batch`，服务端以严格 allowlist 校验；
- 登录、验证码、风险控制、默认简历不明确、职位页 DOM 不明确或额度耗尽会在写入前暂停整个批次；
- 明确已暂停招聘或不可用的职位属于无写入终止结果，保留失败历史并继续后续职位，不要求用户反复恢复同一个职位；
- 自动批次从登录、Reload 或其他写入前阻塞恢复时复用已绑定的草稿 revision/hash，不重复写入详情或把 `draft_ready` 回退为 `extracting`；
- 写入开始后如果结果 partial、ambiguous 或不可回读，会记录组件状态并暂停批次，该职位后续只能通过逐条确认恢复；
- 任意 JobFlow 发起的猎聘真实写入都会为当前账号 + 当前设备 + 猎聘设置下一次自动写入时间；
- 自动写入间隔默认在 10 到 20 秒之间等概率抽取整数秒，可配置为 5 到 600 秒且最小值不能大于最大值；
- 详情导航冷却与真实写入间隔相互独立；前者限制页面访问节奏，后者限制投递写入节奏；
- 随机间隔只限制真实平台写入，不延迟扫描、详情读取、规则排除、模型调用或非写入结果；
- 随机间隔只能降低突发程度，不保证规避招聘网站风控。
- JobFlow 不伪造浏览器指纹、鼠标轨迹或用户行为，也不屏蔽平台风控脚本；导航冷却和最短停留只用于减少本产品自身的异常突发访问模式。

## 界面

- 猎聘页面右侧显示一个 42px 的轻量入口；
- 点击入口打开原生 Chrome side panel；
- side panel 负责扫描、预览、批次控制、进度和最近记录；
- 独立扩展管理页负责账号、执行策略、简历画像、规则、模型、人工复核、职位记录、待发草稿和单职位人工确认发送；
- 管理台异步命令在点击后立即禁用按钮并显示当前动作，同一职位的用户生成请求在 background 中保持单飞；
- content script 不再注入大型浮动面板；
- side panel 只有用户点击批次按钮时才可授权当前选中 ID 的自动批次；扫描、渲染和刷新不执行真实发送。

## 安全边界

以下约束是当前构建的硬边界：

1. 页面打开、扫描、刷新、设置保存、Chrome 启动和历史草稿查看都不能触发 live 写入；
2. 真实动作只来自管理台逐条 PREPARE/CONFIRM 或 side panel 显式授权的 `automatic_send` 当前批次；
3. 招聘站点点击和填写只允许出现在 job-bound reviewed-send 适配器中；
4. 不向招聘站点上传新文件，只能使用猎聘已经选中的在线/附件简历；
5. 不调用招聘站点私有写 API；
6. 不申请 cookies 权限；
7. 不读取、导出或保存招聘站点 Cookie；
8. host permissions 只包含猎聘和构建时指定的一个精确 Supabase origin；
9. 不添加 http://*/* 或 https://*/*；
10. 简历、JD 和模型输出均视为不可信输入；
11. 模型输出必须在服务端和客户端按结构与证据校验；
12. 日志、分析和错误记录不包含完整简历、完整 JD、消息正文、页面 DOM、提示词、原始模型输出、API Key 或 Authorization token；
13. `reviewed_send` 的投递和招呼语必须分别取得平台回读证据；`automatic_send` 的当前开发回退会显式记录点击假定证据，点击完成或无报错不能被描述成平台回读成功；
14. 测试 fixture 只使用合成数据；
15. 不把草稿、attempted 或 partial 描述成完整真实投递。

安全测试检查 manifest、源文件和最终构建中的已知危险模式。测试是回归防线，不是对所有动态行为的形式化证明。

## 目录

~~~text
.
├── src/
│   ├── backend/              # Supabase 公开客户端、RLS DTO 解码
│   ├── domain/               # 状态、事件、消息 schema、纯状态机
│   ├── local/                # IndexedDB 本地简历原件
│   ├── content/liepin.ts     # 猎聘入口和只读 DOM 桥
│   ├── platforms/liepin.ts   # 列表与详情提取
│   ├── background.ts         # Auth、队列、tab lease、Edge 调用
│   ├── filters.ts            # 五类 JD 规则
│   ├── prompt.ts             # 模型输入与双重输出校验
│   ├── pdf.ts / resume.ts    # 文件解析、哈希、画像生命周期
│   ├── sidepanel.*           # 猎聘工作台
│   └── options.*             # 完整管理台
├── supabase/
│   ├── migrations/           # 表、RLS、RPC、private schema
│   ├── functions/            # model-gateway
│   └── tests/                # pgTAP
├── tests/                    # Vitest 合成测试
├── scripts/
│   ├── build.mjs
│   ├── test-supabase-integration.mjs
│   └── smoke-extension.mjs
├── dist/                     # 已跟踪的 Chrome 构建产物
├── docs/adr/                 # 已确认的产品与架构决策
└── UBIQUITOUS_LANGUAGE.md    # 领域统一语言
~~~

## 环境要求

- Node.js 22 或更高版本；
- npm；
- Chrome 120 或更高版本；
- Supabase CLI；
- Docker 或兼容容器运行时，用于本地 Supabase；
- Playwright Chromium，只在自动 Chrome smoke 时需要。

当前开发验证使用了 Node.js 24、npm 11、Supabase CLI 2.109.1 和 Docker 28。

## 安装和基础验证

~~~bash
npm ci
npm run verify
~~~

npm run verify 会执行 TypeScript 类型检查、重建 dist，并运行 Vitest。它不会启动 Supabase。

可用命令：

~~~bash
npm run typecheck
npm run build
npm test
npm run verify
npm run test:db
npm run test:edge
npm run verify:full
npm run smoke:extension
~~~

## 本地 Supabase

启动并重放数据库：

~~~bash
supabase start
supabase db reset
supabase test db
~~~

启动 Edge Function：

~~~bash
supabase functions serve model-gateway
~~~

Supabase CLI 会输出本地 API URL 和 PUBLISHABLE_KEY。不要把本地 SECRET_KEY、SERVICE_ROLE_KEY、JWT secret 或任何远程项目密钥写入源码、README、命令脚本、测试或 Git。

在另一个终端用公开本地配置构建扩展：

~~~bash
JOBFLOW_SUPABASE_URL=http://127.0.0.1:54321 \
JOBFLOW_SUPABASE_PUBLISHABLE_KEY=<supabase status 输出的 PUBLISHABLE_KEY> \
npm run build
~~~

运行合成 Edge 集成测试：

~~~bash
JOBFLOW_SUPABASE_URL=http://127.0.0.1:54321 \
JOBFLOW_SUPABASE_PUBLISHABLE_KEY=<本地 PUBLISHABLE_KEY> \
npm run test:edge
~~~

该脚本拒绝任何非 http://127.0.0.1:54321 地址，不能误操作远程项目。

### 托管模型

本地 Edge Function 可通过未跟踪的环境文件或部署 secrets 配置：

~~~text
MANAGED_MODEL_ENDPOINT
MANAGED_MODEL_PROVIDER
MANAGED_MODEL_NAME
MANAGED_MODEL_API_KEY
~~~

托管模型只对 private.user_entitlements 中明确启用且具有额度的账号开放。当前仓库不包含托管模型 Key，也没有默认 VIP 用户。

## 构建配置和 host 权限

构建变量：

~~~text
JOBFLOW_SUPABASE_URL
JOBFLOW_SUPABASE_PUBLISHABLE_KEY
~~~

它们都是浏览器端公开配置，不能使用 Supabase secret/service-role key。

未设置 JOBFLOW_SUPABASE_URL 时，dist 只包含：

~~~text
https://*.liepin.com/*
~~~

设置后，构建脚本只追加该 URL 的精确 origin。npm test 和 npm run verify 会重新执行默认构建，因此会覆盖之前含本地或远程 Supabase 配置的 dist；Chrome 调试前需要按目标环境重新构建。

## Chrome 加载

1. 按目标 Supabase 环境运行 npm run build；
2. 打开 chrome://extensions；
3. 开启开发者模式；
4. 选择“加载已解压的扩展程序”；
5. 选择仓库中的 dist 目录；
6. 打开扩展管理页注册或登录；
7. 配置并测试模型；
8. 导入合成或自己的简历并审核画像；
9. 配置 JD 规则；
10. 打开猎聘职位列表页并刷新；
11. 点击页面右侧 JobFlow 图标打开 side panel。

修改源码后的刷新顺序：

~~~text
npm run build
→ chrome://extensions Reload
→ 刷新已打开的猎聘页面
~~~

只刷新网页不会更新 service worker；只 Reload 扩展不会替换已注入旧 content script 的页面。

## 使用流程

1. 注册并登录；
2. 选择 VIP 托管模型或配置 BYOK；
3. 用合成文本完成连接测试；
4. 导入简历并检查本地原件状态；
5. 审核事实，至少确认一条后启用画像；
6. 在猎聘使用原生筛选器；
7. 打开 side panel，点击扫描；
8. 检查观察、新职位、重复、排除和已有草稿计数；
9. 调整本批 1 到 20 条并点击开始生成；
10. 在 side panel 查看进度；
11. 在管理页处理复核、查看排除依据，或对已有 JD 的失败记录选择“使用已保存详情重试”；
12. 查看、编辑或重新生成草稿；
13. 使用默认 `reviewed_send` 时，需要真实投递就先打开对应猎聘详情页，在管理台选择“准备发送”；
14. 检查预检状态后选择“确认真实投递并发送”；
15. 使用显式选择的 `automatic_send` 时，只从 side panel 对当前勾选职位启动一次选中批次；模型判定可继续且草稿有效的职位会自动投递并打招呼；
16. 分别查看投递、招呼和整体状态，partial 只补做未验证组件；
17. 必要时对排除记录选择“作为例外继续”。

扫描和草稿生成均不表示已经向招聘方发送或投递；`reviewed_send` 只有 delivery record 的平台回读证据表示对应真实动作成功。当前 `automatic_send` 开发回退还会记录明确的点击假定完成，不能与平台回读验证混淆。

## 调试入口

- Service worker：chrome://extensions → JobFlow → Service Worker；
- 模型 schema 诊断：Service Worker Console 搜索 `[JobFlow:model-output-validation]`；只包含操作、字段类型和校验路径，不包含模型原文；
- 投递进度失败会显示允许列表中的数据库错误码（例如 `invalid_delivery_evidence` 或 `stale_delivery_hash`），不包含 SQL、草稿、JD 或 RPC 参数；
- content script：猎聘页面 DevTools，切换到扩展执行上下文；扩展打开的详情页如果最终 URL 没有 `#jobflow-lease`，应先看到 bounded `DETAIL_PAGE_READY` handshake，随后才是 `DETAIL_READY` 或带有限 `code` 的显式 `DETAIL_FAILED`；
- 招呼语回读：猎聘 IM 的己方文本行是 `.im-ui-txt.im-ui-send`，发送后最多等待 15 秒从当前聊天容器读取与草稿完全一致的文本；如果消息只在 App 或其他不可访问上下文可见，记录会保持“已尝试，待核验”，不会自动重发；
- side panel：在侧边栏内打开 DevTools；
- 管理页：打开扩展管理页后打开 DevTools；
- 本地数据：Application → Extension Storage 和 IndexedDB；
- Supabase：本地 Studio 默认由 supabase start 提供；
- Edge runtime：运行 supabase functions serve 的终端。

日志只能包含请求 ID、操作、路由、供应商/模型、耗时、计费单位、schema 结果和脱敏错误类别。

## 自动 Chrome smoke

先启动本地 Supabase 和 model-gateway，再用本地公开配置构建 dist，然后运行：

~~~bash
npm run smoke:extension
~~~

脚本使用临时 Chrome profile，创建合成未验证账号，检查管理台、窄管理窗口、side panel 和猎聘入口。扩展页面截图写入被 Git 忽略的 .artifacts；不保存猎聘页面截图。临时 Chrome profile 在结束后删除。

## 当前限制与后续

当前未实现：

- 批量 reviewed_send；
- 自动翻页、滚动和页面打开后自动执行；
- 招聘会话读取与回复；
- HR 明确拒绝判断；
- 邮箱、手机、微信等站外联系方式交换判断；
- 猎聘之外的平台真实发送证据和额度；
- BOSS 直聘等其他平台；
- 邮箱验证、密码找回、支付和订阅；
- OCR 和模型供应商原生协议。

已实现但仍待真实浏览器验收：

- `automatic_send` 选中批次的真实写入路径已经按合成测试实现，必须由管理台显式开启，并由 side panel 当前批次按钮授权本次勾选职位；
- 自动模式会复用 reviewed-send 的身份校验、最终预检、每日额度、写入边界、组件证据、随机间隔和恢复规则；
- 代码验证不能替代真实 Chrome/猎聘人工验收，因此在完成用户批准的手动验收前，不应把 automatic_send 描述为已通过猎聘现场验收。

猎聘 reviewed-send 与 automatic_send 默认每日值为 150，允许用户在 1 到 500 之间调整，按 Asia/Shanghai 自然日统计。这个值是产品设置，不是猎聘官方允许量。自动模式的随机写入间隔只降低突发程度，不保证规避招聘网站风控。

## 远程 Supabase

本仓库没有连接、迁移或部署任何远程 Supabase 项目。远程操作会改变外部状态，必须先明确目标项目并单独执行：

~~~text
supabase login
supabase link
supabase db push
supabase functions deploy
supabase secrets set
~~~

生产发布前至少还需要：

- 配置准确的远程 project origin；
- 审查所有 migration 与 RLS；
- 配置托管模型 secrets；
- 设置真实 VIP 权益和额度；
- 决定 Supabase Free 暂停与升级策略；
- 处理自定义 Endpoint 的 DNS rebinding 剩余风险；
- 完成 Chrome 小批量只读人工验收；
- 运行 secrets、个人资料和 dist 一致性扫描。

## 交付检查

~~~bash
npm ci
npm run verify
supabase db reset
supabase test db
npm audit
git diff --check
git status --short
git diff -- . ':!package-lock.json'
~~~

不要提交真实 API Key、简历、画像、Chrome profile/storage、Cookie、抓取页面、远程 Supabase secrets 或包含个人信息的日志。
