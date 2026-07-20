// 취약점 추이 — '이월(carry-forward)' 방식: 각 날짜의 값 = 그 시점까지 각 저장소의
// 마지막 성공 스캔을 합산한 '현재 상태'. 이렇게 하면 최신 점 = 목록 총계와 일치한다.
// repos=콤마목록(다중선택). 하위호환: repo=단일(all=전체).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseRepoSlugs } from "@/lib/codereview";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const days = Math.min(365, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86_400_000);
  const sinceDate = since.toISOString().slice(0, 10);
  const reposFilter = (req.nextUrl.searchParams.get("repos") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const single = req.nextUrl.searchParams.get("repo");
  let repoWhere: any;
  if (reposFilter.length) repoWhere = { repoSlug: { in: reposFilter } };
  else if (single && single !== "all") repoWhere = { repoSlug: single };
  else {
    // 필터 없음 = 현재 '설정된' 저장소만 (목록 총계와 동일 범위로 맞춤)
    const cfg = await prisma.sbomConfig.findUnique({ where: { id: "default" }, select: { repoSlugs: true } });
    repoWhere = { repoSlug: { in: parseRepoSlugs(cfg?.repoSlugs ?? "") } };
  }

  // 범위 밖(과거) 스캔도 이월 기준으로 필요하므로 날짜 하한 없이 가져온다.
  const scans = await prisma.sbomScan.findMany({
    where: { status: "ok", ...repoWhere },
    orderBy: { createdAt: "asc" },
    select: { repoSlug: true, critical: true, high: true, medium: true, low: true, createdAt: true },
  });
  if (scans.length === 0) return NextResponse.json({ series: [] });

  // 저장소 → (날짜 → 그 날 마지막 성공 스캔). asc 라 뒤가 앞을 덮어써 '그 날 마지막'만 남음.
  const byRepo = new Map<string, Map<string, (typeof scans)[number]>>();
  const datesInRange = new Set<string>();
  for (const s of scans) {
    const date = s.createdAt.toISOString().slice(0, 10);
    if (!byRepo.has(s.repoSlug)) byRepo.set(s.repoSlug, new Map());
    byRepo.get(s.repoSlug)!.set(date, s);
    if (date >= sinceDate) datesInRange.add(date);
  }
  // 저장소별 (날짜 오름차순) 배열
  const repoTimeline = new Map<string, { date: string; s: (typeof scans)[number] }[]>();
  for (const [repo, m] of byRepo) {
    repoTimeline.set(repo, [...m.entries()].map(([date, s]) => ({ date, s })).sort((a, b) => (a.date < b.date ? -1 : 1)));
  }

  const dates = [...datesInRange].sort();
  const series = dates.map((D) => {
    let critical = 0, high = 0, medium = 0, low = 0;
    for (const arr of repoTimeline.values()) {
      // D 이하 중 가장 늦은 성공 스캔(이월)
      let cur: (typeof scans)[number] | null = null;
      for (const item of arr) { if (item.date <= D) cur = item.s; else break; }
      if (cur) { critical += cur.critical; high += cur.high; medium += cur.medium; low += cur.low; }
    }
    return { date: D, critical, high, medium, low, total: critical + high + medium + low };
  });

  return NextResponse.json({ series });
}
