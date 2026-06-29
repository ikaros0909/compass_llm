import { NextResponse } from "next/server";
import { listModels } from "@/lib/ollama";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const models = await listModels();
    return NextResponse.json({ status: "ok", models: models.map((m) => m.name) });
  } catch {
    return NextResponse.json({ status: "degraded", models: [] }, { status: 503 });
  }
}
