import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runningModels, listModels } from "@/lib/ollama";
import { readLocalGpus } from "@/lib/localGpu";

export const dynamic = "force-dynamic";

const FRESH_MS = 30_000; // 워커 샘플이 이보다 오래되면 nvidia-smi 폴백

export async function GET() {
  const since = new Date(Date.now() - 60_000);
  const [latest, running, models, reqCount, errCount, agg] = await Promise.all([
    prisma.metricSample.findMany({
      orderBy: { createdAt: "desc" },
      take: 8, // 멀티 GPU 대비 최근 샘플들
    }),
    runningModels().catch(() => []),
    listModels().catch(() => []),
    prisma.requestLog.count({ where: { createdAt: { gte: since } } }),
    prisma.requestLog.count({
      where: { createdAt: { gte: since }, status: { gte: 400 } },
    }),
    prisma.requestLog.aggregate({
      where: { createdAt: { gte: since } },
      _avg: { latencyMs: true },
      _sum: { outputTokens: true },
    }),
  ]);

  // gpuIndex 별 최신 1개만
  const byGpu = new Map<number, (typeof latest)[number]>();
  for (const s of latest) if (!byGpu.has(s.gpuIndex)) byGpu.set(s.gpuIndex, s);

  // 워커 샘플이 신선하면 그것을, 없거나 오래됐으면 nvidia-smi 직접 읽기(로컬 폴백)
  const fresh = latest[0] && Date.now() - new Date(latest[0].createdAt).getTime() < FRESH_MS;
  let gpus = [...byGpu.values()].map((g) => ({
    index: g.gpuIndex,
    utilization: g.utilization,
    memUsedMb: g.memUsedMb,
    memTotalMb: g.memTotalMb,
    tempC: g.tempC,
    powerW: g.powerW,
  }));
  if (!fresh) {
    const local = await readLocalGpus();
    if (local.length) gpus = local;
  }

  return NextResponse.json({
    gpus,
    loadedModel: running[0]?.name ?? null,
    modelCount: models.length,
    requestsPerMin: reqCount,
    errorsPerMin: errCount,
    avgLatencyMs: Math.round(agg._avg.latencyMs ?? 0),
    tokensPerMin: agg._sum.outputTokens ?? 0,
  });
}
