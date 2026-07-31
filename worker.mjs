// ============================================================================
// 自媒体内容协作工作台 · Cloudflare Worker 后端
// 存储：D1（关系型数据）+ R2（图片 / 视频等多媒体资源）+ Static Assets（前端构建产物）
// ============================================================================

const encoder = new TextEncoder();
const DAY = 86400000;

// ---------- 登录限流 ----------
const loginAttempts = new Map();
function recordAttempt(ip) {
  const nowMs = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || nowMs > rec.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: nowMs + 15 * 60000 });
    return false;
  }
  rec.count++;
  return rec.count > 5;
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const now = () => Date.now();
const uuid = () => crypto.randomUUID();
const safeUrl = v => { try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };
const jget = (v, d = []) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };
const jset = v => JSON.stringify(v ?? []);

const STATUS_LABELS = { pending: '待认领', in_progress: '制作中', review: '待审核', finished: '已完结' };
const STAGE_LABELS = { confirm: '确认选题', copywriting: '文案制作', video: '视频制作', done: '完结' };
const WT_LABELS = { full: '全流程', copywriting: '仅文案' };
const PLATFORMS = ['douyin', 'kuaishou', 'xiaohongshu'];
const PRICE = { full: 40, copywriting: 15 };

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 210000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// Workers 无标准 crypto.timingSafeEqual；优先使用 crypto.subtle.timingSafeEqual，回退为恒时比较
function safeEqual(a, b) {
  const ba = encoder.encode(a), bb = encoder.encode(b);
  if (ba.byteLength !== bb.byteLength) return false;
  if (crypto.subtle && typeof crypto.subtle.timingSafeEqual === 'function') return crypto.subtle.timingSafeEqual(ba, bb);
  let diff = 0;
  for (let i = 0; i < ba.byteLength; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

// ---- D1 访问辅助 ----
const all = (db, sql, params = []) => db.prepare(sql).bind(...params).all().then(r => r.results || []);
const one = (db, sql, params = []) => db.prepare(sql).bind(...params).first();
const run = (db, sql, params = []) => db.prepare(sql).bind(...params).run();

async function authUser(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const s = await one(env.DB, 'SELECT userId, expiresAt FROM sessions WHERE token=?', [token]);
  if (!s || s.expiresAt < now()) return null;
  return await one(env.DB, 'SELECT * FROM users WHERE id=?', [s.userId]);
}
const publicUser = r => ({ id: r.id, username: r.username, displayName: r.displayName, role: r.role, maxClaims: r.maxClaims, showTutorial: !!r.showTutorial, createdAt: r.createdAt });

async function usersMap(env) {
  const rows = await all(env.DB, 'SELECT id, displayName, role FROM users');
  return new Map(rows.map(u => [u.id, u]));
}

const fmtDate = ts => { if (!ts) return ''; const d = new Date(ts + 8 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
const parseDeadline = s => { if (!s) return null; const t = Date.parse(String(s).replace(' ', 'T') + '+08:00'); return Number.isNaN(t) ? null : t; };

function trafficInfo(row) {
  const raw = row.traffic ? jget(row.traffic, null) : null;
  const days = raw && Array.isArray(raw.days) ? raw.days : [];
  const totals = {};
  for (const p of PLATFORMS) {
    totals[p] = { views: 0, likes: 0, favorites: 0 };
    for (const d of days) for (const k of ['views', 'likes', 'favorites']) totals[p][k] += Number((d[p] || {})[k]) || 0;
  }
  const filled = days.length > 0;
  return { days, totals, filled, overdue: !filled && !!row.trafficDueAt && row.trafficDueAt < now() };
}

function topicView(row, umap, counts = {}) {
  const amt = row.settlementAmount != null ? row.settlementAmount : (PRICE[row.workType] ?? PRICE.full);
  const tf = trafficInfo(row);
  const deadlineTs = parseDeadline(row.deadline);
  const cnt = counts[row.id] || {};
  return {
    id: row.id, title: row.title, intro: row.intro,
    referenceLinks: jget(row.referenceLinks, []), mediaLinks: jget(row.mediaLinks, []),
    copyText: row.copyText, workType: row.workType,
    series: jget(row.series, []), deadline: row.deadline,
    status: row.status, stage: row.stage, createdBy: row.createdBy, claimerId: row.claimerId,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    settlementStatus: row.settlementStatus, settlementAmount: amt,
    settlementDetail: row.settlementDetail, settledAt: row.settledAt,
    settlementEvidence: jget(row.settlementEvidence, []),
    recycledAt: row.recycledAt, recycledReason: row.recycledReason, recycleDays: row.recycleDays,
    videoLink: row.videoLink, videoType: row.videoType, reviewStage: row.reviewStage,
    trafficDueAt: row.trafficDueAt, abandonRequested: !!row.abandonRequested,
    rejectedNotes: jget(row.rejectedNotes, []), favoritedBy: jget(row.favoritedBy, []),
    // ---- 计算字段（前端直接使用） ----
    statusLabel: STATUS_LABELS[row.status] || row.status,
    stageLabel: STAGE_LABELS[row.stage] || row.stage,
    workTypeLabel: WT_LABELS[row.workType] || '未定',
    settleLabel: row.settlementStatus === 'settled' ? '已结算' : (row.status === 'finished' ? '待结算' : '未结算'),
    authorName: umap.get(row.createdBy)?.displayName || '未知用户',
    claimerName: row.claimerId ? (umap.get(row.claimerId)?.displayName || '') : '',
    displayAmount: amt,
    recycled: !!row.recycledAt,
    recycleDaysLeft: row.recycledAt ? Math.max(0, Math.ceil((row.recycledAt + (row.recycleDays || 30) * DAY - now()) / DAY)) : null,
    daysInLibrary: Math.max(0, Math.floor((now() - row.createdAt) / DAY)),
    createdAtLabel: fmtDate(row.createdAt),
    overdue: !!deadlineTs && row.status !== 'finished' && !row.recycledAt && deadlineTs < now(),
    commentCount: cnt.comments || 0, materialCount: cnt.materials || 0,
    trafficDays: tf.days, trafficTotals: tf.totals, trafficFilled: tf.filled, trafficOverdue: tf.overdue
  };
}

const MSG_TARGETS = { submit: { view: 'review' } };
const msgView = r => ({ id: r.id, userId: r.userId, topicId: r.topicId, content: r.content, type: r.type, read: !!r.read, readAt: r.readAt, createdAt: r.createdAt, deleted: !!r.deleted, deletedAt: r.deletedAt, target: MSG_TARGETS[r.type] || null });
const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';

// 惰性清理：过期会话 / 回收站到期选题 / 已读消息 1 小时后移入回收站 / 回收站消息 7 天后清除
async function cleanup(env) {
  const t = now();
  try {
    await run(env.DB, 'DELETE FROM sessions WHERE expiresAt < ?', [t]);
    await run(env.DB, 'UPDATE messages SET deleted=1, deletedAt=? WHERE read=1 AND deleted=0 AND readAt < ?', [t, t - 3600000]);
    await run(env.DB, 'DELETE FROM messages WHERE deleted=1 AND deletedAt < ?', [t - 7 * DAY]);
    const expired = await all(env.DB, 'SELECT id FROM topics WHERE recycledAt IS NOT NULL AND (recycledAt + recycleDays * 86400000) < ?', [t]);
    for (const r of expired) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM topics WHERE id=?').bind(r.id),
        env.DB.prepare('DELETE FROM comments WHERE topicId=?').bind(r.id),
        env.DB.prepare('DELETE FROM materials WHERE topicId=?').bind(r.id),
        env.DB.prepare('DELETE FROM messages WHERE topicId=?').bind(r.id),
        env.DB.prepare('DELETE FROM logs WHERE topicId=?').bind(r.id)
      ]);
    }
  } catch (e) { /* 清理失败不影响正常请求 */ }
}

// 定时任务：清理 + 流量填报逾期提醒
async function scheduledTasks(env) {
  await cleanup(env);
  try {
    const t = now();
    const rows = await all(env.DB, "SELECT id,title,claimerId FROM topics WHERE status='finished' AND workType='full' AND trafficDueAt IS NOT NULL AND trafficDueAt < ? AND (traffic IS NULL OR traffic='') AND trafficRemindedAt IS NULL AND recycledAt IS NULL", [t]);
    for (const r of rows) {
      if (r.claimerId) await run(env.DB, 'INSERT INTO messages (userId,topicId,content,type,createdAt) VALUES (?,?,?,?,?)', [r.claimerId, r.id, `⏰ 选题《${r.title}》的视频流量填报已逾期，请尽快到「视频流量」页补填三平台数据`, 'overdue', t]);
      await run(env.DB, 'UPDATE topics SET trafficRemindedAt=? WHERE id=?', [t, r.id]);
    }
  } catch (e) { /* ignore */ }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/upload' || url.pathname === '/api/upload/video') return upload(request, env, url.pathname.endsWith('/video'));
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/pending' && ctx) ctx.waitUntil(cleanup(env));
      try { return await handleApi(request, env); }
      catch (e) { return json({ error: '服务器内部错误：' + (e && e.message || e) }, 500); }
    }
    if (url.pathname.startsWith('/uploads/')) {
      const object = await env.UPLOADS.get(url.pathname.slice(1));
      if (!object) return new Response('Not found', { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('cache-control', 'private, max-age=3600');
      return new Response(object.body, { headers });
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(scheduledTasks(env)); }
};

async function upload(request, env, video) {
  const me = await authUser(request, env);
  if (!me) return json({ error: '未登录或登录已失效' }, 401);
  if (video) {
    const form = await request.formData(); const file = form.get('file');
    if (!(file instanceof File) || file.size > 25 * 1024 * 1024) return json({ error: '视频必须小于 25MB' }, 400);
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return json({ error: '仅支持 mp4、webm、mov、m4v' }, 400);
    const key = `uploads/videos/${uuid()}.${ext}`;
    await env.UPLOADS.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'video/mp4' } });
    return json({ url: '/' + key });
  }
  const { data } = await request.json();
  const match = typeof data === 'string' && data.match(/^data:(image\/(png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return json({ error: '仅支持 PNG/JPG/GIF/WebP 图片' }, 400);
  const binary = Uint8Array.from(atob(match[3]), c => c.charCodeAt(0));
  if (binary.byteLength > 3 * 1024 * 1024) return json({ error: '图片必须小于 3MB' }, 400);
  const ext = match[2] === 'jpeg' ? 'jpg' : match[2];
  const key = `uploads/${uuid()}.${ext}`;
  await env.UPLOADS.put(key, binary, { httpMetadata: { contentType: match[1] } });
  return json({ url: '/' + key });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const p = url.pathname; const method = request.method;
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  let body = {};
  if (['POST', 'PUT'].includes(method)) { try { body = await request.json(); } catch { body = {}; } }

  const me = await authUser(request, env);
  const requireUser = () => me ? null : json({ error: '未登录或登录已失效' }, 401);
  const admin = () => me?.role === 'admin';
  const umap = await usersMap(env);
  const adminIds = [...umap.entries()].filter(([, u]) => u.role === 'admin').map(([id]) => id);
  const getTopic = id => one(env.DB, 'SELECT * FROM topics WHERE id=?', [id]);
  const canRead = t => !t.recycledAt || admin() || t.createdBy === me?.id || t.claimerId === me?.id;
  const notify = async (userIds, topicId, content, type = 'system') => {
    const targets = [...new Set([].concat(userIds).filter(x => x && x !== me?.id))];
    if (!targets.length) return;
    await env.DB.batch(targets.map(uid => env.DB.prepare('INSERT INTO messages (userId,topicId,content,type,createdAt) VALUES (?,?,?,?,?)').bind(uid, topicId, content, type, now())));
  };
  const log = (topicId, action, detail = '') => run(env.DB, 'INSERT INTO logs (topicId,userId,userName,action,detail,createdAt) VALUES (?,?,?,?,?,?)', [topicId, me?.id || null, me?.displayName || '系统', action, detail, now()]);
  const countsFor = async () => {
    const cs = await all(env.DB, 'SELECT topicId, COUNT(*) c FROM comments GROUP BY topicId');
    const ms = await all(env.DB, 'SELECT topicId, COUNT(*) c FROM materials GROUP BY topicId');
    const map = {};
    for (const r of cs) (map[r.topicId] = map[r.topicId] || {}).comments = r.c;
    for (const r of ms) (map[r.topicId] = map[r.topicId] || {}).materials = r.c;
    return map;
  };

  // ---- 公开/引导 ----
  if (p === '/api/bootstrap' && method === 'POST') {
    const cnt = (await one(env.DB, 'SELECT COUNT(*) c FROM users')).c;
    if (cnt || !env.BOOTSTRAP_TOKEN || request.headers.get('x-bootstrap-token') !== env.BOOTSTRAP_TOKEN) return json({ error: '不可用' }, 403);
    const username = String(body.username || ''); const password = String(body.password || '');
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(username) || password.length < 10) return json({ error: '用户名或密码不符合安全要求' }, 400);
    const salt = uuid();
    await run(env.DB, 'INSERT INTO users (username,displayName,salt,passwordHash,role,maxClaims,showTutorial,createdAt) VALUES (?,?,?,?,?,?,?,?)', [username, String(body.displayName || username).slice(0, 80), salt, await passwordHash(password, salt), 'admin', 999, 1, now()]);
    return json({ ok: true });
  }
  if (p === '/api/auth-check') return requireUser() || json({ ok: true });

  if (p === '/api/register' && method === 'POST') {
    const username = String(body.username || ''); const password = String(body.password || '');
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(username) || password.length < 10) return json({ error: '用户名须为 3-32 位字母数字，密码至少 10 位' }, 400);
    if (await one(env.DB, 'SELECT 1 FROM users WHERE username=?', [username])) return json({ error: '用户名已存在' }, 409);
    const salt = uuid();
    const res = await run(env.DB, 'INSERT INTO users (username,displayName,salt,passwordHash,role,maxClaims,showTutorial,createdAt) VALUES (?,?,?,?,?,?,?,?)', [username, String(body.displayName || username).slice(0, 80), salt, await passwordHash(password, salt), 'member', 10, 1, now()]);
    const u = await one(env.DB, 'SELECT * FROM users WHERE id=?', [res.meta.last_row_id]);
    const tk = uuid();
    await run(env.DB, 'INSERT INTO sessions (token,userId,expiresAt) VALUES (?,?,?)', [tk, u.id, now() + 7 * DAY]);
    return json({ token: tk, user: publicUser(u) });
  }
  if (p === '/api/login' && method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (recordAttempt(ip)) return json({ error: '登录尝试过于频繁，请15分钟后再试' }, 429);
    const u = await one(env.DB, 'SELECT * FROM users WHERE username=?', [String(body.username || '')]);
    if (!u || !safeEqual(u.passwordHash, await passwordHash(String(body.password || ''), u.salt))) return json({ error: '用户名或密码错误' }, 401);
    loginAttempts.delete(ip);
    const tk = uuid();
    await run(env.DB, 'INSERT INTO sessions (token,userId,expiresAt) VALUES (?,?,?)', [tk, u.id, now() + 7 * DAY]);
    return json({ token: tk, user: publicUser(u) });
  }

  const denied = requireUser(); if (denied) return denied;

  if (p === '/api/logout' && method === 'POST') { await run(env.DB, 'DELETE FROM sessions WHERE token=?', [token]); return json({ ok: true }); }
  if (p === '/api/me' && method === 'GET') return json(publicUser(me));
  if (p === '/api/me/tutorial' && method === 'POST') { await run(env.DB, 'UPDATE users SET showTutorial=0 WHERE id=?', [me.id]); return json({ ok: true }); }
  if (p === '/api/me/password' && method === 'PUT') {
    const oldP = String(body.oldPassword || ''), newP = String(body.newPassword || '');
    if (!safeEqual(me.passwordHash, await passwordHash(oldP, me.salt))) return json({ error: '原密码错误' }, 400);
    if (newP.length < 10) return json({ error: '新密码至少 10 位' }, 400);
    const salt = uuid();
    await run(env.DB, 'UPDATE users SET salt=?, passwordHash=? WHERE id=?', [salt, await passwordHash(newP, salt), me.id]);
    await run(env.DB, 'DELETE FROM sessions WHERE userId=? AND token<>?', [me.id, token]);
    return json({ ok: true });
  }

  if (p === '/api/board' && method === 'GET') {
    const a = await one(env.DB, 'SELECT * FROM announcements WHERE id=1');
    return json(a ? { notice: a.notice, referenceVideos: jget(a.referenceVideos, []) } : { notice: '', referenceVideos: [] });
  }
  if (p === '/api/board' && method === 'PUT') {
    if (!admin()) return json({ error: '无权限' }, 403);
    const notice = String(body.notice || '').slice(0, 5000);
    const referenceVideos = (body.referenceVideos || []).filter(v => safeUrl(v.url)).slice(0, 20).map(v => ({ title: String(v.title || '').slice(0, 200), url: v.url }));
    const exists = await one(env.DB, 'SELECT 1 FROM announcements WHERE id=1');
    if (exists) await run(env.DB, 'UPDATE announcements SET notice=?, referenceVideos=? WHERE id=1', [notice, jset(referenceVideos)]);
    else await run(env.DB, 'INSERT INTO announcements (id,notice,referenceVideos) VALUES (1,?,?)', [notice, jset(referenceVideos)]);
    return json({ notice, referenceVideos });
  }

  // ---- 成员管理 ----
  if (p === '/api/users' && method === 'GET') { if (!admin()) return json({ error: '无权限' }, 403); return json((await all(env.DB, 'SELECT * FROM users ORDER BY createdAt')).map(publicUser)); }
  if (p === '/api/users' && method === 'POST') {
    if (!admin()) return json({ error: '无权限' }, 403);
    const username = String(body.username || ''), password = String(body.password || '');
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(username) || password.length < 10) return json({ error: '用户名须为 3-32 位字母数字，密码至少 10 位' }, 400);
    if (await one(env.DB, 'SELECT 1 FROM users WHERE username=?', [username])) return json({ error: '用户名已存在' }, 409);
    const salt = uuid();
    const res = await run(env.DB, 'INSERT INTO users (username,displayName,salt,passwordHash,role,maxClaims,showTutorial,createdAt) VALUES (?,?,?,?,?,?,?,?)', [username, String(body.displayName || username).slice(0, 80), salt, await passwordHash(password, salt), 'member', Math.max(1, Number(body.maxClaims) || 10), 1, now()]);
    return json(publicUser(await one(env.DB, 'SELECT * FROM users WHERE id=?', [res.meta.last_row_id])));
  }
  const userMatch = p.match(/^\/api\/users\/(\d+)$/);
  if (userMatch && method === 'PUT') {
    if (!admin()) return json({ error: '无权限' }, 403);
    const u = await one(env.DB, 'SELECT * FROM users WHERE id=?', [Number(userMatch[1])]);
    if (!u) return json({ error: '用户不存在' }, 404);
    const sets = []; const vals = [];
    if (body.displayName !== undefined) { sets.push('displayName=?'); vals.push(String(body.displayName).slice(0, 80)); }
    if (body.maxClaims !== undefined) { sets.push('maxClaims=?'); vals.push(Math.max(1, Number(body.maxClaims) || u.maxClaims)); }
    if (body.password !== undefined) {
      const np = String(body.password || '');
      if (np.length < 10) return json({ error: '密码至少 10 位' }, 400);
      const salt = uuid();
      sets.push('salt=?', 'passwordHash=?'); vals.push(salt, await passwordHash(np, salt));
    }
    if (!sets.length) return json(publicUser(u));
    vals.push(u.id);
    await run(env.DB, `UPDATE users SET ${sets.join(',')} WHERE id=?`, vals);
    return json(publicUser(await one(env.DB, 'SELECT * FROM users WHERE id=?', [u.id])));
  }

  if (p === '/api/series' && method === 'GET') {
    const rows = await all(env.DB, 'SELECT series FROM topics WHERE recycledAt IS NULL');
    const counts = {};
    for (const r of rows) for (const s of jget(r.series, [])) counts[s] = (counts[s] || 0) + 1;
    return json(Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count));
  }

  // ---- 选题列表（支持 keyword/series/stage/favorite/sort 等筛选） ----
  if (p === '/api/topics' && method === 'GET') {
    const q = url.searchParams;
    const recycled = q.get('recycled') === '1';
    const where = [recycled ? 'recycledAt IS NOT NULL' : 'recycledAt IS NULL'];
    const params = [];
    for (const [k, col] of [['status', 'status'], ['settlement', 'settlementStatus'], ['workType', 'workType'], ['stage', 'stage']]) {
      const v = q.get(k); if (v) { where.push(`${col}=?`); params.push(v); }
    }
    if (q.get('traffic') === '1') where.push("workType='full' AND status='finished'");
    if (q.get('mine') === '1') { where.push('claimerId=?'); params.push(me.id); }
    if (q.get('author') === '1') { where.push('createdBy=?'); params.push(me.id); }
    const kw = (q.get('keyword') || '').trim();
    if (kw) { where.push('(title LIKE ? OR intro LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`); }
    const sort = q.get('sort') || 'updated';
    const orderBy = sort === 'library_desc' ? 'createdAt ASC' : sort === 'library_asc' ? 'createdAt DESC' : 'updatedAt DESC';
    let rows = await all(env.DB, `SELECT * FROM topics WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`, params);
    if (recycled) rows = rows.filter(canRead);
    const series = q.get('series');
    if (series) rows = rows.filter(r => jget(r.series, []).includes(series));
    if (q.get('favorite') === '1') rows = rows.filter(r => jget(r.favoritedBy, []).includes(me.id));
    const counts = await countsFor();
    return json(rows.map(r => topicView(r, umap, counts)));
  }
  if (p === '/api/topics' && method === 'POST') {
    const title = String(body.title || '').trim(); if (!title) return json({ error: '标题必填' }, 400);
    const refs = (Array.isArray(body.referenceLinks) ? body.referenceLinks : []).map(String).filter(Boolean).slice(0, 30);
    const media = (Array.isArray(body.mediaLinks) ? body.mediaLinks : []).filter(m => m && m.url).slice(0, 30);
    const series = Array.isArray(body.series) ? body.series : String(body.series || '').split(/[#\s]+/).filter(Boolean);
    const res = await run(env.DB, 'INSERT INTO topics (title,intro,referenceLinks,mediaLinks,copyText,workType,series,deadline,status,stage,createdBy,claimerId,createdAt,updatedAt,settlementStatus,favoritedBy,rejectedNotes,settlementEvidence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [title, String(body.intro || '').slice(0, 10000), jset(refs), jset(media), String(body.copyText || ''), ['full', 'copywriting'].includes(body.workType) ? body.workType : null, jset(series.slice(0, 12)), body.deadline || null, 'pending', 'confirm', me.id, null, now(), now(), 'unsettled', jset([]), jset([]), jset([])]);
    const tid = res.meta.last_row_id;
    await log(tid, '发布选题', title);
    await notify(adminIds, tid, `📝 ${me.displayName} 发布了新选题《${title}》`, 'system');
    return json(topicView(await getTopic(tid), umap));
  }

  const match = p.match(/^\/api\/topics\/(\d+)(?:\/(claim|stage|submit\/copy|submit\/video|review|favorite|comment|material|traffic|settle|discard|remove|restore))?$/);
  if (match) {
    const tid = Number(match[1]);
    const t = await getTopic(tid); if (!t) return json({ error: '选题不存在' }, 404);
    const action = match[2];
    const view = async () => topicView(await getTopic(tid), umap);

    if (!action && method === 'GET') {
      if (!canRead(t)) return json({ error: '选题不存在' }, 404);
      const comments = (await all(env.DB, 'SELECT * FROM comments WHERE topicId=? ORDER BY createdAt', [tid]))
        .map(c => ({ ...c, userName: c.userName || umap.get(c.userId)?.displayName || '未知用户' }));
      const materials = (await all(env.DB, 'SELECT * FROM materials WHERE topicId=? ORDER BY version', [tid]))
        .map(m => ({ ...m, userName: umap.get(m.userId)?.displayName || '未知用户' }));
      const logs = await all(env.DB, 'SELECT * FROM logs WHERE topicId=? ORDER BY createdAt', [tid]);
      const counts = { [tid]: { comments: comments.length, materials: materials.length } };
      return json({ ...topicView(t, umap, counts), comments, materials, logs });
    }
    if (!action && method === 'PUT') {
      if (!admin() && t.createdBy !== me.id) return json({ error: '无权限' }, 403);
      if (t.status === 'finished' && !admin()) return json({ error: '已完结选题不可修改' }, 400);
      const sets = []; const vals = [];
      for (const k of ['title', 'intro', 'copyText', 'deadline']) if (body[k] !== undefined) { sets.push(`${k}=?`); vals.push(String(body[k] || '')); }
      if (body.workType !== undefined) { sets.push('workType=?'); vals.push(['full', 'copywriting'].includes(body.workType) ? body.workType : null); }
      if (body.series !== undefined) { sets.push('series=?'); vals.push(jset((Array.isArray(body.series) ? body.series : String(body.series).split(/[#\s]+/).filter(Boolean)).slice(0, 12))); }
      if (body.referenceLinks !== undefined) { sets.push('referenceLinks=?'); vals.push(jset(body.referenceLinks.map(String).filter(Boolean).slice(0, 30))); }
      if (body.mediaLinks !== undefined) { sets.push('mediaLinks=?'); vals.push(jset(body.mediaLinks.filter(m => m && m.url).slice(0, 30))); }
      sets.push('updatedAt=?'); vals.push(now()); vals.push(tid);
      await run(env.DB, `UPDATE topics SET ${sets.join(',')} WHERE id=?`, vals);
      await log(tid, '修改选题');
      return json(await view());
    }
    if (action === 'claim' && method === 'POST') {
      if (t.status !== 'pending') return json({ error: '该选题当前不可认领' }, 400);
      const wt = body.workType || t.workType;
      if (!['full', 'copywriting'].includes(wt)) return json({ error: '请选择接单类型' }, 400);
      if (!admin()) {
        const c = (await one(env.DB, "SELECT COUNT(*) c FROM topics WHERE claimerId=? AND recycledAt IS NULL AND status IN ('in_progress','review')", [me.id])).c;
        if (c >= (me.maxClaims || 10)) return json({ error: `已达接单上限（${me.maxClaims}），请先完成手头选题` }, 400);
      }
      await run(env.DB, "UPDATE topics SET workType=?, claimerId=?, status='in_progress', updatedAt=? WHERE id=?", [wt, me.id, now(), tid]);
      await log(tid, '认领选题', WT_LABELS[wt]);
      await notify(t.createdBy, tid, `🙋 ${me.displayName} 认领了选题《${t.title}》（${WT_LABELS[wt]}）`, 'claim');
      return json(await view());
    }
    if (action === 'stage' && method === 'POST') {
      if (t.claimerId !== me.id || t.stage !== 'confirm') return json({ error: '无权限或阶段错误' }, 403);
      await run(env.DB, "UPDATE topics SET stage='copywriting', updatedAt=? WHERE id=?", [now(), tid]);
      await log(tid, '开始制作', '进入文案阶段');
      await notify(t.createdBy, tid, `📈 选题《${t.title}》已开始制作（文案阶段）`, 'progress');
      return json(await view());
    }
    if (action === 'submit/copy' && method === 'POST') {
      if (t.claimerId !== me.id || t.stage !== 'copywriting') return json({ error: '阶段错误' }, 400);
      const copyText = body.copyText != null ? String(body.copyText) : t.copyText;
      await run(env.DB, "UPDATE topics SET copyText=?, status='review', reviewStage='copywriting', updatedAt=? WHERE id=?", [copyText, now(), tid]);
      await log(tid, '提交文案审核');
      await notify(adminIds, tid, `📨 ${me.displayName} 提交了《${t.title}》的文案审核`, 'submit');
      return json(await view());
    }
    if (action === 'submit/video' && method === 'POST') {
      if (t.claimerId !== me.id || t.stage !== 'video') return json({ error: '阶段错误' }, 400);
      if (!safeUrl(body.videoLink) && !/^\/uploads\/videos\//.test(body.videoLink || '')) return json({ error: '请提供有效的视频链接或上传视频' }, 400);
      const offline = body.submitMode === 'offline';
      if (offline) {
        await run(env.DB, "UPDATE topics SET videoLink=?, videoType='offline', status='finished', stage='done', trafficDueAt=?, updatedAt=? WHERE id=?", [body.videoLink, now() + 7 * DAY, now(), tid]);
        await log(tid, '提交线下视频', '已确认过审，直接完结');
        await notify(adminIds, tid, `🎬 ${me.displayName} 上传了《${t.title}》的线下过审视频，选题已完结`, 'review');
      } else {
        await run(env.DB, "UPDATE topics SET videoLink=?, videoType='import', status='review', reviewStage='video', updatedAt=? WHERE id=?", [body.videoLink, now(), tid]);
        await log(tid, '提交视频审核');
        await notify(adminIds, tid, `📨 ${me.displayName} 提交了《${t.title}》的视频审核`, 'submit');
      }
      return json(await view());
    }
    if (action === 'review' && method === 'POST') {
      if (!admin() || t.status !== 'review') return json({ error: '无权限或状态错误' }, 403);
      if (body.action === 'reject') {
        const notes = jget(t.rejectedNotes, []);
        notes.push({ note: String(body.note || ''), at: now(), by: me.id });
        await run(env.DB, `UPDATE topics SET status='in_progress', stage=?, rejectedNotes=?, updatedAt=? WHERE id=?`, [t.reviewStage, jset(notes), now(), tid]);
        await log(tid, '驳回返修', String(body.note || ''));
        await notify(t.claimerId, tid, `↩️ 选题《${t.title}》被驳回返修：${String(body.note || '').slice(0, 200)}`, 'reject');
      } else if (t.reviewStage === 'copywriting' && t.workType === 'full') {
        await run(env.DB, "UPDATE topics SET status='in_progress', stage='video', updatedAt=? WHERE id=?", [now(), tid]);
        await log(tid, '文案审核通过', '进入视频制作阶段');
        await notify(t.claimerId, tid, `✅ 选题《${t.title}》文案审核通过，请继续制作视频`, 'review');
      } else {
        const isVideo = t.reviewStage === 'video';
        await run(env.DB, `UPDATE topics SET status='finished', stage='done', updatedAt=?${isVideo ? ', trafficDueAt=?' : ''} WHERE id=?`, isVideo ? [now(), now() + 7 * DAY, tid] : [now(), tid]);
        await log(tid, '审核通过', '选题完结');
        await notify(t.claimerId, tid, `✅ 选题《${t.title}》审核通过并完结${isVideo ? '，请 7 天内填报三平台流量数据' : ''}，等待结算`, 'review');
      }
      return json(await view());
    }
    if (action === 'favorite' && method === 'POST') {
      const fav = jget(t.favoritedBy, []); const i = fav.indexOf(me.id); let added;
      if (i < 0) { fav.push(me.id); added = true; } else { fav.splice(i, 1); added = false; }
      await run(env.DB, 'UPDATE topics SET favoritedBy=? WHERE id=?', [jset(fav), tid]);
      return json({ favorited: added });
    }
    if (action === 'comment' && method === 'POST') {
      if (!canRead(t)) return json({ error: '选题不存在' }, 404);
      const content = String(body.content || '').trim(); if (!content) return json({ error: '评论不能为空' }, 400);
      const res = await run(env.DB, 'INSERT INTO comments (topicId,userId,userName,content,createdAt) VALUES (?,?,?,?,?)', [tid, me.id, me.displayName, content.slice(0, 2000), now()]);
      await notify([t.createdBy, t.claimerId], tid, `💬 ${me.displayName} 在《${t.title}》发表了评论：${content.slice(0, 80)}`, 'comment');
      return json(await one(env.DB, 'SELECT * FROM comments WHERE id=?', [res.meta.last_row_id]));
    }
    if (action === 'material' && method === 'POST') {
      if (t.claimerId !== me.id && !admin()) return json({ error: '无权限' }, 403);
      if (!safeUrl(body.url) && !/^\/uploads\//.test(body.url || '')) return json({ error: '素材链接无效' }, 400);
      const cnt = (await one(env.DB, 'SELECT COUNT(*) c FROM materials WHERE topicId=?', [tid])).c;
      const res = await run(env.DB, 'INSERT INTO materials (topicId,userId,url,note,version,createdAt) VALUES (?,?,?,?,?,?)', [tid, me.id, body.url, String(body.note || '').slice(0, 500), cnt + 1, now()]);
      await log(tid, '留存素材', `v${cnt + 1}`);
      return json(await one(env.DB, 'SELECT * FROM materials WHERE id=?', [res.meta.last_row_id]));
    }
    if (action === 'settle' && method === 'POST') {
      if (!admin() || t.status !== 'finished') return json({ error: '无权限或状态错误' }, 403);
      const amt = Number(body.amount) || (PRICE[t.workType] ?? PRICE.full);
      const settled = body.action === 'pay';
      const evidence = (Array.isArray(body.evidence) ? body.evidence : jget(t.settlementEvidence, [])).filter(u => /^\/uploads\//.test(u) || safeUrl(u)).slice(0, 20);
      await run(env.DB, 'UPDATE topics SET settlementAmount=?, settlementDetail=?, settlementEvidence=?, settlementStatus=?, settledAt=?, updatedAt=? WHERE id=?',
        [amt, String(body.detail || '').slice(0, 500), jset(evidence), settled ? 'settled' : t.settlementStatus, settled ? now() : t.settledAt, now(), tid]);
      await log(tid, settled ? '确认结款' : '录入结算', `¥${amt} · ${String(body.detail || '')}`);
      if (settled) await notify(t.claimerId, tid, `💰 选题《${t.title}》已结款 ¥${amt}（${String(body.detail || '')}）`, 'settle');
      return json(await view());
    }
    if (action === 'traffic' && method === 'POST') {
      if (t.claimerId !== me.id || t.status !== 'finished' || t.workType !== 'full') return json({ error: '无权限或状态错误' }, 403);
      const days = (Array.isArray(body.days) ? body.days : []).slice(0, 31)
        .map(d => ({ date: String(d.date || '').slice(0, 10), douyin: d.douyin || {}, kuaishou: d.kuaishou || {}, xiaohongshu: d.xiaohongshu || {} }))
        .filter(d => d.date);
      await run(env.DB, 'UPDATE topics SET traffic=? WHERE id=?', [JSON.stringify({ days, enteredAt: now() }), tid]);
      await log(tid, '填报流量', `${days.length} 天`);
      return json(await view());
    }
    if (['discard', 'remove'].includes(action) && method === 'POST') {
      if (!admin() && t.createdBy !== me.id && !(action === 'discard' && t.claimerId === me.id)) return json({ error: '无权限' }, 403);
      const days = Math.min(365, Math.max(1, Number(body.days) || 30));
      await run(env.DB, 'UPDATE topics SET recycledAt=?, recycledReason=?, recycleDays=? WHERE id=?', [now(), action === 'discard' ? 'discard' : 'delete', days, tid]);
      await log(tid, action === 'discard' ? '废弃选题' : '删除选题', `回收站保留 ${days} 天`);
      return json(await view());
    }
    if (action === 'restore' && method === 'POST') {
      if (!canRead(t)) return json({ error: '无权限' }, 403);
      await run(env.DB, 'UPDATE topics SET recycledAt=NULL, recycledReason=NULL WHERE id=?', [tid]);
      await log(tid, '恢复选题');
      return json(await view());
    }
  }

  const purge = p.match(/^\/api\/topics\/(\d+)\/purge$/);
  if (purge && method === 'DELETE') {
    if (!admin()) return json({ error: '无权限' }, 403);
    const tid = Number(purge[1]); const t = await getTopic(tid);
    if (!t?.recycledAt) return json({ error: '选题不存在或未回收' }, 404);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM topics WHERE id=?').bind(tid),
      env.DB.prepare('DELETE FROM comments WHERE topicId=?').bind(tid),
      env.DB.prepare('DELETE FROM materials WHERE topicId=?').bind(tid),
      env.DB.prepare('DELETE FROM messages WHERE topicId=?').bind(tid),
      env.DB.prepare('DELETE FROM logs WHERE topicId=?').bind(tid)
    ]);
    return json({ ok: true });
  }

  const abandon = p.match(/^\/api\/topics\/(\d+)\/abandon(?:\/(approve))?$/);
  if (abandon && method === 'POST') {
    const tid = Number(abandon[1]); const t = await getTopic(tid); if (!t) return json({ error: '选题不存在' }, 404);
    if (abandon[2]) {
      if (!admin() && t.createdBy !== me.id) return json({ error: '无权限' }, 403);
      if (!t.abandonRequested) return json({ error: '未申请弃单' }, 400);
      await run(env.DB, "UPDATE topics SET claimerId=NULL, status='pending', stage='confirm', abandonRequested=0, updatedAt=? WHERE id=?", [now(), tid]);
      await log(tid, '弃单通过', '选题重新进入待认领');
      await notify(t.claimerId, tid, `🚫 你对《${t.title}》的弃单申请已通过`, 'abandon');
    } else {
      if (t.claimerId !== me.id) return json({ error: '无权限' }, 403);
      await run(env.DB, 'UPDATE topics SET abandonRequested=1 WHERE id=?', [tid]);
      await log(tid, '申请弃单');
      await notify([t.createdBy, ...adminIds], tid, `🚫 ${me.displayName} 申请放弃选题《${t.title}》，请审批`, 'abandon');
    }
    return json(topicView(await getTopic(tid), umap));
  }

  const deadline = p.match(/^\/api\/topics\/(\d+)\/deadline$/);
  if (deadline && method === 'POST') {
    const tid = Number(deadline[1]); const t = await getTopic(tid); if (!t) return json({ error: '选题不存在' }, 404);
    if (!admin() && t.createdBy !== me.id && t.claimerId !== me.id) return json({ error: '无权限' }, 403);
    await run(env.DB, 'UPDATE topics SET deadline=?, updatedAt=? WHERE id=?', [body.deadline || null, now(), tid]);
    await log(tid, '设置截止时间', body.deadline || '（清除）');
    return json(topicView(await getTopic(tid), umap));
  }

  // ---- 消息 ----
  if (p === '/api/messages' && method === 'GET') return json((await all(env.DB, 'SELECT * FROM messages WHERE userId=? AND deleted=0 ORDER BY createdAt DESC LIMIT 200', [me.id])).map(msgView));
  if (p === '/api/messages/unread' && method === 'GET') return json({ count: (await one(env.DB, 'SELECT COUNT(*) c FROM messages WHERE userId=? AND deleted=0 AND read=0', [me.id])).c });
  if (p === '/api/messages/read' && method === 'POST') {
    if (body.id) await run(env.DB, 'UPDATE messages SET read=1, readAt=? WHERE id=? AND userId=?', [now(), Number(body.id), me.id]);
    else await run(env.DB, 'UPDATE messages SET read=1, readAt=? WHERE userId=? AND deleted=0', [now(), me.id]);
    return json({ ok: true });
  }
  const msg = p.match(/^\/api\/messages\/(\d+)$/);
  if (msg && method === 'DELETE') {
    const r = await one(env.DB, 'SELECT * FROM messages WHERE id=? AND userId=?', [Number(msg[1]), me.id]);
    if (!r) return json({ error: '消息不存在' }, 404);
    await run(env.DB, 'UPDATE messages SET deleted=1, deletedAt=? WHERE id=?', [now(), Number(msg[1])]);
    return json({ ok: true });
  }
  if (p === '/api/messages/recycle' && method === 'GET') {
    return json((await all(env.DB, 'SELECT * FROM messages WHERE userId=? AND deleted=1 AND deletedAt > ? ORDER BY deletedAt DESC', [me.id, now() - 7 * DAY])).map(msgView));
  }
  const restoreMessage = p.match(/^\/api\/messages\/recycle\/(\d+)$/);
  if (restoreMessage && method === 'POST') {
    const r = await one(env.DB, 'SELECT * FROM messages WHERE id=? AND userId=? AND deleted=1', [Number(restoreMessage[1]), me.id]);
    if (!r) return json({ error: '消息不存在' }, 404);
    await run(env.DB, 'UPDATE messages SET deleted=0, read=0, readAt=NULL, deletedAt=NULL WHERE id=?', [Number(restoreMessage[1])]);
    return json({ ok: true });
  }

  // ---- 待办与统计 ----
  if (p === '/api/pending' && method === 'GET') {
    const active = await all(env.DB, 'SELECT status,settlementStatus FROM topics WHERE recycledAt IS NULL');
    const unread = (await one(env.DB, 'SELECT COUNT(*) c FROM messages WHERE userId=? AND deleted=0 AND read=0', [me.id])).c;
    return json({
      pendingClaim: active.filter(t => t.status === 'pending').length,
      review: active.filter(t => t.status === 'review').length,
      pendingSettle: active.filter(t => t.status === 'finished' && t.settlementStatus === 'unsettled').length,
      unread
    });
  }
  if (p === '/api/stats/me' && method === 'GET') {
    const mine = await all(env.DB, 'SELECT * FROM topics WHERE claimerId=? AND recycledAt IS NULL', [me.id]);
    const published = (await one(env.DB, 'SELECT COUNT(*) c FROM topics WHERE createdBy=? AND recycledAt IS NULL', [me.id])).c;
    const fav = await all(env.DB, 'SELECT favoritedBy FROM topics WHERE recycledAt IS NULL');
    return json({
      claimed: mine.length,
      inProgress: mine.filter(t => ['in_progress', 'review'].includes(t.status)).length,
      finished: mine.filter(t => t.status === 'finished').length,
      settled: mine.filter(t => t.settlementStatus === 'settled').length,
      totalAmount: mine.filter(t => t.settlementStatus === 'settled').reduce((s, t) => s + (t.settlementAmount || 0), 0),
      pendingSettle: mine.filter(t => t.status === 'finished' && t.settlementStatus === 'unsettled').length,
      published,
      favorites: fav.filter(t => jget(t.favoritedBy, []).includes(me.id)).length
    });
  }
  if (p === '/api/stats' && method === 'GET') {
    if (!admin()) return json({ error: '无权限' }, 403);
    const topics = await all(env.DB, 'SELECT * FROM topics WHERE recycledAt IS NULL');
    const members = await all(env.DB, "SELECT * FROM users WHERE role='member'");
    const amt = t => t.settlementAmount != null ? t.settlementAmount : (PRICE[t.workType] ?? PRICE.full);
    return json({
      total: topics.length,
      pending: topics.filter(t => t.status === 'pending').length,
      inProgress: topics.filter(t => t.status === 'in_progress').length,
      review: topics.filter(t => t.status === 'review').length,
      finished: topics.filter(t => t.status === 'finished').length,
      settledAmount: topics.filter(t => t.settlementStatus === 'settled').reduce((s, t) => s + amt(t), 0),
      unsettledAmount: topics.filter(t => t.status === 'finished' && t.settlementStatus === 'unsettled').reduce((s, t) => s + amt(t), 0),
      pendingSettleCount: topics.filter(t => t.status === 'finished' && t.settlementStatus === 'unsettled').length,
      weeklyCount: (await one(env.DB, 'SELECT COUNT(*) c FROM weeklySettlements')).c,
      perMember: members.map(m => {
        const mine = topics.filter(t => t.claimerId === m.id);
        return { id: m.id, name: m.displayName, maxClaims: m.maxClaims, claimed: mine.length, finished: mine.filter(t => t.status === 'finished').length, settledAmount: mine.filter(t => t.settlementStatus === 'settled').reduce((s, t) => s + amt(t), 0) };
      })
    });
  }
  if (p === '/api/settle/week' && method === 'POST') {
    if (!admin()) return json({ error: '无权限' }, 403);
    const pending = await all(env.DB, "SELECT * FROM topics WHERE status='finished' AND settlementStatus='unsettled' AND recycledAt IS NULL");
    if (!pending.length) return json({ ok: true, count: 0, total: 0 });
    const stmts = []; let total = 0;
    for (const t of pending) {
      const a = t.settlementAmount != null ? t.settlementAmount : (PRICE[t.workType] ?? PRICE.full);
      total += a;
      stmts.push(env.DB.prepare("UPDATE topics SET settlementAmount=?, settlementStatus='settled', settledAt=? WHERE id=?").bind(a, now(), t.id));
    }
    stmts.push(env.DB.prepare('INSERT INTO weeklySettlements (topicIds,count,totalAmount,createdBy,createdAt) VALUES (?,?,?,?,?)').bind(jset(pending.map(t => t.id)), pending.length, total, me.id, now()));
    await env.DB.batch(stmts);
    for (const t of pending) if (t.claimerId) await notify(t.claimerId, t.id, `💰 周结算：选题《${t.title}》已结款 ¥${t.settlementAmount != null ? t.settlementAmount : (PRICE[t.workType] ?? PRICE.full)}`, 'settle');
    return json({ ok: true, count: pending.length, total });
  }
  if (p === '/api/settle/weekly' && method === 'GET') {
    if (!admin()) return json({ error: '无权限' }, 403);
    const rows = await all(env.DB, 'SELECT * FROM weeklySettlements ORDER BY createdAt DESC');
    return json(rows.map(r => {
      const d = new Date(r.createdAt + 8 * 3600000);
      const dow = (d.getUTCDay() + 6) % 7; // 周一为一周起点
      return { ...r, topicIds: jget(r.topicIds, []), weekStart: r.createdAt - dow * DAY, createdByName: umap.get(r.createdBy)?.displayName || '管理员' };
    }));
  }
  if (p === '/api/export/bills' && method === 'GET') {
    if (!admin()) return json({ error: '无权限' }, 403);
    let rows = await all(env.DB, "SELECT * FROM topics WHERE settlementStatus='settled'");
    const weeklyId = url.searchParams.get('weeklyId');
    if (weeklyId) {
      const rec = await one(env.DB, 'SELECT topicIds FROM weeklySettlements WHERE id=?', [weeklyId]);
      const ids = rec ? jget(rec.topicIds, []) : [];
      rows = rows.filter(t => ids.includes(t.id));
    }
    const csv = ['选题ID,选题标题,类型,认领人,结算金额,结算明细,结算时间',
      ...rows.map(t => [t.id, esc(t.title), WT_LABELS[t.workType] || '', esc(umap.get(t.claimerId)?.displayName || ''), t.settlementAmount || 0, esc(t.settlementDetail), t.settledAt ? fmtDate(t.settledAt) : ''].join(','))].join('\n');
    return new Response('\uFEFF' + csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="bills.csv"' } });
  }

  return json({ error: '接口不存在' }, 404);
}
