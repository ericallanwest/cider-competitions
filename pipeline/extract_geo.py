"""Extract producer coordinates into data/reference/producers_geo.csv.

Run this locally, on demand. It reads machine-local sources (the World Cider
Map snapshot, the GLINTCAP Tableau extract) and writes a committed reference
file that the rest of the pipeline uses.

That indirection is the point: producers.py must not depend on a path that
exists only on one laptop, or CI rebuilds the data without coordinates.
"""
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib

REFERENCE = lib.ROOT / "data" / "reference" / "producers_geo.csv"

# The map's link columns, in the order the site shows them. Public profile
# URLs only: nothing from Notes, TTB or Google_Place_ID comes near this file.
LINKS = {"website": "Website", "facebook": "Facebook", "instagram": "Instagram",
         "google": "Google", "untappd": "Untappd", "yelp": "Yelp",
         "tripadvisor": "TripAdvisor"}
FIELDS = (["name", "wid", "town", "region", "country", "latitude", "longitude", "source"]
          + list(LINKS))

# Local-only bootstrap source. Absent on CI, which is fine - the committed
# reference file already holds what it produced.
GLINTCAP_XLSX = Path(
    r"C:\Users\Eric\Desktop\Personal\Cider\Competitions\GLINTCAP\2024\Tableau_GLINTCAP_20240508.xlsx"
)


def wid_of(value) -> str:
    """The map's ID as an integer string.

    A numeric cell comes back as "133.0", which then matches nothing: every
    other source writes the ID as "133". Thirteen producers were unreachable
    by ID because of it.
    """
    text = lib.clean(value)
    return re.sub(r"\.0$", "", text)


def read_xlsx(path: Path, sheet_index: int) -> list[dict]:
    """Minimal xlsx reader, so this one bootstrap file needs no openpyxl."""
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


def main() -> None:
    out: dict[str, dict] = {}

    # 1. World Cider Map - the source of truth, once fetch.py has run.
    wcm = lib.SNAPSHOT / "_lookups" / "world-cider-map"
    for path in sorted(wcm.glob("*.csv")) if wcm.exists() else []:
        for r in lib.read_csv(path):
            lat, lon = lib.clean(r.get("Latitude", "")), lib.clean(r.get("Longitude", ""))
            if not (lat and lon):
                continue
            for field in ("Name", "Alternate_Name"):
                name = lib.clean(r.get(field, ""))
                if name and name.casefold() not in out:
                    out[name.casefold()] = {
                        "name": name, "wid": wid_of(r.get("ID", "")),
                        "town": lib.clean(r.get("Town_City", "")),
                        "region": lib.clean(r.get("Region", "")),
                        "country": lib.clean(r.get("Country", "")),
                        "latitude": lat, "longitude": lon, "source": "world_cider_map",
                        **{k: lib.extract_href(r.get(col, "")) or lib.clean(r.get(col, ""))
                           for k, col in LINKS.items()},
                    }

    # 2. GLINTCAP extract - bootstrap for the 710 producers it covers.
    if GLINTCAP_XLSX.exists():
        for r in read_xlsx(GLINTCAP_XLSX, 1):
            name = lib.clean(r.get("Medalist", ""))
            lat, lon = lib.clean(r.get("Latitude", "")), lib.clean(r.get("Longitude", ""))
            if name and lat and lon and name.casefold() not in out:
                out[name.casefold()] = {
                    "name": name, "wid": wid_of(r.get("WID", "")),
                    "town": lib.clean(r.get("City", "")),
                    "region": lib.clean(r.get("Region", "")),
                    "country": lib.clean(r.get("Country", "")),
                    "latitude": lat, "longitude": lon, "source": "glintcap_extract",
                }
    else:
        print(f"  note: {GLINTCAP_XLSX.name} not found - skipping that source")

    if not out:
        sys.exit("No coordinate sources available; refusing to overwrite the reference file.")

    rows = sorted(out.values(), key=lambda r: r["name"].casefold())
    lib.write_csv(REFERENCE, rows, FIELDS)
    linked = sum(1 for r in rows if any(r.get(k) for k in LINKS))
    print(f"producers_geo.csv: {len(rows)} geocoded producers, {linked} with links")


if __name__ == "__main__":
    main()
