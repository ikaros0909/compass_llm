// 현재 Ollama 에 로드된 모델과 GPU/CPU 배치 상태. 플레이그라운드 라이브 배지용.
import { NextResponse } from "next/server";
import { runningModels, gpuPlacement } from "@/lib/ollama";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const running = await runningModels();
    const models = running.map((m) => {
      const { pct, backend } = gpuPlacement(m);
      return { name: m.name, size: m.size, sizeVram: m.size_vram, gpuPct: pct, backend };
    });
    return NextResponse.json({ loaded: models });
  } catch {
    return NextResponse.json({ loaded: [], error: "ollama unreachable" });
  }
}
