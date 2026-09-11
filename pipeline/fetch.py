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
        header = [c.strip() or f"col{i}"
                  for i, c in enumerate(rows[0] + [""] * (width - len(rows[0])))]
        body = [dict(zip(header, r + [""] * (width - len(r)))) for r in rows[1:]]
        lib.write_csv(path, body, header)
        written.append(f"{ws.title} ({len(body)} rows)")
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
    args = ap.parse_args()

    sources = lib.read_csv(lib.CONFIG / "sources.csv")
    lookups = lib.read_csv(lib.CONFIG / "lookups.csv")
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
            tabs = dump_sheet(client, src["sheet_id"], lib.SNAPSHOT / src["competition_id"])
            print(f"  {src['competition_id']}: {len(tabs)} tabs")
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
