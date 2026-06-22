/* SMA Monitor — dashboard logic
   Reads the static JSON files written by scripts/fetch_and_update.py and
   renders them. No build step, no framework — just fetch + DOM.
*/

const STATUS_URL = "data/status.json";
const PRICE_DIR = "data/prices/";

let chartInstance = null;

function fmtPrice(n) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return "—";
  return d;
}

function safeFilename(ticker) {
  return ticker.replace(/\./g, "_").replace(/\//g, "_").replace(/\s/g, "_");
}

function statusBadge(status, date) {
  const cls = status === "above" ? "above" : status === "below" ? "below" : "unknown";
  const label = status === "above" ? "▲ Above" : status === "below" ? "▼ Below" : "—";
  return `<span class="status-badge ${cls}">${label}</span>` +
         (date ? `<span class="cross-date">since ${fmtDate(date)}</span>` : "");
}

function renderTable(tbodyEl, countEl, stocks) {
  countEl.textContent = stocks.length;

  if (stocks.length === 0) {
    tbodyEl.innerHTML = `<tr><td colspan="5" class="empty-state">No tickers in this market yet. Add some to <code>docs/data/watchlist.json</code>.</td></tr>`;
    return;
  }

  tbodyEl.innerHTML = stocks.map((s) => `
    <tr tabindex="0" data-ticker="${s.ticker}">
      <td class="ticker-cell">${s.ticker}</td>
      <td class="price-cell">${fmtPrice(s.price)}</td>
      <td>${statusBadge(s.status20, s.cross20_date)}</td>
      <td>${statusBadge(s.status50, s.cross50_date)}</td>
      <td class="last-cross-cell">${fmtDate(s.last_cross_date)}</td>
    </tr>
  `).join("");

  tbodyEl.querySelectorAll("tr[data-ticker]").forEach((row) => {
    row.addEventListener("click", () => openModal(row.dataset.ticker, stocks));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openModal(row.dataset.ticker, stocks);
      }
    });
  });
}

function renderTape(stocks, generatedAt) {
  const track = document.getElementById("tape-track");
  const today = (generatedAt || "").slice(0, 10);
  const todays = stocks.filter((s) => s.cross20_date === today || s.cross50_date === today);

  if (todays.length === 0) {
    track.outerHTML = `<div class="tape-empty">No SMA20 / SMA50 crosses recorded in today's run.</div>`;
    return;
  }

  const items = [];
  todays.forEach((s) => {
    if (s.cross20_date === today) {
      items.push(tapeItem(s.ticker, "SMA20", s.status20));
    }
    if (s.cross50_date === today) {
      items.push(tapeItem(s.ticker, "SMA50", s.status50));
    }
  });

  // Duplicate the list so the CSS scroll animation (translateX -50%) loops seamlessly.
  track.innerHTML = items.concat(items).join("");
}

function tapeItem(ticker, smaLabel, status) {
  const up = status === "above";
  const arrow = up ? `<span class="arrow-up">▲</span>` : `<span class="arrow-down">▼</span>`;
  const word = up ? "ABOVE" : "BELOW";
  return `<span class="tape-item">${arrow} ${ticker} ${word} ${smaLabel}</span>`;
}

async function openModal(ticker, stocks) {
  const stock = stocks.find((s) => s.ticker === ticker);
  const overlay = document.getElementById("modal-overlay");
  const title = document.getElementById("modal-title");
  const sub = document.getElementById("modal-sub");

  title.textContent = ticker;
  sub.textContent = stock.market === "il" ? "Tel Aviv Stock Exchange" : "US Market";
  document.getElementById("stat-price").textContent = fmtPrice(stock.price);
  document.getElementById("stat-sma20").textContent = fmtPrice(stock.sma20);
  document.getElementById("stat-sma50").textContent = fmtPrice(stock.sma50);

  overlay.hidden = false;
  document.getElementById("modal-close").focus();

  try {
    const res = await fetch(`${PRICE_DIR}${safeFilename(ticker)}.json`);
    const data = await res.json();
    drawChart(data.history);
  } catch (err) {
    console.error("Failed to load price history for", ticker, err);
  }
}

function closeModal() {
  document.getElementById("modal-overlay").hidden = true;
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
}

function drawChart(history) {
  const ctx = document.getElementById("price-chart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  const labels = history.map((h) => h.date);
  const close = history.map((h) => h.close);
  const sma20 = history.map((h) => h.sma20);
  const sma50 = history.map((h) => h.sma50);

  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Close",
          data: close,
          borderColor: "#e8e2d0",
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.05,
        },
        {
          label: "SMA20",
          data: sma20,
          borderColor: "#2bb3a3",
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.05,
        },
        {
          label: "SMA50",
          data: sma50,
          borderColor: "#c9a227",
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
          ticks: { color: "#5b6478", maxTicksLimit: 8, font: { family: "JetBrains Mono", size: 10 } },
          grid: { color: "#1a2638" },
        },
        y: {
          ticks: { color: "#5b6478", font: { family: "JetBrains Mono", size: 10 } },
          grid: { color: "#1a2638" },
        },
      },
    },
  });
}

async function init() {
  try {
    const res = await fetch(STATUS_URL);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();

    document.getElementById("updated-at").textContent = data.generated_at
      ? new Date(data.generated_at).toLocaleString()
      : "never";

    const us = data.stocks.filter((s) => s.market === "us");
    const il = data.stocks.filter((s) => s.market === "il");

    renderTable(document.querySelector("#us-table tbody"), document.getElementById("us-count"), us);
    renderTable(document.querySelector("#il-table tbody"), document.getElementById("il-count"), il);
    renderTape(data.stocks, data.generated_at);
  } catch (err) {
    console.error("Failed to load data/status.json", err);
    document.getElementById("updated-at").textContent = "no data yet";
    document.getElementById("tape-track").outerHTML =
      `<div class="tape-empty">No data yet — run the fetch workflow (or scripts/fetch_and_update.py) at least once.</div>`;
  }
}

document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "modal-overlay") closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

init();
