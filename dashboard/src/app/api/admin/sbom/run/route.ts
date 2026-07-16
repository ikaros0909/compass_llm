// SBOM 즉시 스캔 (수동 트리거). 오래 걸릴 수 있어 백그라운드로 실행하고 즉시 응답.
// body 의 { repo } 를 주면 그 저장소 하나만, 없으면 전체 스캔.
import { NextRequest, NextResponse } from "next/server";
import { runSbomScans } from "@/lib/sbom";
import { requireAdmin } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { repo } = await req.json().catch(() => ({}));
  // 대기하지 않고 백그라운드 실행 — 진행 결과는 목록 새로고침으로 확인
  runSbomScans(typeof repo === "string" && repo ? repo : undefined).catch((e) => console.error("[sbom] manual run", e));
  return NextResponse.json({ started: true, repo: repo ?? null });
}
