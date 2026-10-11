"""Stress test: harder English + Hindi questions. Hindi runs raw AND translated to English with qwen (about 15 tiny calls).

Run:  cd apps/api && uv run python -X utf8 scripts/eval_stress.py
Writes data/stress_results.json for inspection.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _conn  # noqa: F401,E402
from app import retrieval  # noqa: E402

D = Path(__file__).resolve().parents[1] / "data"
GOLD = json.loads((D / "golden_stress.json").read_text(encoding="utf-8"))


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def translate(text):
    body = json.dumps({"model": os.environ["CEREBRAS_MODEL"], "max_completion_tokens": 400, "temperature": 0,
                       "messages": [{"role": "system", "content": "Translate the user's Hindi question about building rules into one short English question. Output only the English question."},
                                    {"role": "user", "content": text}]}).encode()
    req = urllib.request.Request("https://api.cerebras.ai/v1/chat/completions", data=body, headers={
        "Authorization": "Bearer " + os.environ["CEREBRAS_API_KEY"], "Content-Type": "application/json", "User-Agent": "bhumi-sahayak/0.1"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=30))
        return (d["choices"][0]["message"].get("content") or "").strip(), d.get("usage", {}).get("total_tokens", 0)
    except urllib.error.HTTPError as e:
        return f"[HTTP {e.code}]", 0


def judge(q, hits):
    ids = [h["chunk_id"] for h in hits]
    ok = any(h["rule_id"] in q["rules"] for h in hits)
    must = all(any(i.startswith(m) for i in ids) for m in q.get("must_chunks", []))
    rank = next((n for n, h in enumerate(hits, 1) if h["rule_id"] in q["rules"]), None)
    return ok, must, rank


def score_set(name, items, query_of):
    ok = must_ok = tot = tot_must = 0
    rows = []
    for q in items:
        hits, _ = retrieval.search(query_of(q))
        good, must, rank = judge(q, hits)
        tot += 1
        ok += good
        if q.get("must_chunks"):
            tot_must += 1
            must_ok += must
        flag = "PASS" if good and must else "FAIL"
        rows.append({"id": q["id"], "flag": flag, "rank": rank, "query": query_of(q), "top5": [h["chunk_id"] for h in hits],
                     "top_rerank": round(hits[0]["rerank_score"], 2)})
        log(f"{q['id']:<4}{flag} rank={rank} top1={hits[0]['chunk_id']} ({hits[0]['rerank_score']:.1f})")
    log(f"RESULT {name}: right rule in top5 = {ok}/{tot} | table in top5 = {must_ok}/{tot_must}")
    return rows, ok, tot


def scores_oos(items, query_of):
    out = []
    for q in items:
        hits, _ = retrieval.search(query_of(q))
        out.append({"id": q["id"], "query": query_of(q), "top_rerank": round(hits[0]["rerank_score"], 2), "top1": hits[0]["chunk_id"]})
        log(f"{q['id']:<4}OUT-OF-SCOPE top rerank={hits[0]['rerank_score']:.1f} top1={hits[0]['chunk_id']}")
    return out


def main():
    t0 = time.time()
    retrieval.search("warm up")
    results = {}
    log("=== English in-scope ===")
    results["english"], *_ = score_set("English", GOLD["english"], lambda q: q["q"])
    log("=== English out-of-scope (should be 'not found') ===")
    results["english_oos"] = scores_oos(GOLD["english_out_of_scope"], lambda q: q["q"])

    log("=== Hindi raw (no translation) ===")
    results["hindi_raw"], *_ = score_set("Hindi raw", GOLD["hindi"], lambda q: q["q"])
    log("=== translating Hindi with qwen ===")
    tr, tokens = {}, 0
    for q in GOLD["hindi"] + GOLD["hindi_out_of_scope"]:
        tr[q["id"]], n = translate(q["q"])
        tokens += n
        log(f"{q['id']:<4}-> {tr[q['id']]}")
    log(f"translation tokens used: {tokens}")
    results["translations"] = tr
    log("=== Hindi translated to English ===")
    results["hindi_translated"], *_ = score_set("Hindi translated", GOLD["hindi"], lambda q: tr[q["id"]])
    results["hindi_oos_translated"] = scores_oos(GOLD["hindi_out_of_scope"], lambda q: tr[q["id"]])

    ins = [r["top_rerank"] for k in ("english", "hindi_translated") for r in results[k]]
    outs = [r["top_rerank"] for k in ("english_oos", "hindi_oos_translated") for r in results[k]]
    log(f"in-scope top rerank score: min {min(ins):.1f} / median {sorted(ins)[len(ins) // 2]:.1f}; out-of-scope max {max(outs):.1f} -> a threshold {'is' if max(outs) < min(ins) else 'is NOT'} cleanly separable")
    (D / "stress_results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"DONE in {time.time() - t0:.0f}s, details in data/stress_results.json")


if __name__ == "__main__":
    main()
