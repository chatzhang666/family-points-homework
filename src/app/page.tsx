"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mascot } from "@/components/Mascot";
import { api, load } from "@/lib/client";

type Panel = "login" | "setup" | "join";

export default function Welcome() {
  const router = useRouter();
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [panel, setPanel] = useState<Panel>("login");
  const [role, setRole] = useState<"parent" | "child">("child");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([load<{ initialized: boolean }>("state"), load<{ role: "parent" | "child" | null }>("session")]).then(([state, session]) => {
      if (state.initialized && session.role) {
        router.replace(session.role === "parent" ? "/parent" : "/child");
        return;
      }
      setInitialized(state.initialized);
      if (!state.initialized) setPanel("setup");
    });
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      let result: { role: "parent" | "child" };
      if (panel === "setup") result = await api({ action: "setup", ...values });
      else if (panel === "join") result = await api({ action: "join", ...values });
      else result = await api({ action: "login", role, ...values });
      router.push(result.role === "parent" ? "/parent" : "/child");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请重试");
    }
  }

  return (
    <main className="welcome">
      <section className="welcome-hero">
        <div>
          <span className="tiny-pill">家庭 Wi-Fi 小屋</span>
          <h1>快乐任务屋</h1>
          <p>完成今天的小目标，收集星星积分，换取心愿奖励。</p>
        </div>
        <Mascot mood="hello" />
      </section>
      <section className="auth-card">
        {initialized === null ? (
          <p className="muted">正在打开小屋...</p>
        ) : (
          <>
            {initialized && (
              <nav className="segmented">
                <button className={panel === "login" ? "active" : ""} onClick={() => setPanel("login")}>登录</button>
                <button className={panel === "join" ? "active" : ""} onClick={() => setPanel("join")}>孩子加入</button>
              </nav>
            )}
            <h2>{panel === "setup" ? "创建我们的家庭" : panel === "join" ? "加入家庭小屋" : "欢迎回来"}</h2>
            <form className="stack" onSubmit={submit}>
              {panel === "setup" && <input name="familyName" placeholder="家庭名称，例如：乐乐之家" required />}
              {panel === "join" && <input name="invite" placeholder="家长给你的邀请码" required autoCapitalize="characters" />}
              {panel === "login" && (
                <div className="role-choice">
                  <button type="button" className={role === "child" ? "selected" : ""} onClick={() => setRole("child")}>孩子</button>
                  <button type="button" className={role === "parent" ? "selected" : ""} onClick={() => setRole("parent")}>家长</button>
                </div>
              )}
              <input name="name" placeholder={panel === "setup" ? "家长昵称" : "昵称"} required />
              <input name="pin" inputMode="numeric" type="password" placeholder="4 至 8 位数字密码" required />
              {error && <p className="error">{error}</p>}
              <button className="primary" type="submit">
                {panel === "setup" ? "创建并进入家长端" : panel === "join" ? "加入并开始任务" : "进入小屋"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
