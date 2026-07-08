"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Boxes, KeyRound, Library, ScrollText, MessagesSquare,
  Users, LogOut, Compass, PanelLeftClose, PanelLeftOpen, GitPullRequest,
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
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(LS_KEY) === "1");
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(LS_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <aside
      className={`${collapsed ? "w-[68px]" : "w-60"} shrink-0 border-r border-border bg-surface/60 backdrop-blur-sm flex flex-col transition-[width] duration-200 ease-out`}
    >
      {/* 헤더: 로고 + 토글 */}
      <div className={`flex items-center h-16 border-b border-border ${collapsed ? "justify-center px-2" : "gap-2.5 px-5"}`}>
        <div className="grid place-items-center w-9 h-9 rounded-xl bg-accent/15 ring-1 ring-accent/30 shrink-0">
          <Compass className="w-5 h-5 text-accent-2" />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="font-semibold leading-tight truncate">Compass LLM</div>
            <div className="text-[11px] text-faint leading-tight">운영 콘솔</div>
          </div>
        )}
        {!collapsed && (
          <button onClick={toggle} className="text-faint hover:text-gray-200 transition shrink-0" title="메뉴 접기">
            <PanelLeftClose className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* 접힘 상태일 때 펼치기 버튼 */}
      {collapsed && (
        <button onClick={toggle} className="nav-link justify-center mx-2 mt-2" title="메뉴 펼치기">
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
              className={`nav-link ${active ? "active" : ""} ${collapsed ? "justify-center !px-0" : ""}`}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              {!collapsed && n.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <button
          className={`nav-link w-full ${collapsed ? "justify-center !px-0" : ""}`}
          title={collapsed ? "로그아웃" : undefined}
          onClick={async () => {
            await fetch("/api/admin/auth/logout", { method: "POST" });
            router.push("/login");
          }}
        >
          <LogOut className="w-[18px] h-[18px] shrink-0" />
          {!collapsed && "로그아웃"}
        </button>
      </div>
    </aside>
  );
}
