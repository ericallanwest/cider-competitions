"""Build data/out/producers.csv - one row per producer, with coordinates where known.

Coordinate sources, in precedence order:
  1. data/snapshot/_lookups/world-cider-map/  (source of truth; needs fetch.py)
  2. the GLINTCAP Tableau extract on disk      (710 producers, used to bootstrap)

Producers with no coordinates are still emitted - they appear in tables and
counts, they just get no map pin. Nothing is invented.
"""
import collections
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib

GLINTCAP_XLSX = Path(
    r"C:\Users\Eric\Desktop\Personal\Cider\Competitions\GLINTCAP\2024\Tableau_GLINTCAP_20240508.xlsx"
)
FIELDS = ["producer_id", "producer_name", "wid", "awards", "medals",
          "first_year", "last_year", "competitions",
          "town", "region", "country", "latitude", "longitude", "geo_source",
          "website", "google"]


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", lib.clean(name).casefold()).strip("-")
    return s or "unknown"


def read_xlsx(path: Path, sheet_index: int) -> list[dict]:
    """Minimal xlsx reader - avoids an openpyxl dependency for one bootstrap file."""
    if not path.exists():
        return []
    with zipfile.ZipFile(path) as z:
        shared = [
            "".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S))
            for si in re.findall(r"<si>(.*?)</si>",
                                 z.read("xl/sharedStrings.xml").decode("utf-8", "replace"), re.S)
        ]
        data = z.read(f"xl/worksheets/sheet{sheet_index}.xml").decode("utf-8", "replace")

    def cells(row_xml):
        out = []
        for m in re.finditer(r"<c\b([^>]*)>(.*?)</c>|<c\b([^>]*)/>", row_xml, re.S):
            attrs = m.group(1) or m.group(3) or ""
            body = m.group(2) or ""
            v = re.search(r"<v>(.*?)</v>", body, re.S)
            val = v.group(1) if v else ""
            if 't="s"' in attrs and val != "":
                val = shared[int(val)]
            out.append(lib.clean(val))
        return out

    rows = re.findall(r"<row[^>]*>(.*?)</row>", data, re.S)
    if not rows:
        return []
    header = cells(rows[0])
    return [dict(zip(header, cells(r))) for r in rows[1:]]


def load_geo() -> dict:
    """name.casefold() -> (town, region, country, lat, lon, source)"""
    geo = {}
    wcm_dir = lib.SNAPSHOT / "_lookups" / "world-cider-map"
    for path in sorted(wcm_dir.glob("*.csv")) if wcm_dir.exists() else []:
        for r in lib.read_csv(path):
            name, lat, lon = lib.clean(r.get("Name", "")), lib.clean(r.get("Latitude", "")), lib.clean(r.get("Longitude", ""))
            if name and lat and lon:
                geo.setdefault(name.casefold(), (
                    lib.clean(r.get("Town_City", "")), lib.clean(r.get("Region", "")),
                    lib.clean(r.get("Country", "")), lat, lon, "world_cider_map"))
        for r in lib.read_csv(path):  # alternate names, lower precedence
            alt = lib.clean(r.get("Alternate_Name", ""))
            lat, lon = lib.clean(r.get("Latitude", "")), lib.clean(r.get("Longitude", ""))
            if alt and lat and lon:
                geo.setdefault(alt.casefold(), (
                    lib.clean(r.get("Town_City", "")), lib.clean(r.get("Region", "")),
                    lib.clean(r.get("Country", "")), lat, lon, "world_cider_map"))

    for r in read_xlsx(GLINTCAP_XLSX, 1):
        name = lib.clean(r.get("Medalist", ""))
        lat, lon = lib.clean(r.get("Latitude", "")), lib.clean(r.get("Longitude", ""))
        if name and lat and lon:
            geo.setdefault(name.casefold(), (
                lib.clean(r.get("City", "")), lib.clean(r.get("Region", "")),
                lib.clean(r.get("Country", "")), lat, lon, "glintcap_extract"))
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
