import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, currentUser, requireRole, sessionCookie } from "@/lib/auth";
import {
  adjustPoints,
  applicationState,
  childDashboard,
  createChallenge,
  createNewInvite,
  deleteReward,
  deleteTask,
  deleteTemplate,
  editChallenge,
  editOpenTask,
  exportFamilyData,
  joinChild,
  login,
  parentDashboard,
  parseHomework,
  publishHomework,
  requestReward,
  reviewCompletion,
  reviewRedemption,
  saveDailyBonus,
  saveReward,
  saveRoutine,
  setupParent,
  startTimer,
  submitCompletion,
  toggleTemplate,
  updateAccounts
} from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function success(data: unknown, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

function failure(error: unknown) {
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "操作失败" }, { status: 400 });
}

export async function GET(request: NextRequest) {
  try {
    const view = request.nextUrl.searchParams.get("view");
    if (view === "state") return success(applicationState());
    if (view === "session") return success({ role: currentUser(request)?.role ?? null });
    if (view === "child") return success(childDashboard(requireRole(request, "child")));
    if (view === "parent") return success(parentDashboard(requireRole(request, "parent")));
    if (view === "export") {
      const contents = JSON.stringify(exportFamilyData(requireRole(request, "parent")), null, 2);
      return new NextResponse(contents, {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="family-points-backup-${new Date().toISOString().slice(0, 10)}.json"`
        }
      });
    }
    throw new Error("未知页面请求");
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (action === "setup") {
      const result = setupParent(body);
      const response = success({ role: result.role, invite: result.invite });
      response.headers.set("Set-Cookie", sessionCookie(result.session.token, result.session.expiresAt));
      return response;
    }
    if (action === "join") {
      const result = joinChild(body);
      const response = success({ role: result.role });
      response.headers.set("Set-Cookie", sessionCookie(result.session.token, result.session.expiresAt));
      return response;
    }
    if (action === "login") {
      const result = login(body);
      const response = success({ role: result.role });
      response.headers.set("Set-Cookie", sessionCookie(result.session.token, result.session.expiresAt));
      return response;
    }
    if (action === "logout") {
      const response = success(null);
      response.headers.set("Set-Cookie", clearSessionCookie());
      return response;
    }
    if (action === "invite") return success({ code: createNewInvite(requireRole(request, "parent")) });
    if (action === "parseHomework") {
      requireRole(request, "parent");
      return success(parseHomework(body.text));
    }
    if (action === "publishHomework") {
      publishHomework(requireRole(request, "parent"), body.items, body.taskDate);
      return success(null);
    }
    if (action === "routine") {
      saveRoutine(requireRole(request, "parent"), body);
      return success(null);
    }
    if (action === "dailyBonus") {
      saveDailyBonus(requireRole(request, "parent"), body.points);
      return success(null);
    }
    if (action === "challenge") {
      createChallenge(requireRole(request, "parent"), body);
      return success(null);
    }
    if (action === "toggleTemplate") {
      toggleTemplate(requireRole(request, "parent"), body.id, body.active);
      return success(null);
    }
    if (action === "deleteTemplate") {
      deleteTemplate(requireRole(request, "parent"), body.id);
      return success(null);
    }
    if (action === "editTask") {
      editOpenTask(requireRole(request, "parent"), body);
      return success(null);
    }
    if (action === "editChallenge") {
      editChallenge(requireRole(request, "parent"), body);
      return success(null);
    }
    if (action === "deleteTask") {
      deleteTask(requireRole(request, "parent"), body.id);
      return success(null);
    }
    if (action === "startTimer") {
      startTimer(requireRole(request, "child"), body.id);
      return success(null);
    }
    if (action === "submit") {
      submitCompletion(requireRole(request, "child"), body);
      return success(null);
    }
    if (action === "review") {
      reviewCompletion(requireRole(request, "parent"), body);
      return success(null);
    }
    if (action === "reward") {
      saveReward(requireRole(request, "parent"), body);
      return success(null);
    }
    if (action === "deleteReward") {
      deleteReward(requireRole(request, "parent"), body.id);
      return success(null);
    }
    if (action === "requestReward") {
      requestReward(requireRole(request, "child"), body.rewardId);
      return success(null);
    }
    if (action === "reviewRedemption") {
      reviewRedemption(requireRole(request, "parent"), body);
      return success(null);
    }
    if (action === "adjust") {
      adjustPoints(requireRole(request, "parent"), body);
      return success(null);
    }
    if (action === "accounts") {
      updateAccounts(requireRole(request, "parent"), body);
      return success(null);
    }
    throw new Error("未知操作");
  } catch (error) {
    return failure(error);
  }
}
