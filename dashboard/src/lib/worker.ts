// Python 워커(RAG, Whisper, OpenCV, GPU 지표) 호출 래퍼.
const BASE = process.env.WORKER_BASE_URL ?? "http://localhost:8100";

export interface GpuMetric {
  index: number;
  utilization: number;
  memUsedMb: number;
  memTotalMb: number;
  tempC: number;
  powerW: number;
}

export async function fetchGpuMetrics(): Promise<GpuMetric[]> {
  try {
    const r = await fetch(`${BASE}/internal/metrics`, { cache: "no-store" });
    if (!r.ok) return [];
    return (await r.json()).gpus ?? [];
  } catch {
    return []; // 워커가 아직 안 떴거나 GPU 없는 환경
  }
}

// RAG 검색: 컬렉션에서 질의 관련 청크를 가져온다 (chat 의 rag_collection 연동용)
export async function ragSearch(
  collection: string,
  query: string,
  opts?: { k?: number; mode?: string },
): Promise<{ content: string; source_file: string }[]> {
  try {
    const r = await fetch(`${BASE}/rag/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection, query, k: opts?.k ?? 8, mode: opts?.mode ?? "search" }),
      cache: "no-store",
    });
    if (!r.ok) return [];
    return (await r.json()).results ?? [];
  } catch {
    return [];
  }
}

export interface SbomScanResult {
  commit: string;
  branch: string;
  total: number;
  counts: { critical: number; high: number; medium: number; low: number; unknown: number };
  findings: {
    ecosystem: string; target: string; pkgName: string; installedVersion: string;
    fixedVersion: string; vulnId: string; severity: string; title: string; url: string;
  }[];
}

// SBOM 스캔: 워커가 저장소를 얕게 클론 후 Trivy 로 취약점 스캔 (오래 걸릴 수 있음)
export async function scanSbom(
  input: { workspace: string; repoSlug: string; token: string; authUsername?: string },
): Promise<SbomScanResult> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25 * 60_000); // 최대 25분
  try {
    const r = await fetch(`${BASE}/sbom/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, authUsername: input.authUsername ?? "" }),
      cache: "no-store",
      signal: ac.signal,
    });
    if (!r.ok) throw new Error(`worker /sbom/scan ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()) as SbomScanResult;
  } finally {
    clearTimeout(t);
  }
}

// RAG/멀티미디어 요청은 워커로 그대로 프록시 (multipart 포함)
export async function proxyToWorker(path: string, req: Request): Promise<Response> {
  const url = `${BASE}${path}`;
  const init: RequestInit = {
    method: req.method,
    headers: { "Content-Type": req.headers.get("content-type") ?? "" },
    body: req.body,
    // @ts-expect-error - Node fetch 스트리밍 바디 전달
    duplex: "half",
  };
  return fetch(url, init);
}
