import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const RANGES: Record<string, number> = {
  "1h": 3600_000,
  "6h": 6 * 3600_000,
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
};

export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get("range") ?? "1h";
  const ms = RANGES[range] ?? RANGES["1h"];
  const since = new Date(Date.now() - ms);

  const samples = await prisma.metricSample.findMany({
    where: { createdAt: { gte: since }, gpuIndex: 0 },
    orderBy: { createdAt: "asc" },
    take: 2000,
  });

  return NextResponse.json({
    range,
    samples: samples.map((s) => ({
      t: s.createdAt.toISOString(),
      utilization: s.utilization,
      memPct: s.memTotalMb ? Math.round((s.memUsedMb / s.memTotalMb) * 100) : 0,
      tempC: s.tempC,
      powerW: s.powerW,
    })),
  });
}
