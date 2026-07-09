import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, clearSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST() {
  // 진짜 로그아웃: sessionEpoch 를 올려 발급된 토큰을 서버측에서 무효화한다.
  // (탈취된 토큰이 만료 전까지 재사용되는 것을 방지)
  const s = await getSession();
  if (s) {
    await prisma.adminUser
      .update({ where: { id: s.sub }, data: { sessionEpoch: { increment: 1 } } })
      .catch(() => {});
    audit("logout", { email: s.email, userId: s.sub });
  }
  clearSession();
  return NextResponse.json({ ok: true });
}
