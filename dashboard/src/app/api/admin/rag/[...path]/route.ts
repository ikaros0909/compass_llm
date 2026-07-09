// 관리자 RAG 프록시 — 세션 인증(middleware)이 적용된 경로.
// 대시보드 RAG 페이지가 호출. 워커의 /rag/* 로 그대로 전달(멀티파트 업로드 포함).
import { NextRequest } from "next/server";
import { proxyToWorker } from "@/lib/worker";
import { requireAdmin } from "@/lib/authz";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest, ctx: { params: { path: string[] } }) {
  // 조회(GET)는 viewer 도 허용, 변경(업로드/삭제)은 admin 전용.
  if (req.method !== "GET") {
    const { error } = await requireAdmin();
    if (error) return error;
  }
  const sub = "/rag/" + (ctx.params.path?.join("/") ?? "");
  return proxyToWorker(sub, req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
