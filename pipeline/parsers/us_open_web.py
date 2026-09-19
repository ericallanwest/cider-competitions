"""Parse U.S. Open Cider Championship medal-winner pages.

Each category is one paragraph: a bold heading, then one <br>-separated line
per medal.

    <p><strong>Modern Cider - Sweet<br /></strong>
    GOLD: McKenzie's Original - FX Matt Brewing Co. - New York<br />
    SILVER: Premium Apple Cider - Thornbury Craft Co. - Ontario</p>

Lines run "TIER: Entry - Producer - Region", all with en dashes. Region is a
US state or Canadian province, which is the designation the competition
publishes; it is passed through rather than resolved to a country here.

The page sometimes drops a dash, leaving "Cranberry Spice Six Byrd Cider -
Arizona" where the producer has run into the cider name. A naive split reads
the state as the producer, which is how Arizona and Wisconsin came to be
listed as cideries. Producers seen on well-formed lines are collected first,
so a short line can be cut at the producer it ends with.
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


def _split(parts: list[str], known: list[str]) -> tuple[str, str, str]:
    """(entry, producer, region) from a line's dash-separated parts."""
    if len(parts) >= 3:
        # Entry names occasionally contain a dash; producers rarely do.
        return " – ".join(parts[:-2]), parts[-2], parts[-1]
    # Two parts: the producer's dash is missing, so the trailing field is the
    # region and the producer is still inside the first. Cut it at the longest
    # producer this page has shown elsewhere.
    head = parts[0].strip()
    for producer in known:
        if len(head) > len(producer) and head.casefold().endswith(producer.casefold()):
            return head[: -len(producer)].strip(" –-"), head[-len(producer):], parts[1]
    return head, parts[1], ""


def parse(path, year: int, warn=print) -> list[dict]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    rows = []
    # Producers from lines that kept all their dashes, longest first so
    # "Ciderboys Hard Cider" is preferred over "Ciderboys".
    known: list[str] = []

    for para in PARA.findall(raw):
        if not HAS_TIER.search(_text(para)):
            continue
        for chunk in re.split(r"<br\s*/?>", STRONG.sub("", para, count=1), flags=re.I):
            hit = TIER.match(_text(chunk))
            if not hit:
                continue
            parts = DASH.split(hit.group(2).strip())
            if len(parts) >= 3 and parts[-2].strip():
                known.append(parts[-2].strip())
    known = sorted(set(known), key=len, reverse=True)

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
            entry, producer, region = _split(parts, known)
            if len(parts) == 2:
                warn(f"    missing dash, read as {producer!r} in {region or '?'}: {line[:64]}")

            rows.append({
                "Year": year, "Style": category, "Medal": tier,
                "Medalist": producer.strip(), "Entry": entry.strip(),
                "Region": region.strip(),
            })
    return rows
