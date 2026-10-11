"""Embed data/chunks.jsonl locally (fastembed) and upsert into Qdrant: dense + BM25 in one collection.

Run:  cd apps/api && uv run python scripts/index_qdrant.py
Safe to re-run: point ids come from chunk_id, so it updates in place.
"""
import json
import time
import uuid
from pathlib import Path

from qdrant_client import models

from _conn import env, qdrant

D = Path(__file__).resolve().parents[1] / "data"
DENSE_MODEL, SPARSE_MODEL, DIM, BATCH = "BAAI/bge-small-en-v1.5", "Qdrant/bm25", 384, 32
NS = uuid.UUID("6f1c2a52-8f0e-4c1b-9a53-3b5c1f0d7a11")


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def main():
    t0 = time.time()
    chunks = [json.loads(l) for l in (D / "chunks.jsonl").open(encoding="utf-8")]
    log(f"loaded {len(chunks)} chunks")

    from fastembed import SparseTextEmbedding, TextEmbedding
    log(f"loading dense model {DENSE_MODEL} (first run downloads ~70 MB)...")
    dense = TextEmbedding(DENSE_MODEL)
    log(f"loading sparse model {SPARSE_MODEL}...")
    sparse = SparseTextEmbedding(SPARSE_MODEL)
    log(f"models ready after {time.time() - t0:.0f}s")

    q, name = qdrant(), env("QDRANT_COLLECTION")
    if not q.collection_exists(name):
        q.create_collection(
            name,
            vectors_config={"dense": models.VectorParams(size=DIM, distance=models.Distance.COSINE)},
            sparse_vectors_config={"bm25": models.SparseVectorParams(modifier=models.Modifier.IDF)},
        )
        log(f"created collection '{name}'")
    else:
        log(f"collection '{name}' exists, updating in place")
    for field, schema in (("type", "keyword"), ("rule_id", "keyword"), ("answerable", "bool")):
        q.create_payload_index(name, field_name=field, field_schema=schema)

    t1, done = time.time(), 0
    for i in range(0, len(chunks), BATCH):
        batch = chunks[i:i + BATCH]
        texts = [c["embed_text"] for c in batch]
        dv = list(dense.embed(texts))
        sv = list(sparse.embed(texts))
        points = [
            models.PointStruct(
                id=str(uuid.uuid5(NS, c["chunk_id"])),
                vector={"dense": d.tolist(), "bm25": models.SparseVector(indices=s.indices.tolist(), values=s.values.tolist())},
                payload={k: v for k, v in c.items() if k != "embed_text"},
            )
            for c, d, s in zip(batch, dv, sv)
        ]
        q.upsert(name, points=points, wait=True)
        done += len(batch)
        rate = done / (time.time() - t1)
        eta = (len(chunks) - done) / rate if rate else 0
        log(f"upserted {done}/{len(chunks)} ({done * 100 // len(chunks)}%) | {rate:.1f} chunks/s | ETA {eta:.0f}s")

    n = q.count(name, exact=True).count
    log(f"qdrant count = {n} (expected {len(chunks)}) -> {'OK' if n == len(chunks) else 'MISMATCH'}")

    # sanity search: dense only, tiny. Expect rule 56 front open space chunks near the top.
    qv = next(iter(dense.query_embed("front open space for a house on a 10 m wide street"))).tolist()
    hits = q.query_points(name, query=qv, using="dense", limit=3,
                          query_filter=models.Filter(must=[models.FieldCondition(key="answerable", match=models.MatchValue(value=True))])).points
    for h in hits:
        log(f"sanity hit: {h.payload['chunk_id']} score={h.score:.3f}")
    log(f"DONE in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
