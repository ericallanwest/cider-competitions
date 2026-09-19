# Adding results

Google Sheets is where results are authored. This repo only publishes them.
So "adding a competition year" means: get the results into the sheet, then run
the pipeline and commit what changes.

## Setup, once

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
```

To let the pipeline read the sheets, point it at a Google service-account key
that has **read** access to the competition sheets and the World Cider Map:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json   # never commit this
```

## Adding a competition year

1. **Find the published results.** Save the page or PDF under
   `data/source/web/<competition_id>/<year>/` so there is a record of what the
   numbers came from. Site layouts change and old pages disappear.

2. **Get the rows into the competition's Google Sheet**, using the columns that
   sheet already uses. Fill `WID` from the World Cider Map for each producer.
   Use `X` for entrants who are not in the map — individuals and amateurs. That
   is a real value, not a gap.

3. **Run the pipeline.**

   ```bash
   python pipeline/run_all.py
   ```

4. **Read the reports.** `reports/unmapped_awards.csv` should be empty; awards
   are a closed set. `reports/unmapped_styles.csv` is sorted by row count, so
   working from the top is the fastest way to cut the `Unclassified` share.
   Add what you decide to the matching file in `crosswalks/`.

   If the year came from a parser rather than a sheet, also read
   `reports/parsed_producer_review.csv`. A sheet row carries a WID you
   assigned; a parsed row carries only a producer name, so identity was
   decided by string matching. That report lists every producer the parsers
   introduced, the ones that already match a WID first, then the unresolved
   ones with their closest World Cider Map candidates - which is where a
   second record for a cidery you already have will be hiding. Regenerate it
   with `python pipeline/review_parsed.py`.

   Rows from a parser are labelled `parsed:` in `awards.csv`, and rows from a
   sheet `sheet:`, so the two never look alike.

5. **Commit.** `git diff data/out/awards.csv` shows exactly what changed. If a
   number moved that you did not expect, something is wrong — check before
   committing.

## Editing the crosswalks

`crosswalks/*.csv` hold every normalization decision. Nothing is hard-coded in
Python, so this is where corrections belong.

**Edit them in Google Sheets or a text editor, not Excel.** Excel mangles
accented characters (`Concours Régional`, `Finistère`) and the medal emoji on
save. `validate.py` fails the build when it detects that damage, but it is
easier not to cause it.

| File | Maps |
|---|---|
| `award_vocab.csv` | award text → medal level, trophy, or placing |
| `style_map.csv` | category text → one of the tier-1 style groups |
| `countries.csv` | spelling variants of the *same* designation |

### About `countries.csv`

This file is only for cases where one designation is spelled two ways, such as
`USA` and `United States`. It is **not** for merging different designations.

`Basque Country`, `England`, `Wales`, `Scotland`, `Herefordshire` and
`Vale of Glamorgan` are the designations their producers use, and they stay
distinct. `reports/designations.csv` lists every value in use so you can review
them; the pipeline never merges anything on its own.

## Parsers

`pipeline/parsers/` holds per-competition parsers, keyed by
`(competition_id, year)`. Competition sites get redesigned, so expect to rewrite
roughly half of them each year. They are deliberately small — parse the source
into raw fields and stop. All cleaning happens later in `normalize.py`, so a
rewrite stays a twenty-minute job.
