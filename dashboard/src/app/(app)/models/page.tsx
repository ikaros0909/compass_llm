"use client";
import useSWR from "swr";
import { useState } from "react";
import { fetcher } from "@/lib/fetcher";
import PageHeader from "@/components/PageHeader";
import { Download, Trash2, Boxes, CheckCircle2, CircleDashed, ChevronDown, Mic } from "lucide-react";
import { MODEL_CATALOG, CUSTOM_OPTION } from "@/lib/modelCatalog";

function gb(bytes: number) {
  return (bytes / 1e9).toFixed(1) + " GB";
}

export default function ModelsPage() {
  const { data, mutate } = useSWR("/api/admin/models", fetcher, { refreshInterval: 5000 });
  const { data: sttData, mutate: mutateStt } = useSWR("/api/admin/stt/models", fetcher, { refreshInterval: 10000 });
  const [selected, setSelected] = useState("");   // 드롭다운 선택값 (tag 또는 __custom__)
  const [customName, setCustomName] = useState(""); // 기타 직접 입력
  const [pullStatus, setPullStatus] = useState("");
  const [pullError, setPullError] = useState(false);
  const [pulling, setPulling] = useState(false);

  const isCustom = selected === CUSTOM_OPTION;
  const pullName = isCustom ? customName : selected;
  const selectedMetaTop = MODEL_CATALOG.flatMap((g) => g.models).find((m) => m.tag === selected);

  async function pull() {
    if (!pullName.trim()) return;

    // Whisper(STT) 모델은 Ollama 가 아니라 워커가 다운로드
    if (selectedMetaTop?.kind === "whisper") {
      setPulling(true); setPullError(false);
      setPullStatus("Whisper 모델 다운로드 중… (large 는 수 분 소요)");
      try {
        const r = await fetch("/api/admin/stt/download", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ size: selected }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { setPullStatus("완료 ✓"); setSelected(""); mutateStt(); }
        else { setPullError(true); setPullStatus(j.detail ?? `다운로드 실패 (${r.status})`); }
      } catch (e: any) {
        setPullError(true); setPullStatus(e?.message ?? "네트워크 오류");
      } finally { setPulling(false); }
      return;
    }

    setPulling(true);
    setPullError(false);
    setPullStatus("다운로드 시작…");
    let errMsg = "";
    let success = false;
    try {
      const r = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pullName.trim() }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        errMsg = e.error ?? `서버 오류 (${r.status})`;
      } else if (r.body) {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const l of lines) {
            if (!l.trim()) continue;
            try {
              const o = JSON.parse(l);
              if (o.error) { errMsg = o.error; }                       // Ollama 오류 라인 감지
              else if (o.status === "success") { success = true; setPullStatus("success"); }
              else if (o.total && o.completed) setPullStatus(`${o.status} ${Math.round((o.completed / o.total) * 100)}%`);
              else if (o.status) setPullStatus(o.status);
            } catch {}
          }
        }
      }
    } catch (e: any) {
      errMsg = e?.message ?? "네트워크 오류";
    } finally {
      setPulling(false);
    }

    if (errMsg) {
      // 줄바꿈/안내문 정리해 한 줄로
      setPullError(true);
      setPullStatus(errMsg.replace(/\s+/g, " ").trim());
    } else if (success) {
      setPullError(false);
      setPullStatus("완료 ✓");
      setSelected("");
      setCustomName("");
      mutate();
    } else {
      // success 신호 없이 스트림이 끝난 경우 — 단정하지 않고 목록 갱신만
      setPullStatus("종료됨 — 목록을 확인하세요.");
      mutate();
    }
  }

  async function del(name: string) {
    if (!confirm(`${name} 모델을 삭제할까요?`)) return;
    await fetch(`/api/admin/models?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    mutate();
  }
  async function delStt(size: string) {
    if (!confirm(`Whisper '${size}' 모델을 삭제할까요?`)) return;
    await fetch(`/api/admin/stt/models/${encodeURIComponent(size)}`, { method: "DELETE" });
    mutateStt();
  }

  const models = data?.models ?? [];
  const installed = new Set<string>(models.map((m: any) => m.name));
  const whisperInstalled = new Set<string>(sttData?.models ?? []);
  const selectedMeta = MODEL_CATALOG.flatMap((g) => g.models).find((m) => m.tag === selected);

  return (
    <div>
      <PageHeader title="모델 관리" desc="Ollama 모델 다운로드 · 삭제 · 상태 확인" />

      <div className="card mb-4">
        <label className="label">새 모델 다운로드</label>
        <div className="flex flex-wrap gap-2 items-center">
          {/* 모델 선택 드롭다운 */}
          <div className="relative flex-1 min-w-[18rem]">
            <select
              className="input appearance-none pr-9 cursor-pointer"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">모델을 선택하세요…</option>
              {MODEL_CATALOG.map((g) => (
                <optgroup key={g.family} label={g.family}>
                  {g.models.map((m) => {
                    const inst = m.kind === "whisper" ? whisperInstalled.has(m.tag) : installed.has(m.tag);
                    return (
                      <option key={m.tag} value={m.tag} disabled={inst}>
                        {m.label}{m.size ? ` · ${m.size}` : ""}{inst ? "  (설치됨)" : ""}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
              <optgroup label="기타">
                <option value={CUSTOM_OPTION}>기타 (직접 입력)…</option>
              </optgroup>
            </select>
            <ChevronDown className="w-4 h-4 text-faint absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* 기타 선택 시에만 직접 입력창 노출 */}
          {isCustom && (
            <input
              className="input flex-1 min-w-[14rem] animate-fade-in"
              placeholder="모델명 직접 입력 (예: gemma4:31b-it-q8_0, qwen2.5:14b)"
              value={customName}
              autoFocus
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && pull()}
            />
          )}

          <button className="btn whitespace-nowrap" onClick={pull} disabled={pulling || !pullName.trim()}>
            <Download className="w-4 h-4" /> {pulling ? "받는 중…" : "다운로드"}
          </button>
        </div>

        {/* 선택한 모델 설명 */}
        {selectedMeta?.note && !isCustom && (
          <p className="text-xs text-muted mt-2"><span className="font-mono text-accent-2">{selectedMeta.tag}</span> — {selectedMeta.note}</p>
        )}
        {isCustom && (
          <p className="text-xs text-faint mt-2">
            특정 양자화/포맷 변형은 태그를 직접 입력하세요. 예: <span className="font-mono">gemma4:31b-it-q8_0</span>, <span className="font-mono">gemma4:e4b-it-qat</span>, <span className="font-mono">gemma4:12b-bf16</span>
          </p>
        )}
        {pullStatus && (
          <p className={`text-xs mt-2 ${pullError ? "text-danger" : "text-muted font-mono"}`}>
            {pullError ? "❌ " : ""}{pullStatus}
          </p>
        )}
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[36rem]">
          <thead className="text-muted text-left text-xs uppercase tracking-wide">
            <tr className="border-b border-border">
              <th className="font-medium px-5 py-3">모델</th>
              <th className="font-medium px-3 py-3">크기</th>
              <th className="font-medium px-3 py-3">파라미터</th>
              <th className="font-medium px-3 py-3">상태</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {models.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-faint">
                <Boxes className="w-8 h-8 mx-auto mb-2 opacity-50" /> 설치된 모델이 없습니다.
              </td></tr>
            )}
            {models.map((m: any) => (
              <tr key={m.name} className="table-row">
                <td className="px-5 py-3.5 font-medium">{m.name}</td>
                <td className="px-3 py-3.5 text-muted tabular-nums">{gb(m.size)}</td>
                <td className="px-3 py-3.5 text-muted">{m.params ?? "—"}</td>
                <td className="px-3 py-3.5">
                  {m.loaded
                    ? <span className="badge badge-on"><CheckCircle2 className="w-3.5 h-3.5" /> 로드됨</span>
                    : <span className="badge badge-off"><CircleDashed className="w-3.5 h-3.5" /> 대기</span>}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <button className="btn-danger" onClick={() => del(m.name)}><Trash2 className="w-3.5 h-3.5" /> 삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* 설치된 Whisper(STT) 모델 */}
      <div className="card mt-4">
        <div className="text-sm font-medium mb-3 flex items-center gap-2"><Mic className="w-4 h-4 text-info" /> STT (Whisper) 모델</div>
        {whisperInstalled.size === 0 ? (
          <div className="text-sm text-faint py-4 text-center">
            받은 Whisper 모델이 없습니다. 위 드롭다운의 <span className="text-muted">Whisper · STT</span> 그룹에서 선택해 다운로드하세요.
          </div>
        ) : (
          <div className="space-y-1.5">
            {[...whisperInstalled].map((s) => (
              <div key={s} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface text-sm">
                <Mic className="w-4 h-4 text-faint shrink-0" />
                <span className="flex-1 font-mono">{s}</span>
                <span className="badge badge-on"><CheckCircle2 className="w-3.5 h-3.5" /> 설치됨</span>
                <button className="btn-danger" onClick={() => delStt(s)}><Trash2 className="w-3.5 h-3.5" /> 삭제</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
