"""Extract ruled tables from priority pages of the English PDF into data/tables_raw.json.
Output is raw (cells as printed); fixes are applied later in data/tables.json."""
import json
from pathlib import Path
import pdfplumber

ROOT = Path(__file__).resolve().parents[3]
PDF = ROOT / "reference" / "resources" / "MP_Bhumi_Vikas_Rules_2012_upto_2025-03-06_EN.pdf"
OUT = ROOT / "apps" / "api" / "data" / "tables_raw.json"
PAGES = {"56": range(77, 81), "21": range(35, 39), "52": range(69, 71), "42": range(58, 62), "53": range(70, 77)}


def clean(c):
    return " ".join((c or "").split())


def main():
    out = []
    with pdfplumber.open(PDF) as pdf:
        for rule, pages in PAGES.items():
            for p in pages:
                for n, t in enumerate(pdf.pages[p - 1].find_tables()):
                    rows = [[clean(c) for c in row] for row in t.extract()]
                    out.append({"rule": rule, "page": p, "index": n, "rows": rows})
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    for t in out:
        print(f"--- rule {t['rule']} page {t['page']} #{t['index']} ({len(t['rows'])} rows x {max(len(r) for r in t['rows'])} cols)")
        for r in t["rows"]:
            print("  " + " | ".join(r))


if __name__ == "__main__":
    main()
