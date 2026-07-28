const encoder = new TextEncoder();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const now = () => Date.now();
const id = () => crypto.randomUUID();
const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };
const publicUser = ({ passwordHash, salt, ...user }) => user;
const defaultDb = () => ({ users: [], topics: [], comments: [], materials: [], messages: [], logs: [], sessions: {}, announcements: [], weeklySettlements: [], messageRecycle: [] });

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 210000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function topicView(db, topic) {
  const user = uid => db.users.find(x => x.id === uid)?.displayName || '未知用户';
  return { ...topic, authorName: user(topic.createdBy), claimerName: topic.claimerId ? user(topic.claimerId) : '', displayAmount: topic.settlementAmount ?? (topic.workType === 'full' ? 40 : 15), recycled: !!topic.recycledAt };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/upload' || url.pathname === '/api/upload/video') return upload(request, env, url.pathname.endsWith('/video'));
    if (url.pathname.startsWith('/api/')) return env.APP_STATE.getByName('primary').fetch(request);
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
  const auth = await env.APP_STATE.getByName('primary').fetch(new Request(new URL('/api/auth-check', request.url), { headers: request.headers }));
  if (!auth.ok) return auth;
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

export class AppState {
  constructor(state, env) { this.state = state; this.env = env; }
  async load() { return await this.state.storage.get('db') || defaultDb(); }
  async fetch(request) {
    const db = await this.load(); const url = new URL(request.url); const p = url.pathname; const method = request.method;
    let body = {}; if (['POST', 'PUT'].includes(method)) { try { body = await request.json(); } catch { return json({ error: '请求必须是 JSON' }, 400); } }
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const me = token && db.sessions[token] && db.sessions[token].expiresAt > now() ? db.users.find(u => u.id === db.sessions[token].userId) : null;
    const save = async response => { await this.state.storage.put('db', db); return response; };
    const requireUser = () => me ? null : json({ error: '未登录或登录已失效' }, 401);
    const admin = () => me?.role === 'admin';
    const canRead = t => !t.recycledAt || admin() || t.createdBy === me?.id || t.claimerId === me?.id;
    const next = key => Math.max(0, ...db[key].map(x => x.id || 0)) + 1;
    const message = (userId, topicId, content, type = 'info') => { if (userId) db.messages.push({ id: next('messages'), userId, topicId, content, type, read: false, createdAt: now() }); };

    if (p === '/api/bootstrap' && method === 'POST') {
      if (db.users.length || !this.env.BOOTSTRAP_TOKEN || request.headers.get('x-bootstrap-token') !== this.env.BOOTSTRAP_TOKEN) return json({ error: '不可用' }, 403);
      const username = String(body.username || ''); const password = String(body.password || '');
      if (!/^[A-Za-z0-9_-]{3,32}$/.test(username) || password.length < 10) return json({ error: '用户名或密码不符合安全要求' }, 400);
      const salt = id(); const user = { id: 1, username, displayName: String(body.displayName || username).slice(0, 80), salt, passwordHash: await passwordHash(password, salt), role: 'admin', maxClaims: 999, showTutorial: true, createdAt: now() };
      db.users.push(user); return save(json({ ok: true }));
    }
    if (p === '/api/auth-check') return requireUser() || json({ ok: true });
    if (p === '/api/register' && method === 'POST') {
      const username = String(body.username || ''); const password = String(body.password || '');
      if (!/^[A-Za-z0-9_-]{3,32}$/.test(username) || password.length < 10) return json({ error: '用户名须为 3-32 位字符，密码至少 10 位' }, 400);
      if (db.users.some(u => u.username === username)) return json({ error: '用户名已存在' }, 409);
      const salt = id(); const user = { id: next('users'), username, displayName: String(body.displayName || username).slice(0, 80), salt, passwordHash: await passwordHash(password, salt), role: 'member', maxClaims: 10, showTutorial: true, createdAt: now() };
      db.users.push(user); const session = id(); db.sessions[session] = { userId: user.id, expiresAt: now() + 7 * 86400000 };
      return save(json({ token: session, user: publicUser(user) }));
    }
    if (p === '/api/login' && method === 'POST') {
      const user = db.users.find(u => u.username === body.username); if (!user || !crypto.timingSafeEqual(encoder.encode(user.passwordHash), encoder.encode(await passwordHash(String(body.password || ''), user.salt)))) return json({ error: '用户名或密码错误' }, 401);
      const session = id(); db.sessions[session] = { userId: user.id, expiresAt: now() + 7 * 86400000 }; return save(json({ token: session, user: publicUser(user) }));
    }
    const denied = requireUser(); if (denied) return denied;
    if (p === '/api/logout' && method === 'POST') { delete db.sessions[token]; return save(json({ ok: true })); }
    if (p === '/api/me' && method === 'GET') return json(publicUser(me));
    if (p === '/api/me/tutorial' && method === 'POST') { me.showTutorial = false; return save(json({ ok: true })); }
    if (p === '/api/board' && method === 'GET') return json(db.announcements[0] || { notice: '', referenceVideos: [] });
    if (p === '/api/board' && method === 'PUT') { if (!admin()) return json({ error: '无权限' }, 403); const board = db.announcements[0] || (db.announcements[0] = { id: 1 }); board.notice = String(body.notice || '').slice(0, 5000); board.referenceVideos = (body.referenceVideos || []).filter(v => safeUrl(v.url)).slice(0, 20); return save(json(board)); }
    if (p === '/api/users' && method === 'GET') { if (!admin()) return json({ error: '无权限' }, 403); return json(db.users.map(publicUser)); }
    if (p === '/api/users' && method === 'POST') { if (!admin()) return json({ error: '无权限' }, 403); const username=String(body.username||''), password=String(body.password||''); if(!/^[A-Za-z0-9_-]{3,32}$/.test(username)||password.length<10)return json({error:'用户名或密码不符合安全要求'},400); if(db.users.some(u=>u.username===username))return json({error:'用户名已存在'},409); const salt=id(); const u={id:next('users'),username,displayName:String(body.displayName||username).slice(0,80),salt,passwordHash:await passwordHash(password,salt),role:'member',maxClaims:Math.max(1,Number(body.maxClaims)||10),showTutorial:true,createdAt:now()};db.users.push(u);return save(json(publicUser(u))); }
    const userMatch = p.match(/^\/api\/users\/(\d+)$/);
    if (userMatch && method === 'PUT') { if(!admin())return json({error:'无权限'},403);const u=db.users.find(x=>x.id===Number(userMatch[1]));if(!u)return json({error:'用户不存在'},404);if(body.displayName!==undefined)u.displayName=String(body.displayName).slice(0,80);if(body.maxClaims!==undefined)u.maxClaims=Math.max(1,Number(body.maxClaims)||u.maxClaims);return save(json(publicUser(u))); }
    if (p === '/api/series' && method === 'GET') { const counts={};for(const t of db.topics)if(!t.recycledAt)for(const s of t.series||[])counts[s]=(counts[s]||0)+1;return json(Object.entries(counts).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count)); }
    if (p === '/api/topics' && method === 'GET') { let list = db.topics.filter(t => url.searchParams.get('recycled') === '1' ? canRead(t) && t.recycledAt : !t.recycledAt); for(const k of ['status','settlement','workType'])if(url.searchParams.get(k))list=list.filter(t=>t[k+(k==='settlement'?'Status':'')]===url.searchParams.get(k));if(url.searchParams.get('traffic')==='1')list=list.filter(t=>t.workType==='full'&&t.status==='finished'); if (url.searchParams.get('mine') === '1') list = list.filter(t => t.claimerId === me.id); if (url.searchParams.get('author') === '1') list = list.filter(t => t.createdBy === me.id); return json(list.sort((a,b) => b.updatedAt-a.updatedAt).map(t => topicView(db,t))); }
    if (p === '/api/topics' && method === 'POST') { const title = String(body.title || '').trim(); if (!title) return json({ error: '标题必填' }, 400); const refs = Array.isArray(body.referenceLinks) ? body.referenceLinks : []; const media = Array.isArray(body.mediaLinks) ? body.mediaLinks : []; if (![...refs, ...media.map(x => x.url)].every(safeUrl)) return json({ error: '链接仅支持 HTTP(S)' }, 400); const series=Array.isArray(body.series)?body.series:String(body.series||'').split(/[#\s]+/).filter(Boolean); const t = { id: next('topics'), title, intro: String(body.intro || '').slice(0,10000), referenceLinks: refs, mediaLinks: media, copyText: String(body.copyText || ''), workType: ['full','copywriting'].includes(body.workType) ? body.workType : null,series:series.slice(0,12), deadline:body.deadline||null, status:'pending',stage:'confirm',createdBy:me.id,claimerId:null,createdAt:now(),updatedAt:now(),settlementStatus:'unsettled',favoritedBy:[],rejectedNotes:[] }; db.topics.push(t); return save(json(topicView(db,t))); }
    const match = p.match(/^\/api\/topics\/(\d+)(?:\/(claim|stage|submit\/copy|submit\/video|review|favorite|comment|material|traffic|settle|discard|remove|restore))?$/); if (match) {
      const t = db.topics.find(x => x.id === Number(match[1])); if (!t) return json({ error: '选题不存在' }, 404); const action = match[2];
      if (!action && method === 'GET') { if (!canRead(t)) return json({ error: '选题不存在' }, 404); return json({ ...topicView(db,t), comments: db.comments.filter(x => x.topicId===t.id), materials: db.materials.filter(x=>x.topicId===t.id), logs: db.logs.filter(x=>x.topicId===t.id) }); }
      if (!action && method === 'PUT') { if(!admin()&&t.createdBy!==me.id)return json({error:'无权限'},403); if(t.status==='finished'&&!admin())return json({error:'已完结选题不可修改'},400); for(const k of ['title','intro','copyText','deadline'])if(body[k]!==undefined)t[k]=String(body[k]||''); if(body.workType!==undefined&&['full','copywriting'].includes(body.workType))t.workType=body.workType; if(body.series!==undefined)t.series=(Array.isArray(body.series)?body.series:String(body.series).split(/[#\s]+/)).filter(Boolean).slice(0,12); if(body.referenceLinks!==undefined){if(!body.referenceLinks.every(safeUrl))return json({error:'链接仅支持 HTTP(S)'},400);t.referenceLinks=body.referenceLinks;} if(body.mediaLinks!==undefined){if(!body.mediaLinks.every(m=>safeUrl(m.url)))return json({error:'链接仅支持 HTTP(S)'},400);t.mediaLinks=body.mediaLinks;}t.updatedAt=now();return save(json(topicView(db,t))); }
      if (action === 'claim' && method === 'POST') { if (t.status !== 'pending') return json({error:'不可认领'},400); const wt = body.workType || t.workType; if (!['full','copywriting'].includes(wt)) return json({error:'请选择类型'},400); t.workType=wt;t.claimerId=me.id;t.status='in_progress';t.updatedAt=now(); return save(json(topicView(db,t))); }
      if (action === 'stage' && method === 'POST') { if (t.claimerId!==me.id||t.stage!=='confirm') return json({error:'无权限或阶段错误'},403); t.stage='copywriting';t.updatedAt=now();return save(json(topicView(db,t))); }
      if (action === 'submit/copy' && method === 'POST') { if(t.claimerId!==me.id||t.stage!=='copywriting')return json({error:'阶段错误'},400);t.copyText=String(body.copyText??t.copyText);t.status='review';t.reviewStage='copywriting';return save(json(topicView(db,t))); }
      if (action === 'submit/video' && method === 'POST') { if(t.claimerId!==me.id||t.stage!=='video'||!safeUrl(body.videoLink) && !/^\/uploads\/videos\//.test(body.videoLink||''))return json({error:'视频或阶段错误'},400);t.videoLink=body.videoLink;t.videoType=body.submitMode==='offline'?'offline':'import';if(t.videoType==='offline'){t.status='finished';t.stage='done';t.trafficDueAt=now()+7*86400000;}else{t.status='review';t.reviewStage='video';}return save(json(topicView(db,t))); }
      if (action === 'review' && method === 'POST') { if(!admin()||t.status!=='review')return json({error:'无权限'},403);if(body.action==='reject'){t.status='in_progress';t.stage=t.reviewStage;t.rejectedNotes.push({note:String(body.note||''),at:now(),by:me.id});}else if(t.reviewStage==='copywriting'&&t.workType==='full'){t.status='in_progress';t.stage='video';}else{t.status='finished';t.stage='done';}t.updatedAt=now();return save(json(topicView(db,t))); }
      if (action === 'favorite' && method === 'POST') { const a=t.favoritedBy||[];const i=a.indexOf(me.id);if(i<0)a.push(me.id);else a.splice(i,1);t.favoritedBy=a;return save(json({favorited:i<0})); }
      if (action === 'comment' && method === 'POST') { if(!canRead(t))return json({error:'选题不存在'},404);const content=String(body.content||'').trim();if(!content)return json({error:'评论不能为空'},400);const c={id:next('comments'),topicId:t.id,userId:me.id,userName:me.displayName,content,createdAt:now()};db.comments.push(c);return save(json(c)); }
      if (action === 'material' && method === 'POST') { if(t.claimerId!==me.id&&!admin()||!safeUrl(body.url))return json({error:'无权限或链接无效'},403);const m={id:next('materials'),topicId:t.id,userId:me.id,url:body.url,note:String(body.note||''),version:db.materials.filter(x=>x.topicId===t.id).length+1,createdAt:now()};db.materials.push(m);return save(json(m)); }
      if (action === 'settle' && method === 'POST') { if(!admin()||t.status!=='finished')return json({error:'无权限'},403);t.settlementAmount=Number(body.amount)|| (t.workType==='full'?40:15);t.settlementDetail=String(body.detail||'');if(body.action==='pay'){t.settlementStatus='settled';t.settledAt=now();}return save(json(topicView(db,t))); }
      if (action === 'traffic' && method === 'POST') { if(t.claimerId!==me.id||t.status!=='finished'||t.workType!=='full')return json({error:'无权限或状态错误'},403);const days=(Array.isArray(body.days)?body.days:[]).slice(0,31).map(d=>({date:String(d.date||'').slice(0,10),douyin:d.douyin||{},kuaishou:d.kuaishou||{},xiaohongshu:d.xiaohongshu||{}})).filter(d=>d.date);t.traffic={days,enteredAt:now()};return save(json(topicView(db,t))); }
      if (['discard','remove'].includes(action) && method === 'POST') { if(!admin()&&t.createdBy!==me.id&&!(action==='discard'&&t.claimerId===me.id))return json({error:'无权限'},403);t.recycledAt=now();t.recycledReason=action==='discard'?'discard':'delete';t.recycleDays=Math.min(365,Math.max(1,Number(body.days)||30));return save(json(topicView(db,t))); }
      if (action === 'restore' && method === 'POST') { if(!canRead(t))return json({error:'无权限'},403);t.recycledAt=null;t.recycledReason=null;return save(json(topicView(db,t))); }
    }
    const purge = p.match(/^\/api\/topics\/(\d+)\/purge$/);
    if (purge && method === 'DELETE') { if(!admin())return json({error:'无权限'},403);const tid=Number(purge[1]);const t=db.topics.find(x=>x.id===tid);if(!t?.recycledAt)return json({error:'选题不存在或未回收'},404);db.topics=db.topics.filter(x=>x.id!==tid);for(const key of ['comments','materials','logs','messages'])db[key]=db[key].filter(x=>x.topicId!==tid);return save(json({ok:true})); }
    const abandon = p.match(/^\/api\/topics\/(\d+)\/abandon(?:\/(approve))?$/);
    if (abandon && method === 'POST') { const t=db.topics.find(x=>x.id===Number(abandon[1]));if(!t)return json({error:'选题不存在'},404);if(abandon[2]){if(!admin()&&t.createdBy!==me.id)return json({error:'无权限'},403);if(!t.abandonRequested)return json({error:'未申请弃单'},400);t.claimerId=null;t.status='pending';t.stage='confirm';t.abandonRequested=false;}else{if(t.claimerId!==me.id)return json({error:'无权限'},403);t.abandonRequested=true;}return save(json(topicView(db,t))); }
    const deadline = p.match(/^\/api\/topics\/(\d+)\/deadline$/);
    if (deadline && method === 'POST') { const t=db.topics.find(x=>x.id===Number(deadline[1]));if(!t)return json({error:'选题不存在'},404);if(!admin()&&t.createdBy!==me.id&&t.claimerId!==me.id)return json({error:'无权限'},403);t.deadline=body.deadline||null;t.updatedAt=now();return save(json(topicView(db,t))); }
    if (p === '/api/messages' && method === 'GET') return json(db.messages.filter(x=>x.userId===me.id&&!x.deleted).sort((a,b)=>b.createdAt-a.createdAt));
    if (p === '/api/messages/unread' && method === 'GET') return json({count:db.messages.filter(x=>x.userId===me.id&&!x.deleted&&!x.read).length});
    if (p === '/api/messages/read' && method === 'POST') { if(body.id){const m=db.messages.find(x=>x.id===Number(body.id)&&x.userId===me.id);if(m){m.read=true;m.readAt=now();}}else for(const m of db.messages)if(m.userId===me.id&&!m.deleted){m.read=true;m.readAt=now();}return save(json({ok:true})); }
    const msg = p.match(/^\/api\/messages\/(\d+)$/);
    if (msg && method === 'DELETE') { const m=db.messages.find(x=>x.id===Number(msg[1])&&x.userId===me.id);if(!m)return json({error:'消息不存在'},404);m.deleted=true;m.deletedAt=now();return save(json({ok:true})); }
    if (p === '/api/messages/recycle' && method === 'GET') return json(db.messages.filter(m=>m.userId===me.id&&m.deleted&&m.deletedAt>now()-7*86400000));
    const restoreMessage = p.match(/^\/api\/messages\/recycle\/(\d+)$/);
    if (restoreMessage && method === 'POST') { const m=db.messages.find(x=>x.id===Number(restoreMessage[1])&&x.userId===me.id&&x.deleted);if(!m)return json({error:'消息不存在'},404);m.deleted=false;m.read=false;delete m.deletedAt;return save(json({ok:true})); }
    if (p === '/api/pending' && method === 'GET') { const active=db.topics.filter(t=>!t.recycledAt);return json({pendingClaim:active.filter(t=>t.status==='pending').length,review:active.filter(t=>t.status==='review').length,pendingSettle:active.filter(t=>t.status==='finished'&&t.settlementStatus==='unsettled').length,unread:db.messages.filter(m=>m.userId===me.id&&!m.deleted&&!m.read).length}); }
    if (p === '/api/stats/me' && method === 'GET') { const mine=db.topics.filter(t=>t.claimerId===me.id&&!t.recycledAt);return json({claimed:mine.length,inProgress:mine.filter(t=>['in_progress','review'].includes(t.status)).length,finished:mine.filter(t=>t.status==='finished').length,settled:mine.filter(t=>t.settlementStatus==='settled').length,totalAmount:mine.filter(t=>t.settlementStatus==='settled').reduce((s,t)=>s+(t.settlementAmount||0),0),pendingSettle:mine.filter(t=>t.status==='finished'&&t.settlementStatus==='unsettled').length,published:db.topics.filter(t=>t.createdBy===me.id).length,favorites:db.topics.filter(t=>(t.favoritedBy||[]).includes(me.id)).length}); }
    if (p === '/api/stats' && method === 'GET') { if(!admin())return json({error:'无权限'},403);const topics=db.topics.filter(t=>!t.recycledAt), members=db.users.filter(u=>u.role==='member');return json({total:topics.length,pending:topics.filter(t=>t.status==='pending').length,inProgress:topics.filter(t=>t.status==='in_progress').length,review:topics.filter(t=>t.status==='review').length,finished:topics.filter(t=>t.status==='finished').length,settledAmount:topics.filter(t=>t.settlementStatus==='settled').reduce((s,t)=>s+(t.settlementAmount||0),0),unsettledAmount:topics.filter(t=>t.status==='finished'&&t.settlementStatus==='unsettled').reduce((s,t)=>s+(t.settlementAmount||0),0),pendingSettleCount:topics.filter(t=>t.status==='finished'&&t.settlementStatus==='unsettled').length,weeklyCount:db.weeklySettlements.length,perMember:members.map(m=>{const mine=topics.filter(t=>t.claimerId===m.id);return {id:m.id,name:m.displayName,maxClaims:m.maxClaims,claimed:mine.length,finished:mine.filter(t=>t.status==='finished').length,settledAmount:mine.filter(t=>t.settlementStatus==='settled').reduce((s,t)=>s+(t.settlementAmount||0),0)}})}); }
    if (p === '/api/settle/week' && method === 'POST') { if(!admin())return json({error:'无权限'},403);const pending=db.topics.filter(t=>t.status==='finished'&&t.settlementStatus==='unsettled');const rec={id:next('weeklySettlements'),topicIds:pending.map(t=>t.id),count:pending.length,totalAmount:0,createdBy:me.id,createdAt:now()};for(const t of pending){t.settlementAmount=t.settlementAmount??(t.workType==='full'?40:15);t.settlementStatus='settled';t.settledAt=now();rec.totalAmount+=t.settlementAmount;}db.weeklySettlements.push(rec);return save(json({ok:true,count:rec.count,total:rec.totalAmount,record:rec})); }
    if (p === '/api/settle/weekly' && method === 'GET') { if(!admin())return json({error:'无权限'},403);return json(db.weeklySettlements.slice().reverse()); }
    if (p === '/api/export/bills' && method === 'GET') { if(!admin())return json({error:'无权限'},403);let rows=db.topics.filter(t=>t.settlementStatus==='settled');const weeklyId=url.searchParams.get('weeklyId');if(weeklyId){const r=db.weeklySettlements.find(x=>String(x.id)===weeklyId);rows=r?rows.filter(t=>r.topicIds.includes(t.id)):[];}const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const csv=['选题ID,选题标题,类型,认领人,结算金额,结算明细',...rows.map(t=>[t.id,esc(t.title),t.workType,esc(db.users.find(u=>u.id===t.claimerId)?.displayName),t.settlementAmount||0,esc(t.settlementDetail)].join(','))].join('\n');return new Response('\uFEFF'+csv,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="bills.csv"'}}); }
    return json({ error: '接口不存在' }, 404);
  }
}
