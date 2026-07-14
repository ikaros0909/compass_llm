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
    # authUsername 있으면 App Password/API 토큰 방식, 없으면 Access Token(x-token-auth) 방식
    if auth_username:
        return f"https://{quote(auth_username, safe='')}:{quote(token, safe='')}@bitbucket.org/{workspace}/{repo_slug}.git"
    return f"https://x-token-auth:{quote(token, safe='')}@bitbucket.org/{workspace}/{repo_slug}.git"


def _redact(text: str, token: str) -> str:
    return (text or "").replace(token, "***") if token else (text or "")


def scan_repo(workspace: str, repo_slug: str, token: str, auth_username: str = "") -> dict:
    tmp = tempfile.mkdtemp(prefix="sbom_")
    try:
        url = _clone_url(workspace, repo_slug, token, auth_username)
        clone = subprocess.run(
            ["git", "clone", "--depth", "1", url, tmp],
            capture_output=True, text=True, timeout=300,
        )
        if clone.returncode != 0:
            raise RuntimeError(f"clone 실패: {_redact(clone.stderr, token)[-300:]}")

        commit = subprocess.run(
            ["git", "-C", tmp, "rev-parse", "HEAD"], capture_output=True, text=True,
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
        return {"commit": commit, "counts": counts, "total": sum(counts.values()), "findings": findings}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
