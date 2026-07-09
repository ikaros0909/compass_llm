// 관리자 인증: bcrypt 비밀번호 + JWT(jose) httpOnly 쿠키 세션.
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { prisma } from "./db";
import { authSecret } from "./authSecret";

const COOKIE = "compass_session";

export interface Session {
  sub: string;
  email: string;
  role: string;
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function createSession(user: Session) {
  const token = await new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(authSecret());
  // 실제 접속 프로토콜에 따라 Secure 결정 (Caddy 가 x-forwarded-proto 설정).
  // HTTP(내부망/IP 접속)면 Secure 를 끄지 않으면 브라우저가 쿠키를 버려 로그인 안 됨.
  const isHttps = headers().get("x-forwarded-proto") === "https";
  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function getSession(): Promise<Session | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authSecret());
    return {
      sub: payload.sub as string,
      email: payload.email as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

export function clearSession() {
  cookies().delete(COOKIE);
}

// 최초 부팅 시 .env 의 관리자 계정을 시드 (idempotent)
export async function ensureAdminSeed() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) return;
  await prisma.adminUser.create({
    data: { email, passwordHash: await hashPassword(password), role: "admin" },
  });
}
