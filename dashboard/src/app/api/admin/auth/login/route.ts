import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { loginBlockedFor, recordLoginFailure, recordLoginSuccess } from "@/lib/loginThrottle";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 브루트포스 완화: 클라이언트 IP 기준으로 실패 횟수를 제한.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const wait = loginBlockedFor(ip);
  if (wait > 0) {
    audit("login.blocked", { ip, wait });
    return NextResponse.json(
      { error: `로그인 시도가 많습니다. ${wait}초 후 다시 시도하세요.` },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }

  const { email, password } = await req.json();
  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    recordLoginFailure(ip);
    audit("login.failure", { ip, email });
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  recordLoginSuccess(ip);
  audit("login.success", { ip, email: user.email, userId: user.id });
  await createSession({ sub: user.id, email: user.email, role: user.role, sessionEpoch: user.sessionEpoch });
  return NextResponse.json({ ok: true });
}
