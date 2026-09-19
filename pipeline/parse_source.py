"""Turn harvested result pages into grain CSVs the pipeline can read.

Sources are listed in config/parsed_sources.csv, keyed by (source_id), each
naming the saved page, the parser module, and the year. `status` says how far
a source has got: `active` is published, its rows read by normalize.py
alongside the fetched sheets; `staging` is extracted but not published, which
writes only the paste-into-the-sheet copy and leaves the live data alone.
Extraction is the cheap half of adding a year - the producer identities are
the expensive half, and those are decided in the sheet. Parsers live in
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
import re
import sys
import unicodedata
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


def known_wids(competition_id: str) -> dict:
    """Producer name -> WID, from identities already decided.

    The competition's own sheet first, because a producer that has entered
    before should keep the ID it was given there, then the World Cider Map
    where exactly one entry carries the name.
    """
    def key(name):
        text = unicodedata.normalize("NFKD", lib.clean(name))
        text = "".join(c for c in text if not unicodedata.combining(c))
        return re.sub(r"[^a-z0-9]", "", text.casefold())

    out = {}
    ref = lib.ROOT / "data" / "reference" / "producers_geo.csv"
    if ref.exists():
        by_name = {}
        for r in lib.read_csv(ref):
            wid = lib.clean(r.get("wid", ""))
            if wid:
                by_name.setdefault(key(r["name"]), set()).add(wid)
        out = {k: next(iter(v)) for k, v in by_name.items() if len(v) == 1}

    tables = lib.read_csv(lib.CONFIG / "sheet_tables.csv")
    tab = next((t for t in tables
                if t["competition_id"] == competition_id and not t["year"]), None)
    if tab:
        grain = lib.SNAPSHOT / tab["source_id"] / tab["tab"]
        if grain.exists():
            for r in lib.read_csv(grain):
                name = lib.pick(r, "Medalist", "Producer", "Entrant")
                wid = lib.clean(r.get("WID", ""))
                if name and wid and wid.upper() != "X":
                    out[key(name)] = wid          # the sheet wins
    return out


def write_staging(source_id: str, competition_id: str, rows: list[dict]) -> Path | None:
    """Write the same rows in the target sheet's own column order.

    The point is that these paste straight into the competition's Google Sheet,
    where a person checks them. WID is filled only where the producer name
    matches an identity already decided, exactly, after stripping case,
    accents and punctuation. Anything less certain is left blank: a wrong ID
    is worse than an empty one, and an empty one is visible.
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

    def fold(name):
        text = unicodedata.normalize("NFKD", lib.clean(name))
        text = "".join(c for c in text if not unicodedata.combining(c))
        return re.sub(r"[^a-z0-9]", "", text.casefold())

    wids = known_wids(competition_id)
    out, filled = [], 0
    for row in rows:
        shaped = {}
        for col in columns:
            value = ""
            for key, names in ALIASES.items():
                if col in names and row.get(key) not in (None, ""):
                    value = row[key]
                    break
            shaped[col] = value
        if "WID" in columns and not shaped.get("WID"):
            hit = wids.get(fold(row.get("Medalist", "")))
            if hit:
                shaped["WID"] = hit
                filled += 1
        out.append(shaped)
    if filled:
        print(f"      {filled} of {len(out)} WIDs pre-filled from an exact name match "
              f"- worth a glance before pasting")

    path = STAGING / f"{source_id}.csv"
    lib.write_csv(path, out, columns)
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="run a single source_id")
    args = ap.parse_args()

    if not CONFIG.exists():
        sys.exit(f"{CONFIG.relative_to(lib.ROOT)} not found")

    sources = [s for s in lib.read_csv(CONFIG) if s["status"] in ("active", "staging")]
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
        staged = write_staging(src["source_id"], src["competition_id"], rows)
        if src["status"] == "staging":
            # Extracted for review only: nothing reaches normalize.py until a
            # person has put the rows in the sheet and given them a WID.
            where = staged.relative_to(lib.ROOT) if staged else "(no sheet to shape it to)"
            print(f"  {src['source_id']}: {len(rows)} rows -> {where}  [staging, not published]")
            continue
        out = PARSED / src["source_id"] / src["tab"]
        lib.write_csv(out, rows, FIELDS)
        extra = f"  (+ {staged.relative_to(lib.ROOT)} to paste into the sheet)" if staged else ""
        print(f"  {src['source_id']}: {len(rows)} rows -> {out.relative_to(lib.ROOT)}{extra}")

    if failures:
        sys.exit(f"\n{failures} source(s) failed.")


if __name__ == "__main__":
    main()
