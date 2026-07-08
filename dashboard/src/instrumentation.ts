// Next.js 서버 부팅 시 1회 실행 (관리자 시드 + 지표 수집기 기동).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureAdminSeed } = await import("./lib/auth");
  const { startMetricsCollector } = await import("./lib/metrics");
  const { startCodeReviewPoller } = await import("./lib/codereview");
  try {
    await ensureAdminSeed();
  } catch (e) {
    console.error("[boot] admin seed failed (db not ready?)", e);
  }
  startMetricsCollector();
  startCodeReviewPoller();
}
