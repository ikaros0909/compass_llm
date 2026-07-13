"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Boxes, KeyRound, Library, ScrollText, MessagesSquare,
  Users, LogOut, Compass, PanelLeftClose, PanelLeftOpen, GitPullRequest, Menu, X,
} from "lucide-react";

const NAV = [
  { href: "/", label: "개요", icon: LayoutDashboard },
  { href: "/models", label: "모델 관리", icon: Boxes },
  { href: "/api-keys", label: "API 키", icon: KeyRound },
  { href: "/rag", label: "RAG", icon: Library },
  { href: "/logs", label: "로그", icon: ScrollText },
  { href: "/playground", label: "플레이그라운드", icon: MessagesSquare },
  { href: "/codereview", label: "코드리뷰", icon: GitPullRequest },
  { href: "/accounts", label: "계정 관리", icon: Users },
];

const LS_KEY = "compass.sidebar.collapsed";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false); // 데스크톱 접기
  const [mobileOpen, setMobileOpen] = useState(false); // 모바일 드로어

  useEffect(() => {
    setCollapsed(localStorage.getItem(LS_KEY) === "1");
  }, []);
  // 경로 이동 시 모바일 드로어 자동 닫기
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(LS_KEY, next ? "1" : "0");
      return next;
    });
  }

  async function logout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.push("/login");
  }

  // 라벨 숨김: 데스크톱 접힘일 때만(lg). 모바일 드로어에선 항상 표시.
  const labelHidden = collapsed ? "lg:hidden" : "";

  return (
    <>
      {/* 모바일 상단바 (lg 미만) */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-30 h-14 flex items-center gap-3 px-4 border-b border-border bg-surface/90 backdrop-blur-sm">
        <button onClick={() => setMobileOpen(true)} className="text-muted hover:text-white p-1 -ml-1" aria-label="메뉴 열기">
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          <div className="grid place-items-center w-8 h-8 rounded-lg bg-accent/15 ring-1 ring-accent/30">
            <Compass className="w-[18px] h-[18px] text-accent-2" />
          </div>
          <span className="font-semibold">Compass LLM</span>
        </div>
      </header>

      {/* 모바일 백드롭 */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setMobileOpen(false)} />
      )}

      {/* 사이드바: 데스크톱은 in-flow, 모바일은 좌측 드로어 */}
      <aside
        className={[
          "fixed lg:static inset-y-0 left-0 z-50 shrink-0 flex flex-col w-64",
          "border-r border-border bg-surface/95 lg:bg-surface/60 backdrop-blur-sm",
          "transition-transform lg:transition-[width] duration-200 ease-out",
          collapsed ? "lg:w-[68px]" : "lg:w-60",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        ].join(" ")}
      >
        {/* 헤더: 로고 + 접기/닫기 */}
        <div className={`flex items-center h-16 border-b border-border gap-2.5 px-5 ${collapsed ? "lg:justify-center lg:px-2" : ""}`}>
          <div className="grid place-items-center w-9 h-9 rounded-xl bg-accent/15 ring-1 ring-accent/30 shrink-0">
            <Compass className="w-5 h-5 text-accent-2" />
          </div>
          <div className={`flex-1 min-w-0 ${labelHidden}`}>
            <div className="font-semibold leading-tight truncate">Compass LLM</div>
            <div className="text-[11px] text-faint leading-tight">운영 콘솔</div>
          </div>
          {/* 데스크톱 접기 버튼 (펼쳐진 상태에서만) */}
          <button onClick={toggle} className={`hidden text-faint hover:text-gray-200 transition shrink-0 ${collapsed ? "" : "lg:block"}`} title="메뉴 접기">
            <PanelLeftClose className="w-5 h-5" />
          </button>
          {/* 모바일 닫기 버튼 */}
          <button onClick={() => setMobileOpen(false)} className="lg:hidden text-faint hover:text-gray-200 shrink-0" aria-label="메뉴 닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 데스크톱 접힘 상태 펼치기 버튼 */}
        {collapsed && (
          <button onClick={toggle} className="hidden lg:flex nav-link justify-center mx-2 mt-2" title="메뉴 펼치기">
            <PanelLeftOpen className="w-[18px] h-[18px]" />
          </button>
        )}

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                title={collapsed ? n.label : undefined}
                className={`nav-link ${active ? "active" : ""} ${collapsed ? "lg:justify-center lg:!px-0" : ""}`}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                <span className={labelHidden}>{n.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border">
          <button
            className={`nav-link w-full ${collapsed ? "lg:justify-center lg:!px-0" : ""}`}
            title={collapsed ? "로그아웃" : undefined}
            onClick={logout}
          >
            <LogOut className="w-[18px] h-[18px] shrink-0" />
            <span className={labelHidden}>로그아웃</span>
          </button>
        </div>
      </aside>
    </>
  );
}
