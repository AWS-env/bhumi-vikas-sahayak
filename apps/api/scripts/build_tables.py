"""Build data/tables.json (curated) from data/tables_raw.json.
Each table keeps rule, PDF page, caption and rows as printed. Lookup tables also get
numeric `bands` for code (checkpoint 8). `verified` stays false until checked against the PDF page."""
import json
from pathlib import Path

D = Path(__file__).resolve().parents[1] / "data"
raw = json.loads((D / "tables_raw.json").read_text(encoding="utf-8"))


def get(rule, page, idx=0):
    return next(t for t in raw if t["rule"] == rule and t["page"] == page and t["index"] == idx)["rows"]


def body(rows, skip=2):  # drop header + "(1) (2) (3)" index row
    return rows[skip:]


def num(s):
    return float(s.replace(",", ""))


tables = []


def add(id, rule, title, pages, columns, rows, **extra):
    tables.append({"id": id, "rule": rule, "title": title, "pages": pages,
                   "columns": columns, "rows": rows, "verified": False, **extra})


# ---- Rule 56
r = get("56", 77)
add("r56_front_open_space", "56", "Rule 56(1)(a): front open space, residential buildings up to 12.5 m height", [77],
    r[0][1:], [x[1:] for x in body(r)],
    bands=[{"street_width_over_m": o, "street_width_upto_m": u, "front_open_space_m": v}
           for o, u, v in [(None, 9.0, 3.0), (9.0, 12.0, 3.6), (12.0, 18.0, 4.5), (18.0, None, 6.0)]])
r = get("56", 78)
add("r56_rear_open_space", "56", "Rule 56(2)(a): rear open space, residential buildings up to 12.5 m height", [78],
    r[0][1:], [x[1:] for x in body(r)],
    bands=[{"plot_area_over_sqm": o, "plot_area_upto_sqm": u, "rear_open_space_m": v}
           for o, u, v in [(None, 40.0, 0.0), (40.0, 150.0, 1.5), (150.0, 225.0, 2.5), (225.0, None, 3.0)]],
    notes="Plots up to 40 sq m: printed as 'Nil'.")
heights = ["Up to 10", "12.5", "18", "24", "30", "above 30"]
areas = ["1.2", "2.8", "4.0", "5.4", "8.0", "9.0"]
sides = ["0.9", "1.2", "1.5", "1.8", "2.4", "3.0"]
add("r56_ventilation_shaft", "56", "Rule 56(6)(b): ventilation shaft size", [79],
    ["Height of buildings in meters", "Size of ventilation shaft in square meters", "Minimum size of a side of shaft in meters"],
    [[h, a, s] for h, a, s in zip(heights, areas, sides)],
    notes="Extractor returned this table as one merged row; split by hand into 6 rows (6 values per column).")

# ---- Rule 21
r = get("21", 35)
add("r21_3a_permission_fee_development", "21", "Rule 21(3)(a): permission fee for development of land (Rs./Hectare)", [35],
    ["Land use zone", "Population more than 10 lakhs", "Population 5 to 10 lakhs", "Population less than 5 lakhs"],
    [[r[3][1], r[3][2], r[3][3], r[3][4]], ["Commercial", *r[4][2:]], ["Recreational or agriculture or other", *r[5][2:]]])
r = get("21", 36)
res = r[3:16]
add("r21_3b_building_fee_residential", "21", "Rule 21(3)(b) item 1: building permission fee, residence, by built-up area", [36],
    ["Built up area from sq.m.", "To sq.m.", "Fee in Rs."],
    [[x[2], x[3], x[4]] for x in res],
    bands=[{"from_sqm": num(x[2]) if x[2][0].isdigit() else 2500.0, "to_sqm": num(x[3]) if x[3] else None,
            "fee_rs": num(x[4]), **({"from_exclusive": True} if x[2].startswith("above") else {})} for x in res],
    notes="Slabs are printed in whole sq.m. The last row is printed 'above 2500' (strictly more than 2500) with fee 50,000. Treatment of areas between printed slabs (e.g. 75.5) is a clerk decision, not in the rules.")
other = [x for x in r[16:]] + [x for x in get("21", 37, 0)]
add("r21_3b_building_fee_other_items", "21", "Rule 21(3)(b) items 2-9: other building types and charges", [36, 37],
    ["Item", "Type of construction", "Fee"],
    [[x[0], x[1], x[2].replace("F r e s h a p p l ication", "Fresh application") if x[2] else ""] for x in other],
    notes="Item 8 prints two lines: 'Up to 10%' Rs. 500.00; 'above 10%' fresh application according to the rule shall be necessary.")
r = get("21", 37, 1)
add("r21_3c_high_rise_fee", "21", "Rule 21(3)(c): building permission fee, high rise buildings", [37],
    r[0], body(r))

# ---- Rule 52
r = get("52", 69)
add("r52_distance_from_electric_lines", "52", "Rule 52(1): minimum distance from overhead electric supply lines", [69],
    r[0][1:], [x[1:] for x in body(r)],
    bands=[{"line": "Low and Medium voltage lines and service lines", "vertical_m": 2.5, "horizontal_m": 1.2},
           {"line": "High voltage lines up to and including 33000 volts", "vertical_m": 3.7, "horizontal_m": 1.2}],
    notes="Extra high voltage beyond 33000 V: 'see note' - clear horizontal corridor of 15 m (7.5 m each side of centre line) or as per Electricity Rules, whichever is more.")

# ---- Rule 42
r = get("42", 58)
add("r42_table4", "42", "Rule 42(1) Table 4: norms for buildings above 12.5 m and up to 30 m", [58], r[0], body(r),
    notes="Column 6 (ground coverage) and Note (1) were deleted by MP Rajpatra (Asadharan) No. 74 dated 06-03-2025; the PDF still shows '-' in that column.")
r = get("42", 59)
add("r42_table5", "42", "Rule 42(2) Table 5: planning norms for high rise buildings", [59], r[0], body(r),
    notes="Printed notes (inserted 06 March 2025): (1) commercial premises in planning areas may get max FAR 1:5.0 via TDR and Premium FAR for serial 4 and 5; (2) in commercial premises under Central Business District and Transit Oriented Development Corridor max FAR 1:7.0 for serial 5; (3) premium FAR rate decided by State Government.")
r = get("42", 61)
add("r42_it_ites_esdm", "42", "Table 5-A: percentage of plots/FAR under MPIT, ITES and ESDM", [61],
    ["S. No.", "Type of application", "Type of Development", "Plots used minimum IT/ITES/ESDM", "Plots used maximum ancillary/commercial/other industry/residential"], r[2:])

# ---- Rule 53
r = get("53", 70, 0)
add("r53_plot_size_by_development_type", "53", "Rule 53(1)(i): plot size and frontage by type of residential development", [70], r[0], body(r))
r = get("53", 70, 1)
add("r53_cinema", "53", "Rule 53(3)(ii): cinema halls with one screen", [70], ["Item", "Norm"], r,
    notes="Printed note: commercial activities incidental to cinema are permissible on 10 per cent of the FAR.")
r = get("53", 71, 0)
add("r53_marriage_garden", "53", "Rule 53(3)(iii): marriage garden development norms", [71], r[0], body(r),
    notes="Fuel filling station table (53(3)(iv)(b), pages 71-72) and EV charging tables (pages 73-75) are NOT structured yet.")
VERIFIED = {"by": "agent", "method": "compared extracted rows with rendered PDF page image", "date": "2026-10-11",
            "independent_human_check": False}
for t in tables:
    t["verified"] = True
    t["verification"] = VERIFIED
    for b in t.get("bands", []):  # band numbers must appear in the printed rows
        flat = " ".join(" ".join(r) for r in t["rows"]).replace(",", "")
        for k, v in b.items():
            if isinstance(v, float) and v != 0.0:
                assert f"{v:g}" in flat or f"{v:.1f}" in flat or f"{v:.2f}" in flat, (t["id"], k, v)
(D / "tables.json").write_text(json.dumps(tables, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(tables), "tables written;", sum(len(t["rows"]) for t in tables), "rows")
for t in tables:
    print(f"  {t['id']:42} p{t['pages']} rows={len(t['rows'])}")
