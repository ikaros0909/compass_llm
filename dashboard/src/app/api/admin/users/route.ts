// 관리자 계정 관리 (admin 역할만 접근). viewer 는 조회/변경 불가.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const ROLES = ["admin", "viewer"];

async function requireAdmin() {
  const s = await getSession();
  if (!s) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (s.role !== "admin") return { error: NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 }) };
  return { session: s };
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  const users = await prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } });

  // 계정별 사용량: 계정이 발행한 API 키들 → 최근 30일 RequestLog 토큰/요청 집계.
  const keys = await prisma.apiKey.findMany({ select: { id: true, createdById: true } });
  const keyOwner = new Map(keys.map((k) => [k.id, k.createdById]));
  const keyCount = new Map<string, number>();
  for (const k of keys) if (k.createdById) keyCount.set(k.createdById, (keyCount.get(k.createdById) ?? 0) + 1);

  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const usage = await prisma.requestLog.groupBy({
    by: ["apiKeyId"],
    where: { createdAt: { gte: since }, apiKeyId: { not: null } },
    _sum: { inputTokens: true, outputTokens: true },
    _count: { _all: true },
  });
  // 키 사용량을 발행 계정으로 롤업
  const acc = new Map<string, { tokens: number; requests: number }>();
  for (const u of usage) {
    const owner = u.apiKeyId ? keyOwner.get(u.apiKeyId) : null;
    if (!owner) continue; // 발행자 미기록(기존 키)·삭제된 키는 계정 집계에서 제외
    const cur = acc.get(owner) ?? { tokens: 0, requests: 0 };
    cur.tokens += (u._sum.inputTokens ?? 0) + (u._sum.outputTokens ?? 0);
    cur.requests += u._count._all;
    acc.set(owner, cur);
  }

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id, email: u.email, role: u.role, createdAt: u.createdAt,
      keyCount: keyCount.get(u.id) ?? 0,
      tokens30d: acc.get(u.id)?.tokens ?? 0,
      requests30d: acc.get(u.id)?.requests ?? 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;
  const { email, password, role } = await req.json();
  if (!email?.trim() || !password) return NextResponse.json({ error: "이메일과 비밀번호를 입력하세요." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
  if (role && !ROLES.includes(role)) return NextResponse.json({ error: "역할이 올바르지 않습니다." }, { status: 400 });

  const exists = await prisma.adminUser.findUnique({ where: { email: email.trim() } });
  if (exists) return NextResponse.json({ error: "이미 존재하는 이메일입니다." }, { status: 409 });

  const user = await prisma.adminUser.create({
    data: { email: email.trim(), passwordHash: await hashPassword(password), role: role ?? "viewer" },
  });
  audit("user.create", { by: session!.email, targetId: user.id, email: user.email, role: user.role });
  return NextResponse.json({ id: user.id, email: user.email, role: user.role });
}

// 역할 변경 또는 비밀번호 초기화
export async function PATCH(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;
  const { id, role, password } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const target = await prisma.adminUser.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "user not found" }, { status: 404 });

  // 마지막 admin 을 viewer 로 강등 방지 (셀프 잠금 방지)
  if (role && role !== "admin" && target.role === "admin") {
    const adminCount = await prisma.adminUser.count({ where: { role: "admin" } });
    if (adminCount <= 1) return NextResponse.json({ error: "마지막 관리자는 강등할 수 없습니다." }, { status: 400 });
  }
  if (role && !ROLES.includes(role)) return NextResponse.json({ error: "역할이 올바르지 않습니다." }, { status: 400 });
  if (password !== undefined && password.length < 8) return NextResponse.json({ error: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });

  await prisma.adminUser.update({
    where: { id },
    data: {
      ...(role ? { role } : {}),
      ...(password ? { passwordHash: await hashPassword(password) } : {}),
      // 역할·비밀번호 변경 시 대상 사용자의 기존 세션을 무효화(재로그인 강제).
      ...(role || password ? { sessionEpoch: { increment: 1 } } : {}),
    },
  });
  audit("user.update", { by: session!.email, targetId: id, ...(role ? { role } : {}), passwordReset: !!password });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (id === session!.sub) return NextResponse.json({ error: "본인 계정은 삭제할 수 없습니다." }, { status: 400 });

  const target = await prisma.adminUser.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "user not found" }, { status: 404 });
  if (target.role === "admin") {
    const adminCount = await prisma.adminUser.count({ where: { role: "admin" } });
    if (adminCount <= 1) return NextResponse.json({ error: "마지막 관리자는 삭제할 수 없습니다." }, { status: 400 });
  }
  await prisma.adminUser.delete({ where: { id } });
  audit("user.delete", { by: session!.email, targetId: id, email: target.email });
  return NextResponse.json({ ok: true });
}
