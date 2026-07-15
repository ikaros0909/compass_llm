"use client";
import useSWR from "swr";
import { useEffect, useState, Fragment } from "react";
import { fetcher } from "@/lib/fetcher";
import PageHeader from "@/components/PageHeader";
import {
  ShieldAlert, Save, ScanLine, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  TriangleAlert, ExternalLink, PackageSearch, RefreshCw, TrendingUp, Sparkles, Copy, Check, X,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

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

// 취약점 링크는 사기업(Aqua) 페이지 대신 공공/중립 출처로 연결.
//  CVE→NVD(미국 NIST 정부) · GHSA→GitHub 어드바이저리 · 그 외→OSV(Google) 또는 원본 URL
function vulnLink(id: string, fallback: string): string {
  if (/^CVE-/i.test(id)) return `https://nvd.nist.gov/vuln/detail/${id}`;
  if (/^GHSA-/i.test(id)) return `https://github.com/advisories/${id}`;
  return fallback || (id ? `https://osv.dev/vulnerability/${id}` : "");
}

// 취약점 정보를 관리하는 출처(기관) — 이모지 + 호버 설명
function vulnSource(id: string): { emoji: string; label: string } {
  if (/^CVE-/i.test(id)) return { emoji: "🏛️", label: "출처: NVD — 미국 NIST(정부)가 관리하는 국가 취약점 데이터베이스(National Vulnerability Database)" };
  if (/^GHSA-/i.test(id)) return { emoji: "🐙", label: "출처: GitHub Security Advisory — GitHub(Microsoft)가 관리하는 어드바이저리 DB" };
  return { emoji: "🔎", label: "출처: OSV — Google 주도의 오픈소스 취약점 데이터베이스(osv.dev)" };
}

const SEV_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

// 버전 비교(숫자 세그먼트 기준) — "3.4.11" > "3.4.7"
function cmpVer(a: string, b: string): number {
  const pa = a.split(/[.+-]/), pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = parseInt(pa[i] ?? "0", 10), y = parseInt(pb[i] ?? "0", 10);
    if (Number.isNaN(x) || Number.isNaN(y)) return a < b ? -1 : a > b ? 1 : 0;
    if (x !== y) return x - y;
  }
  return 0;
}
// 여러 fixedVersion(쉼표 포함 가능) 중 가장 높은 버전 = 전부 해결하는 권장 업그레이드 버전
function maxFix(list: string[]): string {
  const toks = list.flatMap((f) => (f || "").split(/[,\s]+/).filter(Boolean));
  if (!toks.length) return "";
  return toks.reduce((m, v) => (cmpVer(v, m) > 0 ? v : m));
}

// AI 에게 붙여넣어 취약점 수정을 요청하는 프롬프트 — 패키지 1개
function buildFixPrompt(repo: string, branch: string, g: any): string {
  const vulns = g.vulns.map((v: any) => `  - [${v.severity}] ${v.vulnId} — 수정 버전: ${v.fixedVersion || "정식 수정본 없음"}`).join("\n");
  return [
    `아래 저장소의 의존성 취약점을 수정해줘.`,
    ``,
    `- 저장소: ${repo}`,
    `- 브랜치: ${branch || "기본 브랜치"}`,
    `- 생태계/패키지 매니저: ${g.ecosystem}`,
    `- 대상 패키지: ${g.pkgName}`,
    `- 현재 버전: ${g.installedVersion}`,
    `- 권장 버전: ${g.rec ? `${g.rec} 이상` : "정식 수정본 없음 (대안·완화책 검토 필요)"}`,
    ``,
    `해결 대상 취약점 (${g.vulns.length}건):`,
    vulns,
    ``,
    `요청사항:`,
    `1. ${g.pkgName} 를 ${g.rec ? `${g.rec} 이상` : "가능한 최신 안전 버전"}으로 올려줘. 직접 의존성이면 매니페스트(package.json·requirements.txt 등)를, 전이 의존성이면 npm overrides/resolutions·pip constraints 등으로 강제해줘.`,
    `2. 락파일을 갱신하고 설치·빌드가 정상 동작하는지 확인해줘.`,
    `3. breaking change 가능성이 있으면 영향 범위와 코드 수정 방법을 알려줘.`,
    `4. 업그레이드 후에도 남는 취약점이 있으면 함께 보고해줘.`,
  ].join("\n");
}

// 저장소 전체 취약점을 한 번에 수정 요청하는 프롬프트
function buildRepoPrompt(repo: string, branch: string, groups: any[]): string {
  const lines = groups.map((g) => `- ${g.pkgName}: ${g.installedVersion} → ${g.rec || "정식 수정본 없음"} (${g.vulns.length}건, 최고 심각도 ${g.topSev})`).join("\n");
  return [
    `아래 저장소의 의존성 취약점(SBOM 스캔 결과)을 모두 수정해줘.`,
    ``,
    `- 저장소: ${repo}`,
    `- 브랜치: ${branch || "기본 브랜치"}`,
    ``,
    `업그레이드 대상 (${groups.length}개 패키지):`,
    lines,
    ``,
    `요청사항:`,
    `1. 각 패키지를 권장 버전 이상으로 올려줘(직접/전이 의존성 구분해 매니페스트 또는 overrides/resolutions 사용).`,
    `2. 락파일 갱신 및 설치·빌드 정상 여부 확인.`,
    `3. breaking change 영향과 대응 방법, 남는 취약점을 보고.`,
    `4. 심각도 높은 것(치명·높음)부터 우선 처리.`,
  ].join("\n");
}

function PromptModal({ data, onClose }: { data: { title: string; text: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(data.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard 불가 시 textarea 선택으로 대체 */ }
  }
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-accent-2" />
          <span className="text-sm font-medium truncate">{data.title}</span>
          <button onClick={onClose} className="ml-auto text-faint hover:text-white shrink-0" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>
        <textarea readOnly value={data.text} onFocus={(e) => e.currentTarget.select()}
          className="input flex-1 min-h-[18rem] resize-none font-mono text-xs leading-relaxed" />
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <button className="btn" onClick={copy}>{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? "복사됨" : "프롬프트 복사"}</button>
          <button className="btn-ghost" onClick={onClose}>닫기</button>
          <span className="text-xs text-faint ml-auto">복사해 Claude·ChatGPT 등에 붙여넣어 사용하세요</span>
        </div>
      </div>
    </div>
  );
}

export default function SbomPage() {
  const { data, mutate } = useSWR("/api/admin/sbom", fetcher, {
    refreshInterval: (d: any) => (d?.scanning?.running ? 3000 : 15000), // 스캔 중엔 빠르게 갱신
  });
  const [form, setForm] = useState({ workspace: "", repoSlugs: [] as string[], authUsername: "", token: "", scanHour: 3, enabled: false });
  const [tokenSet, setTokenSet] = useState(false);
  const [usingCr, setUsingCr] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "scan" | "load">("");
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [scanMsg, setScanMsg] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [promptModal, setPromptModal] = useState<{ title: string; text: string } | null>(null);
  const [repoList, setRepoList] = useState<{ slug: string; name: string }[]>([]);
  const [loadMsg, setLoadMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (data?.config && !hydrated) {
      const c = data.config;
      setForm({ workspace: c.workspace, repoSlugs: c.repoSlugs ?? [], authUsername: c.authUsername, token: "", scanHour: c.scanHour, enabled: c.enabled });
      setTokenSet(c.tokenSet); setUsingCr(c.usingCodeReviewCreds); setHydrated(true);
    }
  }, [data, hydrated]);

  const up = (k: string, v: any) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); setSaveMsg(null); };
  const toggleRepo = (slug: string) => {
    setForm((f) => ({ ...f, repoSlugs: f.repoSlugs.includes(slug) ? f.repoSlugs.filter((s) => s !== slug) : [...f.repoSlugs, slug] }));
    setDirty(true); setSaveMsg(null);
  };

  async function loadRepos() {
    setBusy("load"); setLoadMsg(null);
    try {
      const r = await fetch("/api/admin/codereview/repos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: form.workspace, authUsername: form.authUsername, token: form.token }),
      });
      const j = await r.json();
      if (j.ok) { setRepoList((j.repos ?? []).map((x: any) => ({ slug: x.slug, name: x.name }))); setLoadMsg({ ok: true, text: `저장소 ${j.repos?.length ?? 0}개` }); }
      else setLoadMsg({ ok: false, text: j.message ?? "불러오기 실패" });
    } catch { setLoadMsg({ ok: false, text: "불러오기 오류" }); }
    finally { setBusy(""); }
  }
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
  const scanning = data?.scanning ?? { running: false, total: 0, done: 0, current: "" };
  const totalCrit = repos.reduce((a, r) => a + (r.critical ?? 0), 0);
  const totalHigh = repos.reduce((a, r) => a + (r.high ?? 0), 0);
  // 불러온 목록 + 저장된 선택(목록에 없어도) 병합
  const known = new Set(repoList.map((r) => r.slug));
  const pickerRows = [...repoList, ...form.repoSlugs.filter((s) => !known.has(s)).map((s) => ({ slug: s, name: s }))];

  return (
    <div className="space-y-4">
      <PageHeader title="SBOM 보안" desc="저장소별 의존성 취약점(CVE)을 Trivy 로 점검합니다">
        <span className={`badge ${form.enabled ? "badge-on" : "badge-off"}`}>{form.enabled ? `매일 ${String(form.scanHour).padStart(2, "0")}시 자동` : "자동 꺼짐"}</span>
      </PageHeader>

      {scanning.running && (
        <div className="card !py-3 flex items-center gap-3 ring-1 ring-accent/40 bg-accent/5">
          <Loader2 className="w-5 h-5 text-accent-2 shrink-0 animate-spin" />
          <div className="text-sm">
            <b className="text-accent-2">스캔 진행 중</b>
            <span className="text-muted"> · {scanning.done}/{scanning.total} 완료{scanning.current ? ` · 현재: ${scanning.current}` : ""} (결과는 자동 갱신됩니다)</span>
          </div>
        </div>
      )}

      {(totalCrit + totalHigh) > 0 && (
        <div className="card !py-3 flex items-center gap-3 ring-1 ring-danger/40 bg-danger/5">
          <TriangleAlert className="w-5 h-5 text-danger shrink-0" />
          <div className="text-sm"><b className="text-danger">치명 {totalCrit} · 높음 {totalHigh}</b><span className="text-muted"> 등급의 취약점이 있습니다. 저장소별로 확인해 의존성을 업데이트하세요.</span></div>
        </div>
      )}

      {/* 설정 */}
      <div className="card space-y-3">
        <div className="text-sm font-medium flex items-center gap-2"><PackageSearch className="w-4 h-4 text-accent-2" /> 스캔 설정</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className="label">Workspace</label><input className="input" placeholder="비우면 코드리뷰 설정 재사용" value={form.workspace} onChange={(e) => up("workspace", e.target.value)} /></div>
          <div>
            <label className="label">Access Token {tokenSet ? <span className="text-success">· 저장됨</span> : usingCr ? <span className="text-faint">· 코드리뷰 토큰 재사용</span> : null}</label>
            <input className="input" type="password" placeholder={tokenSet ? "변경하려면 새 토큰" : "비우면 코드리뷰 토큰 재사용"} value={form.token} onChange={(e) => up("token", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Username / Email <span className="text-faint">(API 토큰·App Password 사용 시)</span></label>
            <input className="input" placeholder="비우면 코드리뷰 설정 재사용 · API 토큰이면 Atlassian 이메일 · Repo Access Token 이면 비움" value={form.authUsername} onChange={(e) => up("authUsername", e.target.value)} />
          </div>
        </div>

        {/* 검사할 저장소 선택 */}
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <label className="label mb-0">검사할 저장소 <span className="text-faint">({form.repoSlugs.length}개 선택됨)</span></label>
            <button className="btn-ghost !py-1 !px-2.5 !text-xs" onClick={loadRepos} disabled={!!busy} title="Bitbucket 에서 저장소 목록을 새로 불러옵니다">
              {busy === "load" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} 저장소 목록 새로고침
            </button>
            {loadMsg && <span className={`text-xs flex items-center gap-1 ${loadMsg.ok ? "text-success" : "text-danger"}`}>{loadMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}{loadMsg.text}</span>}
          </div>
          {pickerRows.length === 0 ? (
            <div className="text-xs text-faint py-3 px-3 rounded-lg border border-border">위 <b className="text-muted">저장소 목록 새로고침</b> 을 눌러 목록을 불러오세요. (Workspace·Token 을 비우면 코드리뷰 설정을 사용합니다)</div>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
              {pickerRows.map((r) => (
                <label key={r.slug} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-elevated/50">
                  <input type="checkbox" className="accent-accent w-4 h-4" checked={form.repoSlugs.includes(r.slug)} onChange={() => toggleRepo(r.slug)} />
                  <span className="truncate">{r.name}</span>
                  <span className="text-faint text-xs ml-auto font-mono shrink-0">{r.slug}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div><label className="label">매일 실행 시각</label>
            <select className="input !w-28" value={form.scanHour} onChange={(e) => up("scanHour", Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer mt-5">
            <input type="checkbox" className="accent-accent w-4 h-4" checked={form.enabled} onChange={(e) => up("enabled", e.target.checked)} /> 일일 자동 스캔
          </label>
        </div>

        <div className="flex items-center gap-2 flex-wrap pt-1">
          <button className="btn" onClick={save} disabled={!!busy}>{busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 저장</button>
          <button className="btn-ghost" onClick={scan} disabled={!!busy || scanning.running || form.repoSlugs.length === 0}>{(busy === "scan" || scanning.running) ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />} {scanning.running ? "스캔 중…" : "지금 스캔"}</button>
          {saveMsg ? (
            <span className={`text-xs flex items-center gap-1 ${saveMsg.ok ? "text-success" : "text-danger"}`}>{saveMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />} {saveMsg.text}</span>
          ) : dirty ? <span className="text-xs flex items-center gap-1 text-warn"><span className="w-1.5 h-1.5 rounded-full bg-warn inline-block" /> 저장되지 않은 변경사항 (저장해야 스캔에 반영)</span> : null}
        </div>
        {scanMsg && <p className="text-xs text-muted">{scanMsg}</p>}
      </div>

      {/* 취약점 추이 */}
      <TrendCard repos={repos} />

      {/* 저장소별 현황 */}
      <div className="card !p-0 overflow-hidden">
        <div className="px-5 py-3 text-sm font-medium border-b border-border">저장소별 취약점 현황</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[48rem]">
            <thead className="text-muted text-left text-xs uppercase tracking-wide">
              <tr className="border-b border-border">
                <th className="font-medium px-5 py-3">저장소</th>
                <th className="font-medium px-3 py-3">브랜치</th>
                <th className="font-medium px-3 py-3 text-center">치명</th><th className="font-medium px-3 py-3 text-center">높음</th>
                <th className="font-medium px-3 py-3 text-center">중간</th><th className="font-medium px-3 py-3 text-center">낮음</th>
                <th className="font-medium px-3 py-3">마지막 스캔</th><th className="font-medium px-3 py-3 text-center">상세</th>
              </tr>
            </thead>
            <tbody>
              {repos.length === 0 && <tr><td colSpan={8} className="px-5 py-12 text-center text-faint"><ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-50" />검사할 저장소를 선택·저장하고 "지금 스캔"을 눌러보세요.</td></tr>}
              {repos.map((r) => (
                <Fragment key={r.repoSlug}>
                  <tr className={`table-row ${(r.critical ?? 0) > 0 ? "bg-danger/5" : ""}`}>
                    <td className="px-5 py-3 font-mono text-xs">{r.repoSlug}</td>
                    <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
                      {r.branch
                        ? <span className={r.branch === "dev" ? "text-accent-2" : "text-muted"} title={r.branch === "dev" ? "dev 브랜치 우선 적용" : "기본 브랜치"}>{r.branch}</span>
                        : <span className="text-faint">—</span>}
                    </td>
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
                  {open.has(r.repoSlug) && <FindingsRow repo={r.repoSlug} branch={r.branch} onPrompt={setPromptModal} />}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {promptModal && <PromptModal data={promptModal} onClose={() => setPromptModal(null)} />}
    </div>
  );
}

function TrendCard({ repos }: { repos: any[] }) {
  const [repo, setRepo] = useState("all");
  const [days, setDays] = useState(30);
  const { data } = useSWR(`/api/admin/sbom/trend?repo=${encodeURIComponent(repo)}&days=${days}`, fetcher, { refreshInterval: 60000 });
  const series: any[] = data?.series ?? [];
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const delta = last && prev ? (last.critical + last.high) - (prev.critical + prev.high) : 0;

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-accent-2" /> 취약점 추이
          {last && prev && (
            <span className={`text-xs font-normal ${delta > 0 ? "text-danger" : delta < 0 ? "text-success" : "text-faint"}`}>
              (치명+높음 전일 대비 {delta > 0 ? `+${delta}` : delta})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select className="input !w-auto !py-1 !text-xs cursor-pointer" value={repo} onChange={(e) => setRepo(e.target.value)}>
            <option value="all">전체 합계</option>
            {repos.map((r) => <option key={r.repoSlug} value={r.repoSlug}>{r.repoSlug}</option>)}
          </select>
          <select className="input !w-auto !py-1 !text-xs cursor-pointer" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>최근 7일</option><option value={30}>최근 30일</option><option value={90}>최근 90일</option>
          </select>
        </div>
      </div>
      {series.length < 2 ? (
        <div className="text-xs text-faint py-10 text-center">
          {series.length === 0 ? "스캔 이력이 없습니다." : "데이터가 하루치뿐입니다."} 매일 스캔이 쌓이면 날짜별 추이가 그래프로 표시됩니다.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={series} margin={{ left: -12, right: 8, top: 4 }}>
            <CartesianGrid stroke="#222c3d" vertical={false} />
            <XAxis dataKey="date" stroke="#5a6678" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(d) => String(d).slice(5)} minTickGap={24} />
            <YAxis stroke="#5a6678" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} width={34} />
            <Tooltip contentStyle={{ background: "#131926", border: "1px solid #222c3d", borderRadius: 12, fontSize: 12 }} labelStyle={{ color: "#8a97ad" }} />
            <Line type="monotone" dataKey="critical" name="치명" stroke="#f43f5e" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="high" name="높음" stroke="#f59e0b" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="medium" name="중간" stroke="#38bdf8" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="low" name="낮음" stroke="#5a6678" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
      <div className="flex items-center gap-3 flex-wrap mt-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-danger inline-block" />치명</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warn inline-block" />높음</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-info inline-block" />중간</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-faint inline-block" />낮음</span>
        <span className="ml-auto text-faint">하루 여러 번 스캔 시 그 날의 마지막 결과 기준</span>
      </div>
    </div>
  );
}

function FindingsRow({ repo, branch, onPrompt }: { repo: string; branch?: string; onPrompt: (d: { title: string; text: string }) => void }) {
  const { data } = useSWR(`/api/admin/sbom/findings?repo=${encodeURIComponent(repo)}`, fetcher);
  const findings: any[] = data?.findings ?? [];
  const [open, setOpen] = useState<Set<string>>(new Set());

  // 패키지(이름+현재버전+생태계)별로 묶고, 같은 취약점ID 는 1회만. 권장버전=최고 수정버전.
  const map = new Map<string, { pkgName: string; installedVersion: string; ecosystem: string; vulns: Map<string, any> }>();
  for (const f of findings) {
    const key = `${f.pkgName} ${f.installedVersion} ${f.ecosystem}`;
    if (!map.has(key)) map.set(key, { pkgName: f.pkgName, installedVersion: f.installedVersion, ecosystem: f.ecosystem, vulns: new Map() });
    const g = map.get(key)!;
    if (!g.vulns.has(f.vulnId)) g.vulns.set(f.vulnId, f);
  }
  const groups = [...map.entries()].map(([key, g]) => {
    const vulns = [...g.vulns.values()].sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0));
    const rec = maxFix(vulns.map((v) => v.fixedVersion));
    const unfixed = vulns.filter((v) => !v.fixedVersion).length;
    const topSev = vulns.reduce((m, v) => ((SEV_RANK[v.severity] ?? 0) > (SEV_RANK[m] ?? 0) ? v.severity : m), "UNKNOWN");
    return { key, ...g, vulns, rec, unfixed, topSev };
  }).sort((a, b) => (SEV_RANK[b.topSev] ?? 0) - (SEV_RANK[a.topSev] ?? 0) || b.vulns.length - a.vulns.length);

  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <tr className="bg-elevated/30">
      <td colSpan={8} className="px-5 pb-3 pt-0">
        {!data ? <div className="text-xs text-faint py-3">불러오는 중…</div> : groups.length === 0 ? (
          <div className="text-xs text-faint py-3">취약점이 없습니다.</div>
        ) : (
          <div className="space-y-1.5 py-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-[11px] text-faint flex-1">패키지 {groups.length}개 · 권장 버전으로 올리면 해당 패키지의 취약점이 함께 해결됩니다.</div>
              <button className="btn-ghost !py-0.5 !px-2 !text-[11px]" title="이 저장소 전체 취약점 수정 프롬프트"
                onClick={() => onPrompt({ title: `${repo} · 전체 취약점 수정 프롬프트`, text: buildRepoPrompt(repo, branch ?? "", groups) })}>
                <Sparkles className="w-3 h-3" /> 전체 AI 프롬프트
              </button>
            </div>
            {groups.map((g) => {
              const sv = (SEV as any)[g.topSev] ?? SEV.UNKNOWN;
              const isOpen = open.has(g.key);
              return (
                <div key={g.key} className="rounded-lg border border-border bg-surface/40">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer" onClick={() => toggle(g.key)}>
                      <span className={`badge ${sv.cls} shrink-0`}>{sv.ko}</span>
                      <span className="font-mono text-xs">{g.pkgName}</span>
                      <span className="font-mono text-xs text-muted">{g.installedVersion}</span>
                      <span className="text-faint text-xs">→</span>
                      {g.rec ? <span className="font-mono text-xs text-success" title="이 버전 이상으로 올리면 해당 패키지 취약점이 해결됩니다">{g.rec}</span> : <span className="text-xs text-faint">수정본 없음</span>}
                      <span className="text-faint text-[11px] ml-2 shrink-0">취약점 {g.vulns.length}건{g.unfixed ? ` · 미해결 ${g.unfixed}` : ""}</span>
                    </div>
                    <button className="btn-ghost !py-0.5 !px-2 !text-[11px] shrink-0" title="이 패키지 취약점 수정 프롬프트를 미리보기·복사"
                      onClick={() => onPrompt({ title: `${g.pkgName} · 취약점 수정 프롬프트`, text: buildFixPrompt(repo, branch ?? "", g) })}>
                      <Sparkles className="w-3 h-3" /> AI로 고치기
                    </button>
                    <button className="text-faint hover:text-fg shrink-0" onClick={() => toggle(g.key)} aria-label="펼치기">
                      {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="border-t border-border/60 px-3 py-2 space-y-1">
                      {g.vulns.map((v) => {
                        const vv = (SEV as any)[v.severity] ?? SEV.UNKNOWN;
                        const href = vulnLink(v.vulnId, v.url);
                        const src = vulnSource(v.vulnId);
                        return (
                          <div key={v.vulnId} className="flex items-center gap-2 text-xs">
                            <span className={`badge ${vv.cls} shrink-0`}>{vv.ko}</span>
                            <span className="cursor-help select-none shrink-0" title={src.label}>{src.emoji}</span>
                            {href
                              ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-2 hover:underline inline-flex items-center gap-1">{v.vulnId}<ExternalLink className="w-3 h-3" /></a>
                              : <span>{v.vulnId}</span>}
                            <span className="text-faint ml-auto shrink-0">수정: {v.fixedVersion || "없음"}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </td>
    </tr>
  );
}
