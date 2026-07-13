// 코드리뷰 설정 조회/저장 (세션 인증). token 은 절대 클라이언트로 반환하지 않는다.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/codereview";
import { requireAdmin } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await prisma.codeReviewConfig.findUnique({ where: { id: "default" } });
  const logs = await prisma.codeReviewLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  return NextResponse.json({
    config: {
      workspace: cfg?.workspace || "jinhaksa",
      repoSlugs: (cfg?.repoSlugs ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      authUsername: cfg?.authUsername ?? "",
      tokenSet: !!cfg?.token,
      model: cfg?.model ?? "",
      intervalMin: cfg?.intervalMin ?? 10,
      enabled: cfg?.enabled ?? false,
      autoApprove: cfg?.autoApprove ?? false,
      systemPrompt: cfg?.systemPrompt ?? "",
      defaultPrompt: DEFAULT_SYSTEM_PROMPT,
    },
    logs: logs.map((l) => ({
      id: String(l.id), repoSlug: l.repoSlug, prId: l.prId, prTitle: l.prTitle, prAuthor: l.prAuthor, headCommit: l.headCommit,
      status: l.status, approval: l.approval, message: l.message, at: l.createdAt,
      qualityScore: l.qualityScore, riskLevel: l.riskLevel, confidence: l.confidence, needsReview: l.needsReview,
      filesChanged: l.filesChanged, linesChanged: l.linesChanged,
      reviewReasons: (() => { try { return JSON.parse(l.reviewReasons || "[]"); } catch { return []; } })(),
      advisories: (() => { try { return JSON.parse(l.advisories || "[]"); } catch { return []; } })(),
    })),
  });
}

export async function PUT(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const b = await req.json();
  const existing = await prisma.codeReviewConfig.findUnique({ where: { id: "default" } });
  // token 은 값이 넘어온 경우에만 갱신 (빈 값이면 기존 유지)
  const token = typeof b.token === "string" && b.token.length > 0 ? b.token : existing?.token ?? "";
  const repoSlugs = Array.isArray(b.repoSlugs)
    ? b.repoSlugs.map((s: string) => String(s).trim()).filter(Boolean).join(",")
    : (b.repoSlugs ?? "").trim();
  const data = {
    workspace: (b.workspace ?? "").trim(),
    repoSlugs,
    authUsername: (b.authUsername ?? "").trim(),
    token,
    model: (b.model ?? "").trim(),
    intervalMin: Math.max(1, Number(b.intervalMin) || 10),
    enabled: !!b.enabled,
    autoApprove: !!b.autoApprove,
    systemPrompt: (b.systemPrompt ?? "").trim(),
  };
  await prisma.codeReviewConfig.upsert({
    where: { id: "default" },
    create: { id: "default", ...data },
    update: data,
  });
  return NextResponse.json({ ok: true });
}
