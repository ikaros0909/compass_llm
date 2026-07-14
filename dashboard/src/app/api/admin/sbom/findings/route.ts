// 특정 저장소의 최신 취약점 상세(드릴다운).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const SEV_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo");
  if (!repo) return NextResponse.json({ error: "repo required" }, { status: 400 });
  const findings = await prisma.sbomFinding.findMany({ where: { repoSlug: repo }, take: 1000 });
  findings.sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  return NextResponse.json({
    findings: findings.map((f) => ({
      id: String(f.id), ecosystem: f.ecosystem, target: f.target, pkgName: f.pkgName,
      installedVersion: f.installedVersion, fixedVersion: f.fixedVersion,
      vulnId: f.vulnId, severity: f.severity, title: f.title, url: f.url,
    })),
  });
}
