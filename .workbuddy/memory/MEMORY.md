# 项目记忆：media-collab-workbench

## 架构
- Cloudflare Workers 应用：`worker.js` + `wrangler.jsonc`。Workers Static Assets 托管 **`frontend/dist/`**（2026-07-29 起，SPA 回退）+ **D1 数据库 `media-collab-db`**（绑定 `DB`，关系型 SQLite 持久化）+ R2 `UPLOADS`（桶名 `media-collab-uploads`）。
- **前端已重构**：`frontend/` = React 19 + TS + Vite + @cloudflare/kumo v2.8（standalone 样式，无 Tailwind）。echarts 动态 import 按需加载；manualChunks 分包 echarts/vendor/kumo。`public/` 为旧原生 JS 前端，仅供本地 server.js 模式。kumo API 要点：Tabs 用 `selectedValue`/`tabs`，Select 用 `items` 对象映射，Badge variant 有 orange/purple/green/blue 等。phosphor-icons 本地 2.1.9 可编译，声明 ^2.1.10 供 CI。
- D1 迁移用 `wrangler d1 migrations apply --remote`（d1_migrations 表跟踪；0002 的 ALTER TABLE 不幂等，禁止改回 d1 execute 全量跑）。
- 云端已**移除 Durable Object**：2026-07-28 由 Durable Object `AppState` 迁移至 D1。D1 表：users/sessions/topics/comments/materials/messages/weeklySettlements/announcements；JSON 字段以 TEXT 存；布尔用 INTEGER 0/1。
- 本地模式：`server.js`（零依赖 Node，scrypt 密码哈希，`data/db.json` 存储，`public/uploads/` 存文件）。`server.js` 是 CommonJS，`worker.js` 是 ESM，故 `package.json` 不能设 `type:module`。
- 注意密码算法差异：本地 server.js = scrypt；云端 worker.js = PBKDF2(SHA-256, 21万次)。迁移本地数据时必须重置密码（见迁移脚本）。

## 部署
- 手动：`npx wrangler deploy --config wrangler.jsonc`（先 `wrangler r2 bucket create media-collab-uploads`、`wrangler d1 create media-collab-db`、`wrangler d1 execute media-collab-db --remote --file=./migrations/0001_init.sql`、`wrangler secret put BOOTSTRAP_TOKEN`）。
- CI：`.github/workflows/deploy-worker.yml`，推送 `main` 自动部署。流程含：创建 R2、准备 D1（机密变量 `D1_DATABASE_ID` 可选覆盖，否则自动创建并注入 `database_id`）、执行 `0001_init.sql` 迁移、注入 `BOOTSTRAP_TOKEN`、部署并捕获 Worker URL、若配置了 `ADMIN_USERNAME`+`ADMIN_PASSWORD` 则自动 `/api/bootstrap` 建管理员。必需仓库 Secrets：`CLOUDFLARE_API_TOKEN`(需 Workers+D1+R2 权限)、`CLOUDFLARE_ACCOUNT_ID`；可选：`BOOTSTRAP_TOKEN`、`D1_DATABASE_ID`、`ADMIN_USERNAME`、`ADMIN_PASSWORD`。
- 首次部署后：若已配 `ADMIN_USERNAME`/`ADMIN_PASSWORD` 则自动建管理员（仅空库生效）；否则手动用 `BOOTSTRAP_TOKEN` 调 `/api/bootstrap`；若已迁移历史数据则无需引导。

## 约定 / 坑
- `data/`、`public/uploads/`、`.env`、`.dev.vars`、`.wrangler/`、`node_modules/`、`media-collab-workbench/`（历史冗余嵌套副本）、`migrations/_migrated_seed.sql`（含临时密码哈希）均被 `.gitignore` 排除，切勿提交。
- `data/db.json` 含账号密码哈希，**绝不可提交**；历史上曾误提交，已 `git rm --cached` 但未清理历史。
- CI 校验 worker.js 语法：复制为 `.mjs` 再 `node --check`（规避 ESM/CJS 判定问题）。
- D1 `database_id` 用占位符 `__D1_DATABASE_ID__`，由 CI 经 `wrangler d1 list --json | jq` 注入临时 `wrangler.jsonc`；`wrangler d1 create` 步骤**不传 --config**，否则占位符会触发校验失败。
- 本地数据迁移：`node scripts/migrate-to-d1.mjs [--password <临时密码>] [--apply]`，生成 `migrations/_migrated_seed.sql` 并可选写入远端；scrypt→PBKDF2 不兼容故密码会被重置。
