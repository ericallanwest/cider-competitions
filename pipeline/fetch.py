"""Pull every competition sheet from Google Drive into data/snapshot/.

Google Sheets is the authoring surface; this is the only step that touches it,
and it is strictly read-only.

Auth: a Google service account with read access to the competition sheets.
Point GOOGLE_APPLICATION_CREDENTIALS (or --key) at its JSON key. In CI the key
comes from the GCP_SA_KEY secret.

    python pipeline/fetch.py                 # all active sources
    python pipeline/fetch.py --only glintcap
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib


def open_client(key_path: str | None):
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        sys.exit("Missing deps. Run: pip install -r requirements.txt")

    key_path = key_path or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if key_path and Path(key_path).exists():
        creds = Credentials.from_service_account_file(
            key_path, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
        )
    elif os.environ.get("GCP_SA_KEY"):
        creds = Credentials.from_service_account_info(
            json.loads(os.environ["GCP_SA_KEY"]),
            scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
        )
    else:
        sys.exit(
            "No credentials. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account\n"
            "JSON key with read access to the competition sheets, or pass --key."
        )
    return gspread.authorize(creds)


def dump_sheet(client, sheet_id: str, dest_dir: Path) -> list[str]:
    """Write every worksheet tab to its own CSV. Values only, as displayed."""
    book = client.open_by_key(sheet_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for ws in book.worksheets():
        rows = ws.get_all_values()
        if not rows or not any(any(c.strip() for c in r) for r in rows):
            continue
        safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in ws.title).strip()
        path = dest_dir / f"{safe or 'sheet'}.csv"
        width = max(len(r) for r in rows)
        header = [c.strip() or f"col{i}" for i, c in enumerate(rows[0] + [""] * (width - len(rows[0])))]
        body = [dict(zip(header, r + [""] * (width - len(r)))) for r in rows[1:]]
        lib.write_csv(path, body, header)
        written.append(f"{ws.title} ({len(body)} rows)")
    return written


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", help="path to service-account JSON key")
    ap.add_argument("--only", help="fetch a single competition_id")
    args = ap.parse_args()

    sources = lib.read_csv(lib.CONFIG / "sources.csv")
    lookups = lib.read_csv(lib.CONFIG / "lookups.csv")
    client = open_client(args.key)

    targets = [s for s in sources if s["status"] == "active"]
    if args.only:
        targets = [s for s in sources if s["competition_id"] == args.only]
        if not targets:
            sys.exit(f"No source with competition_id={args.only!r}")

    for src in targets:
        dest = lib.SNAPSHOT / src["competition_id"]
        try:
            tabs = dump_sheet(client, src["sheet_id"], dest)
            print(f"  {src['competition_id']}: {len(tabs)} tabs")
        except Exception as exc:  # noqa: BLE001 - report and continue
            print(f"  {src['competition_id']}: FAILED - {exc}", file=sys.stderr)

    if not args.only:
        for lk in lookups:
            dest = lib.SNAPSHOT / "_lookups" / lk["lookup"]
            try:
                tabs = dump_sheet(client, lk["sheet_id"], dest)
                print(f"  {lk['lookup']}: {len(tabs)} tabs")
            except Exception as exc:  # noqa: BLE001
                print(f"  {lk['lookup']}: FAILED - {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
