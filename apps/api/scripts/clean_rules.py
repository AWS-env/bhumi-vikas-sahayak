"""Clean reference/data/bhumi_vikas_rules.jsonl into data/rules_clean.jsonl.

- strips running page headers
- moves amendment footnotes out of the text into `amendments` metadata (with page + footnote number)
- splits nested rules (12-A, 17-a, 25(A), 42-A, 93(a)) into their own records
- `text` is clean; `text_marked` also carries invisible page/footnote sentinels
  (⟦P78⟧ = page starts, ⟦F78.1⟧ = footnote 1 of page 78) so the chunker can give every
  chunk its own page range and amendment list.
reference/ is never modified.
"""
import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "reference" / "data" / "bhumi_vikas_rules.jsonl"
OUT = ROOT / "apps" / "api" / "data" / "rules_clean.jsonl"
NL = chr(10)

HEADER = re.compile(r"^\s*Rule\s+[\w\-–, ]+\s+M\.P\. Bhumi Vikas Rules, 2012\s+(\d+)\s*$")
LONE_NUM = re.compile(r"^\s*(\d{1,2})\s*$")
FN_HINT = re.compile(r"Notification|Rajpatra|Gazette|Pubished|\bdated\b", re.I)
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
DATE = re.compile(rf"(\d{{1,2}})\s*(?:st|nd|rd|th)?\s*[,.]?\s*({MONTHS})[,.]?\s*(\d{{4}})", re.I)
DATE_NUM = re.compile(r"\b(\d{1,2})-(\d{1,2})-(\d{4})\b")
INLINE_MARK = re.compile(r"(?<![\w.])(\d{1,2})(?=\[)")
SENTINEL = re.compile(r"⟦[PF][\d.]+⟧")

# (id, regex for the heading line inside the parent rule's raw text)
NESTED = {
    "12": [("12-A", re.compile(r"^\s*12 ?A\. "))],
    "17": [("17-a", re.compile(r'^\s*\[?\s*17-a\. '))],
    "25": [("25(A)", re.compile(r"^\s*\[?\s*25\(A\)\. "))],
    "42": [("42-A", re.compile(r"^\s*\[?\s*42A\. "))],
    "93": [("93(a)", re.compile(r'^\s*\["?\s*93\(a\) '))],
}


def parse_date(note: str):
    m = DATE.search(note)
    if m:
        try:
            return datetime.strptime(f"{int(m[1])} {m[2].title()} {m[3]}", "%d %B %Y").date().isoformat()
        except ValueError:
            return None
    m = DATE_NUM.search(note)
    if m:
        return f"{m[3]}-{int(m[2]):02d}-{int(m[1]):02d}"
    return None


def kind_of(note: str) -> str:
    n = note.lstrip().lower()
    for k, v in (("ins", "inserted"), ("subs", "substituted"), ("omit", "omitted"),
                 ("added", "added"), ("amend", "amended"), ("re-num", "renumbered")):
        if n.startswith(k):
            return v
    return "note"


def page_before(raw, idx, default):
    """PDF page in effect at raw[idx] (last running header above it, else the rule's first page)."""
    page = default
    for line in raw[:idx]:
        m = HEADER.match(line)
        if m:
            page = int(m.group(1))
    return page


def clean_segment(lines, page0):
    """Return (marked_text, amendments) for a list of raw lines starting on PDF page `page0`."""
    kept, page = [], page0  # (line, page) with running headers removed
    for line in lines:
        m = HEADER.match(line)
        if m:
            page = int(m.group(1))
            continue
        kept.append((line, page))

    out, amendments, i = [], [], 0
    pend, last_page = "", page0
    while i < len(kept):
        line, pg = kept[i]
        if LONE_NUM.match(line):
            j = i + 1
            nxt = kept[j][0] if j < len(kept) else ""
            if nxt.strip().startswith("["):  # footnote marker only: remember it for the next line
                pend += f"⟦F{pg}.{int(line.strip())}⟧"
                i += 1
                continue
            block = []
            while j < len(kept) and kept[j][0].strip():
                block.append(kept[j][0].strip())
                j += 1
            if block and kept[i + 1][0][:1].isspace() and FN_HINT.search(" ".join(block[:3])):
                note = " ".join(block)
                amendments.append({"page": pg, "n": int(line.strip()), "kind": kind_of(block[0]),
                                   "date": parse_date(block[0]) or parse_date(note), "note": note})
                i = j
                continue
        if pg != last_page:
            pend = f"⟦P{pg}⟧" + pend
            last_page = pg
        out.append(pend + INLINE_MARK.sub(lambda m: f"⟦F{pg}.{m.group(1)}⟧", line))
        pend = ""
        i += 1
    marked = re.sub(r"\n{3,}", NL * 2, NL.join(out)).strip()
    return marked, amendments


def strip_marks(text):
    return re.sub(r"\n{3,}", NL * 2, SENTINEL.sub("", text)).strip()


def relink_amendments(records):
    """A footnote is printed at the bottom of its page, so it may sit in a different rule's text
    than its marker. Move each footnote to the record(s) whose text holds its marker (page, number)."""
    holders = {}
    for rec in records:
        for key in set(re.findall(r"⟦F([\d.]+)⟧", rec["text_marked"])):
            holders.setdefault(key, []).append(rec)
    notes = [(rec, a) for rec in records for a in rec["amendments"]]
    for rec in records:
        rec["amendments"] = []
    for rec, a in notes:
        targets = holders.get(f"{a['page']}.{a['n']}")
        a["linked"] = bool(targets)
        for t in targets or [rec]:
            t["amendments"].append(dict(a))


def main():
    rules = [json.loads(l) for l in SRC.open(encoding="utf-8")]
    records = []
    for r in rules:
        raw = r["text"].split(NL)
        cuts = []
        for nid, pat in NESTED.get(r["rule"], []):
            idx = next((k for k, l in enumerate(raw) if pat.match(l)), None)
            if idx is None:
                raise SystemExit(f"nested heading {nid} not found in rule {r['rule']}")
            if idx > 0 and LONE_NUM.match(raw[idx - 1]):  # include a preceding footnote-marker line
                idx -= 1
            cuts.append((nid, idx))
        bounds = [(r["rule"], 0)] + cuts
        for n, (rid, start) in enumerate(bounds):
            end = bounds[n + 1][1] if n + 1 < len(bounds) else len(raw)
            page0 = page_before(raw, start, r["page_start"])
            marked, am = clean_segment(raw[start:end], page0)
            text = strip_marks(marked)
            title = r["title"]
            if rid != r["rule"]:
                m = re.search(r"\d+ ?-?\(?[A-Za-z]\)?\.?\s*(.+?)(?:\.-|\.\s|$)", text.splitlines()[0].lstrip('["'))
                title = (m.group(1) if m else title).strip(" .-")
            records.append({
                "id": rid, "rule": r["rule"], "parent": None if rid == r["rule"] else r["rule"],
                "title": title, "part": r["part"], "page_start": page0,
                "page_end": r["page_end"], "amendments": am, "text": text, "text_marked": marked,
            })
    relink_amendments(records)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + NL)

    c = Counter()
    for rec in records:
        for l in rec["text"].split(NL):
            if HEADER.match(l): c["header_left"] += 1
            if LONE_NUM.match(l): c["lone_num_left"] += 1
            if re.search(r"Notification No|Rajpatra", l): c["footnote_left"] += 1
        for a in rec["amendments"]:
            c["amend_total"] += 1
            c["amend_linked"] += a["linked"]
    print(f"records: {len(records)} (source rules: {len(rules)})")
    print("leftover noise / amendment linking:", dict(c))
    print("undated amendments:", sum(1 for r in records for a in r['amendments'] if not a['date']))


if __name__ == "__main__":
    main()
