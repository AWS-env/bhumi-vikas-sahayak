"""Real determinism test: does the same input always give the same output?

1. Retrieval: each question searched N times; ordered top-5 chunk ids and scores must be identical.
2. Model: the real qwen call (question understanding, temperature 0) repeated N times, with and without a seed.
3. Cache key: different spellings of the same input (case, spaces, punctuation, Unicode form) must normalise to one key.

Run:  cd apps/api && uv run python -X utf8 scripts/eval_determinism.py
      (about 2 minutes; ~120 small model calls, ~30k tokens on the generous qwen limits)
"""
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _conn  # noqa: F401,E402
from app import retrieval  # noqa: E402

N = 5
QUESTIONS = [
    "My house faces a 10 m wide street and will be 9 m tall. How much open space do I leave at the front?",
    "मेरा मकान 10 मीटर चौड़ी सड़क पर है और ऊँचाई 9 मीटर होगी। सामने कितनी खुली जगह छोड़नी होगी?",
    "Mera ghar 10 meter chaudi road pe hai aur height 9 meter hogi. Aage kitni jagah chhodni padegi?",
    "What is the fee for building permission for a residential house?",
    "Agar construction sanctioned naksha ke mutabik na ho to kya hoga?",
    "How do I pay my property tax online?",
]
SYSTEM = ("You rewrite a clerk's question about the Madhya Pradesh Bhumi Vikas Rules 2012 for search. "
          "The question may be English, Hindi (Devanagari) or Hinglish (Roman Hindi). "
          "Reply with JSON only: {\"language\": \"en|hi|hinglish\", \"queries\": [two short English search queries using rulebook words], "
          "\"out_of_scope\": true|false}.")


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def normalise(q):
    """Cache key: same question typed slightly differently must give one key."""
    q = unicodedata.normalize("NFKC", q).casefold()
    q = q.translate(str.maketrans("०१२३४५६७८९", "0123456789"))
    q = re.sub(r"[\s]+", " ", q).strip()
    q = re.sub(r"[?!.,;:।]+$", "", q).strip()
    return hashlib.sha256(q.encode("utf-8")).hexdigest()[:16]


def llm(question, seed=None):
    body = {"model": os.environ["CEREBRAS_MODEL"], "temperature": 0, "max_completion_tokens": 600,
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}]}
    if seed is not None:
        body["seed"] = seed
    req = urllib.request.Request("https://api.cerebras.ai/v1/chat/completions", data=json.dumps(body).encode(), headers={
        "Authorization": "Bearer " + os.environ["CEREBRAS_API_KEY"], "Content-Type": "application/json", "User-Agent": "bhumi-sahayak/0.1"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=40))
        return (d["choices"][0]["message"].get("content") or "").strip()
    except urllib.error.HTTPError as e:
        return f"[HTTP {e.code}: {e.read()[:120].decode('utf-8', 'replace')}]"


def main():
    t0 = time.time()
    log("=== 1. retrieval repeated %d times per question ===" % N)
    retrieval.search("warm up")
    max_diff, bad = 0.0, 0
    for q in QUESTIONS[:5]:
        runs = [retrieval.search(q)[0] for _ in range(N)]
        ids = [[h["chunk_id"] for h in r] for r in runs]
        same_ids = all(i == ids[0] for i in ids)
        diff = max(abs(a["rerank_score"] - b["rerank_score"]) for r in runs[1:] for a, b in zip(runs[0], r))
        max_diff = max(max_diff, diff)
        bad += not same_ids
        log(f"{'SAME ' if same_ids else 'DIFF '} order identical={same_ids} max score diff={diff:.2e} | {q[:50]}")
    log(f"RESULT retrieval: {5 - bad}/5 questions gave identical top-5 order every time; largest score drift {max_diff:.2e}")

    log("=== 2. model call repeated %d times (temperature 0) ===" % N)
    for label, seed in (("no seed", None), ("seed=7", 7)):
        same_total = 0
        for q in QUESTIONS:
            outs = [llm(q, seed) for _ in range(N)]
            same = sum(o == outs[0] for o in outs)
            same_total += same == N
            log(f"{label:8} {same}/{N} identical | {q[:45]!r}" + ("" if same == N else f" | e.g. {set(outs) and list(set(outs))[:2]}"))
        log(f"RESULT model {label}: {same_total}/{len(QUESTIONS)} questions identical on all {N} runs")

    log("=== 3. cache-key normalisation ===")
    groups = [
        ["What is the fee for building permission?", "what is the fee for building permission", "  What is the fee   for building permission ?? ", "WHAT IS THE FEE FOR BUILDING PERMISSION."],
        ["प्लॉट २०० वर्ग मीटर का है।", "प्लॉट 200 वर्ग मीटर का है", "प्लॉट  200 वर्ग मीटर का है ।"],
    ]
    for g in groups:
        keys = {normalise(x) for x in g}
        log(f"{'OK  ' if len(keys) == 1 else 'FAIL'} {len(g)} spellings -> {len(keys)} key(s)")
    log("different questions must NOT collide: " + ("OK" if normalise("fee for house") != normalise("fee for shop") else "FAIL"))
    log(f"DONE in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
