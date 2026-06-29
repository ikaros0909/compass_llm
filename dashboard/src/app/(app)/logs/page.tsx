"use client";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import PageHeader from "@/components/PageHeader";
import { ScrollText } from "lucide-react";

export default function LogsPage() {
  const { data } = useSWR("/api/admin/logs?take=200", fetcher, { refreshInterval: 3000 });
  const logs = data?.logs ?? [];

  return (
    <div>
      <PageHeader title="요청 로그" desc="공개 API 요청 실시간 기록">
        <span className="badge badge-on"><span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse2" /> 3초 갱신</span>
      </PageHeader>

      <div className="card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted text-left text-xs uppercase tracking-wide">
              <tr className="border-b border-border">
                <th className="font-medium px-5 py-3">시각</th>
                <th className="font-medium px-3 py-3">엔드포인트</th>
                <th className="font-medium px-3 py-3">모델</th>
                <th className="font-medium px-3 py-3">상태</th>
                <th className="font-medium px-3 py-3">지연</th>
                <th className="font-medium px-3 py-3">토큰</th>
                <th className="font-medium px-5 py-3">키</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-faint">
                  <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-50" /> 아직 요청 기록이 없습니다.
                </td></tr>
              )}
              {logs.map((l: any) => (
                <tr key={l.id} className="table-row">
                  <td className="px-5 py-3 whitespace-nowrap text-muted tabular-nums">{new Date(l.at).toLocaleTimeString()}</td>
                  <td className="px-3 py-3 font-mono text-xs">{l.endpoint}</td>
                  <td className="px-3 py-3 text-muted">{l.model ?? "—"}</td>
                  <td className="px-3 py-3">
                    <span className={`badge ${l.status >= 400 ? "bg-danger/15 text-danger" : "badge-on"}`}>{l.status}</span>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-muted">{l.latencyMs}ms</td>
                  <td className="px-3 py-3 tabular-nums text-muted">{l.tokens}</td>
                  <td className="px-5 py-3 text-muted">{l.keyName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
