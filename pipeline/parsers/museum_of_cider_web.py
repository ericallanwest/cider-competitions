"""Parse the Museum of Cider International Cider & Perry Competition results.

    <p><strong>Class 1 - Dry Cider</strong></p>
    <p>First<br />Pips Cider, Dorstone, Herefordshire</p>
    <p>Second<br />Robin Bornoff, Ross-on-Wye, Herefordshire</p>

This competition publishes no entry name, only the producer and where they
are - which is exactly what its sheet records, so Entry stays empty rather
than being invented.

Placings are First/Second/Third, not medals. They are passed through as
published; award_vocab.csv maps them to award_kind "place".
"""
import html
import re

PLACES = {"first", "second", "third", "highly commended", "commended",
          "overall champion", "reserve champion"}

BLOCK = re.compile(r"<p[^>]*>(.*?)</p>", re.S | re.I)
STRONG = re.compile(r"<strong[^>]*>(.*?)</strong>", re.S | re.I)
BR = re.compile(r"<br\s*/?>", re.I)
# "Class 1 - Dry Cider" -> "Dry Cider"; the number is ordering, not a style.
CLASS_PREFIX = re.compile(r"^class\s*\d+\s*[–—-]\s*", re.I)


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", fragment))).strip()


def parse(path, year: int, warn=print) -> list[dict]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    rows, category = [], ""

    for inner in BLOCK.findall(raw):
        bold = STRONG.search(inner)
        if bold:
            label = _text(bold.group(1)).rstrip(":")
            if CLASS_PREFIX.search(label) or label.lower().startswith("class"):
                category = CLASS_PREFIX.sub("", label).strip()
                continue
            # Overall Champion and similar sit outside the per-class listing.
            if label.lower() in PLACES or "champion" in label.lower():
                continue

        lines = [_text(part) for part in BR.split(inner)]
        lines = [ln for ln in lines if ln]
        if len(lines) < 2 or not category:
            continue
        place, who = lines[0].rstrip(":").strip(), lines[1]
        if place.casefold() not in PLACES:
            continue

        parts = [p.strip() for p in who.split(",") if p.strip()]
        if not parts:
            continue
        producer = parts[0]
        town = parts[1] if len(parts) >= 3 else ""
        region = parts[-1] if len(parts) >= 2 else ""

        rows.append({"Year": year, "Style": category, "Medal": place.title(),
                     "Medalist": producer, "Entry": "",
                     "Town": town, "Region": region})
    return rows
