// 관리 라우트 공용 권한 가드. 미들웨어는 세션 '유효성'만 확인하므로,
// 상태를 변경하는 관리 작업은 반드시 이 헬퍼로 admin 역할을 재확인한다.
// (viewer 는 조회만 가능 — 최소 권한 원칙)
import { NextResponse } from "next/server";
import { getSession, type Session } from "./auth";

type Ok = { session: Session; error?: undefined };
type Err = { session?: undefined; error: NextResponse };

export async function requireAdmin(): Promise<Ok | Err> {
  const s = await getSession();
  if (!s) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (s.role !== "admin") {
    return { error: NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 }) };
  }
  return { session: s };
}
