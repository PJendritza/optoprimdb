# SciScreen

SciScreen is a browser-based system for restart-safe AI-assisted PubMed literature screening.

## Stack
- FastAPI backend (`main.py`)
- Static frontend (`index.html`, `app.js`, `style.css`)
- PubMed retrieval via BioPython Entrez
- LLM screening via GWDG OpenAI-compatible API
- Local per-search JSONL persistence in `searches/<search_name>/`

## Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Open: `http://127.0.0.1:8000`

## Environment

```bash
export GWDG_API_KEY="..."
export GWDG_MODEL="apertus-70b-instruct-2509"  # optional
export GWDG_BASE_URL="https://chat-ai.academiccloud.de/v1"  # optional
```

## Workflow
1. Create a search (name + query + Entrez email).
2. Click **SEARCH PUBMED**.
3. Click **FETCH ABSTRACTS**.
4. Click **RUN SciScreen (all unprocessed)** or **RUN SciScreen (selected records)**.
5. Use **STOP ACTIVE JOB** to interrupt and resume later.

## Data layout

```
searches/<search_name>/
  search_meta.json
  pmids.csv
  screening.jsonl
```

The external screening prompt template is in `screenPrompt`.
