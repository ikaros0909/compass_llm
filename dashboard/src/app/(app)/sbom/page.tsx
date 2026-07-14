"use client";
import useSWR from "swr";
import { useEffect, useState, Fragment } from "react";
import { fetcher } from "@/lib/fetcher";
import PageHeader from "@/components/PageHeader";
import {
  ShieldAlert, Save, ScanLine, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  TriangleAlert, ExternalLink, PackageSearch,
} from "lucide-react";

const SEV = {
  CRITICAL: { ko: "치명", cls: "bg-danger/15 text-danger" },
  HIGH: { ko: "높음", cls: "bg-warn/15 text-warn" },
  MEDIUM: { ko: "중간", cls: "bg-info/15 text-info" },
  LOW: { ko: "낮음", cls: "bg-faint/15 text-faint" },
  UNKNOWN: { ko: "미상", cls: "bg-faint/15 text-faint" },
} as const;

function Count({ n, cls }: { n: number; cls: string }) {
  return <span className={`inline-block min-w-[1.75rem] px-1.5 py-0.5 rounded-md text-xs font-medium tabular-nums ${n > 0 ? cls : "text-faint"}`}>{n}</span>;
}

export default function SbomPage() {
  const { data, mutate } = useSWR("/api/admin/sbom", fetcher, { refreshInterval: 15000 });
  const [form, setForm] = useState({ workspace: "", repoSlugs: "", authUsername: "", token: "", scanHour: 3, enabled: false });
  const [tokenSet, setTokenSet] = useState(false);
  const [usingCr, setUsingCr] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "scan">("");
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [scanMsg, setScanMsg] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (data?.config && !hydrated) {
      const c = data.config;
      setForm({ workspace: c.workspace, repoSlugs: (c.repoSlugs ?? []).join(", "), authUsername: c.authUsername, token: "", scanHour: c.scanHour, enabled: c.enabled });
      setTokenSet(c.tokenSet); setUsingCr(c.usingCodeReviewCreds); setHydrated(true);
    }
  }, [data, hydrated]);

  const up = (k: string, v: any) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); setSaveMsg(null); };

  async function save() {
    setBusy("save"); setSaveMsg(null);
    try {
      const res = await fetch("/api/admin/sbom", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (res.ok) { if (form.token) setTokenSet(true); setForm((f) => ({ ...f, token: "" })); setDirty(false); setSaveMsg({ ok: true, text: "저장되었습니다." }); mutate(); }
      else if (res.status === 401 || res.status === 403) setSaveMsg({ ok: false, text: "세션이 만료되었거나 권한이 없습니다. 다시 로그인해 주세요." });
      else setSaveMsg({ ok: false, text: (await res.json().catch(() => ({}))).error || `저장 실패 (${res.status})` });
    } catch { setSaveMsg({ ok: false, text: "네트워크 오류로 저장하지 못했습니다." }); }
    finally { setBusy(""); }
  }
  async function scan() {
    setBusy("scan"); setScanMsg("");
    const r = await fetch("/api/admin/sbom/run", { method: "POST" });
    if (r.ok) setScanMsg("스캔을 시작했습니다. 저장소 수·크기에 따라 수 분 걸릴 수 있으며, 결과는 자동 갱신됩니다.");
    else setScanMsg((await r.json().catch(() => ({}))).error || "스캔 시작 실패");
    setBusy(""); mutate();
  }
  function toggle(repo: string) { setOpen((s) => { const n = new Set(s); n.has(repo) ? n.delete(repo) : n.add(repo); return n; }); }

  const repos: any[] = data?.repos ?? [];
  const totalCrit = repos.reduce((a, r) => a + (r.critical ?? 0), 0);
  const totalHigh = repos.reduce((a, r) => a + (r.high ?? 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="SBOM 보안" desc="저장소별 의존성 취약점(CVE)을 Trivy 로 점검합니다">
        <span className={`badge ${form.enabled ? "badge-on" : "badge-off"}`}>{form.enabled ? `매일 ${String(form.scanHour).padStart(2, "0")}시 자동` : "자동 꺼짐"}</span>
      </PageHeader>

      {(totalCrit + totalHigh) > 0 && (
        <div className="card !py-3 flex items-center gap-3 ring-1 ring-danger/40 bg-danger/5">
          <TriangleAlert className="w-5 h-5 text-danger shrink-0" />
          <div className="text-sm">
            <b className="text-danger">치명 {totalCrit} · 높음 {totalHigh}</b>
            <span className="text-muted"> 등급의 취약점이 있습니다. 아래에서 저장소별로 확인하고 의존성을 업데이트하세요.</span>
          </div>
        </div>
      )}

      {/* 설정 */}
      <div className="card space-y-3">
        <div className="text-sm font-medium flex items-center gap-2"><PackageSearch className="w-4 h-4 text-accent-2" /> 스캔 설정</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className="label">Workspace</label><input className="input" placeholder="비우면 코드리뷰 설정 재사용" value={form.workspace} onChange={(e) => up("workspace", e.target.value)} /></div>
          <div><label className="label">저장소 slug <span className="text-faint">(쉼표로 구분)</span></label><input className="input" placeholder="repo-a, repo-b" value={form.repoSlugs} onChange={(e) => up("repoSlugs", e.target.value)} /></div>
          <div>
            <label className="label">Access Token {tokenSet ? <span className="text-success">· 저장됨</span> : usingCr ? <span className="text-faint">· 코드리뷰 토큰 재사용</span> : null}</label>
            <input className="input" type="password" placeholder={tokenSet ? "변경하려면 새 토큰" : "비우면 코드리뷰 토큰 재사용"} value={form.token} onChange={(e) => up("token", e.target.value)} />
          </div>
          <div className="flex items-end gap-3">
            <div><label className="label">매일 실행 시각</label>
              <select className="input !w-28" value={form.scanHour} onChange={(e) => up("scanHour", Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer mb-2.5">
              <input type="checkbox" className="accent-accent w-4 h-4" checked={form.enabled} onChange={(e) => up("enabled", e.target.checked)} /> 일일 자동 스캔
            </label>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <button className="btn" onClick={save} disabled={!!busy}>{busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 저장</button>
          <button className="btn-ghost" onClick={scan} disabled={!!busy}>{busy === "scan" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />} 지금 스캔</button>
          {saveMsg ? (
            <span className={`text-xs flex items-center gap-1 ${saveMsg.ok ? "text-success" : "text-danger"}`}>{saveMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />} {saveMsg.text}</span>
          ) : dirty ? <span className="text-xs flex items-center gap-1 text-warn"><span className="w-1.5 h-1.5 rounded-full bg-warn inline-block" /> 저장되지 않은 변경사항</span> : null}
        </div>
        {scanMsg && <p className="text-xs text-muted">{scanMsg}</p>}
      </div>

      {/* 저장소별 현황 */}
      <div className="card !p-0 overflow-hidden">
        <div className="px-5 py-3 text-sm font-medium border-b border-border">저장소별 취약점 현황</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[48rem]">
            <thead className="text-muted text-left text-xs uppercase tracking-wide">
              <tr className="border-b border-border">
                <th className="font-medium px-5 py-3">저장소</th>
                <th className="font-medium px-3 py-3 text-center">치명</th><th className="font-medium px-3 py-3 text-center">높음</th>
                <th className="font-medium px-3 py-3 text-center">중간</th><th className="font-medium px-3 py-3 text-center">낮음</th>
                <th className="font-medium px-3 py-3">마지막 스캔</th><th className="font-medium px-3 py-3 text-center">상세</th>
              </tr>
            </thead>
            <tbody>
              {repos.length === 0 && <tr><td colSpan={7} className="px-5 py-12 text-center text-faint"><ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-50" />설정에서 저장소를 지정하고 "지금 스캔"을 눌러보세요.</td></tr>}
              {repos.map((r) => (
                <Fragment key={r.repoSlug}>
                  <tr className={`table-row ${(r.critical ?? 0) > 0 ? "bg-danger/5" : ""}`}>
                    <td className="px-5 py-3 font-mono text-xs">{r.repoSlug}</td>
                    {r.status === "none" ? (
                      <td colSpan={4} className="px-3 py-3 text-center text-faint text-xs">미스캔</td>
                    ) : r.status === "error" ? (
                      <td colSpan={4} className="px-3 py-3 text-danger text-xs" title={r.message}>스캔 오류: {(r.message ?? "").slice(0, 60)}</td>
                    ) : (
                      <>
                        <td className="px-3 py-3 text-center"><Count n={r.critical} cls={SEV.CRITICAL.cls} /></td>
                        <td className="px-3 py-3 text-center"><Count n={r.high} cls={SEV.HIGH.cls} /></td>
                        <td className="px-3 py-3 text-center"><Count n={r.medium} cls={SEV.MEDIUM.cls} /></td>
                        <td className="px-3 py-3 text-center"><Count n={r.low} cls={SEV.LOW.cls} /></td>
                      </>
                    )}
                    <td className="px-3 py-3 text-muted text-xs whitespace-nowrap">{r.at ? new Date(r.at).toLocaleString() : "—"}</td>
                    <td className="px-3 py-3 text-center">
                      {(r.total ?? 0) > 0
                        ? <button onClick={() => toggle(r.repoSlug)} className="inline-flex items-center gap-0.5 text-muted hover:text-fg rounded px-1.5 py-0.5 hover:bg-elevated/60">{open.has(r.repoSlug) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
                        : <span className="text-faint">—</span>}
                    </td>
                  </tr>
                  {open.has(r.repoSlug) && <FindingsRow repo={r.repoSlug} />}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FindingsRow({ repo }: { repo: string }) {
  const { data } = useSWR(`/api/admin/sbom/findings?repo=${encodeURIComponent(repo)}`, fetcher);
  const findings: any[] = data?.findings ?? [];
  return (
    <tr className="bg-elevated/30">
      <td colSpan={7} className="px-5 pb-3 pt-0">
        {!data ? <div className="text-xs text-faint py-3">불러오는 중…</div> : findings.length === 0 ? (
          <div className="text-xs text-faint py-3">취약점이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs min-w-[42rem]">
              <thead className="text-faint text-left"><tr className="border-b border-border">
                <th className="px-3 py-2 font-medium">심각도</th><th className="px-3 py-2 font-medium">패키지</th>
                <th className="px-3 py-2 font-medium">현재</th><th className="px-3 py-2 font-medium">수정 버전</th>
                <th className="px-3 py-2 font-medium">취약점</th><th className="px-3 py-2 font-medium">생태계</th>
              </tr></thead>
              <tbody>
                {findings.map((f) => {
                  const sv = (SEV as any)[f.severity] ?? SEV.UNKNOWN;
                  return (
                    <tr key={f.id} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2"><span className={`badge ${sv.cls}`}>{sv.ko}</span></td>
                      <td className="px-3 py-2 font-mono">{f.pkgName}</td>
                      <td className="px-3 py-2 text-muted font-mono">{f.installedVersion}</td>
                      <td className="px-3 py-2 font-mono">{f.fixedVersion ? <span className="text-success">{f.fixedVersion}</span> : <span className="text-faint">없음</span>}</td>
                      <td className="px-3 py-2">
                        {f.url ? <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-accent-2 hover:underline inline-flex items-center gap-1">{f.vulnId}<ExternalLink className="w-3 h-3" /></a> : f.vulnId}
                      </td>
                      <td className="px-3 py-2 text-faint">{f.ecosystem}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </td>
    </tr>
  );
}
