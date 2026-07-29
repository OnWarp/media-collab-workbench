-- 0002 · 功能完善迁移
-- 1) topics 增加：结算凭证（JSON 数组）、流量逾期提醒标记
-- 2) 新增 logs 操作记录表
-- 注意：本迁移由 `wrangler d1 migrations apply` 按序执行且只执行一次（d1_migrations 表跟踪）。

ALTER TABLE topics ADD COLUMN settlementEvidence TEXT NOT NULL DEFAULT '[]';
ALTER TABLE topics ADD COLUMN trafficRemindedAt INTEGER;

CREATE TABLE IF NOT EXISTS logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  topicId   INTEGER NOT NULL,
  userId    INTEGER,
  userName  TEXT,
  action    TEXT    NOT NULL,
  detail    TEXT    NOT NULL DEFAULT '',
  createdAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_topic       ON logs(topicId);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expiresAt);
CREATE INDEX IF NOT EXISTS idx_topics_status    ON topics(status);
CREATE INDEX IF NOT EXISTS idx_messages_deleted ON messages(userId, deleted, read);
