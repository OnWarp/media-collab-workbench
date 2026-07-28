# Cloudflare Workers 部署手册

本工作台后端 `worker.js` 采用 **Workers Static Assets + Durable Object + R2** 架构，可直接部署到 Cloudflare Workers，无需任何本地依赖或数据库服务。

架构分工：

- **Static Assets**：托管 `public/` 下的前端静态资源（HTML/CSS/JS）
- **Durable Object（`AppState`）**：在单一实例内串行读写全部业务状态（用户/选题/消息/结算等），避免并发写冲突
- **R2 Bucket（`UPLOADS`）**：保存上传的图片与视频文件
- **Worker 路由**：`/api/*` 和 `/uploads/*` 走 `run_worker_first`，其余路径直接返回静态资源

> 本地模式 `server.js`（依赖 Node `http` 与本地 `data/db.json`）**不能**直接部署到 Workers；云端请用 `worker.js`。

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

项目根目录的 **`wrangler.jsonc` 已经就绪**，无需从 `wrangler.jsonc.example` 复制。它已包含：

- `assets.directory: "./public"`，`run_worker_first: ["/api/*", "/uploads/*"]`
- `durable_objects` 绑定 `APP_STATE` → 类 `AppState`
- `migrations` 用 `new_sqlite_classes` 注册 `AppState` 类（免费套餐必需；注意不是 `new_classes`）
- `r2_buckets` 绑定 `UPLOADS` → bucket `media-collab-uploads`
- `observability.enabled: true`

> 可选增强：若日后用到 Node 内置 API，可在 `wrangler.jsonc` 加 `"compatibility_flags": ["nodejs_compat"]`。当前 `worker.js` 只用 Web 标准 API（Web Crypto / Fetch / FormData 等），不添加也能正常运行。

---

## 三、创建 R2 存储桶

```bash
npx wrangler r2 bucket create media-collab-uploads
```

桶名需全局唯一；若提示冲突，修改 `wrangler.jsonc` 中 `r2_buckets[0].bucket_name` 与 `worker.js` 中的引用保持一致即可。

---

## 四、设置运行时密钥（Secret）

Worker 运行时只需要一个密钥 `BOOTSTRAP_TOKEN`：用于首次创建管理员账号（对应 `worker.js` 中 `/api/bootstrap` 接口的 `x-bootstrap-token` 校验）。**切勿写入 `wrangler.jsonc` 的 `vars` 或提交进仓库。**

```bash
npx wrangler secret put BOOTSTRAP_TOKEN
```

提示输入时，粘贴一段足够长的随机字符串（例如 `openssl rand -hex 32` 生成）。记下这个值，后面初始化管理员和 GitHub Actions 都会用到。

> 除 `BOOTSTRAP_TOKEN` 外无需其他密钥：Durable Object 自身管理状态，不依赖外部数据库连接串。

---

## 五、本地验证（推荐先做）

```bash
npx wrangler dev
```

默认本地地址为 `http://localhost:8787`。开发模式下可直接读取已设置的 `BOOTSTRAP_TOKEN` Secret。

### 5.1 初始化首个管理员

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

## 六、部署到生产

```bash
npx wrangler deploy
```

该命令会：编译上传 `worker.js`、上传 `public/` 静态资源、注册/更新 Durable Object 命名空间、绑定 R2。部署完成后终端会给出生产域名（形如 `https://media-collab-workbench.<子域>.workers.dev`）。

### 6.1 在生产环境初始化管理员

用同样的方式对**生产域名**调用一次引导接口：

```bash
curl -X POST https://media-collab-workbench.<子域>.workers.dev/api/bootstrap \
  -H "content-type: application/json" \
  -H "x-bootstrap-token: <你的BOOTSTRAP_TOKEN>" \
  -d '{"username":"admin","displayName":"管理员","password":"至少10位的强密码"}'
```

随后在浏览器打开生产域名，用该管理员账号登录即可使用。

---

## 七、GitHub Actions 自动部署（推到 main 即上线）

推送（或合并）到 `main` 分支会自动触发 `.github/workflows/deploy-worker.yml`，无需手动登录服务器。该流水线一次完成：

1. `node --check worker.js` 语法校验
2. 创建 R2 桶 `media-collab-uploads`（已存在则忽略）
3. 写入运行密钥 `BOOTSTRAP_TOKEN`（仓库里配了该 Secret 才执行）
4. `wrangler deploy --config wrangler.jsonc` 正式部署

### 7.1 需要的仓库密钥

在 GitHub 仓库 **Settings → Secrets and variables → Actions → Repository secrets** 添加：

| 密钥名 | 作用 | 必填 |
|--------|------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token，需授予 **Workers Scripts 编辑** + **Durable Objects** + **R2** 权限 | 是 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID | 是 |
| `BOOTSTRAP_TOKEN` | Worker 运行时密钥，用于 `/api/bootstrap` 创建首个管理员；不配则跳过（部署仍可进行，但需自行用 `wrangler secret put` 设置后才能引导） | 建议 |

> 三者都通过 GitHub Encrypted Secrets 注入，**不会**写入仓库或出现在 Actions 日志明文里。

### 7.2 激活步骤

1. 把本仓库推到 GitHub（确保 `.github/workflows/deploy-worker.yml` 在 `main` 分支）。
2. 在仓库 Settings 添加上述三个 Secrets。
3. 之后任何推送到 `main` 的提交都会自动部署；也可在 **Actions → Deploy Cloudflare Worker → Run workflow** 手动触发（`workflow_dispatch`）。
4. 首次部署完成后，用 `BOOTSTRAP_TOKEN` 的值对生产域名调一次 `/api/bootstrap` 创建管理员（见 6.1）。

### 7.3 注意事项

- 修改 `wrangler.jsonc`（新增绑定、改桶名等）后，下一次 push 会自动 `wrangler deploy` 应用新配置，无需额外操作。
- `BOOTSTRAP_TOKEN` 只在「仓库里配置了该 Secret」时才由流水线写入；若改用 `wrangler secret put` 手动设置过，请勿在仓库重复配置不同的值，以免引导口令不一致。
- 流水线并发受 `concurrency` 限制：同名任务会排队，不会同时跑两个生产部署。

---

## 八、已有本地数据迁移（进阶，按需）

仅当你已有本地 `server.js` 运行产生的数据、且希望保留时才做。全新部署请直接走第五步引导。

1. **业务数据（`data/db.json` → Durable Object）**
   由于 Durable Object 在单一实例串行化写，不能直接把 `db.json` 当文件读。写一个一次性脚本：读取 `db.json`，逐条通过 `/api/*` 接口（或调用 Durable Object 的存储接口）写入。建议只迁移 `users`、`topics`、`comments`、`materials`、`weeklySettlements`、`announcements` 等核心集合，跳过会话与临时消息。

2. **上传文件（`public/uploads/` → R2）**
   用 wrangler 或 S3 兼容 API 批量上传：

   ```bash
   # 单文件示例
   npx wrangler r2 object put media-collab-uploads/<对象键> --file <本地文件>
   # 注意上传路径要与前端引用的 /uploads/... 对应
   ```

3. 迁移完成后，用引导接口创建管理员，再按需把迁移出的成员账号用 `/api/users` 接口补回（密码需重新设置）。

---

## 九、常见问题

- **部署报 `In order to use Durable Objects with a free plan, you must create a namespace using a new_sqlite_classes migration`（code 10097）**：免费套餐的 Durable Object 必须是 SQLite 后端。把 `wrangler.jsonc` 的 `migrations` 改成 `"new_sqlite_classes": ["AppState"]`（不是 `new_classes`）。改完重新部署即可，`AppState` 用的 `state.storage` KV 接口在 SQLite 后端下仍兼容。
- **部署报 `Class AppState is not defined`**：检查 `wrangler.jsonc` 中 `migrations` 是否包含 `AppState`（应为 `new_sqlite_classes`），且 `main` 指向 `worker.js`。
- **`/api/*` 返回 404 或静态页**：确认 `assets.run_worker_first` 包含 `/api/*`；否则请求会被当成静态资源处理。
- **上传图片/视频失败**：确认 R2 桶名与 `wrangler.jsonc` 中 `r2_buckets.bucket_name` 完全一致，且已 `wrangler secret put BOOTSTRAP_TOKEN`（上传接口会校验登录态）。
- **引导接口返回 403**：`x-bootstrap-token` 与 `BOOTSTRAP_TOKEN` Secret 不一致，或系统里已存在用户（引导只能用于空库）。
- **会话过期**：登录态 token 有效期 7 天，过期需重新登录。

---

## 十、安全要点（与本地一致）

Worker 端保留了 Node 版的全部安全加固：无默认账号（须引导创建）、PBKDF2(21万次) 密码哈希、7 天会话过期、仅允许 HTTP(S) 外链、回收站分级权限、上传大小与格式白名单。迁移或二次开发时请继续遵守这些规则。
