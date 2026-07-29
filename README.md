# 自媒体内容协作工作台

> 选题进度跟踪 + 作品验收结算一体化后台，适用于小型自媒体团队协作

## 项目简介

这是一个面向小型自媒体团队的**内容协作管理平台**，覆盖从选题发布、认领接单、文案/视频制作、审核验收、流量回收到结算付款的全流程。支持本地零依赖部署（开箱即跑）和 Cloudflare Workers 云端部署两种模式。

- **技术栈**: 纯 Node.js 内置模块（本地零依赖后端） / Cloudflare Workers + D1 + R2（云端）
- **前端**: React 19 + TypeScript + Vite + [@cloudflare/kumo](https://github.com/cloudflare/kumo) 组件库（`frontend/`，构建产物部署到 Workers Static Assets）；`public/` 为旧版原生 JS 前端（仅供本地 `server.js` 模式使用）
- **存储**: JSON 文件（本地）/ Cloudflare D1（云端关系型 SQLite，持久化业务数据） + R2（文件上传）

## 核心功能

| 模块 | 说明 |
|------|------|
| 公告看板 | 公告文字 + 参考视频栏（管理员维护），用户接单进度看板 |
| 选题接单 | 发布选题（标题/简介/参考链接/文案/系列标签/截止时间）、认领、收藏、系列筛选 |
| 我的工作台 | 我认领的 / 我发布的 / 进行中 / 我的结算（多标签页） |
| 审核结算 | 管理员统一审核（文案/视频）、录入金额、确认结款、周结算批量处理、CSV 账单导出 |
| 视频流量 | 抖音/快手/小红书三平台多天数据填报，SVG 折线图对比，7 天填报期限 |
| 消息提醒 | 站内消息（认领/提交/审核/驳回/结算/评论/超时/弃单），已读 1 小时自动清理，消息回收站 7 天恢复 |
| 数据统计 | 个人数据（认领/完结/结算/稿酬）+ 团队总览（成员接单完工榜） |
| 回收站 | 废弃/删除选题进入回收站，30 天自动清除（可自定义保留天数） |
| 成员管理 | 管理员新建成员、设置接单上限 |
| 使用教程 | 新用户首次进入分步教程引导 |

## 工作流程

```
发布选题（pending） → 认领（in_progress） → 确认选题 → 文案制作 → 提交文案审核
                                                              ↓
                                                  [仅文案] 审核通过 → 完结
                                                  [全流程] 文案通过 → 视频制作 → 提交视频审核
                                                                                    ↓
                                                                        审核通过 → 完结 → 7天内填报流量 → 结算
```

**接单类型与定价**:
- 全流程（文案+视频）: ¥40
- 仅文案: ¥15

**角色权限**:
- **管理员(admin)**: 全部功能（审核、结算、周结算、成员管理、统计、永久删除、公告编辑）
- **成员(member)**: 发布/认领选题、提交作品、填报流量、查看个人数据、评论沟通

## 项目结构

```
media-collab-workbench/
├── server.js               # 本地后端服务（零依赖）
├── worker.mjs               # Cloudflare Workers 后端（D1 + R2 模式）
├── frontend/                # 新版前端工程（React 19 + Vite + kumo）
│   ├── src/                # 组件 / 视图 / API 封装 / 类型
│   ├── index.html          # Vite 入口
│   └── dist/               # 构建产物（wrangler 部署此目录，git 忽略）
├── public/                  # 旧版前端（仅本地 server.js 模式使用）
├── package.json             # 项目元信息（含 build 脚本）
├── start.bat                # Windows 一键启动
├── start.sh                 # macOS/Linux 一键启动
├── wrangler.jsonc           # Cloudflare Workers 配置（正式，含 D1/R2 绑定）
├── wrangler.jsonc.example   # Cloudflare Workers 配置模板
├── migrations/              # D1 数据库迁移（0001_init / 0002_features，按序执行）
├── scripts/                 # 运维脚本（如 migrate-to-d1.mjs 本地数据迁移）
├── 部署说明.txt              # 本地部署说明
├── WORKERS_DEPLOY.md        # Workers 部署说明
├── .github/workflows/
│   └── deploy-worker.yml    # GitHub Actions 自动部署（构建前端 → 迁移 D1 → 部署）
└── .gitignore
```

运行时自动生成:
- `data/db.json` — 全部业务数据（用户/选题/评论/素材/消息/日志/会话/结算记录/公告/消息回收站）
- `public/uploads/` — 图片和视频文件

## 两种部署模式

### 模式 A: 本地部署（零依赖）

**环境要求**: Node.js 16+（推荐 18+），无需 `npm install`

```bash
# 方式 1: 直接运行
node server.js

# 方式 2: npm 脚本
npm start

# 方式 3: 一键启动
# Windows: 双击 start.bat
# macOS/Linux: ./start.sh
```

访问 `http://localhost:3000`，局域网其他设备把 `localhost` 换成本机 IP。

**默认账号**（需设置环境变量 `ALLOW_INSECURE_DEMO_ACCOUNTS=true` 才会创建）:
- 管理员: `admin` / `admin123`
- 成员: `xiaoming` / `member123`

生产环境通过环境变量引导管理员:
```bash
BOOTSTRAP_ADMIN_USERNAME=myadmin BOOTSTRAP_ADMIN_PASSWORD=your_strong_password node server.js
```

**更换端口**: `PORT=8080 node server.js`

**数据备份**: 复制 `data/` 和 `public/uploads/` 两个目录即可。

### 模式 B: Cloudflare Workers 部署

架构: Workers Static Assets 托管 `frontend/dist/`（React 构建产物） + D1 数据库（`media-collab-db`，关系型 SQLite，持久化全部业务数据）+ R2 存储上传文件。D1 通过 `wrangler.jsonc` 的 `d1_databases` 绑定注入，无需自建数据库连接串，也不依赖 Durable Object。

```bash
# 1. 安装 wrangler
npm install -D wrangler

# 2. 创建 R2 bucket
npx wrangler r2 bucket create media-collab-uploads

# 3. 创建 D1 数据库并执行表结构迁移
npx wrangler d1 create media-collab-db
npx wrangler d1 execute media-collab-db --remote --file=./migrations/0001_init.sql

# 4. 设置 secret（首次创建管理员用）
npx wrangler secret put BOOTSTRAP_TOKEN

# 5. 本地测试
npx wrangler dev

# 6. 部署
npx wrangler deploy
```

推送到 `main` 分支会触发 GitHub Actions 自动部署（流水线会自动创建 R2、创建/复用 D1、执行表结构迁移、写入 `BOOTSTRAP_TOKEN`；若同时配置了 `BOOTSTRAP_TOKEN` + `ADMIN_USERNAME` + `ADMIN_PASSWORD` 还会在部署后自动创建管理员账号）。需要在仓库 Settings > Secrets 添加 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，建议再添加 `BOOTSTRAP_TOKEN`、以及可选的 `D1_DATABASE_ID`、`ADMIN_USERNAME`、`ADMIN_PASSWORD`。

如有本地 `server.js` 的历史数据需要保留，参见 [WORKERS_DEPLOY.md](./WORKERS_DEPLOY.md) 的「已有本地数据迁移」章节，用 `node scripts/migrate-to-d1.mjs` 灌入 D1。

详见 [WORKERS_DEPLOY.md](./WORKERS_DEPLOY.md)。

## 数据模型

云端（Cloudflare Workers）使用 D1 关系表，本地（Node `server.js`）使用 `data/db.json`。两端字段一一对应：

| D1 表 / JSON 键 | 说明 |
|------|------|
| `users` | 用户（username, displayName, salt, passwordHash, role, maxClaims, showTutorial） |
| `topics` | 选题（标题/简介/参考链接/文案/系列/工作类型/状态/阶段/认领人/截止时间/结算/流量/回收站） |
| `comments` | 选题评论 |
| `materials` | 选题素材版本 |
| `messages` | 站内消息（含 read/deleted 软删除标记，回收站由 deleted=1 表示） |
| `sessions` | 会话 token（7 天过期） |
| `weeklySettlements` | 周结算记录（topicIds 以 JSON 存储） |
| `announcements` | 公告栏（notice + referenceVideos，单例 id=1） |

> 云端版已移除独立的 `logs`（操作日志）集合与 `messageRecycle` 集合：`logs` 不再返回，`messageRecycle` 并入 `messages` 的软删除机制。JSON 数组/对象字段（referenceLinks、mediaLinks、series、favoritedBy、rejectedNotes、traffic、topicIds、referenceVideos 等）在 D1 中以 TEXT 存储，读写时做 JSON 序列化/反序列化。

## 安全设计

- **密码哈希**: 本地用 scrypt，Workers 用 PBKDF2（SHA-256, 21 万次迭代）
- **会话管理**: 7 天过期，登出即清除
- **默认账号**: 生产环境不自动创建，需通过环境变量引导
- **外链校验**: 仅允许 HTTP/HTTPS 协议链接
- **回收站权限**: 回收站选题按角色/发布者/认领人分级访问
- **文件上传**: 图片 3MB 上限，视频 25MB 上限，扩展名白名单
- **请求体限制**: 15MB JSON / 25MB multipart

## API 接口概览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login` | 登录 |
| POST | `/api/register` | 注册成员 |
| POST | `/api/logout` | 登出 |
| GET | `/api/me` | 当前用户信息 |
| POST | `/api/me/tutorial` | 标记教程已看 |
| GET/PUT | `/api/board` | 公告栏 |
| GET/POST | `/api/users` | 用户列表/新建成员 |
| PUT | `/api/users/:id` | 修改成员 |
| GET/POST | `/api/topics` | 选题列表/发布选题 |
| GET/PUT | `/api/topics/:id` | 选题详情/修改 |
| POST | `/api/topics/:id/claim` | 认领 |
| POST | `/api/topics/:id/abandon` | 弃单申请 |
| POST | `/api/topics/:id/abandon/approve` | 弃单审批 |
| POST | `/api/topics/:id/stage` | 阶段推进 |
| POST | `/api/topics/:id/submit/copy` | 提交文案审核 |
| POST | `/api/topics/:id/submit/video` | 提交视频审核 |
| POST | `/api/topics/:id/review` | 管理员审核（通过/驳回） |
| POST | `/api/topics/:id/deadline` | 设置截止时间 |
| POST | `/api/topics/:id/favorite` | 收藏切换 |
| POST | `/api/topics/:id/discard\|remove\|restore` | 废弃/删除/恢复 |
| DELETE | `/api/topics/:id/purge` | 永久删除（管理员） |
| POST | `/api/topics/:id/comment` | 评论 |
| POST | `/api/topics/:id/material` | 素材上传 |
| POST | `/api/topics/:id/traffic` | 流量填报 |
| POST | `/api/topics/:id/settle` | 结算 |
| POST | `/api/settle/week` | 周结算 |
| GET | `/api/settle/weekly` | 周结算记录 |
| GET | `/api/series` | 系列统计 |
| GET | `/api/messages` | 消息列表 |
| GET | `/api/messages/unread` | 未读数 |
| POST | `/api/messages/read` | 标记已读 |
| DELETE | `/api/messages/:id` | 删除消息 |
| GET | `/api/messages/recycle` | 消息回收站 |
| POST | `/api/messages/recycle/:id` | 恢复消息 |
| GET | `/api/pending` | 待办计数 |
| GET | `/api/stats/me` | 个人统计 |
| GET | `/api/stats` | 团队统计（管理员） |
| POST | `/api/upload` | 图片上传 |
| POST | `/api/upload/video` | 视频上传 |
| GET | `/api/export/bills` | 账单 CSV 导出 |

## 自动化清理机制

| 机制 | 周期 | 说明 |
|------|------|------|
| 回收站清除 | 每小时 | 超过保留天数（默认 30 天）的选题永久删除 |
| 已读消息清理 | 每分钟 | 已读超过 1 小时的消息移入消息回收站 |
| 消息回收站清除 | 每小时 | 超过 7 天的已删消息永久清除 |

## License

MIT
