// 호스트 시스템 자원(CPU/RAM/디스크) + 서비스 헬스.
// CPU/RAM/디스크는 대시보드 프로세스(Node)에서 직접 측정 — 컴포즈에선 호스트 값 반영.
import { NextResponse } from "next/server";
import os from "node:os";
import { statfs } from "node:fs/promises";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const OLLAMA = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const WORKER = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:8100";

async function ping(url: string, ms = 2000): Promise<boolean> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    const r = await fetch(url, { signal: ac.signal, cache: "no-store" });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  // 디스크 ('/' = 컨테이너 오버레이 = 도커 호스트 파티션)
  let disk = { totalGb: 0, usedGb: 0, pct: 0 };
  try {
    const s = await statfs("/");
    const total = Number(s.blocks) * s.bsize;
    const free = Number(s.bavail) * s.bsize;
    const used = total - free;
    disk = { totalGb: +(total / 1e9).toFixed(1), usedGb: +(used / 1e9).toFixed(1), pct: total ? Math.round((used / total) * 100) : 0 };
  } catch { /* statfs 미지원 시 0 */ }

  const totalMem = os.totalmem(), freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cores = os.cpus().length || 1;
  const load1 = os.loadavg()[0];
  const cpuPct = Math.min(100, Math.round((load1 / cores) * 100));

  const [ollamaOk, workerOk, dbOk] = await Promise.all([
    ping(`${OLLAMA}/api/version`),
    ping(`${WORKER}/internal/health`),
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
  ]);

  const mem = { totalGb: +(totalMem / 1e9).toFixed(1), usedGb: +(usedMem / 1e9).toFixed(1), pct: Math.round((usedMem / totalMem) * 100) };

  // 임계치 경고
  const alerts: { level: "warn" | "danger"; msg: string }[] = [];
  if (disk.pct >= 85) alerts.push({ level: disk.pct >= 95 ? "danger" : "warn", msg: `디스크 사용률 ${disk.pct}% (${disk.usedGb}/${disk.totalGb}GB)` });
  if (mem.pct >= 90) alerts.push({ level: "warn", msg: `메모리 사용률 ${mem.pct}%` });
  if (cpuPct >= 90) alerts.push({ level: "warn", msg: `CPU 부하 ${cpuPct}%` });
  if (!ollamaOk) alerts.push({ level: "danger", msg: "Ollama 추론 서버 응답 없음" });
  if (!workerOk) alerts.push({ level: "warn", msg: "워커(지표/RAG/STT) 응답 없음" });
  if (!dbOk) alerts.push({ level: "danger", msg: "데이터베이스 응답 없음" });

  return NextResponse.json({
    cpu: { pct: cpuPct, cores, load1: +load1.toFixed(2) },
    mem,
    disk,
    health: { ollama: ollamaOk, worker: workerOk, db: dbOk },
    alerts,
  });
}
