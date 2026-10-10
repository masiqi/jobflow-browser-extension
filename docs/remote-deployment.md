# 远程开发环境部署

这是 Supabase CLI **开发栈**的远程运行方式，不是生产部署方案。正式服务优先使用
Supabase Cloud；这套脚本用于受隔离的开发/回退环境。

**启动前必须完成网络隔离。** CLI 可能把 API、数据库、Studio、邮件界面和其他
容器端口绑定到 `0.0.0.0`（以及 IPv6），并使用开发默认凭据。SSH 隧道不会阻止
其他人直接访问这些端口。本脚本不自动配置防火墙。必须在主机/网络边界使用对
Docker 发布端口生效的规则，阻断所有非授权来源，并从另一台机器验证不可访问；
不能只假设 UFW 的普通 INPUT 规则能拦住 Docker 转发。数据库、Studio 和邮件界面
不应对普通 LAN 用户开放。

这份说明把 JobFlow 的本地 Supabase 栈运行在一台 Linux 机器上，同时让
Chrome 扩展继续使用已经存在的精确本地 origin：
`http://127.0.0.1:54321`。

扩展不增加 `http://*/*`、局域网 IP 或其他宽泛 host permission。完成上述隔离后，浏览器通过
SSH 本地转发访问远端 API：本机 `127.0.0.1:54321` -> 远端回环地址
`127.0.0.1:15421`。因此构建配置和现有 origin 校验保持不变。

远端约定如下：

- 代码：`~/work/toys/jobflow-browser-extension`；
- 服务运行目录：`~/service/jobflow-browser-extension`；
- 远端 Supabase API 默认端口：`15421`；
- 远端数据库、Studio、Inbucket、Analytics 和 shadow database 使用其他独立端口；
- 数据卷由 Supabase/Docker 管理，安装、启动、停止和升级都不执行 `supabase db reset`。

下面的 `REMOTE_USER`、`REMOTE_HOST` 和 `LOCAL_CODE_DIR` 都是占位符。不要把真实
地址、密钥或模型 API Key 写进仓库。

## 远端前置条件

远端主机需要安装并可由当前用户运行：

- Docker Engine 或 Docker Desktop；
- Supabase CLI；
- Node.js 22+ 和 npm；
- systemd user services；
- Git（如果使用 Git 更新代码）。

模板固定使用 `/usr/bin/sg docker -c`：要求存在 `docker` 组、当前用户已加入该组，
且 Docker daemon 会在开机时启动；systemd 用户单元无法管理系统级 `docker.service`。
无根 Docker/其他组名需要另行调整模板，不直接适用。安装目录必须是绝对路径，且
只含英文字母、数字、`_`、`.`、`/`、`-`；空格和 shell/systemd 特殊字符会被拒绝。

先确认 SSH、Docker 和 Supabase CLI 可用：

```bash
ssh REMOTE_USER@REMOTE_HOST
docker version
supabase --version
systemctl --user --version
```

运行 Supabase 的用户需要能访问 Docker socket（通常是 `docker` 组成员）。如果
`systemctl --user` 启动时出现 `permission denied ... /var/run/docker.sock`，先确认：

```bash
id
sg docker -c 'docker ps'
```

模板会让两个用户服务通过 `sg docker -c` 运行；修改模板后重新运行安装器，再启动服务。

如果没有系统级 Supabase CLI，可以把固定版本安装到服务目录（不需要 sudo）：

```bash
cd "$HOME/work/toys/jobflow-browser-extension"
deploy/remote/install-supabase-cli.sh
```

如果希望用户服务在退出 SSH 后、或机器重启后仍自动恢复，可以在远端执行：

```bash
sudo loginctl enable-linger "$USER"
```

这一步不会启动 JobFlow，也不会修改数据库。

## 安装远端服务

先把代码放到约定路径。示例使用 Git，首次部署也可以使用其他经过审查的代码同步方式：

```bash
mkdir -p "$HOME/work/toys"
cd "$HOME/work/toys"
git clone <REPOSITORY_URL> jobflow-browser-extension
cd "$HOME/work/toys/jobflow-browser-extension"
npm ci
```

运行目录不需要复制整个仓库；安装脚本会在 `~/service/jobflow-browser-extension`
生成配置，并把 migrations、functions 和 seed 文件链接回代码目录：

```bash
cd "$HOME/work/toys/jobflow-browser-extension"
deploy/remote/install-supabase-cli.sh
deploy/remote/install-user-services.sh
```

安装器第一次运行会创建：

- `~/service/jobflow-browser-extension/runtime.env`：项目 ID 和独立端口，权限为 `0600`；
- `~/service/jobflow-browser-extension/supabase/config.toml`：由模板渲染，不改源码配置；
- `~/service/jobflow-browser-extension/model-gateway.env`：空的可选服务端模型配置，权限为 `0600`；
- `~/.config/systemd/user/jobflow-supabase.service`；
- `~/.config/systemd/user/jobflow-model-gateway.service`。

安装器不会覆盖已经存在的 `runtime.env` 或 `model-gateway.env`。要改端口，先停止
服务，编辑 `runtime.env`，再重新运行安装器；六个 Supabase 端口必须互不相同：

```bash
systemctl --user stop jobflow-model-gateway.service jobflow-supabase.service
editor "$HOME/service/jobflow-browser-extension/runtime.env"
cd "$HOME/work/toys/jobflow-browser-extension"
deploy/remote/install-user-services.sh
```

默认配置使用 API `15421`、数据库 `15422`、shadow database `15420`、Studio
`15423`、Inbucket `15424` 和 Analytics `15427`。这些只是模板默认值，可以在运行目录
中调整；不要让 API 端口与远端其他 Supabase 项目或已有服务重复。
`runtime.env` 只允许模板中的七个无引号字面量赋值，不执行 shell 展开，不允许额外
变量、前导零或重复端口。已安装实例不允许更改项目 ID，以免遗留或误停另一组容器。
一台用户环境只安装一对固定名称的 JobFlow 单元；不要用这些脚本安装第二个 JobFlow 实例。

## 启动、停止和查看日志

启动顺序由 systemd 依赖保证。Supabase 服务启动后，脚本只执行
`supabase migration up --local`，然后启动 model-gateway：

```bash
systemctl --user start jobflow-supabase.service
systemctl --user start jobflow-model-gateway.service
```

常用操作：

```bash
systemctl --user status jobflow-supabase.service jobflow-model-gateway.service
systemctl --user stop jobflow-model-gateway.service jobflow-supabase.service
systemctl --user restart jobflow-model-gateway.service
journalctl --user -u jobflow-supabase.service -f
journalctl --user -u jobflow-model-gateway.service -f
```

也可以从代码目录使用不暴露密钥的便捷包装脚本：

```bash
cd "$HOME/work/toys/jobflow-browser-extension"
deploy/remote/start.sh
deploy/remote/status.sh
deploy/remote/stop.sh
```

查看 Supabase 状态时，使用仓库提供的状态脚本；它只显示 endpoint，不会把 CLI 的
publishable/secret/service-role/JWT 输出到终端或 journal：

```bash
cd "$HOME/work/toys/jobflow-browser-extension"
deploy/remote/status.sh
```

原始 `supabase status` 和 `supabase status -o env` 会同时输出 secret/service-role/JWT 等敏感值，不要把完整输出
粘贴到聊天、Issue 或日志。如果只需要给本地构建取得公开 key，可以只输出
`PUBLISHABLE_KEY` 这一行的值：

```bash
SUPABASE_CLI="$HOME/service/jobflow-browser-extension/bin/supabase"
"$SUPABASE_CLI" --workdir "$HOME/service/jobflow-browser-extension" status -o env \
  | awk -F= '$1 == "PUBLISHABLE_KEY" { print substr($0, index($0, "=") + 1) }'
```

如果当前 Supabase CLI 只提供 `ANON_KEY`，它也是公开客户端 key，可以在构建变量
`JOBFLOW_SUPABASE_PUBLISHABLE_KEY` 中使用；不要使用 `SECRET_KEY`、
`SERVICE_ROLE_KEY` 或 JWT secret。

## 配置托管模型（可选）

BYOK 请求不需要托管模型密钥。如果要启用 VIP 托管模型，在远端编辑安装器创建的
文件，只填写服务端 secret，并保持权限：

```bash
chmod 600 "$HOME/service/jobflow-browser-extension/model-gateway.env"
editor "$HOME/service/jobflow-browser-extension/model-gateway.env"
systemctl --user restart jobflow-model-gateway.service
```

这个文件不会被浏览器构建读取。不要把填充后的文件复制回代码目录或提交到 Git。

## 建立 SSH 隧道

在开发机单独打开一个终端，保持 SSH 会话运行：

```bash
ssh -o ExitOnForwardFailure=yes -N \
  -L 127.0.0.1:54321:127.0.0.1:15421 \
  REMOTE_USER@REMOTE_HOST
```

如果本机 `54321` 已被旧的 Supabase 项目占用，需要先停止那个项目（停止不会重置
数据），或者在没有修改扩展 origin 校验的情况下释放该端口。隧道建立后，开发机的：

```text
http://127.0.0.1:54321
```

就是远端 Supabase API。只把 SSH 端口转发给可信用户，不要把私钥、密码或远端
Supabase secret 放进扩展构建变量。

## 在开发机重建扩展

在另一个开发机终端中，从当前代码目录构建。把上一步单独取得的公开 key 粘贴到
命令中；不要把真实 key 写入脚本或 Git：

```bash
cd LOCAL_CODE_DIR
JOBFLOW_SUPABASE_URL=http://127.0.0.1:54321 \
JOBFLOW_SUPABASE_PUBLISHABLE_KEY='<远端 status 输出的 PUBLISHABLE_KEY>' \
npm run build
```

构建后的 manifest 只增加 `http://127.0.0.1:54321/*`，不会增加远端 IP。打开
`chrome://extensions`，Reload JobFlow，再完整刷新招聘网站页面。远端 Supabase 是
一套新实例，第一次使用它时需要在扩展中重新注册或登录；本地旧实例的登录会话不会
自动迁移。

## 更新代码和迁移

先停止运行时服务，再更新代码。安装器会保留运行目录中的端口配置和模型 secret：

```bash
systemctl --user stop jobflow-model-gateway.service jobflow-supabase.service
cd "$HOME/work/toys/jobflow-browser-extension"
git pull --ff-only
npm ci
deploy/remote/install-user-services.sh
systemctl --user start jobflow-supabase.service
systemctl --user start jobflow-model-gateway.service
```

启动脚本会执行待执行的本地迁移。脚本不执行 `supabase db reset`，也不删除 Docker
volume；但迁移是可执行 SQL，更新前仍需审查迁移并备份数据库。启动或迁移失败时会
尝试停止该项目容器并保留卷。日志只显示脱敏失败阶段；需要详细 SQL 错误时由可信
管理员在主机上单独诊断，不把输出贴进公开日志，不要用 reset 代替排查。

## 防止误操作和数据丢失

- 不要执行 `supabase db reset`，除非明确要清空这台远端实例并已完成备份；
- 不要执行 `docker volume prune` 或删除 `supabase_db_*` 数据卷；
- 不要把 `supabase status -o env` 完整输出、`model-gateway.env`、用户简历、JD、
  Chrome profile 或 Cookie 提交到 Git；
- 在第一次启动前，验证 Docker 的全部发布端口都受到有效隔离；不要把开发默认凭据
  对应的数据库、Studio、邮件界面暴露给公网或不可信 LAN；
- SSH 隧道只是传输路径，不改变 JobFlow 的登录、RLS 或模型权限边界；
- 服务正常运行不等于完成 Chrome/招聘网站人工验收，真实平台动作仍按现有开发阶段
  策略执行。
