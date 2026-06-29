"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Compass, LogIn } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    const r = await fetch("/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (r.ok) router.push("/");
    else setErr("이메일 또는 비밀번호가 올바르지 않습니다.");
  }

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm shadow-glow animate-fade-in">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="grid place-items-center w-12 h-12 rounded-2xl bg-accent/15 ring-1 ring-accent/30 mb-3">
            <Compass className="w-6 h-6 text-accent-2" />
          </div>
          <h1 className="text-lg font-semibold">Compass LLM</h1>
          <p className="text-sm text-muted mt-0.5">운영 콘솔 로그인</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">이메일</label>
            <input className="input" placeholder="admin@compass.local" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">비밀번호</label>
            <input className="input" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {err && <p className="text-xs text-danger">{err}</p>}
          <button className="btn w-full mt-1" disabled={loading}>
            <LogIn className="w-4 h-4" /> {loading ? "로그인 중…" : "로그인"}
          </button>
        </div>
      </form>
    </div>
  );
}
