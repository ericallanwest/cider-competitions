"""Build data/out/producers.csv - one row per producer, with coordinates where known.

Coordinates come from data/reference/producers_geo.csv, which is committed and
therefore identical on every machine. Regenerate it with extract_geo.py when
the World Cider Map changes; this stage never reads machine-local paths, so CI
rebuilds byte-identical output.

Producers with no coordinates are still emitted - they appear in tables and
counts, they just get no map pin. Nothing is invented.
"""
import collections
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib

REFERENCE = lib.ROOT / "data" / "reference" / "producers_geo.csv"
FIELDS = ["producer_id", "producer_name", "wid", "awards", "medals",
          "first_year", "last_year", "competitions",
          "town", "region", "country", "latitude", "longitude", "geo_source",
          "website", "google"]


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", lib.clean(name).casefold()).strip("-")
    return s or "unknown"


def load_geo() -> dict:
    """name.casefold() -> (town, region, country, lat, lon, source)"""
    geo = {}
    if not REFERENCE.exists():
        print(f"  note: {REFERENCE.name} missing - no coordinates will be attached")
        return geo
    for r in lib.read_csv(REFERENCE):
        name = lib.clean(r["name"])
        if name:
            geo[name.casefold()] = (
                lib.clean(r["town"]), lib.clean(r["region"]), lib.clean(r["country"]),
                lib.clean(r["latitude"]), lib.clean(r["longitude"]), lib.clean(r["source"]))
    return geo


def main() -> None:
    awards = lib.read_csv(lib.OUT / "awards.csv")
    geo = load_geo()

    agg: dict[str, dict] = {}
    for r in awards:
        key = r["producer_name"].casefold()
        p = agg.setdefault(key, {
            "producer_id": slug(r["producer_name"]), "producer_name": r["producer_name"],
            "wid": r["wid"], "awards": 0, "medals": 0,
            "years": set(), "comps": set(),
            "town": "", "region": "", "country": "",
            "latitude": "", "longitude": "", "geo_source": "none",
            "website": "", "google": "",
        })
        p["awards"] += 1
        if r["award_kind"] in ("medal", "place"):
            p["medals"] += 1
        if r["year"]:
            p["years"].add(int(r["year"]))
        p["comps"].add(r["competition_id"])
        for field in ("town", "region", "country", "website", "google", "wid"):
            if not p[field] and r.get(field):
                p[field] = r[field]

    hits = 0
    for key, p in agg.items():
        found = geo.get(key)
        if found:
            town, region, country, lat, lon, src = found
            p["town"] = p["town"] or town
            p["region"] = p["region"] or region
            p["country"] = p["country"] or country
            p["latitude"], p["longitude"], p["geo_source"] = lat, lon, src
            hits += 1
        p["first_year"] = min(p["years"]) if p["years"] else ""
        p["last_year"] = max(p["years"]) if p["years"] else ""
        p["competitions"] = len(p["comps"])

    rows = sorted(agg.values(), key=lambda p: (-p["medals"], p["producer_name"]))
    lib.write_csv(lib.OUT / "producers.csv", rows, FIELDS)
    print(f"producers.csv: {len(rows)} producers, {hits} geocoded ({hits/len(rows):.0%})")
    by_src = collections.Counter(p["geo_source"] for p in rows)
    print("  geo sources:", dict(by_src))


if __name__ == "__main__":
    main()
