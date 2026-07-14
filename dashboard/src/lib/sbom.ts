// SBOM 보안 — 저장소별 Trivy 스캔 실행 + 일일 폴러.
// 인증은 SBOM 설정 우선, 비어 있으면 코드리뷰(CodeReviewConfig) 설정을 재사용한다.
import { prisma } from "./db";
import { scanSbom } from "./worker";
import { parseRepoSlugs } from "./codereview";

async function resolveConfig() {
  const s = await prisma.sbomConfig.findUnique({ where: { id: "default" } });
  if (!s) return null;
  const cr = await prisma.codeReviewConfig.findUnique({ where: { id: "default" } });
  const workspace = (s.workspace || cr?.workspace || "").trim();
  const token = (s.token || cr?.token || "").trim();
  const authUsername = (s.authUsername || cr?.authUsername || "").trim();
  const repos = parseRepoSlugs(s.repoSlugs);
  return { s, workspace, token, authUsername, repos };
}

let scanRunning = false;

export async function runSbomScans(): Promise<{ scanned: number; errors: number; details: string[] }> {
  if (scanRunning) return { scanned: 0, errors: 0, details: ["이미 스캔이 진행 중입니다."] };
  scanRunning = true;
  const out = { scanned: 0, errors: 0, details: [] as string[] };
  try {
    const cfg = await resolveConfig();
    if (!cfg) { out.details.push("설정 없음"); return out; }
    const { workspace, token, authUsername, repos } = cfg;
    if (!workspace || !token || repos.length === 0) {
      out.details.push("설정 미완료 (workspace·token·저장소 필요 — 비우면 코드리뷰 설정 재사용)");
      return out;
    }

    // 동시성 제한(2) 으로 순차 과부하 방지
    const queue = [...repos];
    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      while (queue.length) {
        const repoSlug = queue.shift()!;
        const started = Date.now();
        try {
          const res = await scanSbom({ workspace, repoSlug, token, authUsername });
          const c = res.counts;
          await prisma.$transaction([
            prisma.sbomScan.create({
              data: {
                repoSlug, commit: res.commit, status: "ok",
                critical: c.critical, high: c.high, medium: c.medium, low: c.low, unknown: c.unknown,
                total: res.total, durationMs: Date.now() - started,
              },
            }),
            prisma.sbomFinding.deleteMany({ where: { repoSlug } }),
            prisma.sbomFinding.createMany({
              data: res.findings.map((f) => ({ repoSlug, ...f })),
            }),
          ]);
          out.scanned++;
          out.details.push(`[${repoSlug}] C${c.critical}·H${c.high}·M${c.medium}·L${c.low} (총 ${res.total})`);
        } catch (e: any) {
          out.errors++;
          await prisma.sbomScan.create({
            data: { repoSlug, status: "error", durationMs: Date.now() - started, message: (e?.message ?? "오류").slice(0, 500) },
          }).catch(() => {});
          out.details.push(`[${repoSlug}] 오류: ${(e?.message ?? "").slice(0, 120)}`);
        }
      }
    });
    await Promise.all(workers);
    return out;
  } finally {
    scanRunning = false;
  }
}

// 일일 폴러: 매 분 확인, 설정 시각(scanHour) 이후 하루 1회만 실행
let lastRunDate = "";
let running = false;
export function startSbomPoller() {
  setInterval(async () => {
    if (running) return;
    try {
      const s = await prisma.sbomConfig.findUnique({ where: { id: "default" } });
      if (!s?.enabled) return;
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      if (lastRunDate === today) return; // 오늘 이미 실행
      if (now.getHours() < s.scanHour) return; // 아직 지정 시각 전
      running = true;
      lastRunDate = today;
      const res = await runSbomScans();
      console.log(`[sbom] scanned=${res.scanned} errors=${res.errors}`);
    } catch (e) {
      console.error("[sbom] poll error", e);
    } finally {
      running = false;
    }
  }, 60_000);
  console.log("[sbom] poller started");
}
