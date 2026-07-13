"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import {
  Send, Square, Trash2, Bot, User, Settings2, Sparkles, ChevronDown,
  Cpu, Zap, Server, CircleSlash, Plus, MessageSquare,
} from "lucide-react";

const TIMEOUT_MS = 180_000;
const LS_CONVOS = "compass.pg.convos";
const LS_ACTIVE = "compass.pg.active";
const LS_PREFS = "compass.pg.prefs";

interface ChatStats { tokensPerSec: number; evalCount: number; promptCount: number; loadMs: number; totalMs: number; backend: string; gpuPct: number }
type Role = "user" | "assistant";
interface Msg { role: Role; content: string; stats?: ChatStats; timedOut?: boolean }
interface Conversation { id: string; title: string; messages: Msg[]; updatedAt: number }

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `c-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
const newConvo = (): Conversation => ({ id: uid(), title: "새 대화", messages: [], updatedAt: Date.now() });

function relTime(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

export default function PlaygroundPage() {
  const { data } = useSWR("/api/admin/models", fetcher);
  const models: { name: string; loaded: boolean; size: number }[] = data?.models ?? [];
  const { data: status } = useSWR("/api/admin/ollama-status", fetcher, { refreshInterval: 3000 });
  const loaded: { name: string; backend: string; gpuPct: number }[] = status?.loaded ?? [];

  const [hydrated, setHydrated] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [model, setModel] = useState("");
  const [system, setSystem] = useState("You are a helpful AI assistant. Answer in Korean.");
  const [temp, setTemp] = useState(0.5);
  const [showSettings, setShowSettings] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [gotFirstToken, setGotFirstToken] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const persistRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId);
  const messages = active?.messages ?? [];
  const activeBackend = loaded.find((l) => l.name === model);

  // ── 하이드레이션: localStorage 로드 ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_CONVOS);
      const cs: Conversation[] = raw ? JSON.parse(raw) : [];
      const savedActive = localStorage.getItem(LS_ACTIVE) ?? "";
      const prefs = JSON.parse(localStorage.getItem(LS_PREFS) ?? "{}");
      if (prefs.model) setModel(prefs.model);
      if (prefs.system) setSystem(prefs.system);
      if (typeof prefs.temp === "number") setTemp(prefs.temp);
      if (cs.length) {
        setConversations(cs);
        setActiveId(cs.find((c) => c.id === savedActive) ? savedActive : cs[0].id);
      } else {
        const c = newConvo();
        setConversations([c]);
        setActiveId(c.id);
      }
    } catch {
      const c = newConvo();
      setConversations([c]);
      setActiveId(c.id);
    }
    setHydrated(true);
  }, []);

  // ── 영구 저장 (디바운스) ──
  useEffect(() => {
    if (!hydrated) return;
    if (persistRef.current) clearTimeout(persistRef.current);
    persistRef.current = setTimeout(() => {
      try { localStorage.setItem(LS_CONVOS, JSON.stringify(conversations)); } catch {}
    }, 300);
  }, [conversations, hydrated]);
  useEffect(() => { if (hydrated && activeId) localStorage.setItem(LS_ACTIVE, activeId); }, [activeId, hydrated]);
  useEffect(() => {
    if (hydrated) localStorage.setItem(LS_PREFS, JSON.stringify({ model, system, temp }));
  }, [model, system, temp, hydrated]);

  // 모델 기본 선택
  useEffect(() => {
    if (!model && models.length) setModel((models.find((m) => m.loaded) ?? models[0]).name);
  }, [models, model]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming, activeId]);

  // 활성 대화의 메시지 갱신
  function updateActiveMessages(fn: (m: Msg[]) => Msg[]) {
    setConversations((cs) => cs.map((c) => c.id === activeId ? { ...c, messages: fn(c.messages), updatedAt: Date.now() } : c));
  }

  function newChat() {
    if (streaming) return;
    const c = newConvo();
    setConversations((cs) => [c, ...cs]);
    setActiveId(c.id);
    setInput("");
  }
  function selectChat(id: string) {
    if (streaming) return;
    setActiveId(id);
  }
  function deleteChat(id: string) {
    setConversations((cs) => {
      const rest = cs.filter((c) => c.id !== id);
      if (id === activeId) {
        if (rest.length) setActiveId(rest[0].id);
        else { const c = newConvo(); setActiveId(c.id); return [c]; }
      }
      return rest;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || !model || streaming || !activeId) return;
    const baseMsgs = [...messages, { role: "user", content: text } as Msg];
    // 첫 메시지면 제목 자동 설정
    updateActiveMessages(() => baseMsgs);
    setConversations((cs) => cs.map((c) =>
      c.id === activeId && (c.title === "새 대화" || !c.title)
        ? { ...c, title: text.slice(0, 40) } : c));
    setInput("");
    setStreaming(true);
    setGotFirstToken(false);
    setElapsed(0);

    const startedAt = Date.now();
    timerRef.current = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 250);

    const ac = new AbortController();
    abortRef.current = ac;
    let timedOut = false;
    const killer = setTimeout(() => { timedOut = true; ac.abort(); }, TIMEOUT_MS);
    updateActiveMessages((m) => [...m, { role: "assistant", content: "" }]);

    let full = "";
    const SEP = "\x1f";
    try {
      const r = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, system, temperature: temp, messages: baseMsgs }),
        signal: ac.signal,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? `서버 오류 (${r.status})`);
      }
      if (!r.body) throw new Error("스트림을 받지 못했습니다.");
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
        const sepIdx = full.indexOf(SEP);
        const visible = sepIdx >= 0 ? full.slice(0, sepIdx) : full;
        if (visible) setGotFirstToken(true);
        updateActiveMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { ...copy[copy.length - 1], role: "assistant", content: visible };
          return copy;
        });
      }
      const sepIdx = full.indexOf(SEP);
      if (sepIdx >= 0) {
        try {
          const stats: ChatStats = JSON.parse(full.slice(sepIdx + 1));
          updateActiveMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = { ...copy[copy.length - 1], stats };
            return copy;
          });
        } catch {}
      }
    } catch (e: any) {
      if (e?.name === "AbortError" && timedOut) {
        updateActiveMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { ...copy[copy.length - 1], timedOut: true };
          return copy;
        });
      } else if (e?.name !== "AbortError") {
        const reason = e?.message ?? "오류가 발생했습니다.";
        updateActiveMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { ...copy[copy.length - 1], content: (copy[copy.length - 1].content || "") + `\n\n⚠ ${reason}` };
          return copy;
        });
      }
    } finally {
      clearTimeout(killer);
      if (timerRef.current) clearInterval(timerRef.current);
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    if (timerRef.current) clearInterval(timerRef.current);
    setStreaming(false);
  }

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* ── 대화 목록 사이드바 (모바일에선 숨김) ── */}
      <div className="hidden md:flex w-56 shrink-0 flex-col card !p-2">
        <button className="btn w-full mb-2" onClick={newChat} disabled={streaming}>
          <Plus className="w-4 h-4" /> 새 대화
        </button>
        <div className="flex-1 overflow-y-auto space-y-1 -mr-1 pr-1">
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => selectChat(c.id)}
              className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer text-sm transition ${c.id === activeId ? "bg-accent/10 ring-1 ring-inset ring-accent/30 text-white" : "text-muted hover:bg-elevated/60"}`}
            >
              <MessageSquare className="w-4 h-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="truncate">{c.title || "새 대화"}</div>
                <div className="text-[10px] text-faint">{relTime(c.updatedAt)}</div>
              </div>
              <button
                className="opacity-0 group-hover:opacity-100 text-faint hover:text-danger shrink-0"
                onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}
                title="삭제"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── 채팅 영역 ── */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-accent-2" /> 플레이그라운드
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-sm text-muted">설치된 모델을 선택해 바로 대화해 보세요.</p>
              <BackendBadge backend={activeBackend?.backend} gpuPct={activeBackend?.gpuPct} />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <button className="btn-ghost md:hidden shrink-0" onClick={newChat} disabled={streaming} title="새 대화">
              <Plus className="w-4 h-4" />
            </button>
            <div className="relative flex-1 sm:flex-none min-w-0">
              <select
                className="input appearance-none pr-9 w-full sm:min-w-[15rem] cursor-pointer"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {models.length === 0 && <option value="">모델 불러오는 중…</option>}
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}  ·  {(m.size / 1e9).toFixed(1)}GB{m.loaded ? "  ● 로드됨" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-faint absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <button className="btn-ghost shrink-0" onClick={() => setShowSettings((s) => !s)}>
              <Settings2 className="w-4 h-4" /> 설정
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="card mb-4 space-y-3 animate-fade-in">
            <div>
              <label className="label">시스템 프롬프트</label>
              <textarea className="input h-20 resize-none" value={system} onChange={(e) => setSystem(e.target.value)} />
            </div>
            <div className="flex items-center gap-3">
              <label className="label mb-0">Temperature</label>
              <input type="range" min={0} max={1} step={0.1} value={temp} onChange={(e) => setTemp(Number(e.target.value))} className="flex-1 accent-accent" />
              <span className="text-sm tabular-nums w-8 text-right">{temp.toFixed(1)}</span>
            </div>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto card !p-0">
          {messages.length === 0 ? (
            <div className="h-full grid place-items-center text-center p-10">
              <div>
                <Bot className="w-10 h-10 text-faint mx-auto mb-3" />
                <p className="text-muted">아래에 메시지를 입력해 대화를 시작하세요.</p>
                {model && <p className="text-xs text-faint mt-1">현재 모델: <span className="font-mono">{model}</span></p>}
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-5">
              {messages.map((m, i) => (
                <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className={`grid place-items-center w-8 h-8 rounded-lg shrink-0 ${m.role === "user" ? "bg-accent/20 text-accent-2" : "bg-elevated text-info"}`}>
                    {m.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>
                  <div className="max-w-[78%] min-w-0">
                    <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${m.role === "user" ? "bg-accent/15 text-gray-100" : "bg-elevated/70 text-gray-200"}`}>
                      {m.content || (streaming && i === messages.length - 1 ? (
                        <span className="inline-flex flex-col gap-1.5">
                          <span className="inline-flex gap-1 items-center">
                            <Dot /><Dot d={0.2} /><Dot d={0.4} />
                            {elapsed >= 1 && <span className="text-xs text-faint ml-1.5 tabular-nums">{elapsed.toFixed(0)}s</span>}
                          </span>
                          {!gotFirstToken && elapsed >= 6 && (
                            <span className="text-xs text-warn">
                              {activeBackend?.backend === "cpu"
                                ? "CPU로 추론 중이라 매우 느립니다. 응답까지 수 분 걸릴 수 있어요."
                                : !activeBackend
                                ? "모델 로딩 중… (첫 요청은 GPU에 올리는 시간이 필요합니다)"
                                : "응답 생성 중…"}
                              {` ${Math.round(TIMEOUT_MS / 1000)}초 후 자동 중단됩니다.`}
                            </span>
                          )}
                        </span>
                      ) : "")}
                    </div>
                    {m.timedOut && (
                      <div className="text-xs text-danger mt-1.5 flex items-center gap-1">
                        <CircleSlash className="w-3.5 h-3.5" />
                        {Math.round(TIMEOUT_MS / 1000)}초 내 응답이 없어 중단했습니다. GPU 미사용(CPU 추론)이거나 모델 로딩 실패일 수 있습니다 — 상단 배지를 확인하세요.
                      </div>
                    )}
                    {m.stats && <StatsLine s={m.stats} />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-end gap-2">
          <textarea
            className="input resize-none h-[52px] py-3.5 flex-1 min-w-0"
            placeholder="메시지를 입력하세요  (Enter 전송, Shift+Enter 줄바꿈)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          {streaming ? (
            <button className="btn-ghost h-[52px] shrink-0 whitespace-nowrap" onClick={stop}><Square className="w-4 h-4" /> 중지</button>
          ) : (
            <button className="btn h-[52px] shrink-0 whitespace-nowrap" onClick={send} disabled={!input.trim() || !model}><Send className="w-4 h-4" /> 전송</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Dot({ d = 0 }: { d?: number }) {
  return <span className="w-1.5 h-1.5 rounded-full bg-faint animate-pulse2" style={{ animationDelay: `${d}s` }} />;
}

function BackendBadge({ backend, gpuPct }: { backend?: string; gpuPct?: number }) {
  if (!backend) return <span className="badge bg-faint/15 text-faint"><Server className="w-3.5 h-3.5" /> 미로드</span>;
  if (backend === "gpu") return <span className="badge badge-on"><Zap className="w-3.5 h-3.5" /> GPU</span>;
  if (backend === "cpu") return <span className="badge bg-warn/15 text-warn"><Cpu className="w-3.5 h-3.5" /> CPU (느림)</span>;
  return <span className="badge bg-info/15 text-info"><Zap className="w-3.5 h-3.5" /> GPU {gpuPct}% + CPU</span>;
}

function StatsLine({ s }: { s: ChatStats }) {
  const fast = s.tokensPerSec >= 15;
  return (
    <div className="text-xs text-faint mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className={fast ? "text-success" : "text-warn"}>
        {fast ? <Zap className="w-3 h-3 inline -mt-0.5" /> : <Cpu className="w-3 h-3 inline -mt-0.5" />} {s.tokensPerSec} tok/s
      </span>
      {s.backend !== "unknown" && (
        <span>{s.backend === "gpu" ? "GPU 100%" : s.backend === "cpu" ? "CPU" : `GPU ${s.gpuPct}%`}</span>
      )}
      <span>생성 {s.evalCount}토큰</span>
      {s.loadMs > 50 && <span>로딩 {(s.loadMs / 1000).toFixed(1)}s</span>}
      <span>총 {(s.totalMs / 1000).toFixed(1)}s</span>
    </div>
  );
}
