// workspace 접근 가능한 저장소 목록 (드롭다운 채우기용). 토큰 미입력 시 저장된 토큰 사용.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listRepos } from "@/lib/codereview";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const existing = await prisma.codeReviewConfig.findUnique({ where: { id: "default" } });
  const cfg = {
    workspace: (b.workspace ?? existing?.workspace ?? "").trim(),
    authUsername: (b.authUsername ?? existing?.authUsername ?? "").trim(),
    token: (typeof b.token === "string" && b.token.length > 0 ? b.token : existing?.token) ?? "",
  };
  return NextResponse.json(await listRepos(cfg));
}
