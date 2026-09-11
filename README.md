# Cider Competitions

Results from major hard cider competitions worldwide, compiled by Eric West.

**Site:** https://ericallanwest.github.io/ciderguide/

## How this works

Google Sheets is the **authoring surface** — results are entered and maintained there,
one sheet per competition. This repo is the **publishing pipeline**: it reads those
sheets, normalizes them into a single tidy table, validates the result, and emits
static JSON for the site.

```
Google Sheets  ──fetch──>  data/snapshot/  ──normalize──>  data/out/awards.csv
                                                                  │
                                                            build │
                                                                  v
                                                          site/data/*.json
```

Run the whole thing:

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
python pipeline/run_all.py
```

## A note on regions and countries

`region` and `country` record the **meaningful place designation** for each producer,
which is deliberately mixed in granularity: `Basque Country`, `Herefordshire`,
`Vale of Glamorgan`, and England / Wales / Scotland appear as distinct values
alongside plain country names.

**This is intentional and these values are preserved exactly.** They matter to the
cider community. Normalization is limited to true spelling variants of the same
designation, and those are resolved in an editable crosswalk — never inferred by code.

## Layout

| Path | What |
|---|---|
| `config/sources.csv` | competition → sheet id, tab, parser, status |
| `data/snapshot/` | raw pull from Sheets (provenance, diffable) |
| `data/out/` | canonical `awards.csv`, `producers.csv`, site JSON |
| `archive/` | last export of the retired ciderguide.com TablePress tables |
| `pipeline/` | the ETL |
| `reports/` | validator output, committed so regressions show in diffs |
| `site/` | the GitHub Pages site (vanilla HTML/JS/CSS, no build step) |
