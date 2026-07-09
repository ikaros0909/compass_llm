"""경로 조작(Path Traversal) 방지 유틸.

업로드 파일명·컬렉션명은 외부(공개 API 프록시) 입력이므로 그대로 경로에
결합하면 tmp/컬렉션 디렉터리를 벗어나 임의 파일 쓰기·삭제가 가능하다.
모든 파일시스템 접근 전에 여기서 정규화·검증한다.
"""
import os
import re

# 컬렉션명 등 '식별자' 세그먼트: 영문/숫자/한글/공백/._- 만 허용.
_SEGMENT_RE = re.compile(r"^[\w가-힣 .\-]+$", re.UNICODE)


def safe_filename(name: str) -> str:
    """업로드 파일명을 basename 으로 축소하고 검증. 위반 시 ValueError."""
    base = os.path.basename((name or "").replace("\\", "/")).strip()
    if not base or base in (".", "..") or "/" in base or "\x00" in base:
        raise ValueError(f"잘못된 파일명: {name!r}")
    return base


def safe_segment(name: str) -> str:
    """단일 경로 세그먼트(컬렉션명 등) 검증. 위반 시 ValueError."""
    n = (name or "").strip()
    if not n or n in (".", "..") or "/" in n or "\\" in n or "\x00" in n or not _SEGMENT_RE.match(n):
        raise ValueError(f"잘못된 이름: {name!r}")
    return n


def safe_join(base_dir: str, *parts: str) -> str:
    """base_dir 하위 경로임을 보장하며 결합. 벗어나면 ValueError."""
    base = os.path.realpath(base_dir)
    target = os.path.realpath(os.path.join(base, *parts))
    if target != base and not target.startswith(base + os.sep):
        raise ValueError("경로가 허용 범위를 벗어났습니다.")
    return target
