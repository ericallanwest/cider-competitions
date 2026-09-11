"""Propose World Cider Map matches for producers that failed to geocode.

Writes reports/producer_match_review.csv - one row per unmapped producer,
ordered by medal count, with the three closest candidates from the map and
their IDs. Review it, and for any row that is genuinely the same producer,
copy producer_name + the right ID into crosswalks/producer_aliases.csv.

Nothing here edits the alias file. Matching producers is a judgement call
("Empyrical Orchards & Cider" vs "Empyrical Orchard & Cidery" is the same
cidery; two farms sharing a surname are not), so the tool only suggests.

    python pipeline/suggest_matches.py
    python pipeline/suggest_matches.py --min-medals 3
"""
import argparse
import re
import sys
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib

REFERENCE = lib.ROOT / "data" / "reference" / "producers_geo.csv"
ALIASES = lib.ROOT / "crosswalks" / "producer_aliases.csv"
OUT = lib.REPORTS / "producer_match_review.csv"

# Words that carry no identifying information, so "Smith Cider Co" and
# "Smith Cidery Ltd" compare on "smith".
NOISE = {
    "cider", "ciders", "cidery", "cideries", "ciderworks", "cyder", "cidre",
    "orchard", "orchards", "perry", "company", "co", "inc", "llc", "ltd",
    "limited", "the", "and", "farm", "farms", "cidrerie", "sidra", "sidreria",
}


def tokens(name: str) -> set[str]:
    text = unicodedata.normalize("NFKD", lib.clean(name).casefold())
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-z0-9 ]+", " ", text.replace("&", " and "))
    words = {w for w in text.split() if w}
    return {w for w in words if w not in NOISE} or words


def key(name: str) -> str:
    return " ".join(sorted(tokens(name)))


def score(a: str, b: str) -> float:
    """Blend token overlap with character similarity on the reduced form."""
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    jaccard = len(ta & tb) / len(ta | tb)
    ratio = SequenceMatcher(None, key(a), key(b)).ratio()
    return round(0.6 * jaccard + 0.4 * ratio, 3)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-medals", type=int, default=1,
                    help="skip producers below this medal count (default 1)")
    ap.add_argument("--candidates", type=int, default=3)
    args = ap.parse_args()

    producers = lib.read_csv(lib.OUT / "producers.csv")
    unmapped = [p for p in producers
                if not p["latitude"] and int(p["medals"] or 0) >= args.min_medals]
    if not unmapped:
        print("Nothing unmapped at that threshold.")
        return

    already = {lib.clean(r["producer_name"]).casefold()
               for r in (lib.read_csv(ALIASES) if ALIASES.exists() else [])}
    unmapped = [p for p in unmapped if p["producer_name"].casefold() not in already]

    reference = [r for r in lib.read_csv(REFERENCE) if lib.clean(r["name"])]
    # Index by token so each producer is only compared against plausible rows,
    # rather than all ~4,200 of them.
    index: dict[str, list[dict]] = {}
    for r in reference:
        for t in tokens(r["name"]):
            index.setdefault(t, []).append(r)

    rows = []
    for p in sorted(unmapped, key=lambda p: -int(p["medals"] or 0)):
        seen, pool = set(), []
        for t in tokens(p["producer_name"]):
            for cand in index.get(t, []):
                if id(cand) not in seen:
                    seen.add(id(cand))
                    pool.append(cand)
        scored = sorted(((score(p["producer_name"], c["name"]), c) for c in pool),
                        key=lambda x: -x[0])[:args.candidates]
        row = {
            "producer_name": p["producer_name"],
            "medals": p["medals"],
            "competitions": p["competitions"],
            "region_in_results": p["region"],
            "country_in_results": p["country"],
            "confirm_wid": "",
        }
        for i, (sc, c) in enumerate(scored, start=1):
            row[f"candidate{i}"] = c["name"]
            row[f"wid{i}"] = c["wid"]
            row[f"where{i}"] = ", ".join(x for x in (c["town"], c["region"], c["country"]) if x)
            row[f"score{i}"] = sc
        rows.append(row)

    fields = ["producer_name", "medals", "competitions",
              "region_in_results", "country_in_results", "confirm_wid"]
    for i in range(1, args.candidates + 1):
        fields += [f"candidate{i}", f"wid{i}", f"where{i}", f"score{i}"]
    lib.write_csv(OUT, rows, fields)

    strong = sum(1 for r in rows if float(r.get("score1") or 0) >= 0.6)
    print(f"{OUT.relative_to(lib.ROOT)}: {len(rows)} producers to review")
    print(f"  {strong} have a candidate scoring >= 0.60 - check those first")
    print("  Confirm by putting the right id in confirm_wid, then copy the row "
          "into crosswalks/producer_aliases.csv")


if __name__ == "__main__":
    main()
