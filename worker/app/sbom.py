"""SBOM 보안 스캔 — 저장소를 얕게 클론하고 Trivy 로 의존성 취약점(CVE)을 스캔.

- 대시보드가 저장소별로 호출(내부 엔드포인트). 인증 정보는 대시보드가 전달.
- 얕은 클론(--depth 1) → `trivy fs --scanners vuln` → JSON 파싱.
- Trivy 취약점 DB 는 TRIVY_CACHE_DIR(볼륨)에 캐시되어 재사용된다.
"""
import json
import os
import shutil
import subprocess
import tempfile
from urllib.parse import quote


def _clone_url(workspace: str, repo_slug: str, token: str, auth_username: str) -> str:
    # git HTTPS 인증 사용자명은 자격증명 종류별로 다르다:
    #  - Atlassian API 토큰(사용자명이 이메일)      → x-bitbucket-api-token-auth
    #  - App Password(사용자명이 Bitbucket username) → 그 사용자명
    #  - Repository/Workspace Access Token(사용자명 없음) → x-token-auth
    qt = quote(token, safe="")
    if auth_username and "@" in auth_username:
        user = "x-bitbucket-api-token-auth"
    elif auth_username:
        user = quote(auth_username, safe="")
    else:
        user = "x-token-auth"
    return f"https://{user}:{qt}@bitbucket.org/{workspace}/{repo_slug}.git"


def _redact(text: str, token: str) -> str:
    return (text or "").replace(token, "***") if token else (text or "")


def _branch_exists(url: str, branch: str) -> bool:
    try:
        r = subprocess.run(["git", "ls-remote", "--heads", url, branch], capture_output=True, text=True, timeout=90)
        return r.returncode == 0 and bool(r.stdout.strip())
    except Exception:
        return False


def scan_repo(workspace: str, repo_slug: str, token: str, auth_username: str = "") -> dict:
    tmp = tempfile.mkdtemp(prefix="sbom_")
    try:
        url = _clone_url(workspace, repo_slug, token, auth_username)
        # dev 브랜치가 있으면 우선 검사, 없으면 저장소 기본 브랜치
        cmd = ["git", "clone", "--depth", "1"]
        if _branch_exists(url, "dev"):
            cmd += ["--branch", "dev"]
        cmd += [url, tmp]
        clone = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if clone.returncode != 0:
            raise RuntimeError(f"clone 실패: {_redact(clone.stderr, token)[-300:]}")

        commit = subprocess.run(
            ["git", "-C", tmp, "rev-parse", "HEAD"], capture_output=True, text=True,
        ).stdout.strip()
        branch = subprocess.run(
            ["git", "-C", tmp, "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True,
        ).stdout.strip()

        trivy = subprocess.run(
            ["trivy", "fs", "--scanners", "vuln", "--format", "json", "--quiet", "--no-progress", tmp],
            capture_output=True, text=True, timeout=1800,
        )
        if trivy.returncode != 0:
            raise RuntimeError(f"trivy 실패: {(trivy.stderr or '')[-300:]}")

        data = json.loads(trivy.stdout or "{}")
        counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0}
        findings = []
        for res in data.get("Results", []) or []:
            ecosystem = res.get("Type", "")
            target = res.get("Target", "")
            for v in (res.get("Vulnerabilities") or []):
                sev = (v.get("Severity") or "UNKNOWN").upper()
                key = sev.lower()
                if key not in counts:
                    key = "unknown"
                counts[key] += 1
                findings.append({
                    "ecosystem": ecosystem,
                    "target": target,
                    "pkgName": v.get("PkgName", ""),
                    "installedVersion": v.get("InstalledVersion", ""),
                    "fixedVersion": v.get("FixedVersion", ""),
                    "vulnId": v.get("VulnerabilityID", ""),
                    "severity": sev,
                    "title": (v.get("Title") or v.get("Description") or "")[:300],
                    "url": v.get("PrimaryURL", ""),
                })
        return {"commit": commit, "branch": branch, "counts": counts, "total": sum(counts.values()), "findings": findings}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
