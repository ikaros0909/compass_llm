// 관리자 STT(Whisper) 프록시 — 세션 인증(middleware) 적용. 워커 /stt/* 로 전달.
import { NextRequest } from "next/server";
import { proxyToWorker } from "@/lib/worker";
import { requireAdmin } from "@/lib/authz";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest, ctx: { params: { path: string[] } }) {
  // 조회(GET)는 viewer 도 허용, 변경(다운로드/삭제)은 admin 전용.
  if (req.method !== "GET") {
    const { error } = await requireAdmin();
    if (error) return error;
  }
  const sub = "/stt/" + (ctx.params.path?.join("/") ?? "");
  return proxyToWorker(sub, req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
