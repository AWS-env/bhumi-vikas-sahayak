"""Connectivity check for Qdrant and Neo4j. Prints status and counts only, never secrets."""
import sys

from _conn import env, neo4j_driver, qdrant

ok = True
try:
    q = qdrant()
    cols = [c.name for c in q.get_collections().collections]
    name = env("QDRANT_COLLECTION")
    print(f"qdrant: OK | collections={cols} | '{name}' exists={name in cols}" + (f" | points={q.count(name).count}" if name in cols else ""))
except Exception as e:
    ok = False
    print("qdrant: FAILED:", type(e).__name__, str(e)[:160])
try:
    d = neo4j_driver()
    d.verify_connectivity()
    with d.session(database=env("NEO4J_DATABASE")) as s:
        print("neo4j: OK | nodes =", s.run("MATCH (n) RETURN count(n) AS c").single()["c"])
    d.close()
except Exception as e:
    ok = False
    print("neo4j: FAILED:", type(e).__name__, str(e)[:160])
sys.exit(0 if ok else 1)
