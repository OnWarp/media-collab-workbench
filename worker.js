const encoder = new TextEncoder();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const now = () => Date.now();
const id = () => crypto.randomUUID();
const safeUrl = v => { try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };
const jget = (v, d = []) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };
const jset = v => JSON.stringify(v ?? []);

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 210000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, '0')).join('');
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
  return await one(env.DB, 'SELECT id,username,displayName,salt,passwordHash,role,maxClaims,showTutorial,createdAt FROM users WHERE id=?', [s.userId]);
}
const publicUser = r => ({ id: r.id, username: r.username, displayName: r.displayName, role: r.role, maxClaims: r.maxClaims, showTutorial: !!r.showTutorial, createdAt: r.createdAt });
async function usersMap(env) {
  const rows = await all(env.DB, 'SELECT id, displayName FROM users');
  return new Map(rows.map(u => [u.id, u]));
}
function topicView(row, umap) {
  const amt = row.settlementAmount != null ? row.settlementAmount : (row.workType === 'full' ? 40 : 15);
  return {
    id: row.id, title: row.title, intro: row.intro,
    referenceLinks: jget(row.referenceLinks, []),
    mediaLinks: jget(row.mediaLinks, []),
    copyText: row.copyText, workType: row.workType,
    series: jget(row.series, []), deadline: row.deadline,
    status: row.status, stage: row.stage, createdBy: row.createdBy, claimerId: row.claimerId,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    settlementStatus: row.settlementStatus,
    settlementAmount: amt,
    settlementDetail: row.settlementDetail, settledAt: row.settledAt,
    recycledAt: row.recycledAt, recycledReason: row.recycledReason, recycleDays: row.recycleDays,
    traffic: row.traffic ? jget(row.traffic) : undefined,
    videoLink: row.videoLink, videoType: row.videoType, reviewStage: row.reviewStage,
    trafficDueAt: row.trafficDueAt, abandonRequested: !!row.abandonRequested,
    rejectedNotes: jget(row.rejectedNotes, []), favoritedBy: jget(row.favoritedBy, []),
    authorName: umap.get(row.createdBy)?.displayName || '未知用户',
    claimerName: row.claimerId ? (umap.get(row.claimerId)?.displayName || '') : '',
    displayAmount: amt,
    recycled: !!row.recycledAt
  };
}
const msgView = r => ({ id: r.id, userId: r.userId, topicId: r.topicId, content: r.content, type: r.type, read: !!r.read, readAt: r.readAt, createdAt: r.createdAt, deleted: !!r.deleted, deletedAt: r.deletedAt });
const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/upload' || url.pathname === '/api/upload/video') return upload(request, env, url.pathname.endsWith('/video'));
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    if (url.pathname.startsWith('/uploads/')) {
      const object = await env.UPLOADS.get(url.pathname.slice(1));
      if (!object) return new Response('Not found', { status: 404 });
      const headers = new Headers(); object.writeHttpMetadata(headers); headers.set('etag', object.httpEtag); headers.set('cache-control', 'private, max-age=3600');
      return new Response(object.body, { headers });
    }
    return env.ASSETS.fetch(request);
  }
};

async function upload(request, env, video) {
  const me = await authUser(request, env);
  if (!me) return json({ error: '未登录或登录已失效' }, 401);
  if (video) {
    const form = await request.formData(); const file = form.get('file');
    if (!(file instanceof File) || file.size > 25 * 1024 * 1024) return json({ error: '视频必须小于 25MB' }, 400);
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return json({ error: '仅支持 mp4、webm、mov、m4v' }, 400);
    const key = `uploads/videos/${id()}.${ext}`; await env.UPLOADS.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'video/mp4' } });
    return json({ url: '/' + key });
  }
  const { data } = await request.json();
  const match = typeof data === 'string' && data.match(/^data:(image\/(png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return json({ error: '仅支持 PNG/JPG/GIF/WebP 图片' }, 400);
  const binary = Uint8Array.from(atob(match[3]), c => c.charCodeAt(0));
  if (binary.byteLength > 3 * 1024 * 1024) return json({ error: '图片必须小于 3MB' }, 400);
  const ext = match[2] === 'jpeg' ? 'jpg' : match[2]; const key = `uploads/${id()}.${ext}`;
  await env.UPLOADS.put(key, binary, { httpMetadata: { contentType: match[1] } }); return json({ url: '/' + key });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const p = url.pathname; const method = request.method;
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  let body = {};
  if (['POST', 'PUT'].includes(method)) { try { body = await request.json(); } catch { return json({ error: '请求必须是 JSON' }, 400); } }

  const me = await authUser(request, env);
  const requireUser = () => me ? null : json({ error: '未登录或登录已失效' }, 401);
  const admin = () => me?.role === 'admin';
  const umap = await usersMap(env);
  const getTopic = id => one(env.DB, 'SELECT * FROM topics WHERE id=?', [id]);
  const canRead = t => !t.recycledAt || admin() || t.createdBy === me?.id || t.claimerId === me?.id;
  const message = async (userId, topicId, content, type = 'info') => { if (userId) await run(env.DB, 'INSERT INTO messages (userId,topicId,content,type,createdAt) VALUES (?,?,?,?,?)', [userId, topicId, content, type, now()]); };

  // ---- 公开/引导 ----
  if (p === '/api/bootstrap' && method === 'POST') {
    const cnt = (await one(env.DB, 'SELECT COUNT(*) c FROM users')).c;
    if (cnt || !env.BOOTSTRAP_TOKEN || request.headers.get('x-bootstrap-token') !== env.BOOTSTRAP_TOKEN) return json({ error: '不可用' }, 403);
    const username = String(body.username || ''); const password = String(body.password || '');
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(username) || password.length < 10) return json({ error: '用户名或密码不符合安全要求' }, 400);
    const salt = id();
    await run(env.DB, 'INSERT INTO users (username,displayName,salt,passwordHash,role,maxClaims,showTutorial,createdAt) VALUES (?,?,?,?,?,?,?,?)', [username, String(body.displayName || username).slice(0, 80), salt, await passwordHash(password, salt), 'admin', 999, 1, now()]);
    return json({ ok: true });
  }
  if (p === '/api/auth-check') return requireUser() || json({ ok: true });

  if (p === '/api/register' && method === 'POST') {
    const username = String(body.username || ''); const password = String(body.password || '');
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(username) || password.length < 10) return json({ error: '用户名须为 3-32 位字符，密码至少 10 位' }, 400);
    if (await one(env.DB, 'SELECT 1 FROM users WHERE username=?', [username])) return json({ error: '用户名已存在' }, 409);
    const salt = id();
    const res = await run(env.DB, 'INSERT INTO users (username,displayName,salt,passwordHash,role,maxClaims,showTutorial,createdAt) VALUES (?,?,?,?,?,?,?,?)', [username, String(body.displayName || username).slice(0, 80), salt, await passwordHash(password, salt), 'member', 10, 1, now()]);
    const uid = res.meta.last_row_id;
    const u = await one(env.DB, 'SELECT * FROM users WHERE id=?', [uid]);
    const tk = id();
    await run(env.DB, 'INSERT INTO sessions (token,userId,expiresAt) VALUES (?,?,?)', [tk, uid, now() + 7 * 86400000]);
    return json({ token: tk, user: publicUser(u) });
  }
  if (p === '/api/login' && method === 'POST') {
    const u = await one(env.DB, 'SELECT * FROM users WHERE username=?', [String(body.username || '')]);
    if (!u || !crypto.timingSafeEqual(encoder.encode(u.passwordHash), encoder.encode(await passwordHash(String(body.password || ''), u.salt)))) return json({ error: '用户名或密码错误' }, 401);
    const tk = id();
    await run(env.DB, 'INSERT INTO sessions (token,userId,expiresAt) VALUES (?,?,?)', [tk, u.id, now() + 7 * 86400000]);
    return json({ token: tk, user: publicUser(u) });
  }

  const denied = requireUser(); if (denied) return denied;

  if (p === '/api/logout' && method === 'POST') { await run(env.DB, 'DELETE FROM sessions WHERE token=?', [token]); return json({ ok: true }); }
  if (p === '/api/me' && method === 'GET') return json(publicUser(me));
  if (p === '/api/me/tutorial' && method === 'POST') { await run(env.DB, 'UPDATE users SET showTutorial=0 WHERE id=?', [me.id]); return json({ ok: true }); }

  if (p === '/api/board' && method === 'GET') {
    const a = await one(env.DB, 'SELECT * FROM announcements WHERE id=1');
    return json(a ? { notice: a.notice, referenceVideos: jget(a.referenceVideos, []) } : { notice: '', referenceVideos: [] });
  }
  if (p === '/api/board' && method === 'PUT') {
    if (!admin()) return json({ error: '无权限' }, 403);
    const notice = String(body.notice || '').slice(0, 5000);
    const referenceVideos = (body.referenceVideos || []).filter(v => safeUrl(v.url)).slice(0, 20);
    const exists = await one(env.DB, 'SELECT 1 FROM announcements WHERE id=1');
    if (exists) await run(env.DB, 'UPDATE announcements SET notice=?, referenceVideos=? WHERE id=1', [notice, jset(referenceVideos)]);
    else await run(env.DB, 'INSERT INTO announcements (id,notice,referenceVideos) VALUES (1,?,?)', [notice, jset(referenceVideos)]);
    return json({ notice, referenceVideos });
  }

  if (p === '/api/users' && method === 'GET') { if (!admin()) return json({ error: '无权限' }, 403); const rows = await all(env.DB, 'SELECT * FROM users'); return json(rows.map(publicUser)); }
  if (p === '/api/users' && method === 'POST') {
    if (!admin()) return json({ error: '无权限' }, 403);
    const username = String(body.username || ''), password = String(body.password || '');
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(username) || password.length < 10) return json({ error: '用户名或密码不符合安全要求' }, 400);
    if (await one(env.DB, 'SELECT 1 FROM users WHERE username=?', [username])) return json({ error: '用户名已存在' }, 409);
    const salt = id();
    const res = await run(env.DB, 'INSERT INTO users (username,displayName,salt,passwordHash,role,maxClaims,showTutorial,createdAt) VALUES (?,?,?,?,?,?,?,?)', [username, String(body.displayName || username).slice(0, 80), salt, await passwordHash(password, salt), 'member', Math.max(1, Number(body.maxClaims) || 10), 1, now()]);
    const u = await one(env.DB, 'SELECT * FROM users WHERE id=?', [res.meta.last_row_id]);
    return json(publicUser(u));
  }
  const userMatch = p.match(/^\/api\/users\/(\d+)$/);
  if (userMatch && method === 'PUT') {
    if (!admin()) return json({ error: '无权限' }, 403);
    const u = await one(env.DB, 'SELECT * FROM users WHERE id=?', [Number(userMatch[1])]);
    if (!u) return json({ error: '用户不存在' }, 404);
    const sets = []; const vals = [];
    if (body.displayName !== undefined) { sets.push('displayName=?'); vals.push(String(body.displayName).slice(0, 80)); }
    if (body.maxClaims !== undefined) { sets.push('maxClaims=?'); vals.push(Math.max(1, Number(body.maxClaims) || u.maxClaims)); }
    if (!sets.length) return json(publicUser(u));
    vals.push(u.id);
    await run(env.DB, `UPDATE users SET ${sets.join(',')} WHERE id=?`, vals);
    return json(publicUser(await one(env.DB, 'SELECT * FROM users WHERE id=?', [u.id])));
  }

  if (p === '/api/series' && method === 'GET') {
    const rows = await all(env.DB, "SELECT series FROM topics WHERE recycledAt IS NULL");
    const counts = {};
    for (const r of rows) for (const s of jget(r.series, [])) counts[s] = (counts[s] || 0) + 1;
    return json(Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count));
  }

  if (p === '/api/topics' && method === 'GET') {
    const recycled = url.searchParams.get('recycled') === '1';
    const where = [recycled ? 'recycledAt IS NOT NULL' : 'recycledAt IS NULL'];
    const params = [];
    for (const k of ['status', 'settlement', 'workType']) {
      const v = url.searchParams.get(k);
      if (v) { where.push(k === 'settlement' ? 'settlementStatus=?' : `${k}=?`); params.push(v); }
    }
    if (url.searchParams.get('traffic') === '1') where.push("workType='full' AND status='finished'");
    if (url.searchParams.get('mine') === '1') { where.push('claimerId=?'); params.push(me.id); }
    if (url.searchParams.get('author') === '1') { where.push('createdBy=?'); params.push(me.id); }
    let rows = await all(env.DB, `SELECT * FROM topics WHERE ${where.join(' AND ')} ORDER BY updatedAt DESC`, params);
    if (recycled) rows = rows.filter(canRead);
    return json(rows.map(r => topicView(r, umap)));
  }
  if (p === '/api/topics' && method === 'POST') {
    const title = String(body.title || '').trim(); if (!title) return json({ error: '标题必填' }, 400);
    const refs = Array.isArray(body.referenceLinks) ? body.referenceLinks : [];
    const media = Array.isArray(body.mediaLinks) ? body.mediaLinks : [];
    if (![...refs, ...media.map(x => x.url)].every(safeUrl)) return json({ error: '链接仅支持 HTTP(S)' }, 400);
    const series = Array.isArray(body.series) ? body.series : String(body.series || '').split(/[#\s]+/).filter(Boolean);
    const res = await run(env.DB, 'INSERT INTO topics (title,intro,referenceLinks,mediaLinks,copyText,workType,series,deadline,status,stage,createdBy,claimerId,createdAt,updatedAt,settlementStatus,favoritedBy,rejectedNotes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [title, String(body.intro || '').slice(0, 10000), jset(refs), jset(media), String(body.copyText || ''), ['full', 'copywriting'].includes(body.workType) ? body.workType : null, jset(series.slice(0, 12)), body.deadline || null, 'pending', 'confirm', me.id, null, now(), now(), 'unsettled', jset([]), jset([])]);
    const row = await getTopic(res.meta.last_row_id);
    return json(topicView(row, umap));
  }

  const match = p.match(/^\/api\/topics\/(\d+)(?:\/(claim|stage|submit\/copy|submit\/video|review|favorite|comment|material|traffic|settle|discard|remove|restore))?$/);
  if (match) {
    const tid = Number(match[1]);
    const t = await getTopic(tid); if (!t) return json({ error: '选题不存在' }, 404);
    const action = match[2];
    if (!action && method === 'GET') {
      if (!canRead(t)) return json({ error: '选题不存在' }, 404);
      const comments = await all(env.DB, 'SELECT * FROM comments WHERE topicId=? ORDER BY createdAt', [tid]);
      const materials = await all(env.DB, 'SELECT * FROM materials WHERE topicId=? ORDER BY version', [tid]);
      return json({ ...topicView(t, umap), comments, materials, logs: [] });
    }
    if (!action && method === 'PUT') {
      if (!admin() && t.createdBy !== me.id) return json({ error: '无权限' }, 403);
      if (t.status === 'finished' && !admin()) return json({ error: '已完结选题不可修改' }, 400);
      const sets = []; const vals = [];
      for (const k of ['title', 'intro', 'copyText', 'deadline']) if (body[k] !== undefined) { sets.push(`${k}=?`); vals.push(String(body[k] || '')); }
      if (body.workType !== undefined && ['full', 'copywriting'].includes(body.workType)) { sets.push('workType=?'); vals.push(body.workType); }
      if (body.series !== undefined) { sets.push('series=?'); vals.push(jset(Array.isArray(body.series) ? body.series : String(body.series).split(/[#\s]+/).filter(Boolean))); }
      if (body.referenceLinks !== undefined) { if (!body.referenceLinks.every(safeUrl)) return json({ error: '链接仅支持 HTTP(S)' }, 400); sets.push('referenceLinks=?'); vals.push(jset(body.referenceLinks)); }
      if (body.mediaLinks !== undefined) { if (!body.mediaLinks.every(m => safeUrl(m.url))) return json({ error: '链接仅支持 HTTP(S)' }, 400); sets.push('mediaLinks=?'); vals.push(jset(body.mediaLinks)); }
      sets.push('updatedAt=?'); vals.push(now()); vals.push(tid);
      await run(env.DB, `UPDATE topics SET ${sets.join(',')} WHERE id=?`, vals);
      return json(topicView(await getTopic(tid), umap));
    }
    if (action === 'claim' && method === 'POST') {
      if (t.status !== 'pending') return json({ error: '不可认领' }, 400);
      const wt = body.workType || t.workType; if (!['full', 'copywriting'].includes(wt)) return json({ error: '请选择类型' }, 400);
      await run(env.DB, 'UPDATE topics SET workType=?, claimerId=?, status=?, updatedAt=? WHERE id=?', [wt, me.id, 'in_progress', now(), tid]);
      return json(topicView(await getTopic(tid), umap));
    }
    if (action === 'stage' && method === 'POST') {
      if (t.claimerId !== me.id || t.stage !== 'confirm') return json({ error: '无权限或阶段错误' }, 403);
      await run(env.DB, "UPDATE topics SET stage='copywriting', updatedAt=? WHERE id=?", [now(), tid]);
      return json(topicView(await getTopic(tid), umap));
    }
    if (action === 'submit/copy' && method === 'POST') {
      if (t.claimerId !== me.id || t.stage !== 'copywriting') return json({ error: '阶段错误' }, 400);
      const copyText = body.copyText != null ? String(body.copyText) : t.copyText;
      await run(env.DB, "UPDATE topics SET copyText=?, status='review', reviewStage='copywriting', updatedAt=? WHERE id=?", [copyText, now(), tid]);
      return json(topicView(await getTopic(tid), umap));
    }
    if (action === 'submit/video' && method === 'POST') {
      if (t.claimerId !== me.id || t.stage !== 'video') return json({ error: '阶段错误' }, 400);
      if (!safeUrl(body.videoLink) && !/^\/uploads\/videos\//.test(body.videoLink || '')) return json({ error: '视频或阶段错误' }, 400);
      const offline = body.submitMode === 'offline';
      if (offline) await run(env.DB, "UPDATE topics SET videoLink=?, videoType='offline', status='finished', stage='done', trafficDueAt=?, updatedAt=? WHERE id=?", [body.videoLink, now() + 7 * 86400000, now(), tid]);
      else await run(env.DB, "UPDATE topics SET videoLink=?, videoType='import', status='review', reviewStage='video', updatedAt=? WHERE id=?", [body.videoLink, now(), tid]);
      return json(topicView(await getTopic(tid), umap));
    }
    if (action === 'review' && method === 'POST') {
      if (!admin() || t.status !== 'review') return json({ error: '无权限' }, 403);
      const sets = []; const vals = [];
      if (body.action === 'reject') { sets.push("status='in_progress'", `stage='${t.reviewStage}'`); const notes = jget(t.rejectedNotes, []); notes.push({ note: String(body.note || ''), at: now(), by: me.id }); sets.push('rejectedNotes=?'); vals.push(jset(notes)); }
      else if (t.reviewStage === 'copywriting' && t.workType === 'full') { sets.push("status='in_progress'", "stage='video'"); }
      else { sets.push("status='finished'", "stage='done'"); }
      sets.push('updatedAt=?'); vals.push(now()); vals.push(tid);
      await run(env.DB, `UPDATE topics SET ${sets.join(',')} WHERE id=?`, vals);
      return json(topicView(await getTopic(tid), umap));
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
      const res = await run(env.DB, 'INSERT INTO comments (topicId,userId,userName,content,createdAt) VALUES (?,?,?,?,?)', [tid, me.id, me.displayName, content, now()]);
      return json(await one(env.DB, 'SELECT * FROM comments WHERE id=?', [res.meta.last_row_id]));
    }
    if (action === 'material' && method === 'POST') {
      if ((t.claimerId !== me.id && !admin()) || !safeUrl(body.url)) return json({ error: '无权限或链接无效' }, 403);
      const cnt = (await one(env.DB, 'SELECT COUNT(*) c FROM materials WHERE topicId=?', [tid])).c;
      const res = await run(env.DB, 'INSERT INTO materials (topicId,userId,url,note,version,createdAt) VALUES (?,?,?,?,?,?)', [tid, me.id, body.url, String(body.note || ''), cnt + 1, now()]);
      return json(await one(env.DB, 'SELECT * FROM materials WHERE id=?', [res.meta.last_row_id]));
    }
    if (action === 'settle' && method === 'POST') {
      if (!admin() || t.status !== 'finished') return json({ error: '无权限' }, 403);
      const amt = Number(body.amount) || (t.workType === 'full' ? 40 : 15);
      const settled = body.action === 'pay';
      await run(env.DB, 'UPDATE topics SET settlementAmount=?, settlementDetail=?, settlementStatus=?, settledAt=? WHERE id=?', [amt, String(body.detail || ''), settled ? 'settled' : t.settlementStatus, settled ? now() : t.settledAt, tid]);
      return json(topicView(await getTopic(tid), umap));
    }
    if (action === 'traffic' && method === 'POST') {
      if (t.claimerId !== me.id || t.status !== 'finished' || t.workType !== 'full') return json({ error: '无权限或状态错误' }, 403);
      const days = (Array.isArray(body.days) ? body.days : []).slice(0, 31).map(d => ({ date: String(d.date || '').slice(0, 10), douyin: d.douyin || {}, kuaishou: d.kuaishou || {}, xiaohongshu: d.xiaohongshu || {} })).filter(d => d.date);
      await run(env.DB, 'UPDATE topics SET traffic=? WHERE id=?', [jset({ days, enteredAt: now() }), tid]);
      return json(topicView(await getTopic(tid), umap));
    }
    if (['discard', 'remove'].includes(action) && method === 'POST') {
      if (!admin() && t.createdBy !== me.id && !(action === 'discard' && t.claimerId === me.id)) return json({ error: '无权限' }, 403);
      await run(env.DB, 'UPDATE topics SET recycledAt=?, recycledReason=?, recycleDays=? WHERE id=?', [now(), action === 'discard' ? 'discard' : 'delete', Math.min(365, Math.max(1, Number(body.days) || 30)), tid]);
      return json(topicView(await getTopic(tid), umap));
    }
    if (action === 'restore' && method === 'POST') {
      if (!canRead(t)) return json({ error: '无权限' }, 403);
      await run(env.DB, 'UPDATE topics SET recycledAt=NULL, recycledReason=NULL WHERE id=?', [tid]);
      return json(topicView(await getTopic(tid), umap));
    }
  }

  const purge = p.match(/^\/api\/topics\/(\d+)\/purge$/);
  if (purge && method === 'DELETE') {
    if (!admin()) return json({ error: '无权限' }, 403);
    const tid = Number(purge[1]); const t = await getTopic(tid); if (!t?.recycledAt) return json({ error: '选题不存在或未回收' }, 404);
    await run(env.DB, 'DELETE FROM topics WHERE id=?', [tid]);
    await run(env.DB, 'DELETE FROM comments WHERE topicId=?', [tid]);
    await run(env.DB, 'DELETE FROM materials WHERE topicId=?', [tid]);
    await run(env.DB, 'DELETE FROM messages WHERE topicId=?', [tid]);
    return json({ ok: true });
  }

  const abandon = p.match(/^\/api\/topics\/(\d+)\/abandon(?:\/(approve))?$/);
  if (abandon && method === 'POST') {
    const tid = Number(abandon[1]); const t = await getTopic(tid); if (!t) return json({ error: '选题不存在' }, 404);
    if (abandon[2]) {
      if (!admin() && t.createdBy !== me.id) return json({ error: '无权限' }, 403);
      if (!t.abandonRequested) return json({ error: '未申请弃单' }, 400);
      await run(env.DB, "UPDATE topics SET claimerId=NULL, status='pending', stage='confirm', abandonRequested=0 WHERE id=?", [tid]);
    } else {
      if (t.claimerId !== me.id) return json({ error: '无权限' }, 403);
      await run(env.DB, 'UPDATE topics SET abandonRequested=1 WHERE id=?', [tid]);
    }
    return json(topicView(await getTopic(tid), umap));
  }

  const deadline = p.match(/^\/api\/topics\/(\d+)\/deadline$/);
  if (deadline && method === 'POST') {
    const tid = Number(deadline[1]); const t = await getTopic(tid); if (!t) return json({ error: '选题不存在' }, 404);
    if (!admin() && t.createdBy !== me.id && t.claimerId !== me.id) return json({ error: '无权限' }, 403);
    await run(env.DB, 'UPDATE topics SET deadline=?, updatedAt=? WHERE id=?', [body.deadline || null, now(), tid]);
    return json(topicView(await getTopic(tid), umap));
  }

  if (p === '/api/messages' && method === 'GET') { const rows = await all(env.DB, 'SELECT * FROM messages WHERE userId=? AND deleted=0 ORDER BY createdAt DESC', [me.id]); return json(rows.map(msgView)); }
  if (p === '/api/messages/unread' && method === 'GET') { const r = await one(env.DB, 'SELECT COUNT(*) c FROM messages WHERE userId=? AND deleted=0 AND read=0', [me.id]); return json({ count: r.c }); }
  if (p === '/api/messages/read' && method === 'POST') {
    if (body.id) await run(env.DB, 'UPDATE messages SET read=1, readAt=? WHERE id=? AND userId=?', [now(), Number(body.id), me.id]);
    else await run(env.DB, 'UPDATE messages SET read=1, readAt=? WHERE userId=? AND deleted=0', [now(), me.id]);
    return json({ ok: true });
  }
  const msg = p.match(/^\/api\/messages\/(\d+)$/);
  if (msg && method === 'DELETE') {
    const r = await one(env.DB, 'SELECT * FROM messages WHERE id=? AND userId=?', [Number(msg[1]), me.id]); if (!r) return json({ error: '消息不存在' }, 404);
    await run(env.DB, 'UPDATE messages SET deleted=1, deletedAt=? WHERE id=?', [now(), Number(msg[1])]);
    return json({ ok: true });
  }
  if (p === '/api/messages/recycle' && method === 'GET') {
    const rows = await all(env.DB, 'SELECT * FROM messages WHERE userId=? AND deleted=1 AND deletedAt > ?', [me.id, now() - 7 * 86400000]);
    return json(rows.map(msgView));
  }
  const restoreMessage = p.match(/^\/api\/messages\/recycle\/(\d+)$/);
  if (restoreMessage && method === 'POST') {
    const r = await one(env.DB, 'SELECT * FROM messages WHERE id=? AND userId=? AND deleted=1', [Number(restoreMessage[1]), me.id]); if (!r) return json({ error: '消息不存在' }, 404);
    await run(env.DB, 'UPDATE messages SET deleted=0, read=0, deletedAt=NULL WHERE id=?', [Number(restoreMessage[1])]);
    return json({ ok: true });
  }

  if (p === '/api/pending' && method === 'GET') {
    const active = await all(env.DB, "SELECT id,status,settlementStatus,claimerId,recycledAt FROM topics WHERE recycledAt IS NULL");
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
    const published = (await one(env.DB, 'SELECT COUNT(*) c FROM topics WHERE createdBy=?', [me.id])).c;
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
    const topics = await all(env.DB, "SELECT * FROM topics WHERE recycledAt IS NULL");
    const members = await all(env.DB, "SELECT * FROM users WHERE role='member'");
    return json({
      total: topics.length,
      pending: topics.filter(t => t.status === 'pending').length,
      inProgress: topics.filter(t => t.status === 'in_progress').length,
      review: topics.filter(t => t.status === 'review').length,
      finished: topics.filter(t => t.status === 'finished').length,
      settledAmount: topics.filter(t => t.settlementStatus === 'settled').reduce((s, t) => s + (t.settlementAmount || 0), 0),
      unsettledAmount: topics.filter(t => t.status === 'finished' && t.settlementStatus === 'unsettled').reduce((s, t) => s + (t.settlementAmount || 0), 0),
      pendingSettleCount: topics.filter(t => t.status === 'finished' && t.settlementStatus === 'unsettled').length,
      weeklyCount: (await one(env.DB, 'SELECT COUNT(*) c FROM weeklySettlements')).c,
      perMember: members.map(m => {
        const mine = topics.filter(t => t.claimerId === m.id);
        return { id: m.id, name: m.displayName, maxClaims: m.maxClaims, claimed: mine.length, finished: mine.filter(t => t.status === 'finished').length, settledAmount: mine.filter(t => t.settlementStatus === 'settled').reduce((s, t) => s + (t.settlementAmount || 0), 0) };
      })
    });
  }
  if (p === '/api/settle/week' && method === 'POST') {
    if (!admin()) return json({ error: '无权限' }, 403);
    const pending = await all(env.DB, "SELECT * FROM topics WHERE status='finished' AND settlementStatus='unsettled'");
    const stmts = []; let total = 0;
    for (const t of pending) {
      const amt = t.settlementAmount != null ? t.settlementAmount : (t.workType === 'full' ? 40 : 15);
      total += amt;
      stmts.push(env.DB.prepare('UPDATE topics SET settlementAmount=?, settlementStatus=?, settledAt=? WHERE id=?').bind(amt, 'settled', now(), t.id));
    }
    const ins = env.DB.prepare('INSERT INTO weeklySettlements (topicIds,count,totalAmount,createdBy,createdAt) VALUES (?,?,?,?,?)').bind(jset(pending.map(t => t.id)), pending.length, total, me.id, now());
    stmts.push(ins);
    await env.DB.batch(stmts);
    return json({ ok: true, count: pending.length, total });
  }
  if (p === '/api/settle/weekly' && method === 'GET') {
    if (!admin()) return json({ error: '无权限' }, 403);
    const rows = await all(env.DB, 'SELECT * FROM weeklySettlements ORDER BY createdAt DESC');
    return json(rows.map(r => ({ ...r, topicIds: jget(r.topicIds, []) })));
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
    const csv = ['选题ID,选题标题,类型,认领人,结算金额,结算明细', ...rows.map(t => [t.id, esc(t.title), t.workType, esc(umap.get(t.claimerId)?.displayName || ''), t.settlementAmount || 0, esc(t.settlementDetail)].join(','))].join('\n');
    return new Response('\uFEFF' + csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="bills.csv"' } });
  }

  return json({ error: '接口不存在' }, 404);
}
