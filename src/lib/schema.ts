import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const families = sqliteTable("families", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
  dailyBonusPoints: integer("daily_bonus_points").notNull().default(0)
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  familyId: text("family_id").notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ["parent", "child"] }).notNull(),
  pinHash: text("pin_hash").notNull(),
  createdAt: integer("created_at").notNull()
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at").notNull()
});

export const invitations = sqliteTable("invitations", {
  code: text("code").primaryKey(),
  familyId: text("family_id").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull()
});

export const templates = sqliteTable("templates", {
  id: text("id").primaryKey(),
  familyId: text("family_id").notNull(),
  title: text("title").notNull(),
  kind: text("kind", { enum: ["routine", "challenge"] }).notNull(),
  mode: text("mode", { enum: ["single", "steps"] }).notNull(),
  points: integer("points").notNull(),
  recurrence: text("recurrence", { enum: ["daily"] }).notNull(),
  active: integer("active", { mode: "boolean" }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(0),
  createdAt: integer("created_at").notNull()
});

export const templateSteps = sqliteTable("template_steps", {
  id: text("id").primaryKey(),
  templateId: text("template_id").notNull(),
  title: text("title").notNull(),
  points: integer("points").notNull(),
  position: integer("position").notNull()
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull(),
    templateId: text("template_id"),
    title: text("title").notNull(),
    taskDate: text("task_date").notNull(),
    kind: text("kind", { enum: ["homework", "routine", "challenge"] }).notNull(),
    mode: text("mode", { enum: ["single", "steps"] }).notNull(),
    points: integer("points").notNull(),
    state: text("state", { enum: ["open", "pending", "approved", "rejected"] }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(0),
    timerStartedAt: integer("timer_started_at"),
    createdAt: integer("created_at").notNull()
  },
  (table) => [uniqueIndex("tasks_template_day_unique").on(table.templateId, table.taskDate)]
);

export const taskSteps = sqliteTable("task_steps", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  title: text("title").notNull(),
  points: integer("points").notNull(),
  position: integer("position").notNull(),
  state: text("state", { enum: ["open", "pending", "approved", "rejected"] }).notNull()
});

export const rewards = sqliteTable("rewards", {
  id: text("id").primaryKey(),
  familyId: text("family_id").notNull(),
  title: text("title").notNull(),
  icon: text("icon").notNull(),
  points: integer("points").notNull(),
  active: integer("active", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at").notNull()
});

export const redemptions = sqliteTable("redemptions", {
  id: text("id").primaryKey(),
  familyId: text("family_id").notNull(),
  rewardId: text("reward_id").notNull(),
  childId: text("child_id").notNull(),
  titleSnapshot: text("title_snapshot").notNull(),
  pointsSnapshot: integer("points_snapshot").notNull(),
  state: text("state", { enum: ["pending", "approved", "rejected"] }).notNull(),
  createdAt: integer("created_at").notNull(),
  reviewedAt: integer("reviewed_at")
});

export const ledger = sqliteTable(
  "ledger",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull(),
    childId: text("child_id").notNull(),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    taskDate: text("task_date"),
    createdAt: integer("created_at").notNull()
  },
  (table) => [uniqueIndex("ledger_source_unique").on(table.sourceType, table.sourceId)]
);
