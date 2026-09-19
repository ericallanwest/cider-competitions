"""Parse a Concours Général Agricole "Cidres et Poirés" palmarès export.

The CGA serves its palmarès from an API that needs the site's own subscription
key, so the spreadsheet is exported from the browser by hand and registered
with capture.py. This reads that export.

The sheet is one row per medal, five lines of preamble, then a header:

    Raison sociale | Adresse siège | CP | Département | Ville | Concours
    | Catégorie | Section | Couleur médaille | Marques commerciales | ...

Two columns name the producer. `Raison sociale` is the legal entity, "SARL
MICHEL BREAVOINE" or "EARL les Bruyères Carre"; `Marques commerciales` is what
the cider is sold as, "Michel Breavoine". The sheet has always recorded the
trading name, so that is what goes in Medalist, with the legal name carried
alongside for the reviewer to see.

Département is a number. The sheet records French regions by name, so the
numbers are translated through a table of the departments that actually grow
cider, and anything outside it is left empty rather than guessed.
"""
import re
import zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# Only the cider-growing departments, because a wrong region is worse than none.
REGION = {
    "14": "Normandy", "27": "Normandy", "50": "Normandy", "61": "Normandy",
    "76": "Normandy",
    "22": "Brittany", "29": "Brittany", "35": "Brittany", "56": "Brittany",
    "44": "Pays de la Loire", "49": "Pays de la Loire", "53": "Pays de la Loire",
    "72": "Pays de la Loire", "85": "Pays de la Loire",
    "28": "Centre-Val de Loire", "41": "Centre-Val de Loire",
    "59": "Hauts-de-France", "62": "Hauts-de-France", "80": "Hauts-de-France",
}

# The sheet writes the medal as emoji plus the French word.
MEDAL = {"or": "🥇 Or", "argent": "🥈 Argent", "bronze": "🥉 Bronze"}

HEADER = "Raison sociale"


def _sheet(path):
    with zipfile.ZipFile(path) as z:
        shared = ["".join(t.text or "" for t in si.iter(NS + "t"))
                  for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
        body = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for row in body.iter(NS + "row"):
        cells = {}
        for c in row.iter(NS + "c"):
            col = "".join(ch for ch in (c.get("r") or "") if ch.isalpha())
            v = c.find(NS + "v")
            text = "" if v is None else (v.text or "")
            if c.get("t") == "s" and text.isdigit():
                text = shared[int(text)]
            cells[col] = re.sub(r"\s+", " ", text).strip()
        rows.append(cells)
    return rows


def parse(path, year: int, warn=print) -> list[dict]:
    rows = _sheet(path)
    start = next((i for i, r in enumerate(rows) if r.get("A") == HEADER), None)
    if start is None:
        warn("    cga: no 'Raison sociale' header found")
        return []

    out, unknown = [], set()
    for r in rows[start + 1:]:
        legal = r.get("A", "")
        section = r.get("H", "")
        medal_raw = r.get("I", "")
        if not legal or not section or not medal_raw:
            continue
        medal = MEDAL.get(medal_raw.casefold())
        if not medal:
            warn(f"    cga: unknown medal {medal_raw!r} for {legal!r}")
            continue
        dept = r.get("D", "")
        region = REGION.get(dept, "")
        if dept and not region:
            unknown.add(dept)
        # "Marques commerciales déclarées" is a list: "BAYEUX,BAYEUX Signature".
        # The first is the one the cider is sold under.
        trade = r.get("J", "").split(",")[0].strip()
        out.append({
            "Year": year,
            "Style": section,
            "Medal": medal,
            # What the cider is sold as, which is what the sheet records.
            "Medalist": trade or legal,
            "Entry": "",          # the CGA publishes no cider names
            "Region": region,
            "Town": r.get("E", ""),
            "Country": "France",
            # Context for the reviewer, not for the sheet.
            "Legal_name": legal,
            "Department": dept,
            "Website": r.get("K", ""),
        })
    if unknown:
        warn(f"    cga: no region mapped for department(s) {sorted(unknown)} "
             f"- left empty for review")
    return out
