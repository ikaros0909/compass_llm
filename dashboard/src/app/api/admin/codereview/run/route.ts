// 코드리뷰 즉시 실행 (수동 트리거). 폴러와 동일 로직.
import { NextResponse } from "next/server";
import { runReview } from "@/lib/codereview";
import { requireAdmin } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const { error } = await requireAdmin();
  if (error) return error;
  const res = await runReview();
  return NextResponse.json(res);
}
