// 세션 서명 키 로더 (Edge/Node 공용 — Node 전용 의존성 없음).
// 폴백 비밀값을 두지 않는다: 미설정/취약 시 즉시 실패(fail-closed)하여
// 예측 가능한 키로 JWT 가 서명·검증되는 것을 원천 차단한다.
let cached: Uint8Array | null = null;

export function authSecret(): Uint8Array {
  if (cached) return cached;
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "AUTH_SECRET 가 설정되지 않았거나 너무 짧습니다(최소 16자, 권장 32 hex). " +
        "`openssl rand -hex 32` 로 생성해 .env 에 설정하세요.",
    );
  }
  cached = new TextEncoder().encode(s);
  return cached;
}
