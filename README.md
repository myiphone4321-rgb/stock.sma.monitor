# SMA Monitor

Tracks your watchlist of US and Tel Aviv Stock Exchange (TASE) tickers, and
shows which ones are currently trading above or below their 20-day and
50-day simple moving averages — and when they last crossed.

A GitHub Action fetches fresh prices twice a day and commits the results
straight into the repo. A static dashboard on GitHub Pages reads that data —
no server, no database, no build step.

## How it's organized

```
docs/                       <- this is the GitHub Pages site root
  index.html                <- dashboard
  style.css
  app.js
  data/
    watchlist.json          <- YOUR list of tickers (edit this)
    status.json             <- generated: current SMA status per ticker
    prices/                 <- generated: per-ticker price history (for charts)
scripts/
  fetch_and_update.py       <- fetches prices, computes SMAs, writes docs/data/*
.github/workflows/
  fetch.yml                 <- runs the script twice a day automatically
requirements.txt
```

## One-time setup

1. **Push this project** to `myiphone4321-rgb/stock.sma.monitor` on GitHub
   (or wherever you keep it).

2. **Enable GitHub Pages**
   Repo → Settings → Pages → Source: "Deploy from a branch" → Branch:
   `main`, folder: `/docs` → Save.
   Your dashboard will be live at:
   `https://myiphone4321-rgb.github.io/stock.sma.monitor/`

3. **Check Actions permissions**
   Repo → Settings → Actions → General → "Workflow permissions" → make sure
   **"Read and write permissions"** is selected. This lets the scheduled
   workflow commit updated data back to the repo using the built-in
   `GITHUB_TOKEN` — you don't need to create or store any secret/token
   yourself.

4. **Run it once manually** so there's data to look at right away:
   Repo → Actions → "Fetch stock data" → Run workflow.
   After it finishes (~1–2 min), refresh the dashboard.

That's it — from here it updates itself.

## Managing your watchlist

Edit `docs/data/watchlist.json` directly on GitHub (or locally + push):

```json
{
  "us": ["AAPL", "MSFT", "NVDA"],
  "il": ["TEVA.TA", "ICL.TA", "POLI.TA"]
}
```

- US tickers: plain symbol, e.g. `"TSLA"`.
- TASE tickers: append `.TA`, e.g. `"TEVA.TA"` — that's the standard Yahoo
  Finance suffix for Tel Aviv Stock Exchange listings, which is what the
  fetch script uses.

Whatever's in this file is picked up automatically on the next scheduled
run (or the next manual run). Removing a ticker also deletes its stored
price history on the next run.

## When it runs

Two scheduled runs a day (times are UTC, so they shift slightly across DST,
which is fine since we only need each day's closing price):

- **~16:00 UTC, Sun–Thu** — shortly after the Tel Aviv Stock Exchange closes
- **~21:30 UTC, Mon–Fri** — shortly after the US market closes

You can also trigger a run manually any time from the Actions tab.

## Data retention

Each run keeps roughly the **last 6 months (135 trading days)** of price
history per ticker and discards anything older — that's the file written to
`docs/data/prices/<TICKER>.json`. Tickers removed from the watchlist have
their stored files deleted entirely on the next run.

## How "crossed" is determined

For each ticker, the script compares the daily close to SMA20 and SMA50 and
labels each day "above" or "below". The **last cross date** is the most
recent day that label flipped. The dashboard sorts each market section so
whichever stocks crossed most recently (on either SMA) appear at the top.
The scrolling ticker tape at the top of the page highlights anything that
crossed in *today's* run specifically.

## Running it locally

```bash
pip install -r requirements.txt
python scripts/fetch_and_update.py
```

Then open `docs/index.html` in a browser (or serve the folder with
`python -m http.server` from inside `docs/`, since `fetch()` of local JSON
files can be blocked by some browsers under `file://`).

## Notes

- Price data comes from Yahoo Finance via the `yfinance` library — free, no
  API key needed, but not guaranteed real-time or 100% uptime. If a ticker
  fails to fetch on a given run, it's skipped and retried on the next run.
- This is informational only, not investment advice.
