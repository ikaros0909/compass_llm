#!/usr/bin/env python3
"""
로컬 개발용 SQLite Prisma 스키마를 운영 스키마(schema.prisma, Postgres)에서 생성한다.
운영 스키마는 단일 진실 소스(single source of truth)로 유지하고, 여기서 아래 두 가지만
SQLite 제약에 맞게 자동 변환한다:

  1) datasource provider: postgresql -> sqlite
  2) BigInt @id @default(autoincrement()) -> Int @id @default(autoincrement())
     (SQLite 의 AUTOINCREMENT 는 INTEGER PRIMARY KEY 에서만 동작)

운영(Postgres)에서는 BigInt 가 그대로 유지되므로 영향 없음.
앱 코드는 id 를 String(...) 으로만 다루어 number/bigint 양쪽과 호환된다.
"""
import re
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "prisma" / "schema.prisma").read_text()

# 1) datasource → sqlite
src = re.sub(
    r"datasource db \{[^}]*\}",
    'datasource db {\n  provider = "sqlite"\n  url      = env("DATABASE_URL")\n}',
    src,
    flags=re.S,
)

# 2) BigInt autoincrement id → Int (SQLite 제약)
src = re.sub(
    r"BigInt(\s+@id @default\(autoincrement\(\)\))",
    r"Int\1",
    src,
)

out = root / "prisma" / "schema.dev.prisma"
out.write_text(src)
print(f"generated {out}")
