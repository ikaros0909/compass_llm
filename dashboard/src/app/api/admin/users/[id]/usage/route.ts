// 계정 상세 — 발행 API 키 목록 + 일별 토큰 사용량(기본 30일).
// 일 경계는 KST(Asia/Seoul) 기준으로 집계한다.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requireAdmin();
  if (error) return error;

  const user = await prisma.adminUser.findUnique({ where: { id: params.id } });
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 30)));
  const since = new Date(Date.now() - days * 24 * 3600_000);

  // 이 계정이 발행한 키
  const keys = await prisma.apiKey.findMany({
    where: { createdById: params.id },
    select: { id: true, name: true, apiKey: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const keyIds = keys.map((k) => k.id);

  if (keyIds.length === 0) {
    return NextResponse.json({
      user: { id: user.id, email: user.email, role: user.role },
      days, keys: [], daily: [],
    });
  }

  // 키별 30일 집계
  const perKey = await prisma.requestLog.groupBy({
    by: ["apiKeyId"],
    where: { apiKeyId: { in: keyIds }, createdAt: { gte: since } },
    _sum: { inputTokens: true, outputTokens: true },
    _count: { _all: true },
  });
  const perKeyMap = new Map(perKey.map((p) => [p.apiKeyId, p]));

  // 일별 집계 (KST 기준 날짜로 버킷)
  const rows = await prisma.$queryRaw<
    { day: string; requests: number; input: bigint; output: bigint }[]
  >`
    SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS requests,
           COALESCE(SUM("inputTokens"), 0)::bigint AS input,
           COALESCE(SUM("outputTokens"), 0)::bigint AS output
    FROM "RequestLog"
    WHERE "apiKeyId" IN (${Prisma.join(keyIds)}) AND "createdAt" >= ${since}
    GROUP BY day
    ORDER BY day DESC
  `;

  return NextResponse.json({
    user: { id: user.id, email: user.email, role: user.role },
    days,
    keys: keys.map((k) => {
      const p = perKeyMap.get(k.id);
      return {
        id: k.id, name: k.name, apiKey: k.apiKey, isActive: k.isActive, createdAt: k.createdAt,
        requests: p?._count._all ?? 0,
        tokens: (p?._sum.inputTokens ?? 0) + (p?._sum.outputTokens ?? 0),
      };
    }),
    daily: rows.map((r) => ({
      day: r.day,
      requests: r.requests,
      input: Number(r.input),
      output: Number(r.output),
      total: Number(r.input) + Number(r.output),
    })),
  });
}
