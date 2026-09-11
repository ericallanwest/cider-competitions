"""Emit the static JSON the site loads, plus the Tableau parity extract.

Column-oriented with integer-coded dimensions: the whole dataset is small
enough to ship in one payload and filter in the browser, so the site needs no
API and no pagination.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib

SITE_DATA = lib.ROOT / "site" / "data"
EXPORTS = lib.ROOT / "exports" / "tableau"


def coded(values):
    """Build a dimension vocabulary and return (vocab, index_lookup)."""
    vocab = sorted({v for v in values if v})
    return vocab, {v: i for i, v in enumerate(vocab)}


def main() -> None:
    awards = lib.read_csv(lib.OUT / "awards.csv")
    producers = lib.read_csv(lib.OUT / "producers.csv")
    comps = {c["competition_id"]: c for c in lib.read_csv(lib.CONFIG / "sources.csv")}
    medal_display = {lib.clean(r["award_raw"]).casefold(): lib.clean(r.get("display", ""))
                     for r in lib.read_csv(lib.ROOT / "crosswalks" / "award_vocab.csv")}

    comp_vocab, comp_ix = coded(r["competition_id"] for r in awards)
    style_vocab, style_ix = coded(r["style_group"] for r in awards)
    medal_vocab, medal_ix = coded(r["medal_level"] for r in awards)
    kind_vocab, kind_ix = coded(r["award_kind"] for r in awards)
    special_vocab, special_ix = coded(r["special_award"] for r in awards)
    cat_vocab, cat_ix = coded(r["category_raw"] for r in awards)
    prod_ix = {p["producer_name"].casefold(): i for i, p in enumerate(producers)}

    SITE_DATA.mkdir(parents=True, exist_ok=True)
    json.dump({
        "n": len(awards),
        "c": [comp_ix.get(r["competition_id"], -1) for r in awards],
        "y": [int(r["year"]) if r["year"] else 0 for r in awards],
        "p": [prod_ix.get(r["producer_name"].casefold(), -1) for r in awards],
        "s": [style_ix.get(r["style_group"], -1) for r in awards],
        "m": [medal_ix.get(r["medal_level"], -1) for r in awards],
        "k": [kind_ix.get(r["award_kind"], -1) for r in awards],
        "sp": [special_ix.get(r["special_award"], -1) for r in awards],
        "cat": [cat_ix.get(r["category_raw"], -1) for r in awards],
        "e": [r["entry_name"] for r in awards],
    }, open(SITE_DATA / "awards.json", "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)

    json.dump([{
        "n": p["producer_name"], "id": p["producer_id"],
        "md": int(p["medals"] or 0), "aw": int(p["awards"] or 0),
        "f": int(p["first_year"]) if p["first_year"] else 0,
        "l": int(p["last_year"]) if p["last_year"] else 0,
        "co": int(p["competitions"] or 0),
        "t": p["town"], "r": p["region"], "ct": p["country"],
        "lat": float(p["latitude"]) if p["latitude"] else None,
        "lon": float(p["longitude"]) if p["longitude"] else None,
        "w": p["website"],
    } for p in producers], open(SITE_DATA / "producers.json", "w", encoding="utf-8"),
        separators=(",", ":"), ensure_ascii=False)

    json.dump({
        "competitions": [{"id": c, "name": comps.get(c, {}).get("name", c)} for c in comp_vocab],
        "styles": style_vocab, "medals": medal_vocab, "kinds": kind_vocab,
        "specials": special_vocab, "categories": cat_vocab,
        "medal_display": medal_display,
    }, open(SITE_DATA / "dims.json", "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)

    years = [int(r["year"]) for r in awards if r["year"]]
    geocoded = sum(1 for p in producers if p["latitude"])
    json.dump({
        "awards": len(awards), "producers": len(producers),
        "competitions": len(comp_vocab),
        "year_min": min(years), "year_max": max(years),
        "geocoded": geocoded,
        "geocoded_share": round(geocoded / len(producers), 3),
    }, open(SITE_DATA / "meta.json", "w", encoding="utf-8"), indent=1)

    # Tableau parity extract - keeps the existing .twb working off this pipeline.
    EXPORTS.mkdir(parents=True, exist_ok=True)
    lib.write_csv(EXPORTS / "medalists.csv", [{
        "WID": p["wid"], "Medalist": p["producer_name"], "Region": p["region"],
        "Country": p["country"], "Latitude": p["latitude"], "Longitude": p["longitude"],
    } for p in producers], ["WID", "Medalist", "Region", "Country", "Latitude", "Longitude"])

    rollup: dict[tuple, int] = {}
    for r in awards:
        if r["award_kind"] in ("medal", "place"):
            key = (r["wid"], r["producer_name"], r["year"], r["competition_id"])
            rollup[key] = rollup.get(key, 0) + 1
    lib.write_csv(EXPORTS / "medals_table.csv", [{
        "WID": w, "Medalist": m, "Year": y,
        "Event": comps.get(c, {}).get("name", c), "Awards": n,
    } for (w, m, y, c), n in sorted(rollup.items())],
        ["WID", "Medalist", "Year", "Event", "Awards"])

    for f in sorted(SITE_DATA.glob("*.json")):
        print(f"  {f.name}: {f.stat().st_size/1024:.0f} KB")
    print(f"  exports/tableau/: medalists.csv, medals_table.csv ({len(rollup)} rows)")


if __name__ == "__main__":
    main()
