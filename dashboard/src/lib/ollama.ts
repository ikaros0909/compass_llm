// Ollama HTTP API 래퍼. 추론·모델 관리는 모두 여기를 경유한다.
const BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export interface OllamaTag {
  name: string;
  size: number;
  details?: { parameter_size?: string; quantization_level?: string };
}

export interface OllamaRunning {
  name: string;
  size: number;       // 모델 총 메모리 사용량
  size_vram: number;  // 그 중 GPU(VRAM) 에 올라간 양
  expires_at: string;
}

// 로드된 모델의 GPU/CPU 배치 비율 계산
export function gpuPlacement(m: { size: number; size_vram: number }) {
  const pct = m.size > 0 ? Math.round((m.size_vram / m.size) * 100) : 0;
  const backend = pct >= 99 ? "gpu" : pct <= 1 ? "cpu" : "partial";
  return { pct, backend } as { pct: number; backend: "gpu" | "cpu" | "partial" };
}

export async function listModels(): Promise<OllamaTag[]> {
  const r = await fetch(`${BASE}/api/tags`, { cache: "no-store" });
  if (!r.ok) throw new Error(`ollama /api/tags ${r.status}`);
  return (await r.json()).models ?? [];
}

export async function runningModels(): Promise<OllamaRunning[]> {
  const r = await fetch(`${BASE}/api/ps`, { cache: "no-store" });
  if (!r.ok) return [];
  return (await r.json()).models ?? [];
}

export async function deleteModel(name: string): Promise<void> {
  const r = await fetch(`${BASE}/api/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error(`ollama delete ${r.status}`);
}

// pull 진행률을 NDJSON 스트림으로 그대로 전달 (대시보드가 진행률 표시)
export async function pullModelStream(name: string): Promise<ReadableStream> {
  const r = await fetch(`${BASE}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, stream: true }),
  });
  if (!r.ok || !r.body) throw new Error(`ollama pull ${r.status}`);
  return r.body;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[]; // base64
}

// 비스트리밍 1회 응답 (코드리뷰 등 백그라운드 작업용). 최종 content 반환.
export async function chatComplete(
  model: string,
  messages: ChatMessage[],
  options?: { temperature?: number; num_ctx?: number },
): Promise<string> {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, options }),
  });
  if (!r.ok) throw new Error(`ollama chat ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.message?.content ?? "";
}

// 채팅 스트리밍 (NDJSON). 호출부에서 토큰/지연시간 집계.
// signal: 클라이언트가 끊으면 상류(Ollama) 생성도 취소되도록 전달.
export async function chatStream(
  model: string,
  messages: ChatMessage[],
  options?: { temperature?: number },
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, options }),
    signal,
  });
}
