#!/usr/bin/env python3
"""
fetch_and_update.py

Fetches daily price data for every ticker in the watchlist (US + Tel Aviv
markets), computes SMA20 / SMA50, detects when price last crossed each
average, trims stored history to ~6 months, and writes the JSON files the
dashboard (docs/index.html) reads.

Run twice a day by .github/workflows/fetch.yml. Safe to run manually too:
    python scripts/fetch_and_update.py
"""

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "docs" / "data"
PRICES_DIR = DATA_DIR / "prices"
WATCHLIST_FILE = DATA_DIR / "watchlist.json"
STATUS_FILE = DATA_DIR / "status.json"

# How much history to ask yfinance for. Needs to comfortably exceed
# KEEP_TRADING_DAYS + 50 so the SMA50 values at the start of the kept
# window are calculated from real prior data, not NaN.
FETCH_PERIOD = "10mo"

# How many trading days of history to keep on disk per ticker (~6 months).
# Anything older than this is deleted on every run -- this is the
# "delete unnecessary stock price data" requirement.
KEEP_TRADING_DAYS = 135

SMA_WINDOWS = {"sma20": 20, "sma50": 50}


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] {msg}", flush=True)


def safe_filename(ticker: str) -> str:
    """Turn a ticker like 'TEVA.TA' into a filesystem-safe name 'TEVA_TA'."""
    return ticker.replace(".", "_").replace("/", "_").replace(" ", "_")


def load_watchlist() -> dict:
    if not WATCHLIST_FILE.exists():
        log(f"No watchlist file at {WATCHLIST_FILE}, nothing to do.")
        return {"us": [], "il": []}
    with open(WATCHLIST_FILE, "r", encoding="utf-8") as f:
        wl = json.load(f)
    wl.setdefault("us", [])
    wl.setdefault("il", [])
    return wl


def fetch_history(ticker: str) -> pd.DataFrame | None:
    """Download daily OHLC data for one ticker. Returns None on failure."""
    try:
        df = yf.download(
            ticker,
            period=FETCH_PERIOD,
            interval="1d",
            progress=False,
            auto_adjust=False,
            threads=False,
        )
    except Exception as exc:  # noqa: BLE001 - we want to keep going on any failure
        log(f"  ! failed to download {ticker}: {exc}")
        return None

    if df is None or df.empty:
        log(f"  ! no data returned for {ticker}")
        return None

    # yfinance can return a MultiIndex column frame even for a single ticker
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    df = df.reset_index()
    df = df.rename(columns={"Date": "date", "Close": "close"})
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    df = df[["date", "close"]].dropna()
    return df


def compute_smas(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for name, window in SMA_WINDOWS.items():
        df[name] = df["close"].rolling(window=window).mean()
    return df


def status_at(close: float, sma) -> str | None:
    if pd.isna(sma):
        return None
    return "above" if close >= sma else "below"


def last_cross_date(df: pd.DataFrame, sma_col: str) -> str | None:
    """
    Find the most recent date where the close moved from one side of the
    SMA to the other. Returns None if there's no valid crossover in the
    stored history (e.g. not enough data, or it never crossed).
    """
    sub = df.dropna(subset=[sma_col]).copy()
    if len(sub) < 2:
        return None

    sub["status"] = [status_at(c, s) for c, s in zip(sub["close"], sub[sma_col])]
    sub["prev_status"] = sub["status"].shift(1)

    flips = sub[(sub["prev_status"].notna()) & (sub["status"] != sub["prev_status"])]
    if flips.empty:
        return None
    return flips.iloc[-1]["date"]


def process_ticker(ticker: str, market: str) -> dict | None:
    raw = fetch_history(ticker)
    if raw is None:
        return None

    full = compute_smas(raw)

    # Trim to the trading-day window we actually want to keep on disk.
    trimmed = full.tail(KEEP_TRADING_DAYS).reset_index(drop=True)

    if trimmed.empty:
        return None

    latest = trimmed.iloc[-1]
    price = float(latest["close"])
    sma20 = None if pd.isna(latest["sma20"]) else float(latest["sma20"])
    sma50 = None if pd.isna(latest["sma50"]) else float(latest["sma50"])

    status20 = status_at(price, latest["sma20"])
    status50 = status_at(price, latest["sma50"])

    # Cross detection uses the *trimmed* window, which is fine since the
    # SMA values inside it were computed from the larger fetch buffer.
    cross20 = last_cross_date(trimmed, "sma20")
    cross50 = last_cross_date(trimmed, "sma50")

    last_cross = max([d for d in [cross20, cross50] if d], default=None)

    # Write the per-ticker price history file used by the chart modal.
    PRICES_DIR.mkdir(parents=True, exist_ok=True)
    price_file = PRICES_DIR / f"{safe_filename(ticker)}.json"
    history_records = trimmed.where(pd.notna(trimmed), None).to_dict(orient="records")
    with open(price_file, "w", encoding="utf-8") as f:
        json.dump(
            {
                "ticker": ticker,
                "market": market,
                "history": history_records,
            },
            f,
            indent=2,
        )

    return {
        "ticker": ticker,
        "market": market,
        "price": price,
        "sma20": sma20,
        "sma50": sma50,
        "status20": status20,
        "status50": status50,
        "cross20_date": cross20,
        "cross50_date": cross50,
        "last_cross_date": last_cross,
    }


def cleanup_stale_price_files(watchlist: dict) -> None:
    """Delete price files for tickers that were removed from the watchlist."""
    if not PRICES_DIR.exists():
        return
    valid_names = {
        safe_filename(t) for tickers in watchlist.values() for t in tickers
    }
    for f in PRICES_DIR.glob("*.json"):
        if f.stem not in valid_names:
            log(f"  - removing stale price file for old ticker: {f.name}")
            f.unlink()


def main() -> int:
    watchlist = load_watchlist()
    all_tickers = [(t, "us") for t in watchlist["us"]] + [(t, "il") for t in watchlist["il"]]

    if not all_tickers:
        log("Watchlist is empty. Add tickers to docs/data/watchlist.json.")

    results = []
    for ticker, market in all_tickers:
        log(f"Fetching {ticker} ({market})...")
        result = process_ticker(ticker, market)
        if result:
            results.append(result)
        # Be polite to Yahoo Finance between requests.
        time.sleep(0.5)

    cleanup_stale_price_files(watchlist)

    # Stocks that crossed most recently bubble to the top; stocks with no
    # recorded cross in the stored window sort last, alphabetically.
    crossed = [r for r in results if r["last_cross_date"]]
    uncrossed = sorted([r for r in results if not r["last_cross_date"]], key=lambda r: r["ticker"])
    crossed.sort(key=lambda r: r["last_cross_date"], reverse=True)
    results = crossed + uncrossed

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "stocks": results,
            },
            f,
            indent=2,
        )

    log(f"Done. Wrote status for {len(results)}/{len(all_tickers)} tickers.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
