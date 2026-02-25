import csv
import json
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from Bio import Entrez
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
SEARCHES_DIR = BASE_DIR / "searches"
SCREEN_PROMPT_FILE = BASE_DIR / "screenPrompt"

SEARCHES_DIR.mkdir(exist_ok=True)

app = FastAPI(title="SciScreen")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@dataclass
class JobState:
    id: str
    type: str
    search_name: str
    status: str = "running"
    message: str = ""
    total: int = 0
    done: int = 0
    stop_requested: bool = False
    error: str | None = None
    started_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


JOBS: dict[str, JobState] = {}
JOBS_LOCK = threading.Lock()


def safe_name(name: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9_-]+", "_", name.strip())
    if not clean:
        raise HTTPException(status_code=400, detail="Invalid search name")
    return clean


def search_dir(search_name: str) -> Path:
    return SEARCHES_DIR / safe_name(search_name)


def meta_path(search_name: str) -> Path:
    return search_dir(search_name) / "search_meta.json"


def pmids_path(search_name: str) -> Path:
    return search_dir(search_name) / "pmids.csv"


def screening_path(search_name: str) -> Path:
    return search_dir(search_name) / "screening.jsonl"


def load_prompt() -> str:
    if not SCREEN_PROMPT_FILE.exists():
        raise HTTPException(status_code=500, detail="screenPrompt file is missing")
    return SCREEN_PROMPT_FILE.read_text(encoding="utf-8")


def load_screening_records(search_name: str) -> list[dict[str, Any]]:
    path = screening_path(search_name)
    if not path.exists():
        return []
    out = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def write_screening_records(search_name: str, records: list[dict[str, Any]]) -> None:
    path = screening_path(search_name)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".jsonl.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    tmp.replace(path)


def init_record(pmid: str) -> dict[str, Any]:
    return {
        "pmid": pmid,
        "title": None,
        "journal": None,
        "year": None,
        "authors": [],
        "abstract": None,
        "processed": False,
        "include": None,
        "confidence": None,
        "species": [],
        "in_vivo": None,
        "is_review": None,
        "direct_quotes": "",
        "llm_meta": None,
        "abstract_fetched": False,
    }


def build_or_resume_screening(pmids: list[str], search_name: str, rebuild: bool = False) -> None:
    existing = {r["pmid"]: r for r in load_screening_records(search_name)}
    records = []
    for pmid in pmids:
        if pmid in existing and not rebuild:
            records.append(existing[pmid])
        else:
            records.append(init_record(pmid))
    write_screening_records(search_name, records)


def extract_json(text: str) -> dict[str, Any]:
    matches = re.findall(r"\{[\s\S]*\}", text)
    if not matches:
        raise ValueError("No JSON object found in model output")
    return json.loads(matches[-1])


def status_counts(records: list[dict[str, Any]]) -> dict[str, int]:
    total = len(records)
    abstract_done = sum(1 for r in records if r.get("abstract_fetched"))
    processed = sum(1 for r in records if r.get("processed"))
    return {"total": total, "abstract_fetched": abstract_done, "processed": processed}


def create_job(job_type: str, search_name: str, total: int = 0) -> JobState:
    job = JobState(id=str(uuid.uuid4()), type=job_type, search_name=search_name, total=total)
    with JOBS_LOCK:
        JOBS[job.id] = job
    return job


def update_job(job: JobState, **kwargs: Any) -> None:
    with JOBS_LOCK:
        for k, v in kwargs.items():
            setattr(job, k, v)
        job.updated_at = time.time()


def run_in_thread(fn, *args):
    t = threading.Thread(target=fn, args=args, daemon=True)
    t.start()


class CreateSearchPayload(BaseModel):
    name: str
    query: str
    email: str


class RunPayload(BaseModel):
    mode: str = Field(default="all", pattern="^(all|selected)$")
    selected_rows: list[int] = Field(default_factory=list)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/searches")
def list_searches():
    out = []
    for d in sorted(SEARCHES_DIR.glob("*")):
        if d.is_dir() and (d / "search_meta.json").exists():
            out.append(json.loads((d / "search_meta.json").read_text(encoding="utf-8")))
    return out


@app.post("/api/searches")
def create_search(payload: CreateSearchPayload):
    name = safe_name(payload.name)
    d = search_dir(name)
    d.mkdir(parents=True, exist_ok=True)
    meta = {
        "name": name,
        "query": payload.query,
        "email": payload.email,
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    meta_path(name).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def run_pubmed_search(job: JobState):
    try:
        m = json.loads(meta_path(job.search_name).read_text(encoding="utf-8"))
        Entrez.email = m["email"]
        query = m["query"]
        pmids: list[str] = []
        retstart = 0
        step = 10000
        while True:
            if job.stop_requested:
                update_job(job, status="stopped", message="Search stopped by user")
                return
            handle = Entrez.esearch(db="pubmed", term=query, retmax=step, retstart=retstart)
            rec = Entrez.read(handle)
            ids = rec.get("IdList", [])
            if not ids:
                break
            pmids.extend(ids)
            retstart += step
            update_job(job, message=f"Retrieved {len(pmids)} PMIDs")
            if retstart >= int(rec.get("Count", 0)):
                break

        with pmids_path(job.search_name).open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["pmid"])
            for pid in pmids:
                writer.writerow([pid])

        build_or_resume_screening(pmids, job.search_name, rebuild=False)
        update_job(job, status="completed", done=len(pmids), total=len(pmids), message="PubMed search completed")
    except Exception as e:
        update_job(job, status="failed", error=str(e), message="PubMed search failed")


@app.post("/api/searches/{name}/search_pubmed")
def search_pubmed(name: str, background_tasks: BackgroundTasks):
    name = safe_name(name)
    if not meta_path(name).exists():
        raise HTTPException(status_code=404, detail="Search not found")
    job = create_job("pubmed_search", name)
    background_tasks.add_task(run_pubmed_search, job)
    return {"job_id": job.id}


def fetch_metadata_batch(pmids: list[str], email: str) -> list[dict[str, Any]]:
    Entrez.email = email
    handle = Entrez.efetch(db="pubmed", id=",".join(pmids), rettype="abstract", retmode="xml")
    records = Entrez.read(handle)

    results = []
    for article in records.get("PubmedArticle", []):
        citation = article["MedlineCitation"]
        article_data = citation["Article"]

        pmid = str(citation["PMID"])
        title = str(article_data.get("ArticleTitle"))
        journal = article_data.get("Journal", {}).get("Title")

        year = None
        pub_date = article_data.get("Journal", {}).get("JournalIssue", {}).get("PubDate", {})
        if "Year" in pub_date:
            year = pub_date["Year"]
        elif "MedlineDate" in pub_date:
            year = str(pub_date["MedlineDate"])[:4]

        authors = []
        for author in article_data.get("AuthorList", []):
            if "LastName" in author:
                authors.append(f"{author.get('ForeName', '')} {author.get('LastName', '')}".strip())

        abstract = None
        abstract_block = article_data.get("Abstract")
        if abstract_block:
            texts = abstract_block.get("AbstractText", [])
            abstract = " ".join(str(t) for t in texts)

        doi = None
        for aid in article.get("PubmedData", {}).get("ArticleIdList", []):
            if getattr(aid, "attributes", {}).get("IdType") == "doi":
                doi = str(aid)
                break

        results.append(
            {
                "pmid": pmid,
                "title": title,
                "journal": journal,
                "year": year,
                "authors": authors,
                "abstract": abstract,
                "doi": doi,
            }
        )

    return results


def run_fetch_abstracts(job: JobState, batch_size: int = 50):
    try:
        p_path = pmids_path(job.search_name)
        if not p_path.exists():
            raise RuntimeError("Run SEARCH PUBMED first")

        meta = json.loads(meta_path(job.search_name).read_text(encoding="utf-8"))
        pmids = []
        with p_path.open("r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                pmids.append(row["pmid"])

        records = load_screening_records(job.search_name)
        by_pmid = {r["pmid"]: r for r in records}

        pending = [pid for pid in pmids if not by_pmid.get(pid, {}).get("abstract_fetched")]
        update_job(job, total=len(pending), message="Fetching abstracts")

        for i in range(0, len(pending), batch_size):
            if job.stop_requested:
                update_job(job, status="stopped", message="Fetch stopped by user")
                return
            batch = pending[i : i + batch_size]
            fetched = fetch_metadata_batch(batch, meta["email"])
            fetched_by = {r["pmid"]: r for r in fetched}
            changed = False
            for rec in records:
                f = fetched_by.get(rec["pmid"])
                if not f:
                    continue
                rec.update(f)
                rec["abstract_fetched"] = True
                changed = True
            if changed:
                write_screening_records(job.search_name, records)
            update_job(job, done=min(i + batch_size, len(pending)), message=f"Fetched {min(i + batch_size, len(pending))}/{len(pending)}")

        update_job(job, status="completed", done=len(pending), message="Abstract fetch completed")
    except Exception as e:
        update_job(job, status="failed", error=str(e), message="Abstract fetch failed")


@app.post("/api/searches/{name}/fetch_abstracts")
def fetch_abstracts(name: str, background_tasks: BackgroundTasks):
    name = safe_name(name)
    if not meta_path(name).exists():
        raise HTTPException(status_code=404, detail="Search not found")
    job = create_job("fetch_abstracts", name)
    background_tasks.add_task(run_fetch_abstracts, job)
    return {"job_id": job.id}


def build_prompt(base_prompt: str, title: str | None, abstract: str | None) -> str:
    return (
        base_prompt.replace("{{title}}", title or "")
        .replace("{{abstract}}", abstract or "")
    )


def llm_client() -> OpenAI:
    key = os.getenv("GWDG_API_KEY")
    if not key:
        raise RuntimeError("Set GWDG_API_KEY")
    return OpenAI(api_key=key, base_url=os.getenv("GWDG_BASE_URL", "https://chat-ai.academiccloud.de/v1"))


def run_screening(job: JobState, mode: str, selected_rows: list[int]):
    try:
        base_prompt = load_prompt()
        model = os.getenv("GWDG_MODEL", "apertus-70b-instruct-2509")
        client = llm_client()

        records = load_screening_records(job.search_name)
        targets: list[int] = []
        if mode == "all":
            targets = [i for i, r in enumerate(records) if r.get("abstract_fetched") and not r.get("processed")]
        elif mode == "selected":
            for n in selected_rows:
                idx = n - 1
                if idx < 0 or idx >= len(records):
                    continue
                targets.append(idx)
        targets = sorted(set(targets))
        update_job(job, total=len(targets), message="Running SciScreen")

        for done, idx in enumerate(targets, start=1):
            if job.stop_requested:
                update_job(job, status="stopped", done=done - 1, message="Screening stopped by user")
                return
            rec = records[idx]
            prompt = build_prompt(base_prompt, rec.get("title"), rec.get("abstract"))
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You are a precise scientific screening assistant."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0,
            )
            model_text = response.choices[0].message.content or ""
            parsed = extract_json(model_text)

            rec["include"] = parsed.get("include")
            rec["confidence"] = parsed.get("confidence")
            rec["species"] = parsed.get("species") or []
            rec["in_vivo"] = parsed.get("in_vivo")
            rec["is_review"] = parsed.get("is_review")
            rec["direct_quotes"] = parsed.get("direct_quotes") or ""
            rec["processed"] = True
            rec["llm_meta"] = {
                "model": model,
                "ts": time.time(),
                "raw": model_text,
            }
            write_screening_records(job.search_name, records)
            update_job(job, done=done, message=f"Processed {done}/{len(targets)}")

        update_job(job, status="completed", message="SciScreen run completed")
    except Exception as e:
        update_job(job, status="failed", error=str(e), message="SciScreen run failed")


@app.post("/api/searches/{name}/run_sciscreen")
def run_sciscreen(name: str, payload: RunPayload, background_tasks: BackgroundTasks):
    name = safe_name(name)
    if not screening_path(name).exists():
        raise HTTPException(status_code=400, detail="Run FETCH ABSTRACTS first")
    job = create_job("run_sciscreen", name)
    background_tasks.add_task(run_screening, job, payload.mode, payload.selected_rows)
    return {"job_id": job.id}


@app.post("/api/searches/{name}/rerun/{row_number}")
def rerun_single(name: str, row_number: int, background_tasks: BackgroundTasks):
    return run_sciscreen(name, RunPayload(mode="selected", selected_rows=[row_number]), background_tasks)


@app.get("/api/searches/{name}/records")
def get_records(name: str):
    name = safe_name(name)
    records = load_screening_records(name)
    return {"records": records, "counts": status_counts(records)}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.__dict__


@app.post("/api/jobs/{job_id}/stop")
def stop_job(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    update_job(job, stop_requested=True, message="Stop requested")
    return {"ok": True}


@app.get("/")
def root():
    return FileResponse(BASE_DIR / "index.html")


app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="static")
