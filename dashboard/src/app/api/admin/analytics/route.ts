// 요청 로그 기반 분석: 시계열 추세 + 모델별/엔드포인트별/키별 분해 + 에러.
// DB 종류(SQLite/Postgres)에 무관하도록 행을 가져와 JS 에서 버킷 집계.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const RANGES: Record<string, number> = {
  "1h": 3600_000,
  "6h": 6 * 3600_000,
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
};
// 범위별 버킷 크기 (대략 30~60 포인트)
const BUCKETS: Record<string, number> = {
  "1h": 2 * 60_000,
  "6h": 10 * 60_000,
  "24h": 30 * 60_000,
  "7d": 3 * 3600_000,
};

export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get("range") ?? "24h";
  const ms = RANGES[range] ?? RANGES["24h"];
  const bucketMs = BUCKETS[range] ?? BUCKETS["24h"];
  const now = Date.now();
  const since = new Date(now - ms);

  const [logs, keys] = await Promise.all([
    prisma.requestLog.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, model: true, endpoint: true, status: true, latencyMs: true, outputTokens: true, apiKeyId: true },
      orderBy: { createdAt: "asc" },
      take: 50_000,
    }),
    prisma.apiKey.findMany({ select: { id: true, name: true } }),
  ]);
  const keyName = new Map(keys.map((k) => [k.id, k.name]));

  // ── 시계열 버킷 ──
  const nBuckets = Math.ceil(ms / bucketMs);
  const base = Math.floor(now / bucketMs) * bucketMs - (nBuckets - 1) * bucketMs;
  const series = Array.from({ length: nBuckets }, (_, i) => ({
    t: new Date(base + i * bucketMs).toISOString(),
    requests: 0, tokens: 0, errors: 0, _latSum: 0,
  }));
  for (const l of logs) {
    const idx = Math.floor((l.createdAt.getTime() - base) / bucketMs);
    if (idx < 0 || idx >= nBuckets) continue;
    const b = series[idx];
    b.requests++; b.tokens += l.outputTokens; b._latSum += l.latencyMs;
    if (l.status >= 400) b.errors++;
  }
  const timeseries = series.map(({ _latSum, requests, ...b }) => ({
    ...b, requests, avgLatency: requests ? Math.round(_latSum / requests) : 0,
  }));

  // ── 분해 집계 ──
  const acc = <T extends string>(map: Map<T, { count: number; tokens: number; latSum: number }>, key: T, l: typeof logs[number]) => {
    const e = map.get(key) ?? { count: 0, tokens: 0, latSum: 0 };
    e.count++; e.tokens += l.outputTokens; e.latSum += l.latencyMs;
    map.set(key, e);
  };
  const byModelMap = new Map<string, any>(), byEpMap = new Map<string, any>(), byKeyMap = new Map<string, any>();
  const errStatus = new Map<number, number>();
  for (const l of logs) {
    acc(byModelMap, l.model ?? "(미지정)", l);
    acc(byEpMap, l.endpoint, l);
    acc(byKeyMap, l.apiKeyId ?? "__playground__", l);
    if (l.status >= 400) errStatus.set(l.status, (errStatus.get(l.status) ?? 0) + 1);
  }
  const toArr = (m: Map<string, any>) => [...m.entries()].map(([k, v]) => ({
    name: k, count: v.count, tokens: v.tokens, avgLatency: Math.round(v.latSum / v.count),
  })).sort((a, b) => b.count - a.count);

  const byModel = toArr(byModelMap).slice(0, 8);
  const byEndpoint = toArr(byEpMap).slice(0, 8);
  const topKeys = toArr(byKeyMap).slice(0, 8).map((k) => ({
    ...k, name: k.name === "__playground__" ? "플레이그라운드(관리자)" : (keyName.get(k.name) ?? k.name),
  }));

  const recentErrors = logs.filter((l) => l.status >= 400).slice(-10).reverse().map((l) => ({
    at: l.createdAt.toISOString(), endpoint: l.endpoint, model: l.model, status: l.status,
  }));

  return NextResponse.json({
    range,
    total: logs.length,
    timeseries,
    byModel,
    byEndpoint,
    topKeys,
    errorBreakdown: [...errStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    recentErrors,
  });
}
