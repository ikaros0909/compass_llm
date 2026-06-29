#!/usr/bin/env bash
set -euo pipefail

# ── Compass LLM 설치 스크립트 ──
# GPU 서버에 Docker Compose 로 전체 스택을 설치합니다.

cd "$(dirname "$0")"

say()  { printf "\033[1;36m▶ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m! %s\033[0m\n" "$*"; }
die()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

say "1/5 전제조건 점검"
command -v docker >/dev/null            || die "Docker 가 필요합니다: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1  || die "Docker Compose v2 플러그인이 필요합니다."
command -v nvidia-smi >/dev/null        || warn "nvidia-smi 미발견 — GPU 없이 실행하면 추론이 매우 느립니다."
docker info 2>/dev/null | grep -qi nvidia || warn "nvidia-container-toolkit 미설치로 보입니다. GPU 패스스루가 안 될 수 있습니다."

say "2/5 환경 변수(.env) 준비"
if [ ! -f .env ]; then
  cp .env.example .env
  # 비밀값 자동 생성 (Linux/macOS 공통)
  gen() { openssl rand -hex "${1:-16}"; }
  sed -i.bak "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(gen 24)/" .env
  sed -i.bak "s/^AUTH_SECRET=.*/AUTH_SECRET=$(gen 32)/" .env
  ADMIN_PW="$(gen 12)"
  sed -i.bak "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=${ADMIN_PW}/" .env
  rm -f .env.bak
  warn "생성된 관리자 비밀번호: ${ADMIN_PW}  (.env 에 저장됨 — 분실 주의)"
else
  say ".env 가 이미 존재합니다. 기존 설정을 사용합니다."
fi

say "3/5 컨테이너 빌드 및 기동"
docker compose up -d --build

say "4/5 기본 모델 다운로드 (gemma4:26b, 약 17GB)"
docker compose exec -T ollama ollama pull gemma4:26b || warn "모델 pull 실패 — 나중에 대시보드에서 받으세요."

say "5/5 완료"
ADDR="$(grep -E '^SITE_ADDRESS=' .env | cut -d= -f2)"
echo
say "접속: http://<서버주소>${ADDR#:}  (도메인 설정 시 https)"
say "관리자 계정: $(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2)"
echo "상태 확인:  docker compose ps"
echo "로그:       docker compose logs -f dashboard"
