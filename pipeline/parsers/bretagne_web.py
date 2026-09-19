"""Parse the Concours Régional Cidricole de Bretagne palmarès.

Two shapes appear on the same page. Either the medal and winner share a line:

    <p><strong>CIDRE AOP CORNOUAILLE</strong></p>
    <p>OR :   Cidrerie Melenig (29)</p>

or the medal stands alone and its winners follow until the next label:

    <p>OR :</p>
    <p>Cidrerie Pere Cidreur (44)</p>
    <p>Cidrerie de Rozavern (29)</p>

The bracketed number is the French departement, which the Bretagne sheet keeps
in its own column, so it is split out rather than left in the producer name.

No entry names are published - only producers - which is what this
competition's sheet has always recorded.
"""
import html
import re
import unicodedata

# French medal words. award_vocab.csv maps OR/ARGENT to gold/silver.
MEDALS = {"or", "argent", "bronze", "mention", "coup de coeur", "coup de cœur"}

PARA = re.compile(r"<p[^>]*>(.*?)</p>", re.S | re.I)
STRONG = re.compile(r"<strong[^>]*>(.*?)</strong>", re.S | re.I)
DEPT = re.compile(r"\(\s*(\d{2,3})\s*\)\s*$")
LABEL = re.compile(r"^\s*([A-Za-zÀ-ÿ' ]+?)\s*:\s*(.*)$")

# Page furniture that is bold but is not a category.
NOT_CATEGORY = ("palmarès", "palmares", "retrouvez", "édition", "edition",
                "concours", "félicitations", "felicitations")


def _text(fragment: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", fragment))
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def _despan(text: str) -> str:
    """Drop emoji decoration from a label.

    2025 writes the medal as "OR 🥇:" and 2026 as "OR :". Stripping symbols
    lets one pattern read both.
    """
    kept = [c for c in text if unicodedata.category(c) not in {"So", "Sk", "Cf"}]
    return re.sub(r"\s+", " ", "".join(kept)).strip()


def _producer(raw: str) -> tuple[str, str]:
    """'Cidrerie Melenig (29)' -> ('Cidrerie Melenig', '29')."""
    text = raw.strip(" .;,")
    dept = ""
    hit = DEPT.search(text)
    if hit:
        dept = hit.group(1)
        text = text[: hit.start()].strip()
    return text, dept


# The palmarès lives in the post body. Everything after it - the cookie
# banner most of all - is still paragraphs, and this parser carries the last
# category and medal forward until the next heading, so an unbounded walk
# happily recorded "Nous utilisons des cookies..." as a silver medallist in
# apple juice. Four such rows reached the published dataset.
CONTENT = re.compile(r'<div[^>]+class="[^"]*entry-content[^"]*"[^>]*>(.*)', re.S | re.I)
CONTENT_END = re.compile(r"</article|<aside|<footer|class=\"[^\"]*(?:gdpr|cookie)", re.I)


def _body(raw: str, warn) -> str:
    """The post body alone, so page furniture cannot be read as results."""
    hit = CONTENT.search(raw)
    if not hit:
        warn("  bretagne: no entry-content found; reading the whole page")
        return raw
    rest = hit.group(1)
    stop = CONTENT_END.search(rest)
    return rest[: stop.start()] if stop else rest


def parse(path, year: int, warn=print) -> list[dict]:
    raw = _body(path.read_text(encoding="utf-8", errors="replace"), warn)
    rows, category, medal = [], "", ""

    for inner in PARA.findall(raw):
        text = _text(inner)
        if not text:
            continue

        # 2025 sometimes wraps a category in two <strong> tags where the first
        # is only whitespace, so take every bold run rather than just the first.
        bold_text = _despan(_text(" ".join(STRONG.findall(inner))))
        if bold_text and bold_text.casefold().rstrip(" :") not in MEDALS:
            if any(word in bold_text.casefold() for word in NOT_CATEGORY):
                continue
            category, medal = bold_text.rstrip(" :"), ""
            continue

        if not category:
            continue

        hit = LABEL.match(_despan(text))
        if hit and hit.group(1).casefold() in MEDALS:
            medal = hit.group(1).upper()
            trailing = hit.group(2).strip()
            if not trailing:
                continue                       # winners follow on later lines
            text = trailing

        if not medal:
            continue
        name, dept = _producer(text)
        if not name or name.casefold() in MEDALS:
            continue
        rows.append({"Year": year, "Style": category, "Medal": medal,
                     "Medalist": name, "Entry": "", "Region": dept})
    return rows
