"""Merge confirmed producer matches into crosswalks/producer_aliases.csv.

reports/parsed_producer_review.csv goes out to a spreadsheet, a person puts a
World Cider Map ID in confirm_wid for the rows that are genuinely the same
producer, and this brings those decisions back. Export the reviewed sheet as
CSV and point this at it:

    python pipeline/apply_review.py path/to/reviewed.csv
    python pipeline/apply_review.py path/to/reviewed.csv --dry-run

Only rows with a confirm_wid are touched, so a half-finished review applies
cleanly and can be run again as more rows are filled in. It is idempotent: a
decision already recorded is left alone rather than duplicated.

Nothing here decides anything. It refuses an ID the map does not contain, and
refuses to change an alias that already points somewhere else, because both
are far more likely to be a typo than a change of mind.
"""
import argparse
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib

ALIASES = lib.ROOT / "crosswalks" / "producer_aliases.csv"
REFERENCE = lib.ROOT / "data" / "reference" / "producers_geo.csv"
FIELDS = ["producer_name", "wid", "wcm_name", "notes"]


def map_names() -> dict[str, list[str]]:
    """World Cider Map ID -> every name it is known by, primary and alternate."""
    names: dict[str, list[str]] = {}
    for r in lib.read_csv(REFERENCE):
        wid = lib.clean(r.get("wid", ""))
        if wid:
            names.setdefault(wid, []).append(lib.clean(r["name"]))
    return names


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("reviewed", help="the reviewed review CSV, exported from the sheet")
    ap.add_argument("--dry-run", action="store_true", help="report, change nothing")
    args = ap.parse_args()

    path = Path(args.reviewed)
    if not path.exists():
        sys.exit(f"{path} not found")

    known = map_names()
    existing = lib.read_csv(ALIASES) if ALIASES.exists() else []
    by_name = {lib.clean(r["producer_name"]).casefold(): r for r in existing}

    added, skipped, noop, problems = [], [], [], []
    for r in lib.read_csv(path):
        name = lib.clean(r.get("producer_name", ""))
        wid = lib.clean(r.get("confirm_wid", ""))
        if not name or not wid:
            continue
        if wid.upper() == "X":
            # 'X' means "not in the map" - a real answer, but not an alias.
            skipped.append((name, "marked X: not in the World Cider Map"))
            continue
        if wid not in known:
            problems.append((name, f"wid {wid} is not in producers_geo.csv"))
            continue
        if r.get("status") == "matches-known-producer":
            noop.append((name, wid))
            continue
        prior = by_name.get(name.casefold())
        if prior:
            if lib.clean(prior["wid"]) != wid:
                problems.append((name, f"already aliased to {prior['wid']}, sheet says {wid}"))
            else:
                skipped.append((name, "already recorded"))
            continue
        # Record the name the reviewer saw, which is the one they matched on.
        matched = ""
        for i in (1, 2, 3):
            if lib.clean(r.get(f"wid{i}", "")) == wid:
                matched = lib.clean(r.get(f"candidate{i}", ""))
                break
        added.append({
            "producer_name": name, "wid": wid,
            "wcm_name": matched or (known[wid][0] if known.get(wid) else ""),
            "notes": f"confirmed from parsed_producer_review {date.today():%Y-%m-%d}",
        })

    for name, why in problems:
        print(f"  PROBLEM  {name}: {why}", file=sys.stderr)
    for name, wid in noop:
        print(f"  no-op    {name}: already resolves to {wid} by name; alias not needed")
    for name, why in skipped:
        print(f"  skipped  {name}: {why}")
    for a in added:
        print(f"  add      {a['producer_name']} -> {a['wid']} ({a['wcm_name']})")

    if problems:
        print(f"\n{len(problems)} problem(s); nothing written.", file=sys.stderr)
        return 1
    if not added:
        print("\nNothing new to add.")
        return 0
    if args.dry_run:
        print(f"\n--dry-run: {len(added)} alias(es) would be added.")
        return 0

    rows = existing + added
    rows.sort(key=lambda r: lib.clean(r["producer_name"]).casefold())
    lib.write_csv(ALIASES, rows, FIELDS)
    print(f"\n{ALIASES.relative_to(lib.ROOT)}: {len(added)} added, {len(rows)} total. "
          f"Run pipeline/run_all.py to rebuild.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
