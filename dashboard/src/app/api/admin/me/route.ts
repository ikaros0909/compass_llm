// 현재 로그인한 관리자 본인 정보 조회 + 비밀번호 변경.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, verifyPassword, hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ id: s.sub, email: s.email, role: s.role });
}

// 본인 비밀번호 변경
export async function PUT(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { currentPassword, newPassword } = await req.json();
  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: "새 비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
  }
  const user = await prisma.adminUser.findUnique({ where: { id: s.sub } });
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });
  if (!(await verifyPassword(currentPassword ?? "", user.passwordHash))) {
    return NextResponse.json({ error: "현재 비밀번호가 올바르지 않습니다." }, { status: 403 });
  }
  await prisma.adminUser.update({
    where: { id: s.sub },
    // 비밀번호 변경 시 다른 기기의 기존 세션을 무효화(재로그인 강제).
    data: { passwordHash: await hashPassword(newPassword), sessionEpoch: { increment: 1 } },
  });
  return NextResponse.json({ ok: true });
}
