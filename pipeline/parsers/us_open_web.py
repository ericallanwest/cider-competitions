"""Parse U.S. Open Cider Championship medal-winner pages.

Each category is one paragraph: a bold heading, then one <br>-separated line
per medal.

    <p><strong>Modern Cider - Sweet<br /></strong>
    GOLD: McKenzie's Original - FX Matt Brewing Co. - New York<br />
    SILVER: Premium Apple Cider - Thornbury Craft Co. - Ontario</p>

Lines run "TIER: Entry - Producer - Region", all with en dashes. Region is a
US state or Canadian province, which is the designation the competition
publishes; it is passed through rather than resolved to a country here.
"""
import html
import re

TIER = re.compile(r"^(GOLD|SILVER|BRONZE|BEST IN SHOW|HONORABLE MENTION)\s*:\s*(.+)$",
                  re.I)
# Unanchored, for deciding whether a paragraph holds results at all: the
# paragraph text begins with the category, not with a tier.
HAS_TIER = re.compile(r"\b(GOLD|SILVER|BRONZE|BEST IN SHOW|HONORABLE MENTION)\s*:", re.I)
DASH = re.compile(r"\s+[–—]\s+")
PARA = re.compile(r"<p[^>]*>(.*?)</p>", re.S | re.I)
STRONG = re.compile(r"<strong[^>]*>(.*?)</strong>", re.S | re.I)


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", fragment))).strip()


def parse(path, year: int, warn=print) -> list[dict]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    rows = []

    for para in PARA.findall(raw):
        if not HAS_TIER.search(_text(para)):
            continue                                  # prose, not results

        bold = STRONG.search(para)
        category = _text(bold.group(1)) if bold else ""
        if not category:
            continue

        # Strip the heading so it cannot be mistaken for a medal line.
        remainder = STRONG.sub("", para, count=1)
        for chunk in re.split(r"<br\s*/?>", remainder, flags=re.I):
            line = _text(chunk)
            hit = TIER.match(line)
            if not hit:
                continue
            tier, rest = hit.group(1).title(), hit.group(2).strip()

            parts = DASH.split(rest)
            if len(parts) < 2:
                warn(f"    unparsed line under {category!r}: {line[:70]}")
                continue
            # Trailing field is the region when there are three or more parts;
            # entry names occasionally contain a dash, producers rarely do.
            if len(parts) >= 3:
                entry, producer, region = " – ".join(parts[:-2]), parts[-2], parts[-1]
            else:
                entry, producer, region = parts[0], parts[1], ""

            rows.append({
                "Year": year, "Style": category, "Medal": tier,
                "Medalist": producer.strip(), "Entry": entry.strip(),
                "Region": region.strip(),
            })
    return rows
