import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const databasePath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "family-points.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS families (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL,
    daily_bonus_points INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, family_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
    pin_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE(family_id, name, role)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invitations (
    code TEXT PRIMARY KEY, family_id TEXT NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY, family_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL,
    mode TEXT NOT NULL, points INTEGER NOT NULL, recurrence TEXT NOT NULL, active INTEGER NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS template_steps (
    id TEXT PRIMARY KEY, template_id TEXT NOT NULL, title TEXT NOT NULL, points INTEGER NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, family_id TEXT NOT NULL, template_id TEXT, title TEXT NOT NULL,
    task_date TEXT NOT NULL, kind TEXT NOT NULL, mode TEXT NOT NULL, points INTEGER NOT NULL,
    state TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 0, timer_started_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS tasks_template_day_unique
    ON tasks(template_id, task_date) WHERE template_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS task_steps (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, title TEXT NOT NULL, points INTEGER NOT NULL,
    position INTEGER NOT NULL, state TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rewards (
    id TEXT PRIMARY KEY, family_id TEXT NOT NULL, title TEXT NOT NULL, icon TEXT NOT NULL,
    points INTEGER NOT NULL, active INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS redemptions (
    id TEXT PRIMARY KEY, family_id TEXT NOT NULL, reward_id TEXT NOT NULL, child_id TEXT NOT NULL,
    title_snapshot TEXT NOT NULL, points_snapshot INTEGER NOT NULL, state TEXT NOT NULL,
    created_at INTEGER NOT NULL, reviewed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS ledger (
    id TEXT PRIMARY KEY, family_id TEXT NOT NULL, child_id TEXT NOT NULL, amount INTEGER NOT NULL,
    reason TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, task_date TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ledger_source_unique ON ledger(source_type, source_id);
`);

function ensureColumn(table: string, column: string, sql: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((entry) => entry.name === column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${sql}`);
}

ensureColumn("templates", "duration_minutes", "duration_minutes INTEGER NOT NULL DEFAULT 0");
ensureColumn("tasks", "duration_minutes", "duration_minutes INTEGER NOT NULL DEFAULT 0");
ensureColumn("tasks", "timer_started_at", "timer_started_at INTEGER");
ensureColumn("families", "daily_bonus_points", "daily_bonus_points INTEGER NOT NULL DEFAULT 0");
sqlite.prepare(
  `UPDATE ledger SET reason =
    CASE
      WHEN source_type = 'redemption_refund' THEN '积分返还'
      WHEN source_type = 'daily_bonus' THEN '全部完成奖励'
      WHEN amount >= 0 THEN '积分增加'
      ELSE '积分扣除'
    END`
).run();

export const db = drizzle(sqlite, { schema });
