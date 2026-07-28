# 项目记忆：media-collab-workbench

## 架构
- Cloudflare Workers 应用：`worker.js` + `wrangler.jsonc`。Workers Static Assets 托管 `public/` + Durable Object `AppState` + R2 `UPLOADS`（桶名 `media-collab-uploads`）。
- 本地模式：`server.js`（零依赖 Node，`data/db.json` 存储，`public/uploads/` 存文件）。`server.js` 是 CommonJS，`worker.js` 是 ESM，故 `package.json` 不能设 `type:module`。

## 部署
- 手动：`npx wrangler deploy --config wrangler.jsonc`（需先 `wrangler r2 bucket create media-collab-uploads` 与 `wrangler secret put BOOTSTRAP_TOKEN`）。
- CI：`.github/workflows/deploy-worker.yml`，推送 `main` 自动部署。必需仓库 Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；`BOOTSTRAP_TOKEN` 选填。
- 首次部署后用 `BOOTSTRAP_TOKEN` 调一次 `/api/bootstrap` 创建管理员账号（空库才可用）。

## 约定 / 坑
- `data/`、`public/uploads/`、`.env`、`.dev.vars`、`.wrangler/`、`node_modules/`、`media-collab-workbench/`（历史冗余嵌套副本）均被 `.gitignore` 排除，切勿提交。
- `data/db.json` 含账号密码哈希，**绝不可提交**；历史上曾误提交，已 `git rm --cached` 但未清理历史。
- CI 校验 worker.js 语法：复制为 `.mjs` 再 `node --check`（规避 ESM/CJS 判定问题）。
