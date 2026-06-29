#!/bin/sh
set -e
# 로컬 prisma CLI(node_modules)로 스키마 동기화 후 standalone 서버 기동.
# 관리자 시드/지표수집기는 instrumentation(server.js 가 실행) 에서 처리.
./node_modules/.bin/prisma db push --skip-generate --accept-data-loss || echo "db push 실패 (이미 동기화됐을 수 있음)"
exec node server.js
