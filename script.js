// ---- CONFIG ----
// From your Supabase project: Project Settings > API
const SUPABASE_URL = "https://pjibstvqozftsmcsjtsz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_-Gf1DBodO9W61U0myjvFpg_KzD6yBcx"; // safe to expose in frontend code
// ------------------

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const asOf = document.getElementById("asOf");
const commodityBody = document.getElementById("commodityRows");
const forexBody = document.getElementById("forexRows");

const COMMODITY_SYMBOLS = ["XAUUSD", "XAGUSD", "XBRUSD"];

// Map MT4 symbol names to TradingView symbols. Falls back to "OANDA:<symbol>"
// if not listed here - edit this if your broker uses different naming.
const TV_SYMBOL_MAP = {
  XAUUSD: "OANDA:XAUUSD",
  XAGUSD: "OANDA:XAGUSD",
  XBRUSD: "TVC:UKOIL", // Brent crude - TradingView doesn't have a universal "XBRUSD" ticker
};

function tvSymbolFor(sym) {
  return TV_SYMBOL_MAP[sym] || ("OANDA:" + sym);
}

function setStatus(state, label) {
  statusDot.className = "dot" + (state ? " " + state : "");
  statusText.textContent = label;
}

// symbol -> { tr, bidCell, askCell, lastBid, lastAsk, chartRow, chartOpen }
const rows = new Map();
let widgetCounter = 0;

// Friendly subtitle shown under commodity symbol names
const COMMODITY_LABELS = {
  XAUUSD: "Gold",
  XAGUSD: "Silver",
  XBRUSD: "Crude",
};

function symbolCellHtml(sym) {
  const label = COMMODITY_LABELS[sym];
  return label
    ? `${sym}<span class="symbol-sub">${label}</span>`
    : sym;
}

function createRow(sym) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${symbolCellHtml(sym)}</td>
    <td class="price"></td>
    <td class="price"></td>
    <td><button class="chart-toggle" type="button">Chart ▾</button></td>
  `;
  const bidCell = tr.children[1];
  const askCell = tr.children[2];
  const toggleBtn = tr.querySelector(".chart-toggle");

  const entry = { tr, bidCell, askCell, lastBid: null, lastAsk: null, chartRow: null, chartOpen: false };

  toggleBtn.addEventListener("click", () => toggleChart(sym, entry, toggleBtn));

  rows.set(sym, entry);
  return entry;
}

function toggleChart(sym, entry, btn) {
  if (entry.chartOpen) {
    // collapse
    if (entry.chartRow) entry.chartRow.remove();
    entry.chartRow = null;
    entry.chartOpen = false;
    btn.textContent = "Chart ▾";
    return;
  }

  // expand: insert a new row right after this pair's row with the chart embedded
  const chartRow = document.createElement("tr");
  chartRow.className = "chart-row";
  const td = document.createElement("td");
  td.colSpan = 4;
  const containerId = "tv_widget_" + (widgetCounter++);
  const container = document.createElement("div");
  container.id = containerId;
  container.className = "tradingview-widget-container";
  td.appendChild(container);
  chartRow.appendChild(td);

  entry.tr.insertAdjacentElement("afterend", chartRow);
  entry.chartRow = chartRow;
  entry.chartOpen = true;
  btn.textContent = "Hide chart ▴";

  new TradingView.widget({
    autosize: true,
    symbol: tvSymbolFor(sym),
    interval: "15",
    timezone: "Asia/Kolkata",
    theme: "dark",
    style: "1",
    locale: "en",
    toolbar_bg: "#11161f",
    enable_publishing: false,
    hide_legend: false,
    save_image: false,
    container_id: containerId
  });
}

function updatePriceCell(cell, newValue, oldValue) {
  cell.textContent = newValue;
  cell.classList.remove("flash-up", "flash-down");
  if (oldValue !== null) {
    if (newValue > oldValue) cell.classList.add("flash-up");
    else if (newValue < oldValue) cell.classList.add("flash-down");
    // force reflow so the transition re-triggers on repeated flashes
    void cell.offsetWidth;
  }
  setTimeout(() => cell.classList.remove("flash-up", "flash-down"), 700);
}

function ensureHeadingRow(tbody, label) {
  if (!tbody.querySelector(".group-heading")) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="group-heading">${label}</td>`;
    tbody.appendChild(tr);
  }
  const empty = tbody.querySelector(".empty");
  if (empty) empty.closest("tr").remove();
}

function upsertPrice(symbol, bid, ask) {
  const isCommodity = COMMODITY_SYMBOLS.includes(symbol);
  const tbody = isCommodity ? commodityBody : forexBody;

  let entry = rows.get(symbol);
  if (!entry) {
    ensureHeadingRow(tbody, isCommodity ? "Commodities" : "Forex");
    entry = createRow(symbol);
    tbody.appendChild(entry.tr);
  }

  updatePriceCell(entry.bidCell, bid, entry.lastBid);
  updatePriceCell(entry.askCell, ask, entry.lastAsk);
  entry.lastBid = bid;
  entry.lastAsk = ask;

  asOf.textContent = "as of " + new Date().toLocaleTimeString();
}

async function loadInitialPrices() {
  const { data, error } = await supabaseClient.from("live_prices").select("*");
  if (error) {
    console.error("Initial load failed", error);
    setStatus("down", "connection error");
    return;
  }
  data.forEach(row => upsertPrice(row.symbol, row.bid, row.ask));
}

function subscribeToUpdates() {
  supabaseClient
    .channel("live_prices_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "live_prices" },
      (payload) => {
        const row = payload.new;
        if (row && row.symbol) {
          upsertPrice(row.symbol, row.bid, row.ask);
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setStatus("live", "live");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setStatus("down", "disconnected — retrying…");
      }
    });
}

async function init() {
  setStatus("", "connecting…");
  await loadInitialPrices();
  subscribeToUpdates();
}

init();
