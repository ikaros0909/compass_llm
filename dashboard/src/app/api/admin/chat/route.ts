// 관리자 플레이그라운드 채팅. 세션 인증(middleware)이 이미 적용된 경로.
// 멀티턴 메시지를 받아 Ollama 로 스트리밍 응답한다.
import { NextRequest } from "next/server";
import { chatStream, runningModels, gpuPlacement, type ChatMessage } from "@/lib/ollama";
import { logRequest } from "@/lib/apiKeys";

export const dynamic = "force-dynamic";

// 본문 끝에 메타데이터를 붙일 때 쓰는 구분자 (일반 텍스트엔 등장하지 않음)
const META_SEP = "\x1f";
const ENDPOINT = "/api/admin/chat"; // 플레이그라운드 — 개요/로그 통계에 포함

export async function POST(req: NextRequest) {
  const started = Date.now();
  const body = await req.json();
  const model: string = body.model;
  const incoming: ChatMessage[] = body.messages ?? [];
  const system: string | undefined = body.system?.trim();
  const temperature: number = body.temperature ?? 0.5;

  if (!model) return json({ error: "model is required" }, 400);
  if (!incoming.length) return json({ error: "messages is required" }, 400);

  const messages: ChatMessage[] = system
    ? [{ role: "system", content: system }, ...incoming]
    : incoming;

  const upstream = await chatStream(model, messages, { temperature }, req.signal);
  if (!upstream.ok || !upstream.body) {
    await logRequest({ endpoint: ENDPOINT, model, status: 502, latencyMs: Date.now() - started });
    return json({ error: "추론 서버 오류" }, 502);
  }

  // Ollama NDJSON → 텍스트 토큰만 흘려보냄. 마지막에 속도/GPU 메타데이터를 sentinel 로 첨부.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  let evalCount = 0, evalDurNs = 0, loadDurNs = 0, totalDurNs = 0, promptCount = 0;

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
              if (obj.message?.content) {
                controller.enqueue(enc.encode(obj.message.content));
              }
              // 최종(done) 라인에 성능 지표가 들어있음
              if (obj.eval_count) evalCount = obj.eval_count;
              if (obj.eval_duration) evalDurNs = obj.eval_duration;
              if (obj.load_duration) loadDurNs = obj.load_duration;
              if (obj.total_duration) totalDurNs = obj.total_duration;
              if (obj.prompt_eval_count) promptCount = obj.prompt_eval_count;
            } catch {
              /* 부분 라인 무시 */
            }
          }
        }
        // 생성 완료 → 속도 + GPU 배치 계산해서 메타데이터 전송
        const tokensPerSec = evalDurNs > 0 ? +(evalCount / (evalDurNs / 1e9)).toFixed(1) : 0;
        let backend = "unknown", gpuPct = 0;
        try {
          const running = await runningModels();
          const me = running.find((m) => m.name === model);
          if (me) ({ pct: gpuPct, backend } = gpuPlacement(me));
        } catch { /* ps 실패 시 unknown */ }
        const meta = { tokensPerSec, evalCount, promptCount, loadMs: Math.round(loadDurNs / 1e6), totalMs: Math.round(totalDurNs / 1e6), backend, gpuPct };
        controller.enqueue(enc.encode(META_SEP + JSON.stringify(meta)));
        // 개요/로그 통계에 반영 (플레이그라운드 사용량)
        await logRequest({
          endpoint: ENDPOINT, model, status: 200,
          latencyMs: Date.now() - started,
          inputTokens: promptCount, outputTokens: evalCount,
        }).catch(() => {});
      } catch {
        /* 클라이언트 중단(abort) 등 — 조용히 종료 */
      } finally {
        controller.close();
      }
    },
  });

  return new Response(out, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
