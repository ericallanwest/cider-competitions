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
ALIASES = lib.ROOT / "crosswalks" / "producer_aliases.csv"
COUNTRIES = lib.ROOT / "crosswalks" / "countries.csv"
FIELDS = ["producer_id", "producer_name", "wid", "awards", "medals",
          "first_year", "last_year", "competitions",
          "town", "region", "country", "latitude", "longitude", "geo_source",
          "website", "google"]


def match_key(name: str) -> str:
    """Lookup key that ignores typographic variation only.

    Curly and straight apostrophes are the same character to a reader, and
    differ constantly between sources ("Oliver's" vs "Oliver’s"). Folding them
    here fixes the join without touching the authored name, which is still
    what gets displayed and written to awards.csv.
    """
    text = lib.clean(name)
    for ch in "‘’ʼ´`":
        text = text.replace(ch, "'")
    return text.replace("“", '"').replace("”", '"').casefold()


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", lib.clean(name).casefold()).strip("-")
    return s or "unknown"


def load_countries() -> dict:
    """Spelling variants of one designation only. Never merges designations."""
    if not COUNTRIES.exists():
        return {}
    return {lib.clean(r["raw"]).casefold(): lib.clean(r["canonical"])
            for r in lib.read_csv(COUNTRIES) if lib.clean(r.get("raw", ""))}


def load_geo() -> tuple[dict, dict]:
    """Returns (by_name, by_wid), each -> (town, region, country, lat, lon, source)."""
    by_name, by_wid = {}, {}
    if not REFERENCE.exists():
        print(f"  note: {REFERENCE.name} missing - no coordinates will be attached")
        return by_name, by_wid
    countries = load_countries()
    for r in lib.read_csv(REFERENCE):
        country = lib.clean(r["country"])
        country = countries.get(country.casefold(), country)
        entry = (lib.clean(r["town"]), lib.clean(r["region"]), country,
                 lib.clean(r["latitude"]), lib.clean(r["longitude"]), lib.clean(r["source"]))
        name, wid = lib.clean(r["name"]), lib.clean(r["wid"])
        if name:
            by_name.setdefault(match_key(name), entry)
        if wid:
            by_wid.setdefault(wid, entry)
    return by_name, by_wid


def load_aliases() -> dict:
    """Hand-confirmed producer -> World Cider Map ID. Decided once, kept forever."""
    if not ALIASES.exists():
        return {}
    return {match_key(r["producer_name"]): lib.clean(r["wid"])
            for r in lib.read_csv(ALIASES) if lib.clean(r.get("wid", ""))}


def main() -> None:
    awards = lib.read_csv(lib.OUT / "awards.csv")
    geo, geo_by_wid = load_geo()
    aliases = load_aliases()

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
        # A confirmed alias wins over the name match it was created to fix.
        # Prefer the World Cider Map ID the competition sheets carry: it is an
        # explicit identity decision, where a name match is only an inference.
        # 'X' is the deliberate sentinel for entrants that are not in the map.
        mkey = match_key(p["producer_name"])
        alias_wid = aliases.get(mkey)
        own_wid = p["wid"] if p["wid"] and p["wid"].upper() != "X" else ""
        found = None
        for candidate in (alias_wid, own_wid):
            if candidate and candidate in geo_by_wid:
                found = geo_by_wid[candidate]
                p["wid"] = candidate
                break
        found = found or geo.get(mkey)
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
