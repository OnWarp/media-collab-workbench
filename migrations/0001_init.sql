-- 自媒体协作工作台 · D1 数据库结构
-- 布尔字段统一用 INTEGER 0/1 存储；JSON 数组字段用 TEXT 存储（读写时 JSON 序列化/反序列化）。

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT    NOT NULL UNIQUE,
  displayName  TEXT    NOT NULL,
  salt         TEXT    NOT NULL,
  passwordHash TEXT    NOT NULL,
  role         TEXT    NOT NULL DEFAULT 'member',
  maxClaims    INTEGER NOT NULL DEFAULT 10,
  showTutorial INTEGER NOT NULL DEFAULT 1,
  createdAt    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token     TEXT    PRIMARY KEY,
  userId    INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT    NOT NULL,
  intro            TEXT    NOT NULL DEFAULT '',
  referenceLinks   TEXT    NOT NULL DEFAULT '[]',
  mediaLinks       TEXT    NOT NULL DEFAULT '[]',
  copyText         TEXT    NOT NULL DEFAULT '',
  workType         TEXT,
  series           TEXT    NOT NULL DEFAULT '[]',
  deadline         TEXT,
  status           TEXT    NOT NULL DEFAULT 'pending',
  stage            TEXT    NOT NULL DEFAULT 'confirm',
  createdBy        INTEGER,
  claimerId        INTEGER,
  createdAt        INTEGER NOT NULL,
  updatedAt        INTEGER NOT NULL,
  settlementStatus TEXT    NOT NULL DEFAULT 'unsettled',
  settlementAmount REAL,
  settlementDetail TEXT    NOT NULL DEFAULT '',
  settledAt        INTEGER,
  recycledAt       INTEGER,
  recycledReason   TEXT,
  recycleDays      INTEGER NOT NULL DEFAULT 30,
  traffic          TEXT,
  videoLink        TEXT,
  videoType        TEXT,
  reviewStage      TEXT,
  trafficDueAt     INTEGER,
  abandonRequested INTEGER NOT NULL DEFAULT 0,
  rejectedNotes    TEXT    NOT NULL DEFAULT '[]',
  favoritedBy      TEXT    NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS comments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  topicId   INTEGER NOT NULL,
  userId    INTEGER,
  userName  TEXT,
  content   TEXT    NOT NULL,
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS materials (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  topicId   INTEGER NOT NULL,
  userId    INTEGER,
  url       TEXT    NOT NULL,
  note      TEXT    NOT NULL DEFAULT '',
  version   INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  userId    INTEGER NOT NULL,
  topicId   INTEGER,
  content   TEXT    NOT NULL,
  type      TEXT    NOT NULL DEFAULT 'info',
  read      INTEGER NOT NULL DEFAULT 0,
  readAt    INTEGER,
  createdAt INTEGER NOT NULL,
  deleted   INTEGER NOT NULL DEFAULT 0,
  deletedAt INTEGER
);

CREATE TABLE IF NOT EXISTS weeklySettlements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topicIds    TEXT    NOT NULL DEFAULT '[]',
  count       INTEGER NOT NULL DEFAULT 0,
  totalAmount REAL    NOT NULL DEFAULT 0,
  createdBy   INTEGER,
  createdAt   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  notice          TEXT    NOT NULL DEFAULT '',
  referenceVideos TEXT    NOT NULL DEFAULT '[]'
);

-- 公告看板为单例（id=1）
INSERT OR IGNORE INTO announcements (id, notice, referenceVideos) VALUES (1, '', '[]');

CREATE INDEX IF NOT EXISTS idx_topics_claimer   ON topics(claimerId);
CREATE INDEX IF NOT EXISTS idx_topics_createdBy ON topics(createdBy);
CREATE INDEX IF NOT EXISTS idx_comments_topic   ON comments(topicId);
CREATE INDEX IF NOT EXISTS idx_materials_topic  ON materials(topicId);
CREATE INDEX IF NOT EXISTS idx_messages_user    ON messages(userId);
