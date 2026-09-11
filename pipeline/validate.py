"""Check data/out/awards.csv and write reports/.

Hard failures block the build (exit 1). Warnings are reported with counts so
the highest-leverage fixes surface first.

Note on regions and countries: differing designations are NOT errors. Distinct
spellings are reported only so a human can decide whether two strings are the
same designation misspelled. Nothing here merges them.
"""
import collections
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib

MOJIBAKE = re.compile(r"Ã©|Ã¨|Ã¡|Ã­|Ã³|Ãº|Ã±|â€™|â€œ|â€|Ã¼|Ã¶|Ã¤|�|ð\x9f")
SECRET = re.compile(r"AIza[0-9A-Za-z_-]{35}")
CURRENT_YEAR = 2026

# Known-good totals, now sourced from Google Sheets. A change here must be
# deliberate: these are the numbers that catch a parser silently dropping rows.
BASELINE = {
    "glintcap": 9615,                 # 8,072 sheet (2005-2023) + 813 archive 2024 + 730 for 2025
    "australian-cider-awards": 1722,  # 1,551 through 2024 + 171 for 2025
    "ciderworld-awards": 969,         # sheet covers 2018-2024; the archive had only 2023-2024
    "museum-of-cider": 73,
    "japan-cider-cup": 138,
    "northwest-cider-cup": 426,
    "royal-three-counties": 67,       # from Data.csv, not the 1,001-row 24.csv tab
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
        if MOJIBAKE.search(path.read_text(encoding="utf-8", errors="replace")):
            hard.append(f"mojibake detected in {path.name} - re-save as UTF-8")

    # Secret scan over everything git would commit, not just the crosswalks.
    # A Google API key reached this public repo once, inside the "Copy of
    # Staging" tab that competition workbooks carry, so this check is repo-wide
    # and blocking rather than advisory.
    leaked = []
    for path in sorted(lib.ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(lib.ROOT).as_posix()
        if rel.startswith((".git/", ".venv/", "site/vendor/")) or "__pycache__" in rel:
            continue
        if subprocess.call(["git", "check-ignore", "-q", str(path)],
                           cwd=lib.ROOT, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL) == 0:
            continue          # ignored by git, so it will never be committed
        try:
            if SECRET.search(path.read_text(encoding="utf-8", errors="replace")):
                leaked.append(rel)
        except (OSError, ValueError):
            continue
    if leaked:
        hard.append(f"API key found in {len(leaked)} committable file(s): "
                    f"{', '.join(leaked[:5])}"
                    f"{' …' if len(leaked) > 5 else ''}")

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
    # This reads producers.csv, not awards.csv: the geocode join happens in
    # producers.py, so an awards row only carries what its source table had.
    producers = lib.read_csv(lib.OUT / "producers.csv")
    if producers:
        nogeo = sorted(
            ({"producer_name": p["producer_name"], "medals": int(p["medals"] or 0)}
             for p in producers if not p["latitude"] and int(p["medals"] or 0) > 0),
            key=lambda p: -p["medals"])
        lib.write_csv(lib.REPORTS / "producers_missing_geo.csv", nogeo,
                      ["producer_name", "medals"])
        if nogeo:
            mapped = 1 - len(nogeo) / len(producers)
            warn.append(f"{len(nogeo)} of {len(producers)} producers have medals but no "
                        f"coordinates ({mapped:.0%} mapped; see "
                        f"reports/producers_missing_geo.csv)")

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
