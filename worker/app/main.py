"""
Compass LLM — Python 워커.

대시보드(Next.js)가 호출하는 내부 서비스. 외부에 직접 노출하지 않는다.
역할:
  - GPU 지표 수집 (/internal/metrics, pynvml)
  - RAG (faiss + 임베딩)       → 기존 rag_collections.py 재사용
  - Whisper STT / 화자분리      → 기존 video_processor.py 재사용
  - 이미지 전처리 (OpenCV)      → 기존 image_preprocess.py 재사용
  - 영상 분석                   → 기존 video_processor.py 재사용

엔드포인트 경로는 대시보드의 /api/v1/[...path] 프록시와 1:1로 맞춘다.
(예: 대시보드 /api/v1/rag/collections → 워커 /rag/collections)
"""
import os
import shutil
import tempfile
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

app = FastAPI(title="Compass Worker")

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://ollama:11434")


# ──────────────────────────────────────────────────────────
# GPU 지표 (pynvml)
# ──────────────────────────────────────────────────────────
@app.get("/internal/metrics")
def metrics():
    """대시보드 지표 수집기가 2초 주기로 폴링."""
    gpus = []
    try:
        import pynvml

        pynvml.nvmlInit()
        for i in range(pynvml.nvmlDeviceGetCount()):
            h = pynvml.nvmlDeviceGetHandleByIndex(i)
            util = pynvml.nvmlDeviceGetUtilizationRates(h)
            mem = pynvml.nvmlDeviceGetMemoryInfo(h)
            temp = pynvml.nvmlDeviceGetTemperature(h, pynvml.NVML_TEMPERATURE_GPU)
            try:
                power = pynvml.nvmlDeviceGetPowerUsage(h) / 1000.0  # mW → W
            except pynvml.NVMLError:
                power = 0.0
            gpus.append({
                "index": i,
                "utilization": float(util.gpu),
                "memUsedMb": int(mem.used / 1024 / 1024),
                "memTotalMb": int(mem.total / 1024 / 1024),
                "tempC": float(temp),
                "powerW": float(power),
            })
        pynvml.nvmlShutdown()
    except Exception as e:  # GPU 없음/드라이버 문제 → 빈 배열
        print(f"[metrics] {e}", flush=True)
    return {"gpus": gpus}


@app.get("/internal/health")
def health():
    return {"status": "ok"}


# ──────────────────────────────────────────────────────────
# RAG (faiss + bge-m3) — 대시보드/공개 API 가 /rag/* 로 프록시
# 인증/Rate limit 은 대시보드가 처리하므로 워커에선 생략.
# ──────────────────────────────────────────────────────────
class CollectionCreate(BaseModel):
    name: str
    description: str = ""


class SearchRequest(BaseModel):
    collection: str
    query: str = ""
    k: int = 8
    mode: str = "search"  # "search" | "full"


@app.get("/rag/collections")
def rag_list_collections():
    from . import rag
    return {"collections": rag.list_collections()}


@app.post("/rag/collections")
def rag_create_collection(req: CollectionCreate):
    from . import rag
    if not req.name.strip():
        raise HTTPException(400, "컬렉션 이름을 입력하세요.")
    r = rag.create_collection(req.name.strip(), req.description)
    if "error" in r:
        raise HTTPException(409, r["error"])
    return r


@app.delete("/rag/collections/{name}")
def rag_delete_collection(name: str):
    from . import rag
    if rag.delete_collection(name):
        return {"message": f"컬렉션 '{name}' 삭제됨"}
    raise HTTPException(404, "컬렉션을 찾을 수 없습니다.")


@app.get("/rag/collections/{name}/files")
def rag_list_files(name: str):
    from . import rag
    return {"collection": name, "files": rag.list_files(name)}


@app.post("/rag/upload")
async def rag_upload(
    files: List[UploadFile] = File(default=[]),
    file: Optional[UploadFile] = File(default=None),
    collection: str = Form(...),
    description: str = Form(default=""),
):
    """PDF/텍스트 파일을 컬렉션에 업로드 → 임베딩. 컬렉션 없으면 자동 생성."""
    from . import rag
    all_files = list(files) if files else []
    if file:
        all_files.append(file)
    if not all_files:
        raise HTTPException(400, "파일을 첨부하세요 (필드명: files 또는 file).")

    if collection not in [c["name"] for c in rag.list_collections()]:
        rag.create_collection(collection, description)

    tmp = tempfile.mkdtemp()
    results = []
    try:
        for uf in all_files:
            path = os.path.join(tmp, uf.filename)
            with open(path, "wb") as f:
                f.write(await uf.read())
            results.append(rag.add_file(collection, path, uf.filename))
        return {"collection": collection, "uploaded": results}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@app.delete("/rag/collections/{name}/files/{filename}")
def rag_delete_file(name: str, filename: str):
    from . import rag
    if rag.delete_file(name, filename):
        return {"message": f"'{filename}' 삭제됨"}
    raise HTTPException(404, "파일을 찾을 수 없습니다.")


@app.post("/rag/search")
def rag_search(req: SearchRequest):
    """컬렉션에서 관련 청크 검색 (대시보드 chat 의 rag_collection 연동용)."""
    from . import rag
    return {"results": rag.search(req.collection, req.query, req.k, req.mode)}


# ──────────────────────────────────────────────────────────
# STT (Whisper) — 모델 다운로드 관리. (Ollama 아님, 워커가 받음)
# ──────────────────────────────────────────────────────────
WHISPER_DIR = os.environ.get("WHISPER_DIR", "/data/rag_store/whisper")


class WhisperDownload(BaseModel):
    size: str  # tiny | base | small | medium | large-v3 ...


@app.get("/stt/models")
def stt_list_models():
    import glob
    os.makedirs(WHISPER_DIR, exist_ok=True)
    names = sorted(os.path.basename(p)[:-3] for p in glob.glob(os.path.join(WHISPER_DIR, "*.pt")))
    return {"models": names}


@app.post("/stt/download")
def stt_download(req: WhisperDownload):
    """Whisper 모델 가중치 다운로드(+캐시). 다운로드만 목적이므로 CPU 로 로드."""
    import whisper
    os.makedirs(WHISPER_DIR, exist_ok=True)
    try:
        whisper.load_model(req.size, device="cpu", download_root=WHISPER_DIR)
    except Exception as e:
        raise HTTPException(400, f"Whisper 모델 '{req.size}' 다운로드 실패: {e}")
    return {"size": req.size, "status": "ok"}


@app.delete("/stt/models/{size}")
def stt_delete(size: str):
    p = os.path.join(WHISPER_DIR, f"{size}.pt")
    if os.path.exists(p):
        os.remove(p)
        return {"message": f"Whisper '{size}' 삭제됨"}
    raise HTTPException(404, "모델을 찾을 수 없습니다.")


@app.post("/transcribe")
async def transcribe_ep(
    file: UploadFile = File(...),
    whisper_model: str = Form("base"),
    language: str = Form(""),
    format: str = Form("json"),  # json | srt | vtt | text
):
    """음성/영상 → 자막. 모델은 모델관리에서 미리 받아두면 빠름(없으면 자동 다운로드)."""
    from . import stt
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in stt.SUPPORTED:
        raise HTTPException(400, f"지원하지 않는 형식: {ext}. 지원: {sorted(stt.SUPPORTED)}")
    if format not in ("json", "srt", "vtt", "text"):
        raise HTTPException(400, "format 은 json | srt | vtt | text")

    tmp = tempfile.mkdtemp()
    fp = os.path.join(tmp, file.filename)
    try:
        with open(fp, "wb") as f:
            f.write(await file.read())
        try:
            r = stt.transcribe(fp, whisper_model, language or None)
        except Exception as e:
            raise HTTPException(500, f"변환 실패: {e}")
        if format == "text":
            return PlainTextResponse(r["text"], media_type="text/plain; charset=utf-8")
        if format == "srt":
            return PlainTextResponse(stt.to_srt(r["segments"]), media_type="text/plain; charset=utf-8")
        if format == "vtt":
            return PlainTextResponse(stt.to_vtt(r["segments"]), media_type="text/vtt; charset=utf-8")
        return r
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
