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

export async function createSession(user: Session & { sessionEpoch: number }) {
  const token = await new SignJWT({ email: user.email, role: user.role, epoch: user.sessionEpoch })
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
    const sub = payload.sub as string;
    // DB 재확인: 계정 삭제·비밀번호 변경·역할 변경 시 기존 토큰을 즉시 무효화하고,
    // 역할/이메일은 항상 최신 DB 값을 사용(권한 변경 즉시 반영).
    const user = await prisma.adminUser.findUnique({
      where: { id: sub },
      select: { email: true, role: true, sessionEpoch: true },
    });
    if (!user) return null;
    // epoch 클레임이 없는 구(舊)토큰(세션무효화 기능 배포 전 로그인)은 0 으로 간주.
    // → 아직 무효화(로그아웃·비번변경)되지 않은 유효 세션이면 조회·저장이 일관되게 동작.
    //   실제 무효화 시엔 DB epoch 가 1 이상이 되어 계속 차단됨.
    const tokenEpoch = typeof payload.epoch === "number" ? payload.epoch : 0;
    if (tokenEpoch !== user.sessionEpoch) return null;
    return { sub, email: user.email, role: user.role };
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
