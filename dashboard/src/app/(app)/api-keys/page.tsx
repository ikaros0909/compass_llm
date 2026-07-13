"use client";
import useSWR from "swr";
import { useState, useEffect } from "react";
import { fetcher } from "@/lib/fetcher";
import PageHeader from "@/components/PageHeader";
import { KeyRound, Plus, Trash2, Power, Copy, TriangleAlert, Check, Terminal, BookOpen } from "lucide-react";

export default function ApiKeysPage() {
  const { data, mutate } = useSWR("/api/admin/keys", fetcher, { refreshInterval: 10000 });
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ apiKey: string } | null>(null);
  const [copied, setCopied] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [showDocs, setShowDocs] = useState(false);

  useEffect(() => {
    setEndpoint(`${window.location.origin}/api/v1/chat`);
  }, []);

  async function create() {
    if (!name.trim()) return;
    const r = await fetch("/api/admin/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setCreated(await r.json());
    setName("");
    mutate();
  }
  async function toggle(id: string, isActive: boolean) {
    await fetch("/api/admin/keys", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, isActive: !isActive }) });
    mutate();
  }
  async function del(id: string) {
    if (!confirm("삭제하면 복구할 수 없습니다. 계속할까요?")) return;
    await fetch(`/api/admin/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    mutate();
  }
  function copy(text: string, which: string) {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(""), 1500);
  }

  const keys = data?.keys ?? [];

  return (
    <div>
      <PageHeader title="API 키" desc="외부 시스템이 공개 API 를 호출할 때 사용하는 인증 키">
        <button className="btn-ghost" onClick={() => setShowDocs((s) => !s)}>
          <BookOpen className="w-4 h-4" /> API 사용 설명서
        </button>
      </PageHeader>

      {/* 항상 볼 수 있는 사용 설명서 (키 발급과 무관) */}
      {showDocs && (
        <div className="card mb-4 animate-fade-in">
          <div className="text-sm text-muted mb-1">
            아래 예시의 <code className="font-mono text-accent-2">&lt;YOUR_API_KEY&gt;</code> 자리에 발급받은 키를 넣어 호출하세요.
          </div>
          <UsageExample endpoint={endpoint} apiKey="<YOUR_API_KEY>" />
        </div>
      )}

      <div className="card mb-4">
        <label className="label">새 API 키 발급</label>
        <div className="flex gap-2 items-center">
          <input className="input" placeholder="키 이름 (예: 모바일 앱, 사내 챗봇)" value={name}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          <button className="btn whitespace-nowrap" onClick={create}><Plus className="w-4 h-4" /> 발급</button>
        </div>
      </div>

      {created && (
        <div className="card mb-4 ring-1 ring-warn/40 bg-warn/5 animate-fade-in">
          <div className="flex items-center gap-2 text-warn text-sm font-medium mb-3">
            <TriangleAlert className="w-4 h-4" /> 이 API 키는 지금만 확인할 수 있습니다. 안전한 곳에 보관하세요.
          </div>
          <KeyRow label="Endpoint" value={endpoint} copied={copied === "ep"} onCopy={() => copy(endpoint, "ep")} />
          <KeyRow label="API Key" value={created.apiKey} copied={copied === "ak"} onCopy={() => copy(created.apiKey, "ak")} />
          <UsageExample endpoint={endpoint} apiKey={created.apiKey} />
          <button className="btn-ghost mt-3" onClick={() => setCreated(null)}>확인했습니다</button>
        </div>
      )}

      <div className="card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[40rem]">
          <thead className="text-muted text-left text-xs uppercase tracking-wide">
            <tr className="border-b border-border">
              <th className="font-medium px-5 py-3">이름</th>
              <th className="font-medium px-3 py-3">API Key</th>
              <th className="font-medium px-3 py-3">24h 사용</th>
              <th className="font-medium px-3 py-3">분당 한도</th>
              <th className="font-medium px-3 py-3">상태</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-12 text-center text-faint">
                <KeyRound className="w-8 h-8 mx-auto mb-2 opacity-50" /> 발급된 키가 없습니다.
              </td></tr>
            )}
            {keys.map((k: any) => (
              <tr key={k.apiKey} className="table-row">
                <td className="px-5 py-3.5 font-medium">{k.name}</td>
                <td className="px-3 py-3.5 font-mono text-xs text-muted">{k.apiKey}</td>
                <td className="px-3 py-3.5 tabular-nums">{k.usage24h}</td>
                <td className="px-3 py-3.5 text-muted">{k.rateLimit}/분</td>
                <td className="px-3 py-3.5">
                  {k.isActive ? <span className="badge badge-on">활성</span> : <span className="badge badge-off">비활성</span>}
                </td>
                <td className="px-5 py-3.5 text-right space-x-1.5 whitespace-nowrap">
                  <button className="btn-ghost !px-2.5 !py-1.5 !text-xs" onClick={() => toggle(k.id, k.isActive)}>
                    <Power className="w-3.5 h-3.5" /> {k.isActive ? "비활성" : "활성"}
                  </button>
                  <button className="btn-danger" onClick={() => del(k.id)}><Trash2 className="w-3.5 h-3.5" /> 삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

const PARAMS: { name: string; type: string; required: boolean; desc: string }[] = [
  { name: "message", type: "string", required: true, desc: "사용자 입력 메시지" },
  { name: "model", type: "string", required: false, desc: "추론 모델 (기본 gemma4:26b)" },
  { name: "system_prompt", type: "string", required: false, desc: "시스템 프롬프트 (역할/규칙 지정)" },
  { name: "temperature", type: "number", required: false, desc: "창의성 0~1 (기본 0.5)" },
  { name: "rag_collection", type: "string", required: false, desc: "참조할 RAG 컬렉션 이름 (RAG 메뉴에서 생성·업로드)" },
  { name: "rag_mode", type: "string", required: false, desc: "search(유사도 검색, 기본) 또는 full(전체 문서)" },
  { name: "images", type: "string[]", required: false, desc: "이미지 base64 배열 (비전 모델용)" },
];

function buildSnippets(ep: string, apiKey: string) {
  const url = ep || "https://<서버주소>/api/v1/chat";
  return {
    curl: `curl -N -X POST ${url} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{
    "message": "안녕하세요, 자기소개 해주세요.",
    "model": "gemma4:26b",
    "temperature": 0.5
  }'`,
    javascript: `const res = await fetch("${url}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${apiKey}",
  },
  body: JSON.stringify({
    message: "안녕하세요, 자기소개 해주세요.",
    model: "gemma4:26b",
    temperature: 0.5,
  }),
});

// 응답은 text/plain 스트리밍 — 토큰 단위로 도착합니다.
const reader = res.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  process.stdout.write(decoder.decode(value, { stream: true }));
}`,
    python: `import requests

resp = requests.post(
    "${url}",
    headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer ${apiKey}",
    },
    json={
        "message": "안녕하세요, 자기소개 해주세요.",
        "model": "gemma4:26b",
        "temperature": 0.5,
    },
    stream=True,
)
# 응답은 text/plain 스트리밍 — 청크 단위로 출력
for chunk in resp.iter_content(chunk_size=None):
    print(chunk.decode("utf-8"), end="", flush=True)`,
  };
}

const TABS: { key: "curl" | "javascript" | "python"; label: string }[] = [
  { key: "curl", label: "cURL" },
  { key: "javascript", label: "JavaScript" },
  { key: "python", label: "Python" },
];

function UsageExample({ endpoint, apiKey }: { endpoint: string; apiKey: string }) {
  const [tab, setTab] = useState<"curl" | "javascript" | "python">("curl");
  const [copied, setCopied] = useState(false);
  const snippets = buildSnippets(endpoint, apiKey);
  const snippet = snippets[tab];

  function copy() {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex items-center gap-2 text-sm font-medium mb-2">
        <Terminal className="w-4 h-4 text-muted" /> 사용 예시
      </div>
      <p className="text-xs text-faint mb-3">
        <code className="font-mono">POST {endpoint || "/api/v1/chat"}</code> — 헤더에{" "}
        <code className="font-mono">Authorization: Bearer &lt;API_KEY&gt;</code> 를 담아 호출합니다 (OpenAI 호환).
        응답은 토큰 단위 <code className="font-mono">text/plain</code> 스트리밍입니다.
      </p>

      <div className="flex items-center justify-between mb-1.5">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                tab === t.key ? "bg-surface border border-border text-foreground" : "text-muted hover:text-foreground"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={copy}>
          {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />} 복사
        </button>
      </div>
      <pre className="text-xs font-mono bg-surface border border-border rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre text-gray-300">{snippet}</pre>

      <div className="text-xs text-muted mt-3 mb-1.5">요청 본문(JSON) 파라미터</div>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="text-faint text-left">
            <tr className="border-b border-border">
              <th className="font-medium px-3 py-2">필드</th>
              <th className="font-medium px-3 py-2">타입</th>
              <th className="font-medium px-3 py-2">필수</th>
              <th className="font-medium px-3 py-2">설명</th>
            </tr>
          </thead>
          <tbody>
            {PARAMS.map((p) => (
              <tr key={p.name} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2 font-mono">{p.name}</td>
                <td className="px-3 py-2 text-muted">{p.type}</td>
                <td className="px-3 py-2">{p.required ? <span className="text-warn">필수</span> : <span className="text-faint">선택</span>}</td>
                <td className="px-3 py-2 text-muted">{p.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* RAG 사용 안내 */}
      <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-3">
        <div className="text-xs font-medium text-accent-2 mb-1.5">📚 문서 기반 답변 (RAG)</div>
        <p className="text-xs text-muted leading-relaxed mb-2">
          <b className="text-gray-200">RAG</b> 메뉴에서 컬렉션을 만들고 문서(PDF·txt·md 등)를 업로드한 뒤,
          채팅 요청에 <code className="font-mono text-accent-2">rag_collection</code> 을 넣으면 해당 문서를 참조해 답변합니다.
        </p>
        <pre className="text-xs font-mono bg-surface border border-border rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre text-gray-300">{`curl -N -X POST ${endpoint || "https://<서버주소>/api/v1/chat"} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{
    "message": "수시 전형 지원 자격이 어떻게 되나요?",
    "rag_collection": "모집요강",
    "rag_mode": "search"
  }'`}</pre>
      </div>

      {/* STT 사용 안내 */}
      <div className="mt-4 rounded-lg border border-info/30 bg-info/5 p-3">
        <div className="text-xs font-medium text-info mb-1.5">🎙️ 음성·영상 → 텍스트 (STT, Whisper)</div>
        <p className="text-xs text-muted leading-relaxed mb-2">
          <code className="font-mono">POST /api/v1/transcribe</code> 로 오디오/영상 파일을 업로드하면 자막을 받습니다(multipart).
          <b className="text-gray-200"> 모델 관리</b> 에서 Whisper 모델을 먼저 받아두면 빠릅니다.
          파라미터: <code className="font-mono text-info">whisper_model</code>(tiny~large-v3),{" "}
          <code className="font-mono text-info">language</code>(ko·en·빈값=자동),{" "}
          <code className="font-mono text-info">format</code>(json·srt·vtt·text).
        </p>
        <pre className="text-xs font-mono bg-surface border border-border rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre text-gray-300">{`curl -X POST ${(endpoint || "https://<서버주소>/api/v1/chat").replace(/\/chat$/, "/transcribe")} \\
  -H "Authorization: Bearer ${apiKey}" \\
  -F "file=@회의녹음.mp3" \\
  -F "whisper_model=base" \\
  -F "language=ko" \\
  -F "format=srt"`}</pre>
      </div>
    </div>
  );
}

function KeyRow({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-xs text-muted w-20 shrink-0">{label}</span>
      <code className="flex-1 text-xs font-mono bg-surface border border-border rounded-lg px-3 py-2 break-all">{value}</code>
      <button className="btn-ghost !px-2.5 !py-2" onClick={onCopy}>
        {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}
