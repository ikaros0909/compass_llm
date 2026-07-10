// Bitbucket Cloud 자동 코드리뷰.
// - 열린 PR 을 주기적으로 조회 → 새 head 커밋이면 diff 를 모델로 리뷰 → 요약 코멘트 1건 게시.
// - token 은 서버 전용(DB), 클라이언트에 노출하지 않는다.
import { createHash } from "crypto";
import { prisma } from "./db";
import { chatComplete } from "./ollama";

const API = "https://api.bitbucket.org/2.0";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const DEFAULT_SYSTEM_PROMPT =
  "당신은 숙련된 시니어 소프트웨어 엔지니어이자 코드 리뷰어입니다. " +
  "아래 Pull Request 의 변경사항(unified diff)을 검토하고 한국어로 리뷰를 작성하세요. " +
  "버그·보안·성능·가독성·유지보수성 관점에서 구체적으로(파일/함수 언급) 지적하고, 잘한 점도 짧게 언급하세요. " +
  "확실하지 않으면 단정하지 말고 '확인 필요'로 표기하세요. 마지막에 한 줄 총평을 남기고, " +
  "그 아래에 어떤 모델로 리뷰했는지 '🧠 리뷰 모델: <모델명>' 형식으로 표기하세요.";

type Auth = { workspace: string; authUsername: string; token: string };

function authHeader(cfg: { authUsername: string; token: string }) {
  if (cfg.authUsername) {
    const b = Buffer.from(`${cfg.authUsername}:${cfg.token}`).toString("base64");
    return `Basic ${b}`; // App Password / API 토큰(이메일) 방식
  }
  return `Bearer ${cfg.token}`; // Access Token 방식
}

// 특정 저장소에 대한 요청
async function bbRepo(cfg: Auth, repoSlug: string, path: string, init?: RequestInit) {
  return fetch(`${API}/repositories/${cfg.workspace}/${repoSlug}${path}`, {
    ...init,
    headers: { Authorization: authHeader(cfg), Accept: "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
}

export function parseRepoSlugs(csv: string): string[] {
  return (csv ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// workspace 에서 접근 가능한 저장소 목록 (드롭다운용)
export async function listRepos(cfg: { workspace: string; authUsername: string; token: string }) {
  if (!cfg.workspace || !cfg.token) return { ok: false, message: "workspace·token 을 입력하세요.", repos: [] as { slug: string; name: string; fullName: string }[] };
  try {
    const repos: { slug: string; name: string; fullName: string }[] = [];
    let url: string | null = `${API}/repositories/${encodeURIComponent(cfg.workspace)}?role=member&pagelen=100&sort=-updated_on`;
    let pages = 0;
    while (url && pages < 10) {
      const r: Response = await fetch(url, { headers: { Authorization: authHeader(cfg), Accept: "application/json" }, cache: "no-store" });
      if (!r.ok) return { ok: false, message: `Bitbucket ${r.status}: ${(await r.text()).slice(0, 200)}`, repos: [] };
      const j: any = await r.json();
      for (const v of j.values ?? []) repos.push({ slug: v.slug, name: v.name, fullName: v.full_name });
      url = j.next ?? null;
      pages++;
    }
    return { ok: true, message: `저장소 ${repos.length}개`, repos };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? "조회 실패", repos: [] };
  }
}

const MAX_DIFF = 16000; // 컨텍스트 보호용 diff 절단 길이
const MAX_STORED_REVIEW = 20000; // 이력에 저장할 리뷰 본문 최대 길이(펼쳐보기용 — 사실상 전문)

const RISK_KO: Record<string, string> = { low: "낮음", medium: "중간", high: "높음" };

// 보안·민감 영역으로 간주할 파일 경로 키워드
const SENSITIVE_RE = /(auth|login|passwo?rd|secret|token|crypto|security|\.env|payment|billing|jwt|oauth|credential|session|sql|migration|admin)/i;
const TEST_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/i;

interface DiffStats { files: number; additions: number; deletions: number; sensitive: string[]; hasTests: boolean }

// LLM 과 무관하게 diff 자체에서 계산하는 객관 지표.
function analyzeDiff(diff: string): DiffStats {
  const paths: string[] = [];
  let additions = 0, deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) {
      const m = line.match(/ b\/(.+)$/);
      if (m) paths.push(m[1]);
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    } else if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  const sensitive = Array.from(new Set(
    paths.filter((f) => SENSITIVE_RE.test(f)).map((f) => (f.match(SENSITIVE_RE) as RegExpMatchArray)[1].toLowerCase()),
  ));
  return { files: paths.length, additions, deletions, sensitive, hasTests: paths.some((f) => TEST_RE.test(f)) };
}

interface ReviewMeta { quality: number | null; risk: string; confidence: string; reasons: string[] }

// 리뷰 끝의 [[META]]{...} JSON 을 파싱하고 본문에서 제거한다.
// JSON 이 깨졌더라도 [[META]] 마커 이후는 항상 잘라내 코멘트에 노출되지 않게 한다.
function parseMeta(text: string): { cleaned: string; meta: ReviewMeta | null } {
  const idx = text.indexOf("[[META]]");
  if (idx === -1) return { cleaned: text.trim(), meta: null };
  const cleaned = text.slice(0, idx).trim();
  const json = text.slice(idx + "[[META]]".length).match(/\{[\s\S]*\}/);
  if (!json) return { cleaned, meta: null };
  try {
    const j = JSON.parse(json[0]);
    const qn = Math.round(Number(j.quality));
    const quality = Number.isFinite(qn) ? Math.max(1, Math.min(5, qn)) : null;
    const norm = (v: unknown) => (["low", "medium", "high"].includes(String(v)) ? String(v) : "");
    const reasons = Array.isArray(j.reasons) ? j.reasons.map((r: unknown) => String(r).slice(0, 200)).slice(0, 5) : [];
    return { cleaned, meta: { quality, risk: norm(j.risk), confidence: norm(j.confidence), reasons } };
  } catch {
    return { cleaned, meta: null };
  }
}

// 동시 실행 방지 잠금: 리뷰 생성이 폴링 주기보다 오래 걸려도(또는 수동 실행이 겹쳐도)
// 같은 PR 이 중복 리뷰되지 않도록 한 번에 하나의 runReview 만 실행.
let reviewRunning = false;

export async function runReview(): Promise<{ reviewed: number; skipped: number; errors: number; details: string[] }> {
  if (reviewRunning) {
    return { reviewed: 0, skipped: 0, errors: 0, details: ["이미 리뷰가 진행 중입니다 — 이번 실행은 건너뜁니다."] };
  }
  reviewRunning = true;
  try {
    return await runReviewInner();
  } finally {
    reviewRunning = false;
  }
}

async function runReviewInner(): Promise<{ reviewed: number; skipped: number; errors: number; details: string[] }> {
  const cfg = await prisma.codeReviewConfig.findUnique({ where: { id: "default" } });
  const out = { reviewed: 0, skipped: 0, errors: 0, details: [] as string[] };
  if (!cfg) { out.details.push("설정 없음"); return out; }
  const repos = parseRepoSlugs(cfg.repoSlugs);
  if (!cfg.workspace || repos.length === 0 || !cfg.token || !cfg.model) {
    out.details.push("설정 미완료 (workspace·저장소·token·model 필요)"); return out;
  }

  for (const repoSlug of repos) {
    const listRes = await bbRepo(cfg, repoSlug, `/pullrequests?state=OPEN&pagelen=50`);
    if (!listRes.ok) { out.errors++; out.details.push(`[${repoSlug}] PR 목록 오류 ${listRes.status}: ${(await listRes.text()).slice(0, 120)}`); continue; }
    const prs: any[] = (await listRes.json()).values ?? [];

    for (const pr of prs) {
      const head: string = pr.source?.commit?.hash ?? "";
      const author: string = pr.author?.display_name ?? pr.author?.nickname ?? "";
      // 1) 같은 커밋을 이미 리뷰했으면 즉시 스킵 (diff 조회 불필요 — 빠른 경로)
      const byCommit = await prisma.codeReviewLog.findFirst({ where: { repoSlug, prId: pr.id, headCommit: head, status: "posted" } });
      if (byCommit) { out.skipped++; continue; }
      try {
        const diffRes = await bbRepo(cfg, repoSlug, `/pullrequests/${pr.id}/diff`);
        if (!diffRes.ok) throw new Error(`diff ${diffRes.status}`);
        const fullDiff = await diffRes.text();
        const diffHash = sha256(fullDiff);
        // 2) 커밋 해시는 달라졌지만 실제 변경 내용(diff)이 동일하면 스킵 (리베이스·머지·CI 봇 커밋 등으로 코드는 그대로)
        const byDiff = await prisma.codeReviewLog.findFirst({ where: { repoSlug, prId: pr.id, diffHash, status: "posted" } });
        if (byDiff) { out.skipped++; out.details.push(`[${repoSlug}] #${pr.id} 코드 변경 없음 — 재리뷰 생략(커밋만 변경)`); continue; }
        let diff = fullDiff;
        const truncated = diff.length > MAX_DIFF;
        if (truncated) diff = diff.slice(0, MAX_DIFF) + "\n... (diff 가 길어 이후 생략됨)";

        let sys = `${cfg.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT}\n\n(참고: 이 리뷰에 사용된 모델명은 정확히 "${cfg.model}" 입니다. 모델명을 표기할 때 이 값을 그대로 사용하세요.)`;
        if (cfg.autoApprove) {
          sys += `\n\n리뷰 본문 아래에 다음 중 하나만 정확히 출력하세요: ` +
            `"[VERDICT: APPROVE]" (버그·보안·설계상 중대한 문제가 없어 그대로 머지 가능) 또는 ` +
            `"[VERDICT: CHANGES]" (수정이 필요함). 조금이라도 애매하거나 확신이 없으면 반드시 CHANGES 로 하세요.`;
        }
        // 품질 척도(5점) — 응답의 가장 마지막 줄에 기계 판독용 JSON 을 강제.
        sys += `\n\n그리고 응답의 가장 마지막 줄에 아래 형식의 메타데이터를 반드시 한 줄로 출력하세요(설명 없이 JSON 만):\n` +
          `[[META]]{"quality":<1~5 정수>,"risk":"low|medium|high","confidence":"low|medium|high","reasons":["짧은 사유"]}\n` +
          `- quality(코드 품질): 5=매우 우수(문제 거의 없음) · 4=양호(사소한 개선) · 3=보통(몇 가지 수정 권장) · 2=우려(중요한 문제) · 1=심각(버그·보안 등 중대)\n` +
          `- risk=버그·보안 등 실제 문제 가능성, confidence=이 판단의 확신도(diff 가 잘렸거나 컨텍스트가 부족하면 낮게), reasons=감점·우려 근거를 3개 이내로 짧게.`;
        let review = await chatComplete(cfg.model, [
          { role: "system", content: sys },
          {
            role: "user",
            content:
              `저장소: ${repoSlug}\nPull Request #${pr.id}: ${pr.title}\n` +
              `대상 브랜치: ${pr.destination?.branch?.name ?? "?"} ← ${pr.source?.branch?.name ?? "?"}\n\n` +
              `[변경사항 diff]\n${diff}`,
          },
        ], { temperature: 0.2 });

        // 모델의 승인 의견(VERDICT) — 실제 자동승인은 아래 게이트를 함께 통과해야 함
        const approveVerdict = cfg.autoApprove && /\[VERDICT:\s*APPROVE\]/i.test(review);
        // 품질 메타 파싱 + 태그(VERDICT·META)를 코멘트 본문에서 제거
        const { cleaned, meta } = parseMeta(review);
        review = cleaned.replace(/\[VERDICT:\s*(APPROVE|CHANGES)\]/ig, "").trim();

        const quality = meta?.quality ?? null;
        const risk = meta?.risk ?? "";
        const confidence = meta?.confidence ?? "";

        // 객관 지표(diff 기반) — LLM 자가평가를 보완
        const stats = analyzeDiff(fullDiff);
        const linesChanged = stats.additions + stats.deletions;
        const bigChange = linesChanged > 400 || stats.files > 15;
        const heuristicReasons: string[] = [];
        if (stats.sensitive.length) heuristicReasons.push(`민감 영역 변경: ${stats.sensitive.slice(0, 5).join(", ")}`);
        if (bigChange) heuristicReasons.push(`변경 규모 큼: ${stats.files}개 파일 · +${stats.additions}/−${stats.deletions}`);
        if (truncated) heuristicReasons.push("diff 가 길어 일부만 검토됨");
        if (!stats.hasTests && stats.additions > 80) heuristicReasons.push("테스트 변경 없이 로직 추가");

        // 자동승인 게이트: 모델이 APPROVE 여도 위험 신호가 있으면 승인 보류(안전 기본값)
        const gateBlock =
          truncated || risk === "high" || confidence === "low" ||
          (quality != null && quality <= 2) || stats.sensitive.length > 0;
        const approve = approveVerdict && !gateBlock;
        if (approveVerdict && !approve) heuristicReasons.unshift("모델은 APPROVE 였으나 위험 신호로 자동승인 보류");

        // 자동승인이어도 사람이 다시 볼 것을 권장하는 신호
        const needsReview =
          gateBlock || bigChange ||
          (cfg.autoApprove && approveVerdict && risk === "medium");
        const reasons = [...(meta?.reasons ?? []), ...heuristicReasons];

        const verdictLine = cfg.autoApprove
          ? (approve ? `\n\n✅ **자동 승인** — 중대한 문제가 발견되지 않았습니다.`
                     : "\n\n🔸 **변경 요청** — 확인이 필요한 사항이 있어 자동 승인은 보류했습니다.")
          : "";
        const scoreLine = quality != null
          ? `\n\n📊 **코드 품질 ${"★".repeat(quality)}${"☆".repeat(5 - quality)} (${quality}/5)**` +
            ` · 리스크: ${RISK_KO[risk] ?? "미상"} · 확신: ${RISK_KO[confidence] ?? "미상"}` +
            (needsReview ? " · 🔺 사람 재검토 권장" : "")
          : "";
        const body =
          `🤖 **자동 코드리뷰** · 모델 \`${cfg.model}\`\n\n${review}${verdictLine}${scoreLine}\n\n` +
          `---\n_커밋 \`${head.slice(0, 8)}\` 기준 자동 생성${truncated ? " · diff 일부 생략" : ""}_`;

        // ① 리뷰 코멘트를 먼저 게시
        const post = await bbRepo(cfg, repoSlug, `/pullrequests/${pr.id}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: { raw: body } }),
        });
        if (!post.ok) throw new Error(`코멘트 게시 ${post.status}: ${(await post.text()).slice(0, 120)}`);
        const pj = await post.json().catch(() => ({}));

        // ② 코멘트 게시가 끝난 뒤에 승인 처리
        let approveOk = false;
        if (approve) {
          const appr = await bbRepo(cfg, repoSlug, `/pullrequests/${pr.id}/approve`, { method: "POST" });
          approveOk = appr.ok;
        }
        // 승인 상태: "" 미사용 | approved 승인됨 | changes 변경요청 | failed 승인API실패
        const approval = !cfg.autoApprove ? "" : (approve ? (approveOk ? "approved" : "failed") : "changes");

        await prisma.codeReviewLog.create({
          data: {
            repoSlug, prId: pr.id, prTitle: pr.title, prAuthor: author, headCommit: head, diffHash,
            status: "posted", approval, message: review.slice(0, MAX_STORED_REVIEW), commentId: String(pj.id ?? ""),
            qualityScore: quality, riskLevel: risk, confidence, needsReview, reviewReasons: JSON.stringify(reasons),
            filesChanged: stats.files, linesChanged,
          },
        });
        const approveDetail = !cfg.autoApprove ? "" : (approve ? (approveOk ? " · ✅ 승인" : " · ⚠ 승인실패") : " · 변경요청");
        out.reviewed++; out.details.push(`[${repoSlug}] #${pr.id} 리뷰 게시${approveDetail}`);
      } catch (e: any) {
        out.errors++;
        await prisma.codeReviewLog.create({
          data: { repoSlug, prId: pr.id, prTitle: pr.title, prAuthor: author, headCommit: head, status: "error", message: (e?.message ?? "오류").slice(0, 500) },
        }).catch(() => {});
        out.details.push(`[${repoSlug}] #${pr.id} 오류: ${e?.message ?? ""}`);
      }
    }
  }
  return out;
}

// 주기 폴러: 매 분 체크하고, 설정된 intervalMin 간격으로만 실제 실행
let lastRun = 0;
let running = false;
export function startCodeReviewPoller() {
  setInterval(async () => {
    if (running) return;
    try {
      const cfg = await prisma.codeReviewConfig.findUnique({ where: { id: "default" } });
      if (!cfg?.enabled) return;
      if (Date.now() - lastRun < Math.max(1, cfg.intervalMin) * 60_000) return;
      running = true;
      lastRun = Date.now();
      const res = await runReview();
      console.log(`[codereview] reviewed=${res.reviewed} skipped=${res.skipped} errors=${res.errors}`);
    } catch (e) {
      console.error("[codereview] poll error", e);
    } finally {
      running = false;
    }
  }, 60_000);
  console.log("[codereview] poller started");
}
