// SBOM 즉시 스캔 (수동 트리거). 오래 걸릴 수 있어 백그라운드로 실행하고 즉시 응답.
import { NextResponse } from "next/server";
import { runSbomScans } from "@/lib/sbom";
import { requireAdmin } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function POST() {
  const { error } = await requireAdmin();
  if (error) return error;
  // 대기하지 않고 백그라운드 실행 — 진행 결과는 목록 새로고침으로 확인
  runSbomScans().catch((e) => console.error("[sbom] manual run", e));
  return NextResponse.json({ started: true });
}
