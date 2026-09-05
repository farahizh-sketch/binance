// ---- CONFIG ----
// From your Supabase project: Project Settings > API
const SUPABASE_URL = "https://YOUR_PROJECT_ID.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_PUBLIC_KEY"; // safe to expose in frontend code
// ------------------

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const asOf = document.getElementById("asOf");
const rowsBody = document.getElementById("priceRows");
const priceMap = {};
const lastPrices = {};
let firstRender = true;

function setStatus(state, label) {
  statusDot.className = "dot" + (state ? " " + state : "");
  statusText.textContent = label;
}

function render() {
  const symbols = Object.keys(priceMap).sort();

  if (symbols.length === 0) {
    rowsBody.innerHTML = '<tr><td colspan="4" class="empty">Waiting for price feed…</td></tr>';
    return;
  }

  rowsBody.innerHTML = symbols.map(sym => {
    const p = priceMap[sym];
    const prev = lastPrices[sym];
    const bidDir = prev && p.bid > prev.bid ? "flash-up" : prev && p.bid < prev.bid ? "flash-down" : "";
    const askDir = prev && p.ask > prev.ask ? "flash-up" : prev && p.ask < prev.ask ? "flash-down" : "";
    const spread = (p.ask - p.bid).toFixed(5);
    return `
      <tr>
        <td>${sym}</td>
        <td class="price ${firstRender ? "" : bidDir}">${p.bid}</td>
        <td class="price ${firstRender ? "" : askDir}">${p.ask}</td>
        <td class="spread">${spread}</td>
      </tr>`;
  }).join("");

  symbols.forEach(sym => lastPrices[sym] = { ...priceMap[sym] });
  firstRender = false;
  asOf.textContent = "as of " + new Date().toLocaleTimeString();

  setTimeout(() => {
    document.querySelectorAll(".price").forEach(el => {
      el.classList.remove("flash-up", "flash-down");
    });
  }, 700);
}

async function loadInitialPrices() {
  const { data, error } = await supabaseClient.from("live_prices").select("*");
  if (error) {
    console.error("Initial load failed", error);
    setStatus("down", "connection error");
    return;
  }
  data.forEach(row => {
    priceMap[row.symbol] = { bid: row.bid, ask: row.ask };
  });
  render();
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
          priceMap[row.symbol] = { bid: row.bid, ask: row.ask };
          render();
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
