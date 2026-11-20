# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

EuroMillions draw statistics and weighted grid generator, in two forms that share one data source:

- `euromillions.py`: single-file, dependency-free Python CLI. Downloads the official FDJ draw history (2004 → today), prints stats, proposes grids.
- `site/`: static web version (plain HTML/CSS/JS, no build step, no npm) published on GitHub Pages at https://m-xime.github.io/euro-million/. It does all computation in the browser from `site/data/tirages.json`, which the Python script generates.

Code, identifiers, CLI flags, UI text and README are all **in French**. Keep new identifiers, messages and docs in French. The web UI addresses the user as "vous".

## Constraints

- **Python: standard library only, Python 3.8+.** `from __future__ import annotations` is what makes `tuple[int, ...]` / `date | None` annotations legal on 3.8; avoid runtime 3.9+ features (`match`, `zip(strict=)`, `str.removeprefix`, etc.).
- **Web: no dependencies, no bundler, no CDN.** ES modules loaded directly. Fonts (Sofia Sans, OFL) are self-hosted in `site/fonts/` on purpose: loading Google Fonts would send French visitors' IPs to Google (GDPR).
- **The weighting logic exists twice**: Python (`calculer_stats`, `poids`, `tirage_pondere`, `score_popularite`, `STRATEGIES`) and its port in `site/moteur.js`. Any change to one must be mirrored in the other. Parity check: `--export stats.csv` from Python must match `exporterCsv()` from `moteur.js` byte for byte for the same strategy and `--fenetre`. Seeded output does *not* match across the two (Python `random` vs mulberry32), only the statistics and weights do.
- **Honesty is a product requirement.** Both versions must keep saying that weighting does not change the odds (1 in 139 838 160 for rank 1), that only the anti-popular mode has real value (fewer shared jackpots, not more wins), and keep the gambling helpline (09 74 75 13 13). Don't add wording that suggests a strategy improves winning chances.

## Commands

```bash
python3 euromillions.py                                        # download/refresh data, stats, 1 grid
python3 euromillions.py --hors-ligne --graine 42 --grilles 3   # no network, reproducible output
python3 euromillions.py --export stats.csv                     # per-number stats + weights (CSV, ';')
python3 euromillions.py --export-json site/data/tirages.json   # data for the site, then exit
python3 -m http.server -d site                                 # serve the site locally (fetch() needs http://)
```

There are no tests, linter or build step. To check a Python change, run with `--hors-ligne --graine <n>` before/after. Prefer `--hors-ligne` once `donnees/` is populated to avoid hitting the FDJ server repeatedly. `node --check site/*.js` catches JS syntax errors; `moteur.js` has no DOM dependency and can be imported from Node for checks.

## Architecture

### `euromillions.py` (top to bottom)

1. **Download** (`telecharger`): fetches the 6 FDJ ZIP archives in `ARCHIVES_CONNUES` into `donnees/`. Archives on disk are skipped, except `ARCHIVE_COURANTE` (the only one still receiving draws), which is re-downloaded every run. On failure it scrapes `PAGE_HISTORIQUE` for new archive IDs. Returns the known archives still missing.
2. **Parse** (`charger` → `_lire_csv`): FDJ CSV formats vary by period, so separator, encoding and date format are sniffed; columns are matched case-insensitively on `date_de_tirage`, `boule_1..5`, `etoile_1..2`. Invalid rows are silently skipped; draws are deduplicated by date.
3. **Stats** (`calculer_stats`): per value, overall frequency, frequency over the last `--fenetre` draws, and delay (draws since last seen). **Stars only use draws since `DEBUT_12_ETOILES` (2016-09-27)**, when the pool grew to 12.
4. **Weights** (`poids`): each criterion is z-scored, then `weight = exp(pf·z_freq + pr·z_recent + pd·z_delay)`. Presets in `STRATEGIES`; `--poids-*` flags override.
5. **Grids**: weighted sampling without replacement; with `--anti-populaire`, rejection-sampled against `score_popularite` until `score <= --seuil`, max 5000 attempts (then the last candidate is kept even if over the threshold; the web UI flags this case).
6. **`--export-json`**: writes `{"genere_le", "source", "tirages": [[iso_date, [5 balls], [2 stars]], ...]}` and exits. It **fails if any known archive is missing**, so CI never publishes a partial history.

### `site/`

- `moteur.js`: pure logic port (stats, weights, sampler, popularity score, CSV export, seeded PRNG). No DOM.
- `app.js`: UI. Loads `data/tirages.json`, renders the "bulletin" (a play slip: 50 numbers + 12 stars) coloured by the selected view (deviation from expected, delay, or weight under current settings), draws generated grids on it as hand-drawn pen circles, plus the stats summary and full tables.
- `style.css`: design tokens at the top. The slip stays light "paper" in dark mode on purpose; only the page around it changes.

### Deployment (`.github/workflows/pages.yml`)

On push to `main`, Wednesday and Saturday at 06:17 UTC (after Tuesday/Friday draws), and manually: runs `--export-json` on the runner, uploads `site/` as the Pages artifact, deploys. `site/data/` and `donnees/` are gitignored; the data is never committed. GitHub disables scheduled workflows after 60 days without repository activity.
