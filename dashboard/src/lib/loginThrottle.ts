// 로그인 브루트포스 완화 — 프로세스 메모리 기반 슬라이딩 카운터.
// 단일 대시보드 인스턴스 기준. 다중 인스턴스로 확장 시 공유 스토어(Redis 등)로 교체.
type Entry = { fails: number; resetAt: number; blockedUntil: number };

const attempts = new Map<string, Entry>();
const WINDOW_MS = 15 * 60_000; // 실패 집계 창: 15분
const MAX_FAILS = 5; // 창 내 허용 실패 횟수
const BLOCK_MS = 15 * 60_000; // 초과 시 차단 시간: 15분

// 차단 중이면 남은 초, 아니면 0.
export function loginBlockedFor(key: string): number {
  const e = attempts.get(key);
  if (e && e.blockedUntil > Date.now()) return Math.ceil((e.blockedUntil - Date.now()) / 1000);
  return 0;
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  let e = attempts.get(key);
  if (!e || e.resetAt < now) e = { fails: 0, resetAt: now + WINDOW_MS, blockedUntil: 0 };
  e.fails += 1;
  if (e.fails >= MAX_FAILS) e.blockedUntil = now + BLOCK_MS;
  attempts.set(key, e);
}

export function recordLoginSuccess(key: string): void {
  attempts.delete(key);
}
