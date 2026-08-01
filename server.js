/**
 * 小型自媒体内容协作工作台 —— 后端服务（零依赖，开箱即跑）
 * 运行：node server.js  然后访问 http://localhost:3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'frontend', 'dist');

// ===================== 数据层 =====================
let db = { users: [], topics: [], comments: [], materials: [], messages: [], logs: [], sessions: {}, weeklySettlements: [], announcements: [], messageRecycle: [] };
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const idCounters = {};

function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { /* ignore */ }
  }
  for (const k of ['users', 'topics', 'comments', 'materials', 'messages', 'logs', 'weeklySettlements', 'announcements', 'messageRecycle']) {
    if (!Array.isArray(db[k])) db[k] = [];
  }
  if (!db.sessions || Array.isArray(db.sessions) || typeof db.sessions !== 'object') db.sessions = {};
}
function saveDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const tmpFile = DB_FILE + '.tmp.' + Date.now();
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2));
    fs.renameSync(tmpFile, DB_FILE);
  } catch (e) {
    try { fs.unlinkSync(tmpFile); } catch {}
    throw e;
  }
}
function nextId(key) {
  if (idCounters[key] !== undefined) {
    idCounters[key]++;
    return idCounters[key];
  }
  const arr = db[key] || [];
  idCounters[key] = arr.length ? Math.max(...arr.map(x => x.id || 0)) : 0;
  idCounters[key]++;
  return idCounters[key];
}

// ===================== 工具函数 =====================
function hashPassword(password, salt) {
  // scrypt is deliberately expensive; plain SHA-256 makes password guessing cheap.
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function makeUser(username, displayName, password, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id: nextId('users'),
    username, displayName,
    salt,
    passwordHash: hashPassword(password, salt), passwordHashAlgo: 'scrypt',
    role,                 // 'admin' | 'member'
    maxClaims: role === 'admin' ? 999 : 10,
    showTutorial: true,   // 新人注册后首次进入展示使用教程
    createdAt: Date.now()
  };
}
function genToken() { return crypto.randomBytes(32).toString('hex'); }
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// 登录速率限制
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15分钟窗口
const RATE_LIMIT_MAX = 5; // 最大尝试次数

function checkRateLimit(ip) {
  const now = Date.now();
  const attempts = loginAttempts.get(ip) || [];
  const recentAttempts = attempts.filter(t => now - t < RATE_LIMIT_WINDOW);
  loginAttempts.set(ip, recentAttempts);
  return recentAttempts.length < RATE_LIMIT_MAX;
}

function recordLoginAttempt(ip) {
  const attempts = loginAttempts.get(ip) || [];
  attempts.push(Date.now());
  loginAttempts.set(ip, attempts);
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

function addLog(topicId, userId, action, detail) {
  db.logs.push({ id: nextId('logs'), topicId, userId, action, detail: detail || '', createdAt: Date.now() });
}
function addMessage(userId, topicId, content, type, target) {
  if (!userId) return;
  db.messages.push({ id: nextId('messages'), userId, topicId: topicId || null, content, type: type || 'info', target: target || null, read: false, readAt: null, deleted: false, createdAt: Date.now() });
}
// 通知所有管理员（用于审核提醒等）
function notifyAdmins(topicId, content, type, target) {
  db.users.filter(u => u.role === 'admin').forEach(u => addMessage(u.id, topicId, content, type, target));
}
function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function userName(id) {
  const u = db.users.find(x => x.id === id);
  return u ? u.displayName : '未知用户';
}

// 话题系列解析：支持数组，或 "#综艺 #泛生活" / "综艺 泛生活" 形式的字符串
function parseSeries(input) {
  let arr = [];
  if (Array.isArray(input)) arr = input;
  else if (typeof input === 'string') arr = input.split(/[#\s]+/).map(s => s.trim());
  return [...new Set(arr.filter(Boolean))].slice(0, 12);
}

// CSV转义函数（防止CSV注入）
function escapeCSV(value) {
  const str = String(value || '');
  if (/^[=+\-@\t\r]/.test(str)) {
    return "'" + str.replace(/"/g, '""');
  }
  return str.replace(/"/g, '""');
}

// 外链校验：只要「看起来是个链接」即可（宽松校验）
function isValidUrl(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  if (!s) return false;
  // 标准 http/https 链接
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {}
  return false;
}

// ===================== 鉴权 =====================
function getToken(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}
function authUser(req) {
  const token = getToken(req);
  if (!token || !db.sessions[token]) return null;
  const session = db.sessions[token];
  // Backward compatible with databases created before session expiry was added.
  const uid = typeof session === 'object' ? session.userId : session;
  if (typeof session === 'object' && session.expiresAt <= Date.now()) {
    delete db.sessions[token]; saveDB(); return null;
  }
  return db.users.find(u => u.id === uid) || null;
}

function passwordMatches(user, password) {
  const actual = user.passwordHash || '';
  const expected = user.passwordHashAlgo === 'scrypt'
    ? hashPassword(password, user.salt)
    : crypto.createHash('sha256').update(String(password) + user.salt).digest('hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function canAccessRecycledTopic(user, topic) {
  return !topic.recycledAt || user.role === 'admin' || topic.createdBy === user.id || topic.claimerId === user.id;
}

// ===================== HTTP 辅助 =====================
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 15e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}
// 解析 multipart/form-data（用于视频文件上传），返回 { file: { filename, buffer, mimetype } }
function readMultipart(req, contentType) {
  return new Promise((resolve, reject) => {
    const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!m) return reject(new Error('缺少 multipart boundary'));
    const boundary = '--' + (m[1] || m[2]).trim();
    const chunks = [];
    let size = 0;
    const LIMIT = 25 * 1024 * 1024; // 视频上限 25MB（内存缓冲安全限制）
    req.on('data', c => { size += c.length; if (size > LIMIT) { req.destroy(); reject(new Error('视频过大，上限 25MB')); } chunks.push(c); });
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('latin1');
        const parts = text.split(boundary);
        let file = null;
        for (const part of parts) {
          if (part === '--' || part === '' || part === '--\r\n' || part === '\r\n--') continue;
          const he = part.indexOf('\r\n\r\n');
          if (he < 0) continue;
          const header = part.slice(0, he);
          const disp = header.match(/name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
          if (!disp) continue;
          let content = part.slice(he + 4);
          if (content.endsWith('\r\n')) content = content.slice(0, -2);
          if (disp[2]) {
            const cm = header.match(/Content-Type:\s*([^\r\n]+)/i);
            file = { filename: disp[2], buffer: Buffer.from(content, 'latin1'), mimetype: cm ? cm[1].trim() : '' };
          }
        }
        resolve({ file });
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.ogg': 'video/ogg',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg'
};
function serveStatic(res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}
function serveUpload(res, urlPath) {
  const rel = urlPath.replace(/^\/uploads\//, '');
  const filePath = path.join(UPLOAD_DIR, path.normalize(rel));
  if (!filePath.startsWith(UPLOAD_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

// 计算选题的衍生状态（超时、阶段文案等）
const STAGE_LABELS = { confirm: '确认选题', copywriting: '文案制作', video: '视频制作', publish: '发布审核', done: '完结' };
const STATUS_LABELS = { pending: '待认领', in_progress: '制作中', review: '待审核', finished: '已完结' };
const SETTLE_LABELS = { unsettled: '待结算', settled: '已结算' };
const WORKTYPE_LABELS = { copywriting: '仅文案', full: '全流程' };
const PRICE = { copywriting: 15, full: 40 };
const RECYCLE_DAYS = 30; // 回收站保留天数，逾期自动永久删除
const MESSAGE_RECYCLE_DAYS = 7; // 消息回收站保留天数
const READ_DELETE_MS = 60 * 60 * 1000; // 已读 1 小时后自动删除
const PLATFORMS = ['douyin', 'kuaishou', 'xiaohongshu'];
const PLATFORM_LABELS = { douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书' };
const PLATFORM_COLORS = { douyin: '#fe2c55', kuaishou: '#ff6600', xiaohongshu: '#ff2442' };
const STAGES_FULL = ['confirm', 'copywriting', 'video', 'done'];
const STAGES_COPY = ['confirm', 'copywriting', 'done'];
function stageOrder(t) { return t.workType === 'copywriting' ? STAGES_COPY : STAGES_FULL; }
function defaultAmount(t) { return PRICE[t.workType] || 0; }

function decorateTopic(t) {
  const now = Date.now();
  const deadline = t.deadline ? new Date(t.deadline).getTime() : null;
  const overdue = deadline && (t.status === 'in_progress' || t.status === 'review') && now > deadline;
  let statusLabel = STATUS_LABELS[t.status] || t.status;
  if (t.status === 'review') statusLabel = (t.reviewStage === 'video' ? '视频待审' : '文案待审');
  const dispAmount = t.settlementAmount != null ? t.settlementAmount : defaultAmount(t);
  const needTraffic = t.workType === 'full' && t.status === 'finished' && t.trafficDueAt;
  let trafficDays = [];
  if (t.traffic) {
    if (Array.isArray(t.traffic.days)) trafficDays = t.traffic.days;
    else if (t.traffic.views !== undefined) trafficDays = [{ date: fmtDate(t.traffic.enteredAt), douyin: { views: +t.traffic.views || 0, likes: +t.traffic.likes || 0, favorites: +t.traffic.favorites || 0 }, kuaishou: { views: 0, likes: 0, favorites: 0 }, xiaohongshu: { views: 0, likes: 0, favorites: 0 } }];
  }
  const trafficFilled = trafficDays.length > 0;
  const trafficOverdue = needTraffic && !trafficFilled && now > t.trafficDueAt;
  const trafficTotals = {};
  PLATFORMS.forEach(p => {
    trafficTotals[p] = {
      views: trafficDays.reduce((s, d) => s + ((d[p] && +d[p].views) || 0), 0),
      likes: trafficDays.reduce((s, d) => s + ((d[p] && +d[p].likes) || 0), 0),
      favorites: trafficDays.reduce((s, d) => s + ((d[p] && +d[p].favorites) || 0), 0)
    };
  });
  const recycled = !!t.recycledAt;
  const recycleDays = t.recycleDays || RECYCLE_DAYS;
  let recycleDaysLeft = null;
  if (recycled) {
    const ms = (t.recycledAt + recycleDays * 86400000) - now;
    recycleDaysLeft = ms > 0 ? Math.ceil(ms / 86400000) : 0;
  }
  return {
    ...t,
    workTypeLabel: WORKTYPE_LABELS[t.workType] || t.workType,
    stageLabel: STAGE_LABELS[t.stage] || t.stage,
    statusLabel,
    settleLabel: SETTLE_LABELS[t.settlementStatus] || t.settlementStatus,
    displayAmount: dispAmount,
    overdue: !!overdue,
    trafficOverdue: !!trafficOverdue,
    recycled,
    recycledReason: t.recycledReason || null,
    recycledAt: t.recycledAt || null,
    recycleDays,
    recycleDaysLeft,
    createdAtLabel: fmtDateTime(t.createdAt),
    daysInLibrary: Math.max(0, Math.floor((now - t.createdAt) / 86400000)),
    trafficDays,
    trafficFilled,
    trafficTotals,
    series: Array.isArray(t.series) ? t.series : [],
    claimerName: t.claimerId ? userName(t.claimerId) : null,
    authorName: userName(t.createdBy),
    materialCount: db.materials.filter(m => m.topicId === t.id).length,
    commentCount: db.comments.filter(c => c.topicId === t.id).length
  };
}

// 超时提醒：读取列表时惰性生成消息
function maybeNotifyOverdue(topics) {
  const now = Date.now();
  for (const t of topics) {
    const deadline = t.deadline ? new Date(t.deadline).getTime() : null;
    if (deadline && (t.status === 'in_progress' || t.status === 'review') && now > deadline && !t.overdueNotified) {
      addMessage(t.claimerId, t.id, `选题《${t.title}》已超出交付截止时间，请尽快处理或申请弃单。`, 'overdue');
      t.overdueNotified = true;
      saveDB();
    }
  }
}

// ===================== 路由 =====================
async function handle(req, res) {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  const method = req.method;

  // ---- 静态资源 ----
  if (method === 'GET' && p.startsWith('/uploads/')) return serveUpload(res, p);
  if (method === 'GET' && !p.startsWith('/api/')) return serveStatic(res, p);

  // ---- API ----
  try {
    let body = {};
    if (method === 'POST' || method === 'PUT') {
      const ct = req.headers['content-type'] || '';
      if (ct.includes('multipart/form-data')) body = await readMultipart(req, ct);
      else body = await readBody(req);
    }

    // 登录 / 注册（无需鉴权）
    if (p === '/api/login' && method === 'POST') {
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      if (!checkRateLimit(ip)) {
        return json(res, 429, { error: '登录尝试过于频繁，请15分钟后重试' });
      }
      const { username, password } = body;
      const user = db.users.find(x => x.username === username);
      if (!user || !passwordMatches(user, password)) {
        recordLoginAttempt(ip);
        return json(res, 401, { error: '用户名或密码错误' });
      }
      clearLoginAttempts(ip);
      if (user.passwordHashAlgo !== 'scrypt') { user.passwordHash = hashPassword(password, user.salt); user.passwordHashAlgo = 'scrypt'; }
      const token = genToken();
      db.sessions[token] = { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS };
      saveDB();
      return json(res, 200, { token, user: publicUser(user) });
    }
    if (p === '/api/register' && method === 'POST') {
      const { username, password, displayName } = body;
      if (!username || !password) return json(res, 400, { error: '用户名和密码必填' });
      if (username.length < 3 || username.length > 32 || !/^[A-Za-z0-9_-]+$/.test(username)) {
        return json(res, 400, { error: '用户名需3-32位，仅支持字母、数字、下划线、连字符' });
      }
      if (password.length < 10) {
        return json(res, 400, { error: '密码至少需要10位' });
      }
      if (db.users.find(x => x.username === username)) return json(res, 400, { error: '用户名已存在' });
      const user = makeUser(username, displayName || username, password, 'member');
      db.users.push(user);
      saveDB();
      const token = genToken();
      db.sessions[token] = { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS };
      addMessage(user.id, null, `欢迎加入！点击「使用教程」可随时查看平台操作指引，祝你协作顺利 🎉`, 'system');
      saveDB();
      return json(res, 200, { token, user: publicUser(user) });
    }

    // 以下均需要鉴权
    const me = authUser(req);
    if (!me) return json(res, 401, { error: '未登录或登录已失效' });

    if (p === '/api/logout' && method === 'POST') {
      const token = getToken(req);
      if (token) delete db.sessions[token];
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (p === '/api/me' && method === 'GET') return json(res, 200, publicUser(me));

    // 新用户标记教程已看
    if (p === '/api/me/tutorial' && method === 'POST') {
      me.showTutorial = false;
      saveDB();
      return json(res, 200, { ok: true });
    }

    // 图片上传（结算证据等）：接收 base64 dataURL，落盘到 public/uploads
    if (p === '/api/upload' && method === 'POST') {
      const { name, data } = body;
      if (!data || typeof data !== 'string' || !data.startsWith('data:')) return json(res, 400, { error: '无效的文件数据' });
      const m = data.match(/^data:(image\/(png|jpe?g|gif|webp));base64,(.+)$/);
      if (!m) return json(res, 400, { error: '仅支持图片（PNG/JPG/GIF/WebP）' });
      const b64 = m[3];
      const buf = Buffer.from(b64, 'base64');
      if (buf.length > 3 * 1024 * 1024) return json(res, 400, { error: '图片过大，请勿超过 3MB' });
      const ext = m[2].replace('jpeg', 'jpg');
      const safeName = (Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext).replace(/[^a-zA-Z0-9.\-]/g, '');
      if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fs.writeFileSync(path.join(UPLOAD_DIR, safeName), buf);
      return json(res, 200, { url: '/uploads/' + safeName });
    }

    // 视频文件上传（线下视频文件，multipart/form-data），落盘到 public/uploads/videos
    if (p === '/api/upload/video' && method === 'POST') {
      const { file } = body;
      if (!file) return json(res, 400, { error: '未接收到视频文件' });
      const ext = (file.filename.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const allowed = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'ogg', 'mpg', 'mpeg'];
      if (!allowed.includes(ext)) return json(res, 400, { error: '仅支持视频格式：mp4 / webm / mov / avi / mkv 等' });
      if (file.buffer.length > 25 * 1024 * 1024) return json(res, 400, { error: '视频过大，上限 25MB' });
      const safeName = (Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext).replace(/[^a-zA-Z0-9.\-]/g, '');
      const dir = path.join(UPLOAD_DIR, 'videos');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, safeName), file.buffer);
      return json(res, 200, { url: '/uploads/videos/' + safeName });
    }

    // 公告栏（参考视频栏）：成员只读，管理员可改
    if (p === '/api/board' && method === 'GET') {
      return json(res, 200, db.announcements[0] || { notice: '', referenceVideos: [] });
    }
    if (p === '/api/board' && method === 'PUT') {
      if (me.role !== 'admin') return json(res, 403, { error: '仅管理员可编辑公告栏' });
      const { notice, referenceVideos } = body;
      let board = db.announcements[0];
      if (!board) { board = { id: nextId('announcements'), notice: '', referenceVideos: [] }; db.announcements.push(board); }
      if (notice !== undefined) board.notice = (notice || '').trim();
      if (Array.isArray(referenceVideos)) {
        board.referenceVideos = referenceVideos
          .filter(v => v && v.url && isValidUrl(v.url))
          .map(v => ({ title: (v.title || '').trim(), url: v.url.trim() }));
      }
      saveDB();
      return json(res, 200, board);
    }

    // ---- 用户管理（管理员）----
    if (p === '/api/users' && method === 'GET') {
      if (me.role !== 'admin') return json(res, 403, { error: '无权限' });
      return json(res, 200, db.users.map(publicUser));
    }
    if (p === '/api/users' && method === 'POST') {
      if (me.role !== 'admin') return json(res, 403, { error: '无权限' });
      const { username, password, displayName, maxClaims } = body;
      if (!username || !password) return json(res, 400, { error: '用户名和密码必填' });
      if (username.length < 3 || username.length > 32 || !/^[A-Za-z0-9_-]+$/.test(username)) {
        return json(res, 400, { error: '用户名需3-32位，仅支持字母、数字、下划线、连字符' });
      }
      if (password.length < 10) {
        return json(res, 400, { error: '密码至少需要10位' });
      }
      if (db.users.find(x => x.username === username)) return json(res, 400, { error: '用户名已存在' });
      const user = makeUser(username, displayName || username, password, 'member');
      if (maxClaims) user.maxClaims = Math.max(1, parseInt(maxClaims, 10) || 10);
      db.users.push(user);
      saveDB();
      return json(res, 200, publicUser(user));
    }
    if (/^\/api\/users\/\d+$/.test(p) && method === 'PUT') {
      if (me.role !== 'admin') return json(res, 403, { error: '无权限' });
      const id = parseInt(p.split('/')[3], 10);
      const user = db.users.find(x => x.id === id);
      if (!user) return json(res, 404, { error: '用户不存在' });
      if (body.maxClaims) user.maxClaims = Math.max(1, parseInt(body.maxClaims, 10) || user.maxClaims);
      if (body.displayName) user.displayName = body.displayName;
      saveDB();
      return json(res, 200, publicUser(user));
    }

    // ---- 选题列表 ----
    if (p === '/api/topics' && method === 'GET') {
      const q = u.searchParams;
      let list = db.topics.slice();
      // 回收站：默认隐藏已废弃/删除的选题；?recycled=1 仅列出回收站内容
      if (q.get('recycled') === '1') {
        list = list.filter(t => t.recycledAt);
        if (me.role !== 'admin') list = list.filter(t => t.createdBy === me.id || t.claimerId === me.id);
      } else {
        list = list.filter(t => !t.recycledAt);
      }
      if (q.get('status')) list = list.filter(t => t.status === q.get('status'));
      if (q.get('stage')) list = list.filter(t => t.stage === q.get('stage'));
      if (q.get('settlement')) list = list.filter(t => t.settlementStatus === q.get('settlement'));
      if (q.get('workType')) list = list.filter(t => t.workType === q.get('workType'));
      if (q.get('series')) list = list.filter(t => (t.series || []).includes(q.get('series')));
      if (q.get('traffic') === '1') list = list.filter(t => t.workType === 'full' && t.status === 'finished');
      if (q.get('mine') === '1') list = list.filter(t => t.claimerId === me.id);
      if (q.get('author') === '1') list = list.filter(t => t.createdBy === me.id);
      if (q.get('favorite') === '1') list = list.filter(t => (t.favoritedBy || []).includes(me.id));
      if (q.get('claimer')) list = list.filter(t => t.claimerId === parseInt(q.get('claimer'), 10));
      const kw = (q.get('keyword') || '').trim();
      if (kw) list = list.filter(t => (t.title + t.intro).toLowerCase().includes(kw.toLowerCase()));
      const sort = q.get('sort') || 'updated';
      if (sort === 'library_desc') list.sort((a, b) => a.createdAt - b.createdAt);      // 在库最久在前
      else if (sort === 'library_asc') list.sort((a, b) => b.createdAt - a.createdAt);   // 最新入库在前
      else list.sort((a, b) => b.updatedAt - a.updatedAt);                               // 最近更新（默认）
      maybeNotifyOverdue(list);
      return json(res, 200, list.map(decorateTopic));
    }

    // ---- 话题系列统计（按数量排序）----
    if (p === '/api/series' && method === 'GET') {
      const counts = {};
      db.topics.forEach(t => {
        if (t.recycledAt) return;
        (t.series || []).forEach(s => { if (s) counts[s] = (counts[s] || 0) + 1; });
      });
      const arr = Object.keys(counts).map(name => ({ name, count: counts[name] })).sort((a, b) => b.count - a.count);
      return json(res, 200, arr);
    }

    // ---- 发布选题 ----
    if (p === '/api/topics' && method === 'POST') {
      const { title, intro, referenceLinks, copyText, mediaLinks, deadline, workType, series } = body;
      if (!title || !title.trim()) return json(res, 400, { error: '选题标题必填' });
      // 外链校验
      const refs = Array.isArray(referenceLinks) ? referenceLinks.filter(Boolean) : [];
      const medias = Array.isArray(mediaLinks) ? mediaLinks.filter(Boolean) : [];
      for (const r of refs) if (!isValidUrl(r)) return json(res, 400, { error: `参考链接格式不合法：${r}` });
      for (const m of medias) { if (!m.url || !isValidUrl(m.url)) return json(res, 400, { error: '图片/视频外链格式不合法' }); }
      const wt = workType === 'copywriting' ? 'copywriting' : (workType === 'full' ? 'full' : null);
      const topic = {
        id: nextId('topics'),
        title: title.trim(),
        intro: (intro || '').trim(),
        referenceLinks: refs,
        copyText: (copyText || '').trim(),
        mediaLinks: medias,
        workType: wt,
        series: parseSeries(series),
        status: 'pending',
        stage: 'confirm',
        reviewStage: null,
        createdBy: me.id,
        claimerId: null,
        claimedAt: null,
        deadline: deadline || null,
        rejectedNotes: [],
        settlementStatus: 'unsettled',
        settlementAmount: null,
        settlementDetail: '',
        favoritedBy: [],
        abandonRequested: false,
        abandonApproved: false,
        overdueNotified: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      db.topics.push(topic);
      addLog(topic.id, me.id, '发布选题', `发布了选题《${topic.title}》`);
      addMessage(me.id, topic.id, `你的选题《${topic.title}》已发布，等待成员认领。`, 'system');
      saveDB();
      return json(res, 200, decorateTopic(topic));
    }

    // ---- 选题详情 ----
    const detailMatch = p.match(/^\/api\/topics\/(\d+)$/);
    if (detailMatch && method === 'GET') {
      const id = parseInt(detailMatch[1], 10);
      const t = db.topics.find(x => x.id === id);
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (!canAccessRecycledTopic(me, t)) return json(res, 404, { error: '选题不存在' });
      return json(res, 200, {
        ...decorateTopic(t),
        comments: db.comments.filter(c => c.topicId === id).map(c => ({ ...c, userName: userName(c.userId) })).sort((a, b) => a.createdAt - b.createdAt),
        materials: db.materials.filter(m => m.topicId === id).map(m => ({ ...m, userName: userName(m.userId) })).sort((a, b) => a.createdAt - b.createdAt),
        logs: db.logs.filter(l => l.topicId === id).map(l => ({ ...l, userName: userName(l.userId) })).sort((a, b) => a.createdAt - b.createdAt)
      });
    }

    // ---- 选题修改（发布者 / 管理员）----
    if (detailMatch && method === 'PUT') {
      const id = parseInt(detailMatch[1], 10);
      const t = db.topics.find(x => x.id === id);
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (me.role !== 'admin' && t.createdBy !== me.id) return json(res, 403, { error: '仅发布者或管理员可修改选题' });
      if (t.status === 'finished' && me.role !== 'admin') return json(res, 400, { error: '已完结选题不可修改（管理员可改）' });
      const { title, intro, referenceLinks, copyText, mediaLinks, deadline, workType, series } = body;
      const refs = Array.isArray(referenceLinks) ? referenceLinks.filter(Boolean) : t.referenceLinks;
      const medias = Array.isArray(mediaLinks) ? mediaLinks.filter(Boolean) : t.mediaLinks;
      for (const r of refs) if (!isValidUrl(r)) return json(res, 400, { error: '参考链接格式不合法：' + r });
      for (const m of medias) { if (!m.url || !isValidUrl(m.url)) return json(res, 400, { error: '图片/视频外链格式不合法' }); }
      if (title !== undefined) { if (!title.trim()) return json(res, 400, { error: '选题标题必填' }); t.title = title.trim(); }
      if (intro !== undefined) t.intro = (intro || '').trim();
      if (referenceLinks !== undefined) t.referenceLinks = refs;
      if (copyText !== undefined) t.copyText = (copyText || '').trim();
      if (mediaLinks !== undefined) t.mediaLinks = medias;
      if (series !== undefined) t.series = parseSeries(series);
      if (deadline !== undefined) t.deadline = deadline || null;
      if (workType !== undefined) { const wt = workType === 'copywriting' ? 'copywriting' : (workType === 'full' ? 'full' : null); if (wt) t.workType = wt; }
      t.updatedAt = Date.now();
      addLog(t.id, me.id, '修改选题', '修改了选题《' + t.title + '》');
      saveDB();
      return json(res, 200, decorateTopic(t));
    }

    // ---- 认领 ----
    const claimMatch = p.match(/^\/api\/topics\/(\d+)\/claim$/);
    if (claimMatch && method === 'POST') {
      const t = db.topics.find(x => x.id === parseInt(claimMatch[1], 10));
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (t.status !== 'pending') return json(res, 400, { error: '该选题已被认领或不可认领' });
      // 接单类型：认领时确认（发布者未指定则由认领人选择）
      const reqWt = body.workType === 'copywriting' ? 'copywriting' : (body.workType === 'full' ? 'full' : null);
      const wt = reqWt || t.workType;
      if (!wt) return json(res, 400, { error: '请选择接单类型（全流程 / 仅文案）' });
      // 接单数量限制
      const active = db.topics.filter(x => x.claimerId === me.id && (x.status === 'in_progress' || x.status === 'review')).length;
      if (active >= me.maxClaims) return json(res, 400, { error: `已达接单上限（${me.maxClaims} 个）` });
      t.workType = wt;
      t.status = 'in_progress';
      t.stage = 'confirm';
      t.reviewStage = null;
      t.claimerId = me.id;
      t.claimedAt = Date.now();
      t.updatedAt = Date.now();
      addLog(t.id, me.id, '认领选题', `认领了选题《${t.title}》`);
      addMessage(t.createdBy, t.id, `${me.displayName} 认领了你的选题《${t.title}》。`, 'claim', { view: 'detail', topicId: t.id });
      addMessage(me.id, t.id, `你已认领选题《${t.title}》，请在文案阶段提交审核，全流程选题还需提交视频审核。`, 'system', { view: 'detail', topicId: t.id });
      saveDB();
      return json(res, 200, decorateTopic(t));
    }

    // ---- 弃单申请 ----
    const abandonMatch = p.match(/^\/api\/topics\/(\d+)\/abandon$/);
    if (abandonMatch && method === 'POST') {
      const t = db.topics.find(x => x.id === parseInt(abandonMatch[1], 10));
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (t.claimerId !== me.id) return json(res, 403, { error: '只有认领人可申请弃单' });
      if (t.status === 'finished') return json(res, 400, { error: '已完结选题不可弃单' });
      t.abandonRequested = true;
      t.updatedAt = Date.now();
      addLog(t.id, me.id, '申请弃单', `申请放弃选题《${t.title}》`);
      addMessage(t.createdBy, t.id, `${me.displayName} 申请放弃选题《${t.title}》，等待发布者/管理员审批。`, 'abandon');
      saveDB();
      return json(res, 200, decorateTopic(t));
    }

    // ---- 弃单审批（管理员/发布者）----
    const abandonApprove = p.match(/^\/api\/topics\/(\d+)\/abandon\/approve$/);
    if (abandonApprove && method === 'POST') {
      const t = db.topics.find(x => x.id === parseInt(abandonApprove[1], 10));
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (!t.abandonRequested) return json(res, 400, { error: '该选题未申请弃单' });
      if (me.role !== 'admin' && t.createdBy !== me.id) return json(res, 403, { error: '无审批权限' });
      t.abandonApproved = true;
      t.status = 'pending';
      t.stage = 'confirm';
      const oldClaimer = t.claimerId;
      t.claimerId = null;
      t.claimedAt = null;
      t.abandonRequested = false;
      t.rejectedNotes = [];
      t.updatedAt = Date.now();
      addLog(t.id, me.id, '弃单审批通过', `弃单申请已通过，选题重新进入待认领`);
      addMessage(oldClaimer, t.id, `你的弃单申请已通过，选题《${t.title}》已释放。`, 'system');
      saveDB();
      return json(res, 200, decorateTopic(t));
    }

    // ---- 阶段推进 ----
    const stageMatch = p.match(/^\/api\/topics\/(\d+)\/stage$/);
    if (stageMatch && method === 'POST') {
      const t = db.topics.find(x => x.id === parseInt(stageMatch[1], 10));
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (t.claimerId !== me.id) return json(res, 403, { error: '只有认领人可更新进度' });
      if (t.stage !== 'confirm') return json(res, 400, { error: '请从「提交文案审核 / 提交视频审核」进入下一阶段' });
      const order = stageOrder(t);
      const idx = order.indexOf(t.stage);
      const next = order[idx + 1] || t.stage;
      t.stage = next;
      t.updatedAt = Date.now();
      addLog(t.id, me.id, '更新进度', `进度推进至：${STAGE_LABELS[next]}`);
      addMessage(t.createdBy, t.id, `选题《${t.title}》进度更新为：${STAGE_LABELS[next]}。`, 'progress');
      saveDB();
      return json(res, 200, decorateTopic(t));
    }

    // ---- 提交文案审核 ----
    const submitCopy = p.match(/^\/api\/topics\/(\d+)\/submit\/copy$/);
    if (submitCopy && method === 'POST') {
      const t = db.topics.find(x => x.id === parseInt(submitCopy[1], 10));
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (t.claimerId !== me.id) return json(res, 403, { error: '只有认领人可提交' });
      if (t.status !== 'in_progress' || t.stage !== 'copywriting') return json(res, 400, { error: '当前阶段不可提交文案审核' });
      if (body.copyText !== undefined) t.copyText = (body.copyText || '').trim();
      t.status = 'review';
      t.reviewStage = 'copywriting';
      t.updatedAt = Date.now();
      addLog(t.id, me.id, '提交文案审核', `提交文案，等待审核`);
      addMessage(t.createdBy, t.id, `${me.displayName} 提交了选题《${t.title}》的文案，等待审核。`, 'submit', { view: 'detail', topicId: t.id });
      notifyAdmins(t.id, `选题《${t.title}》的文案已提交，请前往审核。`, 'submit', { view: 'review', topicId: t.id });
      saveDB();
      return json(res, 200, decorateTopic(t));
    }
    // ---- 提交视频审核（导入 / 已线下过审，需填链接）----
    const submitVideo = p.match(/^\/api\/topics\/(\d+)\/submit\/video$/);
    if (submitVideo && method === 'POST') {
      const t = db.topics.find(x => x.id === parseInt(submitVideo[1], 10));
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (t.claimerId !== me.id) return json(res, 403, { error: '只有认领人可提交' });
      if (t.workType !== 'full') return json(res, 400, { error: '仅全流程选题需要提交视频审核' });
      if (t.status !== 'in_progress' || t.stage !== 'video') return json(res, 400, { error: '当前阶段不可提交视频审核' });
      const submitMode = body.submitMode === 'offline' ? 'offline' : 'import';
      const videoLink = (body.videoLink || '').trim();
      if (!videoLink) return json(res, 400, { error: '请填写视频链接或上传文件后再提交审核' });
      if (!isValidUrl(videoLink) && !/^\/uploads\/videos\/[a-zA-Z0-9.-]+$/.test(videoLink)) return json(res, 400, { error: '视频链接仅支持 HTTP(S) 地址或本站已上传文件' });
      t.videoLink = videoLink;
      t.videoType = submitMode;
      if (submitMode === 'offline') {
        t.status = 'finished'; t.stage = 'done';
        t.trafficDueAt = Date.now() + 7 * 86400000;
        t.updatedAt = Date.now();
        addLog(t.id, me.id, '视频已线下过审·完结', `已线下过审，视频链接：${videoLink}`);
        addMessage(t.claimerId, t.id, `选题《${t.title}》已线下过审并完结，请在 7 天内于「视频流量」页填报三平台数据。`, 'review');
      } else {
        t.status = 'review';
        t.reviewStage = 'video';
        t.updatedAt = Date.now();
        addLog(t.id, me.id, '提交视频审核', `提交视频（导入），等待审核，链接：${videoLink}`);
        addMessage(t.createdBy, t.id, `${me.displayName} 提交了选题《${t.title}》的视频，等待审核。`, 'submit', { view: 'detail', topicId: t.id });
        notifyAdmins(t.id, `选题《${t.title}》的视频已提交，请前往审核。`, 'submit', { view: 'review', topicId: t.id });
      }
      saveDB();
      return json(res, 200, decorateTopic(t));
    }

    // ---- 管理员完结审核 ----
    const reviewMatch = p.match(/^\/api\/topics\/(\d+)\/review$/);
    if (reviewMatch && method === 'POST') {
      if (me.role !== 'admin') return json(res, 403, { error: '仅管理员可审核完结' });
      const t = db.topics.find(x => x.id === parseInt(reviewMatch[1], 10));
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (t.status !== 'review') return json(res, 400, { error: '该选题未处于待审核状态' });
      const { action, note } = body; // action: 'approve' | 'reject'
      if (action === 'approve') {
        if (t.reviewStage === 'copywriting') {
          if (t.workType === 'copywriting') {
            t.status = 'finished'; t.stage = 'done';
            addLog(t.id, me.id, '文案审核通过·完结', `仅文案选题已完结`);
            addMessage(t.claimerId, t.id, `选题《${t.title}》文案审核通过，已完结，可结算。`, 'review');
          } else {
            t.status = 'in_progress'; t.stage = 'video';
            addLog(t.id, me.id, '文案审核通过', `进入视频制作阶段`);
            addMessage(t.claimerId, t.id, `选题《${t.title}》文案审核通过，请进入视频制作。`, 'review');
          }
        } else if (t.reviewStage === 'video') {
          t.status = 'finished'; t.stage = 'done';
          t.trafficDueAt = Date.now() + 7 * 86400000; // 视频审核通过即完结，发布后一周内填报流量
          addLog(t.id, me.id, '视频审核通过·完结', `视频审核通过，选题完结`);
          addMessage(t.claimerId, t.id, `选题《${t.title}》视频审核通过已完结，请在 7 天内于「视频流量」页填报三平台播放/点赞/收藏数据。`, 'review');
        }
        t.updatedAt = Date.now();
      } else if (action === 'reject') {
        const backStage = t.reviewStage === 'video' ? 'video' : 'copywriting';
        t.status = 'in_progress';
        t.stage = backStage;
        t.rejectedNotes.push({ note: note || '需修改后重新提交', by: me.id, at: Date.now(), stage: t.reviewStage });
        t.updatedAt = Date.now();
        addLog(t.id, me.id, '驳回重制', `驳回${t.reviewStage === 'video' ? '视频' : '文案'}并附修改备注：${note || ''}`);
        addMessage(t.claimerId, t.id, `选题《${t.title}》${t.reviewStage === 'video' ? '视频' : '文案'}被驳回，修改备注：${note || '需修改后重新提交'}`, 'reject');
      } else {
        return json(res, 400, { error: 'action 必须为 approve 或 reject' });
      }
      saveDB();
      return json(res, 200, decorateTopic(t));
    }

    // ---- 设置截止时间 ----
    const deadlineMatch = p.match(/^\/api\/topics\/(\d+)\/deadline$/);
    if (deadlineMatch && method === 'POST') {
      const t = db.topics.find(x => x.id === parseInt(deadlineMatch[1], 10));
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (me.role !== 'admin' && t.createdBy !== me.id && t.claimerId !== me.id) return json(res, 403, { error: '无权限设置截止时间' });
      const { deadline } = body;
      if (deadline && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(deadline)) return json(res, 400, { error: '截止时间格式不合法' });
      t.deadline = deadline || null;
      t.overdueNotified = false;
      t.updatedAt = Date.now();
      addLog(t.id, me.id, '设置截止时间', deadline ? `交付截止：${deadline}` : '清除截止时间');
      saveDB();
      return json(res, 200, decorateTopic(t));
    }

    // ---- 收藏切换 ----
    const favMatch = p.match(/^\/api\/topics\/(\d+)\/favorite$/);
    if (favMatch && method === 'POST') {
      const t = db.topics.find(x => x.id === parseInt(favMatch[1], 10));
      if (!t) return json(res, 404, { error: '选题不存在' });
      t.favoritedBy = t.favoritedBy || [];
      const i = t.favoritedBy.indexOf(me.id);
      let fav = false;
      if (i >= 0) { t.favoritedBy.splice(i, 1); } else { t.favoritedBy.push(me.id); fav = true; }
      t.updatedAt = Date.now();
      saveDB();
      return json(res, 200, { favorited: fav });
    }

    // ---- 废弃 / 删除（进入回收站，30 天后自动清除）/ 恢复 / 永久删除 ----
    const recycleMatch = p.match(/^\/api\/topics\/(\d+)\/(discard|remove|restore)$/);
    if (recycleMatch && method === 'POST') {
      const t = db.topics.find(x => x.id === parseInt(recycleMatch[1], 10));
      if (!t) return json(res, 404, { error: '选题不存在' });
      const op = recycleMatch[2];
      if (op === 'restore') {
        if (me.role !== 'admin' && t.createdBy !== me.id && t.claimerId !== me.id) return json(res, 403, { error: '无权限恢复该选题' });
        if (!t.recycledAt) return json(res, 400, { error: '该选题不在回收站' });
        t.recycledAt = null; t.recycledReason = null; t.updatedAt = Date.now();
        addLog(t.id, me.id, '恢复选题', `选题从回收站恢复`);
        if (t.claimerId) addMessage(t.claimerId, t.id, `选题《${t.title}》已从回收站恢复。`, 'system');
      } else {
        const isAuthor = t.createdBy === me.id;
        const isClaimer = t.claimerId === me.id;
        const days = parseInt(body.days, 10);
        const recycleDays = (days >= 1 && days <= 365) ? days : RECYCLE_DAYS;
        if (op === 'discard') {
          if (me.role !== 'admin' && !isAuthor && !isClaimer) return json(res, 403, { error: '仅发布者 / 认领人 / 管理员可废弃选题' });
        } else { // remove（删除）
          if (me.role !== 'admin' && !isAuthor) return json(res, 403, { error: '仅发布者 / 管理员可删除选题' });
        }
        if (t.recycledAt) return json(res, 400, { error: '该选题已在回收站' });
        t.recycledAt = Date.now();
        t.recycledReason = op === 'discard' ? 'discard' : 'delete';
        t.recycleDays = recycleDays;
        t.updatedAt = Date.now();
        const reasonTxt = op === 'discard' ? '废弃' : '删除';
        addLog(t.id, me.id, reasonTxt + '选题', `选题《${t.title}》已进入回收站，${t.recycleDays} 天后自动清除`);
        addMessage(t.createdBy, t.id, `选题《${t.title}》已被${reasonTxt}，进入回收站（${t.recycleDays} 天内可恢复）。`, 'system', { view: 'detail', topicId: t.id });
        if (t.claimerId && t.claimerId !== t.createdBy) addMessage(t.claimerId, t.id, `选题《${t.title}》已被${reasonTxt}，进入回收站。`, 'system', { view: 'detail', topicId: t.id });
      }
      saveDB();
      return json(res, 200, decorateTopic(t));
    }
    // ---- 永久删除（管理员，仅回收站内选题）----
    const purgeMatch = p.match(/^\/api\/topics\/(\d+)\/purge$/);
    if (purgeMatch && method === 'DELETE') {
      if (me.role !== 'admin') return json(res, 403, { error: '仅管理员可永久删除' });
      const id = parseInt(purgeMatch[1], 10);
      const t = db.topics.find(x => x.id === id);
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (!t.recycledAt) return json(res, 400, { error: '该选题不在回收站，不能永久删除（请先废弃/删除）' });
      db.topics = db.topics.filter(x => x.id !== id);
      db.comments = db.comments.filter(c => c.topicId !== id);
      db.materials = db.materials.filter(m => m.topicId !== id);
      db.logs = db.logs.filter(l => l.topicId !== id);
      db.messages = db.messages.filter(m => m.topicId !== id);
      saveDB();
      return json(res, 200, { ok: true });
    }

    // ---- 评论 ----
    const commentMatch = p.match(/^\/api\/topics\/(\d+)\/comment$/);
    if (commentMatch && method === 'POST') {
      const t = db.topics.find(x => x.id === parseInt(commentMatch[1], 10));
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (!canAccessRecycledTopic(me, t)) return json(res, 404, { error: '选题不存在' });
      const { content } = body;
      if (!content || !content.trim()) return json(res, 400, { error: '评论内容不能为空' });
      const c = { id: nextId('comments'), topicId: t.id, userId: me.id, content: content.trim(), createdAt: Date.now() };
      db.comments.push(c);
      // 通知对方
      const other = t.claimerId && t.claimerId !== me.id ? t.claimerId : (t.createdBy !== me.id ? t.createdBy : null);
      if (other) addMessage(other, t.id, `${me.displayName} 在选题《${t.title}》评论区留言。`, 'comment');
      addLog(t.id, me.id, '发表评论', '在评论区留言');
      saveDB();
      return json(res, 200, { ...c, userName: me.displayName });
    }

    // ---- 素材版本 ----
    const matMatch = p.match(/^\/api\/topics\/(\d+)\/material$/);
    if (matMatch && method === 'POST') {
      const t = db.topics.find(x => x.id === parseInt(matMatch[1], 10));
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (t.claimerId !== me.id && me.role !== 'admin') return json(res, 403, { error: '只有认领人可上传素材' });
      const { url, note } = body;
      if (!url || !isValidUrl(url)) return json(res, 400, { error: '素材外链格式不合法' });
      const version = db.materials.filter(m => m.topicId === t.id).length + 1;
      const m = { id: nextId('materials'), topicId: t.id, userId: me.id, url, note: note || '', version, createdAt: Date.now() };
      db.materials.push(m);
      addLog(t.id, me.id, '留存素材', `上传第 ${version} 版素材`);
      saveDB();
      return json(res, 200, { ...m, userName: me.displayName });
    }

    // ---- 视频流量填报（认领人，全流程已完结，三平台多天）----
    const trafficMatch = p.match(/^\/api\/topics\/(\d+)\/traffic$/);
    if (trafficMatch && method === 'POST') {
      const t = db.topics.find(x => x.id === parseInt(trafficMatch[1], 10));
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (t.claimerId !== me.id) return json(res, 403, { error: '只有认领人可填报视频流量' });
      if (!(t.workType === 'full' && t.status === 'finished')) return json(res, 400, { error: '该选题暂无视频流量填报需求' });
      const days = Array.isArray(body.days) ? body.days : [];
      const norm = days.map(d => {
        const o = { date: (d.date || '').toString().slice(0, 10) };
        PLATFORMS.forEach(p => {
          const src = d[p] || {};
          o[p] = { views: Math.max(0, parseInt(src.views, 10) || 0), likes: Math.max(0, parseInt(src.likes, 10) || 0), favorites: Math.max(0, parseInt(src.favorites, 10) || 0) };
        });
        return o;
      }).filter(d => d.date).sort((a, b) => a.date.localeCompare(b.date));
      t.traffic = { days: norm, enteredAt: Date.now() };
      const tot = {};
      PLATFORMS.forEach(p => { tot[p] = norm.reduce((s, d) => s + d[p].views, 0); });
      addLog(t.id, me.id, '填报视频流量', `共 ${norm.length} 天 · 抖音播放 ${tot.douyin} · 快手播放 ${tot.kuaishou} · 小红书播放 ${tot.xiaohongshu}`);
      addMessage(t.createdBy, t.id, `${me.displayName} 填报了选题《${t.title}》的三平台视频流量数据。`, 'progress');
      saveDB();
      return json(res, 200, decorateTopic(t));
    }

    // ---- 结款 ----
    const settleMatch = p.match(/^\/api\/topics\/(\d+)\/settle$/);
    if (settleMatch && method === 'POST') {
      if (me.role !== 'admin') return json(res, 403, { error: '仅管理员可结算' });
      const t = db.topics.find(x => x.id === parseInt(settleMatch[1], 10));
      if (!t) return json(res, 404, { error: '选题不存在' });
      if (t.status !== 'finished') return json(res, 400, { error: '仅完结选题可结算' });
      const { amount, detail, action, evidence } = body; // action: 'save' | 'pay'
      const amt = (amount != null && amount !== '') ? (parseFloat(amount) || 0) : defaultAmount(t);
      if (amt < 0) return json(res, 400, { error: '结算金额不能为负数' });
      t.settlementAmount = amt;
      if (detail) t.settlementDetail = detail;
      if (Array.isArray(evidence)) t.settlementEvidence = evidence.filter(Boolean);
      if (action === 'pay') {
        t.settlementStatus = 'settled';
        t.settledAt = Date.now();
        addLog(t.id, me.id, '确认结款', `结算金额 ¥${t.settlementAmount}（${t.settlementDetail}）`);
        addMessage(t.claimerId, t.id, `选题《${t.title}》已结款：¥${t.settlementAmount}（${t.settlementDetail}）。`, 'settle');
      } else {
        addLog(t.id, me.id, '录入结算', `录入金额 ¥${t.settlementAmount}`);
      }
      t.updatedAt = Date.now();
      saveDB();
      return json(res, 200, decorateTopic(t));
    }

    // ---- 周结算：批量结算所有已完结待结算选题 ----
    if (p === '/api/settle/week' && method === 'POST') {
      if (me.role !== 'admin') return json(res, 403, { error: '无权限' });
      const pending = db.topics.filter(t => t.status === 'finished' && t.settlementStatus === 'unsettled');
      if (!pending.length) return json(res, 200, { ok: true, count: 0, total: 0, record: null });
      const now = Date.now();
      const d = new Date(now); const day = (d.getDay() + 6) % 7; // 周一为 0
      const monday = new Date(d); monday.setDate(d.getDate() - day); monday.setHours(0, 0, 0, 0);
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 7);
      let total = 0; const topicIds = [];
      for (const t of pending) {
        const amt = t.settlementAmount != null ? t.settlementAmount : defaultAmount(t);
        t.settlementAmount = amt;
        t.settlementStatus = 'settled';
        t.settlementDetail = t.settlementDetail || '周结算';
        t.settledAt = now;
        total += amt; topicIds.push(t.id);
        addLog(t.id, me.id, '周结算结款', `结算金额 ¥${amt}`);
        addMessage(t.claimerId, t.id, `选题《${t.title}》已通过周结算结款：¥${amt}。`, 'settle');
      }
      const rec = { id: nextId('weeklySettlements'), weekStart: monday.getTime(), weekEnd: sunday.getTime(), count: topicIds.length, totalAmount: total, topicIds, createdBy: me.id, createdAt: now };
      db.weeklySettlements.push(rec);
      saveDB();
      return json(res, 200, { ok: true, count: topicIds.length, total, record: { ...rec, createdByName: me.displayName } });
    }
    // ---- 周结算记录 ----
    if (p === '/api/settle/weekly' && method === 'GET') {
      if (me.role !== 'admin') return json(res, 403, { error: '无权限' });
      const arr = db.weeklySettlements.slice().sort((a, b) => b.createdAt - a.createdAt).map(r => ({ ...r, createdByName: userName(r.createdBy) }));
      return json(res, 200, arr);
    }

    // ---- 消息 ----
    if (p === '/api/messages' && method === 'GET') {
      const list = db.messages.filter(m => m.userId === me.id && !m.deleted).sort((a, b) => b.createdAt - a.createdAt);
      return json(res, 200, list);
    }
    if (p === '/api/messages/unread' && method === 'GET') {
      return json(res, 200, { count: db.messages.filter(m => m.userId === me.id && !m.read && !m.deleted).length });
    }
    if (p === '/api/messages/read' && method === 'POST') {
      const { id } = body;
      if (id) {
        const m = db.messages.find(x => x.id === id && x.userId === me.id);
        if (m) { m.read = true; m.readAt = Date.now(); }
      } else {
        db.messages.forEach(m => { if (m.userId === me.id && !m.deleted) { m.read = true; m.readAt = Date.now(); } });
      }
      saveDB();
      return json(res, 200, { ok: true });
    }
    const msgDel = p.match(/^\/api\/messages\/(\d+)$/);
    if (msgDel && method === 'DELETE') {
      const m = db.messages.find(x => x.id === parseInt(msgDel[1], 10) && x.userId === me.id);
      if (!m) return json(res, 404, { error: '消息不存在' });
      db.messages = db.messages.filter(x => x.id !== m.id);
      db.messageRecycle.push({ ...m, deletedAt: Date.now() });
      saveDB();
      return json(res, 200, { ok: true });
    }
    if (p === '/api/messages/recycle' && method === 'GET') {
      const cutoff = Date.now() - MESSAGE_RECYCLE_DAYS * 86400000;
      const list = db.messageRecycle.filter(m => m.userId === me.id && m.deletedAt >= cutoff).sort((a, b) => b.deletedAt - a.deletedAt);
      return json(res, 200, list);
    }
    const msgRestore = p.match(/^\/api\/messages\/recycle\/(\d+)$/);
    if (msgRestore && method === 'POST') {
      const m = db.messageRecycle.find(x => x.id === parseInt(msgRestore[1], 10) && x.userId === me.id);
      if (!m) return json(res, 404, { error: '消息不存在' });
      db.messageRecycle = db.messageRecycle.filter(x => x.id !== m.id);
      const restored = { ...m }; delete restored.deletedAt;
      restored.read = false; restored.readAt = null; restored.deleted = false;
      db.messages.push(restored);
      saveDB();
      return json(res, 200, { ok: true });
    }

    // ---- 待办计数（导航红点）----
    if (p === '/api/pending' && method === 'GET') {
      const topics = db.topics.filter(t => !t.recycledAt);
      const pendingClaim = topics.filter(t => t.status === 'pending').length;
      const review = topics.filter(t => t.status === 'review').length;
      const pendingSettle = topics.filter(t => t.status === 'finished' && t.settlementStatus === 'unsettled').length;
      const unread = db.messages.filter(m => m.userId === me.id && !m.read && !m.deleted).length;
      return json(res, 200, { pendingClaim, review, pendingSettle, unread });
    }

    // ---- 统计 ----
    if (p === '/api/stats/me' && method === 'GET') {
      const mine = db.topics.filter(t => t.claimerId === me.id && !t.recycledAt);
      const stats = {
        claimed: mine.length,
        inProgress: mine.filter(t => t.status === 'in_progress' || t.status === 'review').length,
        finished: mine.filter(t => t.status === 'finished').length,
        settled: mine.filter(t => t.settlementStatus === 'settled').length,
        totalAmount: mine.filter(t => t.settlementStatus === 'settled').reduce((s, t) => s + (t.settlementAmount || 0), 0),
        pendingSettle: mine.filter(t => t.status === 'finished' && t.settlementStatus === 'unsettled').length,
        published: db.topics.filter(t => t.createdBy === me.id).length,
        favorites: db.topics.filter(t => (t.favoritedBy || []).includes(me.id)).length
      };
      return json(res, 200, stats);
    }
    if (p === '/api/stats' && method === 'GET') {
      if (me.role !== 'admin') return json(res, 403, { error: '无权限' });
      const members = db.users.filter(u => u.role === 'member');
      const topics = db.topics.filter(t => !t.recycledAt);
      const perMember = members.map(m => {
        const mine = topics.filter(t => t.claimerId === m.id);
        return {
          id: m.id, name: m.displayName, maxClaims: m.maxClaims,
          claimed: mine.length,
          finished: mine.filter(t => t.status === 'finished').length,
          settledAmount: mine.filter(t => t.settlementStatus === 'settled').reduce((s, t) => s + (t.settlementAmount || 0), 0)
        };
      });
      return json(res, 200, {
        total: topics.length,
        pending: topics.filter(t => t.status === 'pending').length,
        inProgress: topics.filter(t => t.status === 'in_progress').length,
        review: topics.filter(t => t.status === 'review').length,
        finished: topics.filter(t => t.status === 'finished').length,
        settledAmount: topics.filter(t => t.settlementStatus === 'settled').reduce((s, t) => s + (t.settlementAmount || 0), 0),
        unsettledAmount: topics.filter(t => t.status === 'finished' && t.settlementStatus === 'unsettled').reduce((s, t) => s + (t.settlementAmount || 0), 0),
        pendingSettleCount: topics.filter(t => t.status === 'finished' && t.settlementStatus === 'unsettled').length,
        weeklyCount: db.weeklySettlements.length,
        perMember
      });
    }

    // ---- 账单导出（CSV）----
    if (p === '/api/export/bills' && method === 'GET') {
      if (me.role !== 'admin') return json(res, 403, { error: '无权限' });
      let settled = db.topics.filter(t => t.settlementStatus === 'settled');
      const wid = u.searchParams.get('weeklyId');
      if (wid) { const rec = db.weeklySettlements.find(r => String(r.id) === wid); settled = rec ? settled.filter(t => rec.topicIds.includes(t.id)) : []; }
      const header = '选题ID,选题标题,类型,认领人,结算金额,结算明细,完结时间,结款时间\n';
      const rows = settled.map(t => [
        t.id, `"${escapeCSV(t.title || '')}"`, WORKTYPE_LABELS[t.workType] || t.workType, userName(t.claimerId),
        t.settlementAmount || 0, `"${escapeCSV(t.settlementDetail || '')}"`,
        t.updatedAt ? new Date(t.updatedAt).toISOString() : '', t.settledAt ? new Date(t.settledAt).toISOString() : ''
      ].join(',')).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bills.csv"' });
      return res.end('﻿' + header + rows);
    }

    return json(res, 404, { error: '接口不存在' });
  } catch (err) {
    return json(res, 500, { error: '服务器错误：' + err.message });
  }
}

function publicUser(u) {
  const { passwordHash, salt, passwordHashAlgo, ...rest } = u;
  return rest;
}

// ===================== 启动 =====================
// 回收站：超过保留期的废弃/删除选题自动永久清除
function purgeRecycleBin() {
  const now = Date.now();
  const old = db.topics.filter(t => {
    if (!t.recycledAt) return false;
    const days = t.recycleDays || RECYCLE_DAYS;
    return t.recycledAt < now - days * 86400000;
  });
  if (!old.length) return;
  const ids = new Set(old.map(t => t.id));
  db.topics = db.topics.filter(t => !ids.has(t.id));
  db.comments = db.comments.filter(c => !ids.has(c.topicId));
  db.materials = db.materials.filter(m => !ids.has(m.topicId));
  db.logs = db.logs.filter(l => !ids.has(l.topicId));
  db.messages = db.messages.filter(m => !ids.has(m.topicId));
  saveDB();
  console.log(`🗑️ 回收站自动清理：${old.length} 个过期选题已永久删除`);
}
// 已读 1 小时后自动删除（移入消息回收站，7 天内可恢复）
function purgeReadMessages() {
  const now = Date.now();
  const expired = db.messages.filter(m => m.read && m.readAt && now - m.readAt > READ_DELETE_MS);
  if (!expired.length) return;
  const ids = new Set(expired.map(m => m.id));
  expired.forEach(m => db.messageRecycle.push({ ...m, deletedAt: Date.now() }));
  db.messages = db.messages.filter(m => !ids.has(m.id));
  saveDB();
  console.log(`🔔 已读消息自动清理：${expired.length} 条（进入消息回收站）`);
}
// 消息回收站：超过 7 天永久删除
function purgeMessageRecycle() {
  const now = Date.now();
  const cutoff = now - MESSAGE_RECYCLE_DAYS * 86400000;
  const old = db.messageRecycle.filter(m => m.deletedAt < cutoff);
  if (!old.length) return;
  db.messageRecycle = db.messageRecycle.filter(m => m.deletedAt >= cutoff);
  saveDB();
  console.log(`🔔 消息回收站清理：${old.length} 条过期消息已永久删除`);
}
loadDB();
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// Explicit bootstrap is safe for a first production start.  Do not set the
// password again after the administrator has been created.
if (db.users.length === 0 && process.env.BOOTSTRAP_ADMIN_USERNAME && process.env.BOOTSTRAP_ADMIN_PASSWORD) {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username) || password.length < 10) throw new Error('Invalid bootstrap administrator credentials');
  db.users.push(makeUser(username, process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME || username, password, 'admin'));
  saveDB();
}
// 初始化默认账号
if (db.users.length === 0 && process.env.ALLOW_INSECURE_DEMO_ACCOUNTS === 'true') {
  db.users.push(makeUser('admin', '超级管理员', 'admin123', 'admin'));
  const m = makeUser('xiaoming', '小明(成员)', 'member123', 'member');
  m.maxClaims = 5;
  db.users.push(m);
  saveDB();
  console.log('已初始化默认账号：admin / admin123 ，xiaoming / member123');
}
purgeRecycleBin();
purgeReadMessages();
purgeMessageRecycle();
setInterval(purgeRecycleBin, 60 * 60 * 1000); // 每小时检查一次回收站
setInterval(purgeReadMessages, 60 * 1000);    // 每分钟检查已读超时消息
setInterval(purgeMessageRecycle, 60 * 60 * 1000); // 每小时检查消息回收站
const server = http.createServer((req, res) => { handle(req, res); });
server.listen(PORT, () => {
  console.log(`\n✅ 自媒体协作工作台已启动：http://localhost:${PORT}`);
  console.log('   默认管理员：admin / admin123');
  console.log('   默认成员：  xiaoming / member123\n');
});
