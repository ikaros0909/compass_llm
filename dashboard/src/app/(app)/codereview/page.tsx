"use client";
import useSWR from "swr";
import { Fragment, useEffect, useRef, useState } from "react";
import { fetcher } from "@/lib/fetcher";
import PageHeader from "@/components/PageHeader";
import {
  GitPullRequest, Save, Play, CheckCircle2, XCircle, Loader2, Info, ChevronDown, ChevronUp, FolderSearch, User,
} from "lucide-react";

export default function CodeReviewPage() {
  const { data, mutate } = useSWR("/api/admin/codereview", fetcher, { refreshInterval: 10000 });
  const { data: modelsData } = useSWR("/api/admin/models", fetcher);
  const models: { name: string }[] = modelsData?.models ?? [];

  const [form, setForm] = useState({
    workspace: "jinhaksa", repoSlugs: [] as string[], authUsername: "", token: "",
    model: "", intervalMin: 10, enabled: false, autoApprove: false, systemPrompt: "",
  });
  const [tokenSet, setTokenSet] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [repos, setRepos] = useState<{ slug: string; name: string; fullName: string }[]>([]);
  const [loadMsg, setLoadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [runMsg, setRunMsg] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "load" | "run">("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const [sortBy, setSortBy] = useState<"recent" | "risk">("recent");
  const [onlyReview, setOnlyReview] = useState(false);

  // 최초 로드시 서버 값으로 폼 초기화 (token 은 서버에 있으면 빈칸 유지)
  useEffect(() => {
    if (data?.config && !hydrated) {
      const c = data.config;
      setForm({
        workspace: c.workspace, repoSlugs: c.repoSlugs ?? [], authUsername: c.authUsername,
        token: "", model: c.model, intervalMin: c.intervalMin, enabled: c.enabled, autoApprove: c.autoApprove,
        // 저장된 프롬프트가 없으면 기본 프롬프트를 실제로 채워 바로 편집 가능하게
        systemPrompt: c.systemPrompt || c.defaultPrompt || "",
      });
      setTokenSet(c.tokenSet);
      setHydrated(true);
    }
  }, [data, hydrated]);

  // 새로고침 시: 토큰이 저장돼 있으면 저장소 목록을 자동으로 다시 불러와 체크 상태 표시
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (hydrated && tokenSet && !autoLoadedRef.current && repos.length === 0) {
      autoLoadedRef.current = true;
      loadRepos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, tokenSet]);

  const up = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const toggleRepo = (slug: string) => setForm((f) => ({
    ...f, repoSlugs: f.repoSlugs.includes(slug) ? f.repoSlugs.filter((s) => s !== slug) : [...f.repoSlugs, slug],
  }));

  async function save() {
    setBusy("save");
    await fetch("/api/admin/codereview", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (form.token) setTokenSet(true);
    setForm((f) => ({ ...f, token: "" }));
    setBusy(""); mutate();
  }
  async function loadRepos() {
    setBusy("load"); setLoadMsg(null);
    const r = await fetch("/api/admin/codereview/repos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await r.json();
    if (j.ok) { setRepos(j.repos ?? []); setLoadMsg({ ok: true, text: `${j.repos?.length ?? 0}개 저장소 불러옴` }); }
    else setLoadMsg({ ok: false, text: j.message ?? "불러오기 실패" });
    setBusy("");
  }
  async function run() {
    setBusy("run"); setRunMsg("리뷰 실행 중… (PR 수·모델에 따라 수 분 소요)");
    const r = await fetch("/api/admin/codereview/run", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setRunMsg(`완료 — 리뷰 ${j.reviewed ?? 0} · 건너뜀 ${j.skipped ?? 0} · 오류 ${j.errors ?? 0}${j.details?.length ? "\n" + j.details.join("\n") : ""}`);
    setBusy(""); mutate();
  }

  const logs = data?.logs ?? [];
  const ws = data?.config?.workspace || form.workspace || "jinhaksa";
  // 우려도 가중치: 재검토 플래그 > 리스크 등급 (최신순은 서버 정렬 유지)
  const riskWeight = (l: any) =>
    (l.needsReview ? 100 : 0) + (l.riskLevel === "high" ? 3 : l.riskLevel === "medium" ? 2 : l.riskLevel === "low" ? 1 : 0);
  const shownLogs = [...logs]
    .filter((l: any) => !onlyReview || l.needsReview)
    .sort((a: any, b: any) => (sortBy === "risk" ? riskWeight(b) - riskWeight(a) : 0));
  const reviewCount = logs.filter((l: any) => l.needsReview).length;

  return (
    <div>
      <PageHeader title="코드리뷰" desc="Bitbucket 열린 PR을 주기적으로 감지해 선택한 모델로 리뷰 코멘트를 자동 게시합니다">
        <span className={`badge ${form.enabled ? "badge-on" : "badge-off"}`}>{form.enabled ? "자동 리뷰 켜짐" : "꺼짐"}</span>
      </PageHeader>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 설정: workspace + 토큰 → 저장소 불러오기 → 선택 */}
        <div className="card space-y-3">
          <div className="text-sm font-medium flex items-center gap-2"><GitPullRequest className="w-4 h-4 text-accent-2" /> Bitbucket Cloud 연결</div>
          <div><label className="label">Workspace</label><input className="input" placeholder="예: myteam (bitbucket.org/<workspace>)" value={form.workspace} onChange={(e) => up("workspace", e.target.value)} /></div>
          <div>
            <label className="label">Access Token {tokenSet && <span className="text-success">· 저장됨</span>}</label>
            <input className="input" type="password" placeholder={tokenSet ? "변경하려면 새 토큰 입력" : "API 토큰 / Repository Access Token"} value={form.token} onChange={(e) => up("token", e.target.value)} />
          </div>
          <div>
            <label className="label">Username / Email <span className="text-faint">(API 토큰·App Password 사용 시)</span></label>
            <input className="input" placeholder="API 토큰이면 Atlassian 이메일 · 비우면 Bearer(Repo Access Token)" value={form.authUsername} onChange={(e) => up("authUsername", e.target.value)} />
            <p className="text-[11px] text-faint mt-1">
              • <b>API 토큰</b>(id.atlassian.com): 이메일 입력 · <b>Repository Access Token</b>(Repo 설정): 이 칸 비움 · <b>App Password</b>: 사용자명 입력
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn-ghost" onClick={loadRepos} disabled={!!busy || !form.workspace}>
              {busy === "load" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderSearch className="w-4 h-4" />} 저장소 불러오기
            </button>
            {loadMsg && (
              <span className={`text-xs flex items-center gap-1 ${loadMsg.ok ? "text-success" : "text-danger"}`}>
                {loadMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />} {loadMsg.text}
              </span>
            )}
          </div>

          <div>
            <label className="label">Repository <span className="text-faint">(여러 개 선택 가능 · {form.repoSlugs.length}개 선택됨)</span></label>
            {(() => {
              // 불러온 목록 + 저장된 선택(목록에 없어도) 합쳐서 표시
              const known = new Set(repos.map((r) => r.slug));
              const rows = [
                ...repos.map((r) => ({ slug: r.slug, name: r.name })),
                ...form.repoSlugs.filter((s) => !known.has(s)).map((s) => ({ slug: s, name: s })),
              ];
              if (rows.length === 0) return <div className="text-xs text-faint py-3 px-1">먼저 "저장소 불러오기"를 눌러 목록을 표시하세요.</div>;
              return (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
                  {rows.map((r) => (
                    <label key={r.slug} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-elevated/50">
                      <input type="checkbox" className="accent-accent w-4 h-4" checked={form.repoSlugs.includes(r.slug)} onChange={() => toggleRepo(r.slug)} />
                      <span className="truncate">{r.name}</span>
                      <span className="text-faint text-xs ml-auto font-mono shrink-0">{r.slug}</span>
                    </label>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>

        {/* 리뷰 옵션 */}
        <div className="card space-y-3">
          <div className="text-sm font-medium">리뷰 옵션</div>
          <div>
            <label className="label">리뷰 모델</label>
            <div className="relative">
              <select className="input appearance-none pr-9 cursor-pointer" value={form.model} onChange={(e) => up("model", e.target.value)}>
                <option value="">설치된 모델 선택…</option>
                {models.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
              <ChevronDown className="w-4 h-4 text-faint absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="label mb-0">폴링 주기(분)</label>
            <input type="number" min={1} className="input w-24" value={form.intervalMin} onChange={(e) => up("intervalMin", Number(e.target.value))} />
            <label className="flex items-center gap-2 text-sm ml-auto cursor-pointer">
              <input type="checkbox" className="accent-accent w-4 h-4" checked={form.enabled} onChange={(e) => up("enabled", e.target.checked)} />
              자동 리뷰 활성화
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm cursor-pointer rounded-lg border border-warn/30 bg-warn/5 p-2.5">
            <input type="checkbox" className="accent-warn w-4 h-4 mt-0.5" checked={form.autoApprove} onChange={(e) => up("autoApprove", e.target.checked)} />
            <span>
              <b>머지 문제없으면 PR 자동 승인</b>
              <span className="block text-[11px] text-faint mt-0.5">모델이 중대한 문제 없음(APPROVE)으로 판정할 때만 Bitbucket 에서 자동 승인합니다. 조금이라도 애매하면 보류. ⚠ 사람 검토 없이 승인되니 신중히 사용하세요. (토큰에 PR write 권한 필요)</span>
            </span>
          </label>
          <div>
            <label className="label">시스템 프롬프트 <span className="text-faint">(기본값이 채워져 있음 — 바로 편집 가능)</span></label>
            <textarea className="input h-32 resize-y text-xs leading-relaxed" value={form.systemPrompt} onChange={(e) => up("systemPrompt", e.target.value)} />
          </div>
          <div className="flex gap-2 pt-1">
            <button className="btn" onClick={save} disabled={!!busy}>{busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 저장</button>
            <button className="btn-ghost" onClick={run} disabled={!!busy}>{busy === "run" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} 지금 리뷰 실행</button>
          </div>
        </div>
      </div>

      {runMsg && <div className="card mt-4 text-xs whitespace-pre-wrap text-muted flex gap-2"><Info className="w-4 h-4 text-info shrink-0" />{runMsg}</div>}

      {/* 리뷰 이력 */}
      <div className="card !p-0 overflow-hidden mt-4">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium">최근 리뷰 이력</span>
          {reviewCount > 0 && <span className="text-xs text-danger" title="재검토 권장 건수">🔺 {reviewCount}건 확인 권장</span>}
          <div className="ml-auto flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer text-muted select-none">
              <input type="checkbox" className="accent-accent w-3.5 h-3.5" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
              🔺 재검토 필요만
            </label>
            <select className="input !w-auto !py-1 !text-xs cursor-pointer" value={sortBy} onChange={(e) => setSortBy(e.target.value as "recent" | "risk")}>
              <option value="recent">최신순</option>
              <option value="risk">우려도순</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted text-left text-xs uppercase tracking-wide">
            <tr className="border-b border-border">
              <th className="font-medium px-5 py-3">시각</th><th className="font-medium px-3 py-3">저장소</th><th className="font-medium px-3 py-3">PR</th>
              <th className="font-medium px-3 py-3">요청자</th>
              <th className="font-medium px-3 py-3">커밋</th><th className="font-medium px-3 py-3 text-center whitespace-nowrap">상태</th>
              <th className="font-medium px-3 py-3 text-center whitespace-nowrap">승인</th>
              <th className="font-medium px-3 py-3 whitespace-nowrap">품질</th>
              <th className="font-medium px-3 py-3 text-center whitespace-nowrap">메모</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan={9} className="px-5 py-10 text-center text-faint"><GitPullRequest className="w-7 h-7 mx-auto mb-2 opacity-50" />아직 리뷰 이력이 없습니다.</td></tr>}
            {logs.length > 0 && shownLogs.length === 0 && <tr><td colSpan={9} className="px-5 py-8 text-center text-faint">조건에 맞는 항목이 없습니다.</td></tr>}
            {shownLogs.map((l: any) => {
              const open = expanded.has(l.id);
              return (
              <Fragment key={l.id}>
              <tr className={`table-row ${open ? "bg-elevated/30" : l.needsReview ? "bg-danger/5" : ""}`}>
                <td className="px-5 py-3 whitespace-nowrap text-muted tabular-nums">{new Date(l.at).toLocaleString()}</td>
                <td className="px-3 py-3 font-mono text-xs text-muted">{l.repoSlug}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5 max-w-[16rem]">
                    <a href={`https://bitbucket.org/${ws}/${l.repoSlug}/pull-requests/${l.prId}`}
                      target="_blank" rel="noopener noreferrer" className="text-accent-2 hover:underline shrink-0">#{l.prId}</a>
                    <span className="text-muted truncate" title={l.prTitle}>{l.prTitle}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-muted">
                  {l.prAuthor
                    ? <span className="inline-flex items-center gap-1 max-w-[9rem] truncate" title={l.prAuthor}><User className="w-3 h-3 text-faint shrink-0" />{l.prAuthor}</span>
                    : <span className="text-faint">—</span>}
                </td>
                <td className="px-3 py-3 font-mono text-xs text-faint">{l.headCommit?.slice(0, 8)}</td>
                <td className="px-3 py-3 text-center">
                  <span title={l.status === "posted" ? "게시됨" : "오류"} className="text-base cursor-default select-none">{l.status === "posted" ? "✅" : "❌"}</span>
                </td>
                <td className="px-3 py-3 text-center">
                  {(() => {
                    const a = l.approval;
                    if (a === "approved") return <span title="PR 자동 승인됨" className="text-base cursor-default select-none">🟢</span>;
                    if (a === "changes") return <span title="변경 요청 — 자동 승인 보류" className="text-base cursor-default select-none">🔸</span>;
                    if (a === "failed") return <span title="승인 API 실패 (권한 등)" className="text-base cursor-default select-none">⚠️</span>;
                    return <span title="자동 승인 미사용" className="text-faint">—</span>;
                  })()}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {l.qualityScore != null ? (() => {
                    const q: number = l.qualityScore;
                    const color = l.riskLevel === "high" ? "text-danger" : l.riskLevel === "medium" ? "text-warn" : l.riskLevel === "low" ? "text-success" : "text-muted";
                    const riskKo = l.riskLevel === "high" ? "높음" : l.riskLevel === "medium" ? "중간" : l.riskLevel === "low" ? "낮음" : "미상";
                    return (
                      <span className="inline-flex items-center gap-1.5" title={`품질 ${q}/5 · 리스크 ${riskKo}${l.confidence ? ` · 확신 ${l.confidence}` : ""}`}>
                        <span className={`${color} tracking-tighter text-sm select-none`}>{"★".repeat(q)}<span className="text-faint">{"★".repeat(5 - q)}</span></span>
                        {l.needsReview && <span title="재검토 권장 — 자동승인이어도 확인 필요" className="select-none">🔺</span>}
                      </span>
                    );
                  })() : <span className="text-faint">—</span>}
                </td>
                <td className="px-3 py-3 text-center">
                  {l.message
                    ? <button onClick={() => toggleRow(l.id)} title={open ? "메모 접기" : "메모 펼치기"}
                        className="inline-flex items-center gap-0.5 text-muted hover:text-fg rounded px-1.5 py-0.5 hover:bg-elevated/60 transition-colors">
                        <span className="text-base leading-none select-none">💬</span>
                        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    : <span className="text-faint">—</span>}
                </td>
              </tr>
              {open && (l.message || l.reviewReasons?.length > 0) && (
                <tr className="bg-elevated/30">
                  <td colSpan={9} className="px-5 pb-3 pt-0 space-y-2">
                    {(l.filesChanged != null || l.linesChanged != null) && (
                      <div className="text-[11px] text-faint pt-1">변경 규모: {l.filesChanged ?? "?"}개 파일 · {l.linesChanged ?? "?"}줄</div>
                    )}
                    {l.reviewReasons?.length > 0 && (
                      <div className="rounded-lg border border-border bg-surface/50 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-faint mb-1.5">주요 지적 · 감점 사유</div>
                        <ul className="list-disc pl-4 text-xs text-muted space-y-0.5">
                          {l.reviewReasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
                        </ul>
                      </div>
                    )}
                    {l.message && (
                      <div className="rounded-lg border border-border bg-surface/50 p-3 text-xs text-muted whitespace-pre-wrap leading-relaxed">
                        {l.message}
                      </div>
                    )}
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
