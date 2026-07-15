// 취약점 추이 — 날짜별 심각도 집계. 하루에 여러 번 스캔되면 그 날의 마지막 스캔 기준.
// repo=all 이면 전체 저장소 합계, 특정 repo 면 해당 저장소만.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo") || "all";
  const days = Math.min(365, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86_400_000);

  const scans = await prisma.sbomScan.findMany({
    where: { createdAt: { gte: since }, status: "ok", ...(repo !== "all" ? { repoSlug: repo } : {}) },
    orderBy: { createdAt: "asc" },
    select: { repoSlug: true, critical: true, high: true, medium: true, low: true, total: true, createdAt: true },
  });

  // 날짜 → (저장소 → 그 날의 마지막 스캔). 이후 스캔이 앞의 것을 덮어써 '마지막'만 남음.
  const byDate = new Map<string, Map<string, (typeof scans)[number]>>();
  for (const s of scans) {
    const date = s.createdAt.toISOString().slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, new Map());
    byDate.get(date)!.set(s.repoSlug, s);
  }

  const series = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, repos]) => {
      let critical = 0, high = 0, medium = 0, low = 0, total = 0;
      for (const s of repos.values()) { critical += s.critical; high += s.high; medium += s.medium; low += s.low; total += s.total; }
      return { date, critical, high, medium, low, total };
    });

  return NextResponse.json({ series });
}
