"use client";
import useSWR from "swr";
import { useState } from "react";
import { fetcher } from "@/lib/fetcher";
import PageHeader from "@/components/PageHeader";
import {
  UserPlus, Trash2, KeyRound, ShieldCheck, Eye, Users, Lock,
} from "lucide-react";

export default function AccountsPage() {
  const { data: me } = useSWR("/api/admin/me", fetcher);
  const isAdmin = me?.role === "admin";
  const { data, mutate, error } = useSWR(isAdmin ? "/api/admin/users" : null, fetcher, { refreshInterval: 15000 });

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [role, setRole] = useState("viewer");
  const [msg, setMsg] = useState("");

  async function create() {
    setMsg("");
    if (!email.trim() || !pw) { setMsg("이메일과 비밀번호를 입력하세요."); return; }
    const r = await fetch("/api/admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password: pw, role }),
    });
    if (r.ok) { setEmail(""); setPw(""); setRole("viewer"); setMsg("계정이 생성되었습니다."); mutate(); }
    else setMsg((await r.json()).error ?? "생성 실패");
  }
  async function changeRole(id: string, newRole: string) {
    const r = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, role: newRole }) });
    if (!r.ok) alert((await r.json()).error); mutate();
  }
  async function resetPw(id: string, email: string) {
    const np = prompt(`${email} 의 새 비밀번호를 입력하세요 (4자 이상)`);
    if (!np) return;
    const r = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, password: np }) });
    alert(r.ok ? "비밀번호가 변경되었습니다." : (await r.json()).error);
  }
  async function del(id: string, email: string) {
    if (!confirm(`${email} 계정을 삭제할까요?`)) return;
    const r = await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" });
    if (!r.ok) alert((await r.json()).error); mutate();
  }

  const users = data?.users ?? [];

  return (
    <div>
      <PageHeader title="계정 관리" desc="운영 콘솔에 접근하는 관리자 계정을 관리합니다">
        {me && (
          <span className="badge bg-elevated text-muted">
            {me.role === "admin" ? <ShieldCheck className="w-3.5 h-3.5 text-accent-2" /> : <Eye className="w-3.5 h-3.5" />}
            {me.email}
          </span>
        )}
      </PageHeader>

      {/* 본인 비밀번호 변경 — 모든 사용자 */}
      <ChangeMyPassword />

      {!isAdmin ? (
        <div className="card flex items-center gap-3 text-sm text-muted">
          <Lock className="w-5 h-5 text-faint" />
          계정 목록 관리는 <b className="text-gray-200 mx-1">관리자(admin)</b> 권한이 필요합니다. 본인 비밀번호 변경만 가능합니다.
        </div>
      ) : (
        <>
          {/* 계정 생성 */}
          <div className="card mb-4">
            <label className="label">새 계정 생성</label>
            <div className="flex flex-wrap gap-2 items-center">
              <input className="input flex-1 min-w-[12rem]" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input className="input flex-1 min-w-[10rem]" type="password" placeholder="비밀번호 (4자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} />
              <select className="input w-32" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="viewer">viewer (열람)</option>
                <option value="admin">admin (관리)</option>
              </select>
              <button className="btn whitespace-nowrap" onClick={create}><UserPlus className="w-4 h-4" /> 생성</button>
            </div>
            {msg && <p className="text-xs mt-2 text-muted">{msg}</p>}
          </div>

          {/* 계정 목록 */}
          <div className="card !p-0 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[36rem]">
              <thead className="text-muted text-left text-xs uppercase tracking-wide">
                <tr className="border-b border-border">
                  <th className="font-medium px-5 py-3">이메일</th>
                  <th className="font-medium px-3 py-3">역할</th>
                  <th className="font-medium px-3 py-3">생성일</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-12 text-center text-faint">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-50" /> 계정이 없습니다.
                  </td></tr>
                )}
                {users.map((u: any) => (
                  <tr key={u.id} className="table-row">
                    <td className="px-5 py-3.5 font-medium">
                      {u.email}{u.id === me?.id && <span className="text-xs text-faint ml-2">(나)</span>}
                    </td>
                    <td className="px-3 py-3.5">
                      <select className="input !py-1 !w-28 text-xs" value={u.role} onChange={(e) => changeRole(u.id, e.target.value)} disabled={u.id === me?.id}>
                        <option value="viewer">viewer</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="px-3 py-3.5 text-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="px-5 py-3.5 text-right space-x-1.5 whitespace-nowrap">
                      <button className="btn-ghost !px-2.5 !py-1.5 !text-xs" onClick={() => resetPw(u.id, u.email)}>
                        <KeyRound className="w-3.5 h-3.5" /> 비밀번호
                      </button>
                      <button className="btn-danger" onClick={() => del(u.id, u.email)} disabled={u.id === me?.id}>
                        <Trash2 className="w-3.5 h-3.5" /> 삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ChangeMyPassword() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState("");

  async function submit() {
    setMsg("");
    const r = await fetch("/api/admin/me", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: cur, newPassword: next }),
    });
    if (r.ok) { setCur(""); setNext(""); setMsg("비밀번호가 변경되었습니다."); }
    else setMsg((await r.json()).error ?? "변경 실패");
  }

  return (
    <div className="card mb-4">
      <label className="label flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> 내 비밀번호 변경</label>
      <div className="flex flex-wrap gap-2 items-center">
        <input className="input flex-1 min-w-[10rem]" type="password" placeholder="현재 비밀번호" value={cur} onChange={(e) => setCur(e.target.value)} />
        <input className="input flex-1 min-w-[10rem]" type="password" placeholder="새 비밀번호 (4자 이상)" value={next} onChange={(e) => setNext(e.target.value)} />
        <button className="btn-ghost whitespace-nowrap" onClick={submit} disabled={!cur || !next}>변경</button>
      </div>
      {msg && <p className="text-xs mt-2 text-muted">{msg}</p>}
    </div>
  );
}
