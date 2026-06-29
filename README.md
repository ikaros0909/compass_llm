# Compass LLM

GPU 서버에 **설치형(on-premise)** 으로 배포하는 오픈소스 LLM 운영 솔루션.
웹 대시보드로 GPU·모델·요청·API 키·RAG·로그를 **모니터링하고 통제**합니다.

> 기존 `langserve_ollama` 프로토타입(FastAPI + Ollama + Streamlit)을
> **Next.js 풀스택 + Python 워커 + Docker Compose** 제품으로 재구성한 솔루션입니다.
> 상세 설계는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 참고.

## 구성

```
compass_llm/
├── docker-compose.yml      # 전체 스택 (ollama, worker, db, dashboard, caddy)
├── install.sh              # 원클릭 설치
├── Caddyfile               # 리버스 프록시 / 자동 TLS
├── .env.example            # 환경 변수 템플릿
├── docs/ARCHITECTURE.md    # 설계 문서
├── dashboard/              # Next.js 풀스택 (관리 콘솔 + 공개 API)
└── worker/                 # Python FastAPI (RAG, Whisper, OpenCV, GPU 지표)
```

## 배포 (GPU 서버에 Docker Compose 로 설치)

실제 운영 서버에 처음부터 배포하는 전체 절차입니다. **1 → 8단계**를 순서대로 따라 하세요.
빠르게 끝내려면 [자동 설치(`install.sh`)](#4-a-자동-설치-권장)만, 단계별로 통제하려면 [수동 설치](#4-b-수동-설치-단계별-통제)를 보세요.

### 서비스 구성 (배포되는 컨테이너)

`docker compose up` 한 번으로 아래 5개 컨테이너가 하나의 내부 네트워크(`internal`)로 묶여 기동됩니다.
**외부에 열리는 포트는 Caddy(80/443)뿐**이며, 나머지는 전부 내부 통신만 합니다.

| 서비스 | 이미지 / 빌드 | 역할 | 포트 | GPU |
|---|---|---|---|---|
| `caddy` | caddy:2-alpine | 단일 진입점, 리버스 프록시, 자동 HTTPS | **80, 443 (외부 공개)** | — |
| `dashboard` | `./dashboard` (Next.js) | 관리 콘솔 + 공개 API(`/api/v1/*`) | 3000 (내부) | — |
| `worker` | `./worker` (FastAPI) | RAG·Whisper(STT)·OpenCV·GPU 지표 | 8100 (내부) | ✅ |
| `ollama` | ollama/ollama:latest | LLM 추론 엔진 | 11434 (내부) | ✅ |
| `db` | postgres:16-alpine | 메타데이터(키·로그·사용자) | 5432 (내부) | — |

영구 데이터는 named volume 에 저장됩니다: `ollama_models`(모델 가중치), `pg_data`(DB), `rag_store`(RAG 인덱스), `caddy_data`/`caddy_config`(TLS 인증서). → [백업](#7-백업--복구) 참고.

### 1. 시스템 요구사항

- **OS**: Ubuntu 22.04 LTS 이상 (다른 리눅스도 가능하나 아래 명령은 Ubuntu/Debian 기준)
- **GPU**: NVIDIA GPU + 최신 드라이버. 기본 모델 `gemma4:26b`(약 17GB)를 GPU 로 돌리려면 **VRAM 24GB 이상 권장** (A5000/A6000/4090/L40 등). VRAM 이 작으면 더 작은 모델을 쓰세요.
- **디스크**: 최소 **80GB 여유** (도커 이미지 ~15GB + 모델 ~17GB + 여유). 모델을 여러 개 받을 거면 그만큼 추가.
- **RAM**: 16GB 이상 권장.
- **네트워크**: 모델/이미지 다운로드를 위한 외부 인터넷. 공개 서비스 시 80/443 인바운드 허용.

> GPU 가 없어도 동작은 하지만 추론이 **매우 느립니다**(32B 모델은 CPU 로 사실상 사용 불가). 데모/소형 모델 검증 용도로만 권장.

### 2. 사전 설치 (Docker · NVIDIA Container Toolkit)

서버에 처음 설치하는 경우에만 필요합니다. 이미 있으면 [3단계](#3-소스-내려받기)로.

```bash
# 2-1. Docker Engine + Compose v2 플러그인
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"        # sudo 없이 docker 쓰기 (재로그인 필요)
newgrp docker                          # 현재 셸에 그룹 즉시 적용
docker compose version                 # v2.x 확인

# 2-2. NVIDIA 드라이버 (이미 설치돼 있으면 생략) — nvidia-smi 가 동작하면 OK
nvidia-smi

# 2-3. NVIDIA Container Toolkit (컨테이너에 GPU 패스스루)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# 2-4. GPU 패스스루 검증 — GPU 정보가 표로 출력되면 성공
docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi
```

공식 문서: [Docker Engine 설치](https://docs.docker.com/engine/install/) · [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)

### 3. 소스 내려받기

```bash
git clone <저장소-URL> compass_llm
cd compass_llm
```

### 4-A. 자동 설치 (권장)

`install.sh` 가 전제조건 점검 → `.env` 생성 및 **비밀값 자동 생성** → 빌드/기동 → 기본 모델 다운로드까지 한 번에 수행합니다.

```bash
chmod +x install.sh
./install.sh
```

스크립트가 하는 일(5단계):
1. Docker / Compose / GPU 도구 존재 점검 (없으면 중단 또는 경고)
2. `.env` 가 없으면 `.env.example` 복사 후 `POSTGRES_PASSWORD`·`AUTH_SECRET`·`ADMIN_PASSWORD` 를 `openssl` 로 **랜덤 생성** → **생성된 관리자 비밀번호를 콘솔에 한 번 출력하니 반드시 메모**하세요.
3. `docker compose up -d --build` 로 전체 스택 빌드·기동
4. 기본 모델 `gemma4:26b`(약 17GB) 다운로드 — 네트워크에 따라 수 분~수십 분
5. 접속 주소·관리자 계정·상태확인 명령 안내

완료되면 [5단계(접속/확인)](#5-접속--동작-확인)로.

### 4-B. 수동 설치 (단계별 통제)

도메인/모델/비밀값을 직접 정하고 싶다면 수동으로 진행합니다.

```bash
# (1) 환경 변수 파일 생성
cp .env.example .env

# (2) .env 편집 — 아래 "환경 변수" 표 참고. 최소한 비밀값 3개는 반드시 변경.
nano .env
#   강한 값 생성 예: openssl rand -hex 24   (POSTGRES_PASSWORD)
#                    openssl rand -hex 32   (AUTH_SECRET)

# (3) 빌드 + 백그라운드 기동
docker compose up -d --build

# (4) 기동 상태 확인 (db 는 healthy, 나머지는 running 이어야 정상)
docker compose ps

# (5) 기본 모델 다운로드 (원하는 모델로 교체 가능)
docker compose exec ollama ollama pull gemma4:26b
```

#### 환경 변수 (`.env`)

| 변수 | 필수 | 설명 |
|---|---|---|
| `SITE_ADDRESS` | ✅ | 접속 주소. 도메인이면 `llm.example.com` (자동 HTTPS), 내부망이면 `:80` (HTTP) |
| `POSTGRES_USER` | | DB 사용자 (기본 `compass`) |
| `POSTGRES_PASSWORD` | ✅ | DB 비밀번호 — **반드시 변경** |
| `POSTGRES_DB` | | DB 이름 (기본 `compass`) |
| `AUTH_SECRET` | ✅ | 세션 서명 키. `openssl rand -hex 32` — **반드시 변경** |
| `ADMIN_EMAIL` | ✅ | 최초 부팅 시 생성되는 관리자 이메일 |
| `ADMIN_PASSWORD` | ✅ | 관리자 초기 비밀번호 — **반드시 변경** |
| `HF_TOKEN` | | (선택) 화자분리(pyannote) 사용 시 HuggingFace 토큰 |

> `POSTGRES_PASSWORD`·`AUTH_SECRET`·`ADMIN_PASSWORD` 를 비워 두면 컨테이너가 기동되지 않습니다(compose 가 강제). 관리자 계정은 **DB 가 빈 최초 1회**만 시드되므로, 이후 비밀번호 변경은 대시보드에서 하세요.

### 5. 접속 & 동작 확인

```bash
docker compose ps                       # 전체 상태
docker compose logs -f dashboard        # 대시보드 로그 (시작/마이그레이션 확인)
```

- 브라우저에서 **`http://<서버-IP>`** (또는 도메인 설정 시 `https://<도메인>`) 접속
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` 로 로그인
- 헬스 체크: `curl http://<서버-IP>/api/v1/health`

기동 시 대시보드 컨테이너가 자동으로 `prisma db push`(스키마 동기화) 후 서버를 실행하고, 관리자 계정을 시드합니다. 첫 기동은 빌드 때문에 수 분 걸릴 수 있습니다.

### 6. 도메인 & HTTPS

`.env` 의 `SITE_ADDRESS` 한 줄로 결정됩니다.

- **공개 도메인**: DNS A 레코드를 서버 IP 로 지정 → `.env` 에 `SITE_ADDRESS=llm.example.com` → `docker compose up -d`.
  Caddy 가 **Let's Encrypt 인증서를 자동 발급/갱신**합니다 (80/443 인바운드가 열려 있어야 함).
- **내부망(HTTP)**: `SITE_ADDRESS=:80` 그대로 두고 사내 IP 로 접속.

변경 후에는 `docker compose up -d`(caddy 재생성)로 반영합니다.

### 7. 백업 & 복구

영구 데이터는 named volume 에 있습니다. **DB(`pg_data`)와 RAG(`rag_store`)** 를 정기 백업하세요. (모델은 다시 받을 수 있으므로 선택)

```bash
# Postgres 논리 백업 (권장)
docker compose exec -T db pg_dump -U compass compass > backup_$(date +%F).sql

# 복구
cat backup_2026-06-18.sql | docker compose exec -T db psql -U compass -d compass

# 볼륨 통째 백업 예 (RAG 인덱스)
docker run --rm -v compass_llm_rag_store:/data -v "$PWD":/out alpine \
  tar czf /out/rag_store_$(date +%F).tar.gz -C /data .
```
> 볼륨 이름은 `docker volume ls` 로 확인하세요(보통 `<프로젝트폴더명>_pg_data` 형태).

### 8. 운영 · 업데이트 · 트러블슈팅

```bash
# 상태 / 로그
docker compose ps
docker compose logs -f                 # 전체
docker compose logs -f worker          # 특정 서비스

# 재시작 / 중지 / 완전 종료
docker compose restart dashboard
docker compose stop
docker compose down                    # 컨테이너 제거 (볼륨/데이터는 보존)

# 소스 업데이트 후 재배포 (데이터 보존)
git pull
docker compose up -d --build

# 모델 관리 (대시보드 "모델 관리" 화면에서도 가능)
docker compose exec ollama ollama list
docker compose exec ollama ollama pull <모델명>
docker compose exec ollama ollama rm <모델명>
```

**자주 겪는 문제**

| 증상 | 원인 / 해결 |
|---|---|
| `could not select device driver "nvidia"` | NVIDIA Container Toolkit 미설치/미설정 → [2-3단계](#2-사전-설치-docker--nvidia-container-toolkit) 재수행 후 `sudo systemctl restart docker` |
| 추론이 극도로 느림 | GPU 패스스루 실패 또는 VRAM 부족. `docker compose exec worker nvidia-smi` 로 GPU 인식 확인, 더 작은 모델 사용 |
| `db` 가 `healthy` 안 됨 / 대시보드 재시작 반복 | `.env` 의 `POSTGRES_PASSWORD` 누락. `docker compose logs db` 확인 |
| 모델 pull 실패 | 디스크/네트워크 확인 후 `docker compose exec ollama ollama pull <모델>` 재시도 |
| 80/443 포트 충돌 | 호스트의 기존 웹서버(nginx 등) 중지하거나 `caddy` 포트 매핑 변경 |
| 관리자 비밀번호 분실 | DB 가 이미 시드된 상태라 `.env` 변경만으론 안 바뀜 → 대시보드 사용자 관리 또는 DB 직접 수정 |

> ⚠️ `docker-compose.override.yml` 은 **개발 전용**(호스트의 기존 Ollama 모델 재사용)입니다. 운영 서버에서는 이 파일을 두지 마세요(compose 가 자동 로드함). 필요 시 삭제하거나 `docker compose -f docker-compose.yml up -d` 로 명시적으로 제외하세요.

## 개발 (로컬, Docker 없이)

Postgres 없이 **SQLite** 로 대시보드를 띄워 실제 Ollama 에 붙여 검증할 수 있습니다.
`scripts/gen-dev-schema.py` 가 운영 스키마(Postgres)에서 SQLite 용 스키마를 자동 생성합니다
(BigInt 자동증가 → Int 변환 등 SQLite 제약 자동 처리. 운영 스키마는 그대로 유지).

> **Node 버전 주의**: Next.js 14 는 **Node.js 18.17 이상**(권장 20 LTS)이 필요합니다.
> 시스템 node 가 낮으면(`You are using Node.js 18.15.0 ...` 오류) nvm 으로 사용자 레벨 설치하세요(sudo 불필요):
> ```bash
> curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
> export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"   # 또는 터미널 재시작
> nvm install 20 && nvm alias default 20
> node --version   # v20.x 확인
> ```

```bash
# 1) dashboard (Node 18.17+ 필요 — 위 nvm 안내 참고)
cd dashboard && npm install
cp .env.local.example .env.local   # ★ 루트의 .env.example(도커/Postgres용) 아님!
                                   #    이 파일엔 DATABASE_URL=file:./dev.db 가 들어있음
npm run dev:setup                  # SQLite 스키마 생성 + db push + client generate
npm run dev:local                  # http://localhost:3000 (admin@compass.local / devpass)

# 2) worker (GPU 지표 + RAG/STT). 로컬엔 pynvml 만으로도 기동 가능
cd worker && python3 -m venv .venv && source .venv/bin/activate
pip install fastapi "uvicorn[standard]" nvidia-ml-py   # 경량 (전체: -r requirements.txt)
uvicorn app.main:app --port 8100
```

> 운영 배포는 항상 docker-compose 의 Postgres 를 사용합니다. SQLite 는 로컬 개발 전용입니다.

### 검증된 동작 (실제 Ollama 연동)
- 관리자 로그인/세션, 미인증 차단(401/307 redirect)
- 모델 목록(실 Ollama), 개요 카드/통계
- 공개 API `/api/v1/chat` 스트리밍 + 토큰 집계 + 요청 로깅
- Rate limit(분당 한도 초과 시 429), 잘못된 키 403

## 주요 화면 / 기능

- **개요**: GPU 사용률·VRAM, 분당 요청·지연·에러율, 로드된 모델
- **모델 관리**: pull / 삭제 / 로드 / 언로드
- **API 키**: 단일 키 발급(1회 노출) / 비활성 / 삭제 / Rate limit
- **RAG**: 컬렉션·문서 업로드/삭제, 채팅에서 컬렉션 참조
- **로그**: 실시간 + 검색
- **플레이그라운드**: 모델 채팅 테스트

## 공개 API (외부 소비자)

OpenAI/Gemini 처럼 **API 키 1개**를 `Authorization: Bearer` 헤더로 전달합니다.
(`X-API-Key: <키>` 단일 헤더도 허용)

```bash
# 기본 채팅
curl -N -X POST http://<서버주소>/api/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -d '{
    "message": "안녕하세요, 자기소개 해주세요.",
    "model": "gemma4:26b",
    "temperature": 0.5
  }'

# RAG: 컬렉션 참조 (RAG 메뉴에서 컬렉션 생성·문서 업로드 후)
curl -N -X POST http://<서버주소>/api/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -d '{
    "message": "수시 전형 지원 자격이 어떻게 되나요?",
    "rag_collection": "모집요강",
    "rag_mode": "search"
  }'

# STT: 음성/영상 → 자막 (모델 관리에서 Whisper 모델 다운로드 후, multipart)
curl -X POST http://<서버주소>/api/v1/transcribe \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -F "file=@회의녹음.mp3" \
  -F "whisper_model=base" -F "language=ko" -F "format=srt"
```

> 요청 본문 파라미터: `message`(필수), `model`, `system_prompt`, `temperature`, `rag_collection`, `rag_mode`, `images`.
> 대시보드 **API 키 → "API 사용 설명서"** 에서 동일한 예시(cURL/JS/Python)를 확인할 수 있습니다.

> 응답은 토큰 단위 `text/plain` 스트리밍입니다. 키는 발급 시 1회만 노출되며 DB 에는 해시만 저장됩니다.
> (구 2-키 클라이언트는 기존 `X-Secret-Key` 값을 그대로 보내도 동작합니다 — 무중단 호환.)
