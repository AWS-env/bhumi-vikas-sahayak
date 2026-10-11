"""Build data/chunks.jsonl from rules_clean.jsonl + tables.json.

Chunk types: rule | definition | table | case_law (never an answer source).
`text` is clean and quotable; `embed_text` = fixed label + text (what gets embedded).
Max ~1800 chars so bge-small (512 tokens) does not truncate.
"""
import json
import re
from pathlib import Path

D = Path(__file__).resolve().parents[1] / "data"
MAX = 1800
NL = chr(10)
WHOLE = 1500

SENTS = r"(?:⟦[PF][\d.]+⟧)*"  # page/footnote sentinels at the start of a line do not count as indentation
TOP = re.compile(rf"^{SENTS}[ \[]{{0,6}}\((\d{{1,2}})\)\s", re.M)
CLAUSE = re.compile(rf"^{SENTS}[ \[]{{0,12}}\(([a-z]{{1,2}}|[ivx]{{1,4}})\)\s", re.M)
DEFN = re.compile(rf"^{SENTS}[ \[]{{2,16}}\((\d{{1,3}})\)\s+[\"“‘']([^\"”’']+)[\"”’']", re.M)


def pieces(text, pat, increasing=False):
    """Split at regex starts; piece 0 is the preamble before the first match.
    increasing=True keeps only matches whose number grows (skips nested sub-points)."""
    idx, last = [], 0
    for m in pat.finditer(text):
        if increasing:
            n = int(m.group(1))
            if n <= last:
                continue
            last = n
        idx.append(m.start())
    if len(idx) < 1:
        return [("", text)]
    bounds = [0] + idx + [len(text)]
    out = []
    for a, b in zip(bounds, bounds[1:]):
        seg = text[a:b].strip("\n")
        if seg.strip():
            m = pat.match(seg) if a else None
            out.append((m.group(1) if m else "", seg))
    return out


def pack(text, limit=MAX):
    """Fallback: greedy line packing under `limit` chars."""
    parts, cur = [], ""
    for line in text.split("\n"):
        if cur and len(cur) + len(line) + 1 > limit:
            parts.append(cur)
            cur = ""
        cur += ("\n" if cur else "") + line
    if cur.strip():
        if parts and len(SENT.sub("", cur).strip()) < 200:  # no tiny tail chunks
            merged = parts.pop() + NL + cur
            if len(merged) <= limit:
                parts.append(merged)
            else:  # too long to merge: split the pair evenly at a line break
                ls, run, cut = merged.split(NL), 0, 0
                for k, l in enumerate(ls):
                    run += len(l) + 1
                    if run >= len(merged) / 2:
                        cut = k + 1
                        break
                parts += [NL.join(ls[:cut]), NL.join(ls[cut:])]
        else:
            parts.append(cur)
    return parts


def extract_comments(text):
    """Pull 'COMMENTS' paragraphs out of rule text; return (main_text, [comment blocks])."""
    lines, main, blocks, i = text.split("\n"), [], [], 0
    while i < len(lines):
        if lines[i].strip() == "COMMENTS":
            j, got = i + 1, False
            while j < len(lines) and not (got and not lines[j].strip()):
                got = got or bool(lines[j].strip())
                j += 1
            block = "\n".join(lines[i + 1:j]).strip()
            blocks.append(block)
            # keep page-break marks in the main text so later chunks know which page they are on
            main.extend(PAGE_MARK.findall(block) and ["".join(f"⟦P{p}⟧" for p in PAGE_MARK.findall(block))] or [])
            i = j
        else:
            main.append(lines[i])
            i += 1
    return "\n".join(main).strip(), blocks


chunks = []
CARRY = {}  # rule id -> PDF page where the next chunk starts
PAGE_MARK = re.compile(r"⟦P(\d+)⟧")
SENT = re.compile(r"⟦[PF][\d.]+⟧")


def add(rec, ctype, path, text, **extra):
    """`text` still carries ⟦P..⟧/⟦F..⟧ sentinels: they give this chunk's own pages and amendments."""
    rid = rec["id"]
    start = CARRY.setdefault(rid, rec["page_start"])
    lead = re.match(r"\s*⟦P(\d+)⟧", text)
    if lead:
        start = int(lead.group(1))
    pages = [int(p) for p in PAGE_MARK.findall(text)]
    end = pages[-1] if pages else start
    if ctype != "case_law":
        CARRY[rid] = end
    foot = set(re.findall(r"⟦F([\d.]+)⟧", text))
    amendments = [a for a in rec["amendments"] if f"{a['page']}.{a['n']}" in foot]
    text = re.sub(r"\n{3,}", NL * 2, SENT.sub("", text)).strip()

    n = sum(1 for c in chunks if c["rule_id"] == rid and c["path"] == path and c["type"] == ctype)
    cid = f"{rid}|{ctype}|{path or '-'}" + (f"|{n + 1}" if n else "")
    label = f"Rule {rid} - {rec['title']} ({rec['part'].split(':')[0]})" + (f" - {path}" if path else "")
    if ctype == "case_law":
        label += " - court comment"
    chunks.append({"chunk_id": cid, "rule_id": rid, "parent": rec["parent"], "title": rec["title"],
                   "part": rec["part"], "page_start": start, "page_end": end,
                   "path": path, "type": ctype, "answerable": ctype != "case_law",
                   "amendments": amendments, "text": text, "embed_text": f"{label}\n{text}",
                   **extra})


def split_long(rec, path, text):
    """Over MAX: group neighbouring clauses up to MAX (path like (a)-(d)); lone oversize clause -> line packing."""
    if len(text) <= MAX:
        add(rec, "rule", path, text)
        return
    groups, cur, keys = [], "", []
    for k, seg in pieces(text, CLAUSE):
        if len(seg) > MAX:  # flush, then pack this clause on its own
            if cur:
                groups.append((keys, cur))
                cur, keys = "", []
            for n, sub in enumerate(pack(seg), 1):
                groups.append(([x for x in (k, f"part {n}") if x], sub))
            continue
        if cur and len(cur) + len(seg) + 1 > MAX:
            groups.append((keys, cur))
            cur, keys = "", []
        cur += (NL if cur else "") + seg
        if k:
            keys.append(k)
    if cur:
        groups.append((keys, cur))
    for keys, body in groups:
        if not keys:
            label = path
        elif len(keys) == 1:
            label = f"{path} {keys[0]}".strip() if keys[0].startswith("part") else f"{path}({keys[0]})"
        elif keys[-1].startswith("part"):
            label = f"{path}({keys[0]}) {keys[-1]}".strip()
        else:
            label = f"{path}({keys[0]})-({keys[-1]})"
        add(rec, "rule", label, body)


def main():
    recs = [json.loads(l) for l in (D / "rules_clean.jsonl").open(encoding="utf-8")]
    for rec in recs:
        main_text, comments = extract_comments(rec["text_marked"])
        if rec["id"] == "2":
            ps = pieces(main_text, DEFN, increasing=True)
            for k, seg in ps:
                m = DEFN.match(seg)
                if m:
                    term = m.group(2).strip()
                    path = f"({k}) {term}"
                    if len(seg) <= MAX:
                        add(rec, "definition", path, seg, term=term)
                    else:
                        for n, sub in enumerate(pack(seg), 1):
                            add(rec, "definition", f"{path} part {n}", sub, term=term)
                else:
                    split_long(rec, "preamble", seg)
        elif len(main_text) <= WHOLE:
            add(rec, "rule", "", main_text)
        else:
            ps = pieces(main_text, TOP, increasing=True)
            if len(ps) == 1:
                split_long(rec, "", main_text)
            else:
                for k, seg in ps:
                    split_long(rec, f"({k})" if k else "preamble", seg)
        for c in comments:
            if c:
                add(rec, "case_law", "", c)

    for t in json.loads((D / "tables.json").read_text(encoding="utf-8")):
        head = "| " + " | ".join(t["columns"]) + " |"
        sep = "|" + "---|" * len(t["columns"])
        rows = ["| " + " | ".join(r) + " |" for r in t["rows"]]
        notes = f"\nNote: {t['notes']}" if t.get("notes") else ""
        body = f"{t['title']} (PDF page {', '.join(map(str, t['pages']))})\n{head}\n{sep}\n" + "\n".join(rows) + notes
        rec = {"id": t["rule"], "parent": None, "title": t["title"].split(":")[0], "part": "Table",
               "page_start": t["pages"][0], "page_end": t["pages"][-1], "amendments": []}
        base = next((r for r in recs if r["id"] == t["rule"]), None)
        if base:  # amendments printed on this table's own pages
            rec.update(part=base["part"], amendments=[a for a in base["amendments"] if a["page"] in t["pages"]])
        label_title = t["title"]
        chunks.append({"chunk_id": f"table|{t['id']}", "rule_id": t["rule"], "parent": None, "title": label_title,
                       "part": rec["part"], "page_start": rec["page_start"], "page_end": rec["page_end"],
                       "path": t["id"], "type": "table", "answerable": True, "amendments": rec["amendments"],
                       "table_id": t["id"], "text": body,
                       "embed_text": f"Rule {t['rule']} - Table - {label_title}\n{body}"})

    with (D / "chunks.jsonl").open("w", encoding="utf-8") as f:
        for c in chunks:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    lens = [len(c["text"]) for c in chunks]
    ids = [c["chunk_id"] for c in chunks]
    by = {}
    for c in chunks:
        by[c["type"]] = by.get(c["type"], 0) + 1
    print("chunks", len(chunks), by, "| unique ids", len(set(ids)))
    print("len median", sorted(lens)[len(lens) // 2], "max", max(lens), "| over 1800:", sum(l > MAX for l in lens),
          "| over 2200:", sum(l > 2200 for l in lens))
    print("oversize:", [(c["chunk_id"], len(c["text"])) for c in chunks if len(c["text"]) > MAX][:12])


if __name__ == "__main__":
    main()
