// SBOM 설정 조회/저장 + 저장소별 최신 스캔 현황. token 은 클라이언트로 반환하지 않는다.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseRepoSlugs } from "@/lib/codereview";
import { requireAdmin } from "@/lib/authz";
import { scanProgress } from "@/lib/sbom";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await prisma.sbomConfig.findUnique({ where: { id: "default" } });
  const cr = await prisma.codeReviewConfig.findUnique({ where: { id: "default" } });
  const repos = parseRepoSlugs(cfg?.repoSlugs ?? "");

  // 설정된 저장소들의 스캔만 (take 제한 없이 — 최신 누락 방지). repo 별로:
  //  - latestOk: 마지막 '성공' 스캔(현재 취약점 수치의 근거)
  //  - latest:   가장 최근 스캔(최근 시도가 실패했는지 표시용)
  const scans = repos.length
    ? await prisma.sbomScan.findMany({ where: { repoSlug: { in: repos } }, orderBy: { createdAt: "desc" } })
    : [];
  const latest = new Map<string, (typeof scans)[number]>();
  const latestOk = new Map<string, (typeof scans)[number]>();
  for (const s of scans) {
    if (!latest.has(s.repoSlug)) latest.set(s.repoSlug, s);
    if (s.status === "ok" && !latestOk.has(s.repoSlug)) latestOk.set(s.repoSlug, s);
  }

  const rows = repos.map((repoSlug) => {
    const ok = latestOk.get(repoSlug);
    const lt = latest.get(repoSlug);
    if (!ok) {
      // 성공 이력이 아직 없음: 시도했으면 오류, 아니면 미스캔
      if (lt) return { repoSlug, status: "error" as const, message: lt.message, at: lt.createdAt };
      return { repoSlug, status: "none" as const };
    }
    return {
      repoSlug, status: "ok" as const, commit: ok.commit, branch: ok.branch,
      critical: ok.critical, high: ok.high, medium: ok.medium, low: ok.low, unknown: ok.unknown, total: ok.total,
      at: ok.createdAt,
      lastError: lt?.status === "error", // 최근 시도가 실패(직전 성공 수치를 표시 중)
      message: lt?.status === "error" ? lt.message : "",
    };
  });

  // 총계 — 성공 스캔이 있는 저장소들의 합
  const agg = rows.reduce(
    (a, r: any) => r.status === "ok"
      ? { critical: a.critical + r.critical, high: a.high + r.high, medium: a.medium + r.medium, low: a.low + r.low, scanned: a.scanned + 1 }
      : a,
    { critical: 0, high: 0, medium: 0, low: 0, scanned: 0 },
  );

  const usingCrCreds = !cfg?.token && !!cr?.token;
  return NextResponse.json({
    config: {
      workspace: cfg?.workspace || cr?.workspace || "",
      repoSlugs: repos,
      authUsername: cfg?.authUsername ?? "",
      tokenSet: !!cfg?.token,
      usingCodeReviewCreds: usingCrCreds,
      scanHour: cfg?.scanHour ?? 3,
      enabled: cfg?.enabled ?? false,
    },
    repos: rows,
    totals: agg,
    scanning: scanProgress(),
  });
}

export async function PUT(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const b = await req.json();
  const existing = await prisma.sbomConfig.findUnique({ where: { id: "default" } });
  const token = typeof b.token === "string" && b.token.length > 0 ? b.token : existing?.token ?? "";
  const repoSlugs = Array.isArray(b.repoSlugs)
    ? b.repoSlugs.map((s: string) => String(s).trim()).filter(Boolean).join(",")
    : (b.repoSlugs ?? "").trim();
  const data = {
    workspace: (b.workspace ?? "").trim(),
    repoSlugs,
    authUsername: (b.authUsername ?? "").trim(),
    token,
    scanHour: Math.min(23, Math.max(0, Number(b.scanHour) || 0)),
    enabled: !!b.enabled,
  };
  await prisma.sbomConfig.upsert({
    where: { id: "default" },
    create: { id: "default", ...data },
    update: data,
  });
  return NextResponse.json({ ok: true });
}
