// 관리자 STT(Whisper) 프록시 — 세션 인증(middleware) 적용. 워커 /stt/* 로 전달.
import { NextRequest } from "next/server";
import { proxyToWorker } from "@/lib/worker";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest, ctx: { params: { path: string[] } }) {
  const sub = "/stt/" + (ctx.params.path?.join("/") ?? "");
  return proxyToWorker(sub, req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
