"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mascot } from "@/components/Mascot";
import { api, load, showDate, timeLabel } from "@/lib/client";

type State = "open" | "pending" | "approved" | "rejected";
type Task = {
  id: string;
  title: string;
  task_date: string;
  kind: "homework" | "routine" | "challenge";
  mode: "single" | "steps";
  points: number;
  state: State;
  duration_minutes: number;
  timer_started_at: number | null;
  steps: { id: string; title: string; points: number; state: State }[];
};
type Dashboard = {
  user: { name: string };
  date: string;
  balance: number;
  dailyBonusPoints: number;
  tasks: Task[];
  rewards: { id: string; title: string; icon: string; points: number }[];
  redemptions: { id: string; title: string; points: number; state: State; created_at: number }[];
  ledger: { id: string; amount: number; reason: string; created_at: number }[];
};

type Celebration = { type: "task"; variant: number } | { type: "day" };

const labels: Record<State, string> = {
  open: "我完成啦",
  pending: "等待家长确认",
  approved: "已获得积分",
  rejected: "再试一次"
};

export default function ChildHome() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<"today" | "shop" | "ledger">("today");
  const [error, setError] = useState("");
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [award, setAward] = useState<number | null>(null);
  const [, setClock] = useState(Date.now());
  const latestSnapshot = useRef("");
  const syncing = useRef(false);

  function applyData(next: Dashboard) {
    const snapshot = JSON.stringify(next);
    if (snapshot === latestSnapshot.current) return false;
    latestSnapshot.current = snapshot;
    setData(next);
    return true;
  }

  async function refresh(checkAward = false) {
    try {
      const next = await load<Dashboard>("child");
      const changed = applyData(next);
      if (checkAward && changed) {
        const newest = next.ledger.find((item) => item.amount > 0);
        const seen = localStorage.getItem("latestAward");
        if (newest && seen && newest.id !== seen) setAward(newest.amount);
        if (newest) localStorage.setItem("latestAward", newest.id);
      }
      return next;
    } catch {
      router.push("/");
      return null;
    }
  }

  useEffect(() => {
    void refresh(true);
    // The page re-checks awards each time it is opened after a parent approval.
  }, []);

  useEffect(() => {
    async function sync() {
      if (syncing.current || document.visibilityState === "hidden") return;
      syncing.current = true;
      try {
        await refresh(true);
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

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function startTimer(id: string) {
    setError("");
    try {
      await api({ action: "startTimer", id });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法开始计时");
    }
  }

  async function submit(id: string, type: "task" | "step") {
    setError("");
    try {
      const hadSubmittedAll = data ? hasSubmittedAll(data.tasks) : false;
      await api({ action: "submit", id, type });
      const next = await refresh();
      const justSubmittedAll = Boolean(next && !hadSubmittedAll && hasSubmittedAll(next.tasks));
      setCelebration(justSubmittedAll ? { type: "day" } : { type: "task", variant: Math.floor(Math.random() * 4) + 1 });
      window.setTimeout(() => setCelebration(null), justSubmittedAll ? 2900 : 1900);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法提交");
    }
  }

  async function requestReward(rewardId: string) {
    setError("");
    try {
      await api({ action: "requestReward", rewardId });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法兑换");
    }
  }

  async function logout() {
    await api({ action: "logout" });
    router.push("/");
  }

  const progress = useMemo(() => {
    if (!data) return "";
    const total = data.tasks.length;
    const completed = data.tasks.filter((task) => task.state === "approved").length;
    return `${completed}/${total}`;
  }, [data]);

  if (!data) return <main className="loading">正在准备今天的任务...</main>;

  return (
    <main className="child-shell">
      <header className="child-header">
        <div>
          <p className="overline">嗨，{data.user.name}</p>
          <h1>{showDate(data.date)}的冒险</h1>
        </div>
        <button className="ghost small" onClick={logout}>退出</button>
      </header>

      {tab === "today" && (
        <>
          <button className="points-hero" onClick={() => setTab("shop")}>
            <div>
              <span>我的积分</span>
              <strong>{data.balance}</strong>
              <em>点这里兑换心愿礼物 ›</em>
            </div>
            <Mascot mood="points" />
          </button>
          <section className="task-heading">
            <div>
              <h2>今天要完成的事</h2>
              <p>完成后提交给家长确认积分{data.dailyBonusPoints > 0 ? ` · 全部完成 +${data.dailyBonusPoints}` : ""}</p>
            </div>
            <b>{progress}</b>
          </section>
          {error && <p className="error banner">{error}</p>}
          <section className="tasks">
            {data.tasks.map((task) =>
              task.kind === "challenge" ? (
                <ChallengeCard key={task.id} task={task} submit={submit} startTimer={startTimer} />
              ) : (
                <article className={`simple-task ${task.state}`} key={task.id}>
                  <div className={`kind ${task.kind}`}>{task.kind === "homework" ? "学校作业" : "每日任务"}</div>
                  <div className="task-row">
                    <div>
                      <h3>{task.title}</h3>
                      <p className="reward">⭐ +{task.points} 积分</p>
                    </div>
                    <TaskAction task={task} submit={() => submit(task.id, "task")} start={() => startTimer(task.id)} />
                  </div>
                  <TimerProgress task={task} />
                </article>
              )
            )}
            {!data.tasks.length && <p className="empty">今天还没有任务，先开心玩一会儿！</p>}
          </section>
        </>
      )}

      {tab === "shop" && (
        <section className="shop">
          <div className="shop-banner">
            <div>
              <p>可用积分</p>
              <strong>{data.balance}</strong>
              <h2>心愿商店</h2>
            </div>
            <Mascot mood="shop" />
          </div>
          {error && <p className="error banner">{error}</p>}
          <div className="reward-grid">
            {data.rewards.map((reward) => {
              const short = Math.max(0, reward.points - data.balance);
              return (
                <article className={`reward-card ${short ? "locked" : ""}`} key={reward.id}>
                  <span>{reward.icon}</span>
                  <h3>{reward.title}</h3>
                  <b>{reward.points} 积分</b>
                  <button disabled={Boolean(short)} onClick={() => requestReward(reward.id)}>
                    {short ? `还差 ${short} 分` : "申请兑换"}
                  </button>
                </article>
              );
            })}
          </div>
          <h3 className="section-label">我的申请</h3>
          {data.redemptions.map((item) => (
            <div className="history-row" key={item.id}>
              <span>{item.title}</span>
              <b className={item.state}>{item.state === "pending" ? "等待批准" : item.state === "approved" ? "已兑换" : "未通过"}</b>
            </div>
          ))}
        </section>
      )}

      {tab === "ledger" && (
        <section className="ledger-screen">
          <h2>我的积分记录</h2>
          {data.ledger.map((entry) => (
            <div className="ledger-row" key={entry.id}>
              <div>
                <b>积分变动</b>
                <small>{timeLabel(entry.created_at)}</small>
              </div>
              <strong className={entry.amount > 0 ? "plus" : "minus"}>
                {entry.amount > 0 ? "+" : ""}{entry.amount}
              </strong>
            </div>
          ))}
        </section>
      )}

      <nav className="child-nav">
        <button className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}>
          <img className="nav-dog" src="/characters/nav/dog-today.png" alt="" aria-hidden="true" />
          <span className="nav-label">今天</span>
        </button>
        <button className={tab === "shop" ? "active" : ""} onClick={() => setTab("shop")}>
          <img className="nav-dog" src="/characters/nav/dog-shop.png" alt="" aria-hidden="true" />
          <span className="nav-label">兑换</span>
        </button>
        <button className={tab === "ledger" ? "active" : ""} onClick={() => setTab("ledger")}>
          <img className="nav-dog" src="/characters/nav/dog-ledger.png" alt="" aria-hidden="true" />
          <span className="nav-label">记录</span>
        </button>
      </nav>

      {celebration && (
        <div className={`celebration ${celebration.type === "day" ? "day-celebration" : "task-celebration"}`} role="status">
          {celebration.type === "day" ? (
            <>
              <img className="celebration-dogs" src="/characters/celebrations/dogs-day-complete.png" alt="" />
              <strong>今天的任务全部完成啦！</strong>
              {data.dailyBonusPoints > 0 && <span>家长确认后额外获得 +{data.dailyBonusPoints} 积分</span>}
            </>
          ) : (
            <>
              <img className="celebration-girl" src={`/characters/celebrations/girl-task-${celebration.variant}.png`} alt="" />
              <strong>我做到了！</strong>
              <span>等待家长确认积分</span>
            </>
          )}
        </div>
      )}
      {award !== null && (
        <div className="award-toast" onClick={() => setAward(null)}>
          <strong>积分到账啦！</strong>
          <span>+{award} ⭐</span>
        </div>
      )}
    </main>
  );
}

function hasSubmittedAll(tasks: Task[]) {
  return tasks.length > 0 && tasks.every((task) => {
    if (task.mode === "steps") {
      return task.steps.length > 0 && task.steps.every((step) => step.state === "pending" || step.state === "approved");
    }
    return task.state === "pending" || task.state === "approved";
  });
}

function ChallengeCard({
  task,
  submit,
  startTimer
}: {
  task: Task;
  submit: (id: string, type: "task" | "step") => void;
  startTimer: (id: string) => void;
}) {
  const won = task.steps.filter((step) => step.state === "approved").reduce((sum, step) => sum + step.points, 0);
  const completed = task.mode === "steps" ? task.steps.filter((step) => step.state === "approved").length : task.state === "approved" ? 1 : 0;
  const total = task.mode === "steps" ? task.steps.length : 1;
  return (
    <article className="challenge-card">
      <div className="challenge-top">
        <span>🏆 高分挑战</span>
        <b>总计 +{task.points}</b>
      </div>
      <h3>{task.title}</h3>
      <div className="progress-track"><i style={{ width: `${(completed / total) * 100}%` }} /></div>
      <p className="challenge-progress">{task.mode === "steps" ? `已获得 ${won}/${task.points} 分 · ${completed}/${total} 步` : labels[task.state]}</p>
      {task.mode === "single" ? (
        <>
          <TaskAction task={task} submit={() => submit(task.id, "task")} start={() => startTimer(task.id)} challenge />
          <TimerProgress task={task} />
        </>
      ) : (
        <div className="steps">
          {task.steps.map((step) => (
            <div key={step.id}>
              <span>{step.title}<small>+{step.points}</small></span>
              <button
                disabled={step.state === "pending" || step.state === "approved"}
                onClick={() => submit(step.id, "step")}
              >
                {labels[step.state]}
              </button>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function taskTiming(task: Task) {
  const totalMs = task.duration_minutes * 60000;
  const elapsedMs = task.timer_started_at ? Date.now() - task.timer_started_at : 0;
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  return {
    remainingMs,
    complete: totalMs === 0 || remainingMs === 0,
    percentage: totalMs ? Math.min(100, (elapsedMs / totalMs) * 100) : 0
  };
}

function timerText(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function TaskAction({
  task,
  submit,
  start,
  challenge = false
}: {
  task: Task;
  submit: () => void;
  start: () => void;
  challenge?: boolean;
}) {
  const className = challenge ? "challenge-action" : undefined;
  if (task.state === "pending" || task.state === "approved") {
    return <button className={className} disabled>{labels[task.state]}</button>;
  }
  if (task.duration_minutes > 0 && !task.timer_started_at) {
    return <button className={className} onClick={start}>开始计时</button>;
  }
  const timing = taskTiming(task);
  return (
    <button className={className} disabled={!timing.complete} onClick={submit}>
      {timing.complete ? labels[task.state] : `还剩 ${timerText(timing.remainingMs)}`}
    </button>
  );
}

function TimerProgress({ task }: { task: Task }) {
  if (task.duration_minutes <= 0 || !task.timer_started_at || task.state === "approved") return null;
  const timing = taskTiming(task);
  return (
    <div className="timer-progress">
      <div><i style={{ width: `${timing.percentage}%` }} /></div>
      <span>{timing.complete ? "计时完成，可以提交啦" : `计时中 ${timerText(timing.remainingMs)}`}</span>
    </div>
  );
}
