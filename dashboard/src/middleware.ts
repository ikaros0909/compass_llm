// 관리자 화면/관리 API 보호 + 공개 API 의 헤더 존재 가드.
// (키 유효성·Rate limit 의 실제 검증은 각 /api/v1 route 에서 수행 — DB 접근이 필요해서)
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret");

async function hasValidSession(req: NextRequest) {
  const token = req.cookies.get("compass_session")?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 공개 API: 인증/Rate limit 은 route handler 에서. 여기선 통과.
  if (pathname.startsWith("/api/v1")) return NextResponse.next();

  // 관리 API: 세션 필수
  if (pathname.startsWith("/api/admin")) {
    if (pathname.startsWith("/api/admin/auth")) return NextResponse.next();
    if (await hasValidSession(req)) return NextResponse.next();
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 관리 UI: 미인증이면 /login 으로
  const isProtectedPage =
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/_next") &&
    !pathname.startsWith("/favicon");
  if (isProtectedPage && !(await hasValidSession(req))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
