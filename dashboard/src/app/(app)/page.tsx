"use client";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import PageHeader from "@/components/PageHeader";
import {
  Cpu, MemoryStick, Activity, Boxes, Thermometer, Zap, AlertTriangle, Gauge,
  HardDrive, MemoryStick as RamIcon, ServerCog, CircleCheck, CircleX, TriangleAlert,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

const TONES: Record<string, string> = {
  accent: "bg-accent/15 text-accent-2", success: "bg-success/15 text-success",
  info: "bg-info/15 text-info", warn: "bg-warn/15 text-warn",
};

function StatCard({ label, value, sub, icon: Icon, tone = "accent" }: any) {
  return (
    <div className="card card-hover flex items-start gap-4">
      <div className={`grid place-items-center w-11 h-11 rounded-xl shrink-0 ${TONES[tone]}`}><Icon className="w-5 h-5" /></div>
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className="text-2xl font-semibold mt-0.5 truncate">{value}</div>
        {sub && <div className="text-xs text-faint mt-1 truncate">{sub}</div>}
      </div>
    </div>
  );
}

function UsageBar({ icon: Icon, label, pct, detail, tone }: any) {
  const color = pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warn" : "bg-accent";
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1.5">
        <span className="flex items-center gap-2 text-muted"><Icon className={`w-4 h-4 ${tone}`} /> {label}</span>
        <span className="tabular-nums">{detail}</span>
      </div>
      <div className="h-2 rounded-full bg-surface overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function HealthPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`badge ${ok ? "badge-on" : "bg-danger/15 text-danger"}`}>
      {ok ? <CircleCheck className="w-3.5 h-3.5" /> : <CircleX className="w-3.5 h-3.5" />} {label}
    </span>
  );
}

const tip = { background: "#131926", border: "1px solid #222c3d", borderRadius: 12, fontSize: 12 };

export default function OverviewPage() {
  const { data: ov } = useSWR("/api/admin/overview", fetcher, { refreshInterval: 2000 });
  const { data: mx } = useSWR("/api/admin/metrics?range=1h", fetcher, { refreshInterval: 10000 });
  const { data: sys } = useSWR("/api/admin/system", fetcher, { refreshInterval: 5000 });
  const { data: an } = useSWR("/api/admin/analytics?range=24h", fetcher, { refreshInterval: 30000 });

  const gpu = ov?.gpus?.[0];
  const hasGpu = !!gpu;
  const memPct = gpu?.memTotalMb ? Math.round((gpu.memUsedMb / gpu.memTotalMb) * 100) : 0;

  // 경고 모음 (시스템 + GPU)
  const alerts: { level: string; msg: string }[] = [...(sys?.alerts ?? [])];
  if (hasGpu && memPct >= 90) alerts.push({ level: "warn", msg: `GPU VRAM 사용률 ${memPct}%` });
  if (hasGpu && gpu.tempC >= 80) alerts.push({ level: gpu.tempC >= 88 ? "danger" : "warn", msg: `GPU 온도 ${gpu.tempC}°C` });

  return (
    <div className="space-y-4">
      <PageHeader title="개요" desc="실시간 GPU·요청·시스템 현황">
        <span className="badge badge-on"><span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse2" /> 라이브</span>
      </PageHeader>

      {/* 경고 배너 */}
      {alerts.length > 0 && (
        <div className={`card !py-3 flex items-start gap-3 ${alerts.some(a => a.level === "danger") ? "ring-1 ring-danger/40 bg-danger/5" : "ring-1 ring-warn/30 bg-warn/5"}`}>
          <TriangleAlert className={`w-5 h-5 shrink-0 ${alerts.some(a => a.level === "danger") ? "text-danger" : "text-warn"}`} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {alerts.map((a, i) => (
              <span key={i} className={a.level === "danger" ? "text-danger" : "text-warn"}>• {a.msg}</span>
            ))}
          </div>
        </div>
      )}

      {/* 상단 스탯 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Cpu} tone="accent" label="GPU 사용률" value={hasGpu ? `${Math.round(gpu.utilization)}%` : "—"}
          sub={hasGpu ? `${gpu.tempC}°C · ${Math.round(gpu.powerW)}W` : "GPU 데이터 없음"} />
        <StatCard icon={MemoryStick} tone="info" label="VRAM" value={hasGpu ? `${memPct}%` : "—"}
          sub={hasGpu ? `${gpu.memUsedMb} / ${gpu.memTotalMb} MB` : ""} />
        <StatCard icon={Activity} tone="success" label="분당 요청" value={ov ? String(ov.requestsPerMin) : "—"}
          sub={ov ? `평균 ${ov.avgLatencyMs}ms · 토큰 ${ov.tokensPerMin}` : ""} />
        <StatCard icon={Boxes} tone="warn" label="로드된 모델" value={ov?.loadedModel ?? "없음"}
          sub={ov ? `설치 모델 ${ov.modelCount}개` : ""} />
      </div>

      {/* GPU 시계열 + 시스템 자원 */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-medium flex items-center gap-2"><Gauge className="w-4 h-4 text-accent-2" /> GPU 사용률 / VRAM</div>
            <span className="text-xs text-faint">최근 1시간</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={mx?.samples ?? []}>
              <defs>
                <linearGradient id="gUtil" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.5} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0} /></linearGradient>
                <linearGradient id="gMem" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} /><stop offset="100%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="#222c3d" vertical={false} />
              <XAxis dataKey="t" hide /><YAxis domain={[0, 100]} stroke="#5a6678" fontSize={11} tickLine={false} axisLine={false} width={28} />
              <Tooltip contentStyle={tip} labelStyle={{ color: "#8a97ad" }} />
              <Area type="monotone" dataKey="utilization" stroke="#6366f1" strokeWidth={2} fill="url(#gUtil)" name="사용률%" />
              <Area type="monotone" dataKey="memPct" stroke="#22c55e" strokeWidth={2} fill="url(#gMem)" name="VRAM%" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="text-sm font-medium mb-4 flex items-center gap-2"><ServerCog className="w-4 h-4 text-accent-2" /> 시스템 자원</div>
          <div className="space-y-3.5">
            <UsageBar icon={Cpu} tone="text-accent-2" label="CPU" pct={sys?.cpu?.pct ?? 0} detail={sys ? `${sys.cpu.pct}% · load ${sys.cpu.load1}/${sys.cpu.cores}` : "—"} />
            <UsageBar icon={RamIcon} tone="text-info" label="메모리" pct={sys?.mem?.pct ?? 0} detail={sys ? `${sys.mem.usedGb}/${sys.mem.totalGb}GB` : "—"} />
            <UsageBar icon={HardDrive} tone="text-warn" label="디스크" pct={sys?.disk?.pct ?? 0} detail={sys ? `${sys.disk.usedGb}/${sys.disk.totalGb}GB` : "—"} />
          </div>
          <div className="text-sm font-medium mt-5 mb-2.5">서비스 상태</div>
          <div className="flex flex-wrap gap-2">
            <HealthPill ok={!!sys?.health?.ollama} label="Ollama" />
            <HealthPill ok={!!sys?.health?.worker} label="Worker" />
            <HealthPill ok={!!sys?.health?.db} label="DB" />
          </div>
        </div>
      </div>

      {/* 요청/토큰 추세 + 에러 */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-medium flex items-center gap-2"><Activity className="w-4 h-4 text-success" /> 요청 / 토큰 추세</div>
            <span className="text-xs text-faint">최근 24시간 · 총 {an?.total ?? 0}건</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={an?.timeseries ?? []}>
              <defs><linearGradient id="gReq" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5} /><stop offset="100%" stopColor="#38bdf8" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="#222c3d" vertical={false} />
              <XAxis dataKey="t" tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} stroke="#5a6678" fontSize={10} tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis stroke="#5a6678" fontSize={11} tickLine={false} axisLine={false} width={28} />
              <Tooltip contentStyle={tip} labelFormatter={(t) => new Date(t).toLocaleString()} />
              <Area type="monotone" dataKey="requests" stroke="#38bdf8" strokeWidth={2} fill="url(#gReq)" name="요청" />
              <Area type="monotone" dataKey="errors" stroke="#f43f5e" strokeWidth={2} fill="none" name="에러" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="text-sm font-medium mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-danger" /> 에러 / 최근 실패</div>
          {(an?.errorBreakdown?.length ?? 0) === 0 ? (
            <div className="text-sm text-faint py-6 text-center">최근 24시간 에러 없음 ✓</div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                {an.errorBreakdown.map((e: any) => (
                  <span key={e.status} className="badge bg-danger/15 text-danger">{e.status} · {e.count}</span>
                ))}
              </div>
              <div className="space-y-1.5 text-xs">
                {an.recentErrors.map((e: any, i: number) => (
                  <div key={i} className="flex justify-between gap-2 text-muted">
                    <span className="font-mono truncate">{e.endpoint}</span>
                    <span className="shrink-0 text-danger">{e.status}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 분해: 모델별 / 엔드포인트별 / 키별 */}
      <div className="grid lg:grid-cols-3 gap-4">
        <BreakdownCard title="모델별 사용량" rows={an?.byModel} unit="건"
          render={(r: any) => `${r.count}건 · ${r.avgLatency}ms`} />
        <div className="card">
          <div className="text-sm font-medium mb-4">엔드포인트별 호출</div>
          <ResponsiveContainer width="100%" height={Math.max(120, (an?.byEndpoint?.length ?? 1) * 34)}>
            <BarChart data={an?.byEndpoint ?? []} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" hide /><YAxis type="category" dataKey="name" width={130} stroke="#8a97ad" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => v.replace("/api/", "")} />
              <Tooltip contentStyle={tip} />
              <Bar dataKey="count" fill="#6366f1" radius={[0, 6, 6, 0]} name="호출" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <BreakdownCard title="API 키별 사용량 (24h)" rows={an?.topKeys} unit="건"
          render={(r: any) => `${r.count}건 · ${r.tokens} tok`} />
      </div>
    </div>
  );
}

function BreakdownCard({ title, rows, render }: { title: string; rows?: any[]; unit: string; render: (r: any) => string }) {
  return (
    <div className="card">
      <div className="text-sm font-medium mb-3">{title}</div>
      {(rows?.length ?? 0) === 0 ? (
        <div className="text-sm text-faint py-6 text-center">데이터 없음</div>
      ) : (
        <div className="space-y-2">
          {rows!.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate font-mono text-xs">{r.name}</span>
              <span className="text-faint text-xs shrink-0">{render(r)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
