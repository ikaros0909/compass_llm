import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const model = sp.get("model") ?? undefined;
  const minStatus = sp.get("minStatus");
  const take = Math.min(Number(sp.get("take") ?? 100), 500);

  const logs = await prisma.requestLog.findMany({
    where: {
      ...(model ? { model } : {}),
      ...(minStatus ? { status: { gte: Number(minStatus) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
    include: { apiKey: { select: { name: true } } },
  });

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: String(l.id),
      at: l.createdAt.toISOString(),
      endpoint: l.endpoint,
      model: l.model,
      status: l.status,
      latencyMs: l.latencyMs,
      tokens: l.inputTokens + l.outputTokens,
      keyName: l.apiKey?.name ?? null,
      ip: l.clientIp,
    })),
  });
}
