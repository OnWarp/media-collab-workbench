# Cloudflare Workers 部署说明

当前 `server.js` 依赖 Node 的 `http`、本地文件系统和 `data/db.json`，不能直接部署到 Cloudflare Workers。Workers 没有持久本地磁盘；把这个 JSON 直接迁到 KV 也会在并发写入时丢数据。

推荐的生产架构是：Workers Static Assets 托管 `public/`，一个 Durable Object 串行化处理业务状态，R2 保存上传图片和视频。`wrangler.jsonc.example` 已预置这三个绑定。

## 部署前准备

1. 安装 Node 20+，执行 `npm install -D wrangler`。
2. 将 `wrangler.jsonc.example` 复制为 `wrangler.jsonc`，为 R2 bucket 选择一个全局唯一名称。
3. 创建 bucket：`npx wrangler r2 bucket create media-collab-uploads`。
4. 将现有 JSON 数据迁到 Durable Object 的 SQLite 存储，将 `public/uploads/` 的文件迁到 R2；不要尝试上传 `data/db.json` 供 Worker 直接读取。
5. 用 `npx wrangler secret put ...` 写入管理员引导口令、会话/密码相关密钥等机密；绝不把它们放进 `vars` 或提交进仓库。
6. 本地执行 `npx wrangler dev`，验证后执行 `npx wrangler deploy`。

## GitHub 自动部署

推送到 `main` 会触发 `.github/workflows/deploy-worker.yml`。在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加：

- `CLOUDFLARE_API_TOKEN`：仅授予目标账户的 Workers Scripts 编辑权限，以及 Durable Objects、R2 所需权限。
- `CLOUDFLARE_ACCOUNT_ID`：目标 Cloudflare 账户 ID。

首次发布前，请在 Cloudflare 创建 `media-collab-uploads` bucket，并通过 Wrangler 或 Dashboard 为 Worker 配置运行时 secret `BOOTSTRAP_TOKEN`。这两个值绝不能写入仓库或 GitHub Actions 日志。

## 必须完成的后端迁移

`worker.js` 应把 `/api/*` 请求转给 `APP_STATE` Durable Object；Object 在单一实例中读写状态，上传接口把 `request.body` 流式写入 `UPLOADS`，下载则从 R2 返回对象。所有写操作应使用 Durable Object SQLite 事务；不要将整个数据库缓存进 Worker 全局变量。

现有 Node 后端已做以下安全加固：禁用默认账号、scrypt 密码哈希、7 天会话过期/登出、只允许 HTTP(S) 外链、回收站权限检查。迁移 Worker 路由时必须保留这些规则
