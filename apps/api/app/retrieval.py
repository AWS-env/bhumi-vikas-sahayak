"""Hybrid retrieval over the Qdrant collection: dense + BM25 fused with RRF, then an optional cross-encoder rerank.

Models run locally through fastembed (small, free-tier friendly) and load lazily on first use.
"""
import os
import re
import time
from functools import lru_cache

from qdrant_client import QdrantClient, models

DENSE_MODEL = "BAAI/bge-small-en-v1.5"
SPARSE_MODEL = "Qdrant/bm25"
DEFAULT_RERANKER = "Xenova/ms-marco-MiniLM-L-6-v2"
RULE_MENTION = re.compile(r"(?<!sub-)(?<!sub )\b[Rr]ule[\s\-]*(\d{1,3})(?:-([A-Za-z])\b)?")


@lru_cache(maxsize=1)
def _client():
    return QdrantClient(url=os.environ["QDRANT_URL"], api_key=os.environ["QDRANT_API_KEY"], timeout=60)


@lru_cache(maxsize=1)
def _dense():
    from fastembed import TextEmbedding
    return TextEmbedding(DENSE_MODEL)


@lru_cache(maxsize=1)
def _sparse():
    from fastembed import SparseTextEmbedding
    return SparseTextEmbedding(SPARSE_MODEL)


@lru_cache(maxsize=4)
def _reranker(name):
    from fastembed.rerank.cross_encoder import TextCrossEncoder
    return TextCrossEncoder(name)


def _answerable():
    return models.Filter(must=[models.FieldCondition(key="answerable", match=models.MatchValue(value=True))])


def _hit(point, score=None):
    p = dict(point.payload)
    p["score"] = point.score if score is None else score
    return p


def _rerank_text(c):
    return f"Rule {c['rule_id']} {c['title']} {c.get('path', '')}\n{c['text']}"


def search(query, k_retrieve=20, k_final=5, reranker=DEFAULT_RERANKER):
    """Return (hits, timings). `reranker=None` skips reranking. Hits are chunk payload dicts with a `score`."""
    t = {}
    t0 = time.time()
    dv = next(iter(_dense().query_embed(query))).tolist()
    sv = next(iter(_sparse().query_embed(query)))
    t["embed_s"] = time.time() - t0

    t0 = time.time()
    res = _client().query_points(
        os.environ["QDRANT_COLLECTION"],
        prefetch=[
            models.Prefetch(query=dv, using="dense", limit=k_retrieve, filter=_answerable()),
            models.Prefetch(query=models.SparseVector(indices=sv.indices.tolist(), values=sv.values.tolist()),
                            using="bm25", limit=k_retrieve, filter=_answerable()),
        ],
        query=models.FusionQuery(fusion=models.Fusion.RRF), limit=k_retrieve, with_payload=True,
    )
    cands = [_hit(p) for p in res.points]
    t["qdrant_s"] = time.time() - t0

    # A named rule in the question ("rule 23") is fetched directly and put first.
    named = []
    for m in RULE_MENTION.finditer(query):
        rid = m.group(1) + (f"-{m.group(2).upper()}" if m.group(2) else "")
        pts, _ = _client().scroll(os.environ["QDRANT_COLLECTION"], limit=6, with_payload=True, scroll_filter=models.Filter(
            must=[models.FieldCondition(key="rule_id", match=models.MatchValue(value=rid)),
                  models.FieldCondition(key="answerable", match=models.MatchValue(value=True))]))
        named += [_hit(p, score=1.0) for p in pts]
    seen = {c["chunk_id"] for c in cands}
    if named:
        cands = [c for c in named if c["chunk_id"] not in seen] + cands

    if reranker and cands:
        t0 = time.time()
        scores = list(_reranker(reranker).rerank(query, [_rerank_text(c) for c in cands]))
        for c, s in zip(cands, scores):
            c["rerank_score"] = float(s)
        cands.sort(key=lambda c: -c["rerank_score"])
        t["rerank_s"] = time.time() - t0
    return cands[:k_final], t
