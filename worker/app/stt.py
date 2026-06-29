"""
STT (Whisper) 음성→텍스트. video_processor.py 의 핵심을 정리·이식.
- 영상은 ffmpeg 로 음성 추출 후 변환
- 모델 가중치는 WHISPER_DIR(볼륨) 캐시 사용
"""
import os
import shutil
import subprocess
import tempfile
from typing import Optional

WHISPER_DIR = os.environ.get("WHISPER_DIR", "/data/rag_store/whisper")
VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"}
SUPPORTED = VIDEO_EXTS | AUDIO_EXTS

_models: dict = {}


def _get_model(size: str):
    if size not in _models:
        import whisper
        os.makedirs(WHISPER_DIR, exist_ok=True)
        _models[size] = whisper.load_model(size, download_root=WHISPER_DIR)
    return _models[size]


def _extract_audio(src: str, dst: str) -> bool:
    try:
        subprocess.run(
            ["ffmpeg", "-i", src, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", "-y", dst],
            capture_output=True, check=True,
        )
        return os.path.exists(dst) and os.path.getsize(dst) > 0
    except Exception:
        return False


def transcribe(file_path: str, model_size: str = "base", language: Optional[str] = None) -> dict:
    ext = os.path.splitext(file_path)[1].lower()
    audio = file_path
    if ext in VIDEO_EXTS:
        wav = file_path + ".wav"
        if not _extract_audio(file_path, wav):
            raise RuntimeError("동영상에서 음성 추출 실패 (ffmpeg)")
        audio = wav
    model = _get_model(model_size)
    result = model.transcribe(audio, language=language or None)
    segs = [
        {"start": float(s["start"]), "end": float(s["end"]), "text": s["text"].strip()}
        for s in result.get("segments", [])
    ]
    return {"text": result.get("text", "").strip(), "segments": segs, "language": result.get("language", "")}


def _ts(sec: float, sep: str) -> str:
    h = int(sec // 3600); m = int((sec % 3600) // 60); s = int(sec % 60); ms = int((sec % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def to_srt(segs) -> str:
    return "\n\n".join(f"{i}\n{_ts(s['start'], ',')} --> {_ts(s['end'], ',')}\n{s['text']}" for i, s in enumerate(segs, 1)) + "\n"


def to_vtt(segs) -> str:
    return "\n".join(["WEBVTT"] + [f"\n{_ts(s['start'], '.')} --> {_ts(s['end'], '.')}\n{s['text']}" for s in segs]) + "\n"
