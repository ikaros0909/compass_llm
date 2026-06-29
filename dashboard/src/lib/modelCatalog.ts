// 다운로드 가능한 모델 큐레이션 카탈로그.
// tag 는 Ollama 가 pull 하는 실제 모델명이다.
// (레지스트리에 없는 tag 는 pull 시 진행창에 오류로 표시됨)
export interface CatalogModel {
  tag: string;
  label: string;
  size?: string; // 대략 다운로드 용량 (기본 양자화 기준)
  note?: string;
  kind?: "ollama" | "whisper"; // whisper = STT 모델(워커가 다운로드, Ollama 아님). 기본 ollama
}
export interface CatalogGroup {
  family: string;
  models: CatalogModel[];
}

// Gemma 4 핵심 라인업 (Ollama 라이브러리 기준).
// e2b/e4b = Nano(저용량 온디바이스), 12b/26b(MoE)/31b(Dense).
// 그 외 양자화/포맷 변형(-it-qat, -q8_0, -bf16, -mlx, -nvfp4 등)은 "기타"로 직접 입력.
export const MODEL_CATALOG: CatalogGroup[] = [
  {
    family: "Gemma 4 · Nano (Google · 온디바이스)",
    models: [
      { tag: "gemma4:e2b", label: "Gemma 4 Nano · E2B (2nano)", size: "~3GB", note: "초경량 · 멀티모달" },
      { tag: "gemma4:e4b", label: "Gemma 4 Nano · E4B (4nano)", size: "~5GB", note: "경량 · 멀티모달" },
    ],
  },
  {
    family: "Gemma 4 (Google · 멀티모달)",
    models: [
      { tag: "gemma4:12b", label: "Gemma 4 · 12B", size: "~8GB", note: "멀티모달" },
      { tag: "gemma4:26b", label: "Gemma 4 · 26B (MoE)", size: "~17GB", note: "4B active · 256K context · 멀티모달" },
      { tag: "gemma4:31b", label: "Gemma 4 · 31B (Dense)", size: "~19GB", note: "멀티모달" },
      { tag: "gemma4:latest", label: "Gemma 4 · latest (기본 태그)", note: "최신 기본 빌드" },
    ],
  },
  {
    family: "Whisper · STT (음성 → 텍스트)",
    models: [
      { tag: "tiny", label: "Whisper tiny", size: "~75MB", note: "가장 빠름 · 저정확", kind: "whisper" },
      { tag: "base", label: "Whisper base", size: "~145MB", note: "기본 권장", kind: "whisper" },
      { tag: "small", label: "Whisper small", size: "~480MB", kind: "whisper" },
      { tag: "medium", label: "Whisper medium", size: "~1.5GB", kind: "whisper" },
      { tag: "large-v3", label: "Whisper large-v3", size: "~3GB", note: "최고 정확 · 다국어", kind: "whisper" },
    ],
  },
];

export const CUSTOM_OPTION = "__custom__";
