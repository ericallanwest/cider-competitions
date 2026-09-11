"""Run the pipeline end to end. Stops at the first failure."""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# fetch.py is deliberately not in this list: it needs Google credentials and
# network access. Run it yourself when you want to re-pull from Sheets.
STAGES = ["normalize.py", "producers.py", "validate.py", "build.py"]


def main() -> int:
    for stage in STAGES:
        print(f"\n[{stage}]")
        code = subprocess.call([sys.executable, str(HERE / stage)])
        if code != 0:
            print(f"\n{stage} failed - stopping.", file=sys.stderr)
            return code
    print("\nDone. Review reports/ and `git diff data/out/` before committing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
