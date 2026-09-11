"""Pull every competition sheet from Google Drive into data/snapshot/.

Google Sheets is the authoring surface; this is the only step that touches it,
and it is strictly read-only.

Auth, in the order tried:

  1. Application Default Credentials - nothing to download or store. Run once:

       gcloud auth application-default login --scopes=<cloud-platform>,<drive.readonly>,<spreadsheets.readonly>

     (the full command is printed if no credentials are found). This
     authenticates as you, so every sheet you can already open works and
     nothing needs sharing with a service account.

  2. A service-account JSON key, via --key or GOOGLE_APPLICATION_CREDENTIALS.
     That account needs Viewer on each sheet.

  3. GCP_SA_KEY holding the key's JSON, for non-interactive runs.

This never runs in CI - CI rebuilds from the committed snapshot instead.

    python pipeline/fetch.py                 # all active sources + lookups
    python pipeline/fetch.py --only glintcap
    python pipeline/fetch.py --lookups-only  # just the World Cider Map
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib

SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
]

# gcloud refuses an ADC login that omits cloud-platform, so the login command
# asks for it too even though only the two read-only scopes above get used.
LOGIN_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"] + SCOPES

LOGIN_HINT = (
    "No credentials found.\n\n"
    "Run this once - it opens a browser and stores nothing in this repo:\n\n"
    "  gcloud auth application-default login --scopes=" + ",".join(LOGIN_SCOPES) + "\n\n"
    "Or point at a service-account key:\n\n"
    "  python pipeline/fetch.py --key path/to/key.json"
)


def _gcloud_token(impersonate: str) -> str:
    """Mint an impersonated access token with the gcloud CLI.

    Used when there are no Application Default Credentials but gcloud itself
    is logged in - which is the common case on a workstation.
    """
    import shutil
    import subprocess

    exe = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if not exe:
        sys.exit("No ADC and no gcloud on PATH. See --help for auth options.")
    proc = subprocess.run(
        [exe, "auth", "print-access-token",
         f"--impersonate-service-account={impersonate}",
         f"--scopes={','.join(SCOPES)}"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"gcloud could not mint a token for {impersonate}:\n{proc.stderr.strip()}")
    return proc.stdout.strip()


def open_client(key_path: str | None, impersonate: str | None = None):
    try:
        import google.auth
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        sys.exit("Missing deps. Run: pip install -r requirements.txt")

    if impersonate:
        # Short-lived token minted from your own gcloud login. Nothing is
        # stored, and because the Drive/Sheets scopes are requested on the
        # impersonated token rather than gcloud's default client ID, this is
        # unaffected by that client losing those scopes.
        from google.auth import impersonated_credentials
        from google.oauth2.credentials import Credentials as TokenCredentials
        try:
            source, _ = google.auth.default()
            creds = impersonated_credentials.Credentials(
                source_credentials=source, target_principal=impersonate,
                target_scopes=SCOPES, lifetime=3600)
            print(f"auth: impersonating {impersonate}")
        except google.auth.exceptions.DefaultCredentialsError:
            # No ADC on this machine, but the gcloud CLI has a user login.
            # Let it mint the impersonated token for us.
            token = _gcloud_token(impersonate)
            creds = TokenCredentials(token=token, scopes=SCOPES)
            print(f"auth: impersonating {impersonate} (token via gcloud CLI)")
        return gspread.authorize(creds)

    key_path = key_path or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if key_path and Path(key_path).exists():
        creds = Credentials.from_service_account_file(key_path, scopes=SCOPES)
        print(f"auth: service-account key ({Path(key_path).name})")
    elif os.environ.get("GCP_SA_KEY"):
        creds = Credentials.from_service_account_info(
            json.loads(os.environ["GCP_SA_KEY"]), scopes=SCOPES)
        print("auth: service-account key (GCP_SA_KEY)")
    else:
        try:
            creds, _ = google.auth.default(scopes=SCOPES)
            print("auth: application default credentials")
        except Exception:
            sys.exit(LOGIN_HINT)
    return gspread.authorize(creds)


def with_retry(fn, *args, what="request", **kwargs):
    """Retry through Sheets' per-minute read quota.

    The quota is 60 reads/minute/user, and it refills continuously, so backing
    off and retrying is the correct response to a 429 rather than an error.
    """
    import time
    delay = 20
    for attempt in range(1, 6):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001 - inspect the message, not the type
            if "429" not in str(exc) and "Quota exceeded" not in str(exc):
                raise
            if attempt == 5:
                raise
            print(f"    quota hit on {what}; waiting {delay}s (attempt {attempt}/5)")
            time.sleep(delay)
            delay = min(delay * 2, 90)
    return None


def a1_quote(title: str) -> str:
    """A1 notation quoting: a literal apostrophe in a tab name is doubled."""
    return "'" + title.replace("'", "''") + "'"


def dump_sheet(client, sheet_id: str, dest_dir: Path,
               only: set[str] | None = None) -> list[str]:
    """Write worksheet tabs to CSV. Values only, as displayed.

    `only` restricts the pull to specific tab names. Default behaviour is to
    take everything, but the pipeline passes the one grain tab it reads:
    competition workbooks also contain a "Copy of Staging" tab whose Google
    Places formulas embed an API key, and fetching tabs we never use is how
    that reached a public repo.

    All tabs come back in a single batch call. Reading them one at a time costs
    an API call per tab, which blows the per-minute read quota on the larger
    workbooks (Australian Cider Awards alone has 30 tabs).
    """
    book = with_retry(client.open_by_key, sheet_id, what="open")
    titles = [ws.title for ws in book.worksheets()]
    if only:
        wanted = {t.casefold() for t in only}
        titles = [t for t in titles if t.casefold() in wanted]
        if not titles:
            raise RuntimeError(f"none of {sorted(only)} found in this workbook")
    dest_dir.mkdir(parents=True, exist_ok=True)
    written = []

    # Chunked so the request URL stays a sane length on big workbooks.
    payload = {}
    for i in range(0, len(titles), 25):
        chunk = titles[i:i + 25]
        resp = with_retry(book.values_batch_get, [a1_quote(t) for t in chunk],
                          what=f"batch_get[{i}]")
        for title, vr in zip(chunk, resp.get("valueRanges", [])):
            payload[title] = vr.get("values", [])

    for title in titles:
        rows = payload.get(title) or []
        if not rows or not any(any(str(c).strip() for c in r) for r in rows):
            continue
        safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in title).strip()
        path = dest_dir / f"{safe or 'sheet'}.csv"
        # batch_get returns ragged rows - trailing empty cells are omitted.
        width = max(len(r) for r in rows)
        header = [str(c).strip() or f"col{i}"
                  for i, c in enumerate(list(rows[0]) + [""] * (width - len(rows[0])))]
        body = [dict(zip(header, list(r) + [""] * (width - len(r)))) for r in rows[1:]]
        lib.write_csv(path, body, header)
        written.append(f"{title} ({len(body)} rows)")
    return written


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", help="path to a service-account JSON key")
    ap.add_argument("--impersonate", metavar="SA_EMAIL",
                    default=os.environ.get("CIDER_IMPERSONATE"),
                    help="service account to impersonate (no key file needed)")
    ap.add_argument("--only", help="fetch a single competition_id")
    ap.add_argument("--lookups-only", action="store_true",
                    help="fetch only the lookup sheets (World Cider Map)")
    ap.add_argument("--all-tabs", action="store_true",
                    help="fetch every tab, not just the grain tab in sheet_tables.csv "
                         "(off by default: other tabs can embed API keys)")
    args = ap.parse_args()

    sources = lib.read_csv(lib.CONFIG / "sources.csv")
    lookups = lib.read_csv(lib.CONFIG / "lookups.csv")
    tables = lib.CONFIG / "sheet_tables.csv"
    wanted: dict[str, set[str]] = {}
    for t in (lib.read_csv(tables) if tables.exists() else []):
        if t["status"] == "active":
            wanted.setdefault(t["source_id"], set()).add(t["tab"].removesuffix(".csv"))
    client = open_client(args.key, args.impersonate)

    targets = []
    if not args.lookups_only:
        targets = [s for s in sources if s["status"] == "active"]
        if args.only:
            targets = [s for s in sources if s["competition_id"] == args.only]
            if not targets:
                sys.exit(f"No source with competition_id={args.only!r}")

    failures = []
    for src in targets:
        try:
            only = None if args.all_tabs else wanted.get(src["competition_id"])
            tabs = dump_sheet(client, src["sheet_id"],
                              lib.SNAPSHOT / src["competition_id"], only)
            print(f"  {src['competition_id']}: {', '.join(tabs)}")
        except Exception as exc:  # noqa: BLE001 - report and keep going
            print(f"  {src['competition_id']}: FAILED - {exc}", file=sys.stderr)
            failures.append(src["competition_id"])

    if not args.only:
        for lk in lookups:
            try:
                tabs = dump_sheet(client, lk["sheet_id"], lib.SNAPSHOT / "_lookups" / lk["lookup"])
                print(f"  {lk['lookup']}: {len(tabs)} tabs")
            except Exception as exc:  # noqa: BLE001
                print(f"  {lk['lookup']}: FAILED - {exc}", file=sys.stderr)
                failures.append(lk["lookup"])

    if failures:
        print(f"\n{len(failures)} source(s) unreadable: {', '.join(failures)}\n"
              f"Usually that means the sheet is not shared with the account you "
              f"authenticated as.", file=sys.stderr)


if __name__ == "__main__":
    main()
