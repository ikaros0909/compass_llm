import { NextRequest, NextResponse } from "next/server";
import { listModels, runningModels, deleteModel, pullModelStream } from "@/lib/ollama";
import { requireAdmin } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET() {
  const [models, running] = await Promise.all([
    listModels().catch(() => []),
    runningModels().catch(() => []),
  ]);
  const loaded = new Set(running.map((r) => r.name));
  return NextResponse.json({
    models: models.map((m) => ({
      name: m.name,
      size: m.size,
      params: m.details?.parameter_size ?? null,
      quant: m.details?.quantization_level ?? null,
      loaded: loaded.has(m.name),
    })),
  });
}

// 모델 pull — Ollama 진행률 NDJSON 을 그대로 클라이언트로 스트리밍
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { name } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const stream = await pullModelStream(name);
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  await deleteModel(name);
  return NextResponse.json({ ok: true });
}
