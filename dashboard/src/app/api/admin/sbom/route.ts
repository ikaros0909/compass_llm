// SBOM 설정 조회/저장 + 저장소별 최신 스캔 현황. token 은 클라이언트로 반환하지 않는다.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseRepoSlugs } from "@/lib/codereview";
import { requireAdmin } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await prisma.sbomConfig.findUnique({ where: { id: "default" } });
  const cr = await prisma.codeReviewConfig.findUnique({ where: { id: "default" } });
  const repos = parseRepoSlugs(cfg?.repoSlugs ?? "");

  // 저장소별 최신 스캔 1건
  const scans = await prisma.sbomScan.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  const latest = new Map<string, (typeof scans)[number]>();
  for (const s of scans) if (!latest.has(s.repoSlug)) latest.set(s.repoSlug, s);

  const rows = repos.map((repoSlug) => {
    const s = latest.get(repoSlug);
    if (!s) return { repoSlug, status: "none" as const };
    return {
      repoSlug, status: s.status, commit: s.commit,
      critical: s.critical, high: s.high, medium: s.medium, low: s.low, unknown: s.unknown, total: s.total,
      at: s.createdAt, message: s.message,
    };
  });

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
