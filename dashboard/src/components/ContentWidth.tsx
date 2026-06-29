"use client";
import { usePathname } from "next/navigation";

// 대부분 페이지는 가독성을 위해 max-w-6xl 로 폭 제한,
// 플레이그라운드처럼 넓은 작업영역이 필요한 페이지는 전체 너비 사용.
const FULL_WIDTH = ["/playground"];

export default function ContentWidth({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const full = FULL_WIDTH.some((p) => pathname === p || pathname.startsWith(p + "/"));
  // 전체 너비 페이지는 높이도 채워서 내부에서만 스크롤되게 함
  return <div className={full ? "h-full" : "mx-auto max-w-6xl"}>{children}</div>;
}
