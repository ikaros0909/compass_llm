import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateKey } from "@/lib/apiKeys";
import { requireAdmin } from "@/lib/authz";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const keys = await prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } });
  // 키별 최근 24h 사용량
  const since = new Date(Date.now() - 24 * 3600_000);
  const usage = await prisma.requestLog.groupBy({
    by: ["apiKeyId"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  const usageMap = new Map(usage.map((u) => [u.apiKeyId, u._count._all]));
  return NextResponse.json({
    keys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      apiKey: k.apiKey,
      isActive: k.isActive,
      rateLimit: k.rateLimit,
      createdAt: k.createdAt,
      usage24h: usageMap.get(k.id) ?? 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;
  const { name, rateLimit } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  // secretKey 는 이 응답에서 단 1회만 노출
  const created = await generateKey(name.trim(), rateLimit ?? 30);
  audit("apikey.create", { by: session!.email, name: name.trim(), rateLimit: rateLimit ?? 30 });
  return NextResponse.json(created);
}

export async function PATCH(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { id, isActive, rateLimit } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.apiKey.update({
    where: { id },
    data: {
      ...(isActive !== undefined ? { isActive } : {}),
      ...(rateLimit !== undefined ? { rateLimit } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.apiKey.delete({ where: { id } });
  audit("apikey.delete", { by: session!.email, keyId: id });
  return NextResponse.json({ ok: true });
}
