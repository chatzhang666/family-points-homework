import crypto from "node:crypto";
import { sqlite } from "./db";
import { createSession, hashPin, verifyPin, type AuthUser } from "./auth";

type TaskKind = "homework" | "routine" | "challenge";
type Mode = "single" | "steps";
type State = "open" | "pending" | "approved" | "rejected";
type StepInput = { title: string; points: number };

const key = () => crypto.randomUUID();
const now = () => Date.now();
const DAY_BOUNDARY_HOURS = 2;

export function today(timestamp = now()) {
  const adjusted = new Date(timestamp - DAY_BOUNDARY_HOURS * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(adjusted);
}

function requireText(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`请填写${label}`);
  return text;
}

function requirePin(value: unknown) {
  const pin = String(value ?? "").trim();
  if (!/^\d{4,8}$/.test(pin)) throw new Error("密码请设置为 4 至 8 位数字");
  return pin;
}

export function requirePoints(value: unknown) {
  const points = Number(value);
  if (!Number.isSafeInteger(points) || points <= 0) throw new Error("积分必须是大于 0 的整数");
  return points;
}

function requireNonnegativePoints(value: unknown) {
  const points = Number(value);
  if (!Number.isSafeInteger(points) || points < 0) throw new Error("奖励积分请输入 0 或正整数");
  return points;
}

function requireDuration(value: unknown) {
  const minutes = value === "" || value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 1440) {
    throw new Error("计时分钟数请输入 0 至 1440 的整数");
  }
  return minutes;
}

function one<T>(sql: string, ...values: unknown[]) {
  return sqlite.prepare(sql).get(...values) as T | undefined;
}

function many<T>(sql: string, ...values: unknown[]) {
  return sqlite.prepare(sql).all(...values) as T[];
}

export function applicationState() {
  const family = one<{ total: number }>("SELECT COUNT(*) AS total FROM families");
  return { initialized: Boolean(family?.total) };
}

export function setupParent(data: Record<string, unknown>) {
  if (applicationState().initialized) throw new Error("家庭已经创建，请直接登录");
  const familyId = key();
  const userId = key();
  const familyName = requireText(data.familyName, "家庭名称");
  const name = requireText(data.name, "家长昵称");
  const pin = requirePin(data.pin);
  const invite = crypto.randomBytes(3).toString("hex").toUpperCase();
  const stamp = now();
  const transaction = sqlite.transaction(() => {
    sqlite.prepare("INSERT INTO families (id, name, created_at, daily_bonus_points) VALUES (?, ?, ?, 0)").run(familyId, familyName, stamp);
    sqlite.prepare("INSERT INTO users VALUES (?, ?, ?, 'parent', ?, ?)").run(userId, familyId, name, hashPin(pin), stamp);
    sqlite.prepare("INSERT INTO invitations VALUES (?, ?, NULL, ?)").run(invite, familyId, stamp);
    const addTemplate = sqlite.prepare(
      `INSERT INTO templates
       (id, family_id, title, kind, mode, points, recurrence, active, duration_minutes, created_at)
       VALUES (?, ?, ?, 'routine', 'single', 2, 'daily', 1, ?, ?)`
    );
    addTemplate.run(key(), familyId, "阅读 30 分钟", 30, stamp);
    addTemplate.run(key(), familyId, "整理书包", 0, stamp);
    const addReward = sqlite.prepare("INSERT INTO rewards VALUES (?, ?, ?, ?, ?, 1, ?)");
    addReward.run(key(), familyId, "选择今晚的水果", "🍓", 8, stamp);
    addReward.run(key(), familyId, "周末亲子游戏时间", "🎲", 20, stamp);
  });
  transaction();
  return { session: createSession(userId), role: "parent" as const, invite };
}

export function joinChild(data: Record<string, unknown>) {
  const inviteCode = requireText(data.invite, "邀请码").toUpperCase();
  const invite = one<{ family_id: string; used_at: number | null }>(
    "SELECT family_id, used_at FROM invitations WHERE code = ?",
    inviteCode
  );
  if (!invite || invite.used_at) throw new Error("邀请码无效或已经使用");
  const childExists = one("SELECT id FROM users WHERE family_id = ? AND role = 'child'", invite.family_id);
  if (childExists) throw new Error("首版仅支持一个孩子账号");
  const userId = key();
  const name = requireText(data.name, "孩子昵称");
  const pin = requirePin(data.pin);
  const transaction = sqlite.transaction(() => {
    sqlite
      .prepare("INSERT INTO users VALUES (?, ?, ?, 'child', ?, ?)")
      .run(userId, invite.family_id, name, hashPin(pin), now());
    sqlite.prepare("UPDATE invitations SET used_at = ? WHERE code = ?").run(now(), inviteCode);
  });
  transaction();
  return { session: createSession(userId), role: "child" as const };
}

export function login(data: Record<string, unknown>) {
  const role = data.role === "child" ? "child" : "parent";
  const name = requireText(data.name, "昵称");
  const pin = requirePin(data.pin);
  const user = one<{ id: string; pin_hash: string }>("SELECT id, pin_hash FROM users WHERE name = ? AND role = ?", name, role);
  if (!user || !verifyPin(pin, user.pin_hash)) throw new Error("昵称或密码不正确");
  return { session: createSession(user.id), role };
}

export function createNewInvite(user: AuthUser) {
  const child = one("SELECT id FROM users WHERE family_id = ? AND role = 'child'", user.familyId);
  if (child) throw new Error("孩子已经加入家庭");
  sqlite.prepare("UPDATE invitations SET used_at = ? WHERE family_id = ? AND used_at IS NULL").run(now(), user.familyId);
  const code = crypto.randomBytes(3).toString("hex").toUpperCase();
  sqlite.prepare("INSERT INTO invitations VALUES (?, ?, NULL, ?)").run(code, user.familyId, now());
  return code;
}

export function updateAccounts(user: AuthUser, data: Record<string, unknown>) {
  const parentName = requireText(data.parentName, "家长昵称");
  const currentPin = requirePin(data.currentPin);
  const parent = one<{ pin_hash: string }>("SELECT pin_hash FROM users WHERE id = ? AND role = 'parent'", user.id);
  if (!parent || !verifyPin(currentPin, parent.pin_hash)) throw new Error("当前家长密码不正确");
  const newPinText = String(data.parentPin ?? "").trim();
  const childNameText = String(data.childName ?? "").trim();
  const childPinText = String(data.childPin ?? "").trim();
  const child = one<{ id: string; name: string }>("SELECT id, name FROM users WHERE family_id = ? AND role = 'child'", user.familyId);
  const transaction = sqlite.transaction(() => {
    sqlite
      .prepare("UPDATE users SET name = ?, pin_hash = ? WHERE id = ?")
      .run(parentName, newPinText ? hashPin(requirePin(newPinText)) : parent.pin_hash, user.id);
    if (child) {
      sqlite
        .prepare("UPDATE users SET name = ?, pin_hash = CASE WHEN ? = '' THEN pin_hash ELSE ? END WHERE id = ?")
        .run(
          childNameText || child.name,
          childPinText,
          childPinText ? hashPin(requirePin(childPinText)) : "",
          child.id
        );
    }
  });
  transaction();
}

function ensureTodayTasks(familyId: string) {
  const taskDate = today();
  const templates = many<{
    id: string;
    title: string;
    kind: "routine" | "challenge";
    mode: Mode;
    points: number;
    duration_minutes: number;
  }>("SELECT id, title, kind, mode, points, duration_minutes FROM templates WHERE family_id = ? AND active = 1", familyId);
  const transaction = sqlite.transaction(() => {
    for (const template of templates) {
      const existing = one("SELECT id FROM tasks WHERE template_id = ? AND task_date = ?", template.id, taskDate);
      if (existing) continue;
      const taskId = key();
      sqlite
        .prepare(
          `INSERT INTO tasks
           (id, family_id, template_id, title, task_date, kind, mode, points, state, duration_minutes, timer_started_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL, ?)`
        )
        .run(taskId, familyId, template.id, template.title, taskDate, template.kind, template.mode, template.points, template.duration_minutes, now());
      if (template.mode === "steps") {
        const steps = many<StepInput & { position: number }>(
          "SELECT title, points, position FROM template_steps WHERE template_id = ? ORDER BY position",
          template.id
        );
        for (const step of steps) {
          sqlite
            .prepare("INSERT INTO task_steps VALUES (?, ?, ?, ?, ?, 'open')")
            .run(key(), taskId, step.title, step.points, step.position);
        }
      }
    }
  });
  transaction();
}

function balance(familyId: string) {
  return one<{ points: number }>("SELECT COALESCE(SUM(amount), 0) AS points FROM ledger WHERE family_id = ?", familyId)?.points ?? 0;
}

type TaskRow = {
  id: string;
  title: string;
  task_date: string;
  kind: TaskKind;
  mode: Mode;
  points: number;
  state: State;
  duration_minutes: number;
  timer_started_at: number | null;
};

function taskCards(familyId: string, date: string) {
  const tasks = many<TaskRow>(
    `SELECT id, title, task_date, kind, mode, points, state, duration_minutes, timer_started_at
     FROM tasks WHERE family_id = ? AND task_date = ?
     ORDER BY CASE WHEN state = 'approved' THEN 1 ELSE 0 END,
              CASE kind WHEN 'homework' THEN 0 WHEN 'routine' THEN 1 ELSE 2 END,
              created_at`,
    familyId,
    date
  );
  return tasks.map((task) => ({
    ...task,
    steps:
      task.mode === "steps"
        ? many<{ id: string; title: string; points: number; state: State }>(
            "SELECT id, title, points, state FROM task_steps WHERE task_id = ? ORDER BY position",
            task.id
          )
        : []
  }));
}

export function childDashboard(user: AuthUser) {
  ensureTodayTasks(user.familyId);
  const family = one<{ daily_bonus_points: number }>("SELECT daily_bonus_points FROM families WHERE id = ?", user.familyId);
  return {
    user,
    date: today(),
    balance: balance(user.familyId),
    dailyBonusPoints: family?.daily_bonus_points ?? 0,
    tasks: taskCards(user.familyId, today()),
    rewards: many("SELECT id, title, icon, points FROM rewards WHERE family_id = ? AND active = 1 ORDER BY points", user.familyId),
    redemptions: many(
      "SELECT id, title_snapshot AS title, points_snapshot AS points, state, created_at FROM redemptions WHERE child_id = ? ORDER BY created_at DESC LIMIT 10",
      user.id
    ),
    ledger: many(
      "SELECT id, amount, reason, created_at FROM ledger WHERE child_id = ? ORDER BY created_at DESC LIMIT 10",
      user.id
    )
  };
}

export function parentDashboard(user: AuthUser) {
  ensureTodayTasks(user.familyId);
  const family = one<{ daily_bonus_points: number }>("SELECT daily_bonus_points FROM families WHERE id = ?", user.familyId);
  const invite = one<{ code: string }>(
    "SELECT code FROM invitations WHERE family_id = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1",
    user.familyId
  );
  const templateCards = many<{
    id: string;
    title: string;
    kind: "routine" | "challenge";
    mode: Mode;
    points: number;
    active: number;
    duration_minutes: number;
  }>(
    "SELECT id, title, kind, mode, points, active, duration_minutes FROM templates WHERE family_id = ? ORDER BY created_at DESC",
    user.familyId
  ).map((template) => ({
    ...template,
    steps: template.mode === "steps"
      ? many<StepInput>("SELECT title, points FROM template_steps WHERE template_id = ? ORDER BY position", template.id)
      : []
  }));
  return {
    user,
    date: today(),
    balance: balance(user.familyId),
    dailyBonusPoints: family?.daily_bonus_points ?? 0,
    invite: invite?.code ?? null,
    child: one<{ name: string }>("SELECT name FROM users WHERE family_id = ? AND role = 'child'", user.familyId) ?? null,
    tasks: taskCards(user.familyId, today()),
    pendingTasks: many(
      "SELECT id, title, points, kind, task_date FROM tasks WHERE family_id = ? AND mode = 'single' AND state = 'pending' ORDER BY task_date DESC",
      user.familyId
    ),
    pendingSteps: many(
      `SELECT s.id, s.title, s.points, t.title AS challenge, t.task_date
       FROM task_steps s JOIN tasks t ON s.task_id = t.id
       WHERE t.family_id = ? AND s.state = 'pending' ORDER BY t.task_date DESC, s.position`,
      user.familyId
    ),
    templates: templateCards,
    rewards: many("SELECT id, title, icon, points, active FROM rewards WHERE family_id = ? AND active = 1 ORDER BY created_at DESC", user.familyId),
    redemptions: many(
      `SELECT r.id, r.title_snapshot AS title, r.points_snapshot AS points, r.state, r.created_at,
              EXISTS(SELECT 1 FROM ledger l WHERE l.source_type = 'redemption' AND l.source_id = r.id) AS charged
       FROM redemptions r WHERE r.family_id = ? ORDER BY r.created_at DESC`,
      user.familyId
    ),
    ledger: many(
      "SELECT id, amount, reason, task_date, created_at FROM ledger WHERE family_id = ? ORDER BY created_at DESC LIMIT 30",
      user.familyId
    )
  };
}

export function parseHomework(textValue: unknown) {
  const text = requireText(textValue, "作业文字");
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.、)）]|[一二三四五六七八九十]+[、.])\s*/, "").trim())
    .filter((line) => line.length > 1 && !/^(?:(?:今日|今天)\s*)?(?:家庭)?作业(?:清单)?[:：]?$|^通知[:：]?$/u.test(line))
    .map((title) => ({ title, points: 1 }));
}

export function publishHomework(user: AuthUser, itemsValue: unknown, taskDateValue?: unknown) {
  if (!Array.isArray(itemsValue) || itemsValue.length === 0) throw new Error("请至少确认一项作业");
  const taskDate = String(taskDateValue ?? today());
  const insert = sqlite.prepare(
    `INSERT INTO tasks
     (id, family_id, template_id, title, task_date, kind, mode, points, state, duration_minutes, timer_started_at, created_at)
     VALUES (?, ?, NULL, ?, ?, 'homework', 'single', ?, 'open', 0, NULL, ?)`
  );
  const transaction = sqlite.transaction(() => {
    for (const raw of itemsValue) {
      const item = raw as Record<string, unknown>;
      insert.run(key(), user.familyId, requireText(item.title, "作业标题"), taskDate, requirePoints(item.points), now());
    }
  });
  transaction();
}

export function saveRoutine(user: AuthUser, data: Record<string, unknown>) {
  const title = requireText(data.title, "任务名称");
  const points = requirePoints(data.points ?? 2);
  const durationMinutes = requireDuration(data.durationMinutes);
  const active = data.active === false ? 0 : 1;
  if (data.id) {
    sqlite
      .prepare("UPDATE templates SET title = ?, points = ?, duration_minutes = ?, active = ? WHERE id = ? AND family_id = ? AND kind = 'routine'")
      .run(title, points, durationMinutes, active, String(data.id), user.familyId);
  } else {
    sqlite
      .prepare(
        `INSERT INTO templates
         (id, family_id, title, kind, mode, points, recurrence, active, duration_minutes, created_at)
         VALUES (?, ?, ?, 'routine', 'single', ?, 'daily', ?, ?, ?)`
      )
      .run(key(), user.familyId, title, points, active, durationMinutes, now());
  }
}

export function saveDailyBonus(user: AuthUser, value: unknown) {
  sqlite
    .prepare("UPDATE families SET daily_bonus_points = ? WHERE id = ?")
    .run(requireNonnegativePoints(value), user.familyId);
}

function normalizeSteps(value: unknown) {
  if (!Array.isArray(value) || !value.length) throw new Error("分步骤挑战至少需要一个步骤");
  return value.map((raw) => {
    const step = raw as Record<string, unknown>;
    return { title: requireText(step.title, "步骤名称"), points: requirePoints(step.points) };
  });
}

export function createChallenge(user: AuthUser, data: Record<string, unknown>) {
  const title = requireText(data.title, "挑战名称");
  const mode: Mode = data.mode === "steps" ? "steps" : "single";
  const daily = data.recurrence === "daily";
  const steps = mode === "steps" ? normalizeSteps(data.steps) : [];
  const points = mode === "steps" ? steps.reduce((sum, step) => sum + step.points, 0) : requirePoints(data.points);
  const durationMinutes = mode === "steps" ? 0 : requireDuration(data.durationMinutes);
  const transaction = sqlite.transaction(() => {
    if (daily) {
      const templateId = key();
      sqlite
        .prepare(
          `INSERT INTO templates
           (id, family_id, title, kind, mode, points, recurrence, active, duration_minutes, created_at)
           VALUES (?, ?, ?, 'challenge', ?, ?, 'daily', 1, ?, ?)`
        )
        .run(templateId, user.familyId, title, mode, points, durationMinutes, now());
      steps.forEach((step, index) => {
        sqlite.prepare("INSERT INTO template_steps VALUES (?, ?, ?, ?, ?)").run(key(), templateId, step.title, step.points, index);
      });
    } else {
      const taskId = key();
      sqlite
        .prepare(
          `INSERT INTO tasks
           (id, family_id, template_id, title, task_date, kind, mode, points, state, duration_minutes, timer_started_at, created_at)
           VALUES (?, ?, NULL, ?, ?, 'challenge', ?, ?, 'open', ?, NULL, ?)`
        )
        .run(taskId, user.familyId, title, today(), mode, points, durationMinutes, now());
      steps.forEach((step, index) => {
        sqlite.prepare("INSERT INTO task_steps VALUES (?, ?, ?, ?, ?, 'open')").run(key(), taskId, step.title, step.points, index);
      });
    }
  });
  transaction();
  ensureTodayTasks(user.familyId);
}

export function editChallenge(user: AuthUser, data: Record<string, unknown>) {
  const id = requireText(data.id, "挑战");
  const source = data.source === "template" ? "template" : "task";
  const title = requireText(data.title, "挑战名称");
  if (source === "template") {
    const template = one<{ mode: Mode }>("SELECT mode FROM templates WHERE id = ? AND family_id = ? AND kind = 'challenge'", id, user.familyId);
    if (!template) throw new Error("挑战设置不存在");
    const steps = template.mode === "steps" ? normalizeSteps(data.steps) : [];
    const points = template.mode === "steps" ? steps.reduce((sum, step) => sum + step.points, 0) : requirePoints(data.points);
    const durationMinutes = template.mode === "steps" ? 0 : requireDuration(data.durationMinutes);
    const transaction = sqlite.transaction(() => {
      sqlite.prepare("UPDATE templates SET title = ?, points = ?, duration_minutes = ? WHERE id = ? AND family_id = ?")
        .run(title, points, durationMinutes, id, user.familyId);
      if (template.mode === "steps") {
        sqlite.prepare("DELETE FROM template_steps WHERE template_id = ?").run(id);
        steps.forEach((step, index) => {
          sqlite.prepare("INSERT INTO template_steps VALUES (?, ?, ?, ?, ?)").run(key(), id, step.title, step.points, index);
        });
      }
    });
    transaction();
    return;
  }
  const task = one<{ mode: Mode; state: State }>(
    "SELECT mode, state FROM tasks WHERE id = ? AND family_id = ? AND kind = 'challenge'",
    id,
    user.familyId
  );
  if (!task) throw new Error("挑战任务不存在");
  const hasAward = task.state === "approved" || one(
    "SELECT id FROM ledger WHERE (source_type = 'task' AND source_id = ?) OR (source_type = 'step' AND source_id IN (SELECT id FROM task_steps WHERE task_id = ?))",
    id,
    id
  );
  if (hasAward) throw new Error("已发分的挑战可删除，但不能修改既有分值");
  const steps = task.mode === "steps" ? normalizeSteps(data.steps) : [];
  const points = task.mode === "steps" ? steps.reduce((sum, step) => sum + step.points, 0) : requirePoints(data.points);
  const durationMinutes = task.mode === "steps" ? 0 : requireDuration(data.durationMinutes);
  const transaction = sqlite.transaction(() => {
    sqlite.prepare("UPDATE tasks SET title = ?, points = ?, duration_minutes = ?, state = 'open' WHERE id = ? AND family_id = ?")
      .run(title, points, durationMinutes, id, user.familyId);
    if (task.mode === "steps") {
      sqlite.prepare("DELETE FROM task_steps WHERE task_id = ?").run(id);
      steps.forEach((step, index) => {
        sqlite.prepare("INSERT INTO task_steps VALUES (?, ?, ?, ?, ?, 'open')").run(key(), id, step.title, step.points, index);
      });
    }
  });
  transaction();
}

export function toggleTemplate(user: AuthUser, templateId: unknown, active: unknown) {
  sqlite.prepare("UPDATE templates SET active = ? WHERE id = ? AND family_id = ?").run(active ? 1 : 0, String(templateId), user.familyId);
}

export function deleteTemplate(user: AuthUser, templateIdValue: unknown) {
  const templateId = requireText(templateIdValue, "每日设置");
  const template = one("SELECT id FROM templates WHERE id = ? AND family_id = ?", templateId, user.familyId);
  if (!template) throw new Error("每日设置不存在");
  const todayTask = one<{ id: string }>(
    "SELECT id FROM tasks WHERE template_id = ? AND task_date = ?",
    templateId,
    today()
  );
  const transaction = sqlite.transaction(() => {
    if (todayTask) removeTask(todayTask.id);
    sqlite.prepare("DELETE FROM template_steps WHERE template_id = ?").run(templateId);
    sqlite.prepare("DELETE FROM templates WHERE id = ? AND family_id = ?").run(templateId, user.familyId);
  });
  transaction();
}

export function editOpenTask(user: AuthUser, data: Record<string, unknown>) {
  const taskId = requireText(data.id, "任务");
  const task = one<{ state: State }>("SELECT state FROM tasks WHERE id = ? AND family_id = ?", taskId, user.familyId);
  if (!task || task.state === "approved") throw new Error("已经发放积分的任务不能修改");
  sqlite
    .prepare("UPDATE tasks SET title = ?, points = ?, duration_minutes = ? WHERE id = ? AND family_id = ?")
    .run(requireText(data.title, "任务名称"), requirePoints(data.points), requireDuration(data.durationMinutes), taskId, user.familyId);
}

function removeTask(taskId: string) {
  sqlite.prepare("DELETE FROM task_steps WHERE task_id = ?").run(taskId);
  sqlite.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
}

export function deleteTask(user: AuthUser, taskIdValue: unknown) {
  const taskId = requireText(taskIdValue, "任务");
  const task = one<{ template_id: string | null }>("SELECT template_id FROM tasks WHERE id = ? AND family_id = ?", taskId, user.familyId);
  if (!task) throw new Error("任务不存在");
  if (task.template_id) sqlite.prepare("UPDATE templates SET active = 0 WHERE id = ? AND family_id = ?").run(task.template_id, user.familyId);
  removeTask(taskId);
}

export function startTimer(user: AuthUser, taskIdValue: unknown) {
  const taskId = requireText(taskIdValue, "任务");
  const task = one<{ duration_minutes: number; state: State; timer_started_at: number | null }>(
    "SELECT duration_minutes, state, timer_started_at FROM tasks WHERE id = ? AND family_id = ? AND mode = 'single'",
    taskId,
    user.familyId
  );
  if (!task || task.state === "pending" || task.state === "approved") throw new Error("这个任务无法开始计时");
  if (task.duration_minutes <= 0) throw new Error("这个任务没有设置计时");
  if (!task.timer_started_at) sqlite.prepare("UPDATE tasks SET timer_started_at = ? WHERE id = ?").run(now(), taskId);
}

export function submitCompletion(user: AuthUser, data: Record<string, unknown>) {
  const type = data.type === "step" ? "step" : "task";
  const id = requireText(data.id, "任务");
  if (type === "step") {
    const step = one<{ state: State }>(
      "SELECT s.state FROM task_steps s JOIN tasks t ON t.id = s.task_id WHERE s.id = ? AND t.family_id = ?",
      id,
      user.familyId
    );
    if (!step || step.state === "approved") throw new Error("这个步骤无法再次提交");
    sqlite.prepare("UPDATE task_steps SET state = 'pending' WHERE id = ?").run(id);
    return;
  }
  const task = one<{ state: State; duration_minutes: number; timer_started_at: number | null }>(
    "SELECT state, duration_minutes, timer_started_at FROM tasks WHERE id = ? AND family_id = ? AND mode = 'single'",
    id,
    user.familyId
  );
  if (!task || task.state === "approved") throw new Error("这个任务无法再次提交");
  if (task.duration_minutes > 0) {
    if (!task.timer_started_at) throw new Error("请先开始计时");
    if (now() < task.timer_started_at + task.duration_minutes * 60000) throw new Error("计时还没有结束，请完成足够时间后提交");
  }
  sqlite.prepare("UPDATE tasks SET state = 'pending' WHERE id = ?").run(id);
}

function childId(familyId: string) {
  const child = one<{ id: string }>("SELECT id FROM users WHERE family_id = ? AND role = 'child'", familyId);
  if (!child) throw new Error("孩子还没有加入家庭");
  return child.id;
}

function awardDailyCompletionBonus(familyId: string, taskDate: string) {
  const family = one<{ daily_bonus_points: number }>("SELECT daily_bonus_points FROM families WHERE id = ?", familyId);
  const bonus = family?.daily_bonus_points ?? 0;
  if (bonus <= 0) return;
  const taskStatus = one<{ total: number; incomplete: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN state = 'approved' THEN 0 ELSE 1 END) AS incomplete
     FROM tasks WHERE family_id = ? AND task_date = ?`,
    familyId,
    taskDate
  );
  if (!taskStatus?.total || taskStatus.incomplete > 0) return;
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO ledger
       VALUES (?, ?, ?, ?, ?, 'daily_bonus', ?, ?, ?)`
    )
    .run(key(), familyId, childId(familyId), bonus, "全部完成奖励", `${familyId}:${taskDate}`, taskDate, now());
}

export function reviewCompletion(user: AuthUser, data: Record<string, unknown>) {
  const approve = data.approve !== false;
  const type = data.type === "step" ? "step" : "task";
  const id = requireText(data.id, "任务");
  const transaction = sqlite.transaction(() => {
    if (type === "task") {
      const task = one<TaskRow>("SELECT id, title, task_date, kind, mode, points, state, duration_minutes, timer_started_at FROM tasks WHERE id = ? AND family_id = ?", id, user.familyId);
      if (!task || task.mode !== "single" || task.state !== "pending") throw new Error("这项提交已处理或不可审批");
      if (!approve) {
        sqlite.prepare("UPDATE tasks SET state = 'rejected' WHERE id = ?").run(id);
        return;
      }
      sqlite.prepare("UPDATE tasks SET state = 'approved' WHERE id = ?").run(id);
      sqlite
        .prepare("INSERT INTO ledger VALUES (?, ?, ?, ?, ?, 'task', ?, ?, ?)")
        .run(key(), user.familyId, childId(user.familyId), task.points, "积分增加", task.id, task.task_date, now());
      awardDailyCompletionBonus(user.familyId, task.task_date);
      return;
    }
    const step = one<{ id: string; title: string; points: number; state: State; task_id: string; task_date: string }>(
      `SELECT s.id, s.title, s.points, s.state, t.id AS task_id, t.task_date
       FROM task_steps s JOIN tasks t ON t.id = s.task_id WHERE s.id = ? AND t.family_id = ?`,
      id,
      user.familyId
    );
    if (!step || step.state !== "pending") throw new Error("这一步骤已处理或不可审批");
    if (!approve) {
      sqlite.prepare("UPDATE task_steps SET state = 'rejected' WHERE id = ?").run(id);
      return;
    }
    sqlite.prepare("UPDATE task_steps SET state = 'approved' WHERE id = ?").run(id);
    sqlite
      .prepare("INSERT INTO ledger VALUES (?, ?, ?, ?, ?, 'step', ?, ?, ?)")
      .run(key(), user.familyId, childId(user.familyId), step.points, "积分增加", step.id, step.task_date, now());
    const remaining = one<{ total: number }>("SELECT COUNT(*) AS total FROM task_steps WHERE task_id = ? AND state != 'approved'", step.task_id);
    if (remaining?.total === 0) sqlite.prepare("UPDATE tasks SET state = 'approved' WHERE id = ?").run(step.task_id);
    awardDailyCompletionBonus(user.familyId, step.task_date);
  });
  transaction();
}

export function saveReward(user: AuthUser, data: Record<string, unknown>) {
  const title = requireText(data.title, "奖品名称");
  const icon = requireText(data.icon ?? "🎁", "奖品图标");
  const points = requirePoints(data.points);
  if (data.id) {
    sqlite
      .prepare("UPDATE rewards SET title = ?, icon = ?, points = ?, active = ? WHERE id = ? AND family_id = ?")
      .run(title, icon, points, data.active === false ? 0 : 1, String(data.id), user.familyId);
  } else {
    sqlite.prepare("INSERT INTO rewards VALUES (?, ?, ?, ?, ?, 1, ?)").run(key(), user.familyId, title, icon, points, now());
  }
}

export function deleteReward(user: AuthUser, rewardIdValue: unknown) {
  const rewardId = requireText(rewardIdValue, "奖品");
  const pending = one("SELECT id FROM redemptions WHERE reward_id = ? AND state = 'pending'", rewardId);
  if (pending) throw new Error("这个奖品还有待审批兑换，请先处理申请");
  const history = one("SELECT id FROM redemptions WHERE reward_id = ?", rewardId);
  if (history) {
    sqlite.prepare("UPDATE rewards SET active = 0 WHERE id = ? AND family_id = ?").run(rewardId, user.familyId);
  } else {
    sqlite.prepare("DELETE FROM rewards WHERE id = ? AND family_id = ?").run(rewardId, user.familyId);
  }
}

export function requestReward(user: AuthUser, rewardIdValue: unknown) {
  const rewardId = requireText(rewardIdValue, "奖品");
  const reward = one<{ title: string; points: number }>(
    "SELECT title, points FROM rewards WHERE id = ? AND family_id = ? AND active = 1",
    rewardId,
    user.familyId
  );
  if (!reward) throw new Error("奖品已下架");
  if (balance(user.familyId) < reward.points) throw new Error("积分还不够兑换这个奖品");
  const redemptionId = key();
  const stamp = now();
  const transaction = sqlite.transaction(() => {
    sqlite
      .prepare("INSERT INTO redemptions VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL)")
      .run(redemptionId, user.familyId, rewardId, user.id, reward.title, reward.points, stamp);
    sqlite
      .prepare("INSERT INTO ledger VALUES (?, ?, ?, ?, ?, 'redemption', ?, NULL, ?)")
      .run(key(), user.familyId, user.id, -reward.points, "积分扣除", redemptionId, stamp);
  });
  transaction();
}

export function reviewRedemption(user: AuthUser, data: Record<string, unknown>) {
  const id = requireText(data.id, "兑换申请");
  const approve = data.approve !== false;
  const transaction = sqlite.transaction(() => {
    const item = one<{ id: string; child_id: string; title_snapshot: string; points_snapshot: number; state: string }>(
      "SELECT id, child_id, title_snapshot, points_snapshot, state FROM redemptions WHERE id = ? AND family_id = ?",
      id,
      user.familyId
    );
    if (!item || item.state !== "pending") throw new Error("兑换申请已经处理");
    const charged = one<{ id: string }>(
      "SELECT id FROM ledger WHERE source_type = 'redemption' AND source_id = ?",
      item.id
    );
    if (!approve) {
      sqlite.prepare("UPDATE redemptions SET state = 'rejected', reviewed_at = ? WHERE id = ?").run(now(), id);
      if (charged) {
        sqlite
          .prepare("INSERT INTO ledger VALUES (?, ?, ?, ?, ?, 'redemption_refund', ?, NULL, ?)")
          .run(key(), user.familyId, item.child_id, item.points_snapshot, "积分返还", item.id, now());
      }
      return;
    }
    // Pending requests created before immediate charging was introduced still deduct on approval.
    if (!charged) {
      if (balance(user.familyId) < item.points_snapshot) throw new Error("当前积分不足，无法批准兑换");
      sqlite
        .prepare("INSERT INTO ledger VALUES (?, ?, ?, ?, ?, 'redemption', ?, NULL, ?)")
        .run(key(), user.familyId, item.child_id, -item.points_snapshot, "积分扣除", item.id, now());
    }
    sqlite.prepare("UPDATE redemptions SET state = 'approved', reviewed_at = ? WHERE id = ?").run(now(), id);
  });
  transaction();
}

export function adjustPoints(user: AuthUser, data: Record<string, unknown>) {
  const amount = Number(data.amount);
  if (!Number.isSafeInteger(amount) || amount === 0) throw new Error("调整积分必须是非零整数");
  sqlite
    .prepare("INSERT INTO ledger VALUES (?, ?, ?, ?, ?, 'adjustment', ?, NULL, ?)")
    .run(key(), user.familyId, childId(user.familyId), amount, amount > 0 ? "积分增加" : "积分扣除", key(), now());
}

export function exportFamilyData(user: AuthUser) {
  const familyId = user.familyId;
  return {
    exportedAt: new Date().toISOString(),
    family: one("SELECT * FROM families WHERE id = ?", familyId),
    users: many("SELECT id, family_id, name, role, created_at FROM users WHERE family_id = ?", familyId),
    templates: many("SELECT * FROM templates WHERE family_id = ?", familyId),
    tasks: many("SELECT * FROM tasks WHERE family_id = ?", familyId),
    steps: many("SELECT s.* FROM task_steps s JOIN tasks t ON t.id = s.task_id WHERE t.family_id = ?", familyId),
    ledger: many("SELECT * FROM ledger WHERE family_id = ?", familyId),
    rewards: many("SELECT * FROM rewards WHERE family_id = ?", familyId),
    redemptions: many("SELECT * FROM redemptions WHERE family_id = ?", familyId)
  };
}
