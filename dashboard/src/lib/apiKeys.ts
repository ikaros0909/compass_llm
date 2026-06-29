// 공개 API 키 관리 — 기존 Python api_keys.py 를 Prisma 로 이식.
import { createHash, randomBytes } from "crypto";
import { prisma } from "./db";

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

// 단일 토큰 발급 (OpenAI 스타일). DB 에는 해시만 저장하고 토큰은 이때 1회만 반환.
export async function generateKey(name: string, rateLimit = 30) {
  const token = "sk-" + randomBytes(32).toString("hex");
  const display = token.slice(0, 11) + "…" + token.slice(-4); // 표시용 prefix
  await prisma.apiKey.create({
    data: { name, apiKey: display, secretHash: sha256(token), rateLimit },
  });
  return { apiKey: token }; // 전체 토큰은 이 응답에서만 노출
}

// 요청에서 토큰 추출: Authorization: Bearer > X-Secret-Key(구키 호환) > X-API-Key
export function extractToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const secret = (req.headers.get("x-secret-key") ?? "").trim(); // 구 2-키 클라이언트 호환
  if (secret) return secret;
  return (req.headers.get("x-api-key") ?? "").trim();
}

// 단일 토큰 검증 — 해시로 조회. (구 키는 secretKey 가 곧 토큰이 되어 그대로 검증됨)
export async function validateKey(token: string) {
  if (!token) return null;
  const row = await prisma.apiKey.findUnique({ where: { secretHash: sha256(token) } });
  if (!row || !row.isActive) return null;
  return row;
}

// 분당 요청 수 제한 — RequestLog 기반 슬라이딩 윈도우
export async function checkRateLimit(apiKeyId: string, limitPerMin: number) {
  const since = new Date(Date.now() - 60_000);
  const count = await prisma.requestLog.count({
    where: { apiKeyId, createdAt: { gte: since } },
  });
  return count < limitPerMin;
}

export async function logRequest(entry: {
  apiKeyId?: string | null;
  endpoint: string;
  model?: string | null;
  status: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  clientIp?: string | null;
}) {
  await prisma.requestLog.create({
    data: {
      apiKeyId: entry.apiKeyId ?? null,
      endpoint: entry.endpoint,
      model: entry.model ?? null,
      status: entry.status,
      latencyMs: entry.latencyMs,
      inputTokens: entry.inputTokens ?? 0,
      outputTokens: entry.outputTokens ?? 0,
      clientIp: entry.clientIp ?? null,
    },
  });
}
