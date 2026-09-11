"""Check data/out/awards.csv and write reports/.

Hard failures block the build (exit 1). Warnings are reported with counts so
the highest-leverage fixes surface first.

Note on regions and countries: differing designations are NOT errors. Distinct
spellings are reported only so a human can decide whether two strings are the
same designation misspelled. Nothing here merges them.
"""
import collections
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib

MOJIBAKE = re.compile(r"Ã©|Ã¨|Ã¡|Ã­|Ã³|Ãº|Ã±|â€™|â€œ|â€|Ã¼|Ã¶|Ã¤|�|ð\x9f")
SECRET = re.compile(r"AIza[0-9A-Za-z_-]{35}")
CURRENT_YEAR = 2026

# Known-good totals. A change here must be deliberate.
BASELINE = {
    "glintcap": 8879,
    "australian-cider-awards": 1551,
    "museum-of-cider": 73,
}


def main() -> int:
    rows = lib.read_csv(lib.OUT / "awards.csv")
    if not rows:
        print("FAIL: awards.csv is empty", file=sys.stderr)
        return 1

    lib.REPORTS.mkdir(exist_ok=True)
    hard, warn = [], []

    # --- hard checks -----------------------------------------------------
    bycomp = collections.Counter(r["competition_id"] for r in rows)
    for comp, expected in BASELINE.items():
        got = bycomp.get(comp, 0)
        if got != expected:
            hard.append(f"row-count regression: {comp} has {got}, baseline {expected}")

    bad_year = [r for r in rows if not (r["year"].isdigit() and 2004 < int(r["year"]) <= CURRENT_YEAR)]
    if bad_year:
        hard.append(f"{len(bad_year)} rows with an out-of-range or non-integer year")

    ids = collections.Counter(r["award_id"] for r in rows)
    dupes = [k for k, n in ids.items() if n > 1]
    if dupes:
        hard.append(f"{len(dupes)} duplicate award_id values")

    leftover_html = [r for r in rows if "<" in r["producer_name"] or "<" in r["entry_name"]]
    if leftover_html:
        hard.append(f"{len(leftover_html)} rows still contain HTML tags")

    for path in (lib.ROOT / "crosswalks").glob("*.csv"):
        text = path.read_text(encoding="utf-8", errors="replace")
        if MOJIBAKE.search(text):
            hard.append(f"mojibake detected in {path.name} - re-save as UTF-8")
        if SECRET.search(text):
            hard.append(f"API key detected in {path.name}")

    unmapped = collections.Counter(r["award_raw"] for r in rows if r["award_kind"] == "unmapped")
    if unmapped:
        hard.append(f"{sum(unmapped.values())} rows with unmapped awards (closed set - should be 0)")
    lib.write_csv(lib.REPORTS / "unmapped_awards.csv",
                  [{"award_raw": k, "rows": n} for k, n in unmapped.most_common()],
                  ["award_raw", "rows"])

    # --- warnings --------------------------------------------------------
    coverage = collections.Counter((r["competition_id"], r["year"]) for r in rows)
    lib.write_csv(lib.REPORTS / "coverage_by_competition_year.csv",
                  [{"competition_id": c, "year": y, "awards": n}
                   for (c, y), n in sorted(coverage.items())],
                  ["competition_id", "year", "awards"])

    unclassified = sum(1 for r in rows if r["style_group"] == "Unclassified")
    share = unclassified / len(rows)
    if share > 0.20:
        warn.append(f"style_group Unclassified is {share:.0%} of rows (budget 20%)")
    styles = collections.Counter(r["category_raw"] for r in rows if r["style_group"] == "Unclassified")
    lib.write_csv(lib.REPORTS / "unmapped_styles.csv",
                  [{"category_raw": k, "rows": n, "style_group": ""} for k, n in styles.most_common()],
                  ["category_raw", "rows", "style_group"])

    # Designations, reported for a human to review - never merged automatically.
    places = collections.Counter()
    for r in rows:
        for field in ("region", "country"):
            if r[field]:
                places[(field, r[field])] += 1
    lib.write_csv(lib.REPORTS / "designations.csv",
                  [{"field": f, "value": v, "rows": n} for (f, v), n in sorted(places.items())],
                  ["field", "value", "rows"])

    # Producers carrying medals but no coordinates, worst-first by medal count.
    nogeo = collections.Counter(
        r["producer_name"] for r in rows if not r["latitude"] and r["award_kind"] in ("medal", "place"))
    lib.write_csv(lib.REPORTS / "producers_missing_geo.csv",
                  [{"producer_name": k, "medals": n} for k, n in nogeo.most_common()],
                  ["producer_name", "medals"])
    if nogeo:
        warn.append(f"{len(nogeo)} producers have medals but no coordinates "
                    f"(see reports/producers_missing_geo.csv)")

    # --- report ----------------------------------------------------------
    print(f"validate: {len(rows)} awards across {len(bycomp)} competitions")
    for w in warn:
        print(f"  WARN  {w}")
    for h in hard:
        print(f"  FAIL  {h}", file=sys.stderr)
    if not hard:
        print("  all hard checks passed")
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
