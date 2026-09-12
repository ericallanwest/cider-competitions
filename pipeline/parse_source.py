"""Turn harvested result pages into grain CSVs the pipeline can read.

Sources are listed in config/parsed_sources.csv, keyed by (source_id), each
naming the saved page, the parser module, and the year. Parsers live in
pipeline/parsers/ and share one narrow contract:

    parse(path: Path, year: int) -> list[dict]

with keys Year, Style, Medal, Medalist, Entry (and optionally Score, Region,
Country, Town). Parsers do no normalising - that is normalize.py's job - so
when a competition redesigns its site, rewriting one is a small job.

    python pipeline/parse_source.py
    python pipeline/parse_source.py --only glintcap-2026
"""
import argparse
import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib

CONFIG = lib.CONFIG / "parsed_sources.csv"
PARSED = lib.ROOT / "data" / "parsed"
STAGING = lib.ROOT / "data" / "staging"
FIELDS = ["Year", "Style", "Medal", "Medalist", "Entry",
          "Score", "Town", "Region", "Country"]

# Canonical parser keys -> the column names a competition sheet might use.
ALIASES = {
    "Style": ("Style", "Category", "Class", "Division"),
    "Medal": ("Medal", "Award", "Place"),
    "Medalist": ("Medalist", "Producer", "Entrant"),
    "Entry": ("Entry", "Product", "Cider Name"),
    "Score": ("Score", "Points"),
    "Region": ("Region", "County", "Department", "State"),
    "Town": ("Town", "City"),
    "Country": ("Country",),
    "Year": ("Year",),
}


def write_staging(source_id: str, competition_id: str, rows: list[dict]) -> Path | None:
    """Write the same rows in the target sheet's own column order.

    The point is that these paste straight into the competition's Google Sheet,
    where WID gets assigned by hand. WID is emitted blank rather than guessed:
    producer identity is Eric's call, and a wrong ID is worse than an empty one.
    """
    tables = lib.read_csv(lib.CONFIG / "sheet_tables.csv")
    tab = next((t for t in tables
                if t["competition_id"] == competition_id and not t["year"]), None)
    if not tab:
        return None
    grain = lib.SNAPSHOT / tab["source_id"] / tab["tab"]
    if not grain.exists():
        return None
    existing = lib.read_csv(grain)
    if not existing:
        return None

    columns = list(existing[0].keys())
    out = []
    for row in rows:
        shaped = {}
        for col in columns:
            value = ""
            for key, names in ALIASES.items():
                if col in names and row.get(key) not in (None, ""):
                    value = row[key]
                    break
            shaped[col] = value
        out.append(shaped)

    path = STAGING / f"{source_id}.csv"
    lib.write_csv(path, out, columns)
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="run a single source_id")
    args = ap.parse_args()

    if not CONFIG.exists():
        sys.exit(f"{CONFIG.relative_to(lib.ROOT)} not found")

    sources = [s for s in lib.read_csv(CONFIG) if s["status"] == "active"]
    if args.only:
        sources = [s for s in sources if s["source_id"] == args.only]
        if not sources:
            sys.exit(f"No active source with source_id={args.only!r}")

    failures = 0
    for src in sources:
        path = lib.ROOT / src["path"]
        if not path.exists():
            print(f"  {src['source_id']}: MISSING {src['path']}", file=sys.stderr)
            failures += 1
            continue
        try:
            module = importlib.import_module(f"parsers.{src['parser']}")
            rows = module.parse(path, lib.to_year(src["year"]))
        except Exception as exc:  # noqa: BLE001 - one bad parser must not stop the rest
            print(f"  {src['source_id']}: FAILED - {exc}", file=sys.stderr)
            failures += 1
            continue
        if not rows:
            print(f"  {src['source_id']}: parsed 0 rows - check the parser",
                  file=sys.stderr)
            failures += 1
            continue
        out = PARSED / src["source_id"] / src["tab"]
        lib.write_csv(out, rows, FIELDS)
        staged = write_staging(src["source_id"], src["competition_id"], rows)
        extra = f"  (+ {staged.relative_to(lib.ROOT)} to paste into the sheet)" if staged else ""
        print(f"  {src['source_id']}: {len(rows)} rows -> {out.relative_to(lib.ROOT)}{extra}")

    if failures:
        sys.exit(f"\n{failures} source(s) failed.")


if __name__ == "__main__":
    main()
