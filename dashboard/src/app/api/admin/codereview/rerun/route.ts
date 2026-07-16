// 특정 PR 만 수동 재리뷰 (관리자). 기존 코멘트 삭제 + 승인 취소 + 재리뷰.
import { NextRequest, NextResponse } from "next/server";
import { rerunReview } from "@/lib/codereview";
import { requireAdmin } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    const { repoSlug, prId } = await req.json().catch(() => ({}));
    if (!repoSlug || prId == null) return NextResponse.json({ ok: false, message: "repoSlug·prId 가 필요합니다." }, { status: 400 });
    const res = await rerunReview(String(repoSlug), Number(prId));
    return NextResponse.json(res);
  } catch (e: any) {
    // 어떤 예외든 JSON 으로 원인을 돌려줘 UI 가 '빈 실패' 로 끝나지 않게 한다.
    console.error("[codereview] rerun route error", e);
    return NextResponse.json({ ok: false, message: `서버 오류: ${e?.message ?? String(e)}` });
  }
}
