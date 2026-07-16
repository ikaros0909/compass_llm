// 코드리뷰 추이 — 날짜별 리뷰 수(게시)·자동승인·재검토권장·오류 집계.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const days = Math.min(365, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86_400_000);
  const authorsFilter = (req.nextUrl.searchParams.get("authors") || "").split(",").map((s) => s.trim()).filter(Boolean);

  const logs = await prisma.codeReviewLog.findMany({
    where: { createdAt: { gte: since } },
    select: { status: true, approval: true, needsReview: true, prAuthor: true, createdAt: true },
  });

  // 기간 내 전체 요청자(필터 옵션) — 필터와 무관하게 제공
  const allAuthors = Array.from(new Set(logs.map((l) => l.prAuthor).filter(Boolean))).sort();
  const filtered = authorsFilter.length ? logs.filter((l) => authorsFilter.includes(l.prAuthor)) : logs;

  const byDate = new Map<string, { reviews: number; approved: number; needsReview: number; errors: number }>();
  for (const l of filtered) {
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

  return NextResponse.json({ series, allAuthors });
}
