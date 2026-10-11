"""Score retrieval on the 17 sample questions. No LLM tokens are used.

Run:  cd apps/api && uv run python -X utf8 scripts/eval_retrieval.py                  (hybrid only)
      uv run python -X utf8 scripts/eval_retrieval.py --rerankers                       (also compare both rerankers)
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _conn  # noqa: F401,E402  (loads apps/api/.env)
from app import retrieval  # noqa: E402

GOLD = json.loads((Path(__file__).resolve().parents[1] / "data" / "golden_retrieval.json").read_text(encoding="utf-8"))["questions"]
RERANKERS = ["Xenova/ms-marco-MiniLM-L-6-v2", "jinaai/jina-reranker-v1-tiny-en"]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def judge(q, hits):
    ids = [h["chunk_id"] for h in hits]
    prefixes = q.get("chunk_prefix", [])
    rules_ok = any(h["rule_id"] in q["rules"] for h in hits) or any(i.startswith(p) for i in ids for p in prefixes)
    must_ok = all(any(i.startswith(m) for i in ids) for m in q.get("must_chunks", []))
    rank = next((n for n, h in enumerate(hits, 1) if h["rule_id"] in q["rules"]
                 or any(h["chunk_id"].startswith(p) for p in prefixes)), None)
    return rules_ok, must_ok, rank


def run(name, reranker):
    log(f"=== {name} ===")
    ok = must = tot = tot_must = 0
    mrr = 0.0
    for q in GOLD:
        hits, _ = retrieval.search(q["q"], reranker=reranker)
        if q.get("out_of_scope"):
            key = "rerank_score" if reranker else "score"
            log(f"Q{q['n']:>2} OUT-OF-SCOPE top {key}={hits[0][key]:.3f} top chunk={hits[0]['chunk_id']}")
            continue
        rules_ok, must_ok, rank = judge(q, hits)
        tot += 1
        ok += rules_ok
        mrr += 1 / rank if rank else 0
        if q.get("must_chunks"):
            tot_must += 1
            must += must_ok
        flag = "PASS" if rules_ok and must_ok else "FAIL"
        log(f"Q{q['n']:>2} {flag} rank={rank} top5={[h['chunk_id'] for h in hits]}")
    log(f"RESULT {name}: right rule in top5 = {ok}/{tot} | table chunk in top5 = {must}/{tot_must} | MRR = {mrr / tot:.2f}")


def main():
    t0 = time.time()
    log("loading models (first run may download rerankers)...")
    retrieval.search("warm up", reranker=None)
    log(f"dense+sparse ready in {time.time() - t0:.0f}s")
    run("hybrid only (no rerank)", None)
    if "--rerankers" in sys.argv:
        for name in RERANKERS:
            t1 = time.time()
            log(f"loading reranker {name} (downloads on first use)...")
            retrieval._reranker(name)
            log(f"reranker ready in {time.time() - t1:.0f}s")
            run(name, name)
    log(f"DONE in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
