// ── CONFIG ──────────────────────────────────────────────────────────────────
const SUPABASE_URL      = "https://pjibstvqozftsmcsjtsz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_-Gf1DBodO9W61U0myjvFpg_KzD6yBcx";
// ─────────────────────────────────────────────────────────────────────────────

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── STATE ────────────────────────────────────────────────────────────────────
let session     = null;   // { mobile, isAdmin, wallet }
let priceMap    = {};     // { symbol: { bid, ask } }
let positions   = [];     // array of position objects from DB
let orderHist   = [];
let ledgerData  = [];
let allUsers    = [];
let allPositions = [];
let buyTarget   = null;   // { symbol, ask }
let sellTarget  = null;   // position object
let jvType      = 'CREDIT';
let widgetCtr   = 0;

const COMMODITY_SYMBOLS = ['XAUUSD', 'XAGUSD', 'XBRUSD'];
const COMMODITY_LABELS  = { XAUUSD: 'Gold', XAGUSD: 'Silver', XBRUSD: 'Crude' };
const TV_SYMBOLS        = { XAUUSD: 'OANDA:XAUUSD', XAGUSD: 'OANDA:XAGUSD', XBRUSD: 'TVC:UKOIL' };
const rowRegistry       = new Map(); // symbol → { tr, bidCell, askCell, lastBid, lastAsk, chartRow, chartOpen }

// ── API HELPER ───────────────────────────────────────────────────────────────
async function api(action, payload = {}) {
  const res = await fetch('/api/supabase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload })
  });
  return res.json();
}

// ── UTILS ────────────────────────────────────────────────────────────────────
function fmt(n, d = 2) { return parseFloat(n).toFixed(d); }
function fmtINR(n) { return '₹' + parseFloat(n).toLocaleString('en-IN', { minimumFractionDigits: 2 }); }
function toIST(ts) {
  return new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
}
function setStatus(state, label) {
  document.getElementById('statusDot').className = 'dot' + (state ? ' ' + state : '');
  document.getElementById('statusText').textContent = label;
}

// ── LOGIN ────────────────────────────────────────────────────────────────────
async function handleLogin() {
  const mobile   = document.getElementById('loginMobile').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('loginBtn');
  errEl.textContent = '';

  if (!/^\d{10}$/.test(mobile)) { errEl.textContent = 'Enter a valid 10-digit mobile number.'; return; }
  if (!password) { errEl.textContent = 'Enter your password.'; return; }

  btn.textContent = 'CONNECTING…';
  btn.disabled = true;

  const res = await api('login', { mobile, password });
  btn.textContent = 'ACCESS DASHBOARD';
  btn.disabled = false;

  if (res.error) { errEl.textContent = res.error === 'Incorrect Password' ? '❌ Incorrect password.' : '❌ ' + res.error; return; }

  session = { mobile: res.data.mobile, isAdmin: res.data.is_admin, wallet: parseFloat(res.data.wallet_balance) };
  localStorage.setItem('session', JSON.stringify(session));
  bootDashboard();
}

function showRegister() {
  document.getElementById('loginForm').style.display    = 'none';
  document.getElementById('registerForm').style.display = '';
  document.getElementById('regError').textContent = '';
  document.getElementById('regMobile').value = '';
  document.getElementById('regPassword').value = '';
  document.getElementById('regPasswordConfirm').value = '';
}

function showLogin() {
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginForm').style.display    = '';
  document.getElementById('loginError').textContent = '';
}

async function handleRegister() {
  const mobile   = document.getElementById('regMobile').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm  = document.getElementById('regPasswordConfirm').value;
  const errEl    = document.getElementById('regError');
  const btn      = document.getElementById('regBtn');
  errEl.textContent = '';

  if (!/^\d{10}$/.test(mobile))   { errEl.textContent = '❌ Enter a valid 10-digit mobile number.'; return; }
  if (password.length < 4)         { errEl.textContent = '❌ Password must be at least 4 characters.'; return; }
  if (password !== confirm)         { errEl.textContent = '❌ Passwords do not match.'; return; }

  btn.textContent = 'CREATING…';
  btn.disabled = true;

  const res = await api('createUser', { mobile, password, wallet_balance: 100000 });

  btn.textContent = 'CREATE ACCOUNT';
  btn.disabled = false;

  if (res.error) {
    // Postgres unique violation = mobile already registered
    const isDupe = JSON.stringify(res.error).includes('23505') || JSON.stringify(res.error).includes('duplicate');
    errEl.textContent = isDupe
      ? '❌ This mobile number is already registered.'
      : '❌ Registration failed. Please try again.';
    return;
  }

  // auto-login after successful registration
  session = { mobile: res.data.mobile, isAdmin: false, wallet: parseFloat(res.data.wallet_balance) };
  localStorage.setItem('session', JSON.stringify(session));
  showLogin();
  bootDashboard();
  await syncData();
}

function logout() {
  session = null;
  document.getElementById('loginOverlay').classList.remove('hidden');
  document.getElementById('loginOverlay').style.display = 'flex';
  const chipEl = document.getElementById('userChip');
  if (chipEl) chipEl.style.display = 'none';
  const walletEl = document.getElementById('walletChip');
  if (walletEl) walletEl.style.display = 'none';
  hidePanel('positionsPanel');
  hidePanel('historyPanel');
  hidePanel('ledgerPanel');
  hidePanel('adminPanel');
}

function bootDashboard() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.style.display = 'none';

  updateWalletDisplay();

  const mobileEl = document.getElementById('userMobileDisplay');
  if (mobileEl) { mobileEl.textContent = session.mobile; }
  const chipEl = document.getElementById('userChip');
  if (chipEl) chipEl.style.display = '';

  // show trade buttons on any rows already rendered
  rowRegistry.forEach(entry => {
    if (entry.buyBtn)  entry.buyBtn.style.display  = '';
    if (entry.sellBtn) entry.sellBtn.style.display = '';
  });

  if (session.isAdmin) {
    const adminBtn = document.getElementById('adminBtn');
    if (adminBtn) adminBtn.style.display = '';
    const ledgerTitle = document.getElementById('ledgerTitle');
    if (ledgerTitle) ledgerTitle.textContent = 'Client Ledger';
  }

  setInterval(syncData, 10000);
}

// ── WALLET ───────────────────────────────────────────────────────────────────
function updateWalletDisplay() {
  document.getElementById('walletChip').style.display = '';
  document.getElementById('walletAmt').textContent =
    session.wallet.toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

// ── PRICE FEED (Supabase Realtime) ───────────────────────────────────────────
async function loadInitialPrices() {
  const { data } = await sb.from('live_prices').select('*');
  if (data) data.forEach(r => updatePrice(r.symbol, r.bid, r.ask));
}

function subscribePrices() {
  sb.channel('live_prices_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'live_prices' }, p => {
      const r = p.new;
      if (r?.symbol) updatePrice(r.symbol, r.bid, r.ask);
    })
    .subscribe(s => {
      if (s === 'SUBSCRIBED') setStatus('live', 'live');
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setStatus('down', 'disconnected — retrying…');
    });
}

function updatePrice(symbol, bid, ask) {
  priceMap[symbol] = { bid, ask };
  document.getElementById('asOf').textContent = 'as of ' + new Date().toLocaleTimeString();
  upsertRow(symbol, bid, ask);

  // live-refresh open buy modal
  if (buyTarget?.symbol === symbol) {
    document.getElementById('buyLiveAsk').textContent = ask;
    calcBuyCost();
  }
  // live-refresh open sell modal
  if (sellTarget?.symbol === symbol) refreshSellModal();
}

// ── ROW RENDERING ─────────────────────────────────────────────────────────────
function tvSymbol(sym) { return TV_SYMBOLS[sym] || 'OANDA:' + sym; }

function upsertRow(symbol, bid, ask) {
  const isCommodity = COMMODITY_SYMBOLS.includes(symbol);
  const tbody = document.getElementById(isCommodity ? 'commodityRows' : 'forexRows');
  const label = COMMODITY_LABELS[symbol];

  let entry = rowRegistry.get(symbol);
  if (!entry) {
    const empty = tbody.querySelector('.empty');
    if (empty) empty.closest('tr').remove();

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        ${symbol}
        ${label ? `<span class="symbol-sub">${label}</span>` : ''}
      </td>
      <td class="price-cell">
        <span class="price bid-price"></span>
        <button class="btn-sell-inline" style="display:none" onclick="openSellBySymbol('${symbol}')">Sell</button>
      </td>
      <td class="price-cell">
        <span class="price ask-price"></span>
        <button class="btn-buy-inline" style="display:none" onclick="openBuyModal('${symbol}')">Buy</button>
      </td>
      <td><button class="chart-toggle" onclick="toggleChart('${symbol}')">Chart ▾</button></td>`;
    tbody.appendChild(tr);

    entry = {
      tr,
      bidCell:  tr.querySelector('.bid-price'),
      askCell:  tr.querySelector('.ask-price'),
      buyBtn:   tr.querySelector('.btn-buy-inline'),
      sellBtn:  tr.querySelector('.btn-sell-inline'),
      lastBid: null, lastAsk: null,
      chartRow: null, chartOpen: false
    };
    rowRegistry.set(symbol, entry);
  }

  // show/hide trade buttons based on login state
  if (session) {
    entry.buyBtn.style.display  = '';
    entry.sellBtn.style.display = '';
  }

  flashCell(entry.bidCell, bid, entry.lastBid);
  flashCell(entry.askCell, ask, entry.lastAsk);
  entry.lastBid = bid;
  entry.lastAsk = ask;
}

function flashCell(cell, newVal, oldVal) {
  cell.textContent = newVal;
  cell.classList.remove('flash-up', 'flash-down');
  if (oldVal !== null) {
    if (newVal > oldVal) cell.classList.add('flash-up');
    else if (newVal < oldVal) cell.classList.add('flash-down');
    void cell.offsetWidth;
  }
  setTimeout(() => cell.classList.remove('flash-up', 'flash-down'), 700);
}

// ── CHART ────────────────────────────────────────────────────────────────────
function toggleChart(symbol) {
  const entry = rowRegistry.get(symbol);
  if (!entry) return;
  const btn = entry.tr.querySelector('.chart-toggle');

  if (entry.chartOpen) {
    entry.chartRow?.remove();
    entry.chartRow = null;
    entry.chartOpen = false;
    btn.textContent = 'Chart ▾';
    return;
  }

  const chartRow = document.createElement('tr');
  chartRow.className = 'chart-row';
  const td = document.createElement('td');
  td.colSpan = 5;
  const id = 'tv_' + (widgetCtr++);
  const div = document.createElement('div');
  div.id = id;
  div.className = 'tradingview-widget-container';
  td.appendChild(div);
  chartRow.appendChild(td);
  entry.tr.insertAdjacentElement('afterend', chartRow);
  entry.chartRow = chartRow;
  entry.chartOpen = true;
  btn.textContent = 'Hide chart ▴';

  new TradingView.widget({
    autosize: true, symbol: tvSymbol(symbol), interval: '15',
    timezone: 'Asia/Kolkata', theme: 'dark', style: '1', locale: 'en',
    toolbar_bg: '#11161f', enable_publishing: false, save_image: false,
    container_id: id
  });
}

// ── BUY ──────────────────────────────────────────────────────────────────────
function openBuyModal(symbol) {
  if (!session) return;
  const p = priceMap[symbol];
  if (!p) return alert('No price available yet for ' + symbol);
  buyTarget = { symbol, ask: p.ask };
  document.getElementById('buySymbol').textContent = symbol;
  document.getElementById('buyLiveAsk').textContent = p.ask;
  document.getElementById('buyQty').value = 1;
  calcBuyCost();
  document.getElementById('buyModal').classList.remove('hidden');
}
function closeBuyModal() {
  document.getElementById('buyModal').classList.add('hidden');
  buyTarget = null;
}
function calcBuyCost() {
  const qty = parseFloat(document.getElementById('buyQty').value) || 0;
  const ask = buyTarget ? priceMap[buyTarget.symbol]?.ask || buyTarget.ask : 0;
  document.getElementById('buyCost').textContent = fmtINR(qty * ask);
}
document.getElementById('buyQty').addEventListener('input', calcBuyCost);

async function executeBuy() {
  if (!session || !buyTarget) return;
  const qty   = parseFloat(document.getElementById('buyQty').value);
  const price = priceMap[buyTarget.symbol]?.ask || buyTarget.ask;
  const cost  = qty * price;
  if (qty <= 0) return alert('Enter a valid quantity.');
  if (cost > session.wallet) return alert('❌ Insufficient wallet balance.');

  const newBalance = session.wallet - cost;

  const [posRes, , walRes] = await Promise.all([
    api('addPosition', { mobile: session.mobile, symbol: buyTarget.symbol, side: 'BUY', quantity: qty, entry_price: price }),
    api('placeOrder',  { mobile: session.mobile, symbol: buyTarget.symbol, side: 'BUY', quantity: qty, price }),
    api('updateWalletWithLedger', {
      mobile: session.mobile, newBalance, type: 'DEBIT', amount: cost,
      narration: `BUY ${buyTarget.symbol} x${qty} @ ${price}`
    })
  ]);

  if (posRes.error) return alert('❌ Order failed: ' + JSON.stringify(posRes.error));
  session.wallet = newBalance;
  updateWalletDisplay();
  positions.push(posRes.data);
  renderPositions();
  closeBuyModal();
  alert(`✅ Bought ${qty} × ${buyTarget.symbol} @ ${price}`);
  syncData();
}

// ── SELL ─────────────────────────────────────────────────────────────────────
// Called from the inline Sell button on the price table row
function openSellBySymbol(symbol) {
  if (!session) return;
  const p = priceMap[symbol];
  if (!p) return alert('No price available yet for ' + symbol);
  // if user has an open position for this symbol, pre-fill it
  const existing = positions.find(pos => pos.symbol === symbol);
  if (existing) {
    openSellModal(existing);
  } else {
    // open a fresh short sell
    openSellModal({ symbol, entry_price: p.bid, quantity: 1, id: null, isFresh: true });
  }
}

function openSellModal(pos) {
  sellTarget = pos;
  const isFresh = !!pos.isFresh;
  const p = priceMap[pos.symbol] || {};
  const bid = p.bid || pos.entry_price || 0;

  document.getElementById('sellModalTitle').textContent =
    (isFresh ? 'New Sell: ' : 'Close Position: ') + pos.symbol;
  document.getElementById('sellEntryLabel').textContent = isFresh ? 'Sell Price' : 'Entry Price';
  document.getElementById('sellEntry').textContent      = fmt(bid);
  document.getElementById('sellPnlLabel').textContent   = isFresh ? 'Est. Proceeds' : 'Est. P&L';

  // quantity: fixed for existing positions, editable for fresh sells
  document.getElementById('sellQtyRow').style.display      = isFresh ? 'none' : '';
  document.getElementById('sellQtyInputRow').style.display = isFresh ? '' : 'none';
  if (!isFresh) document.getElementById('sellQtyDisplay').textContent = pos.quantity;
  if (isFresh)  document.getElementById('sellQtyInput').value = 1;

  refreshSellModal();
  document.getElementById('sellModal').classList.remove('hidden');
}

function refreshSellModal() {
  if (!sellTarget) return;
  const isFresh  = !!sellTarget.isFresh;
  const p        = priceMap[sellTarget.symbol] || {};
  const qty      = isFresh
    ? (parseFloat(document.getElementById('sellQtyInput').value) || 1)
    : Math.abs(parseFloat(sellTarget.quantity));
  const isShort  = !isFresh && parseFloat(sellTarget.quantity) < 0;

  // For fresh short: show bid (selling at bid). For closing a short: show ask (buying back at ask).
  const livePrice = isShort ? (p.ask || sellTarget.entry_price) : (p.bid || sellTarget.entry_price || 0);

  const livePriceEl = document.getElementById('sellLiveBid');
  livePriceEl.textContent = livePrice;
  livePriceEl.className   = 'ticker-price';
  document.getElementById('sellTickerLabel').textContent =
    isFresh ? 'Live Bid' : isShort ? 'Live Ask (buy back)' : 'Live Bid';

  let pnlText, pnlColor;
  if (isFresh) {
    // fresh short: wallet will be debited by bid × qty
    pnlText  = '−' + fmtINR(livePrice * qty) + ' (wallet debit)';
    pnlColor = 'var(--down)';
  } else if (isShort) {
    // closing a short: profit = entry − current ask, per unit
    const pnl = (sellTarget.entry_price - livePrice) * qty;
    pnlText  = fmtINR(pnl);
    pnlColor = pnl >= 0 ? 'var(--up)' : 'var(--down)';
  } else {
    // closing a long: profit = current bid − entry, per unit
    const pnl = (livePrice - sellTarget.entry_price) * qty;
    pnlText  = fmtINR(pnl);
    pnlColor = pnl >= 0 ? 'var(--up)' : 'var(--down)';
  }

  document.getElementById('sellPnl').textContent = pnlText;
  document.getElementById('sellPnl').style.color = pnlColor;
}
function closeSellModal() {
  document.getElementById('sellModal').classList.add('hidden');
  sellTarget = null;
}

async function executeSell() {
  if (!session || !sellTarget) return;
  const p      = priceMap[sellTarget.symbol] || {};
  const price  = p.bid || sellTarget.entry_price;
  const isFresh = !!sellTarget.isFresh;
  const qty    = isFresh
    ? (parseFloat(document.getElementById('sellQtyInput').value) || 1)
    : sellTarget.quantity;
  const total  = price * Math.abs(qty);

  if (isFresh) {
    // Fresh short sell — store qty as NEGATIVE, DEBIT wallet (you're selling short,
    // putting up value, not receiving proceeds until you close the position)
    const negQty      = -Math.abs(qty);
    const newBalance  = session.wallet - total;
    if (total > session.wallet) return alert('❌ Insufficient wallet balance.');

    const [posRes] = await Promise.all([
      api('addPosition', {
        mobile: session.mobile, symbol: sellTarget.symbol,
        side: 'SELL', quantity: negQty, entry_price: price
      }),
      api('placeOrder', {
        mobile: session.mobile, symbol: sellTarget.symbol,
        side: 'SELL', quantity: negQty, price
      }),
      api('updateWalletWithLedger', {
        mobile: session.mobile, newBalance, type: 'DEBIT', amount: total,
        narration: `SELL SHORT ${sellTarget.symbol} x${Math.abs(qty)} @ ${price}`
      })
    ]);
    if (posRes.error) return alert('❌ Sell failed: ' + JSON.stringify(posRes.error));
    session.wallet = newBalance;
    updateWalletDisplay();
    positions.push(posRes.data);
    renderPositions();
    closeSellModal();
    alert(`✅ Short sell placed: ${Math.abs(qty)} × ${sellTarget.symbol} @ ${price}\nWallet debited ${fmtINR(total)}`);

  } else {
    // Closing an existing position — credit wallet with proceeds
    const pnl        = (price - sellTarget.entry_price) * Math.abs(sellTarget.quantity);
    const newBalance  = session.wallet + total;

    await Promise.all([
      api('deletePosition', { id: sellTarget.id }),
      api('placeOrder', {
        mobile: session.mobile, symbol: sellTarget.symbol,
        side: 'SELL', quantity: sellTarget.quantity, price
      }),
      api('updateWalletWithLedger', {
        mobile: session.mobile, newBalance, type: 'CREDIT', amount: total,
        narration: `CLOSE ${sellTarget.symbol} x${Math.abs(sellTarget.quantity)} @ ${price}`
      })
    ]);
    session.wallet = newBalance;
    updateWalletDisplay();
    positions = positions.filter(p => p.id !== sellTarget.id);
    renderPositions();
    closeSellModal();
    alert(`✅ Position closed! P&L: ${fmtINR(pnl)}`);
  }
  syncData();
}

// ── POSITIONS ─────────────────────────────────────────────────────────────────
function renderPositions() {
  const panel   = document.getElementById('positionsPanel');
  const content = document.getElementById('positionsContent');
  const pnlEl   = document.getElementById('totalPnL');
  const list    = session?.isAdmin ? allPositions : positions;

  if (!list.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  let total = 0;
  const rows = list.map(pos => {
    const p       = priceMap[pos.symbol] || {};
    const qty     = parseFloat(pos.quantity);
    const isShort = qty < 0;
    const absQty  = Math.abs(qty);
    // shorts use ask for mark-to-market (cost to buy back), longs use bid
    const ltp     = isShort ? (p.ask || pos.entry_price) : (p.bid || pos.entry_price);
    const pnl     = isShort
      ? (pos.entry_price - ltp) * absQty   // profit when price falls
      : (ltp - pos.entry_price) * absQty;  // profit when price rises
    total += pnl;

    const cls        = pnl >= 0 ? 'up' : 'down';
    const sideLabel  = isShort ? '<span class="down">SHORT</span>' : '<span class="up">LONG</span>';
    const qtyDisplay = isShort ? `-${absQty}` : absQty;
    const closeBtn   = !session?.isAdmin
      ? `<button class="btn-danger-sm" onclick='openSellModal(${JSON.stringify(pos)})'>Close</button>`
      : '';

    return `<tr>
      <td>${pos.symbol}${session?.isAdmin ? `<br/><span class="muted">${pos.mobile}</span>` : ''}</td>
      <td>${sideLabel}</td>
      <td>${qtyDisplay}</td>
      <td>${fmt(pos.entry_price)}</td>
      <td>${ltp}</td>
      <td class="${cls}">${fmtINR(pnl)}</td>
      <td>${closeBtn}</td>
    </tr>`;
  }).join('');

  const totalCls = total >= 0 ? 'up' : 'down';
  pnlEl.textContent = `Total P&L: ${fmtINR(total)}`;
  pnlEl.className   = 'pnl-badge ' + totalCls;

  content.innerHTML = `<table class="inner-table">
    <thead><tr>
      <th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>LTP</th><th>P&L</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── ORDER HISTORY ─────────────────────────────────────────────────────────────
function renderHistory() {
  const panel   = document.getElementById('historyPanel');
  const content = document.getElementById('historyContent');
  if (!orderHist.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const rows = [...orderHist].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(o => `<tr>
      <td class="muted">${toIST(o.created_at)}</td>
      <td>${o.symbol}${session?.isAdmin ? `<br/><span class="muted">${o.mobile}</span>` : ''}</td>
      <td class="${o.side === 'BUY' ? 'up' : 'down'}">${o.side}</td>
      <td>${o.quantity}</td>
      <td>${fmt(o.price)}</td>
      <td>${fmtINR(o.quantity * o.price)}</td>
    </tr>`).join('');

  content.innerHTML = `<table class="inner-table">
    <thead><tr><th>Time (IST)</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── LEDGER ───────────────────────────────────────────────────────────────────
function renderLedger() {
  const panel   = document.getElementById('ledgerPanel');
  const content = document.getElementById('ledgerContent');
  const badge   = document.getElementById('ledgerBadge');
  if (!ledgerData.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  if (!session?.isAdmin && ledgerData.length) {
    const latest = [...ledgerData].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    badge.textContent = 'Balance: ' + fmtINR(latest.balance_after);
  } else {
    badge.textContent = '';
  }

  const rows = [...ledgerData].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(e => `<tr>
      <td class="muted">${toIST(e.created_at)}</td>
      ${session?.isAdmin ? `<td class="muted">${e.mobile}</td>` : ''}
      <td class="${e.type === 'CREDIT' ? 'up' : 'down'}">${e.type}</td>
      <td>${fmtINR(e.amount)}</td>
      <td class="accent">${fmtINR(e.balance_after)}</td>
      <td class="muted">${e.narration || '-'}</td>
    </tr>`).join('');

  content.innerHTML = `<table class="inner-table">
    <thead><tr>
      <th>Time (IST)</th>
      ${session?.isAdmin ? '<th>Mobile</th>' : ''}
      <th>Type</th><th>Amount</th><th>Balance After</th><th>Note</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── ADMIN ─────────────────────────────────────────────────────────────────────
function toggleAdminPanel() {
  document.getElementById('adminPanel').classList.toggle('hidden');
}

function renderAdminUsers() {
  const tbody = document.getElementById('userTableBody');
  tbody.innerHTML = allUsers.map(u => `<tr>
    <td class="mono">${u.mobile}</td>
    <td class="muted mono">${u.password}</td>
    <td class="up">${fmtINR(u.wallet_balance)}</td>
    <td>
      <div style="display:flex;gap:6px">
        <button class="btn-sm btn-primary" onclick="adminEditWallet('${u.mobile}',${u.wallet_balance})">Wallet</button>
        <button class="btn-sm btn-ghost" onclick="adminResetPwd('${u.mobile}')">Reset Pwd</button>
      </div>
    </td>
  </tr>`).join('');
  document.getElementById('adminPanel').classList.remove('hidden');
}

async function adminEditWallet(mobile, current) {
  const val = prompt(`New wallet balance for ${mobile}:`, current);
  if (val === null || isNaN(val)) return;
  const newBalance = parseFloat(val);
  const diff = newBalance - current;
  await api('updateWalletWithLedger', {
    mobile, newBalance, type: diff >= 0 ? 'CREDIT' : 'DEBIT',
    amount: Math.abs(diff), narration: 'Admin adjustment'
  });
  alert('✅ Wallet updated');
  syncData();
}

async function adminResetPwd(mobile) {
  const pwd = prompt(`New password for ${mobile}:`);
  if (!pwd) return;
  await api('updateProfile', { mobile, data: { password: pwd } });
  alert('✅ Password updated');
  syncData();
}

// ── CREATE USER ───────────────────────────────────────────────────────────────
function openCreateUserModal()  { document.getElementById('createUserModal').classList.remove('hidden'); }
function closeCreateUserModal() { document.getElementById('createUserModal').classList.add('hidden'); }

async function executeCreateUser() {
  const mobile  = document.getElementById('newUserMobile').value.trim();
  const password = document.getElementById('newUserPassword').value.trim();
  const wallet  = parseFloat(document.getElementById('newUserWallet').value);
  if (!/^\d{10}$/.test(mobile)) return alert('Enter a valid 10-digit mobile number.');
  if (!password) return alert('Enter a password.');
  const res = await api('createUser', { mobile, password, wallet_balance: wallet });
  if (res.error) return alert('❌ ' + JSON.stringify(res.error));
  alert('✅ User created: ' + mobile);
  closeCreateUserModal();
  syncData();
}

// ── JV ENTRY ──────────────────────────────────────────────────────────────────
function openJVModal() {
  if (!session) return;
  document.getElementById('jvTitle').textContent = session.isAdmin ? 'JV Entry' : 'Wallet Adjustment';
  document.getElementById('jvAdminFields').style.display = session.isAdmin ? '' : 'none';
  document.getElementById('jvMobile').value = '';
  document.getElementById('jvAmount').value = '';
  document.getElementById('jvNarration').value = '';
  jvType = 'CREDIT';
  document.getElementById('jvCreditBtn').classList.add('active');
  document.getElementById('jvDebitBtn').classList.remove('active');
  document.getElementById('jvModal').classList.remove('hidden');
}
function closeJVModal() { document.getElementById('jvModal').classList.add('hidden'); }
function setJVType(type) {
  jvType = type;
  document.getElementById('jvCreditBtn').classList.toggle('active', type === 'CREDIT');
  document.getElementById('jvDebitBtn').classList.toggle('active', type === 'DEBIT');
}

async function executeJV() {
  const mobile   = session.isAdmin ? document.getElementById('jvMobile').value.trim() : session.mobile;
  const amount   = parseFloat(document.getElementById('jvAmount').value);
  const narration = document.getElementById('jvNarration').value.trim() || 'Manual adjustment';
  if (session.isAdmin && !/^\d{10}$/.test(mobile)) return alert('Enter a valid mobile number.');
  if (!amount || amount <= 0) return alert('Enter a valid amount.');
  const res = await api('addJVEntry', { mobile, type: jvType, amount, narration });
  if (res.error) return alert('❌ ' + JSON.stringify(res.error));
  alert('✅ Entry saved');
  closeJVModal();
  syncData();
}

// ── SYNC ──────────────────────────────────────────────────────────────────────
function hidePanel(id) { document.getElementById(id).classList.add('hidden'); }

async function syncData() {
  if (!session) return;
  const m = session.mobile;

  if (session.isAdmin) {
    const [posRes, ordRes, ledRes, usrRes] = await Promise.all([
      api('getAllPositions'),
      api('getAllOrders'),
      api('getAllLedger'),
      api('getAllProfiles')
    ]);
    allPositions = posRes.data || [];
    orderHist    = ordRes.data  || [];
    ledgerData   = ledRes.data  || [];
    allUsers     = usrRes.data  || [];
    renderPositions();
    renderHistory();
    renderLedger();
    renderAdminUsers();
  } else {
    // Read directly from Supabase JS client (anon key is safe for reads)
    // so this works even when /api/supabase is unavailable (e.g. local file open)
    const [posRes, ordRes, ledRes, profRes] = await Promise.all([
      sb.from('positions').select('*').eq('mobile', m).order('opened_at', { ascending: false }),
      sb.from('orders').select('*').eq('mobile', m).order('created_at', { ascending: false }),
      sb.from('ledger').select('*').eq('mobile', m).order('created_at', { ascending: false }),
      sb.from('profiles').select('wallet_balance').eq('mobile', m).single()
    ]);
    console.log('[SYNC] positions:', posRes.data, posRes.error);
    console.log('[SYNC] orders:', ordRes.data, ordRes.error);
    console.log('[SYNC] ledger:', ledRes.data, ledRes.error);
    console.log('[SYNC] profile:', profRes.data, profRes.error);
    positions  = posRes.data  || [];
    orderHist  = ordRes.data  || [];
    ledgerData = ledRes.data  || [];
    if (profRes.data) {
      session.wallet = parseFloat(profRes.data.wallet_balance);
      localStorage.setItem('session', JSON.stringify(session));
      updateWalletDisplay();
    }
    renderPositions();
    renderHistory();
    renderLedger();
  }
}

// ── BOOT ─────────────────────────────────────────────────────────────────────
// Attach button handlers on DOM ready as reliable fallback
// (belt-and-suspenders alongside the inline onclick attributes)
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginBtn')?.addEventListener('click', handleLogin);
  document.getElementById('regBtn')?.addEventListener('click', handleRegister);
});

(async () => {
  // Guard: catch obvious placeholder config early so the error is visible
  if (SUPABASE_URL.includes('YOUR_PROJECT_ID') || SUPABASE_ANON_KEY.includes('YOUR_ANON')) {
    setStatus('down', 'config missing');
    console.error('Fill in SUPABASE_URL and SUPABASE_ANON_KEY in script.js');
    return;
  }

  // Price feed — wrapped so a Supabase error never kills login
  try {
    await loadInitialPrices();
  } catch(err) {
    console.error('[BOOT] loadInitialPrices failed:', err);
  }
  try {
    subscribePrices();
  } catch(err) {
    console.error('[BOOT] subscribePrices failed:', err);
  }

  // Restore session
  try {
    const saved = localStorage.getItem('session');
    if (saved) session = JSON.parse(saved);
  } catch { session = null; }

  if (session) {
    console.log('[BOOT] Session found:', session.mobile);
    const overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.style.display = 'none';
    try { bootDashboard(); } catch(err) { console.error('[BOOT] bootDashboard failed:', err); }
    try {
      await syncData();
      console.log('[BOOT] syncData done. positions:', positions.length);
    } catch(err) { console.error('[BOOT] syncData failed:', err); }
  }
})();
