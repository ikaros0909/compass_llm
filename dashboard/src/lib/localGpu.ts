// 로컬 개발 폴백: 워커가 없을 때 대시보드 호스트의 nvidia-smi 를 직접 읽어 GPU 지표 제공.
// 운영(대시보드 컨테이너에 GPU/nvidia-smi 없음)에서는 실패 → 빈 배열 반환(워커가 담당).
import { execFile } from "node:child_process";

export interface GpuSample {
  index: number;
  utilization: number;
  memUsedMb: number;
  memTotalMb: number;
  tempC: number;
  powerW: number;
}

export function readLocalGpus(): Promise<GpuSample[]> {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      [
        "--query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 2000 },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const gpus: GpuSample[] = [];
        for (const line of stdout.trim().split("\n")) {
          const p = line.split(",").map((s) => s.trim());
          if (p.length < 6) continue;
          const num = (v: string) => {
            const n = parseFloat(v);
            return Number.isFinite(n) ? n : 0;
          };
          gpus.push({
            index: num(p[0]),
            utilization: num(p[1]),
            memUsedMb: num(p[2]),
            memTotalMb: num(p[3]),
            tempC: num(p[4]),
            powerW: num(p[5]),
          });
        }
        resolve(gpus);
      },
    );
  });
}
