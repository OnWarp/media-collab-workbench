-- 0003 · 查询性能索引补强
-- 由 wrangler d1 migrations apply 按序执行，只执行一次。

CREATE INDEX IF NOT EXISTS idx_topics_recycled_status ON topics(recycledAt, status);
CREATE INDEX IF NOT EXISTS idx_topics_settlement ON topics(settlementStatus, status);
CREATE INDEX IF NOT EXISTS idx_topics_updated ON topics(updatedAt);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(userId, createdAt);
CREATE INDEX IF NOT EXISTS idx_weekly_created ON weeklySettlements(createdAt);
