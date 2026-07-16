"use client";
import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

// 체크박스 팝오버 방식 다중 선택. selected 가 비면 '전체'.
export default function MultiSelect({
  options, selected, onChange, label, allLabel = "전체",
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  label: string;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const summary = selected.length === 0 ? allLabel : `${selected.length}개 선택`;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)}
        className="input !w-auto !py-1 !text-xs cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap">
        {label}: <span className="text-gray-200">{summary}</span> <ChevronDown className="w-3.5 h-3.5 text-faint" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-60 max-h-72 overflow-y-auto rounded-lg border border-border bg-panel shadow-soft p-1">
          <button onClick={() => onChange([])}
            className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-elevated/60 text-muted">
            {allLabel} (필터 해제)
          </button>
          {options.length === 0 && <div className="text-xs text-faint px-2 py-2">항목 없음</div>}
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer hover:bg-elevated/60">
              <input type="checkbox" className="accent-accent w-3.5 h-3.5 shrink-0" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
