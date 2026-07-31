// 全局类型定义：与 worker.js 返回的视图对象一一对应

// ---------- 基础联合类型 ----------
export type WorkType = 'full' | 'copywriting';
export type TopicStatus = 'pending' | 'in_progress' | 'review' | 'finished';
export type TopicStage = 'confirm' | 'copywriting' | 'video' | 'done';
export type SettleStatus = 'unsettled' | 'settled';
export type MessageType =
  | 'claim'
  | 'progress'
  | 'submit'
  | 'review'
  | 'reject'
  | 'settle'
  | 'comment'
  | 'overdue'
  | 'abandon'
  | 'system'
  | 'info';

// ---------- 用户 ----------
export interface User {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  maxClaims: number;
  showTutorial: boolean;
  createdAt: number;
}

// ---------- 公告栏 ----------
export interface RefVideo {
  title: string;
  url: string;
}
export interface Board {
  notice: string;
  referenceVideos: RefVideo[];
}

// ---------- 多媒体 / 流量 ----------
export interface MediaLink {
  type: 'image' | 'video';
  url: string;
}

export interface TrafficNums {
  views?: number | string;
  likes?: number | string;
  favorites?: number | string;
}

export interface TrafficDayInput {
  date: string;
  douyin: TrafficNums;
  kuaishou: TrafficNums;
  xiaohongshu: TrafficNums;
}

export interface TrafficTotal {
  views: number;
  likes: number;
  favorites: number;
}

// ---------- 选题 ----------
export interface RejectedNote {
  note: string;
  at: number;
  by: number;
}

export interface Topic {
  id: number;
  title: string;
  intro: string;
  referenceLinks: string[];
  mediaLinks: MediaLink[];
  copyText: string;
  workType: WorkType | null;
  series: string[];
  deadline: string | null;
  status: TopicStatus;
  stage: TopicStage;
  createdBy: number;
  claimerId: number | null;
  createdAt: number;
  updatedAt: number;
  settlementStatus: SettleStatus;
  settlementAmount: number;
  settlementDetail: string;
  settledAt: number | null;
  settlementEvidence: string[];
  recycledAt: number | null;
  recycledReason: string | null;
  recycleDays: number;
  videoLink: string | null;
  videoType: 'import' | 'offline' | null;
  reviewStage: 'copywriting' | 'video' | null;
  trafficDueAt: number | null;
  abandonRequested: boolean;
  rejectedNotes: RejectedNote[];
  favoritedBy: number[];
  // ---- 后端计算字段（前端直接展示） ----
  statusLabel: string;
  stageLabel: string;
  workTypeLabel: string;
  settleLabel: string;
  authorName: string;
  claimerName: string;
  displayAmount: number;
  recycled: boolean;
  recycleDaysLeft: number | null;
  daysInLibrary: number;
  createdAtLabel: string;
  overdue: boolean;
  commentCount: number;
  materialCount: number;
  trafficDays: TrafficDayInput[];
  trafficTotals: Record<string, TrafficTotal>;
  trafficFilled: boolean;
  trafficOverdue: boolean;
}

// ---------- 评论 / 素材 / 日志 ----------
export interface Comment {
  id: number;
  topicId: number;
  userId: number;
  userName: string;
  content: string;
  createdAt: number;
}

export interface Material {
  id: number;
  topicId: number;
  userId: number;
  url: string;
  note: string;
  version: number;
  userName: string;
  createdAt: number;
}

export interface LogItem {
  id: number;
  topicId: number;
  userId: number | null;
  userName: string;
  action: string;
  detail: string;
  createdAt: number;
}

export interface TopicDetail extends Topic {
  comments: Comment[];
  materials: Material[];
  logs: LogItem[];
}

// ---------- 消息 ----------
export interface Message {
  id: number;
  userId: number;
  topicId: number | null;
  content: string;
  type: MessageType;
  read: boolean;
  readAt: number | null;
  createdAt: number;
  deleted: boolean;
  deletedAt: number | null;
  target: { view: string } | null;
}

// ---------- 待办 ----------
export interface Pending {
  pendingClaim: number;
  review: number;
  pendingSettle: number;
  unread: number;
}

// ---------- 看板进度 ----------
export interface UserProgress {
  name: string;
  total: number;
  byStatus: Record<TopicStatus, number>;
  inProgress: Topic[];
}

// ---------- 选题表单 ----------
export interface CreateTopicBody {
  title: string;
  intro?: string;
  series?: string[];
  referenceLinks?: string[];
  copyText?: string;
  mediaLinks?: MediaLink[];
  workType?: WorkType;
  deadline?: string;
}

// ---------- 统计 ----------
export interface StatsMe {
  claimed: number;
  inProgress: number;
  finished: number;
  settled: number;
  totalAmount: number;
  pendingSettle: number;
  published: number;
  favorites: number;
}

export interface StatsMember {
  id: number;
  name: string;
  maxClaims: number;
  claimed: number;
  finished: number;
  settledAmount: number;
}

export interface StatsAdmin {
  total: number;
  pending: number;
  inProgress: number;
  review: number;
  finished: number;
  settledAmount: number;
  unsettledAmount: number;
  pendingSettleCount: number;
  weeklyCount: number;
  perMember: StatsMember[];
}

// ---------- 系列 ----------
export interface SeriesItem {
  name: string;
  count: number;
}

// ---------- 周结算 ----------
export interface WeeklySettlement {
  id: number;
  topicIds: number[];
  count: number;
  totalAmount: number;
  createdBy: number;
  createdAt: number;
  weekStart: number;
  createdByName: string;
}
