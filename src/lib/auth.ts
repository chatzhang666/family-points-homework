import crypto from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db, sqlite } from "./db";
import { sessions, users } from "./schema";

export type AuthUser = {
  id: string;
  familyId: string;
  name: string;
  role: "parent" | "child";
};

export function hashPin(pin: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPin(pin: string, saved: string) {
  const [salt, hash] = saved.split(":");
  if (!salt || !hash) return false;
  const actual = crypto.scryptSync(pin, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const days = Number(process.env.SESSION_DAYS ?? 30);
  const expiresAt = Date.now() + days * 86400000;
  sqlite.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  sqlite.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expiresAt);
  return { token, expiresAt };
}

export function sessionCookie(token: string, expiresAt: number) {
  return `family_session=${token}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(expiresAt).toUTCString()}`;
}

export function clearSessionCookie() {
  return "family_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0";
}

export function currentUser(request: NextRequest): AuthUser | null {
  const token = request.cookies.get("family_session")?.value;
  if (!token) return null;
  const result = db
    .select({ id: users.id, familyId: users.familyId, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, Date.now())))
    .get();
  return result ?? null;
}

export function requireRole(request: NextRequest, role?: "parent" | "child") {
  const user = currentUser(request);
  if (!user || (role && user.role !== role)) throw new Error("请先使用正确身份登录");
  return user;
}
