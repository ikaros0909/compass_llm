// 관리자 RAG 프록시 — 세션 인증(middleware)이 적용된 경로.
// 대시보드 RAG 페이지가 호출. 워커의 /rag/* 로 그대로 전달(멀티파트 업로드 포함).
import { NextRequest } from "next/server";
import { proxyToWorker } from "@/lib/worker";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest, ctx: { params: { path: string[] } }) {
  const sub = "/rag/" + (ctx.params.path?.join("/") ?? "");
  return proxyToWorker(sub, req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
