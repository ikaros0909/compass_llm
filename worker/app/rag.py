"""
RAG 컬렉션 모듈 (langserve_ollama/rag_collections.py 이식·정리).
- 컬렉션별 FAISS 인덱스 + bge-m3 임베딩
- PDF(opendataloader) / 텍스트 계열 파일 지원 (unstructured 미사용)
- 저장 위치: RAG_STORE_DIR (도커 볼륨 rag_store)
"""
import os
import re
import json
import shutil
import tempfile
from typing import List, Dict

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores.faiss import FAISS
from langchain_community.embeddings.huggingface import HuggingFaceEmbeddings

from .safepath import safe_join, safe_filename

BASE_DIR = os.environ.get("RAG_STORE_DIR", "/data/rag_store")
METADATA_FILE = os.path.join(BASE_DIR, "collections.json")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
EMBED_DEVICE = os.environ.get("EMBED_DEVICE", "cpu")

TEXT_EXTS = {".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".log", ".rst", ".html", ".htm"}

_embeddings = None


def _get_embeddings():
    global _embeddings
    if _embeddings is None:
        _embeddings = HuggingFaceEmbeddings(
            model_name=EMBED_MODEL,
            model_kwargs={"device": EMBED_DEVICE},
            encode_kwargs={"normalize_embeddings": True},
        )
    return _embeddings


def _ensure_dirs():
    os.makedirs(BASE_DIR, exist_ok=True)


def _load_meta() -> Dict:
    _ensure_dirs()
    if os.path.exists(METADATA_FILE):
        with open(METADATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_meta(data: Dict):
    _ensure_dirs()
    with open(METADATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _splitter():
    return RecursiveCharacterTextSplitter(
        chunk_size=800, chunk_overlap=150,
        separators=["\n\n", "\n", " ", ""], length_function=len,
    )


def _build_docs(file_path: str) -> List[Document]:
    ext = os.path.splitext(file_path)[1].lower()
    splitter = _splitter()

    if ext == ".pdf":
        try:
            import opendataloader_pdf
            with tempfile.TemporaryDirectory() as tmp:
                opendataloader_pdf.convert(
                    input_path=file_path, output_dir=tmp, format="markdown",
                    table_method="cluster", reading_order="xycut", quiet=True,
                )
                md = os.path.join(tmp, os.path.splitext(os.path.basename(file_path))[0] + ".md")
                with open(md, "r", encoding="utf-8") as f:
                    text = f.read()
            return splitter.create_documents([text])
        except Exception as e:
            print(f"[RAG] PDF 파싱 실패({e}) → 원문 텍스트 시도", flush=True)

    # 텍스트 계열 또는 폴백: utf-8 로 읽기
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
    except Exception:
        return []
    if not text.strip():
        return []
    return splitter.create_documents([text])


def create_collection(name: str, description: str = "") -> Dict:
    meta = _load_meta()
    if name in meta:
        return {"error": f"컬렉션 '{name}'이 이미 존재합니다."}
    os.makedirs(safe_join(BASE_DIR, name, "files"), exist_ok=True)
    meta[name] = {"description": description, "files": []}
    _save_meta(meta)
    return {"name": name, "description": description}


def delete_collection(name: str) -> bool:
    meta = _load_meta()
    if name not in meta:
        return False
    shutil.rmtree(safe_join(BASE_DIR, name), ignore_errors=True)
    del meta[name]
    _save_meta(meta)
    return True


def list_collections() -> List[Dict]:
    meta = _load_meta()
    return [{"name": k, "description": v["description"], "file_count": len(v["files"])} for k, v in meta.items()]


def list_files(name: str) -> List[str]:
    meta = _load_meta()
    return meta.get(name, {}).get("files", [])


def add_file(name: str, file_path: str, filename: str) -> Dict:
    meta = _load_meta()
    if name not in meta:
        return {"error": f"컬렉션 '{name}'이 존재하지 않습니다."}
    filename = safe_filename(filename)
    col_dir = safe_join(BASE_DIR, name)
    dest = safe_join(col_dir, "files", filename)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(file_path, dest)

    docs = [d for d in _build_docs(dest) if d.page_content.strip()]
    if not docs:
        if filename not in meta[name]["files"]:
            meta[name]["files"].append(filename)
        _save_meta(meta)
        return {"collection": name, "filename": filename, "chunks": 0, "warning": "텍스트 추출 실패"}

    for d in docs:
        d.metadata["source_file"] = filename
        d.metadata["collection"] = name

    emb = _get_embeddings()
    faiss_path = os.path.join(col_dir, "faiss_index")
    if os.path.exists(faiss_path):
        vs = FAISS.load_local(faiss_path, emb, allow_dangerous_deserialization=True)
        vs.add_documents(docs)
    else:
        vs = FAISS.from_documents(docs, embedding=emb)
    vs.save_local(faiss_path)

    if filename not in meta[name]["files"]:
        meta[name]["files"].append(filename)
    _save_meta(meta)
    return {"collection": name, "filename": filename, "chunks": len(docs)}


def delete_file(name: str, filename: str) -> bool:
    meta = _load_meta()
    if name not in meta or filename not in meta[name]["files"]:
        return False
    filename = safe_filename(filename)
    col_dir = safe_join(BASE_DIR, name)
    fp = safe_join(col_dir, "files", filename)
    if os.path.exists(fp):
        os.remove(fp)
    meta[name]["files"].remove(filename)
    _save_meta(meta)
    _rebuild_index(name)
    return True


def _rebuild_index(name: str):
    col_dir = safe_join(BASE_DIR, name)
    faiss_path = os.path.join(col_dir, "faiss_index")
    if os.path.exists(faiss_path):
        shutil.rmtree(faiss_path)
    files_dir = os.path.join(col_dir, "files")
    all_docs = []
    if os.path.isdir(files_dir):
        for fn in os.listdir(files_dir):
            for d in _build_docs(os.path.join(files_dir, fn)):
                d.metadata["source_file"] = fn
                d.metadata["collection"] = name
                all_docs.append(d)
    if all_docs:
        vs = FAISS.from_documents(all_docs, embedding=_get_embeddings())
        vs.save_local(faiss_path)


def search(name: str, query: str, k: int = 8, mode: str = "search") -> List[Dict]:
    """컬렉션에서 관련 청크 반환. mode=full 이면 전체 문서."""
    col_dir = safe_join(BASE_DIR, name)
    faiss_path = os.path.join(col_dir, "faiss_index")
    if not os.path.exists(faiss_path):
        return []
    vs = FAISS.load_local(faiss_path, _get_embeddings(), allow_dangerous_deserialization=True)
    if mode == "full":
        docs = list(vs.docstore._dict.values())
    else:
        docs = vs.as_retriever(search_type="mmr", search_kwargs={"k": k, "fetch_k": 30}).invoke(query)
    return [{"content": d.page_content, "source_file": d.metadata.get("source_file", "")} for d in docs]
