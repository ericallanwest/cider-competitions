"""Save a copy of a published results page or PDF under data/source/web/.

Site layouts change and old pages disappear, so every competition-year keeps a
local copy of what the numbers came from. This is the one way pages get saved,
so that data/source/web/manifest.csv stays a complete record of provenance:
which URL, when, how big, and a hash of what came back.

Each competition keeps its own data/source/web/<competition_id>/manifest.csv;
the top-level manifest is rebuilt from those (``--rebuild``), so several
captures can run side by side without clobbering one shared file.

    python pipeline/capture.py <competition_id> <year> <url> [--name results]
                               [--kind official|wayback|press|pdf|export] [--note "..."]

The file lands at data/source/web/<competition_id>/<year>/<name>.<ext>, with
the extension chosen from the Content-Type of the response. Wayback Machine
URLs are rewritten to the raw ``id_`` form so the saved bytes are the original
page rather than the archive's wrapper.

Some results cannot be fetched at all - the Concours General Agricole serves
its palmares from an API that needs the site's own subscription key, so the
spreadsheet has to be exported from the browser by hand. Record one of those
with --register, which hashes the file you already saved instead of fetching:

    python pipeline/capture.py concours-general-agricole 2024 \
        "https://palmares.concours-general-agricole.fr/" \
        --register data/source/web/concours-general-agricole/2024/cidres-poires.xlsx \
        --kind export --note "exported by hand: Produits > Cidres et Poires"

Use --kind to say what the copy is: ``official`` for the competition's own
site, ``wayback`` for an Internet Archive capture of a page that has since
gone, ``press`` for coverage that reproduces the full list, ``pdf`` for a
downloadable results document, and ``export`` for a file a person had to
produce by hand, which no script can reproduce. Nothing here parses the file;
that is parse_source.py's job.
"""
import argparse
import csv
import hashlib
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib

WEB = lib.ROOT / "data" / "source" / "web"
MANIFEST = WEB / "manifest.csv"
FIELDS = ["competition_id", "year", "url", "file", "kind", "fetched_at",
          "http_status", "bytes", "sha256", "content_type", "note"]

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

_WAYBACK = re.compile(r"^(https?://web\.archive\.org/web/)(\d{4,14})(id_|im_|js_|cs_)?/(.+)$")


def wayback_raw(url: str) -> str:
    """https://web.archive.org/web/2019.../https://x -> .../2019...id_/https://x"""
    m = _WAYBACK.match(url)
    if not m:
        return url
    return f"{m.group(1)}{m.group(2)}id_/{m.group(4)}"


def ext_for(content_type: str, url: str) -> str:
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct == "application/pdf" or url.lower().split("?")[0].endswith(".pdf"):
        return "pdf"
    if ct in ("text/html", "application/xhtml+xml", ""):
        return "html"
    if ct == "text/plain":
        return "txt"
    if ct in ("application/json",):
        return "json"
    if ct.startswith("image/"):
        return ct.split("/")[1].replace("jpeg", "jpg")
    if "spreadsheet" in ct or url.lower().endswith(".xlsx"):
        return "xlsx"
    if "msword" in ct or "wordprocessingml" in ct:
        return "docx"
    return "bin"


# Enough to label a file we did not fetch, so --register records the same
# content_type a download would have.
TYPE_FOR_EXT = {
    "html": "text/html", "pdf": "application/pdf", "json": "application/json",
    "txt": "text/plain", "csv": "text/csv",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "png": "image/png", "jpg": "image/jpeg",
}


def fetch(url: str, dest: Path) -> tuple[int, str]:
    """curl the URL to dest. Returns (http_status, content_type)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    headers = dest.with_suffix(dest.suffix + ".headers.tmp")
    cmd = ["curl", "-sSL", "--compressed", "--max-time", "120", "--retry", "2",
           "-A", UA, "-H", "Accept-Language: en,fr,es,de,ja;q=0.8",
           "-D", str(headers), "-o", str(dest), "-w", "%{http_code}", url]
    result = subprocess.run(cmd, capture_output=True, text=True)
    status = int(result.stdout.strip() or 0) if result.stdout.strip().isdigit() else 0
    content_type = ""
    if headers.exists():
        for line in headers.read_text(errors="replace").splitlines():
            if line.lower().startswith("content-type:"):
                content_type = line.split(":", 1)[1].strip()   # last hop wins
        headers.unlink()
    if result.returncode != 0 and status == 0:
        raise RuntimeError(result.stderr.strip() or "curl failed")
    return status, content_type


def _write_sorted(path: Path, rows: list[dict]) -> None:
    rows.sort(key=lambda r: (r["competition_id"], r["year"], r["file"]))
    lib.write_csv(path, rows, FIELDS)


def append_manifest(row: dict) -> None:
    """Record the capture in the competition's own manifest, then rebuild the top one."""
    local = WEB / row["competition_id"] / "manifest.csv"
    rows = lib.read_csv(local) if local.exists() else []
    # One row per file: a re-capture replaces the earlier record.
    rows = [r for r in rows if r["file"] != row["file"]]
    rows.append(row)
    _write_sorted(local, rows)
    rebuild_manifest(prune_local=False)


def rebuild_manifest(prune_local: bool = True) -> list[dict]:
    """Merge every per-competition manifest into data/source/web/manifest.csv.

    Rows whose file no longer exists are dropped, so deleting a bad capture and
    running ``--rebuild`` is enough to forget it.
    """
    by_file: dict[str, dict] = {}
    if MANIFEST.exists():
        for r in lib.read_csv(MANIFEST):
            by_file[r["file"]] = r
    for local in sorted(WEB.glob("*/manifest.csv")):
        for r in lib.read_csv(local):
            by_file[r["file"]] = r
    rows = [r for r in by_file.values() if (lib.ROOT / r["file"]).exists()]
    _write_sorted(MANIFEST, rows)
    if not prune_local:
        # A capture only touches its own competition's file; other captures
        # may be writing theirs at the same moment.
        return rows
    # Keep the per-competition files in step too (drops rows for deleted files).
    for cid in {r["competition_id"] for r in rows} | {p.parent.name for p in WEB.glob("*/manifest.csv")}:
        local = WEB / cid / "manifest.csv"
        mine = [r for r in rows if r["competition_id"] == cid]
        if mine:
            _write_sorted(local, mine)
        elif local.exists():
            local.unlink()
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("competition_id")
    ap.add_argument("year")
    ap.add_argument("url")
    ap.add_argument("--name", default="results", help="file stem (default: results)")
    ap.add_argument("--kind", default="official",
                    choices=["official", "wayback", "press", "pdf", "export"])
    ap.add_argument("--note", default="")
    ap.add_argument("--register", metavar="PATH",
                    help="record a file saved by hand instead of fetching the URL")
    ap.add_argument("--rebuild", action="store_true",
                    help="only rebuild manifest.csv from the per-competition manifests")
    if len(sys.argv) > 1 and sys.argv[1] == "--rebuild":
        rows = rebuild_manifest()
        print(f"  {MANIFEST.relative_to(lib.ROOT)}: {len(rows)} files")
        return
    args = ap.parse_args()

    url = wayback_raw(args.url)
    kind = args.kind
    if url != args.url:
        kind = "wayback"

    folder = WEB / args.competition_id / str(args.year)

    if args.register:
        dest = Path(args.register)
        if not dest.is_absolute():
            dest = lib.ROOT / dest
        if not dest.exists() or dest.stat().st_size == 0:
            sys.exit(f"Nothing to register at {args.register}")
        if dest.parent.resolve() != folder.resolve():
            sys.exit(f"{args.register} is not under {folder.relative_to(lib.ROOT)}")
        ext = dest.suffix.lstrip(".").lower()
        content_type = TYPE_FOR_EXT.get(ext, "")
        status = ""
        # When it was obtained, not when it was recorded.
        fetched_at = datetime.fromtimestamp(dest.stat().st_mtime, timezone.utc)
    else:
        # Fetch to a temp name first: we need the content type to pick the extension.
        tmp = folder / f"{args.name}.download"
        status, content_type = fetch(url, tmp)
        if status >= 400 or not tmp.exists() or tmp.stat().st_size == 0:
            if tmp.exists():
                tmp.unlink()
            sys.exit(f"HTTP {status} for {url}")

        ext = ext_for(content_type, url)
        dest = folder / f"{args.name}.{ext}"
        if dest.exists():
            dest.unlink()
        tmp.rename(dest)
        status = str(status)
        fetched_at = datetime.now(timezone.utc)

    data = dest.read_bytes()
    if ext == "html" and b"<html" not in data[:4096].lower() and b"<!doctype" not in data[:4096].lower():
        print(f"  warning: {dest.name} does not look like HTML", file=sys.stderr)

    row = {
        "competition_id": args.competition_id,
        "year": str(args.year),
        "url": args.url,
        "file": dest.relative_to(lib.ROOT).as_posix(),
        "kind": kind,
        "fetched_at": fetched_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "http_status": status,
        "bytes": str(len(data)),
        "sha256": hashlib.sha256(data).hexdigest(),
        "content_type": content_type.split(";")[0].strip(),
        "note": args.note,
    }
    append_manifest(row)
    print(f"  {row['file']}  ({row['bytes']} bytes, {row['content_type'] or 'unknown type'})")


if __name__ == "__main__":
    main()
