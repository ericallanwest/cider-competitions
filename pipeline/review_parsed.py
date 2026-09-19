"""List the producers that entered the dataset from a crawled page, for review.

Rows parsed from a competition's own results page go straight into awards.csv,
on the same footing as a sheet. That is what makes the backfill quick, and it
is also the hole in it: a sheet row carries a WID that Eric assigned, while a
parsed row carries a producer name and nothing else, so identity is decided by
string matching rather than by a person.

This writes reports/parsed_producer_review.csv - one row per producer that
appears in a parsed source, so the whole backlog can be approved in one pass
instead of a year at a time. Producers whose name already matches a
WID-bearing producer elsewhere in the dataset are listed first as
`matches-known-producer`, because those are the cheap confirmations. The rest
are `new-or-misspelt` and carry the three closest World Cider Map candidates,
which is where a second record for a cidery you already have will be hiding.

Nothing here edits anything. Put the right id in confirm_wid, then copy the
row into crosswalks/producer_aliases.csv the same way as for
suggest_matches.py, whose scoring this reuses.

    python pipeline/review_parsed.py
    python pipeline/review_parsed.py --candidates 5
"""
import argparse
import collections
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib
from suggest_matches import score, tokens

REFERENCE = lib.ROOT / "data" / "reference" / "producers_geo.csv"
ALIASES = lib.ROOT / "crosswalks" / "producer_aliases.csv"
OUT = lib.REPORTS / "parsed_producer_review.csv"


def parsed_source_ids() -> dict[str, dict]:
    cfg = lib.CONFIG / "parsed_sources.csv"
    if not cfg.exists():
        return {}
    return {r["source_id"]: r for r in lib.read_csv(cfg) if r["status"] == "active"}


def origin_of(row: dict) -> str:
    """The source_id an awards.csv row came from, whatever the label prefix."""
    return row["source_file"].split(":", 1)[-1].split("/")[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", type=int, default=3)
    args = ap.parse_args()

    sources = parsed_source_ids()
    if not sources:
        print("No active parsed sources.")
        return

    awards = lib.read_csv(lib.OUT / "awards.csv")
    crawled = [a for a in awards if origin_of(a) in sources]
    if not crawled:
        print("No live awards came from a parsed source.")
        return

    # Producers the dataset can already identify, from anywhere a person has
    # assigned a WID. A crawled name matching one of these is the easy case.
    known = {}
    for a in awards:
        wid = lib.clean(a["wid"])
        if wid and wid.upper() != "X":
            known.setdefault(lib.clean(a["producer_name"]).casefold(), (wid, a["producer_name"]))

    mapped = {lib.clean(p["producer_name"]).casefold(): p["latitude"]
              for p in lib.read_csv(lib.OUT / "producers.csv")}
    already = {lib.clean(r["producer_name"]).casefold()
               for r in (lib.read_csv(ALIASES) if ALIASES.exists() else [])}

    # One entry per producer, remembering every crawled year they turn up in.
    seen = collections.OrderedDict()
    for a in crawled:
        name = lib.clean(a["producer_name"])
        if not name:
            continue
        e = seen.setdefault(name, {"awards": 0, "where": set()})
        e["awards"] += 1
        src = sources[origin_of(a)]
        e["where"].add(f'{src["competition_id"]} {src["year"]}')

    reference = [r for r in lib.read_csv(REFERENCE) if lib.clean(r["name"])]
    index: dict[str, list[dict]] = {}
    for r in reference:
        for t in tokens(r["name"]):
            index.setdefault(t, []).append(r)

    rows = []
    for name, e in seen.items():
        folded = name.casefold()
        hit = known.get(folded)
        row = {
            "producer_name": name,
            "status": "matches-known-producer" if hit else "new-or-misspelt",
            "crawled_awards": e["awards"],
            "appears_in": "; ".join(sorted(e["where"])),
            "current_wid": hit[0] if hit else "",
            "on_map": "yes" if mapped.get(folded) else "no",
            "in_aliases": "yes" if folded in already else "",
            "confirm_wid": "",
        }
        # Candidates only matter where identity is unresolved.
        if not hit:
            pool, seen_ids = [], set()
            for t in tokens(name):
                for cand in index.get(t, []):
                    if id(cand) not in seen_ids:
                        seen_ids.add(id(cand))
                        pool.append(cand)
            best = sorted(((score(name, c["name"]), c) for c in pool),
                          key=lambda x: -x[0])[:args.candidates]
            for i, (sc, c) in enumerate(best, start=1):
                row[f"candidate{i}"] = c["name"]
                row[f"wid{i}"] = c["wid"]
                row[f"where{i}"] = ", ".join(
                    x for x in (c["town"], c["region"], c["country"]) if x)
                row[f"score{i}"] = sc
        rows.append(row)

    # Confirmations first and loudest: known matches by weight, then the
    # unresolved ones ordered by how close the best guess is, so a near-certain
    # duplicate is at the top rather than buried among genuinely new cideries.
    rows.sort(key=lambda r: (
        0 if r["status"] == "matches-known-producer" else 1,
        -float(r.get("score1") or 0) if r["status"] != "matches-known-producer" else 0,
        -r["crawled_awards"],
    ))

    fields = ["producer_name", "status", "crawled_awards", "appears_in",
              "current_wid", "on_map", "in_aliases", "confirm_wid"]
    for i in range(1, args.candidates + 1):
        fields += [f"candidate{i}", f"wid{i}", f"where{i}", f"score{i}"]
    lib.write_csv(OUT, rows, fields)

    n_known = sum(1 for r in rows if r["status"] == "matches-known-producer")
    n_new = len(rows) - n_known
    close = sum(1 for r in rows
                if r["status"] != "matches-known-producer" and float(r.get("score1") or 0) >= 0.6)
    print(f"{OUT.relative_to(lib.ROOT)}: {len(rows)} producers across "
          f"{len(crawled)} crawled awards in {len(sources)} competition-years")
    print(f"  {n_known} already match a producer with a WID - confirm and move on")
    print(f"  {n_new} unresolved, of which {close} have a candidate scoring >= 0.60 "
          f"- those are the likely duplicates")


if __name__ == "__main__":
    main()
