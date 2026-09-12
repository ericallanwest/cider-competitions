"""Parse Cidercraft Awards results as published by Sip Magazine.

Each category is an <h2>, then one paragraph per winner:

    <h2>Modern-Dry</h2>
    <p><strong>PLATINUM</strong><br>Platinum Elevation
       <br>CIDERY | Snow Capped Cider<br>Cedaredge, CO</p>

A paragraph with no bold heading continues the tier above it - that is how
JUDGES' PICKS lists its runners-up, so the tier carries forward rather than
resetting.

Location is "City, ST". The state is kept in Region as published; it is not
expanded to a country here.
"""
import html
import re

# Compared against _tier_base(), so qualifiers like "- TIE" are already gone.
TIERS = {"platinum", "double gold", "gold", "silver", "bronze",
         "judges' picks", "judges' pick", "best in show", "honorable mention"}

BLOCK = re.compile(r"<(h1|h2|h3|h4|p)[^>]*>(.*?)</\1>", re.S | re.I)
STRONG = re.compile(r"<strong[^>]*>(.*?)</strong>", re.S | re.I)
BR = re.compile(r"<br\s*/?>", re.I)


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", fragment))).strip()


def _tier_base(label: str) -> str:
    """Strip qualifiers so a tier is recognised however it is announced.

    Ties are published as "SILVER - TIE". Without this the label reads as an
    entry name and the real winner silently inherits the tier above it.
    """
    text = label.replace("’", "'")
    text = re.split(r"\s*[–—-]\s*|\s*\(", text, maxsplit=1)[0]
    return text.strip().casefold()


def _singularise(tier: str) -> str:
    """JUDGES' PICKS labels a group; each row is one Judges' Pick."""
    cleaned = _tier_base(tier).title()
    return "Judges' Pick" if cleaned.startswith("Judges' Pick") else cleaned


def parse(path, year: int, warn=print) -> list[dict]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    rows, category, tier = [], "", ""

    for tag, inner in BLOCK.findall(raw):
        tag = tag.lower()
        if tag.startswith("h"):
            text = _text(inner)
            if not text:
                continue
            # The layout moves between years. In 2026 the tier is bold inside
            # the winner's paragraph and headings are categories; in 2025 the
            # tier is its own <h3> and the category is an <h1>. Deciding by
            # content rather than tag level handles both.
            if _tier_base(text) in TIERS:
                tier = _singularise(text)
            else:
                category, tier = text, ""
            continue

        if not category:
            continue

        bold = STRONG.search(inner)
        if bold and _tier_base(_text(bold.group(1))) in TIERS:
            tier = _singularise(_text(bold.group(1)))
            inner = STRONG.sub("", inner, count=1)
        if not tier:
            continue

        lines = [_text(part) for part in BR.split(inner)]
        lines = [ln for ln in lines if ln]
        producer = next((ln.split("|", 1)[1].strip()
                         for ln in lines if ln.upper().startswith("CIDERY")), "")
        if not producer:
            continue                       # prose paragraph, not a winner

        entry = next((ln for ln in lines if not ln.upper().startswith("CIDERY")), "")
        after = [ln for ln in lines if not ln.upper().startswith("CIDERY") and ln != entry]
        town, region = "", ""
        if after:
            place = after[-1]
            if "," in place:
                town, region = (p.strip() for p in place.rsplit(",", 1))
            else:
                region = place

        if entry:
            rows.append({"Year": year, "Style": category, "Medal": tier,
                         "Medalist": producer, "Entry": entry,
                         "Town": town, "Region": region})
    return rows
