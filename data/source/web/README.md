# Source captures

Local copies of the published results every competition-year in this dataset
was compiled from. Competition sites get redesigned and old pages vanish, so
the copy here is the record of what the numbers came from.

**The saved files themselves are not committed.** They are 160+ MB of other
people's announcements, mirrored for archival use, and `.gitignore` keeps them
out of the repository. The manifests are committed instead, so the provenance
of every figure is public even where the bytes are not: re-running the
`capture.py` line for a row reproduces the file and its hash. A fresh clone
therefore has the manifests and an empty archive.

```
data/source/web/<competition_id>/<year>/<name>.<html|pdf>
data/source/web/<competition_id>/manifest.csv     one row per saved file
data/source/web/manifest.csv                      all of the above, merged
```

Save pages with `pipeline/capture.py`, never by hand, so the manifest stays
complete:

```bash
python pipeline/capture.py glintcap 2019 "https://..." --name commercial --kind official --note "..."
python pipeline/capture.py --rebuild     # after deleting a bad capture
```

Where results cannot be fetched at all, save the file by hand and record it
with `--register`, which hashes what you saved instead of downloading:

```bash
python pipeline/capture.py concours-general-agricole 2024     "https://palmares.concours-general-agricole.fr/"     --register data/source/web/concours-general-agricole/2024/cidres-poires.xlsx     --kind export --note "exported by hand: Produits > Cidres et Poires"
```

## Manifest columns

| Column | Meaning |
|---|---|
| `competition_id` | matches `config/sources.csv` |
| `year` | competition year the file documents |
| `url` | what was requested; Wayback URLs are kept in their normal form |
| `file` | repo-relative path of the saved copy |
| `kind` | `official` the competition's own site · `wayback` Internet Archive copy of a page that has gone or is overwritten yearly · `press` third-party coverage reproducing the full list, used only when nothing official survives · `pdf` a downloadable results document · `export` a file someone produced by hand, which no script can reproduce |
| `fetched_at` | UTC timestamp of the capture |
| `http_status`, `bytes`, `sha256`, `content_type` | what came back |
| `note` | edition number, division, what was verified, caveats |

## Conventions

- One file per year is the default (`results.*`). Years that publish several
  documents keep them side by side with descriptive names: `commercial` and
  `noncommercial` for GLINTCAP, per-category `*-pdf` files for CiderWorld,
  `winners` and `finalists` for the Good Food Awards.
- When results are a PDF linked from a page, both the page and the PDF are kept.
- Wayback captures are fetched in the archive's raw `id_` mode, so the bytes
  are the original page, not the archive's toolbar wrapper.
- A page that turns out to be a client-side shell with no results is not
  kept. Where a results page only loads its table from a separate data file
  (International Cider Challenge), that keyless `.json` file is what is saved.
- Third-party API keys are not kept. A page whose only key is a Google Maps
  browser key in a script URL is kept with the key replaced by `AIza-REDACTED`,
  and its manifest note says so; a page that would need a key to be useful is
  recorded as `blocked` in `config/competition_years.csv` instead.
- Some organisers publish image-only PDFs (CiderWorld 2023, most Nordic 2023
  category rankings). They are kept as published; `pdftotext` gets nothing
  from them, so checking them means reading, or OCR.
- The Concours Général Agricole serves its palmarès from an API that needs the
  site's own subscription key. The `Cidres et Poirés` spreadsheets are exported
  from the browser by hand and registered, so they carry no HTTP status.
- `pipeline/parse_source.py` reads some of these files (listed in
  `config/parsed_sources.csv`); most are archival only, since their rows were
  entered in the competition sheets by hand.
