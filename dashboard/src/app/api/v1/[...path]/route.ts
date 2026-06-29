// 워커가 처리하는 공개 엔드포인트(rag, transcribe, video, chat-upload, models)를
// 인증 후 그대로 프록시. /chat, /health 는 명시적 route 가 우선한다.
import { NextRequest } from "next/server";
import { validateKey, checkRateLimit, logRequest, extractToken } from "@/lib/apiKeys";
import { proxyToWorker } from "@/lib/worker";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest, ctx: { params: { path: string[] } }) {
  const started = Date.now();
  const sub = "/" + ctx.params.path.join("/");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const token = extractToken(req);
  if (!token) return json({ error: "API 키가 필요합니다. 'Authorization: Bearer <API_KEY>' 헤더를 사용하세요." }, 401);
  const key = await validateKey(token);
  if (!key) return json({ error: "유효하지 않은 API 키." }, 403);
  if (!(await checkRateLimit(key.id, key.rateLimit))) return json({ error: "요청 한도 초과." }, 429);

  // 워커는 /rag, /transcribe, /video 등을 동일 경로로 노출
  const resp = await proxyToWorker(sub, req);
  await logRequest({
    apiKeyId: key.id, endpoint: `/api/v1${sub}`, status: resp.status,
    latencyMs: Date.now() - started, clientIp: ip,
  });
  return resp;
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
