// 관리 행위 감사 로그 — 구조화된 JSON 을 stdout 으로(`docker compose logs dashboard`).
// 로그인 성공/실패·계정/키 변경 등 보안 이벤트의 사후 추적·이상탐지 근거.
// 영속 저장/알림이 필요하면 후속으로 DB 테이블 또는 로그 수집기로 확장한다.
export function audit(event: string, detail: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), audit: event, ...detail }));
  } catch {
    console.log(`[audit] ${event}`);
  }
}
