/* ===================== 全局状态 ===================== */
const state = { token: null, me: null, tmpRefs: [], tmpMedia: [], currentView: 'board', seriesFilter: null, tfMetric: 'views', tfDays: [], mineTab: 'claim', msgTab: 'inbox' };
const PLATFORMS = ['douyin', 'kuaishou', 'xiaohongshu'];
const PLATFORM_LABELS = { douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书' };
const PLATFORM_COLORS = { douyin: '#fe2c55', kuaishou: '#ff6600', xiaohongshu: '#ff2442' };
// 与后端一致的宽松链接判断：只要像链接即可，不卡提交
function looseUrl(s) {
  if (!s || !s.trim()) return false;
  const v = s.trim();
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (e) { return false; }
}

/* ===================== 工具 ===================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// 全局绑定辅助：此前仅在部分函数内局部定义，导致公告看板等顶层调用抛 ReferenceError
const bind = (s, fn) => { const el = $(s); if (el) el.addEventListener('click', fn); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtTime(ts) { if (!ts) return ''; const d = new Date(ts); return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function fmtMoney(n) { return '¥' + (Number(n || 0).toFixed(2)); }
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(path, { ...opts, headers });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(data.error || ('请求失败 (' + res.status + ')'));
  return data;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), 2400);
}
const STAGES = ['confirm', 'copywriting', 'video', 'done'];
const STAGE_LABELS = { confirm: '确认选题', copywriting: '文案制作', video: '视频制作', done: '完结' };
const SETTLE_OPTIONS = ['基础稿酬', '加急补助', '流量分成', '原创奖励', '其他'];
const PRICE = { copywriting: 15, full: 40 };
const WORKTYPE_LABELS = { copywriting: '仅文案', full: '全流程' };
const STAGES_FULL = ['confirm', 'copywriting', 'video', 'done'];
const STAGES_COPY = ['confirm', 'copywriting', 'done'];
function stageOrder(t) { return (t.workType === 'copywriting') ? STAGES_COPY : STAGES_FULL; }

function stageBar(t) {
  const order = stageOrder(t);
  const idx = order.indexOf(t.stage);
  return `<div class="stages">` + order.map((s, i) => {
    let cls = 'stage';
    if (i < idx) cls += ' done'; else if (i === idx) cls += ' current';
    if (t.status === 'review' && s === t.reviewStage) cls += ' review';
    return `<div class="${cls}">${STAGE_LABELS[s]}</div>`;
  }).join('') + `</div>`;
}
function priceTag(t) { return `<span class="tag price">${t.workTypeLabel} · ¥${t.displayAmount}</span>`; }

/* ===================== 登录 / 注册 ===================== */
$$('.tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  const isLogin = tab.dataset.tab === 'login';
  $('#login-form').classList.toggle('hidden', !isLogin);
  $('#register-form').classList.toggle('hidden', isLogin);
}));
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#login-username').value, password: $('#login-password').value }) });
    state.token = r.token; state.me = r.user; enterApp();
  } catch (err) { toast(err.message); }
});
$('#register-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const r = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: $('#reg-username').value, password: $('#reg-password').value, displayName: $('#reg-display').value }) });
    state.token = r.token; state.me = r.user; enterApp();
  } catch (err) { toast(err.message); }
});

/* ===================== 进入应用 ===================== */
function enterApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#side-name').textContent = state.me.displayName;
  $('#side-role').textContent = state.me.role === 'admin' ? '管理员' : '普通成员';
  $('#side-role').className = 'role-badge ' + state.me.role;
  $('#side-avatar').textContent = state.me.displayName.slice(0, 1);
  buildNav();
  goto('board');
  refreshMsgBadge();
  if (state.me.showTutorial) showTutorial();
}
$('#logout-btn').addEventListener('click', () => {
  state.token = null; state.me = null;
  $('#app').classList.add('hidden'); $('#login-screen').classList.remove('hidden');
});
$('#msg-btn').addEventListener('click', () => goto('messages'));
$('#tutorial-btn').addEventListener('click', showTutorial);

/* ===================== 导航 ===================== */
function buildNav() {
  const groups = [
    { label: '工作台', items: [
      { id: 'board', ico: '📋', txt: '公告看板' },
      { id: 'market', ico: '📝', txt: '选题接单' },
      { id: 'mine', ico: '🗂️', txt: '我的' }
    ]},
    { label: '管理', admin: true, items: [
      { id: 'review', ico: '✅', txt: '审核' },
      { id: 'users', ico: '👥', txt: '成员管理' }
    ]},
    { label: '数据 · 资源', items: [
      { id: 'traffic', ico: '📈', txt: '视频流量' },
      { id: 'stats', ico: '📊', txt: '数据统计' },
      { id: 'recycle', ico: '🗑️', txt: '回收站' }
    ]},
    { label: '消息', items: [
      { id: 'messages', ico: '🔔', txt: '消息提醒' }
    ]}
  ];
  let html = '';
  groups.forEach(g => {
    if (g.admin && state.me.role !== 'admin') return;
    html += `<div class="nav-group"><div class="nav-group-label">${g.label}</div>`;
    html += g.items.map(i => `<div class="nav-item" data-view="${i.id}"><span class="ico">${i.ico}</span><span class="txt">${i.txt}</span><span class="nav-badge hidden" data-badge="${i.id}"></span></div>`).join('');
    html += `</div>`;
  });
  $('#nav').innerHTML = html;
  $$('#nav .nav-item').forEach(el => el.addEventListener('click', () => goto(el.dataset.view)));
}
const TITLES = { board: '公告看板', market: '选题接单', mine: '我的', traffic: '视频流量', recycle: '回收站', review: '审核', messages: '消息提醒', stats: '数据统计', users: '成员管理' };
function goto(view) {
  state.currentView = view;
  $$('#nav .nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#page-title').textContent = TITLES[view] || '';
  $('#view').scrollTop = 0;
  ({ board: viewBoard, market: viewMarket, mine: viewMine, traffic: viewTraffic, recycle: viewRecycle, review: viewReview, messages: viewMessages, stats: viewStats, users: viewUsers }[view] || viewBoard)();
}

/* ===================== 角标（消息 + 待办）===================== */
async function refreshMsgBadge() {
  try {
    const r = await api('/api/pending');
    const set = (id, n) => {
      const el = document.querySelector(`[data-badge="${id}"]`);
      if (!el) return;
      if (n > 0) { el.textContent = n > 99 ? '99+' : n; el.classList.remove('hidden'); }
      else el.classList.add('hidden');
    };
    const b = $('#msg-badge');
    if (b) { if (r.unread > 0) { b.textContent = r.unread; b.classList.remove('hidden'); } else b.classList.add('hidden'); }
    set('messages', r.unread);
    set('market', r.pendingClaim);
    if (state.me.role === 'admin') set('review', r.review + r.pendingSettle);
  } catch (e) {}
}

/* ===================== 通用：卡片列表 + 筛选 ===================== */
function statusTag(t) {
  let cls = t.status;
  return `<span class="tag ${cls}">${t.statusLabel}</span>`;
}
function settleTag(t) {
  if (t.status !== 'finished' && t.settlementStatus === 'unsettled') return '';
  return `<span class="tag ${t.settlementStatus}">${t.settleLabel}</span>`;
}
function cardHTML(t) {
  const seriesTags = (t.series && t.series.length) ? `<div class="series-tags">${t.series.map(s => `<span class="series-tag">#${esc(s)}</span>`).join('')}</div>` : '';
  return `<div class="card" data-id="${t.id}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <h3>${esc(t.title)}</h3>
      <span class="fav">${(t.favoritedBy || []).includes(state.me.id) ? '★' : ''}</span>
    </div>
    ${stageBar(t)}
    <p class="intro">${esc(t.intro) || '（无简介）'}</p>
    ${seriesTags}
    <div class="meta">
      ${statusTag(t)}
      ${priceTag(t)}
      ${settleTag(t)}
      ${t.overdue ? '<span class="tag overdue">⏰ 已超时</span>' : ''}
    </div>
    <div class="row">
      <span class="meta">认领人：<b>${esc(t.claimerName || '—')}</b></span>
      <span class="meta">💬${t.commentCount} · 📎${t.materialCount}</span>
      <span class="meta">📥在库 ${t.daysInLibrary} 天</span>
      <span class="meta">🕒${t.createdAtLabel || ''}</span>
    </div>
  </div>`;
}

/* ===================== 视图：公告看板 ===================== */
async function viewBoard() {
  let board = { notice: '', referenceVideos: [] };
  try { board = await api('/api/board'); } catch (e) {}
  const announce = `
    <div class="board-announce">
      <div class="ba-head">
        <span class="ba-title">📺 参考视频栏</span>
        ${state.me.role === 'admin' ? '<button class="btn sm" id="ba-edit">✎ 编辑公告栏</button>' : ''}
      </div>
      ${board.notice ? `<div class="ba-notice">${esc(board.notice)}</div>` : ''}
      <div class="ba-videos">${board.referenceVideos.length ? board.referenceVideos.map(v => `<a class="ba-video" href="${esc(v.url)}" target="_blank" rel="noopener">▶ ${esc(v.title || v.url)}</a>`).join('') : '<span class="pill">暂无参考视频</span>'}</div>
    </div>`;
  const progress = `
    <div class="prog-wrap">
      <div class="sec-title">👥 用户接单看板 <span class="muted" style="font-weight:400">（各成员当前进度）</span></div>
      <div class="prog-board" id="progress-board"><div class="muted">加载中…</div></div>
    </div>`;
  const filters = `
    <div class="toolbar">
      <input id="f-kw" placeholder="搜索标题/简介" />
      <select id="f-status"><option value="">全部状态</option><option value="pending">待认领</option><option value="in_progress">制作中</option><option value="review">待审核</option><option value="finished">已完结</option></select>
      <select id="f-stage"><option value="">全部阶段</option><option value="confirm">确认选题</option><option value="copywriting">文案制作</option><option value="video">视频制作</option><option value="done">完结</option></select>
      <select id="f-wt"><option value="">全部类型</option><option value="full">全流程</option><option value="copywriting">仅文案</option></select>
      <select id="f-settle"><option value="">全部结款</option><option value="unsettled">待结算</option><option value="settled">已结算</option></select>
      <select id="f-sort"><option value="updated">最近更新</option><option value="library_desc">在库最久</option><option value="library_asc">最新入库</option></select>
      <button class="btn sm" id="f-search">筛选</button>
      <div class="spacer"></div>
      <button class="btn sm" id="f-fav">★ 我的收藏</button>
    </div>`;
  $('#view').innerHTML = announce + progress + `<div class="remind-strip" id="remind-strip"><span class="muted">加载待办…</span></div>` + filters + `<div class="grid" id="board-grid"></div>`;
  const load = async () => {
    const ps = new URLSearchParams();
    if ($('#f-kw').value) ps.set('keyword', $('#f-kw').value);
    if ($('#f-status').value) ps.set('status', $('#f-status').value);
    if ($('#f-stage').value) ps.set('stage', $('#f-stage').value);
    if ($('#f-wt').value) ps.set('workType', $('#f-wt').value);
    if ($('#f-settle').value) ps.set('settlement', $('#f-settle').value);
    if ($('#f-sort').value) ps.set('sort', $('#f-sort').value);
    if ($('#f-fav').classList.contains('active')) ps.set('favorite', '1');
    const list = await api('/api/topics?' + ps.toString());
    const g = $('#board-grid');
    g.innerHTML = list.length ? list.map(cardHTML).join('') : `<div class="empty">暂无选题</div>`;
    $$('#board-grid .card').forEach(c => c.addEventListener('click', () => openDetail(c.dataset.id)));
  };
  const loadProgress = async () => {
    try {
      const all = await api('/api/topics');
      const byUser = {};
      all.forEach(t => {
        if (!t.claimerId) return;
        const u = byUser[t.claimerId] || (byUser[t.claimerId] = { name: t.claimerName, total: 0, byStatus: { pending: 0, in_progress: 0, review: 0, finished: 0 }, inProgress: [] });
        u.total++;
        u.byStatus[t.status] = (u.byStatus[t.status] || 0) + 1;
        if (t.status === 'in_progress' || t.status === 'review') u.inProgress.push(t);
      });
      const arr = Object.values(byUser);
      const box = $('#progress-board');
      if (!box) return;
      if (!arr.length) { box.innerHTML = '<div class="empty">暂无成员接单</div>'; return; }
      box.innerHTML = arr.map(u => `
        <div class="prog-card">
          <div class="prog-head">
            <span class="prog-avatar">${esc((u.name || '?').slice(0, 1))}</span>
            <b>${esc(u.name || '?')}</b>
            <span class="prog-total">接单 ${u.total}</span>
          </div>
          <div class="prog-bars">
            <span class="tag in_progress">制作中 ${u.byStatus.in_progress}</span>
            <span class="tag review">待审 ${u.byStatus.review}</span>
            <span class="tag finished">已完结 ${u.byStatus.finished}</span>
          </div>
          ${u.inProgress.length ? `<div class="prog-ip">${u.inProgress.map(t => `<span class="prog-chip" data-id="${t.id}">${esc(t.title)} · ${t.stageLabel}</span>`).join('')}</div>` : '<div class="muted" style="margin-top:8px">暂无进行中选题</div>'}
        </div>`).join('');
      $$('#progress-board .prog-chip').forEach(c => c.addEventListener('click', () => openDetail(c.dataset.id)));
    } catch (e) {}
  };
  $('#f-search').addEventListener('click', load);
  $('#f-kw').addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
  $('#f-sort').addEventListener('change', load);
  $('#f-fav').addEventListener('click', () => { $('#f-fav').classList.toggle('active'); load(); });
  if (state.me.role === 'admin') bind('#ba-edit', openBoardEdit);
  const renderRemind = async () => {
    try {
      const r = await api('/api/pending');
      const parts = [];
      if (r.pendingClaim) parts.push(`<span class="remind-pill" data-go="market">📝 待认领 <b>${r.pendingClaim}</b></span>`);
      if (state.me.role === 'admin') {
        if (r.review) parts.push(`<span class="remind-pill" data-go="review">✅ 待审核 <b>${r.review}</b></span>`);
        if (r.pendingSettle) parts.push(`<span class="remind-pill warn" data-go="review">💰 待结算 <b>${r.pendingSettle}</b></span>`);
      }
      const strip = $('#remind-strip');
      if (!strip) return;
      if (!parts.length) { strip.innerHTML = `<span class="remind-ok">✅ 当前没有待处理事项</span>`; return; }
      strip.innerHTML = `<span class="remind-label">待办提醒：</span>` + parts.join('');
      $$('#remind-strip .remind-pill').forEach(p => p.addEventListener('click', () => goto(p.dataset.go)));
    } catch (e) {}
  };
  load();
  loadProgress();
  renderRemind();
}

/* ===================== 视图：选题接单 ===================== */
async function viewMarket() {
  $('#view').innerHTML = `
    <div class="toolbar">
      <input id="m-kw" placeholder="搜索选题" />
      <button class="btn sm" id="m-search">搜索</button>
      <select id="m-sort"><option value="updated">最近更新</option><option value="library_desc">在库最久</option><option value="library_asc">最新入库</option></select>
      <div class="spacer"></div>
      <button class="btn primary" id="m-publish">＋ 发布选题</button>
    </div>
    <div id="series-bar" class="series-bar"></div>
    <div class="grid" id="market-grid"></div>`;
  $('#m-publish').addEventListener('click', openCreateTopic);
  const renderSeries = async () => {
    let series = [];
    try { series = await api('/api/series'); } catch (e) {}
    const bar = $('#series-bar');
    if (!series.length) { bar.innerHTML = ''; return; }
    const chips = series.map(s => `<span class="series-chip ${state.seriesFilter === s.name ? 'active' : ''}" data-name="${esc(s.name)}">#${esc(s.name)} <b>${s.count}</b></span>`).join('');
    bar.innerHTML = `<div class="series-chips">${chips}${state.seriesFilter ? '<span class="series-clear" id="series-clear">清除筛选 ✕</span>' : ''}</div>`;
    $$('#series-bar .series-chip').forEach(c => c.addEventListener('click', () => {
      state.seriesFilter = (state.seriesFilter === c.dataset.name) ? null : c.dataset.name;
      load(); renderSeries();
    }));
    const clr = $('#series-clear'); if (clr) clr.addEventListener('click', () => { state.seriesFilter = null; load(); renderSeries(); });
  };
  const load = async () => {
    const ps = new URLSearchParams({ keyword: $('#m-kw').value });
    if (state.seriesFilter) ps.set('series', state.seriesFilter);
    if ($('#m-sort').value) ps.set('sort', $('#m-sort').value);
    const list = await api('/api/topics?' + ps.toString());
    const g = $('#market-grid');
    g.innerHTML = list.length ? list.map(cardHTML).join('') : `<div class="empty">暂无选题，点右上角发布一个吧</div>`;
    $$('#market-grid .card').forEach(c => c.addEventListener('click', e => {
      if (e.target.classList.contains('fav')) return;
      openDetail(c.dataset.id);
    }));
  };
  $('#m-search').addEventListener('click', load);
  $('#m-kw').addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
  $('#m-sort').addEventListener('change', load);
  await renderSeries();
  await load();
}

/* ===================== 视图：我的（合并 工作台/制作交付/我的结算）===================== */
async function viewMine() {
  const tabs = [
    { id: 'claim', txt: '我认领的' },
    { id: 'pub', txt: '我发布的' },
    { id: 'active', txt: '进行中' },
    { id: 'settle', txt: '我的结算' }
  ];
  $('#view').innerHTML = `
    <div class="tabs" id="mine-tabs">${tabs.map(t => `<span class="tab ${state.mineTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.txt}</span>`).join('')}</div>
    <div id="mine-body"></div>`;
  const body = $('#mine-body');
  const render = async () => {
    const tab = state.mineTab;
    if (tab === 'claim') {
      const list = await api('/api/topics?mine=1');
      body.innerHTML = `<h3 style="margin:14px 0 12px">我认领的选题（${list.length}）</h3>` + (list.length ? `<div class="grid">${list.map(cardHTML).join('')}</div>` : `<div class="empty">还没有认领选题，去「选题接单」认领一个吧</div>`);
    } else if (tab === 'pub') {
      const list = await api('/api/topics?author=1');
      body.innerHTML = `<h3 style="margin:14px 0 12px">我发布的选题（${list.length}）</h3>` + (list.length ? `<div class="grid">${list.map(cardHTML).join('')}</div>` : `<div class="empty">还没有发布选题</div>`);
    } else if (tab === 'active') {
      const list = await api('/api/topics?mine=1');
      const active = list.filter(t => t.status === 'in_progress' || t.status === 'review');
      body.innerHTML = `<h3 style="margin:14px 0 12px">进行中（${active.length}）</h3>` + (active.length ? `<div class="grid">${active.map(cardHTML).join('')}</div>` : `<div class="empty">暂无进行中的选题</div>`);
    } else if (tab === 'settle') {
      const list = await api('/api/topics?mine=1');
      const settled = list.filter(t => t.settlementStatus === 'settled');
      const pend = list.filter(t => t.status === 'finished' && t.settlementStatus === 'unsettled');
      body.innerHTML = `<h3 style="margin:14px 0 12px">我的结算（已结算 ${settled.length}${pend.length ? ' · 待结算 ' + pend.length : ''}）</h3>` + (list.length ? `<div class="grid">${list.map(cardHTML).join('')}</div>` : `<div class="empty">暂无结算记录</div>`);
    }
    $$('#mine-body .card').forEach(c => c.addEventListener('click', () => openDetail(c.dataset.id)));
  };
  $$('#mine-tabs .tab').forEach(t => t.addEventListener('click', () => {
    state.mineTab = t.dataset.tab;
    $$('#mine-tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.tab === state.mineTab));
    render();
  }));
  render();
}

/* ===================== 视图：视频流量 ===================== */
function trafficChartSVG(days, metric) {
  const W = 680, H = 240, padL = 46, padR = 14, padT = 22, padB = 34;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  if (!days.length) return `<div class="chart-empty">暂无数据，添加一天后查看三平台对比</div>`;
  const maxV = Math.max(1, ...days.map(d => Math.max(...PLATFORMS.map(p => +((d[p] && d[p][metric]) || 0)))));
  const n = days.length;
  const x = i => n === 1 ? padL + innerW / 2 : padL + innerW * i / (n - 1);
  const y = v => padT + innerH * (1 - v / maxV);
  const lines = PLATFORMS.map(p => {
    const pts = days.map((d, i) => `${x(i)},${y(+((d[p] && d[p][metric]) || 0))}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${PLATFORM_COLORS[p]}" stroke-width="2.5" stroke-linejoin="round"/>` +
      days.map((d, i) => `<circle cx="${x(i)}" cy="${y(+((d[p] && d[p][metric]) || 0))}" r="3" fill="${PLATFORM_COLORS[p]}"/>`).join('');
  }).join('');
  const xlabels = days.map((d, i) => `<text x="${x(i)}" y="${H - 12}" font-size="11" fill="#8a8a8e" text-anchor="middle">${esc(d.date.slice(5))}</text>`).join('');
  const ylabels = [0, maxV / 2, maxV].map(v => `<text x="${padL - 6}" y="${y(v) + 4}" font-size="11" fill="#8a8a8e" text-anchor="end">${Math.round(v)}</text>`).join('') +
    `<line x1="${padL}" y1="${y(0)}" x2="${W - padR}" y2="${y(0)}" stroke="#e6e6ea"/>`;
  const legend = PLATFORMS.map((p, i) => `<rect x="${padL + i * 116}" y="6" width="10" height="10" rx="2" fill="${PLATFORM_COLORS[p]}"/><text x="${padL + i * 116 + 14}" y="15" font-size="11" fill="#555">${PLATFORM_LABELS[p]}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="tf-svg" preserveAspectRatio="xMidYMid meet">${ylabels}${lines}${xlabels}${legend}</svg>`;
}
async function viewTraffic() {
  const list = await api('/api/topics?traffic=1');
  const my = list.filter(t => t.claimerId === state.me.id);
  const others = state.me.role === 'admin' ? list.filter(t => t.claimerId !== state.me.id) : [];
  let html = `<p class="hint" style="margin:0 0 16px">全流程视频审核通过发布后，请在 <b>7 天</b> 内按 <b>抖音 / 快手 / 小红书</b> 三平台填报播放 / 点赞 / 收藏数据（可填多天形成时间线）；逾期未填报会收到提醒。</p>`;
  if (others.length) html += `<h4 style="margin:0 0 10px">团队成员填报（${others.length}）</h4><div class="grid">${others.map(trafficCard).join('')}</div>`;
  html += `<h4 style="margin:18px 0 10px">我的视频（${my.length}）</h4>` +
    (my.length ? `<div class="grid">${my.map(trafficCard).join('')}</div>` : `<div class="empty">暂无需要填报的视频</div>`);
  $('#view').innerHTML = html;
  $$('#view .tcard-fill').forEach(el => el.addEventListener('click', () => openTraffic(+el.dataset.id)));
}
function trafficCard(t) {
  const due = t.trafficDueAt ? fmtTime(t.trafficDueAt) : '';
  const filled = t.trafficFilled;
  const overdue = t.trafficOverdue;
  const canEdit = t.claimerId === state.me.id;
  const tot = t.trafficTotals || {};
  const sumHtml = PLATFORMS.map(p => `<span class="pf-sum"><i style="background:${PLATFORM_COLORS[p]}"></i>${PLATFORM_LABELS[p]} ▶${tot[p] ? tot[p].views : 0}</span>`).join('');
  return `<div class="card tcard ${overdue ? 'overdue-card' : ''}" data-id="${t.id}">
    <h3>${esc(t.title)}</h3>
    <div class="meta">${statusTag(t)} ${priceTag(t)} ${overdue ? '<span class="tag overdue">⏰ 未填报</span>' : (filled ? '<span class="tag finished">已填报</span>' : '<span class="tag review">待填报</span>')}</div>
    ${filled ? `<div class="traffic-data">${sumHtml}</div>` : `<div class="traffic-data muted">${due ? '截止 ' + due : ''}</div>`}
    ${canEdit ? `<button class="btn primary sm tcard-fill" data-id="${t.id}">${filled ? '修改 / 查看' : '填报数据'}</button>` : `<div class="meta">认领人：${esc(t.claimerName)}</div>`}
  </div>`;
}
async function openTraffic(id) {
  const t = await api('/api/topics/' + id);
  state.tfDays = (t.trafficDays || []).map(d => ({ date: d.date, douyin: { ...d.douyin }, kuaishou: { ...d.kuaishou }, xiaohongshu: { ...d.xiaohongshu } }));
  const today = new Date().toISOString().slice(0, 10);
  const renderDays = () => {
    const wrap = $('#tf-days'); if (!wrap) return;
    wrap.innerHTML = state.tfDays.map((d, i) => `<div class="tf-day">
      <div class="tf-day-head"><input type="date" class="tf-date" data-i="${i}" value="${esc(d.date)}"/><button class="btn sm danger tf-del" data-i="${i}">删除</button></div>
      <div class="tf-plats">${PLATFORMS.map(p => `<div class="tf-plat" style="border-color:${PLATFORM_COLORS[p]}">
        <span class="tf-plat-name" style="color:${PLATFORM_COLORS[p]}">${PLATFORM_LABELS[p]}</span>
        <input class="tf-num" placeholder="播放" data-i="${i}" data-p="${p}" data-k="views" value="${(d[p] && d[p].views) || ''}"/>
        <input class="tf-num" placeholder="点赞" data-i="${i}" data-p="${p}" data-k="likes" value="${(d[p] && d[p].likes) || ''}"/>
        <input class="tf-num" placeholder="收藏" data-i="${i}" data-p="${p}" data-k="favorites" value="${(d[p] && d[p].favorites) || ''}"/>
      </div>`).join('')}</div>
    </div>`).join('') || '<div class="muted" style="padding:8px 0">还没有数据，点下方「＋ 添加一天」开始填报</div>';
    $$('#tf-days .tf-date').forEach(inp => inp.addEventListener('input', () => { state.tfDays[+inp.dataset.i].date = inp.value; renderChart(); }));
    $$('#tf-days .tf-num').forEach(inp => inp.addEventListener('input', () => { state.tfDays[+inp.dataset.i][inp.dataset.p][inp.dataset.k] = inp.value; renderChart(); }));
    $$('#tf-days .tf-del').forEach(b => b.addEventListener('click', () => { state.tfDays.splice(+b.dataset.i, 1); renderDays(); renderChart(); renderSummary(); }));
    renderSummary();
  };
  let chartTimer = null;
  const renderChart = () => {
    if (chartTimer) clearTimeout(chartTimer);
    chartTimer = setTimeout(() => { const c = $('#tf-chart'); if (c) c.innerHTML = trafficChartSVG(state.tfDays, state.tfMetric); }, 120);
  };
  const renderSummary = () => {
    const s = $('#tf-summary'); if (!s) return;
    const tot = { douyin: { views: 0, likes: 0, favorites: 0 }, kuaishou: { views: 0, likes: 0, favorites: 0 }, xiaohongshu: { views: 0, likes: 0, favorites: 0 } };
    state.tfDays.forEach(d => PLATFORMS.forEach(p => ['views', 'likes', 'favorites'].forEach(k => tot[p][k] += +((d[p] && d[p][k]) || 0))));
    s.innerHTML = PLATFORMS.map(p => `<div class="pf-card" style="border-color:${PLATFORM_COLORS[p]}">
      <div class="pf-name" style="color:${PLATFORM_COLORS[p]}">${PLATFORM_LABELS[p]}</div>
      <div class="pf-row">▶ ${tot[p].views}</div><div class="pf-row">👍 ${tot[p].likes}</div><div class="pf-row">⭐ ${tot[p].favorites}</div>
    </div>`).join('');
  };
  openModal(`<h2>填报视频流量</h2>
    <p class="hint" style="margin:0 0 12px">选题《${esc(t.title)}》· 7 天内按三平台填报（截止 ${t.trafficDueAt ? fmtTime(t.trafficDueAt) : '—'}）</p>
    <div class="metric-toggle">
      <button class="mt-btn ${state.tfMetric === 'views' ? 'active' : ''}" data-m="views">播放量</button>
      <button class="mt-btn ${state.tfMetric === 'likes' ? 'active' : ''}" data-m="likes">点赞数</button>
      <button class="mt-btn ${state.tfMetric === 'favorites' ? 'active' : ''}" data-m="favorites">收藏数</button>
    </div>
    <div id="tf-chart" class="tf-chart"></div>
    <div id="tf-summary" class="tf-summary"></div>
    <h4 style="margin:14px 0 8px">每日数据（可添加多天形成时间线）</h4>
    <div id="tf-days" class="tf-days"></div>
    <button class="btn sm" id="tf-add" style="margin:8px 0 4px">＋ 添加一天</button>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="tf-save">保存填报</button></div>`);
  $$('.metric-toggle .mt-btn').forEach(b => b.addEventListener('click', () => {
    state.tfMetric = b.dataset.m;
    $$('.metric-toggle .mt-btn').forEach(x => x.classList.toggle('active', x.dataset.m === state.tfMetric));
    renderChart();
  }));
  $('#tf-add').addEventListener('click', () => {
    const last = state.tfDays[state.tfDays.length - 1];
    state.tfDays.push({ date: today, douyin: { views: '', likes: '', favorites: '' }, kuaishou: { views: '', likes: '', favorites: '' }, xiaohongshu: { views: '', likes: '', favorites: '' } });
    renderDays(); renderChart();
  });
  $('#tf-save').addEventListener('click', async () => {
    const days = state.tfDays.map(d => ({ date: d.date, douyin: d.douyin, kuaishou: d.kuaishou, xiaohongshu: d.xiaohongshu }));
    if (!days.length || !days[0].date) { toast('请至少添加一天并填写日期'); return; }
    try {
      await api('/api/topics/' + id + '/traffic', { method: 'POST', body: JSON.stringify({ days }) });
      closeModal(); toast('已保存'); viewTraffic();
    } catch (e) { toast(e.message); }
  });
  renderDays(); renderChart();
}

/* ===================== 弹窗：公告栏编辑（管理员） ===================== */
async function openBoardEdit() {
  const b = await api('/api/board');
  let videos = (b.referenceVideos || []).map(v => ({ title: v.title, url: v.url }));
  const renderVideos = () => {
    $('#ba-vlist').innerHTML = videos.length ? videos.map((v, i) => `<div class="repeat"><input class="ba-title-in" data-i="${i}" placeholder="标题" value="${esc(v.title)}"/><input class="ba-url-in" data-i="${i}" placeholder="视频链接 https://" value="${esc(v.url)}"/><button class="btn sm danger" data-i="${i}">删</button></div>`).join('') : '<span class="pill">暂无</span>';
    $$('#ba-vlist .ba-title-in').forEach(inp => inp.addEventListener('input', () => { videos[+inp.dataset.i].title = inp.value; }));
    $$('#ba-vlist .ba-url-in').forEach(inp => inp.addEventListener('input', () => { videos[+inp.dataset.i].url = inp.value; }));
    $$('#ba-vlist .btn.danger').forEach(btn => btn.addEventListener('click', () => { videos.splice(+btn.dataset.i, 1); renderVideos(); }));
  };
  openModal(`<h2>编辑公告栏</h2>
    <div class="field"><label>公告文字（选填）</label><textarea id="ba-notice" placeholder="例如：本周重点选题方向…">${esc(b.notice || '')}</textarea></div>
    <div class="field"><label>参考视频栏（仅管理员可改）</label><div id="ba-vlist"></div>
      <button class="btn sm" id="ba-add">＋ 添加视频</button></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="ba-save">保存</button></div>`);
  renderVideos();
  $('#ba-add').addEventListener('click', () => { videos.push({ title: '', url: '' }); renderVideos(); });
  $('#ba-save').addEventListener('click', async () => {
    try {
      await api('/api/board', { method: 'PUT', body: JSON.stringify({ notice: $('#ba-notice').value, referenceVideos: videos }) });
      closeModal(); toast('公告栏已更新'); viewBoard();
    } catch (e) { toast(e.message); }
  });
}

/* ===================== 视图：结款结算（已合并到 审核 页）===================== */
function exportBills() {
  window.open('/api/export/bills', '_blank');
  toast('账单导出已开始');
}
window.exportWeek = (id) => { window.open('/api/export/bills?weeklyId=' + id, '_blank'); toast('周账单导出已开始'); };

/* ===================== 视图：消息提醒（含回收站标签）===================== */
const MSG_ICONS = { claim: '🙋', progress: '📈', submit: '📨', review: '✅', reject: '↩️', settle: '💰', comment: '💬', overdue: '⏰', abandon: '🚫', system: '🔔' };
async function viewMessages() {
  const tabs = [{ id: 'inbox', txt: '收件箱' }, { id: 'recycle', txt: '回收站' }];
  $('#view').innerHTML = `
    <div class="tabs" id="msg-tabs">${tabs.map(t => `<span class="tab ${state.msgTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.txt}</span>`).join('')}</div>
    <div id="msg-body"></div>`;
  const render = async () => {
    if (state.msgTab === 'inbox') {
      const list = await api('/api/messages');
      $('#msg-body').innerHTML = `
        <div class="toolbar"><h3 style="margin:0">站内消息（${list.length}）</h3><div class="spacer"></div><button class="btn sm" id="read-all">全部标为已读</button></div>
        <p class="hint" style="margin:0 0 12px">已读消息将在 <b>1 小时</b> 后自动删除（可在「回收站」标签 7 天内找回）；也可点右侧 🗑️ 手动删除。</p>
        <div id="msg-list">${list.length ? list.map(m => `
          <div class="msg-item ${m.read ? '' : 'unread'}" data-id="${m.id}">
            <div class="mtype">${MSG_ICONS[m.type] || '🔔'}</div>
            <div class="mbody">${esc(m.content)}<div class="mwhen">${fmtTime(m.createdAt)}</div></div>
            <button class="msg-del" data-id="${m.id}" title="删除">🗑️</button>
          </div>`).join('') : '<div class="empty">暂无消息</div>'}</div>`;
      $('#read-all').addEventListener('click', async () => { await api('/api/messages/read', { method: 'POST', body: JSON.stringify({}) }); render(); refreshMsgBadge(); });
      $$('#msg-list .msg-del').forEach(b => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('删除该消息？（7 天内可在回收站找回）')) return;
        try { await api('/api/messages/' + b.dataset.id, { method: 'DELETE' }); toast('已删除'); render(); refreshMsgBadge(); } catch (err) { toast(err.message); }
      }));
      $$('#msg-list .msg-item').forEach(el => el.addEventListener('click', async () => {
        const m = list.find(x => x.id == el.dataset.id);
        await api('/api/messages/read', { method: 'POST', body: JSON.stringify({ id: +el.dataset.id }) });
        refreshMsgBadge();
        if (m && m.target && m.target.view === 'review' && state.me.role === 'admin') { goto('review'); return; }
        if (m && m.topicId) { openDetail(m.topicId); return; }
        render();
      }));
    } else {
      const list = await api('/api/messages/recycle');
      $('#msg-body').innerHTML = `
        <p class="hint" style="margin:0 0 12px">已删除的消息会在这里保留 <b>7 天</b>，可手动恢复；超时后永久清除。</p>
        <div id="msg-list">${list.length ? list.map(m => `
          <div class="msg-item recycled-msg" data-id="${m.id}">
            <div class="mtype">${MSG_ICONS[m.type] || '🔔'}</div>
            <div class="mbody">${esc(m.content)}<div class="mwhen">删除于 ${fmtTime(m.deletedAt)}</div></div>
            <button class="msg-restore" data-id="${m.id}" title="恢复">↩️</button>
          </div>`).join('') : '<div class="empty">回收站暂无消息</div>'}</div>`;
      $$('#msg-list .msg-restore').forEach(b => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await api('/api/messages/recycle/' + b.dataset.id, { method: 'POST' }); toast('已恢复'); render(); refreshMsgBadge(); } catch (err) { toast(err.message); }
      }));
    }
  };
  $$('#msg-tabs .tab').forEach(t => t.addEventListener('click', () => {
    state.msgTab = t.dataset.tab;
    $$('#msg-tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.tab === state.msgTab));
    render();
  }));
  render();
}

/* ===================== 视图：管理员审核（统一审核 + 结算入口） ===================== */
function reviewCard(t) {
  const stageName = t.reviewStage === 'video' ? '视频' : '文案';
  return `<div class="card" data-id="${t.id}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <h3>${esc(t.title)}</h3>
      <span class="tag review">${stageName}待审</span>
    </div>
    ${stageBar(t)}
    <p class="intro">${esc(t.intro) || '（无简介）'}</p>
    <div class="meta">${statusTag(t)}${priceTag(t)}</div>
    <div class="row"><span class="meta">发布者：${esc(t.authorName)}</span><span class="meta">认领人：${esc(t.claimerName || '—')}</span></div>
    <div class="actions">
      <button class="btn primary sm rc-open" data-id="${t.id}">审核（看文案/视频）</button>
    </div>
  </div>`;
}
async function viewReview() {
  let list = [];
  try { list = await api('/api/topics?status=review'); } catch (e) {}
  const reviewHtml = `
    <div class="sub-head"><h3 style="margin:0">待审核（${list.length}）</h3><span class="muted">在「审核」弹窗中可直观查看文案与视频，通过即完结；驳回需填写修改备注</span></div>
    <div class="grid" id="review-grid">${list.length ? list.map(reviewCard).join('') : `<div class="empty">暂无待审核选题 🎉</div>`}</div>`;
  const bindReviewGrid = () => {
    $$('#review-grid .rc-open').forEach(b => b.addEventListener('click', () => openReviewModal(+b.dataset.id)));
    $$('#review-grid .card').forEach(c => c.addEventListener('click', e => { if (e.target.closest('.rc-open')) return; openReviewModal(+c.dataset.id); }));
  };
  if (state.me.role !== 'admin') { $('#view').innerHTML = reviewHtml; bindReviewGrid(); return; }
  // 管理员：审核 + 结算 合并到此页
  let finished = [], settled = [], weekly = [];
  try {
    finished = await api('/api/topics?status=finished');
    settled = await api('/api/topics?settlement=settled');
    weekly = await api('/api/settle/weekly');
  } catch (e) {}
  const pendingSettle = finished.filter(t => t.settlementStatus === 'unsettled');
  const pendingTotal = pendingSettle.reduce((s, t) => s + (t.displayAmount || 0), 0);
  $('#view').innerHTML = reviewHtml + `
    <div class="sub-head" style="margin-top:28px"><h3 style="margin:0">结算管理</h3>
      <button class="btn primary sm" id="week-settle">🗓️ 周结算（${pendingSettle.length} 笔 · ¥${pendingTotal}）</button>
      <button class="btn sm" id="export-bills">⬇ 导出全部 CSV</button>
    </div>
    <h4 style="margin:16px 0 10px">待结算（${pendingSettle.length}）</h4>
    <div class="grid" id="settle-pending">${pendingSettle.length ? pendingSettle.map(cardHTML).join('') : `<div class="empty">暂无待结算</div>`}</div>
    <h4 style="margin:22px 0 10px">已结算（${settled.length}）</h4>
    <div class="grid" id="settle-done">${settled.length ? settled.map(cardHTML).join('') : `<div class="empty">暂无已结算</div>`}</div>
    <h4 style="margin:22px 0 10px">周结算记录（${weekly.length}）</h4>
    <div id="weekly-list">${weekly.length ? weekly.map(w => `
      <div class="msg-item"><div class="mtype">🗓️</div><div class="mbody">当周（${new Date(w.weekStart).getMonth() + 1}/${new Date(w.weekStart).getDate()} 起）· 共 <b>${w.count}</b> 笔 · 合计 <b>¥${w.totalAmount}</b> · 操作人 ${esc(w.createdByName)}<div class="mwhen">${fmtTime(w.createdAt)}</div></div>
      <button class="btn sm" onclick="exportWeek(${w.id})">导出周账单</button></div>`).join('') : '<div class="empty">暂无周结算记录</div>'}</div>`;
  bindReviewGrid();
  $$('#settle-pending .card, #settle-done .card').forEach(c => c.addEventListener('click', () => openSettle(+c.dataset.id)));
  $('#export-bills').addEventListener('click', exportBills);
  $('#week-settle').addEventListener('click', async () => {
    if (!confirm(`将把所有「已完结·待结算」选题一次性结算（按类型自动核算金额：仅文案 ¥15 / 全流程 ¥40），确定？`)) return;
    try { const r = await api('/api/settle/week', { method: 'POST' }); toast(`周结算完成：${r.count} 笔，合计 ¥${r.total}`); refreshMsgBadge(); goto('review'); } catch (e) { toast(e.message); }
  });
}
async function openReviewModal(id) {
  const t = await api('/api/topics/' + id);
  const stageName = t.reviewStage === 'video' ? '视频' : '文案';
  const rejects = (t.rejectedNotes || []).map((n, i) => `<div class="reject-note">↩️ 第 ${i + 1} 次驳回（${fmtTime(n.at)}）：${esc(n.note)}</div>`).join('');
  openModal(`<h2>审核 · ${esc(t.title)}</h2>
    <div class="meta" style="margin-bottom:8px">${statusTag(t)} ${priceTag(t)} <span class="tag review">${stageName}待审</span></div>
    ${stageBar(t)}
    <div class="detail-section"><h4>📝 文案内容</h4><div class="copy-box">${esc(t.copyText || '（未填写文案）')}</div></div>
    <div class="detail-section"><h4>🎬 提交视频</h4>${videoBlock(t)}</div>
    ${rejects ? `<div class="detail-section">${rejects}</div>` : ''}
    <div class="modal-actions">
      <button class="btn danger" id="rv-reject">驳回返修</button>
      <button class="btn primary" id="rv-approve">通过审核</button>
    </div>`);
  $('#rv-approve').addEventListener('click', async () => {
    if (!confirm('确认通过审核？')) return;
    try { await api('/api/topics/' + id + '/review', { method: 'POST', body: JSON.stringify({ action: 'approve' }) }); closeModal(); toast('已通过审核'); refreshMsgBadge(); viewReview(); } catch (e) { toast(e.message); }
  });
  $('#rv-reject').addEventListener('click', async () => {
    const note = prompt('请填写驳回修改备注：'); if (note == null) return;
    try { await api('/api/topics/' + id + '/review', { method: 'POST', body: JSON.stringify({ action: 'reject', note }) }); closeModal(); toast('已驳回'); refreshMsgBadge(); viewReview(); } catch (e) { toast(e.message); }
  });
}

/* ===================== 视图：数据统计 ===================== */
async function viewStats() {
  const me = await api('/api/stats/me');
  let html = `<h3 style="margin:0 0 14px">我的数据</h3>
    <div class="stat-cards">
      ${statCard(me.claimed, '认领选题')}${statCard(me.inProgress, '进行中')}${statCard(me.finished, '已完结')}
      ${statCard(me.pendingSettle, '待结算')}${statCard(me.settled, '已结算')}${statCard(fmtMoney(me.totalAmount), '累计稿酬')}${statCard(me.published, '我发布的')}${statCard(me.favorites, '我的收藏')}
    </div>`;
  if (state.me.role === 'admin') {
    const s = await api('/api/stats');
    html += `<h3 style="margin:24px 0 14px">团队总览</h3>
      <div class="stat-cards">
        ${statCard(s.total, '选题总数')}${statCard(s.pending, '待认领')}${statCard(s.inProgress, '制作中')}
        ${statCard(s.review, '待审核')}${statCard(s.finished, '已完结')}${statCard(s.pendingSettleCount, '待结算数')}${statCard(fmtMoney(s.settledAmount), '已结算总额')}${statCard(fmtMoney(s.unsettledAmount), '待结算总额')}${statCard(s.weeklyCount, '周结算次数')}
      </div>
      <h4 style="margin:18px 0 10px">成员接单完工榜</h4>
      <table><thead><tr><th>成员</th><th>接单上限</th><th>认领数</th><th>完结数</th><th>已结算稿酬</th></tr></thead><tbody>
      ${s.perMember.map(m => `<tr><td>${esc(m.name)}</td><td>${m.maxClaims}</td><td>${m.claimed}</td><td>${m.finished}</td><td>${fmtMoney(m.settledAmount)}</td></tr>`).join('')}
      </tbody></table>`;
  }
  $('#view').innerHTML = html;
}
function statCard(num, lbl) { return `<div class="stat-card"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`; }

/* ===================== 视图：回收站 ===================== */
function recycleCard(t) {
  const reasonTxt = t.recycledReason === 'delete' ? '删除' : '废弃';
  const days = t.recycleDaysLeft;
  return `<div class="card recycle-card" data-id="${t.id}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <h3>${esc(t.title)}</h3>
      <span class="tag recycled">🗑️ 回收站</span>
    </div>
    <div class="meta">
      <span class="tag">${reasonTxt}于 ${fmtTime(t.recycledAt)}</span>
      <span class="tag ${days <= 5 ? 'overdue' : 'review'}">${days} 天后清除</span>
    </div>
    <p class="intro">${esc(t.intro) || '（无简介）'}</p>
    <div class="row"><span class="meta">发布者：<b>${esc(t.authorName || '—')}</b></span></div>
    <div class="recycle-actions">
      <button class="btn primary sm" data-act="restore" data-id="${t.id}">恢复选题</button>
      ${state.me.role === 'admin' ? `<button class="btn danger sm" data-act="purge" data-id="${t.id}">永久删除</button>` : ''}
    </div>
  </div>`;
}
async function viewRecycle() {
  const list = await api('/api/topics?recycled=1');
  $('#view').innerHTML = `
    <div class="toolbar">
      <h3 style="margin:0">回收站</h3>
      <div class="spacer"></div>
      <span class="pill">废弃 / 删除的选题在此保留 30 天，逾期自动永久删除</span>
    </div>
    ${list.length ? `<div class="grid" id="recycle-grid">${list.map(recycleCard).join('')}</div>` : `<div class="empty">回收站为空</div>`}`;
  $$('#recycle-grid .recycle-card').forEach(c => {
    const id = c.dataset.id;
    c.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (btn) {
        if (btn.dataset.act === 'restore') restoreTopic(id);
        else if (btn.dataset.act === 'purge') purgeTopic(id);
        return;
      }
      openDetail(id);
    });
  });
}
async function restoreTopic(id) {
  if (!confirm('确定恢复该选题？将回到原状态并移出回收站。')) return;
  try { await api('/api/topics/' + id + '/restore', { method: 'POST' }); toast('已恢复'); viewRecycle(); } catch (e) { toast(e.message); }
}
async function purgeTopic(id) {
  if (!confirm('永久删除后无法恢复，确定？')) return;
  try { await api('/api/topics/' + id + '/purge', { method: 'DELETE' }); toast('已永久删除'); viewRecycle(); } catch (e) { toast(e.message); }
}

/* ===================== 视图：成员管理（管理员） ===================== */
async function viewUsers() {
  const users = await api('/api/users');
  $('#view').innerHTML = `
    <div class="toolbar"><h3 style="margin:0">成员管理</h3><div class="spacer"></div><button class="btn primary sm" id="add-user">＋ 新建成员</button></div>
    <table><thead><tr><th>昵称</th><th>用户名</th><th>角色</th><th>接单上限</th><th>操作</th></tr></thead><tbody>
    ${users.map(u => `<tr><td>${esc(u.displayName)}</td><td>${esc(u.username)}</td><td>${u.role === 'admin' ? '管理员' : '成员'}</td>
      <td>${u.maxClaims}</td><td>${u.role === 'member' ? `<button class="btn sm" onclick="editMax(${u.id},${u.maxClaims})">改上限</button>` : '—'}</td></tr>`).join('')}
    </tbody></table>`;
  $('#add-user').addEventListener('click', openAddUser);
}
window.editMax = async (id, cur) => {
  const v = prompt('设置该成员接单上限（同时进行的选题数）：', cur);
  if (v == null) return;
  try { await api('/api/users/' + id, { method: 'PUT', body: JSON.stringify({ maxClaims: v }) }); toast('已更新'); viewUsers(); } catch (e) { toast(e.message); }
};
function openAddUser() {
  openModal(`<h2>新建成员</h2>
    <div class="field"><label>用户名</label><input id="nu-u" /></div>
    <div class="field"><label>昵称</label><input id="nu-n" /></div>
    <div class="field"><label>密码</label><input id="nu-p" type="password" /></div>
    <div class="field"><label>接单上限</label><input id="nu-m" type="number" value="10" /></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="nu-save">创建</button></div>`);
  $('#nu-save').addEventListener('click', async () => {
    try {
      await api('/api/users', { method: 'POST', body: JSON.stringify({ username: $('#nu-u').value, displayName: $('#nu-n').value, password: $('#nu-p').value, maxClaims: $('#nu-m').value }) });
      closeModal(); toast('成员已创建'); viewUsers();
    } catch (e) { toast(e.message); }
  });
}

/* ===================== 弹窗：新人使用教程 ===================== */
function showTutorial() {
  const steps = [
    { t: '欢迎使用协作工作台', d: '这是选题进度跟踪与作品验收结算的一体化后台。左栏是导航，按角色展示不同功能。随时点右上角 📘 可重看本教程。' },
    { t: '1 · 认领选题', d: '在「选题接单」浏览待认领选题，点击卡片可认领。认领时选择「全流程（文案+视频）」或「仅文案」，单价不同：全流程 ¥40 / 仅文案 ¥15。' },
    { t: '2 · 制作与提交', d: '认领后进入「制作交付」。按阶段推进：文案制作 → 提交文案审核 →（全流程）视频制作 → 提交视频审核。管理员审核通过即完结。' },
    { t: '3 · 视频流量填报', d: '全流程选题的视频审核通过发布后，请在「视频流量」页 7 天内填报播放量 / 点赞 / 收藏，逾期会有提醒。' },
    { t: '4 · 结算与证据', d: '管理员在「结款结算」录入金额并确认结款，可上传结算凭证图片作为证据留存，也支持周结算与账单导出。' },
    { t: '5 · 公告栏参考视频', d: '「公告看板」顶部有参考视频栏（管理员维护）与公告，供大家参考学习。' }
  ];
  let i = 0;
  const render = () => {
    $('#modal-box').innerHTML = `
      <div class="tut">
        <div class="tut-head"><h2>${esc(steps[i].t)}</h2><span class="pill">${i + 1} / ${steps.length}</span></div>
        <p class="tut-body">${esc(steps[i].d)}</p>
        <div class="tut-dots">${steps.map((s, k) => `<span class="dot ${k === i ? 'on' : ''}"></span>`).join('')}</div>
        <div class="tut-actions">
          <button class="btn" id="tut-prev" ${i === 0 ? 'disabled' : ''}>上一步</button>
          ${i < steps.length - 1 ? `<button class="btn primary" id="tut-next">下一步</button>` : `<button class="btn primary" id="tut-done">开始使用</button>`}
        </div>
      </div>`;
    openModalRaw();
    const bind = (s, fn) => { const el = $(s); if (el) el.addEventListener('click', fn); };
    bind('#tut-prev', () => { i--; render(); });
    bind('#tut-next', () => { i++; render(); });
    bind('#tut-done', async () => {
      closeModal();
      try { await api('/api/me/tutorial', { method: 'POST' }); state.me.showTutorial = false; } catch (e) {}
    });
  };
  render();
}

/* ===================== 弹窗：发布选题 ===================== */
function openCreateTopic() {
  state.tmpRefs = []; state.tmpMedia = [];
  let linkForced = false;
  openModal(`<h2>发布选题</h2>
    <div id="ct-linkwarn" class="linkwarn" style="display:none"></div>
    <div class="field"><label>选题标题 *</label><input id="ct-title" /></div>
    <div class="field"><label>选题简介</label><textarea id="ct-intro"></textarea></div>
    <div class="field"><label>话题系列（用 # 分隔，如 #综艺 #泛生活）</label><input id="ct-series" placeholder="#综艺 #泛生活" /></div>
    <div class="field"><label>参考链接（每行一个，自动校验）</label>
      <textarea id="ct-refs" placeholder="https://..."></textarea></div>
    <div class="field"><label>文案内容</label><textarea id="ct-copy" placeholder="可直接粘贴文案"></textarea></div>
    <div class="field"><label>图片 / 视频外链</label>
      <div id="ct-media-list"></div>
      <div class="repeat"><select id="ct-mt"><option value="image">图片</option><option value="video">视频</option></select>
      <input id="ct-mu" placeholder="外链 URL" /><button class="btn sm" id="ct-madd">添加</button></div>
    </div>
    <div class="field"><label>接单类型（接单者可在认领时确认/修改）</label>
      <select id="ct-wt"><option value="">由接单者选择</option><option value="full">全流程（文案+视频）¥40</option><option value="copywriting">仅文案 ¥15</option></select>
    </div>
    <div class="field"><label>交付截止时间（可选）</label><input id="ct-deadline" type="datetime-local" /></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="ct-save">发布</button></div>`);
  const renderMedia = () => {
    $('#ct-media-list').innerHTML = state.tmpMedia.map((m, i) => `<div class="mat-item"><span>${m.type === 'image' ? '🖼️' : '🎬'} ${esc(m.url)}</span><button class="btn sm danger" data-i="${i}">删</button></div>`).join('');
    $$('#ct-media-list .btn').forEach(b => b.addEventListener('click', () => { state.tmpMedia.splice(+b.dataset.i, 1); renderMedia(); }));
  };
  $('#ct-madd').addEventListener('click', () => {
    const url = $('#ct-mu').value.trim();
    if (!url) return;
    state.tmpMedia.push({ type: $('#ct-mt').value, url });
    $('#ct-mu').value = ''; renderMedia();
  });
  renderMedia();
  $('#ct-save').addEventListener('click', async () => {
    const refs = $('#ct-refs').value.split('\n').map(s => s.trim()).filter(Boolean);
    const invalid = [...refs.filter(r => !looseUrl(r)), ...state.tmpMedia.filter(m => !looseUrl(m.url)).map(m => m.url)];
    if (invalid.length && !linkForced) {
      linkForced = true;
      const w = $('#ct-linkwarn');
      w.style.display = 'block';
      w.innerHTML = `⚠️ 以下链接格式可能有误，已照常提交（链接不阻止发布）：<br/>${invalid.map(esc).join('<br/>')}`;
      toast('部分链接格式可能有误，已标红；确认无误可再次点击发布');
      return;
    }
    const deadline = $('#ct-deadline').value ? $('#ct-deadline').value.replace('T', ' ') : '';
    try {
      await api('/api/topics', { method: 'POST', body: JSON.stringify({ title: $('#ct-title').value, intro: $('#ct-intro').value, referenceLinks: refs, copyText: $('#ct-copy').value, mediaLinks: state.tmpMedia, deadline, workType: $('#ct-wt').value, series: $('#ct-series').value }) });
      closeModal(); toast('选题已发布'); state.seriesFilter = null; goto('market');
    } catch (e) { toast(e.message); }
  });
}

/* ===================== 弹窗：修改选题 ===================== */
async function openEditTopic(t) {
  state.tmpRefs = []; state.tmpMedia = (t.mediaLinks || []).map(m => ({ ...m }));
  const deadlineVal = t.deadline ? t.deadline.replace(' ', 'T') : '';
  let linkForced = false;
  openModal(`<h2>修改选题</h2>
    <div id="ct-linkwarn" class="linkwarn" style="display:none"></div>
    <div class="field"><label>选题标题 *</label><input id="ct-title" /></div>
    <div class="field"><label>选题简介</label><textarea id="ct-intro"></textarea></div>
    <div class="field"><label>话题系列（用 # 分隔，如 #综艺 #泛生活）</label><input id="ct-series" placeholder="#综艺 #泛生活" /></div>
    <div class="field"><label>参考链接（每行一个，自动校验）</label>
      <textarea id="ct-refs" placeholder="https://..."></textarea></div>
    <div class="field"><label>文案内容</label><textarea id="ct-copy" placeholder="可直接粘贴文案"></textarea></div>
    <div class="field"><label>图片 / 视频外链</label>
      <div id="ct-media-list"></div>
      <div class="repeat"><select id="ct-mt"><option value="image">图片</option><option value="video">视频</option></select>
      <input id="ct-mu" placeholder="外链 URL" /><button class="btn sm" id="ct-madd">添加</button></div>
    </div>
    <div class="field"><label>接单类型（接单者可在认领时确认/修改）</label>
      <select id="ct-wt"><option value="">由接单者选择</option><option value="full">全流程（文案+视频）¥40</option><option value="copywriting">仅文案 ¥15</option></select>
    </div>
    <div class="field"><label>交付截止时间（可选）</label><input id="ct-deadline" type="datetime-local" /></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="ct-save">保存修改</button></div>`);
  // 通过 JS 赋值，避免标题/简介含引号破坏 HTML 属性
  $('#ct-title').value = t.title || '';
  $('#ct-intro').value = t.intro || '';
  $('#ct-series').value = (t.series || []).join(' ');
  $('#ct-refs').value = (t.referenceLinks || []).join('\n');
  $('#ct-copy').value = t.copyText || '';
  $('#ct-wt').value = t.workType || '';
  $('#ct-deadline').value = deadlineVal;
  const renderMedia = () => {
    $('#ct-media-list').innerHTML = state.tmpMedia.map((m, i) => `<div class="mat-item"><span>${m.type === 'image' ? '🖼️' : '🎬'} ${esc(m.url)}</span><button class="btn sm danger" data-i="${i}">删</button></div>`).join('');
    $$('#ct-media-list .btn').forEach(b => b.addEventListener('click', () => { state.tmpMedia.splice(+b.dataset.i, 1); renderMedia(); }));
  };
  $('#ct-madd').addEventListener('click', () => {
    const url = $('#ct-mu').value.trim();
    if (!url) return;
    state.tmpMedia.push({ type: $('#ct-mt').value, url });
    $('#ct-mu').value = ''; renderMedia();
  });
  renderMedia();
  $('#ct-save').addEventListener('click', async () => {
    const refs = $('#ct-refs').value.split('\n').map(s => s.trim()).filter(Boolean);
    const invalid = [...refs.filter(r => !looseUrl(r)), ...state.tmpMedia.filter(m => !looseUrl(m.url)).map(m => m.url)];
    if (invalid.length && !linkForced) {
      linkForced = true;
      const w = $('#ct-linkwarn');
      w.style.display = 'block';
      w.innerHTML = `⚠️ 以下链接格式可能有误，已照常保存（链接不阻止修改）：<br/>${invalid.map(esc).join('<br/>')}`;
      toast('部分链接格式可能有误，已标红；确认无误可再次点击保存');
      return;
    }
    const deadline = $('#ct-deadline').value ? $('#ct-deadline').value.replace('T', ' ') : '';
    try {
      await api('/api/topics/' + t.id, { method: 'PUT', body: JSON.stringify({ title: $('#ct-title').value, intro: $('#ct-intro').value, referenceLinks: refs, copyText: $('#ct-copy').value, mediaLinks: state.tmpMedia, deadline, workType: $('#ct-wt').value, series: $('#ct-series').value }) });
      closeModal(); toast('选题已修改'); openDetail(t.id);
    } catch (e) { toast(e.message); }
  });
}

/* ===================== 弹窗：选题详情 ===================== */
async function openDetail(id) {
  const d = await api('/api/topics/' + id);
  const t = d;
  const isClaimer = t.claimerId === state.me.id;
  const isAdmin = state.me.role === 'admin';
  const isAuthor = t.createdBy === state.me.id;

  const links = (t.referenceLinks || []).map(r => `<a href="${esc(r)}" target="_blank" rel="noopener">${esc(r)}</a>`).join('') || '<span class="pill">无</span>';
  const media = (t.mediaLinks || []).map(m => `<a href="${esc(m.url)}" target="_blank" rel="noopener">${m.type === 'image' ? '🖼️ 图片' : '🎬 视频'} ${esc(m.url)}</a>`).join('<br/>') || '<span class="pill">无</span>';
  const rejects = (t.rejectedNotes || []).map(n => `<div class="reject-note">↩️ 驳回备注（${fmtTime(n.at)}）：${esc(n.note)}</div>`).join('');

  // 操作按钮区
  let actions = '';
  if (t.recycled) {
    // 回收站态：仅展示恢复 / 永久删除
    actions += `<span class="tag recycled">已进入回收站（${t.recycledReason === 'delete' ? '删除' : '废弃'}）· 还剩 ${t.recycleDaysLeft} 天自动清除</span>`;
    if (isAdmin || isAuthor) actions += `<button class="btn primary" id="ac-restore">恢复选题</button>`;
    if (isAdmin) actions += `<button class="btn danger" id="ac-purge">永久删除</button>`;
  } else {
    if (t.status === 'pending' && !isAuthor && !isAdmin) actions += `<button class="btn primary" id="ac-claim">认领选题</button>`;
    if (t.status === 'pending' && isAdmin) actions += `<button class="btn primary" id="ac-claim">代成员认领</button>`;
    if (isClaimer && t.status === 'in_progress') {
      if (t.stage === 'confirm') actions += `<button class="btn" id="ac-stage">开始制作（进入文案）</button>`;
      if (t.stage === 'copywriting') {
        actions += `<button class="btn primary" id="ac-submit-copy">提交文案审核</button>`;
        actions += `<button class="btn" id="ac-material">留存素材</button>`;
        actions += `<button class="btn" id="ac-deadline">设置截止时间</button>`;
        actions += `<button class="btn danger" id="ac-abandon">申请弃单</button>`;
      }
      if (t.stage === 'video') {
        actions += `<button class="btn primary" id="ac-submit-video">提交视频审核</button>`;
        actions += `<button class="btn" id="ac-material">留存素材</button>`;
        actions += `<button class="btn" id="ac-deadline">设置截止时间</button>`;
        actions += `<button class="btn danger" id="ac-abandon">申请弃单</button>`;
      }
    }
    if (isClaimer && t.status === 'review') actions += `<span class="pill">${t.reviewStage === 'video' ? '视频' : '文案'}已提交，等待管理员审核</span>`;
    if (isAdmin && t.status === 'review') {
      const stageName = t.reviewStage === 'video' ? '视频' : '文案';
      actions += `<span class="pill">${stageName}待管理员审核（请到「审核」页处理）</span>`;
    }
    if (isAdmin && t.status === 'finished' && t.settlementStatus === 'unsettled') actions += `<button class="btn" id="ac-settle">录入金额并结款</button>`;
    if (t.abandonRequested && (isAdmin || isAuthor)) actions += `<button class="btn" id="ac-abandon-ok">审批弃单（通过）</button>`;
    // 废弃 / 删除（进入回收站）
    const canDiscard = isAdmin || isAuthor || isClaimer;
    const canDelete = isAdmin || isAuthor;
    if (isAdmin || (isAuthor && t.status !== 'finished')) actions += `<button class="btn" id="ac-edit">✎ 修改选题</button>`;
    if (canDiscard) actions += `<button class="btn" id="ac-discard">废弃选题</button>`;
    if (canDelete) actions += `<button class="btn danger" id="ac-remove">删除选题</button>`;
    actions += `<button class="btn" id="ac-fav">${(t.favoritedBy || []).includes(state.me.id) ? '★ 取消收藏' : '☆ 收藏'}</button>`;
  }

  $('#modal-box').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <h2>${esc(t.title)}</h2>
      <button class="btn ghost" onclick="closeModal()">✕</button>
    </div>
    <div class="meta" style="margin-bottom:10px">${statusTag(t)} ${priceTag(t)} ${settleTag(t)} ${t.overdue ? '<span class="tag overdue">⏰ 已超时</span>' : ''} ${t.recycled ? '<span class="tag recycled">🗑️ 回收站</span>' : ''} ${t.deadline ? `<span class="pill">截止：${esc(t.deadline)}</span>` : ''} ${t.createdAtLabel ? `<span class="pill">🕒 ${esc(t.createdAtLabel)}</span>` : ''}</div>
    ${stageBar(t)}
    ${rejects}
    <p style="color:var(--ink-2)">${esc(t.intro) || '（无简介）'}</p>
    ${t.series && t.series.length ? `<div class="detail-section"><h4>话题系列</h4><div class="series-tags">${t.series.map(s => `<span class="series-tag">#${esc(s)}</span>`).join('')}</div></div>` : ''}
    <div class="detail-section">
      <div style="display:flex;gap:18px;flex-wrap:wrap">
        <div><b>发布者：</b>${esc(t.authorName)}</div><div><b>认领人：</b>${esc(t.claimerName || '—')}</div>
        <div><b>状态：</b>${t.statusLabel}</div><div><b>类型：</b>${t.workTypeLabel}</div><div><b>结款：</b>${t.settleLabel}${t.displayAmount ? ' ' + fmtMoney(t.displayAmount) : ''}</div>
        ${t.settlementDetail ? `<div><b>结算明细：</b>${esc(t.settlementDetail)}</div>` : ''}
      </div>
    </div>
    <div class="detail-section"><h4>参考链接</h4><div class="link-list">${links}</div></div>
    <div class="detail-section"><h4>图片 / 视频外链</h4><div class="link-list">${media}</div></div>
    ${t.copyText ? `<div class="detail-section"><h4>文案内容</h4><div style="white-space:pre-wrap;font-size:13px;background:#f7f8fa;padding:12px;border-radius:8px">${esc(t.copyText)}</div></div>` : ''}
    ${t.videoType || (t.mediaLinks || []).some(m => m.type === 'video') ? `<div class="detail-section"><h4>提交视频</h4>${videoBlock(t)}</div>` : ''}
    ${t.settlementEvidence && t.settlementEvidence.length ? `<div class="detail-section"><h4>结算凭证（证据 · ${t.settlementEvidence.length}）</h4><div class="ev-grid">${t.settlementEvidence.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" class="ev-img" /></a>`).join('')}</div></div>` : ''}
    <div class="detail-section"><h4>素材版本（${t.materials.length}）</h4>
      ${t.materials.length ? t.materials.map(m => `<div class="mat-item"><span>v${m.version} · ${esc(m.url)} ${m.note ? '（' + esc(m.note) + '）' : ''}</span><span class="mwhen">${esc(m.userName)} ${fmtTime(m.createdAt)}</span></div>`).join('') : '<span class="pill">暂无</span>'}
    </div>
    <div class="detail-section"><h4>操作记录</h4>
      ${t.logs.length ? t.logs.slice().reverse().map(l => `<div class="log-item">${fmtTime(l.createdAt)} · ${esc(l.userName)} · ${esc(l.action)}${l.detail ? ' — ' + esc(l.detail) : ''}</div>`).join('') : '<span class="pill">暂无</span>'}
    </div>
    <div class="detail-section"><h4>评论沟通区（${t.comments.length}）</h4>
      <div id="comment-list">${t.comments.map(c => `<div class="comment"><span class="who">${esc(c.userName)}</span><span class="when">${fmtTime(c.createdAt)}</span><div style="margin-top:4px">${esc(c.content)}</div></div>`).join('') || '<span class="pill">暂无评论</span>'}</div>
      <div class="repeat" style="margin-top:10px"><input id="cm-input" placeholder="输入评论…" /><button class="btn primary sm" id="cm-send">发送</button></div>
    </div>
    <div class="modal-actions" style="flex-wrap:wrap;justify-content:flex-start;gap:8px;margin-top:18px">${actions}</div>`;
  openModalRaw();

  // 绑定事件
  const bind = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
  bind('#ac-claim', () => openClaim(id, t.workType));
  bind('#ac-edit', () => openEditTopic(t));
  bind('#ac-stage', async () => { await act('/api/topics/' + id + '/stage', {}, '已开始制作（进入文案）'); });
  bind('#ac-submit-copy', () => openSubmitCopy(id, t));
  bind('#ac-submit-video', () => openSubmitVideo(id, t));
  bind('#ac-abandon', async () => { if (confirm('确认申请放弃该选题？需发布者/管理员审批')) await act('/api/topics/' + id + '/abandon', {}, '已提交弃单申请'); });
  bind('#ac-abandon-ok', async () => { if (confirm('通过弃单申请？选题将重新进入待认领')) await act('/api/topics/' + id + '/abandon/approve', {}, '弃单已通过'); });
  bind('#ac-discard', () => openDiscardModal(id, 'discard'));
  bind('#ac-remove', () => openDiscardModal(id, 'remove'));
  bind('#ac-restore', async () => {
    if (!confirm('恢复该选题？将回到原状态并移出回收站。')) return;
    try { await api('/api/topics/' + id + '/restore', { method: 'POST' }); closeModal(); goto(state.currentView); refreshMsgBadge(); toast('已恢复'); } catch (e) { toast(e.message); }
  });
  bind('#ac-purge', async () => {
    if (!confirm('永久删除后无法恢复，确定？')) return;
    try { await api('/api/topics/' + id + '/purge', { method: 'DELETE' }); closeModal(); goto(state.currentView); toast('已永久删除'); } catch (e) { toast(e.message); }
  });
  bind('#ac-fav', async () => { const r = await api('/api/topics/' + id + '/favorite', { method: 'POST' }); toast(r.favorited ? '已收藏' : '已取消收藏'); openDetail(id); });
  bind('#ac-deadline', () => {
    const v = prompt('设置交付截止时间（格式：2026-08-01 18:00，留空清除）：', t.deadline || '');
    if (v !== null) api('/api/topics/' + id + '/deadline', { method: 'POST', body: JSON.stringify({ deadline: v.trim() }) }).then(() => { toast('已更新'); openDetail(id); }).catch(e => toast(e.message));
  });
  bind('#ac-material', () => {
    const url = prompt('素材外链 URL：'); if (!url) return;
    const note = prompt('素材备注（可选）：') || '';
    api('/api/topics/' + id + '/material', { method: 'POST', body: JSON.stringify({ url, note }) }).then(() => { toast('素材已留存'); openDetail(id); }).catch(e => toast(e.message));
  });
  bind('#ac-settle', () => openSettle(id));
  $('#cm-send').addEventListener('click', async () => {
    const val = $('#cm-input').value.trim(); if (!val) return;
    await api('/api/topics/' + id + '/comment', { method: 'POST', body: JSON.stringify({ content: val }) });
    openDetail(id);
  });
  $('#cm-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('#cm-send').click(); });
}

/* ===================== 弹窗：提交文案（文案窗口，可复制/编辑） ===================== */
function openSubmitCopy(id, t) {
  openModal(`<h2>提交文案审核</h2>
    <p style="color:var(--ink-2);margin-top:0">请确认 / 补全文案内容，提交后由管理员审核：</p>
    <div class="field"><label>文案内容（可复制 / 编辑）</label><textarea id="sc-copy" style="min-height:220px;font-size:13px">${esc(t.copyText || '')}</textarea></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="sc-ok">提交审核</button></div>`);
  $('#sc-ok').addEventListener('click', async () => {
    try { await api('/api/topics/' + id + '/submit/copy', { method: 'POST', body: JSON.stringify({ copyText: $('#sc-copy').value }) }); closeModal(); toast('已提交文案审核'); openDetail(id); refreshMsgBadge(); } catch (e) { toast(e.message); }
  });
}

/* ===================== 弹窗：提交视频审核（导入链接 / 上传线下视频文件） ===================== */
function openSubmitVideo(id, t) {
  openModal(`<h2>提交视频审核</h2>
    <p style="color:var(--ink-2);margin-top:0">提交方式：</p>
    <div class="seg">
      <label class="seg-item"><input type="radio" name="sv-mode" value="import" checked /> 导入视频链接（走审核）</label>
      <label class="seg-item"><input type="radio" name="sv-mode" value="offline" /> 上传线下视频文件（已确认过审，直接完结）</label>
    </div>
    <div id="sv-import-wrap" class="field"><label>视频链接（必填）</label><input id="sv-link" placeholder="https:// 或 v.douyin.com/xxx" value="${esc(t.videoLink && t.videoType === 'import' ? t.videoLink : '')}" /></div>
    <div id="sv-offline-wrap" class="field" style="display:none">
      <label>选取线下视频文件（上传后直接完结）</label>
      <input type="file" id="sv-file" accept="video/*" />
      <div id="sv-file-preview" style="margin-top:10px"></div>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="sv-ok">提交</button></div>`);
  const mode = () => document.querySelector('input[name="sv-mode"]:checked').value;
  const updateMode = () => {
    const m = mode();
    $('#sv-import-wrap').style.display = m === 'import' ? '' : 'none';
    $('#sv-offline-wrap').style.display = m === 'offline' ? '' : 'none';
  };
  $$('input[name=sv-mode]').forEach(r => r.addEventListener('change', updateMode));
  let uploadedUrl = '';
  $('#sv-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    const btn = $('#sv-ok'); btn.disabled = true; $('#sv-file-preview').innerHTML = '<span class="pill">上传中…</span>';
    try {
      const r = await fetch('/api/upload/video', { method: 'POST', headers: { Authorization: 'Bearer ' + state.token }, body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '上传失败');
      uploadedUrl = d.url;
      $('#sv-file-preview').innerHTML = `<video src="${esc(d.url)}" controls style="width:100%;border-radius:10px;max-height:240px;background:#000"></video><div class="pill" style="margin-top:6px">已上传：${esc(f.name)}</div>`;
      toast('视频已上传');
    } catch (err) { $('#sv-file-preview').innerHTML = ''; toast(err.message); }
    btn.disabled = false;
  });
  $('#sv-ok').addEventListener('click', async () => {
    const m = mode();
    const submit = async (payload) => {
      try {
        await api('/api/topics/' + id + '/submit/video', { method: 'POST', body: JSON.stringify(payload) });
        closeModal(); toast(payload.submitMode === 'offline' ? '已线下过审并完结' : '已提交视频审核'); openDetail(id); refreshMsgBadge();
      } catch (e) { toast(e.message); }
    };
    if (m === 'import') {
      const videoLink = $('#sv-link').value.trim();
      if (!videoLink) { toast('请填写视频链接'); return; }
      await submit({ submitMode: 'import', videoLink });
    } else {
      if (!uploadedUrl) { toast('请先选取并上传线下视频文件'); return; }
      await submit({ submitMode: 'offline', videoLink: uploadedUrl });
    }
  });
}

/* 展示已提交视频：线下文件直接播放，导入链接给出跳转 */
function videoBlock(t) {
  if (t.videoType === 'offline' && t.videoLink) {
    return `<video src="${esc(t.videoLink)}" controls style="width:100%;border-radius:12px;max-height:360px;background:#000"></video>`;
  }
  if (t.videoType === 'import' && t.videoLink) {
    return `<a href="${esc(t.videoLink)}" target="_blank" rel="noopener" class="video-link">▶ 打开视频链接（${esc(t.videoLink)}）</a>`;
  }
  const mv = (t.mediaLinks || []).filter(m => m.type === 'video');
  if (mv.length) return mv.map(m => `<a href="${esc(m.url)}" target="_blank" rel="noopener" class="video-link">🎬 视频外链：${esc(m.url)}</a>`).join('<br/>');
  return '<span class="pill">暂无提交视频</span>';
}

/* ===================== 弹窗：废弃 / 删除（选择回收站保留天数） ===================== */
function openDiscardModal(id, op) {
  const txt = op === 'discard' ? '废弃' : '删除';
  openModal(`<h2>${txt}选题</h2>
    <p style="color:var(--ink-2);margin-top:0">该选题将进入回收站，过期后自动永久清除。请选择保留天数：</p>
    <div class="field"><label>回收站保留天数</label>
      <select id="dd-days">
        <option value="7">7 天</option>
        <option value="14">14 天</option>
        <option value="28">28 天</option>
        <option value="30" selected>30 天（默认）</option>
        <option value="custom">自定义…</option>
      </select>
    </div>
    <div class="field" id="dd-custom-wrap" style="display:none"><label>自定义天数（1-365）</label><input id="dd-custom" type="number" min="1" max="365" placeholder="如 21" /></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">取消</button><button class="btn danger" id="dd-ok">确认${txt}</button></div>`);
  $('#dd-days').addEventListener('change', () => { $('#dd-custom-wrap').style.display = $('#dd-days').value === 'custom' ? '' : 'none'; });
  $('#dd-ok').addEventListener('click', async () => {
    let days = parseInt($('#dd-days').value, 10);
    if ($('#dd-days').value === 'custom') days = parseInt($('#dd-custom').value, 10) || 0;
    if (!(days >= 1 && days <= 365)) { toast('请填写 1-365 之间的天数'); return; }
    try { await api('/api/topics/' + id + '/' + op, { method: 'POST', body: JSON.stringify({ days }) }); closeModal(); goto(state.currentView); refreshMsgBadge(); toast(`已${txt}，进入回收站`); } catch (e) { toast(e.message); }
  });
}

async function act(url, body, msg) {
  try { await api(url, { method: 'POST', body: JSON.stringify(body) }); toast(msg); closeModal(); openDetail(url.match(/\d+/)[0]); refreshMsgBadge(); } catch (e) { toast(e.message); }
}

/* ===================== 弹窗：认领（选择接单类型） ===================== */
function openClaim(id, preset) {
  openModal(`<h2>选择接单类型</h2>
    <p style="color:var(--ink-2);margin-top:0">请选择你承接该选题的方式：</p>
    <div class="field"><label>接单类型</label>
      <select id="cl-wt">
        <option value="full" ${preset === 'full' ? 'selected' : ''}>全流程（文案+视频）· 单价 ¥40</option>
        <option value="copywriting" ${preset === 'copywriting' ? 'selected' : ''}>仅文案 · 单价 ¥15</option>
      </select>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="cl-ok">确认认领</button></div>`);
  $('#cl-ok').addEventListener('click', async () => {
    const wt = $('#cl-wt').value;
    if (!wt) return toast('请选择接单类型');
    try {
      await api('/api/topics/' + id + '/claim', { method: 'POST', body: JSON.stringify({ workType: wt }) });
      closeModal(); toast('已认领'); openDetail(id); refreshMsgBadge();
    } catch (e) { toast(e.message); }
  });
}

/* ===================== 弹窗：结算 ===================== */
async function openSettle(id) {
  const t = await api('/api/topics/' + id);
  let evidence = (t.settlementEvidence || []).slice();
  const renderEv = () => {
    $('#st-ev').innerHTML = evidence.length ? evidence.map((u, i) => `<div class="ev-item"><img src="${esc(u)}" /><button class="btn sm danger" data-i="${i}">✕</button></div>`).join('') : '<span class="pill">暂无凭证</span>';
    $$('#st-ev .btn.danger').forEach(b => b.addEventListener('click', () => { evidence.splice(+b.dataset.i, 1); renderEv(); }));
  };
  openModal(`<h2>录入结算</h2>
    <div class="field"><label>结算金额（元）</label><input id="st-amt" type="number" min="0" step="0.01" value="${t.displayAmount || ''}" /></div>
    <div class="field"><label>结算明细（单选）</label>
      <div id="st-opts">${SETTLE_OPTIONS.map((o, i) => `<label style="display:block;margin:6px 0"><input type="radio" name="st" value="${o}" ${i === 0 ? 'checked' : ''}/> ${o}</label>`).join('')}</div>
    </div>
    <div class="field"><label>结算凭证图片（证据保留）</label>
      <input type="file" id="st-file" accept="image/*" multiple />
      <div class="ev-grid" id="st-ev"></div>
    </div>
    <div class="modal-actions"><button class="btn" id="st-save">仅保存</button><button class="btn primary" id="st-pay">确认结款</button></div>`);
  renderEv();
  $('#st-file').addEventListener('change', async e => {
    const files = [...e.target.files];
    for (const f of files) {
      try {
        const data = await readFileAsDataURL(f);
        const r = await api('/api/upload', { method: 'POST', body: JSON.stringify({ name: f.name, data }) });
        evidence.push(r.url); renderEv();
      } catch (err) { toast(err.message); }
    }
    e.target.value = '';
  });
  const getDetail = () => ($('input[name=st]:checked') || {}).value || SETTLE_OPTIONS[0];
  const submit = async (action) => {
    try {
      await api('/api/topics/' + id + '/settle', { method: 'POST', body: JSON.stringify({ amount: $('#st-amt').value, detail: getDetail(), action, evidence }) });
      closeModal(); toast(action === 'pay' ? '已确认结款' : '已保存结算信息'); if (state.me.role === 'admin') goto('review'); else goto('mine'); refreshMsgBadge();
    } catch (e) { toast(e.message); }
  };
  $('#st-save').addEventListener('click', () => submit('save'));
  $('#st-pay').addEventListener('click', () => submit('pay'));
}
function readFileAsDataURL(file) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
}

/* ===================== 弹窗基础 ===================== */
function openModal(html) { $('#modal-box').innerHTML = html; openModalRaw(); }
function openModalRaw() { $('#modal').classList.remove('hidden'); }
window.closeModal = () => $('#modal').classList.add('hidden');
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

/* ===================== 启动 ===================== */
(async function init() {
  // 尝试用本地已存 token 自动登录（此处不持久化 token，每次需登录）
  $('#login-username').focus();
})();
