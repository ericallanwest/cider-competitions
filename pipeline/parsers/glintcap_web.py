"""Parse GLINTCAP commercial results pages into grain rows.

The page nests category -> medal tier -> entries:

    <h2>Fruit Cider - Sweet</h2>
    <h3>Gold</h3>
    <p>Eternal Sunshine Pineapple-Mango - Endless Orchard Cider</p>

Entries are "Entry <en dash> Producer" with no location; producers are resolved
later through the World Cider Map, not from this page.

Only the Commercial division is parsed. The published dataset has always been
commercial-only, and the noncommercial results live on a separate page.
"""
import html
import re

# Award tiers, as they appear as <h3>. Anything else at h3 is a category that
# the page mis-tagged - which happens, so it is handled rather than assumed away.
TIERS = {"gold", "silver", "bronze", "best in class", "best-in-class",
         "best in show", "honorable mention"}

SEPARATOR = re.compile(r"\s+[–—]\s+")       # en or em dash with spaces
BLOCK = re.compile(r"<(h1|h2|h3|p|li)[^>]*>(.*?)</\1>", re.S | re.I)


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", fragment))).strip()


ORDER = ["Gold", "Silver", "Bronze"]


def parse(path, year: int, warn=print) -> list[dict]:
    raw = path.read_text(encoding="utf-8", errors="replace")

    # Everything before "Full Results" is Producer of the Year and Best in Show,
    # which are producer-level honours rather than per-entry medals.
    body = raw.split("Full Results", 1)[-1] if "Full Results" in raw else raw

    blocks = []
    for tag, inner in BLOCK.findall(body):
        text = _text(inner)
        if text:
            blocks.append((tag.lower(), text))

    rows, category, tier, pending = [], "", "", []

    def flush(assigned: str) -> None:
        """Emit entries that appeared before any tier heading."""
        for entry, producer in pending:
            rows.append({"Year": year, "Style": category, "Medal": assigned,
                         "Medalist": producer, "Entry": entry})
        pending.clear()

    for i, (tag, text) in enumerate(blocks):
        if tag in ("h2", "h3") and (tag == "h2" or text.casefold() not in TIERS):
            if pending:
                warn(f"    dropped {len(pending)} untiered entries under {category!r}")
                pending.clear()
            category, tier = text, ""
            continue

        if tag == "h3":
            if pending:
                # Some categories omit the heading for their first tier. The
                # tiers always run Gold, Silver, Bronze, so the missing one is
                # whatever sits directly above the next tier that IS labelled.
                nxt = text.strip().title()
                assigned = (ORDER[ORDER.index(nxt) - 1]
                            if nxt in ORDER and ORDER.index(nxt) > 0 else nxt)
                warn(f"    {category!r}: {len(pending)} entries had no tier heading; "
                     f"read as {assigned} (the tier above {nxt})")
                flush(assigned)
            tier = text
            continue

        if tag not in ("p", "li") or not category:
            continue
        parts = SEPARATOR.split(text)
        if len(parts) < 2:
            continue                        # page furniture, not a result
        # Split at the last separator: an entry name may contain a dash, a
        # producer name rarely ends with one.
        entry = SEPARATOR.split(text, maxsplit=len(parts) - 2)[0].strip()
        producer = parts[-1].strip()
        if not entry or not producer:
            continue
        if tier:
            rows.append({"Year": year, "Style": category, "Medal": tier,
                         "Medalist": producer, "Entry": entry})
        else:
            pending.append((entry, producer))

    if pending:
        warn(f"    dropped {len(pending)} untiered entries at end of {category!r}")
    return rows
