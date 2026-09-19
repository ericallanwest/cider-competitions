"""List the crawled producers the World Cider Map does not appear to hold.

What is left at the end of a parsed_producer_review pass is two different
jobs. A row with a close candidate is still a matching decision. A row without
one is usually a cidery the map has never had, and matching it to anything
would be wrong - it needs adding instead.

This writes reports/new_producers.csv: the unmatched producers, in the map's
own column order for the fields competition results can actually fill, with
the evidence for each after them. Paste the left-hand block into the map, keep
the evidence to hand while you look each one up, and drop it.

Nothing is invented. Region and Country are only filled where a competition
published them, and Type and Status carry the map's own commonest values as a
starting point rather than a claim.

    python pipeline/new_producers.py
    python pipeline/new_producers.py --threshold 0.7
"""
import argparse
import collections
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib

REVIEW = lib.REPORTS / "parsed_producer_review.csv"
OUT = lib.REPORTS / "new_producers.csv"

# The map's own leading columns, so the left of this file pastes into it.
MAP_FIELDS = ["Name", "Type", "Status", "Town_City", "Region", "Country", "Website"]
EVIDENCE = ["looks_like", "awards", "competitions", "years", "example_ciders",
            "region_as_published", "closest_map_name", "closest_score"]

# Competitions with amateur classes, where an entrant is often a person rather
# than a business. The map holds businesses, so those belong in the sheets as
# the 'X' sentinel instead of being added here.
AMATEUR = {"museum-of-cider", "royal-three-counties", "royal-bath-and-west"}

# Words that mark a name as a trading name rather than a person's.
TRADE = ("cider", "cidre", "cidrerie", "sidra", "sagardo", "orchard", "farm", "winery",
         "wine", "brew", "company", " co", "ltd", "llc", "inc", "distill", "vineyard",
         "works", "house", "meadery", "press", "mill", "barn", "ranch", "cyder", "&")


def kind(name: str, comps: list[str]) -> str:
    """A guess at what a name is, to be read and overruled, never trusted."""
    trading = any(w in name.casefold() for w in TRADE)
    if trading:
        return ""
    if any(c in AMATEUR for c in comps):
        return "person? amateur class - consider X rather than a map entry"
    return "no trading name - check before adding"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=float, default=0.6,
                    help="a candidate at or above this is a matching job, not a new entry")
    args = ap.parse_args()

    if not REVIEW.exists():
        sys.exit(f"{REVIEW.relative_to(lib.ROOT)} not found - run review_parsed.py first")

    todo = [r for r in lib.read_csv(REVIEW)
            if r["status"] == "new-or-misspelt"
            and float(r.get("score1") or 0) < args.threshold]
    if not todo:
        print("Nothing unmatched at that threshold.")
        return 0

    awards = lib.read_csv(lib.OUT / "awards.csv")
    by_name = collections.defaultdict(list)
    for a in awards:
        by_name[a["producer_name"]].append(a)

    rows = []
    for r in todo:
        name = r["producer_name"]
        mine = by_name.get(name, [])
        years = sorted({a["year"] for a in mine if a["year"]})
        comps = sorted({a["competition_id"] for a in mine})
        # Whatever place the results pages themselves stated. Region and
        # country are kept apart: a competition that publishes "44" or
        # "Herefordshire" and no country was putting a region there, and
        # writing it into Country would put nonsense into the map.
        regions, countries = [], []
        for a in mine:
            for value, into in ((lib.clean(a["region"]), regions),
                                (lib.clean(a["country"]), countries)):
                if value and value not in into:
                    into.append(value)
        ciders = []
        for a in mine:
            entry = lib.clean(a["entry_name"])
            if entry and entry not in ciders:
                ciders.append(entry)
        rows.append({
            "Name": name,
            "Type": "Cider",
            "Status": "Active",
            "Town_City": "",
            # Only where the competitions agree; one value or none, never a guess.
            "Region": regions[0] if len(regions) == 1 else "",
            "Country": countries[0] if len(countries) == 1 else "",
            "Website": "",
            "awards": len(mine),
            "competitions": "; ".join(comps),
            "years": f"{years[0]}-{years[-1]}" if len(years) > 1 else (years[0] if years else ""),
            "example_ciders": "; ".join(ciders[:3]),
            "region_as_published": " | ".join(regions + countries),
            "looks_like": kind(name, comps),
            "closest_map_name": r.get("candidate1", ""),
            "closest_score": r.get("score1", ""),
        })

    rows.sort(key=lambda r: (-r["awards"], r["Name"].casefold()))
    lib.write_csv(OUT, rows, MAP_FIELDS + EVIDENCE)

    placed = sum(1 for r in rows if r["Region"] or r["Country"])
    flagged = sum(1 for r in rows if r["looks_like"])
    print(f"{OUT.relative_to(lib.ROOT)}: {len(rows)} producers the map does not appear to hold")
    print(f"  {placed} come with a region or country a competition published; "
          f"{len(rows) - placed} need looking up")
    if flagged:
        print(f"  {flagged} carry no trading name - check the looks_like column before adding")
    print(f"  columns {', '.join(MAP_FIELDS)} are in the map's own order - paste those, "
          f"then delete the evidence columns")
    return 0


if __name__ == "__main__":
    sys.exit(main())
