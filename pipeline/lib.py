"""Shared helpers. Deliberately dependency-light: stdlib only."""
import csv
import html
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config"
SNAPSHOT = ROOT / "data" / "snapshot"
OUT = ROOT / "data" / "out"
ARCHIVE = ROOT / "archive"
REPORTS = ROOT / "reports"

# Values used across sources to mean "nothing here".
NULL_SENTINELS = {"", "-", "--", "---", "n/a", "N/A", "na", "none", "null", "X-"}

_ANCHOR = re.compile(r"<a\b[^>]*>(.*?)</a>", re.I | re.S)
_HREF = re.compile(r'href=["\']([^"\']+)["\']', re.I)
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")

# Emoji and other symbol codepoints that decorate award values.
_SYMBOL_CATS = {"So", "Sk", "Cf"}


def strip_html(value: str) -> str:
    """Anchor text survives; tags do not. '<a href=..>2024</a>' -> '2024'."""
    if not value:
        return ""
    text = _ANCHOR.sub(r"\1", value)
    text = _TAG.sub("", text)
    return html.unescape(text)


def extract_href(value: str) -> str:
    """Pull the URL out of an anchor cell, or pass through a bare URL."""
    if not value:
        return ""
    m = _HREF.search(value)
    if m:
        return html.unescape(m.group(1)).strip()
    bare = strip_html(value).strip()
    return bare if bare.startswith(("http://", "https://")) else ""


def clean(value) -> str:
    """Normalize whitespace and unicode form. Does NOT alter meaning."""
    if value is None:
        return ""
    text = strip_html(str(value))
    text = unicodedata.normalize("NFKC", text)
    text = text.replace(" ", " ")
    return _WS.sub(" ", text).strip()


def is_null(value: str) -> bool:
    return clean(value).lower() in {s.lower() for s in NULL_SENTINELS}


def strip_symbols(value: str) -> str:
    """Drop emoji/symbol decoration, keeping the words. '🥇 Gold' -> 'Gold'."""
    text = clean(value)
    kept = [c for c in text if unicodedata.category(c) not in _SYMBOL_CATS]
    return _WS.sub(" ", "".join(kept)).strip(" -–—:")


def symbols_of(value: str) -> str:
    """The inverse: just the decoration, for the display column."""
    text = clean(value)
    return "".join(c for c in text if unicodedata.category(c) in _SYMBOL_CATS).strip()


def to_year(value) -> int | None:
    """'2024', '2024.0', '<a ..>2024</a>' -> 2024. Anything else -> None."""
    text = clean(value)
    if not text:
        return None
    m = re.search(r"(19|20)\d{2}", text)
    return int(m.group(0)) if m else None


def to_float(value):
    text = clean(value).replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def read_csv(path: Path) -> list[dict]:
    """Read a CSV, tolerating a BOM and duplicate column names.

    Duplicate headers (Cidercraft ships two 'Region' columns) are suffixed
    positionally as 'Region', 'Region__2' rather than silently collapsed.
    """
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        try:
            header = next(reader)
        except StopIteration:
            return []
        seen, cols = {}, []
        for name in header:
            name = clean(name) or "col"
            seen[name] = seen.get(name, 0) + 1
            cols.append(name if seen[name] == 1 else f"{name}__{seen[name]}")
        return [dict(zip(cols, row + [""] * (len(cols) - len(row)))) for row in reader]


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def pick(row: dict, *names: str) -> str:
    """First meaningful value among candidate column names. Handles column drift.

    Null sentinels ('--', '---', 'N/A') are treated as absent, so they never
    reach the output as if they were real values.
    """
    for name in names:
        if name in row:
            value = clean(row[name])
            if value and not is_null(value):
                return value
    return ""
