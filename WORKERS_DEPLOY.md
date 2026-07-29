# Cloudflare Workers 部署手册

本工作台后端 `worker.mjs` 采用 **Workers Static Assets + D1 + R2** 架构，可直接部署到 Cloudflare Workers，无需任何本地依赖或自建数据库服务。

架构分工：

- **Static Assets**：托管 `frontend/dist/`（React 19 + Vite + @cloudflare/kumo 构建产物，SPA 模式）
- **D1 数据库（`media-collab-db`）**：关系型 SQLite，持久化全部业务数据（用户/选题/评论/素材/消息/结算/公告/会话）。通过 `wrangler.jsonc` 的 `d1_databases` 绑定以 `env.DB` 注入 worker。
- **R2 Bucket（`UPLOADS`）**：保存上传的图片与视频文件
- **Worker 路由**：`/api/*` 和 `/uploads/*` 走 `run_worker_first`，其余路径直接返回静态资源

> 本地模式 `server.js`（依赖 Node `http` 与本地 `data/db.json`）**不能**直接部署到 Workers；云端请用 `worker.mjs`。

---

## 一、前置条件

1. 安装 **Node.js 20+**（wrangler 运行需要）
2. 拥有一个 **Cloudflare 账户**（免费套餐即可）
3. 在本地安装 wrangler：

   ```bash
   npm install -D wrangler
   ```

4. 登录 Cloudflare（用于本地 `wrangler dev` / `wrangler deploy`）：

   ```bash
   npx wrangler login
   ```

---

## 二、确认配置文件

项目根目录的 **`wrangler.jsonc` 已经就绪**。它已包含：

- `assets.directory: "./frontend/dist"`，`run_worker_first: ["/api/*", "/uploads/*"]`，`not_found_handling: "single-page-application"`（本地手动部署前需先 `npm run build` 生成产物）
- `d1_databases` 绑定 `DB` → 数据库 `media-collab-db`（`database_id` 由 CI 自动写入；本地手动部署需先用 `wrangler d1 create` 拿到的 uuid 填好）
- `r2_buckets` 绑定 `UPLOADS` → bucket `media-collab-uploads`
- `observability.enabled: true`

> 可选增强：若日后用到 Node 内置 API，可在 `wrangler.jsonc` 加 `"compatibility_flags": ["nodejs_compat"]`。当前 `worker.mjs` 只用 Web 标准 API（Web Crypto / Fetch / FormData 等），不添加也能正常运行。

---

## 三、创建 R2 存储桶

```bash
npx wrangler r2 bucket create media-collab-uploads
```

桶名需全局唯一；若提示冲突，修改 `wrangler.jsonc` 中 `r2_buckets[0].bucket_name` 与 `worker.mjs` 中的引用保持一致即可。

---

## 四、创建 D1 数据库

```bash
npx wrangler d1 create media-collab-db
```

记下返回的 `database_id`（uuid），把它填进 `wrangler.jsonc` 的 `d1_databases[0].database_id`。

然后执行数据库迁移（`migrations/` 下的 SQL 会按文件名顺序执行，并由远端 `d1_migrations` 表跟踪、每个文件只执行一次）：

```bash
npx wrangler d1 migrations apply media-collab-db --remote
```

> GitHub Actions 会自动完成「创建/复用 D1 + 写入 database_id + migrations apply」，本地手动部署才需要上面两步。

---

## 五、设置运行时密钥（Secret）

Worker 运行时只需要一个密钥 `BOOTSTRAP_TOKEN`：用于首次创建管理员账号（对应 `worker.mjs` 中 `/api/bootstrap` 接口的 `x-bootstrap-token` 校验）。**切勿写入 `wrangler.jsonc` 的 `vars` 或提交进仓库。**

```bash
npx wrangler secret put BOOTSTRAP_TOKEN
```

提示输入时，粘贴一段足够长的随机字符串（例如 `openssl rand -hex 32` 生成）。记下这个值，后面初始化管理员和 GitHub Actions 都会用到。

> 除 `BOOTSTRAP_TOKEN` 外无需其他密钥：D1 通过绑定的 `database_id` 直接访问，不依赖外部数据库连接串。

---

## 六、本地验证（推荐先做）

```bash
npx wrangler dev
```

默认本地地址为 `http://localhost:8787`。开发模式下可直接读取已设置的 `BOOTSTRAP_TOKEN` Secret 与本地 D1。注意：本地 `wrangler dev` 若不指定 `--remote`，D1 默认用本地临时库；要连真实远端库请 `wrangler dev --remote`，或在本地先 `wrangler d1 execute ... --local` 初始化表结构。

### 6.1 初始化首个管理员

Worker 不会自动建账号。用刚才的 `BOOTSTRAP_TOKEN` 调一次引导接口：

```bash
curl -X POST http://localhost:8787/api/bootstrap \
  -H "content-type: application/json" \
  -H "x-bootstrap-token: <你的BOOTSTRAP_TOKEN>" \
  -d '{"username":"admin","displayName":"管理员","password":"至少10位的强密码"}'
```

成功后返回 `{"ok":true}`。之后即可用该账号在 `http://localhost:8787` 登录，其余成员通过登录页「注册成员」自助注册。

> 引导接口仅在**还没有任何用户**时可用，且必须携带正确的 `x-bootstrap-token`，用完即失效（再调用会返回 403）。

---

## 七、部署到生产

```bash
npm run build          # 构建前端 → frontend/dist
npx wrangler deploy
```

该命令会：编译上传 `worker.mjs`、上传 `frontend/dist/` 静态资源、绑定 D1 与 R2。部署完成后终端会给出生产域名（形如 `https://media-collab-workbench.<子域>.workers.dev`）。

### 7.1 在生产环境初始化管理员

用同样的方式对**生产域名**调用一次引导接口：

```bash
curl -X POST https://media-collab-workbench.<子域>.workers.dev/api/bootstrap \
  -H "content-type: application/json" \
  -H "x-bootstrap-token: <你的BOOTSTRAP_TOKEN>" \
  -d '{"username":"admin","displayName":"管理员","password":"至少10位的强密码"}'
```

随后在浏览器打开生产域名，用该管理员账号登录即可使用。

---

## 八、GitHub Actions 自动部署（推到 main 即上线）

推送（或合并）到 `main` 分支会自动触发 `.github/workflows/deploy-worker.yml`，无需手动登录服务器。该流水线一次完成：

1. `node --check worker.mjs` 语法校验（ESM 入口；仓库因 server.js 为 CommonJS 未启用 type:module，worker 入口用 .mjs 强制 ESM）
2. 安装并构建前端：`frontend/` 下 `npm ci && npm run build`（tsc 类型检查 + vite 构建 → `frontend/dist`），并校验产物存在
3. 创建 R2 桶 `media-collab-uploads`（已存在则忽略）
4. 准备 D1 数据库 `media-collab-db`：若配置了机密变量 `D1_DATABASE_ID` 则直接用它，否则自动创建并按名称取回 `database_id` 写回本次流水线的 `wrangler.jsonc`
5. `wrangler d1 migrations apply --remote`：按文件名顺序执行 `migrations/` 下的全部迁移（`d1_migrations` 表跟踪，只执行未跑过的）
6. 写入运行密钥 `BOOTSTRAP_TOKEN`（仓库里配了该 Secret 才执行）
7. `wrangler deploy --config wrangler.jsonc` 正式部署，并捕获 Worker URL
8. 若同时配置了 `BOOTSTRAP_TOKEN` + `ADMIN_USERNAME` + `ADMIN_PASSWORD`，自动调用 `/api/bootstrap` 创建管理员（仅空库生效）

### 8.1 需要的仓库密钥

在 GitHub 仓库 **Settings → Secrets and variables → Actions → Repository secrets** 添加：

| 密钥名 | 作用 | 必填 |
|--------|------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token，需授予 **Workers Scripts 编辑** + **D1 编辑** + **R2 编辑** 权限 | 是 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID | 是 |
| `BOOTSTRAP_TOKEN` | Worker 运行时密钥，用于 `/api/bootstrap` 创建首个管理员；不配则跳过（部署仍可进行，但需自行用 `wrangler secret put` 设置后才能引导） | 建议 |
| `D1_DATABASE_ID` | 可选。提供则直接使用该 D1 uuid，跳过自动创建 `media-collab-db`；不提供则 CI 自动创建 | 否 |
| `ADMIN_USERNAME` | 可选。与 `BOOTSTRAP_TOKEN` + `ADMIN_PASSWORD` 同时配置后，部署完成自动调用 `/api/bootstrap` 创建管理员（仅空库生效，用完即失效） | 否 |
| `ADMIN_PASSWORD` | 可选。初始管理员密码，至少 10 位 | 否 |

> 三者都通过 GitHub Encrypted Secrets 注入，**不会**写入仓库或出现在 Actions 日志明文里。

### 8.2 激活步骤

1. 把本仓库推到 GitHub（确保 `.github/workflows/deploy-worker.yml` 在 `main` 分支）。
2. 在仓库 Settings 添加上述三个 Secrets。
3. 之后任何推送到 `main` 的提交都会自动部署；也可在 **Actions → Deploy Cloudflare Worker → Run workflow** 手动触发（`workflow_dispatch`）。
4. 首次部署完成后：
   - 若已同时配置 `BOOTSTRAP_TOKEN` + `ADMIN_USERNAME` + `ADMIN_PASSWORD`，流水线会**自动**调用 `/api/bootstrap` 创建管理员（仅空库生效，成功后即失效），无需手动操作；
   - 否则用 `BOOTSTRAP_TOKEN` 的值对生产域名手动调一次 `/api/bootstrap` 创建管理员（见 7.1）。
   若改用迁移脚本灌入了历史数据（见第九节），则库非空，引导不会执行，也无需再引导。

### 8.3 注意事项

- `database_id` 不用手动维护：CI 每次按 `wrangler d1 list` 取回 uuid 注入临时 `wrangler.jsonc`，不影响仓库文件。
- 修改 `wrangler.jsonc`（新增绑定、改桶名等）后，下一次 push 会自动 `wrangler deploy` 应用新配置，无需额外操作。
- `BOOTSTRAP_TOKEN` 只在「仓库里配置了该 Secret」时才由流水线写入；若改用 `wrangler secret put` 手动设置过，请勿在仓库重复配置不同的值，以免引导口令不一致。
- 流水线并发受 `concurrency` 限制：同名任务会排队，不会同时跑两个生产部署。

---

## 九、已有本地数据迁移（进阶，按需）

仅当你已有本地 `server.js` 运行产生的 `data/db.json`、且希望保留时才做。全新部署请直接走第六步引导。

本地 `server.js` 用 scrypt 存储密码，而云端 D1 worker 用 PBKDF2(21 万次) 校验，二者不兼容，所以迁移时账号密码会被重置为统一临时密码。

1. **执行迁移脚本**

   ```bash
   # 生成迁移 SQL（自动生成临时密码并打印）
   node scripts/migrate-to-d1.mjs

   # 或指定统一临时密码
   node scripts/migrate-to-d1.mjs --password 'YourTempPass12'

   # 直接写入远端 D1（需已配置 CLOUDFLARE_API_TOKEN / ACCOUNT_ID）
   node scripts/migrate-to-d1.mjs --apply
   ```

   脚本会读取 `data/db.json`，把 `users / sessions / topics / comments / materials / messages / weeklySettlements / announcements` 转成 `migrations/_migrated_seed.sql`（已做 SQL 转义），再视情况调用 `wrangler d1 execute` 写入远端。

   - **注意**：`_migrated_seed.sql` 生成在 `migrations/` 目录下（已被 .gitignore 排除）。若你本地使用 `wrangler d1 migrations apply`，请先把该文件移出 `migrations/` 目录（或用 `--apply` 让脚本直接以 `d1 execute` 写入），避免被 migrations 机制重复登记执行；
   - `logs` 集合云端已移除，不迁移；
   - `messageRecycle` 已并入 `messages` 的软删除机制（`deleted=1` + `deletedAt`），不单独迁移；
   - 迁移后用脚本打印的临时密码登录，并尽快修改。

2. **上传文件（`public/uploads/` → R2）**

   ```bash
   npx wrangler r2 object put media-collab-uploads/<对象键> --file <本地文件>
   # 注意上传路径要与前端引用的 /uploads/... 对应
   ```

---

## 十、常见问题

- **`wrangler d1 execute` 报找不到数据库 / database_id 无效**：确认 `wrangler.jsonc` 的 `d1_databases[0].database_id` 是 `wrangler d1 create` 返回的 uuid；CI 会自动写入，本地手动部署需自己填。
- **`/api/*` 返回 404 或静态页**：确认 `assets.run_worker_first` 包含 `/api/*`；否则请求会被当成静态资源处理。
- **上传图片/视频失败**：确认 R2 桶名与 `wrangler.jsonc` 中 `r2_buckets.bucket_name` 完全一致，且已 `wrangler secret put BOOTSTRAP_TOKEN`（上传接口会校验登录态）。
- **引导接口返回 403**：`x-bootstrap-token` 与 `BOOTSTRAP_TOKEN` Secret 不一致，或系统里已存在用户（引导只能用于空库）。若已用迁移脚本灌入用户，则无需再引导。
- **迁移后登录提示密码错误**：旧库密码是 scrypt，云端要求 PBKDF2，迁移脚本已重置为临时密码；用脚本打印的临时密码登录即可。
- **会话过期**：登录态 token 有效期 7 天，过期需重新登录。

---

## 十一、安全要点（与本地一致）

Worker 端保留了 Node 版的全部安全加固：无默认账号（须引导或迁移创建）、PBKDF2(21 万次) 密码哈希、7 天会话过期、仅允许 HTTP(S) 外链、回收站分级权限、上传大小与格式白名单。迁移或二次开发时请继续遵守这些规则。
