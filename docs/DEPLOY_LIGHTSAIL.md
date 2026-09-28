# Sharing：AWS Lightsail 部署操作手册

适用仓库：[TAO44123/Authright_Sharing](https://github.com/TAO44123/Authright_Sharing)。本文准备部署步骤及配置；不表示 AWS 环境已经上线。命令除特别说明外，均在 **Lightsail 的 Ubuntu SSH 终端**执行。

本地验证（2026-09-28，Docker Desktop/Linux ARM64）：Compose 配置解析、Docker 镜像构建、空库迁移、管理员初始化、Web 健康检查、OAuth discovery 运行时域名、Worker 暂停模式启动、Caddy 配置校验及 PostgreSQL 备份/新库恢复均通过。未验证 AWS 实例、公网证书、生产 Google 登录或真实供应商请求。构建时 Better Auth 会尝试访问占位数据库并输出连接拒绝日志，但构建退出码为 0，运行时连接真实测试库和 discovery 检查通过；后续可单独优化这一构建日志问题。

## 1. 目标和准备项

第一阶段：单台 Lightsail + Docker Compose，运行 Caddy、Web、Worker、PostgreSQL。公网只开放 HTTPS/HTTP 和受限 SSH；数据库不发布主机端口。数据库和证书使用 Docker 持久卷，Web/Worker 随主机启动自动恢复。这适合小规模试用，单机故障会影响全部服务。

| 项目 | 部署前填写/选择 |
| --- | --- |
| 实例 | Ubuntu 24.04 LTS，建议 2 vCPU / 4 GB RAM 起步，构建时观察内存 |
| Region | 靠近主要测试用户；数据库备份存储优先同 Region |
| 域名 | 示例 `sharing.example.com`，全文替换为实际域名 |
| IP | 为实例绑定 Lightsail Static IP |
| GitHub | 服务器使用此仓库的只读 Deploy key |
| Google | Workspace 内部 OAuth Web application；域 `authright.com` |
| 管理员 | 示例 `tao.xu@authright.com` |
| 密钥 | 新生产数据库密码、两份不同签名密钥、Google OAuth 凭据 |
| 内容处理 | 初次部署保持 `false`；供应商验证通过后再启用 |

实例、快照、备份及域名的费用以购买时 [AWS Lightsail 定价](https://aws.amazon.com/lightsail/pricing/) 为准。

配套文件：`deploy/lightsail/Dockerfile`、`compose.yaml`、`Caddyfile`、`.env.example`。**仓库根目录的 compose.yaml 只用于本地开发**，包含本地密码和测试数据库初始化，不能用于这里的部署。

## 2. 创建主机和 DNS

1. 创建 Linux/Unix、OS Only、Ubuntu 24.04 实例，保管 SSH 密钥。
2. 按 [AWS Static IP 指南](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html) 创建并绑定静态 IPv4；域名 A 记录指向该 IP。
3. Lightsail 网络防火墙开放 TCP 80、443；TCP 22 只允许自己的管理 IP。没有配置 IPv6 时不要添加 AAAA 记录；如果启用 IPv6，也要检查其独立防火墙。
4. 暂不启用额外 CDN/代理，让域名直接解析到实例，便于首次签发证书和验证 OAuth。
5. 开启 Lightsail 自动快照；第 8 节的数据库备份仍须单独配置。

Caddy 自动签发、续期证书和重定向 HTTP；需要 DNS 正确且公网能到达端口 80/443，证书数据必须持久保存。参见 [Caddy HTTPS 条件](https://caddyserver.com/docs/automatic-https)。本配置已挂载持久卷。

## 3. 安装 Docker 并拉取仓库

在新主机上按 [Docker 官方 Ubuntu 安装步骤](https://docs.docker.com/engine/install/ubuntu/#install-using-the-repository) 添加官方 apt 源，安装 Docker Engine 和 Compose plugin。不要在本地 Mac 执行这些 Ubuntu 安装步骤。

```bash
sudo apt update
sudo apt install -y git openssl
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

服务器专用 Deploy key（路径已有密钥时保留它，不覆盖）：

```bash
install -d -m 700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/sharing_github -C sharing-lightsail
cat ~/.ssh/sharing_github.pub
```

将公钥添加到 GitHub 仓库 **Settings → Deploy keys**，不勾选写权限。私钥保留在服务器。将以下配置追加到 `~/.ssh/config`，已有同名 Host 时先合并：

```text
Host github-sharing
    HostName github.com
    User git
    IdentityFile ~/.ssh/sharing_github
    IdentitiesOnly yes
```

首次 SSH 连接按 GitHub 官方公布的主机指纹核对提示，然后拉取代码：

```bash
chmod 600 ~/.ssh/config
sudo install -d -o ubuntu -g ubuntu /opt/sharing
git clone git@github-sharing:TAO44123/Authright_Sharing.git /opt/sharing
cd /opt/sharing
git log -1 --oneline
```

## 4. Google OAuth 和运行配置

在 Google Cloud Console 配置 Workspace **Internal** audience，创建 OAuth **Web application** 客户端：

- Authorized JavaScript origin：`https://sharing.example.com`
- Authorized redirect URI：`https://sharing.example.com/api/auth/callback/google`
- 使用现有应用的 `openid email profile` 权限，无需 Gmail 权限。

准备独立生产凭据。不要复制开发数据库或本地授权令牌；测试用户在新域名重新登录和授权。

```bash
sudo install -d -m 700 /etc/sharing
# 仅首次执行复制；后续直接编辑，避免覆盖已有配置。
sudo install -m 600 deploy/lightsail/.env.example /etc/sharing/lightsail.env
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
sudoedit /etc/sharing/lightsail.env
```

三次生成结果分别填数据库密码、`BETTER_AUTH_SECRET`、`CURSOR_SIGNING_SECRET`。数据库密码同时填入 `POSTGRES_PASSWORD` 和 `DATABASE_URL`，两处必须一致。这里使用 hex 避免连接串 URL 转义问题。两个签名密钥必须不同。填入实际域名（不含协议或路径）和 Google ID/secret，其余保留模板值。

`SHARING_IMAGE` 在下一节构建后填写。生产 secrets 位于 checkout 外，不进入 Git 或 Docker build context。不要把完整 `docker compose config` 的输出发到聊天中；检查时用 `--quiet`。已有 PostgreSQL 数据卷的密码不会随 `POSTGRES_PASSWORD` 修改而自动更换。

以下函数在当前 SSH shell 定义一次；每次重新连接后重新定义。它固定生产配置，避免误用开发 Compose：

```bash
dc() {
  sudo docker compose --env-file /etc/sharing/lightsail.env \
    -f /opt/sharing/deploy/lightsail/compose.yaml "$@"
}
```

## 5. 构建、迁移、启动

```bash
cd /opt/sharing
SHARING_RELEASE=$(git rev-parse --short HEAD)
sudo docker build -f deploy/lightsail/Dockerfile -t "sharing:$SHARING_RELEASE" .
echo "本次 SHARING_IMAGE=sharing:$SHARING_RELEASE"
sudoedit /etc/sharing/lightsail.env
# 把 SHARING_IMAGE 改成上一步显示的标签。
dc config --quiet
dc up -d --wait postgres
dc run --rm ops
dc run --rm ops node --import tsx scripts/bootstrap.ts tao.xu@authright.com
dc up -d --wait web worker caddy
dc ps
```

任何一步失败都应先处理再继续。`ops` 运行现有 Drizzle 迁移及 pg-boss 队列初始化；bootstrap 应在管理员首次 Google 登录前执行。若该邮箱已经是普通成员，脚本会拒绝静默提升权限。

镜像同时包含 Web、编译后的 Worker 和迁移工具；生产启动命令直接使用容器环境变量，无需容器内 `.env`。Web 在容器网络监听 `0.0.0.0:3000`，仅 Caddy 发布公网端口。为方便首版运维，镜像保留构建及迁移依赖，后续可再缩减体积。

构建只使用假配置，真实凭据在容器启动时注入。`node:24-bookworm-slim` 与 `caddy:2` 是可变标签，首次验证通过后记录实际镜像 ID/digest；应用每次使用 Git SHA 标签，保留上一版本镜像。后续基础镜像更新应单独验证后部署。

## 6. 上线验收

把下面域名改为实际值：

```bash
curl -fsS https://sharing.example.com/api/health
curl -I http://sharing.example.com
curl -fsS https://sharing.example.com/.well-known/oauth-protected-resource/mcp
curl -fsS https://sharing.example.com/.well-known/oauth-authorization-server/api/auth
dc logs --tail=100 web worker caddy
```

逐项记录结果：

- Health 返回 `status: ok` 和 `database: reachable`；HTTP 跳到 HTTPS，无证书警告。
- 两份 OAuth discovery 文档的 URL 全部使用生产域名，不含 localhost 或 `build.invalid`。
- 管理员 Google 登录成功；另一位 `@authright.com` 用户可自动加入，非公司账号不可访问。
- Web 保存链接成功，列表及详情可读；保持 processing=false 时，内容不会处理，不把 queued 当成内容处理成功。
- Worker 日志持续有 `worker_heartbeat`。Compose 的 `--wait` 只检查 Web/数据库健康和其他进程存活，不能证明 Worker 已完成任务。
- 将用于远程测试的 plugin/MCP 配置 URL 改为 `https://sharing.example.com/mcp`，重新完成 OAuth，并实际执行 `list_shares`、`share_link`、`get_share`。当前仓库本地 plugin 配置仍指向 localhost；远程打包、分发属于下一步工作。
- 在维护窗口执行主机重启，重新 SSH 后 `dc ps` 并再次检查 health、登录和 Worker 心跳；确认数据仍在。

基础服务验收后，再在 `/etc/sharing/lightsail.env` 填入真实 Gemini、YouTube API key 和正确 `GEMINI_BILLING_TIER`，改 `CONTENT_PROCESSING_ENABLED=true`，执行 `dc up -d worker`。这会处理既有积压任务。分别提交一篇文章、一条 YouTube 链接验证结果；YouTube 当前处理作者 Description，音轨分析尚未接入生产。Gemini 之前出现过 503，需重新验证供应商可用性，不能仅凭 Web 健康判定摘要可用。

## 7. 后续更新和回滚

每次发布先查看工作区和当前镜像，构建成功后再开始短暂维护窗口：

```bash
cd /opt/sharing
git status --short
dc images
git pull --ff-only origin main
SHARING_RELEASE=$(git rev-parse --short HEAD)
sudo docker build -f deploy/lightsail/Dockerfile -t "sharing:$SHARING_RELEASE" .
```

工作区有改动时先核对，不使用 reset 强行覆盖。记录旧 Git SHA、旧镜像标签；按第 8 节做备份，然后：

```bash
dc stop web worker
# 停止写入后再做一次第 8 节数据库备份，留作迁移前恢复点。
sudoedit /etc/sharing/lightsail.env
# 将 SHARING_IMAGE 改为新标签，其他值保留。
dc run --rm ops
dc up -d --wait web worker caddy
```

重新执行第 6 节验收。维护期间 Caddy 可能返回 502，不是零停机发布。

若新代码失败且数据库 schema 与旧代码兼容，将 `SHARING_IMAGE` 改回旧标签，再 `dc up -d --wait web worker caddy`。若迁移不兼容，停止 Web/Worker，按第 8 节恢复迁移前备份到新数据库，将 `DATABASE_URL` 指向该数据库，再启动旧镜像。该恢复会失去备份之后的写入，需要明确恢复时间点。保留旧源码/Compose 版本，以便同时回退配置变更。

不要执行 `docker compose down -v` 或清理正在使用的 volume；不要在确认回滚窗口结束前删除旧应用镜像。

## 8. 数据库备份和恢复演练

Docker volume 只保证容器重建后仍有数据，不能替代异机备份。每天至少做一次 PostgreSQL 逻辑备份，发布前另做一次；将副本保存到主机之外（例如加密的 S3 私有 bucket）。备份包含用户资料和授权数据，限制访问。以下备份针对初始 `sharing` 数据库；恢复切换数据库名后，也要修改备份命令中的 `-d`。

手动备份（使用前面定义的 dc 函数）：

```bash
install -d -m 700 /home/ubuntu/sharing-backups
umask 077
SHARING_BACKUP="/home/ubuntu/sharing-backups/sharing-$(date -u +%Y%m%dT%H%M%SZ).dump"
dc exec -T postgres pg_dump -U sharing -d sharing -Fc --no-owner --no-acl > "$SHARING_BACKUP"
test -s "$SHARING_BACKUP"
dc exec -T postgres pg_restore --list < "$SHARING_BACKUP" > /dev/null
```

备份命令失败时不要把文件视为可用。离机保存可先在**本地电脑**通过 `scp ubuntu@实际静态IP:/home/ubuntu/sharing-backups/实际文件名.dump ./` 下载，SSH key 参数按自己的连接配置填写。日常使用前必须再配置每日自动任务及离机上传，并检查任务退出状态/最后成功时间；本模板没有自动创建 S3、AWS 凭据或备份任务。建议保留至少 7 个日备份和 4 个周备份；磁盘告警、备份失败通知也应在正式邀请测试者前配置。

首次邀请测试者前，完成一次恢复演练。下列命令恢复到**新名字**的数据库，不覆盖当前数据库（仍使用刚才的备份文件）：

```bash
SHARING_RESTORE_DB="sharing_restore_$(date -u +%Y%m%d%H%M%S)"
dc exec -T postgres createdb -U sharing "$SHARING_RESTORE_DB"
dc exec -T postgres pg_restore -U sharing -d "$SHARING_RESTORE_DB" \
  --exit-on-error --no-owner --no-acl < "$SHARING_BACKUP"
dc exec -T postgres psql -U sharing -d "$SHARING_RESTORE_DB" \
  -c 'SELECT count(*) FROM members;'
```

真正恢复服务时：停 Web/Worker，记录原 DATABASE_URL，把 URL 的数据库名改为恢复库；确认代码镜像与备份 schema 匹配后，启动服务并验收。不要在未核对版本时自动跑新迁移。保留原库，确认恢复成功后再安排清理演练库。

## 9. 排查顺序

| 现象 | 优先检查 |
| --- | --- |
| 无法 HTTPS | DNS A/AAAA、静态 IP、Lightsail 防火墙、`dc logs caddy` |
| Caddy 502 / Web unhealthy | `dc logs web`、`dc ps`、数据库密码/迁移、真实环境变量 |
| Google redirect mismatch | Console 回调 URI 与实际域名必须逐字一致 |
| MCP 401 | 未授权请求通常预期 401；检查生产 discovery、客户端重新 OAuth、权限和连接是否已撤销 |
| 内容一直 queued | processing 开关、Worker 进程和心跳、两种供应商 key |
| Gemini 429 / 503 | 分别检查配额或服务可用性；503 本身不能证明免费额度耗尽 |
| 构建被 killed | 实例内存/磁盘；必要时升级实例或改为 CI 构建镜像 |
| 重建后丢数据 | 是否用了开发 Compose、不同 project 名称或误删 volume |

环境上线后记录：域名、Region、实例名、Git SHA、应用及基础镜像 ID、上线时间、验收结果、备份位置、恢复演练时间。随后再完成远程 plugin 安装指南及其他客户端兼容性测试。
