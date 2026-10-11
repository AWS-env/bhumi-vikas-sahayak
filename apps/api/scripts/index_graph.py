"""Build the small Neo4j graph: rules, parts, tables, amendments, and cross-references found by code.

Run:  cd apps/api && uv run python scripts/index_graph.py            (writes the graph)
      uv run python scripts/index_graph.py --dry-run                   (only finds references, no Neo4j)
      uv run python scripts/index_graph.py --reset                     (wipes the graph first)
References are found with text patterns ("rule 42", "Table 4 of rule 42"); no AI is used.
"""
import hashlib
import json
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

D = Path(__file__).resolve().parents[1] / "data"
RULE_REF = re.compile(r"(?<!sub-)(?<!sub )\b[Rr]ules?[\s\-]*(\d{1,3})(?:[-\s]?([A-Za-z])\b|\(([A-Za-z])\))?")
LIST_TAIL = re.compile(r"\s*(?:,|and|&|or)\s*(\d{1,3})(?:[-\s]?([A-Za-z])\b|\(([A-Za-z])\))?")
TABLE_REF = re.compile(r"\b[Tt]ables?[\s\-]*(?:No\.?\s*)?(\d+)(?:\s*(?:and|&|,)\s*(?:No\.?\s*)?(\d+))?\s*(?:of|in)\s+[Rr]ule\s+(\d{1,3})")


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def find_refs(text):
    """Yield (digits, letter, letter_in_parentheses) for every rule number mentioned."""
    for m in RULE_REF.finditer(text):
        yield m.group(1), m.group(2), m.group(3)
        pos = m.end()
        while True:  # "rules 12, 13 and 14"
            t = LIST_TAIL.match(text, pos)
            if not t:
                break
            yield t.group(1), t.group(2), t.group(3)
            pos = t.end()


def main():
    dry, reset = "--dry-run" in sys.argv, "--reset" in sys.argv
    rules = [json.loads(l) for l in (D / "rules_clean.jsonl").open(encoding="utf-8")]
    chunks = [json.loads(l) for l in (D / "chunks.jsonl").open(encoding="utf-8")]
    tables = json.loads((D / "tables.json").read_text(encoding="utf-8"))

    ids = {r["id"] for r in rules}
    plain = {re.sub(r"[^0-9a-z]", "", i.lower()): i for i in ids}          # 12-A -> 12a
    paren = {re.sub(r"[^0-9a-z]", "", i.lower()): i for i in ids if "(" in i}  # 25(A), 93(a)

    def resolve(num, dash_letter, paren_letter):
        if paren_letter:  # "rule 12(a)" is a clause of rule 12, except real ids like 25(A)
            return paren.get((num + paren_letter).lower(), num if num in ids else None)
        if dash_letter:
            return plain.get((num + dash_letter).lower())
        return num if num in ids else None

    refs, unresolved = defaultdict(set), defaultdict(set)
    table_refs = defaultdict(set)
    table_ids = {t["id"] for t in tables}
    for c in chunks:
        if c["type"] not in ("rule", "definition"):
            continue
        src = c["rule_id"]
        for num, dl, pl in find_refs(c["text"]):
            dst = resolve(num, dl, pl)
            if dst is None:
                unresolved[f"rule {num}{('-' + dl) if dl else ''}"].add(src)
            elif dst != src and dst != c["parent"]:
                refs[(src, dst)].add(c["chunk_id"])
        for m in TABLE_REF.finditer(c["text"]):
            for n in (m.group(1), m.group(2)):
                tid = f"r{m.group(3)}_table{n}" if n else None
                if tid in table_ids:
                    table_refs[(src, tid)].add(c["chunk_id"])

    log(f"references: {len(refs)} rule->rule links, {len(table_refs)} rule->table links")
    log(f"unresolved mentions (no such record, kept out of the graph): {dict((k, sorted(v)) for k, v in unresolved.items())}")
    for src in ("56", "12-A", "26"):
        log(f"  rule {src} -> {sorted(d for (s, d) in refs if s == src)} tables {sorted(t for (s, t) in table_refs if s == src)}")
    (D / "refs.json").write_text(json.dumps(
        {"rule_refs": {f"{s}->{d}": sorted(v) for (s, d), v in refs.items()},
         "table_refs": {f"{s}->{t}": sorted(v) for (s, t), v in table_refs.items()},
         "unresolved": {k: sorted(v) for k, v in unresolved.items()}}, indent=1), encoding="utf-8")
    if dry:
        log("dry run: not touching Neo4j")
        return

    amend = {}  # amendment id -> props ; edges rule -> amendment with via chunks
    amend_edges = defaultdict(set)
    for c in chunks:
        for a in c["amendments"]:
            aid = hashlib.sha1(f"{a['date']}|{a['note']}".encode()).hexdigest()[:12]
            amend[aid] = {"id": aid, "kind": a["kind"], "date": a["date"], "note": a["note"]}
            amend_edges[(c["rule_id"], aid)].add(c["chunk_id"])

    from _conn import env, neo4j_driver
    driver = neo4j_driver()
    driver.verify_connectivity()
    db = env("NEO4J_DATABASE")
    with driver.session(database=db) as s:
        if reset:
            s.run("MATCH (n) DETACH DELETE n")
            log("graph wiped")
        s.run("CREATE CONSTRAINT rule_id IF NOT EXISTS FOR (r:Rule) REQUIRE r.id IS UNIQUE")
        s.run("CREATE CONSTRAINT table_id IF NOT EXISTS FOR (t:Table) REQUIRE t.id IS UNIQUE")
        s.run("CREATE CONSTRAINT amend_id IF NOT EXISTS FOR (a:Amendment) REQUIRE a.id IS UNIQUE")
        s.run("CREATE CONSTRAINT part_name IF NOT EXISTS FOR (p:Part) REQUIRE p.name IS UNIQUE")
        s.run("UNWIND $rows AS r MERGE (n:Rule {id: r.id}) SET n.title=r.title, n.page_start=r.page_start, n.page_end=r.page_end, "
              "n.parent=r.parent MERGE (p:Part {name: r.part}) MERGE (n)-[:IN_PART]->(p)",
              rows=[{k: r[k] for k in ("id", "title", "page_start", "page_end", "parent", "part")} for r in rules])
        s.run("MATCH (c:Rule) WHERE c.parent IS NOT NULL MATCH (p:Rule {id: c.parent}) MERGE (p)-[:HAS_NESTED]->(c)")
        s.run("UNWIND $rows AS t MERGE (n:Table {id: t.id}) SET n.title=t.title, n.pages=t.pages "
              "WITH n, t MATCH (r:Rule {id: t.rule}) MERGE (r)-[:HAS_TABLE]->(n)",
              rows=[{"id": t["id"], "title": t["title"], "pages": t["pages"], "rule": t["rule"]} for t in tables])
        s.run("UNWIND $rows AS e MATCH (a:Rule {id: e.src}), (b:Rule {id: e.dst}) MERGE (a)-[x:REFERS_TO]->(b) SET x.via_chunks=e.via",
              rows=[{"src": a, "dst": b, "via": sorted(v)} for (a, b), v in refs.items()])
        s.run("UNWIND $rows AS e MATCH (a:Rule {id: e.src}), (b:Table {id: e.dst}) MERGE (a)-[x:REFERS_TO_TABLE]->(b) SET x.via_chunks=e.via",
              rows=[{"src": a, "dst": b, "via": sorted(v)} for (a, b), v in table_refs.items()])
        s.run("UNWIND $rows AS a MERGE (n:Amendment {id: a.id}) SET n.kind=a.kind, n.date=a.date, n.note=a.note",
              rows=list(amend.values()))
        s.run("UNWIND $rows AS e MATCH (r:Rule {id: e.rule}), (a:Amendment {id: e.am}) MERGE (r)-[x:AMENDED_BY]->(a) SET x.via_chunks=e.via",
              rows=[{"rule": r, "am": a, "via": sorted(v)} for (r, a), v in amend_edges.items()])
        counts = {k: s.run(q).single()["c"] for k, q in {
            "Rule": "MATCH (n:Rule) RETURN count(n) AS c", "Table": "MATCH (n:Table) RETURN count(n) AS c",
            "Amendment": "MATCH (n:Amendment) RETURN count(n) AS c", "REFERS_TO": "MATCH ()-[x:REFERS_TO]->() RETURN count(x) AS c",
            "REFERS_TO_TABLE": "MATCH ()-[x:REFERS_TO_TABLE]->() RETURN count(x) AS c",
            "AMENDED_BY": "MATCH ()-[x:AMENDED_BY]->() RETURN count(x) AS c"}.items()}
    driver.close()
    log(f"graph counts: {counts} (expected Rule={len(rules)}, Table={len(tables)}, Amendment={len(amend)}, REFERS_TO={len(refs)}, REFERS_TO_TABLE={len(table_refs)}, AMENDED_BY={len(amend_edges)})")


if __name__ == "__main__":
    main()
