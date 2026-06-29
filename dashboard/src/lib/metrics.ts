// 지표 수집 스케줄러. 서버 프로세스에서 한 번만 시작되어
// worker(pynvml) + ollama(/api/ps) 를 폴링해 MetricSample 에 적재한다.
import { prisma } from "./db";
import { fetchGpuMetrics } from "./worker";
import { runningModels } from "./ollama";

const INTERVAL = Number(process.env.METRICS_INTERVAL_MS ?? 2000);
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7일 보존

let started = false;

export function startMetricsCollector() {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      const [gpus, running] = await Promise.all([
        fetchGpuMetrics(),
        runningModels(),
      ]);
      const loaded = running[0]?.name ?? null;
      if (gpus.length) {
        await prisma.metricSample.createMany({
          data: gpus.map((g) => ({
            gpuIndex: g.index,
            utilization: g.utilization,
            memUsedMb: g.memUsedMb,
            memTotalMb: g.memTotalMb,
            tempC: g.tempC,
            powerW: g.powerW,
            loadedModel: loaded,
          })),
        });
      }
    } catch (e) {
      console.error("[metrics] tick error", e);
    }
  };

  // 보존정책: 10분마다 오래된 샘플 정리
  const cleanup = async () => {
    try {
      await prisma.metricSample.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } },
      });
    } catch (e) {
      console.error("[metrics] cleanup error", e);
    }
  };

  setInterval(tick, INTERVAL);
  setInterval(cleanup, 10 * 60 * 1000);
  console.log(`[metrics] collector started (interval=${INTERVAL}ms)`);
}
