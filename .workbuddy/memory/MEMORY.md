# 项目记忆：media-collab-workbench

## 架构
- Cloudflare Workers 应用：`worker.js` + `wrangler.jsonc`。Workers Static Assets 托管 `public/` + **D1 数据库 `media-collab-db`**（绑定 `DB`，关系型 SQLite 持久化）+ R2 `UPLOADS`（桶名 `media-collab-uploads`）。
- 云端已**移除 Durable Object**：2026-07-28 由 Durable Object `AppState` 迁移至 D1。D1 表：users/sessions/topics/comments/materials/messages/weeklySettlements/announcements；JSON 字段以 TEXT 存；布尔用 INTEGER 0/1。
- 本地模式：`server.js`（零依赖 Node，scrypt 密码哈希，`data/db.json` 存储，`public/uploads/` 存文件）。`server.js` 是 CommonJS，`worker.js` 是 ESM，故 `package.json` 不能设 `type:module`。
- 注意密码算法差异：本地 server.js = scrypt；云端 worker.js = PBKDF2(SHA-256, 21万次)。迁移本地数据时必须重置密码（见迁移脚本）。

## 部署
- 手动：`npx wrangler deploy --config wrangler.jsonc`（先 `wrangler r2 bucket create media-collab-uploads`、`wrangler d1 create media-collab-db`、`wrangler d1 execute media-collab-db --remote --file=./migrations/0001_init.sql`、`wrangler secret put BOOTSTRAP_TOKEN`）。
- CI：`.github/workflows/deploy-worker.yml`，推送 `main` 自动部署。流程含：创建 R2、创建/复用 D1 并自动写入 `database_id`、执行 `0001_init.sql` 迁移、注入 `BOOTSTRAP_TOKEN`、部署。必需仓库 Secrets：`CLOUDFLARE_API_TOKEN`(需 Workers+D1+R2 权限)、`CLOUDFLARE_ACCOUNT_ID`；`BOOTSTRAP_TOKEN` 选填。
- 首次部署后：空库用 `BOOTSTRAP_TOKEN` 调 `/api/bootstrap` 建管理员；若已迁移历史数据则无需引导。

## 约定 / 坑
- `data/`、`public/uploads/`、`.env`、`.dev.vars`、`.wrangler/`、`node_modules/`、`media-collab-workbench/`（历史冗余嵌套副本）、`migrations/_migrated_seed.sql`（含临时密码哈希）均被 `.gitignore` 排除，切勿提交。
- `data/db.json` 含账号密码哈希，**绝不可提交**；历史上曾误提交，已 `git rm --cached` 但未清理历史。
- CI 校验 worker.js 语法：复制为 `.mjs` 再 `node --check`（规避 ESM/CJS 判定问题）。
- D1 `database_id` 用占位符 `__D1_DATABASE_ID__`，由 CI 经 `wrangler d1 list --json | jq` 注入临时 `wrangler.jsonc`；`wrangler d1 create` 步骤**不传 --config**，否则占位符会触发校验失败。
- 本地数据迁移：`node scripts/migrate-to-d1.mjs [--password <临时密码>] [--apply]`，生成 `migrations/_migrated_seed.sql` 并可选写入远端；scrypt→PBKDF2 不兼容故密码会被重置。
