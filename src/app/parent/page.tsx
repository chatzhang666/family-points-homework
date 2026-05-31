"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, load, showDate, timeLabel } from "@/lib/client";

type Pending = { id: string; title: string; points: number; task_date: string; challenge?: string };
type Step = { title: string; points: number };
type ManagedTask = {
  id: string;
  title: string;
  points: number;
  state: string;
  kind: string;
  mode: string;
  duration_minutes: number;
  steps: Step[];
};
type Dashboard = {
  user: { name: string };
  date: string;
  balance: number;
  dailyBonusPoints: number;
  invite: string | null;
  child: { name: string } | null;
  pendingTasks: Pending[];
  pendingSteps: Pending[];
  tasks: ManagedTask[];
  templates: (ManagedTask & { active: number })[];
  rewards: { id: string; title: string; icon: string; points: number; active: number }[];
  redemptions: { id: string; title: string; points: number; state: string; charged: number; created_at: number }[];
  ledger: { id: string; amount: number; reason: string; task_date: string | null; created_at: number }[];
};

export default function ParentHome() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<"review" | "homework" | "tasks" | "rewards" | "records" | "accounts">("review");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<{ title: string; points: number }[]>([]);
  const latestSnapshot = useRef("");
  const syncing = useRef(false);

  function applyData(next: Dashboard) {
    const snapshot = JSON.stringify(next);
    if (snapshot === latestSnapshot.current) return;
    latestSnapshot.current = snapshot;
    setData(next);
  }

  async function refresh() {
    try {
      const next = await load<Dashboard>("parent");
      applyData(next);
      return next;
    } catch {
      router.push("/");
      return null;
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    async function sync() {
      if (syncing.current || document.visibilityState === "hidden") return;
      syncing.current = true;
      try {
        await refresh();
      } finally {
        syncing.current = false;
      }
    }

    const timer = window.setInterval(() => void sync(), 3000);
    const resume = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  async function run(body: Record<string, unknown>, success: string) {
    setError("");
    try {
      await api(body);
      setMessage(success);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    }
  }

  function checkHigh(points: number) {
    return points <= 100 || window.confirm(`这项任务设置为 ${points} 分，确定保存这个高分奖励吗？`);
  }

  async function previewHomework(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get("text") ?? "");
    try {
      setDrafts(await api({ action: "parseHomework", text }));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法整理文字");
    }
  }

  async function publishHomework() {
    if (drafts.some((item) => !checkHigh(item.points))) return;
    await run({ action: "publishHomework", items: drafts, taskDate: data?.date }, "今天的作业已发布");
    setDrafts([]);
  }

  async function routine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const points = Number(values.points);
    if (!checkHigh(points)) return;
    await run({ action: "routine", ...values, points }, "每日任务已保存");
    event.currentTarget.reset();
  }

  async function dailyBonus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const points = Number(new FormData(event.currentTarget).get("points"));
    if (!checkHigh(points)) return;
    await run({ action: "dailyBonus", points }, "全部完成奖励已保存");
  }

  async function updateRoutine(event: FormEvent<HTMLFormElement>, id: string, active: number) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const points = Number(values.points);
    if (!checkHigh(points)) return;
    await run({ action: "routine", id, active: Boolean(active), ...values, points }, "每日任务默认设置已修改");
  }

  async function updateTodayTask(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const points = Number(values.points);
    if (!checkHigh(points)) return;
    await run({ action: "editTask", id, ...values, points }, "当天任务已修改");
  }

  async function remove(action: "deleteTemplate" | "deleteTask" | "deleteReward", id: string, label: string) {
    if (!window.confirm(`确定删除“${label}”吗？`)) return;
    await run({ action, id }, "已删除");
  }

  async function challenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const mode = String(values.mode);
    const steps = mode === "steps" ? stepValues(values.steps) : [];
    const points = mode === "steps" ? steps.reduce((sum, step) => sum + step.points, 0) : Number(values.points);
    if (!checkHigh(points)) return;
    await run({ action: "challenge", ...values, points, steps }, "挑战任务已创建");
    event.currentTarget.reset();
  }

  function stepValues(text: unknown) {
    return String(text ?? "")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [title, pointText] = line.split(/[|｜]/);
        return { title: title?.trim(), points: Number(pointText) };
      });
  }

  function stepsText(steps: Step[]) {
    return steps.map((step) => `${step.title}｜${step.points}`).join("\n");
  }

  async function updateChallenge(event: FormEvent<HTMLFormElement>, id: string, source: "task" | "template", mode: string) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const steps = mode === "steps" ? stepValues(values.steps) : [];
    const points = mode === "steps" ? steps.reduce((sum, step) => sum + step.points, 0) : Number(values.points);
    if (!checkHigh(points)) return;
    await run({ action: "editChallenge", id, source, ...values, points, steps }, "挑战已修改");
  }

  async function reward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    await run({ action: "reward", ...values, points: Number(values.points) }, "奖品已加入商店");
    event.currentTarget.reset();
  }

  async function updateReward(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    await run({ action: "reward", id, active: true, ...values, points: Number(values.points) }, "奖品已修改");
  }

  async function adjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    await run({ action: "adjust", ...values, amount: Number(values.amount) }, "积分调整已记录");
    event.currentTarget.reset();
  }

  async function accounts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    await run({ action: "accounts", ...values }, "账号信息已更新");
    event.currentTarget.reset();
  }

  async function logout() {
    await api({ action: "logout" });
    router.push("/");
  }

  if (!data) return <main className="loading">正在打开家长管理台...</main>;
  const pendingRedemptions = data.redemptions.filter((item) => item.state === "pending");
  const reviewCount = data.pendingTasks.length + data.pendingSteps.length + pendingRedemptions.length;

  return (
    <main className="parent-shell">
      <header className="parent-header">
        <div>
          <p className="overline">家长管理台 · {showDate(data.date)}</p>
          <h1>{data.user.name}，您好</h1>
        </div>
        <button className="ghost small" onClick={logout}>退出</button>
      </header>

      <section className="family-summary">
        <div><small>孩子积分</small><strong>{data.balance}</strong></div>
        {!data.child && data.invite ? (
          <div className="invite"><small>孩子邀请码</small><strong>{data.invite}</strong></div>
        ) : (
          <div><small>孩子账号</small><b>{data.child?.name ?? "未加入"}</b></div>
        )}
      </section>

      {message && <p className="success banner" onClick={() => setMessage("")}>{message}</p>}
      {error && <p className="error banner" onClick={() => setError("")}>{error}</p>}

      <nav className="parent-tabs">
        <button className={tab === "review" ? "active" : ""} onClick={() => setTab("review")}>审核{reviewCount ? ` ${reviewCount}` : ""}</button>
        <button className={tab === "homework" ? "active" : ""} onClick={() => setTab("homework")}>作业</button>
        <button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>任务</button>
        <button className={tab === "rewards" ? "active" : ""} onClick={() => setTab("rewards")}>奖品</button>
        <button className={tab === "records" ? "active" : ""} onClick={() => setTab("records")}>记录</button>
        <button className={tab === "accounts" ? "active" : ""} onClick={() => setTab("accounts")}>账号</button>
      </nav>

      {tab === "review" && (
        <section className="admin-section">
          <h2>等待确认的完成事项</h2>
          {data.pendingTasks.map((item) => (
            <Approval key={item.id} title={item.title} detail={`${item.points} 分 · ${item.task_date}`} onAccept={() => run({ action: "review", id: item.id, type: "task" }, "积分已发放")} onReject={() => run({ action: "review", id: item.id, type: "task", approve: false }, "已退回任务")} />
          ))}
          {data.pendingSteps.map((item) => (
            <Approval key={item.id} title={`${item.challenge} / ${item.title}`} detail={`${item.points} 分 · 分步骤挑战`} onAccept={() => run({ action: "review", id: item.id, type: "step" }, "步骤积分已发放")} onReject={() => run({ action: "review", id: item.id, type: "step", approve: false }, "已退回步骤")} />
          ))}
          <h2>兑换申请</h2>
          {pendingRedemptions.map((item) => (
            <Approval
              key={item.id}
              title={item.title}
              detail={item.charged ? `已扣除 ${item.points} 分，拒绝将返还` : `旧申请：批准后扣除 ${item.points} 分`}
              onAccept={() => run({ action: "reviewRedemption", id: item.id }, "兑换已批准")}
              onReject={() => run({ action: "reviewRedemption", id: item.id, approve: false }, item.charged ? "兑换未批准，积分已返还" : "兑换未批准")}
            />
          ))}
          {!reviewCount && <p className="empty admin">当前没有待审核事项。</p>}
        </section>
      )}

      {tab === "homework" && (
        <section className="admin-section">
          <h2>从微信群文字整理作业</h2>
          <form className="admin-form" onSubmit={previewHomework}>
            <textarea name="text" rows={6} placeholder={"粘贴文字，例如：\n1. 语文：背诵古诗\n2. 数学：练习册第 10 页"} required />
            <button className="primary">整理成任务</button>
          </form>
          {drafts.length > 0 && (
            <div className="draft-list">
              <h3>发布前确认</h3>
              {drafts.map((item, index) => (
                <div key={index}>
                  <input value={item.title} onChange={(event) => setDrafts(drafts.map((row, i) => (i === index ? { ...row, title: event.target.value } : row)))} />
                  <input className="points-input" inputMode="numeric" value={item.points} onChange={(event) => setDrafts(drafts.map((row, i) => (i === index ? { ...row, points: Number(event.target.value) } : row)))} />
                  <span>分</span>
                  <button className="remove" onClick={() => setDrafts(drafts.filter((_, i) => i !== index))}>删除</button>
                </div>
              ))}
              <button className="primary" onClick={publishHomework}>发布给孩子</button>
            </div>
          )}
        </section>
      )}

      {tab === "tasks" && (
        <section className="admin-section split">
          <div>
            <h2>全部完成奖励</h2>
            <form className="admin-form compact bonus-setting" onSubmit={dailyBonus}>
              <label>当天任务全部完成后额外奖励
                <input name="points" inputMode="numeric" defaultValue={data.dailyBonusPoints} required />
              </label>
              <button className="primary">保存奖励积分</button>
            </form>
            <h2>新增每日固定任务</h2>
            <form className="admin-form compact" onSubmit={routine}>
              <input name="title" placeholder="例如：练字 15 分钟" required />
              <label>奖励积分 <input name="points" inputMode="numeric" defaultValue="2" required /></label>
              <label>计时分钟（0 为不计时） <input name="durationMinutes" inputMode="numeric" defaultValue="0" required /></label>
              <button className="primary">保存每日任务</button>
            </form>
            <h3>已有每日设置</h3>
            {data.templates.map((item) => (
              item.kind === "routine" ? (
                <form className="edit-template" key={item.id} onSubmit={(event) => updateRoutine(event, item.id, item.active)}>
                  <input name="title" defaultValue={item.title} required />
                  <input className="short-number" name="points" inputMode="numeric" defaultValue={item.points} required />
                  <input className="short-number" aria-label="计时分钟" name="durationMinutes" inputMode="numeric" defaultValue={item.duration_minutes} required />
                  <button className="save-mini">修改</button>
                  <button type="button" onClick={() => run({ action: "toggleTemplate", id: item.id, active: !item.active }, "每日设置已更新")}>{item.active ? "停用" : "启用"}</button>
                  <button type="button" className="danger-mini" onClick={() => remove("deleteTemplate", item.id, item.title)}>删除</button>
                </form>
              ) : (
                <form className="challenge-editor" key={item.id} onSubmit={(event) => updateChallenge(event, item.id, "template", item.mode)}>
                  <input name="title" defaultValue={item.title} required />
                  {item.mode === "steps" ? (
                    <textarea name="steps" rows={3} defaultValue={stepsText(item.steps)} required />
                  ) : (
                    <div className="challenge-numbers">
                      <label>积分 <input name="points" inputMode="numeric" defaultValue={item.points} required /></label>
                      <label>计时 <input name="durationMinutes" inputMode="numeric" defaultValue={item.duration_minutes} required /></label>
                    </div>
                  )}
                  <div className="action-line">
                    <button className="save-mini">修改挑战</button>
                    <button type="button" onClick={() => run({ action: "toggleTemplate", id: item.id, active: !item.active }, "每日设置已更新")}>{item.active ? "停用" : "启用"}</button>
                    <button type="button" className="danger-mini" onClick={() => remove("deleteTemplate", item.id, item.title)}>删除</button>
                  </div>
                </form>
              )
            ))}
            <h3>管理今天的任务</h3>
            {data.tasks.map((item) =>
              item.mode === "single" && item.state !== "approved" ? (
                <form className="edit-today" key={item.id} onSubmit={(event) => updateTodayTask(event, item.id)}>
                  <input name="title" defaultValue={item.title} required />
                  <input className="short-number" aria-label="积分" name="points" inputMode="numeric" defaultValue={item.points} required />
                  <input className="short-number" aria-label="计时分钟" name="durationMinutes" inputMode="numeric" defaultValue={item.duration_minutes} required />
                  <button className="save-mini">保存</button>
                  <button type="button" className="danger-mini" onClick={() => remove("deleteTask", item.id, item.title)}>删除</button>
                </form>
              ) : item.kind === "challenge" && item.state !== "approved" ? (
                <form className="challenge-editor" key={item.id} onSubmit={(event) => updateChallenge(event, item.id, "task", item.mode)}>
                  <input name="title" defaultValue={item.title} required />
                  <textarea name="steps" rows={3} defaultValue={stepsText(item.steps)} required />
                  <div className="action-line">
                    <button className="save-mini">修改步骤</button>
                    <button type="button" className="danger-mini" onClick={() => remove("deleteTask", item.id, item.title)}>删除</button>
                  </div>
                </form>
              ) : (
                <div className="managed-row" key={item.id}>
                  <span>{item.title} <small>{item.points} 分 · {item.state === "approved" ? "已发分" : "分步挑战"}</small></span>
                  <button className="danger-mini" onClick={() => remove("deleteTask", item.id, item.title)}>删除</button>
                </div>
              )
            )}
          </div>
          <div>
            <h2>新增高分挑战</h2>
            <form className="admin-form compact" onSubmit={challenge}>
              <input name="title" placeholder="例如：完成科学小制作" required />
              <label>奖励方式
                <select name="mode" defaultValue="single">
                  <option value="single">整体完成一次得分</option>
                  <option value="steps">每个步骤独立得分</option>
                </select>
              </label>
              <label>整体奖励积分 <input name="points" inputMode="numeric" defaultValue="10" /></label>
              <label>整体挑战计时分钟（0 为不计时）
                <input name="durationMinutes" inputMode="numeric" defaultValue="0" />
              </label>
              <label>分步设置（选择分步时填写，每行：步骤｜积分）
                <textarea name="steps" rows={4} placeholder={"寻找材料｜5\n完成制作｜15\n讲解作品｜10"} />
              </label>
              <label>出现频率
                <select name="recurrence" defaultValue="once">
                  <option value="once">单次挑战</option>
                  <option value="daily">每天出现</option>
                </select>
              </label>
              <button className="primary">创建挑战</button>
            </form>
          </div>
        </section>
      )}

      {tab === "rewards" && (
        <section className="admin-section split">
          <div>
            <h2>新增奖品</h2>
            <form className="admin-form compact" onSubmit={reward}>
              <input name="title" placeholder="奖品名称" required />
              <label>小图标 <input name="icon" defaultValue="🎁" required /></label>
              <label>所需积分 <input name="points" inputMode="numeric" required /></label>
              <button className="primary">加入商店</button>
            </form>
          </div>
          <div>
            <h2>当前奖品</h2>
            {data.rewards.map((item) => (
              <form className="edit-prize" key={item.id} onSubmit={(event) => updateReward(event, item.id)}>
                <input className="icon-input" name="icon" defaultValue={item.icon} required />
                <input name="title" defaultValue={item.title} required />
                <input className="short-number" name="points" inputMode="numeric" defaultValue={item.points} required />
                <button className="save-mini">修改</button>
                <button type="button" className="danger-mini" onClick={() => remove("deleteReward", item.id, item.title)}>删除</button>
              </form>
            ))}
          </div>
        </section>
      )}

      {tab === "records" && (
        <section className="admin-section split">
          <div>
            <h2>调整积分</h2>
            <form className="admin-form compact" onSubmit={adjustment}>
              <label>增加或扣除 <input name="amount" inputMode="numeric" placeholder="如 5 或 -5" required /></label>
              <button className="primary">记录调整</button>
            </form>
            <a className="download" href="/api/app?view=export">导出家庭数据备份</a>
          </div>
          <div>
            <h2>积分流水</h2>
            {data.ledger.map((item) => (
              <div className="ledger-row admin-row" key={item.id}>
                <div><b>积分变动</b><small>{timeLabel(item.created_at)}</small></div>
                <strong className={item.amount > 0 ? "plus" : "minus"}>{item.amount > 0 ? "+" : ""}{item.amount}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "accounts" && (
        <section className="admin-section account-panel">
          <h2>账号设置</h2>
          <p className="account-note">家长输入当前密码后，可更新自己的昵称或密码，也可替孩子重新设置登录昵称和密码。</p>
          <form className="admin-form compact" onSubmit={accounts}>
            <label>家长昵称 <input name="parentName" defaultValue={data.user.name} required /></label>
            <label>当前家长密码 <input name="currentPin" type="password" inputMode="numeric" required /></label>
            <label>家长新密码（不修改可留空） <input name="parentPin" type="password" inputMode="numeric" /></label>
            {data.child && (
              <>
                <label>孩子昵称 <input name="childName" defaultValue={data.child.name} required /></label>
                <label>孩子新密码（不修改可留空） <input name="childPin" type="password" inputMode="numeric" /></label>
              </>
            )}
            <button className="primary">保存账号设置</button>
          </form>
        </section>
      )}
    </main>
  );
}

function Approval({ title, detail, onAccept, onReject }: { title: string; detail: string; onAccept: () => void; onReject: () => void }) {
  return (
    <article className="approval">
      <div><b>{title}</b><small>{detail}</small></div>
      <button className="reject" onClick={onReject}>退回</button>
      <button className="accept" onClick={onAccept}>批准</button>
    </article>
  );
}
