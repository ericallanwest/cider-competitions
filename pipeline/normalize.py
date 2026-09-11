"""Fold every source table into one tidy fact table: data/out/awards.csv.

Grain is one row per award, so compound awards ("BEST IN CLASS + GOLD")
decompose into two rows that share an entry_id.

Region and country values are passed through EXACTLY as authored. They encode
meaningful community designations (Basque Country, Herefordshire, Vale of
Glamorgan, England/Wales/Scotland) and are never folded together here. Spelling
variants are resolved only via crosswalks/countries.csv, which a human edits.
"""
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib

CROSSWALKS = lib.ROOT / "crosswalks"

# Column drift across competitions. First match wins.
PRODUCER_COLS = ("Medalist", "Producer", "Entrant")
SHEET_TABLES = lib.CONFIG / "sheet_tables.csv"
ENTRY_COLS = ("Entry", "Product", "Cider Name")
CATEGORY_COLS = ("Category", "Class", "Style", "Division")
AWARD_COLS = ("Award", "Medal", "Place")
SCORE_COLS = ("Score", "Points")
TOWN_COLS = ("Town", "City")
# Region__2 is the producer's region in Cidercraft (the bare 'Region' is the award region).
REGION_COLS = ("Region__2", "Region", "County", "Department", "State", "Region/Country")
COUNTRY_COLS = ("Country",)

FIELDS = [
    "award_id", "entry_id", "award_seq", "competition_id", "year",
    "wid", "producer_name", "entry_name",
    "award_raw", "award_kind", "medal_level", "special_award",
    "category_raw", "style_group", "score",
    "town", "region", "country", "latitude", "longitude",
    "website", "google", "source_file", "source_row",
]


def load_crosswalk(name: str, key: str) -> dict:
    path = CROSSWALKS / name
    if not path.exists():
        return {}
    return {lib.clean(r[key]).casefold(): r for r in lib.read_csv(path) if lib.clean(r.get(key, ""))}


def digest(*parts) -> str:
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:12]


def resolve_award(raw: str, comp: str, vocab: dict) -> list[dict]:
    """Map a raw award string to one or more normalized awards.

    Lookup order: competition-scoped, then wildcard, then a bare-words fallback
    so an unseen '🥇 GOLD' still resolves via 'gold'. Unknown values pass through
    with award_kind='unmapped' rather than being dropped.
    """
    for probe in (f"{comp}|{raw}".casefold(), raw.casefold(), lib.strip_symbols(raw).casefold()):
        hit = vocab.get(probe)
        if hit:
            break
    else:
        return [{"award_kind": "unmapped", "medal_level": "", "special_award": ""}]

    splits = lib.clean(hit.get("splits_to", ""))
    if splits:
        out = []
        for piece in splits.split("|"):
            out.extend(resolve_award(lib.clean(piece), comp, vocab))
        return out
    return [{
        "award_kind": lib.clean(hit.get("award_kind", "")) or "medal",
        "medal_level": lib.clean(hit.get("medal_level", "")),
        "special_award": lib.clean(hit.get("special_award", "")),
    }]


def map_row(row: dict, comp: str, year, src: str, idx: int, vocab: dict,
            styles: dict, countries: dict, seen: dict) -> list[dict]:
    producer = lib.pick(row, *PRODUCER_COLS)
    if not producer or lib.is_null(producer):
        return []

    award_raw = lib.pick(row, *AWARD_COLS)
    category = lib.pick(row, *CATEGORY_COLS)
    entry = lib.pick(row, *ENTRY_COLS)
    row_year = lib.to_year(row.get("Year", "")) or year

    region = lib.pick(row, *REGION_COLS)
    country = lib.pick(row, *COUNTRY_COLS)
    # Spelling variants only - never a change of designation.
    country = lib.clean(countries.get(country.casefold(), {}).get("canonical", "")) or country

    style_hit = styles.get(category.casefold()) or styles.get(
        lib.clean(row.get("Style_Crosswalk", "")).casefold())
    style_group = lib.clean(style_hit.get("style_group", "")) if style_hit else ""

    # Some competitions publish no entry name (Museum of Cider, Concours General
    # Agricole), so the natural key collides for a producer winning twice in one
    # class. An occurrence ordinal keeps each award distinct without inventing data.
    natural = (comp, row_year, producer, entry, category, award_raw)
    seen[natural] = seen.get(natural, 0) + 1
    entry_id = digest(*natural, seen[natural])
    out = []
    for seq, award in enumerate(resolve_award(award_raw, comp, vocab), start=1):
        out.append({
            "award_id": digest(entry_id, seq), "entry_id": entry_id, "award_seq": seq,
            "competition_id": comp, "year": row_year or "",
            "wid": lib.clean(row.get("WID", "")),
            "producer_name": producer, "entry_name": entry,
            "award_raw": award_raw, **award,
            "category_raw": category, "style_group": style_group or "Unclassified",
            "score": lib.to_float(lib.pick(row, *SCORE_COLS)) or "",
            "town": lib.pick(row, *TOWN_COLS),
            "region": region, "country": country,
            "latitude": lib.clean(row.get("Latitude", "")),
            "longitude": lib.clean(row.get("Longitude", "")),
            "website": lib.extract_href(row.get("Website", "")),
            "google": lib.extract_href(row.get("Google", "")),
            "source_file": src, "source_row": idx,
        })
    return out


def main() -> None:
    vocab = load_crosswalk("award_vocab.csv", "award_raw")
    styles = load_crosswalk("style_map.csv", "category_raw")
    countries = load_crosswalk("countries.csv", "raw")

    awards, missing, seen = [], [], {}
    archive_dir = lib.ARCHIVE / "tablepress-2025-04-17"

    # Google Sheets is the source of truth, so a competition with a snapshot
    # is read from there. The archive is the fallback for anything not yet
    # fetched, plus GLINTCAP 2024 - that sheet stops at 2023.
    sheet_tables = [t for t in lib.read_csv(SHEET_TABLES)
                    if t["status"] == "active"] if SHEET_TABLES.exists() else []
    from_sheets = set()
    for tbl in sheet_tables:
        src, comp = tbl["source_id"], tbl["competition_id"]
        path = lib.SNAPSHOT / src / tbl["tab"]
        if not path.exists():
            missing.append(f"{src}/{tbl['tab']}")
            continue
        from_sheets.add(comp)
        # A fixed year covers one-off result sheets whose tab has no Year column.
        fixed_year = lib.to_year(tbl["year"])
        for idx, row in enumerate(lib.read_csv(path), start=2):
            awards.extend(map_row(row, comp, fixed_year, f"sheet:{src}/{tbl['tab']}",
                                  idx, vocab, styles, countries, seen))

    covered = {(a["competition_id"], a["year"]) for a in awards}
    tables = [t for t in lib.read_csv(lib.CONFIG / "archive_tables.csv") if t["status"] == "active"]
    for tbl in tables:
        comp = tbl["competition_id"]
        matches = sorted(archive_dir.glob(tbl["file_glob"]))
        if not matches:
            missing.append(tbl["file_glob"])
            continue
        year = lib.to_year(tbl["year_from_file"])
        for path in matches:
            for idx, row in enumerate(lib.read_csv(path), start=2):
                mapped = map_row(row, comp, year, path.name, idx,
                                 vocab, styles, countries, seen)
                # Only fill competition-years the sheets do not already cover,
                # so the archive tops up GLINTCAP 2024 without duplicating 2005-2023.
                awards.extend(m for m in mapped
                              if comp not in from_sheets or (comp, m["year"]) not in covered)

    awards.sort(key=lambda r: (r["competition_id"], r["year"] or 0, r["producer_name"], r["award_id"]))
    lib.write_csv(lib.OUT / "awards.csv", awards, FIELDS)

    print(f"awards.csv: {len(awards)} rows "
          f"({len(from_sheets)} competitions from Sheets, rest from archive)")
    if missing:
        print(f"  WARNING: {len(missing)} table globs matched nothing: {missing}", file=sys.stderr)


if __name__ == "__main__":
    main()
