# Bhumi Vikas Sahayak

**Track 1: Bhumi Vikas Sahayak** · Claude Impact Lab × Cerebras Café Compute, Bhopal · 11 October 2026

**Team:** TEAM NAME (fill in) · Members: MEMBER NAMES (fill in)

**The one user:** a building-permission clerk at the Bhopal Municipal Corporation counter. A citizen asks a question about the MP Bhumi Vikas Rules, 2012, and the clerk needs the rule number and the exact rule text within a minute. The tool points to the rule; the clerk decides. It is not legal advice.

## What works today

- **Login** (`/login`): email + password sign-in and sign-up (Supabase), English/Hindi toggle. `/chat` and all backend calls are protected; the browser never talks to the FastAPI backend directly (Next.js server acts as the gateway).
- **The rulebook is prepared for search** (`apps/api/data/`):
  - `rules_clean.jsonl`: 106 rules cleaned into 111 records (running page headers removed, amendment footnotes kept as dated metadata, nested rules 12-A, 17-a, 25(A), 42-A, 93(a) split out).
  - `tables.json`: 14 priority tables (rules 56, 21, 52, 42 Tables 4/5/5-A, 53) extracted from the English PDF and compared by hand against the rendered PDF pages. Not independently checked by a second person.
  - `chunks.jsonl`: 431 chunks following the rule structure, each with its rule number, title, part, PDF page range and its own amendment dates. Case-law "COMMENTS" blocks are kept but marked as never to be used as an answer source.
- **Voice input (optional, not tested by the author of this README):** a mic button on the chat screen sends the recorded audio through the gateway to Sarvam AI speech-to-text (`apps/api/app/stt.py`). Needs `SARVAM_API_KEY`. Audio leaves this system to that third-party service.
- **Search** (`apps/api/app/retrieval.py`): hybrid search (meaning + keyword, merged by rank fusion) in Qdrant, then a small local reranker. Everything runs on free tools.

## Measured retrieval quality (sample questions)

On the 15 in-scope sample questions (`reference/resources/sample_questions.md`), checking whether the right rule appears in the top 5 results:

| Method | Right rule in top 5 | Verified table in top 5 |
|---|---|---|
| Hybrid search only | 13 / 15 | 4 / 6 |
| Hybrid + MiniLM reranker (used) | **15 / 15** | **6 / 6** |

Honest limits of this number: the "right rule" for each question was decided by us reading the rules (the data pack gives no answers), the file is `apps/api/data/golden_retrieval.json`; the two Hindi questions were tested with a hand-written English version because Hindi translation is not built yet; this measures search, not written answers.

## What does not work yet

- **`/chat` is a screen only.** It does not send questions or show answers yet. The search works in code and in the evaluation script, but no endpoint connects it to the chat screen.
- No written answer from a language model, no Hindi question handling, and no "not found" decision yet. (Two out-of-scope questions score clearly low on the reranker, so a threshold is possible, but it is not built.)
- Fee and setback maths in code is not built; the extracted tables hold the numbers.
- The amendment of 28 August 2026 to Rule 2(5)(c), and anything after 6 March 2025, is **not** in the data.
- A knowledge graph (Neo4j) was prepared (`apps/api/scripts/index_graph.py`) but skipped; nothing depends on it.
- Fee slabs are printed in whole square metres; how to treat an area between two slabs (e.g. 75.5 sq m) is not stated in the rules and needs a clerk's decision.

## Run it (5 steps)

Needs Node 20+, Python 3.12 with [uv](https://docs.astral.sh/uv/), a Supabase project (email confirmation off), a Qdrant Cloud cluster and a Cerebras key.

1. `npm install`, then `cd apps/api && uv sync`
2. Copy `apps/web/.env.example` → `apps/web/.env.local` and `apps/api/.env.example` → `apps/api/.env`, fill them in (same `BFF_SHARED_SECRET` in both).
3. Index the rules once (downloads ~70 MB of small models): `cd apps/api && uv run python -X utf8 scripts/index_qdrant.py`
4. Terminal 1: `npm run dev:api`   Terminal 2: `npm run dev:web`, then open http://localhost:3000
5. Check search quality: `cd apps/api && uv run python -X utf8 scripts/eval_retrieval.py --rerankers`

No API keys or secrets are stored in this repository; use the git-ignored env files.

## Data used

- `reference/`: the official Track 1 data pack (rules as JSONL, full text by page, English and Hindi PDFs, sample questions), consolidated to 6 March 2025. Source: https://mptownplan.gov.in/NewsPDF/bvn06032025E.pdf
- Everything in `apps/api/data/` is derived from that pack by the scripts in `apps/api/scripts/`.
- No other data was added. No personal data. No live government system was used.

## Layout

```
apps/web   Next.js 16 (login, chat screen, gateway to the API)
apps/api   FastAPI + data preparation scripts + search (Python 3.12, uv)
reference  the official data pack
```

## License

MIT, see `LICENSE`.
