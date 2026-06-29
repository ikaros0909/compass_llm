"use client";
import useSWR from "swr";
import { useState } from "react";
import { fetcher } from "@/lib/fetcher";
import PageHeader from "@/components/PageHeader";
import { Library, Plus, Trash2, Upload, FileText, FolderOpen, Loader2 } from "lucide-react";

export default function RagPage() {
  const { data, mutate } = useSWR("/api/admin/rag/collections", fetcher, { refreshInterval: 10000 });
  const collections: { name: string; description: string; file_count: number }[] = data?.collections ?? [];

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");

  const { data: filesData, mutate: mutateFiles } = useSWR(
    selected ? `/api/admin/rag/collections/${encodeURIComponent(selected)}/files` : null, fetcher,
  );
  const files: string[] = filesData?.files ?? [];

  async function createCollection() {
    if (!newName.trim()) return;
    const r = await fetch("/api/admin/rag/collections", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
    });
    if (r.ok) { setNewName(""); setNewDesc(""); mutate(); }
    else setMsg((await r.json().catch(() => ({}))).detail ?? "생성 실패 (이미 존재?)");
  }
  async function deleteCollection(name: string) {
    if (!confirm(`컬렉션 '${name}'과 모든 문서를 삭제할까요?`)) return;
    await fetch(`/api/admin/rag/collections/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (selected === name) setSelected("");
    mutate();
  }
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files;
    if (!fl?.length || !selected) return;
    setUploading(true); setMsg("업로드·임베딩 중… (첫 업로드는 임베딩 모델 다운로드로 수 분 걸릴 수 있습니다)");
    const fd = new FormData();
    fd.append("collection", selected);
    Array.from(fl).forEach((f) => fd.append("files", f));
    try {
      const r = await fetch("/api/admin/rag/upload", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const chunks = (j.uploaded ?? []).reduce((s: number, u: any) => s + (u.chunks ?? 0), 0);
        setMsg(`완료 — ${j.uploaded?.length ?? 0}개 파일, ${chunks}개 청크 임베딩`);
      } else setMsg("업로드 실패: " + (j.detail ?? r.status));
      mutate(); mutateFiles();
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }
  async function deleteFile(name: string) {
    if (!confirm(`'${name}' 문서를 삭제할까요? (인덱스 재구축)`)) return;
    await fetch(`/api/admin/rag/collections/${encodeURIComponent(selected)}/files/${encodeURIComponent(name)}`, { method: "DELETE" });
    mutate(); mutateFiles();
  }

  return (
    <div>
      <PageHeader title="RAG 컬렉션" desc="문서를 업로드해 임베딩하고, 채팅에서 컬렉션을 참조하게 합니다" />

      <div className="grid lg:grid-cols-3 gap-4">
        {/* 컬렉션 목록 + 생성 */}
        <div className="space-y-4">
          <div className="card">
            <label className="label">새 컬렉션</label>
            <input className="input mb-2" placeholder="이름 (예: 모집요강)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className="input mb-2" placeholder="설명 (선택)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            <button className="btn w-full" onClick={createCollection}><Plus className="w-4 h-4" /> 생성</button>
          </div>

          <div className="card !p-2">
            {collections.length === 0 ? (
              <div className="text-sm text-faint text-center py-8"><Library className="w-7 h-7 mx-auto mb-2 opacity-50" />컬렉션이 없습니다.</div>
            ) : collections.map((c) => (
              <div key={c.name} onClick={() => setSelected(c.name)}
                className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition ${selected === c.name ? "bg-accent/10 ring-1 ring-inset ring-accent/30" : "hover:bg-elevated/60"}`}>
                <FolderOpen className={`w-4 h-4 shrink-0 ${selected === c.name ? "text-accent-2" : "text-faint"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{c.name}</div>
                  <div className="text-[11px] text-faint truncate">{c.description || "—"} · 문서 {c.file_count}</div>
                </div>
                <button className="opacity-0 group-hover:opacity-100 text-faint hover:text-danger shrink-0"
                  onClick={(e) => { e.stopPropagation(); deleteCollection(c.name); }}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </div>

        {/* 선택한 컬렉션의 문서 */}
        <div className="lg:col-span-2">
          {!selected ? (
            <div className="card h-full grid place-items-center text-center py-16">
              <div><Library className="w-10 h-10 text-faint mx-auto mb-3" /><p className="text-muted">왼쪽에서 컬렉션을 선택하거나 새로 만드세요.</p></div>
            </div>
          ) : (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <div className="font-medium flex items-center gap-2"><FolderOpen className="w-4 h-4 text-accent-2" /> {selected}</div>
                <label className={`btn cursor-pointer ${uploading ? "pointer-events-none opacity-60" : ""}`}>
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} 파일 업로드
                  <input type="file" multiple className="hidden" accept=".pdf,.txt,.md,.csv,.json,.html" onChange={upload} disabled={uploading} />
                </label>
              </div>
              {msg && <p className="text-xs text-muted mb-3">{msg}</p>}
              {files.length === 0 ? (
                <div className="text-sm text-faint text-center py-10"><FileText className="w-7 h-7 mx-auto mb-2 opacity-50" />문서가 없습니다. PDF·txt·md 등을 업로드하세요.</div>
              ) : (
                <div className="space-y-1.5">
                  {files.map((f) => (
                    <div key={f} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface text-sm">
                      <FileText className="w-4 h-4 text-faint shrink-0" />
                      <span className="flex-1 truncate">{f}</span>
                      <button className="btn-danger" onClick={() => deleteFile(f)}><Trash2 className="w-3.5 h-3.5" /> 삭제</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-faint mt-4">
                채팅에서 사용: <span className="font-mono text-accent-2">{`{"message": "...", "rag_collection": "${selected}"}`}</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
