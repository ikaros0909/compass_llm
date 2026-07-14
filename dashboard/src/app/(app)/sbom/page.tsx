"use client";
import PageHeader from "@/components/PageHeader";
import { ShieldAlert, PackageSearch, CalendarClock, GitBranch, ScanLine, Database, ArrowRight } from "lucide-react";

// SBOM 보안 — 저장소별 의존성 취약점(CVE) 일일 점검.
// 현재는 설계/도입 준비 단계 스캐폴드. 스캔 백엔드 확정 후 실데이터로 대체.
const STEPS = [
  { icon: GitBranch, title: "저장소 수집", desc: "코드리뷰와 동일한 Bitbucket 토큰으로 대상 저장소의 의존성 매니페스트/락파일을 가져옵니다." },
  { icon: ScanLine, title: "스캔", desc: "Trivy 로 의존성을 스캔해 알려진 취약점(CVE)과 수정 버전을 식별합니다." },
  { icon: Database, title: "저장", desc: "저장소·일자별로 심각도 집계와 취약점 상세를 DB 에 적재합니다." },
  { icon: CalendarClock, title: "일일 자동 실행", desc: "매일 정해진 시각에 폴러가 전체 저장소를 재스캔하고 신규/해결 취약점을 갱신합니다." },
];

export default function SbomPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="SBOM 보안" desc="저장소별 의존성 취약점(SBOM)을 매일 점검합니다">
        <span className="badge bg-warn/15 text-warn"><ShieldAlert className="w-3.5 h-3.5" /> 도입 준비 중</span>
      </PageHeader>

      {/* 개요 */}
      <div className="card flex items-start gap-3">
        <PackageSearch className="w-5 h-5 text-accent-2 shrink-0 mt-0.5" />
        <div className="text-sm text-muted leading-relaxed">
          <b className="text-gray-200">SBOM(Software Bill of Materials)</b> 보안 점검은 각 저장소가 사용하는 오픈소스 의존성의
          <b className="text-gray-200"> 알려진 취약점(CVE)</b>을 매일 자동으로 확인합니다. 코드리뷰가 "이번 변경"을 본다면, 여기서는
          "지금 쓰고 있는 라이브러리에 새로 공개된 취약점"을 추적합니다.
        </div>
      </div>

      {/* 일일 점검 흐름 */}
      <div className="card">
        <div className="text-sm font-medium mb-4">일일 점검 흐름 (제안)</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {STEPS.map((s, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface/50 p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="grid place-items-center w-7 h-7 rounded-lg bg-accent/15 text-accent-2 shrink-0"><s.icon className="w-4 h-4" /></div>
                <span className="text-sm font-medium">{i + 1}. {s.title}</span>
              </div>
              <p className="text-xs text-muted leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 결과 화면 미리보기 (실데이터 연결 전) */}
      <div className="card !p-0 overflow-hidden">
        <div className="px-5 py-3 text-sm font-medium border-b border-border flex items-center gap-2">
          저장소별 취약점 현황 <span className="text-xs text-faint">(예시 · 스캔 연결 후 실데이터)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[44rem]">
            <thead className="text-muted text-left text-xs uppercase tracking-wide">
              <tr className="border-b border-border">
                <th className="font-medium px-5 py-3">저장소</th>
                <th className="font-medium px-3 py-3 text-center">Critical</th>
                <th className="font-medium px-3 py-3 text-center">High</th>
                <th className="font-medium px-3 py-3 text-center">Medium</th>
                <th className="font-medium px-3 py-3 text-center">Low</th>
                <th className="font-medium px-3 py-3">마지막 스캔</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-faint">
                  <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  아직 스캔 결과가 없습니다. 스캔 백엔드를 연결하면 저장소별 취약점이 이곳에 표시됩니다.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card !py-3 flex items-center gap-2 text-xs text-muted">
        <ArrowRight className="w-4 h-4 text-accent-2 shrink-0" />
        스캐너 도구·스케줄·저장소 선택 방식을 확정하면 실제 스캔·저장·알림까지 연결합니다.
      </div>
    </div>
  );
}
