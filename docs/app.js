/* SMA Monitor — app.js
   Reads static JSON written by fetch_and_update.py, renders iOS-style cards.
   Card colouring rules:
     - crossed SMA today or yesterday   → green  (recent-green)
     - crossed SMA 2 days ago           → yellow (recent-yellow)
     - crossed SMA 3+ days ago          → orange (older), hidden under accordion
     - never crossed in stored window   → neutral (no-cross), hidden under accordion
*/

const STATUS_URL = "data/status.json";
const PRICE_DIR  = "data/prices/";

let chartInstance = null;
let allStocks     = [];

/* ── helpers ──────────────────────────────────────────────────────────── */

function fmtPrice(n) {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return "—";
  return d;
}

function safeFilename(ticker) {
  return ticker.replace(/\./g, "_").replace(/[/\s]/g, "_");
}

/* Returns how many calendar days ago `dateStr` (YYYY-MM-DD) was.
   Uses the local clock so it matches what users see on their device. */
function daysAgo(dateStr) {
  if (!dateStr) return Infinity;
  const then = new Date(dateStr + "T00:00:00");
  const now  = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((now - then) / 86400000);
}

/* Card class based on most-recent cross date. */
function cardClass(stock) {
  const d = stock.last_cross_date;
  if (!d) return "no-cross";
  const age = daysAgo(d);
  if (age <= 1) return "recent-green";
  if (age <= 2) return "recent-yellow";
  return "older";
}

/* Whether this card belongs in the "recent" (visible) group. */
function isRecent(stock) {
  const cls = cardClass(stock);
  return cls === "recent-green" || cls === "recent-yellow";
}

/* ── badge ────────────────────────────────────────────────────────────── */

function statusBadge(status) {
  if (!status || status === "unknown") {
    return `<span class="status-badge unknown">—</span>`;
  }
  const cls   = status === "above" ? "above" : "below";
  const label = status === "above" ? "▲ Above SMA" : "▼ Below SMA";
  return `<span class="status-badge ${cls}">${label}</span>`;
}

/* ── single card HTML ─────────────────────────────────────────────────── */

function cardHTML(s) {
  const cls = cardClass(s);
  return `
    <div class="stock-card ${cls}" tabindex="0" role="button"
         aria-label="Open chart for ${s.ticker}"
         data-ticker="${s.ticker}">
      <div style="flex:1; min-width:0;">
        <div class="ticker-name">${s.ticker}</div>
        <div class="ticker-price">${fmtPrice(s.price)}</div>
        <div class="badge-row">
          <span style="font-size:11px;color:var(--text-tertiary);align-self:center;">SMA20</span>
          ${statusBadge(s.status20)}
          <span style="font-size:11px;color:var(--text-tertiary);align-self:center;margin-left:4px;">SMA50</span>
          ${statusBadge(s.status50)}
        </div>
      </div>
      <div class="last-cross-cell">
        <span class="cross-label">Last cross</span>
        <span class="cross-value">${fmtDate(s.last_cross_date)}</span>
      </div>
    </div>`;
}

/* ── render a market section ──────────────────────────────────────────── */

function renderSection(containerId, countId, stocks) {
  const container = document.getElementById(containerId);
  const countEl   = document.getElementById(countId);
  countEl.textContent = stocks.length;

  if (stocks.length === 0) {
    container.innerHTML =
      `<div class="empty-state">No tickers yet. Add some to <code>docs/data/watchlist.json</code>.</div>`;
    return;
  }

  const recent = stocks.filter(isRecent);
  const older  = stocks.filter(s => !isRecent(s));

  let html = "";

  // Recent cards — always visible
  if (recent.length > 0) {
    html += `<div class="stock-list" id="${containerId}-recent">` +
            recent.map(cardHTML).join("") +
            `</div>`;
  }

  // Older cards — under accordion
  if (older.length > 0) {
    const btnId  = `${containerId}-toggle`;
    const listId = `${containerId}-older`;
    html += `
      <button class="earlier-toggle" id="${btnId}"
              aria-expanded="false" aria-controls="${listId}">
        Earlier crossers (${older.length})
        <span class="chevron" aria-hidden="true">&#8964;</span>
      </button>
      <div class="earlier-list" id="${listId}" aria-hidden="true">
        <div class="stock-list">
          ${older.map(cardHTML).join("")}
        </div>
      </div>`;
  }

  if (recent.length === 0 && older.length === 0) {
    html = `<div class="empty-state">No cross data yet.</div>`;
  }

  container.innerHTML = html;

  // Accordion logic
  if (older.length > 0) {
    const btn  = document.getElementById(`${containerId}-toggle`);
    const list = document.getElementById(`${containerId}-older`);
    btn.addEventListener("click", () => {
      const opening = !btn.classList.contains("open");
      btn.classList.toggle("open", opening);
      list.classList.toggle("open", opening);
      btn.setAttribute("aria-expanded", opening);
      list.setAttribute("aria-hidden", !opening);
    });
  }

  // Card click → chart modal
  container.querySelectorAll(".stock-card").forEach(card => {
    const open = () => openModal(card.dataset.ticker);
    card.addEventListener("click", open);
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });
}

/* ── today's crosses tape ─────────────────────────────────────────────── */

function renderTape(stocks) {
  const track = document.getElementById("tape-track");
  const recent = stocks.filter(s => daysAgo(s.last_cross_date) <= 1);

  if (recent.length === 0) {
    track.innerHTML = `<span class="tape-empty">No SMA crosses in the last trading day.</span>`;
    return;
  }

  track.innerHTML = recent.map(s => {
    const up = s.status20 === "above" || s.status50 === "above";
    const arrow = up
      ? `<span class="arrow-up">▲</span>`
      : `<span class="arrow-down">▼</span>`;
    return `<span class="tape-item">${arrow} ${s.ticker}</span>`;
  }).join("");
}

/* ── error banner ─────────────────────────────────────────────────────── */

function showErrorBanner(failedTickers) {
  if (!failedTickers || failedTickers.length === 0) return;
  const banner = document.getElementById("error-banner");
  document.getElementById("error-text").textContent =
    "Error fetching data for: " + failedTickers.join(", ");
  banner.hidden = false;
}

/* ── chart modal ──────────────────────────────────────────────────────── */

async function openModal(ticker) {
  const stock = allStocks.find(s => s.ticker === ticker);
  if (!stock) return;

  document.getElementById("modal-title").textContent = ticker;
  document.getElementById("modal-sub").textContent =
    stock.market === "il" ? "Tel Aviv Stock Exchange" : "US Market";
  document.getElementById("stat-price").textContent = fmtPrice(stock.price);
  document.getElementById("stat-sma20").textContent = fmtPrice(stock.sma20);
  document.getElementById("stat-sma50").textContent = fmtPrice(stock.sma50);

  const overlay = document.getElementById("modal-overlay");
  overlay.hidden = false;
  document.getElementById("modal-close").focus();

  try {
    const res  = await fetch(`${PRICE_DIR}${safeFilename(ticker)}.json`);
    const data = await res.json();
    drawChart(data.history);
  } catch (err) {
    console.error("Failed to load price history for", ticker, err);
  }
}

function closeModal() {
  document.getElementById("modal-overlay").hidden = true;
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
}

function drawChart(history) {
  const ctx = document.getElementById("price-chart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: history.map(h => h.date),
      datasets: [
        {
          label: "Close",
          data: history.map(h => h.close),
          borderColor: "#0a84ff",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.05,
        },
        {
          label: "SMA 20",
          data: history.map(h => h.sma20),
          borderColor: "#34c759",
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.05,
        },
        {
          label: "SMA 50",
          data: history.map(h => h.sma50),
          borderColor: "#ff9500",
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.05,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: {
            color: "#8e8e93",
            maxTicksLimit: 7,
            font: { family: "var(--font-mono)", size: 10 },
          },
          grid: { color: "rgba(142,142,147,0.15)" },
        },
        y: {
          ticks: {
            color: "#8e8e93",
            font: { family: "var(--font-mono)", size: 10 },
          },
          grid: { color: "rgba(142,142,147,0.15)" },
        },
      },
    },
  });
}

/* ── bootstrap ────────────────────────────────────────────────────────── */

async function init() {
  try {
    const res = await fetch(STATUS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    document.getElementById("updated-at").textContent = data.generated_at
      ? new Date(data.generated_at).toLocaleString()
      : "never";

    allStocks = data.stocks || [];

    const us = allStocks.filter(s => s.market === "us");
    const il = allStocks.filter(s => s.market === "il");

    renderSection("us-list", "us-count", us);
    renderSection("il-list", "il-count", il);
    renderTape(allStocks);
    showErrorBanner(data.fetch_errors || []);

  } catch (err) {
    console.error("Failed to load data/status.json:", err);
    document.getElementById("updated-at").textContent = "no data yet";
    document.getElementById("tape-track").innerHTML =
      `<span class="tape-empty">No data yet — run the fetch workflow once to populate.</span>`;
  }
}

/* ── modal event listeners ────────────────────────────────────────────── */

document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-overlay").addEventListener("click", e => {
  if (e.target.id === "modal-overlay") closeModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
});

init();
