#!/usr/bin/env node
/**
 * 把本地 server.js 产生的 data/db.json 迁移到 Cloudflare D1（media-collab-db）
 *
 * 用法:
 *   node scripts/migrate-to-d1.mjs [--file data/db.json] [--db media-collab-db] \
 *        [--config wrangler.jsonc] [--password <临时密码>] [--apply]
 *
 * 说明:
 * - 旧 server.js 用 scrypt 存储密码，新 worker.mjs（D1 版）用 PBKDF2(21 万次)。
 *   原有密码哈希无法移植，因此脚本会把迁移账号的密码统一重置为一个临时密码
 *   （用 --password 指定，或自动生成并打印到终端），登录后请尽快修改。
 * - 默认只生成 migrations/_migrated_seed.sql（已做 SQL 转义），加 --apply 才会
 *   调用 wrangler 写入远端 D1。
 * - 全部用 INSERT OR IGNORE（announcements 用 INSERT OR REPLACE），重复执行安全，
 *   不会新增重复主键行。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ---- 解析命令行参数 ----
const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const val = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : '1';
    args.set(key, val);
  }
}
const file = args.get('file') || resolve(root, 'data/db.json');
const dbName = args.get('db') || 'media-collab-db';
const config = args.get('config') || resolve(root, 'wrangler.jsonc');
const apply = args.has('apply');
const tmpPassword = args.get('password') || process.env.MIGRATE_PASSWORD || '';

// ---- PBKDF2（与 worker.mjs 完全一致）----
const enc = new TextEncoder();
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 210000, hash: 'SHA-256' },
    key, 256
  );
  return [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---- SQL 转义辅助 ----
const s = (v) => (v === null || v === undefined) ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'";
const n = (v) => (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) ? 'NULL' : String(v);
const b = (v) => (v ? 1 : 0);
const j = (v) => s(JSON.stringify(v ?? []));          // JSON 数组 -> TEXT
const jObj = (v) => s(v == null ? null : JSON.stringify(v)); // JSON 对象 -> TEXT 或 NULL

const lines = [];
const out = (sql) => lines.push(sql + ';');

if (!existsSync(file)) {
  console.error(`未找到数据源: ${file}`);
  console.error('请先确认存在本地 data/db.json（由 server.js 运行产生）。');
  process.exit(1);
}
const src = JSON.parse(readFileSync(file, 'utf8'));

const users = src.users || [];
const userMap = new Map(users.map((u) => [u.id, u]));

// ===== users =====
// 密码：scrypt -> PBKDF2 不兼容，统一重置为临时密码
let pw = tmpPassword;
if (!pw || pw.length < 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  pw = Array.from(rnd).map((x) => chars[x % chars.length]).join('');
  console.log(`\n[!] 未提供 --password，已自动生成统一临时密码： ${pw}`);
  console.log('    迁移后请用此密码登录，并尽快修改。\n');
}
for (const u of users) {
  const salt = crypto.randomUUID();
  const hash = await passwordHash(pw, salt);
  out(`INSERT OR IGNORE INTO users (id,username,displayName,salt,passwordHash,role,maxClaims,showTutorial,createdAt) VALUES (` +
    `${n(u.id)},${s(u.username)},${s(u.displayName)},${s(salt)},${s(hash)},${s(u.role || 'member')},${n(u.maxClaims ?? 10)},${b(u.showTutorial)},${n(u.createdAt)})`);
}

// ===== sessions（旧格式是对象 {token:{userId,expiresAt}}）=====
const sessions = src.sessions || {};
for (const [token, sess] of Object.entries(sessions)) {
  if (!sess) continue;
  out(`INSERT OR IGNORE INTO sessions (token,userId,expiresAt) VALUES (${s(token)},${n(sess.userId)},${n(sess.expiresAt)})`);
}

// ===== topics（claimedAt/abandonApproved/overdueNotified 等新表无对应列，丢弃）=====
const topics = src.topics || [];
for (const t of topics) {
  out(`INSERT OR IGNORE INTO topics (id,title,intro,referenceLinks,mediaLinks,copyText,workType,series,deadline,status,stage,createdBy,claimerId,createdAt,updatedAt,settlementStatus,settlementAmount,settlementDetail,settledAt,recycledAt,recycledReason,recycleDays,traffic,videoLink,videoType,reviewStage,trafficDueAt,abandonRequested,rejectedNotes,favoritedBy) VALUES (` +
    `${n(t.id)},${s(t.title)},${s(t.intro ?? '')},${j(t.referenceLinks)},${j(t.mediaLinks)},${s(t.copyText ?? '')},${s(t.workType ?? null)},${j(t.series)},${s(t.deadline ?? null)},${s(t.status ?? 'pending')},${s(t.stage ?? 'confirm')},${n(t.createdBy ?? null)},${n(t.claimerId ?? null)},${n(t.createdAt)},${n(t.updatedAt ?? t.createdAt)},${s(t.settlementStatus ?? 'unsettled')},${n(t.settlementAmount)},${s(t.settlementDetail ?? '')},${n(t.settledAt ?? null)},${n(t.recycledAt ?? null)},${s(t.recycledReason ?? null)},${n(t.recycleDays ?? 30)},${jObj(t.traffic)},${s(t.videoLink ?? null)},${s(t.videoType ?? null)},${s(t.reviewStage ?? null)},${n(t.trafficDueAt ?? null)},${b(t.abandonRequested)},${j(t.rejectedNotes)},${j(t.favoritedBy)})`);
}

// ===== comments（userName 不存储，用 users 反查 displayName）=====
const comments = src.comments || [];
for (const c of comments) {
  const userName = userMap.get(c.userId)?.displayName || '';
  out(`INSERT OR IGNORE INTO comments (id,topicId,userId,userName,content,createdAt) VALUES (${n(c.id)},${n(c.topicId)},${n(c.userId ?? null)},${s(userName)},${s(c.content)},${n(c.createdAt)})`);
}

// ===== materials =====
const materials = src.materials || [];
for (const m of materials) {
  out(`INSERT OR IGNORE INTO materials (id,topicId,userId,url,note,version,createdAt) VALUES (${n(m.id)},${n(m.topicId)},${n(m.userId ?? null)},${s(m.url)},${s(m.note ?? '')},${n(m.version ?? 1)},${n(m.createdAt)})`);
}

// ===== messages（丢弃 target；messageRecycle 已含在 db.messages 的软删除记录中，故跳过）=====
const messages = src.messages || [];
for (const m of messages) {
  out(`INSERT OR IGNORE INTO messages (id,userId,topicId,content,type,read,readAt,createdAt,deleted,deletedAt) VALUES (${n(m.id)},${n(m.userId)},${n(m.topicId ?? null)},${s(m.content)},${s(m.type || 'info')},${b(m.read)},${n(m.readAt ?? null)},${n(m.createdAt)},${b(m.deleted)},${n(m.deletedAt ?? null)})`);
}

// ===== weeklySettlements（weekStart/weekEnd 不在 D1 表，丢弃；topicIds 转 JSON）=====
const weekly = src.weeklySettlements || [];
for (const w of weekly) {
  out(`INSERT OR IGNORE INTO weeklySettlements (id,topicIds,count,totalAmount,createdBy,createdAt) VALUES (${n(w.id)},${j(w.topicIds)},${n(w.count ?? (w.topicIds || []).length)},${n(w.totalAmount ?? 0)},${n(w.createdBy ?? null)},${n(w.createdAt)})`);
}

// ===== announcements（用 REPLACE 覆盖 0001_init.sql 的空种子）=====
const announcements = src.announcements || [];
for (const a of announcements) {
  out(`INSERT OR REPLACE INTO announcements (id,notice,referenceVideos) VALUES (${n(a.id)},${s(a.notice ?? '')},${j(a.referenceVideos)})`);
}

// ===== 写出 SQL =====
const outPath = resolve(root, 'migrations', '_migrated_seed.sql');
writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');

console.log(`已生成迁移 SQL: ${outPath}`);
console.log(`  用户: ${users.length} | 会话: ${Object.keys(sessions).length} | 选题: ${topics.length} | 评论: ${comments.length} | 素材: ${materials.length} | 消息: ${messages.length} | 周结算: ${weekly.length} | 公告: ${announcements.length}`);
console.log(`  迁移账号临时密码（统一）: ${pw}`);

if (apply) {
  console.log('\n正在写入远端 D1 ...');
  execFileSync('npx', ['wrangler', 'd1', 'execute', dbName, '--remote', `--file=${outPath}`, '--config', config], { stdio: 'inherit' });
  console.log('迁移完成。');
} else {
  console.log('\n未加 --apply，仅生成 SQL 文件。需要写入远端时执行：');
  console.log(`  npx wrangler d1 execute ${dbName} --remote --file=${outPath} --config ${config}`);
  console.log('或重跑： node scripts/migrate-to-d1.mjs --apply');
}
