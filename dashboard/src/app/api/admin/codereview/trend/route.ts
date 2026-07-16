// 코드리뷰 추이 — 날짜별 리뷰 수(게시)·자동승인·재검토권장·오류 집계.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const days = Math.min(365, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86_400_000);

  const logs = await prisma.codeReviewLog.findMany({
    where: { createdAt: { gte: since } },
    select: { status: true, approval: true, needsReview: true, createdAt: true },
  });

  const byDate = new Map<string, { reviews: number; approved: number; needsReview: number; errors: number }>();
  for (const l of logs) {
    const date = l.createdAt.toISOString().slice(0, 10);
    const g = byDate.get(date) ?? { reviews: 0, approved: 0, needsReview: 0, errors: 0 };
    if (l.status === "posted") {
      g.reviews++;
      if (l.approval === "approved") g.approved++;
      if (l.needsReview) g.needsReview++;
    } else if (l.status === "error") {
      g.errors++;
    }
    byDate.set(date, g);
  }

  const series = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, g]) => ({ date, ...g }));

  return NextResponse.json({ series });
}
