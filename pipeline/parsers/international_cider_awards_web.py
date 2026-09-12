"""Parse International Cider Awards medal tables.

Results are HTML tables, one row per medal:

    <tr><td>Tannin Driven Cider 1.1 -GOLD</td><td>Kingston Black SV</td>
        <td>Bauman's Cider</td><td>Gervais, OR</td><td>USA</td></tr>

The first cell carries both class and medal, joined by a dash whose spacing is
inconsistent ("1.1 -GOLD", "1.1 - SILVER"). Country is published separately
from Location, so both are kept: Location becomes town/region, Country stays
as the competition wrote it.
"""
import html
import re

MEDALS = {"gold", "silver", "bronze", "trophy", "champion",
          "best in class", "highly commended", "commended"}

ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
CELL = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S | re.I)
# Trailing "1.1", "2.3b" etc is an entry-class number, not part of the style.
CLASS_NUM = re.compile(r"\s*\d+(?:\.\d+)?[a-z]?\s*$", re.I)


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", fragment))).strip()


def _split_class_medal(cell: str) -> tuple[str, str]:
    """'Tannin Driven Cider 1.1 -GOLD' -> ('Tannin Driven Cider', 'Gold')."""
    for part in reversed(re.split(r"[–—-]", cell)):
        candidate = part.strip()
        if candidate.casefold() in MEDALS:
            style = cell[: cell.rfind(part)].rstrip(" –—-")
            return CLASS_NUM.sub("", style).strip(), candidate.title()
    return "", ""


def parse(path, year: int, warn=print) -> list[dict]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    rows = []

    for row_html in ROW.findall(raw):
        cells = [_text(c) for c in CELL.findall(row_html)]
        if len(cells) < 3:
            continue
        style, medal = _split_class_medal(cells[0])
        # A style is required, not just a medal. The trophy table's header row
        # is literally "Trophy | Brewery / Cider Mill | Sponsor", which matches
        # a medal name on its own; demanding a class alongside it rules that out.
        if not medal or not style:
            continue

        entry, producer = cells[1], cells[2]
        location = cells[3] if len(cells) > 3 else ""
        country = cells[4] if len(cells) > 4 else ""
        if not producer:
            continue

        town, region = "", ""
        if location:
            parts = [p.strip() for p in location.split(",") if p.strip()]
            if len(parts) >= 2:
                town, region = parts[0], parts[-1]
            else:
                town = parts[0] if parts else ""

        rows.append({"Year": year, "Style": style, "Medal": medal,
                     "Medalist": producer, "Entry": entry,
                     "Town": town, "Region": region, "Country": country})
    return rows
