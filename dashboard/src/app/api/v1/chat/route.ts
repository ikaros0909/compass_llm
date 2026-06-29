// 공개 채팅 API. X-API-Key 인증 → Rate limit → Ollama 스트리밍 →
// 토큰/지연시간 집계 후 RequestLog 적재.
import { NextRequest } from "next/server";
import { validateKey, checkRateLimit, logRequest, extractToken } from "@/lib/apiKeys";
import { chatStream, type ChatMessage } from "@/lib/ollama";
import { ragSearch } from "@/lib/worker";

export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "gemma4:26b";

function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  const token = extractToken(req);
  const ip = clientIp(req);

  if (!token) {
    return json({ error: "API 키가 필요합니다. 'Authorization: Bearer <API_KEY>' 헤더를 사용하세요." }, 401);
  }
  const key = await validateKey(token);
  if (!key) return json({ error: "유효하지 않거나 비활성화된 API 키입니다." }, 403);
  if (!(await checkRateLimit(key.id, key.rateLimit))) {
    await logRequest({ apiKeyId: key.id, endpoint: "/api/v1/chat", status: 429, latencyMs: Date.now() - started, clientIp: ip });
    return json({ error: `요청 한도 초과 (분당 ${key.rateLimit}회).` }, 429);
  }

  const body = await req.json();
  const model: string = body.model ?? DEFAULT_MODEL;

  // RAG: 컬렉션 지정 시 관련 문서를 검색해 질문에 컨텍스트로 덧붙임
  let userContent: string = body.message;
  if (body.rag_collection) {
    const chunks = await ragSearch(body.rag_collection, body.message, { mode: body.rag_mode ?? "search" });
    if (chunks.length) {
      const context = chunks.map((c) => c.content).join("\n\n");
      userContent = `[참고 문서]\n${context}\n\n[질문]\n${body.message}`;
    }
  }

  const messages: ChatMessage[] = [
    { role: "system", content: body.system_prompt ?? "You are a helpful AI assistant. Answer in Korean." },
    { role: "user", content: userContent, images: body.images },
  ];

  const upstream = await chatStream(model, messages, {
    temperature: body.temperature ?? 0.5,
  }, req.signal);
  if (!upstream.ok || !upstream.body) {
    await logRequest({ apiKeyId: key.id, endpoint: "/api/v1/chat", model, status: 502, latencyMs: Date.now() - started, clientIp: ip });
    return json({ error: "추론 서버 오류" }, 502);
  }

  // Ollama NDJSON → 텍스트 토큰만 클라이언트로 흘리고, 끝에서 usage 집계 로깅
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let inTok = 0;
  let outTok = 0;

  const enc = new TextEncoder();
  const out = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);
              if (obj.message?.content) controller.enqueue(enc.encode(obj.message.content));
              if (obj.prompt_eval_count) inTok = obj.prompt_eval_count;
              if (obj.eval_count) outTok = obj.eval_count;
            } catch { /* 부분 라인 무시 */ }
          }
        }
      } catch { /* 클라이언트 중단 등 */ } finally {
        await logRequest({
          apiKeyId: key.id, endpoint: "/api/v1/chat", model, status: 200,
          latencyMs: Date.now() - started, inputTokens: inTok, outputTokens: outTok, clientIp: ip,
        }).catch(() => {});
        controller.close();
      }
    },
  });

  return new Response(out, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
