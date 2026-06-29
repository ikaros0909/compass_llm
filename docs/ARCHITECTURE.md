# Compass LLM — 설계 문서 (Architecture)

> 사내/고객사 GPU 서버에 **설치형(on-premise)** 으로 배포하는 오픈소스 LLM 운영 솔루션.
> 웹 대시보드로 모든 현황을 모니터링하고 통제한다.
>
> 본 문서는 기존 `langserve_ollama`(FastAPI + Ollama + Streamlit) 프로토타입을
> **Next.js 풀스택 + Python 워커 + Docker Compose** 제품으로 재구성하는 설계를 정의한다.

---

## 1. 목표와 비목표

### 목표
- GPU 서버에 `install.sh` 한 번으로 설치되는 제품
- 브라우저로 접속하는 **관리자 대시보드**: GPU/모델/요청/키/RAG/로그를 한눈에 모니터링·통제
- 외부 시스템이 호출하는 **공개 API**(API Key 인증, Rate limit) — 기존 기능 유지
- 채팅·멀티모달·RAG·STT(Whisper)·화자분리·영상분석 기능 보존

### 비목표 (1차 범위 제외)
- 멀티 노드/클러스터 오케스트레이션 (단일 GPU 서버 기준)
- 모델 파인튜닝 파이프라인
- 빌링/과금 시스템 (사용량 집계까지만)

---

## 2. 아키텍처 개요

"Next.js 풀스택 통합" 결정에 따라, **Next.js가 컨트롤 플레인(두뇌)** 역할을 하고,
Python 전용 의존성(faiss, whisper, opencv, pynvml)은 **Python 워커**로 분리한다.

```
                          ┌──────────────────────────┐
   브라우저(관리자) ──────▶│  Caddy (reverse proxy)   │  443 단일 진입점, 자동 TLS
   외부 API 소비자 ───────▶│  / → dashboard           │
                          │  /api → dashboard        │
                          └────────────┬─────────────┘
                                       │
                ┌──────────────────────▼───────────────────────┐
                │  dashboard  (Next.js 풀스택, App Router)       │
                │  - 관리자 인증(session/JWT)                    │
                │  - 공개 API(/api/v1/*): Bearer 토큰·Rate      │
                │  - 관리 API(/api/admin/*)                     │
                │  - 채팅: Ollama 직접 호출(stream)             │
                │  - 지표 수집 스케줄러 + WebSocket push        │
                │  - Prisma ORM                                 │
                └───────┬───────────────────┬──────────────────┘
                        │                   │
          ┌─────────────▼──────┐   ┌────────▼─────────────────┐
          │  Postgres          │   │  worker (Python/FastAPI) │  내부 네트워크 전용
          │  - users(admin)    │   │  - RAG(faiss+임베딩)     │
          │  - api_keys        │   │  - Whisper STT/화자분리  │
          │  - request_logs    │   │  - OpenCV 이미지 전처리  │
          │  - metric_samples  │   │  - 영상 처리             │
          │  - rag_collections │   │  - GPU 지표(pynvml)      │
          └────────────────────┘   └────────┬─────────────────┘
                                            │
                                   ┌────────▼─────────┐
                                   │  Ollama (GPU)    │  11434
                                   │  - 모델 추론     │
                                   │  - 모델 관리 API │
                                   └──────────────────┘
```

### 호출 흐름
- **텍스트 채팅**: 브라우저/외부 → dashboard `/api/v1/chat` → Ollama `/api/chat`(스트리밍) → dashboard가 토큰·지연시간 기록 → Postgres
- **RAG/멀티미디어**: dashboard → worker(내부) → (필요 시) Ollama → dashboard가 응답·로그 집계
- **모델 관리**: dashboard `/api/admin/models` → Ollama `/api/tags`, `/api/ps`, `/api/pull`, `/api/delete`
- **GPU 지표**: dashboard 스케줄러(2초 주기) → worker `/internal/metrics`(pynvml) + Ollama `/api/ps` → Postgres `metric_samples` → WebSocket으로 대시보드에 push

> **왜 워커를 두는가?** faiss/whisper/opencv/pynvml은 Python 네이티브 생태계다.
> Next.js로 포팅하면 비용이 크고 품질이 떨어진다. 이미 검증된 `langserve_ollama/app`
> 코드를 워커로 거의 그대로 재사용한다.

---

## 3. 컴포넌트 책임 분담

| 컴포넌트 | 언어/기술 | 책임 | 기존 코드 재사용 |
|---|---|---|---|
| **dashboard** | Next.js 14, TS, Tailwind, shadcn/ui, Prisma | 인증, 공개 API 게이트웨이, 관리 API, 채팅 프록시, 지표 수집·WebSocket, 모든 UI | (신규) api_keys 로직을 TS로 이식 |
| **worker** | Python 3.11, FastAPI | RAG, Whisper, OpenCV, 영상, GPU 지표 | `rag_collections.py`, `video_processor.py`, `image_preprocess.py` 그대로 |
| **ollama** | Ollama 공식 이미지 | 모델 추론·관리 | 기존 Modelfile/GGUF 재사용 |
| **db** | Postgres 16 | 영속 데이터 | `api_keys.db`(SQLite) → Postgres 이전 |
| **proxy** | Caddy 2 | TLS 종단, 라우팅, 단일 포트 | (신규) |

---

## 4. 데이터 모델 (Prisma / Postgres)

```prisma
model AdminUser {            // 대시보드 관리자 계정
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  role         String   @default("admin")   // admin | viewer
  createdAt    DateTime @default(now())
}

model ApiKey {              // 외부 API 소비자 키 (단일 토큰, OpenAI 스타일)
  id          String   @id @default(cuid())
  name        String
  apiKey      String                          // 표시용 prefix "sk-3e54…fd3e" (비밀 아님)
  secretHash  String   @unique               // sha256(토큰) — 단일 토큰 조회 키
  isActive    Boolean  @default(true)
  rateLimit   Int      @default(30)           // 분당 요청 한도
  createdAt   DateTime @default(now())
  requestLogs RequestLog[]
}

model RequestLog {          // 요청 1건 = 1행 (통계의 원천)
  id           BigInt   @id @default(autoincrement())
  apiKeyId     String?
  apiKey       ApiKey?  @relation(fields: [apiKeyId], references: [id])
  endpoint     String                          // "/api/v1/chat"
  model        String?
  status       Int                             // HTTP status
  latencyMs    Int
  inputTokens  Int      @default(0)
  outputTokens Int      @default(0)
  clientIp     String?
  createdAt    DateTime @default(now())
  @@index([createdAt])
  @@index([apiKeyId, createdAt])
}

model MetricSample {        // GPU/시스템 시계열 (2초~10초 주기)
  id          BigInt   @id @default(autoincrement())
  gpuIndex    Int
  utilization Float                            // %
  memUsedMb   Int
  memTotalMb  Int
  tempC       Float
  powerW      Float
  loadedModel String?                          // Ollama /api/ps 결과
  createdAt   DateTime @default(now())
  @@index([createdAt])
}

model RagCollection {       // RAG 컬렉션 메타데이터 (벡터는 워커 디스크)
  id          String   @id @default(cuid())
  name        String   @unique
  description String   @default("")
  fileCount   Int      @default(0)
  createdAt   DateTime @default(now())
}
```

> 기존 SQLite `request_log`는 timestamp만 있었다. 여기에 `model/status/latency/tokens`를
> 추가해 **요청 통계 대시보드의 데이터 소스**로 승격한다.

---

## 5. API 표면

### 5.1 공개 API (`/api/v1/*`) — 단일 토큰(`Authorization: Bearer`) 인증, Rate limit
OpenAI/Gemini 스타일 단일 키. `Authorization: Bearer <키>` 또는 `X-API-Key: <키>` 헤더.
(구 2-키 클라이언트의 `X-Secret-Key` 값도 토큰으로 인식해 무중단 호환):

| 엔드포인트 | 메서드 | 처리 위치 | 비고 |
|---|---|---|---|
| `/api/v1/chat` | POST | dashboard → Ollama | 스트리밍 지원, RAG 시 worker 경유 |
| `/api/v1/chat-upload` | POST | dashboard → worker | 이미지+텍스트 |
| `/api/v1/models` | GET | dashboard → Ollama | 사용 가능 모델 |
| `/api/v1/rag/*` | GET/POST/DELETE | dashboard → worker | 컬렉션·업로드 |
| `/api/v1/transcribe` | POST | dashboard → worker | 자막/스크립트 |
| `/api/v1/transcribe/diarize` | POST | dashboard → worker | 화자 분리 |
| `/api/v1/video` | POST | dashboard → worker | 영상 분석 |
| `/api/v1/health` | GET | dashboard | 인증 불필요 |

### 5.2 관리 API (`/api/admin/*`) — 관리자 세션 인증
| 엔드포인트 | 설명 |
|---|---|
| `GET /api/admin/overview` | GPU·요청·모델 요약 카드 데이터 |
| `GET /api/admin/metrics?range=1h` | 시계열(차트용) |
| `GET /api/admin/models` · `POST /pull` · `DELETE` · `POST /load` `/unload` | 모델 관리 (Ollama 프록시) |
| `GET/POST/DELETE /api/admin/keys` | API 키 CRUD + 키별 사용 통계 |
| `GET/POST/DELETE /api/admin/rag/*` | RAG 관리 |
| `GET /api/admin/logs?...` | 요청 로그 검색/필터 |
| `WS  /api/admin/live` | 실시간 지표 push |
| `POST /api/admin/auth/login` · `logout` | 관리자 인증 |

---

## 6. 인증 설계 (2개의 독립된 평면)

1. **관리자 인증** (대시보드 접근): 이메일+비밀번호 → 세션 쿠키(httpOnly) 또는 JWT.
   `bcrypt`로 비밀번호 해시. 최초 부팅 시 `.env`의 `ADMIN_EMAIL/ADMIN_PASSWORD`로 시드.
2. **공개 API 인증** (외부 소비자): **단일 토큰** `Authorization: Bearer <키>` (OpenAI 스타일).
   토큰은 sha256 해시로만 저장하고 발급 시 1회만 노출. 라우트(`/api/v1/*`)에서 검증·Rate limit.

> 두 평면을 분리해 "외부에 API는 열되 운영 콘솔은 보호"한다. 관리 API는 절대 공개 키로 접근 불가.

---

## 7. 모니터링 & 통제 기능 명세

### 모니터링 (대시보드 화면)
- **개요(Overview)**: GPU 사용률/VRAM 게이지, 분당 요청수·평균 지연·에러율, 현재 로드된 모델, tokens/sec
- **GPU 시계열**: 사용률/VRAM/온도/전력 라인 차트 (range: 1h/6h/24h/7d)
- **요청 통계**: 시간대별 요청량, 모델별 분포, 키별 Top 사용량, 지연 분포(p50/p95)
- **로그**: 실시간 스트림 + 검색(엔드포인트/모델/상태/키/기간)

### 통제 (대시보드 액션)
- **모델**: 다운로드(pull, 진행률 표시) / 삭제 / 로드 / 언로드
- **API 키**: 생성(secret 1회 노출) / 비활성 / 삭제 / Rate limit 조정
- **RAG**: 컬렉션 생성·삭제, 문서 업로드·삭제
- **시스템**: 헬스 상태, 서비스별 up/down, 워커/Ollama 핑

### 지표 수집 파이프라인
- dashboard 내 `setInterval` 스케줄러(서버 사이드, 단일 인스턴스) 또는 별도 경량 cron
- 2초 주기로 worker `/internal/metrics`(pynvml) + Ollama `/api/ps` 폴링 → `MetricSample` insert
- 오래된 샘플은 보존 정책(예: 7일)으로 정리 (다운샘플링은 2차)
- 라이브 화면은 WebSocket(`/api/admin/live`)로 push, 과거 차트는 DB 쿼리

> **대안(스케일 시)**: Prometheus + `dcgm-exporter` + `node_exporter`로 교체 가능.
> 1차는 자체 수집으로 단순하게, 부하가 커지면 Prometheus로 이관.

---

## 8. 배포 / 패키징 (Docker Compose)

### 서비스
```
ollama     : GPU 추론. nvidia runtime, 모델 볼륨 영속화
worker     : Python. nvidia runtime(pynvml), 내부 네트워크만 노출
dashboard  : Next.js. Ollama·worker·db에 접근
db         : Postgres. 볼륨 영속화
caddy      : 443 단일 진입점, 자동 TLS, 정적/리버스 프록시
```

### 설치 경험 (`install.sh`)
1. 전제조건 점검: NVIDIA 드라이버, `nvidia-container-toolkit`, Docker, Compose
2. `.env` 생성(없으면 `.env.example` 복사 + 관리자 비번 입력)
3. `docker compose up -d`
4. 기본 모델 자동 pull (`docker compose exec ollama ollama pull gemma4:26b`)
5. 완료 안내: `https://<서버주소>` 접속 → 관리자 로그인

### 영속 볼륨
- `ollama_models`(GGUF/모델), `pg_data`(DB), `rag_store`(워커 faiss 인덱스), `caddy_data`(인증서)

> EXAONE 4.5 같은 비공식 GGUF 모델은 `worker`/`ollama`에 마운트한 `gguf/` + Modelfile로
> `ollama create` 하는 초기화 스크립트를 entrypoint에 포함.

---

## 9. 단계별 구현 로드맵

| 단계 | 산출물 | 상태 |
|---|---|---|
| 0 | 본 설계 문서 + 스캐폴딩 + docker-compose | ← 현재 |
| 1 | 관리자 인증 + 개요 대시보드 + GPU 지표 수집/차트 | |
| 2 | 모델 관리(pull/삭제/로드) + 요청 로깅·통계 | |
| 3 | 공개 API 게이트웨이(/api/v1/chat 스트리밍) + API 키 관리 이식 | |
| 4 | RAG·STT·영상 워커 통합 + 플레이그라운드 채팅 UI | |
| 5 | 운영(백업/복원, 로그 보존정책, 라이선스 키) + 하드닝 | |

---

## 10. 기존 프로토타입 → 신규 매핑

| 기존 (`langserve_ollama`) | 신규 위치 |
|---|---|
| `app/server.py` 인증 미들웨어 | `dashboard/src/middleware.ts` (TS 재작성) |
| `app/api_keys.py` | `dashboard/src/lib/apiKeys.ts` + Prisma |
| `app/server.py` /api/chat | `dashboard/src/app/api/v1/chat/route.ts` |
| `app/rag_collections.py` | `worker/app/rag_collections.py` (그대로) |
| `app/video_processor.py` | `worker/app/video_processor.py` (그대로) |
| `app/image_preprocess.py` | `worker/app/image_preprocess.py` (그대로) |
| `example/main.py` (Streamlit) | `dashboard` UI 전체로 대체 |
| `data/api_keys.db` | Postgres `ApiKey`/`RequestLog` |

---

## 11. 보안 체크리스트
- 관리 API는 세션 인증 필수, 공개 API 키로 접근 불가
- worker·db·ollama는 외부 포트 미노출(Docker 내부 네트워크만)
- secret_key는 해시 저장·1회 노출 원칙 유지
- Caddy 자동 HTTPS, HSTS
- Rate limit + (선택) IP allowlist
- 업로드 파일 크기·확장자 제한, 임시 디렉터리 격리(기존 코드 유지)
- `.env` 비밀값은 git 제외, 설치 시 생성