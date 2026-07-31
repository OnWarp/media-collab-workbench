// API 层：封装所有 /api 请求，与 worker.js 端点一一对应
import type {
  User,
  Board,
  Topic,
  TopicDetail,
  Comment,
  Material,
  Message,
  Pending,
  StatsMe,
  StatsAdmin,
  SeriesItem,
  WeeklySettlement,
  WorkType,
  TopicStatus,
  SettleStatus,
  TopicStage,
} from './types';

// ---------- 本地存储（登录态） ----------
const TOKEN_KEY = 'mcw_token';
const ME_KEY = 'mcw_me';

export const getStoredToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setStoredToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
};
export const getStoredMe = (): User | null => {
  try {
    const s = localStorage.getItem(ME_KEY);
    return s ? (JSON.parse(s) as User) : null;
  } catch {
    return null;
  }
};
export const setStoredMe = (u: User | null) => {
  try {
    if (u) localStorage.setItem(ME_KEY, JSON.stringify(u));
    else localStorage.removeItem(ME_KEY);
  } catch {
    /* ignore */
  }
};

// ---------- 错误类型 ----------
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

// ---------- 底层请求 ----------
async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {};
  const isForm = opts.body instanceof FormData;
  if (!isForm && opts.body != null) headers['content-type'] = 'application/json';
  if (token) headers['authorization'] = 'Bearer ' + token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const merged: RequestInit = {
    ...opts,
    headers: { ...headers, ...(opts.headers as Record<string, string> | undefined) },
    signal: controller.signal,
  };
  try {
    const res = await fetch('/api' + path, merged);
    const ct = res.headers.get('content-type') || '';
    let data: any = null;
    if (ct.includes('application/json')) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      const msg = data && data.error ? String(data.error) : '请求失败（' + res.status + '）';
      throw new ApiError(msg, res.status);
    }
    return data as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError('请求超时，请稍后重试', 408);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 查询参数 ----------
export interface TopicQuery {
  recycled?: boolean;
  status?: TopicStatus;
  stage?: TopicStage;
  workType?: WorkType;
  settlement?: SettleStatus;
  traffic?: boolean;
  mine?: boolean;
  author?: boolean;
  keyword?: string;
  series?: string;
  favorite?: boolean;
  sort?: string;
}

function qs(q: TopicQuery): string {
  const p = new URLSearchParams();
  if (q.recycled) p.set('recycled', '1');
  if (q.status) p.set('status', q.status);
  if (q.stage) p.set('stage', q.stage);
  if (q.workType) p.set('workType', q.workType);
  if (q.settlement) p.set('settlement', q.settlement);
  if (q.traffic) p.set('traffic', '1');
  if (q.mine) p.set('mine', '1');
  if (q.author) p.set('author', '1');
  if (q.keyword) p.set('keyword', q.keyword);
  if (q.series) p.set('series', q.series);
  if (q.favorite) p.set('favorite', '1');
  if (q.sort) p.set('sort', q.sort);
  const s = p.toString();
  return s ? '?' + s : '';
}

// ---------- 认证 ----------
export const authApi = {
  login: async (username: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setStoredToken(r.token);
    setStoredMe(r.user);
    return r;
  },
  register: async (username: string, password: string, displayName: string) => {
    const r = await api<{ token: string; user: User }>('/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName }),
    });
    setStoredToken(r.token);
    setStoredMe(r.user);
    return r;
  },
  logout: async () => {
    try {
      await api('/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setStoredToken(null);
    setStoredMe(null);
  },
  me: async () => {
    const u = await api<User>('/me');
    setStoredMe(u);
    return u;
  },
  tutorialDone: () => api<{ ok: true }>('/me/tutorial', { method: 'POST' }),
};

// ---------- 公告栏 ----------
export const boardApi = {
  get: () => api<Board>('/board'),
  update: (notice: string, referenceVideos: { title: string; url: string }[]) =>
    api<Board>('/board', {
      method: 'PUT',
      body: JSON.stringify({ notice, referenceVideos }),
    }),
};

// ---------- 选题 ----------
export const topicApi = {
  list: (q: TopicQuery = {}) => api<Topic[]>('/topics' + qs(q)),
  create: (body: Record<string, unknown> & { title: string }) =>
    api<Topic>('/topics', { method: 'POST', body: JSON.stringify(body) }),
  get: (id: number) => api<TopicDetail>('/topics/' + id),
  update: (id: number, body: Record<string, unknown>) =>
    api<Topic>('/topics/' + id, { method: 'PUT', body: JSON.stringify(body) }),
  claim: (id: number, workType: WorkType) =>
    api<Topic>('/topics/' + id + '/claim', {
      method: 'POST',
      body: JSON.stringify({ workType }),
    }),
  stage: (id: number) =>
    api<Topic>('/topics/' + id + '/stage', { method: 'POST' }),
  favorite: (id: number) =>
    api<{ favorited: boolean }>('/topics/' + id + '/favorite', { method: 'POST' }),
  abandonApprove: (id: number) =>
    api<Topic>('/topics/' + id + '/abandon/approve', { method: 'POST' }),
  material: (id: number, url: string, note?: string) =>
    api<Material>('/topics/' + id + '/material', {
      method: 'POST',
      body: JSON.stringify({ url, note: note || '' }),
    }),
  deadline: (id: number, deadline: string) =>
    api<Topic>('/topics/' + id + '/deadline', {
      method: 'POST',
      body: JSON.stringify({ deadline }),
    }),
  abandon: (id: number) =>
    api<Topic>('/topics/' + id + '/abandon', { method: 'POST' }),
  comment: (id: number, content: string) =>
    api<Comment>('/topics/' + id + '/comment', {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  review: (id: number, action: 'approve' | 'reject', note?: string) =>
    api<Topic>('/topics/' + id + '/review', {
      method: 'POST',
      body: JSON.stringify({ action, note }),
    }),
  settle: (
    id: number,
    body: { amount: number; detail: string; action: 'pay' | 'save'; evidence: string[] }
  ) => api<Topic>('/topics/' + id + '/settle', { method: 'POST', body: JSON.stringify(body) }),
  traffic: (id: number, days: unknown[]) =>
    api<Topic>('/topics/' + id + '/traffic', {
      method: 'POST',
      body: JSON.stringify({ days }),
    }),
  submitCopy: (id: number, copyText: string) =>
    api<Topic>('/topics/' + id + '/submit/copy', {
      method: 'POST',
      body: JSON.stringify({ copyText }),
    }),
  submitVideo: (id: number, body: { submitMode?: string; videoLink: string }) =>
    api<Topic>('/topics/' + id + '/submit/video', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  discard: (id: number, days: number) =>
    api<Topic>('/topics/' + id + '/discard', {
      method: 'POST',
      body: JSON.stringify({ days }),
    }),
  remove: (id: number, days: number) =>
    api<Topic>('/topics/' + id + '/remove', {
      method: 'POST',
      body: JSON.stringify({ days }),
    }),
  restore: (id: number) =>
    api<Topic>('/topics/' + id + '/restore', { method: 'POST' }),
  purge: (id: number) =>
    api<{ ok: true }>('/topics/' + id + '/purge', { method: 'DELETE' }),
};

// ---------- 成员管理 ----------
export const userApi = {
  list: () => api<User[]>('/users'),
  create: (u: { username: string; displayName?: string; password: string; maxClaims?: number }) =>
    api<User>('/users', { method: 'POST', body: JSON.stringify(u) }),
  update: (
    id: number,
    body: { displayName?: string; maxClaims?: number; password?: string }
  ) => api<User>('/users/' + id, { method: 'PUT', body: JSON.stringify(body) }),
};

// ---------- 系列 ----------
export const seriesApi = {
  list: () => api<SeriesItem[]>('/series'),
};

// ---------- 消息 ----------
export const messageApi = {
  list: () => api<Message[]>('/messages'),
  recycle: () => api<Message[]>('/messages/recycle'),
  read: (id?: number) =>
    api<{ ok: true }>(
      '/messages/read',
      { method: 'POST', body: JSON.stringify(id != null ? { id } : {}) }
    ),
  remove: (id: number) => api<{ ok: true }>('/messages/' + id, { method: 'DELETE' }),
  restore: (id: number) =>
    api<{ ok: true }>('/messages/recycle/' + id, { method: 'POST' }),
};

// ---------- 结算 ----------
export const settleApi = {
  weekly: () => api<WeeklySettlement[]>('/settle/weekly'),
  week: () =>
    api<{ ok: boolean; count: number; total: number }>('/settle/week', {
      method: 'POST',
    }),
};

// ---------- 统计 ----------
export const statsApi = {
  me: () => api<StatsMe>('/stats/me'),
  admin: () => api<StatsAdmin>('/stats'),
};

// ---------- 待办 ----------
export const pendingApi = {
  get: () => api<Pending>('/pending'),
};

// ---------- 上传 ----------
export const uploadApi = {
  image: (dataUrl: string, _name?: string) =>
    api<{ url: string }>('/upload', {
      method: 'POST',
      body: JSON.stringify({ data: dataUrl }),
    }),
  video: (form: FormData) =>
    api<{ url: string }>('/upload/video', { method: 'POST', body: form }),
};

// ---------- 账单导出 ----------
export async function exportBills(weeklyId?: number) {
  const token = getStoredToken();
  const url =
    '/api/export/bills' +
    (weeklyId ? '?weeklyId=' + encodeURIComponent(String(weeklyId)) : '');
  const headers: Record<string, string> = {};
  if (token) headers['authorization'] = 'Bearer ' + token;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new ApiError('导出失败', res.status);
  const blob = await res.blob();
  const a = document.createElement('a');
  const href = URL.createObjectURL(blob);
  a.href = href;
  a.download = 'bills.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

// ---------- 常量 / 工具 ----------
export const PLATFORMS = ['douyin', 'kuaishou', 'xiaohongshu'] as const;
export const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音',
  kuaishou: '快手',
  xiaohongshu: '小红书',
};
export const PLATFORM_COLORS: Record<string, string> = {
  douyin: '#fe2c55',
  kuaishou: '#ff6600',
  xiaohongshu: '#ff2442',
};
export const STAGE_LABELS: Record<string, string> = {
  confirm: '确认选题',
  copywriting: '文案制作',
  video: '视频制作',
  done: '完结',
};
export const STAGES_FULL = ['confirm', 'copywriting', 'video', 'done'];
export const STAGES_COPY = ['confirm', 'copywriting', 'done'];
export const SETTLE_OPTIONS = ['基础稿酬', '加急补助', '流量分成', '原创奖励', '其他'];
export const WORKTYPE_LABELS: Record<string, string> = {
  full: '全流程',
  copywriting: '仅文案',
};
export const PRICE: Record<string, number> = { full: 40, copywriting: 15 };

export const looseUrl = (s: string): boolean => {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

export const stageOrder = (t: Topic): string[] =>
  t.workType === 'copywriting' ? STAGES_COPY : STAGES_FULL;

export function fmtTime(ts?: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtMoney(n?: number | string | null): string {
  return '¥' + Number(n || 0).toFixed(2);
}
