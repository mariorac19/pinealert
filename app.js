'use strict';
/* PineAlert web app — chart: KLineChart Pro (drawing tools, indicators), data: our server. */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* ignore */ } } };

async function api(path, opts = {}) {
  const r = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (r.status === 401) { location.href = '/login.html'; throw new Error('Login required'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}

function toast(html, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = html;
  $('toasts').appendChild(t);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  setTimeout(() => t.remove(), 6000);
}

const fmtPrice = (p, prec) => (typeof p !== 'number' ? '—' : p.toLocaleString('en-US', { minimumFractionDigits: prec ?? 2, maximumFractionDigits: prec ?? 2 }));
const autoPrec = (p) => (!p ? 2 : p >= 1000 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : p >= 0.01 ? 5 : 8);
const fmtAgo = (ms) => { const s = Math.round((Date.now() - ms) / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
const fmtTime = (ms) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const nameOf = (id) => { const [ex, code] = String(id).split(':'); return ex === 'OANDA' ? code.replace('_', '/') : code; };
const exOf = (id) => String(id).split(':')[0];

/* ---------------- periods ---------------- */
const PERIODS = [
  { multiplier: 1, timespan: 'minute', text: '1m', iv: '1m' },
  { multiplier: 5, timespan: 'minute', text: '5m', iv: '5m' },
  { multiplier: 15, timespan: 'minute', text: '15m', iv: '15m' },
  { multiplier: 30, timespan: 'minute', text: '30m', iv: '30m' },
  { multiplier: 1, timespan: 'hour', text: '1H', iv: '1h' },
  { multiplier: 4, timespan: 'hour', text: '4H', iv: '4h' },
  { multiplier: 1, timespan: 'day', text: 'D', iv: '1d' },
  { multiplier: 1, timespan: 'week', text: 'W', iv: '1w' }
];
const ivOf = (period) => (PERIODS.find((p) => p.multiplier === period.multiplier && p.timespan === period.timespan) || PERIODS[0]).iv;
const PERIOD_MS = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5 };

/* ---------------- state ---------------- */
const S = {
  state: null,
  symbol: LS.get('pa.symbol2', 'BINANCE:BTCUSDT'),
  interval: LS.get('pa.interval2', '1m'),
  script: LS.get('pa.script', 'prev-candle-test'),
  es: null,
  quotes: {},
  latestTs: 0
};

const symbolInfo = (id, precision) => ({
  ticker: id, shortName: nameOf(id), name: nameOf(id), exchange: exOf(id),
  market: exOf(id) === 'OANDA' ? 'forex' : 'crypto', pricePrecision: precision ?? (exOf(id) === 'OANDA' ? 5 : 2), volumePrecision: 2
});
const toBar = (c) => ({ timestamp: c.openTime, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });

/* ---------------- datafeed for KLineChart Pro ---------------- */
const datafeed = {
  async searchSymbols(search) {
    try {
      return (await api('/api/search?q=' + encodeURIComponent(search || ''))).map((s) => ({ ...symbolInfo(s.id, s.precision), name: `${s.name} · ${s.kind}` }));
    } catch (_) { return []; }
  },
  async getHistoryKLineData(symbol, period, from, to) {
    const iv = ivOf(period);
    const now = Date.now();
    const initial = to > now - 2 * (PERIOD_MS[period.timespan] * period.multiplier);
    try {
      $('chartMsg').textContent = initial ? 'Loading…' : '';
      const q = new URLSearchParams({ symbol: symbol.ticker, interval: iv });
      if (!initial) q.set('to', String(to + 1));
      const { candles } = await api('/api/history?' + q);
      $('chartMsg').textContent = '';
      if (initial) {
        S.symbol = symbol.ticker; S.interval = iv;
        LS.set('pa.symbol2', S.symbol); LS.set('pa.interval2', S.interval);
        const last = candles[candles.length - 1];
        if (last) {
          const prec = autoPrec(last.close);
          if (prec !== symbol.pricePrecision) setTimeout(() => chart() && chart().setPriceVolumePrecision(prec, 2), 0);
        }
        S.latestTs = last ? last.openTime : 0;
        setTimeout(() => { refreshSignals(); renderWatchlist(); }, 400);
        updateLegend();
      }
      return candles.map(toBar);
    } catch (e) {
      $('chartMsg').textContent = '⚠ ' + e.message;
      return [];
    }
  },
  subscribe(symbol, period, callback) {
    connectStream(symbol.ticker, ivOf(period), callback);
  },
  unsubscribe() { /* the next subscribe replaces the stream */ }
};

/* ---------------- chart ---------------- */
let pro = null;
const chart = () => window.__charts[window.__charts.length - 1];

async function createChart() {
  try { await document.fonts.load('14px icomoon'); } catch (_) { /* ignore */ }
  const period = PERIODS.find((p) => p.iv === S.interval) || PERIODS[0];
  pro = new klinechartspro.KLineChartPro({
    container: $('chart'),
    theme: 'dark',
    locale: 'en-US',
    watermark: '',
    drawingBarVisible: true,
    symbol: symbolInfo(S.symbol),
    period,
    periods: PERIODS,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    mainIndicators: ['MA'],
    subIndicators: ['VOL'],
    datafeed
  });
  registerPineFigures();
}

function setChartSymbol(id) {
  if (!pro) return;
  pro.setSymbol(symbolInfo(id, S.quotes[id] && S.quotes[id].precision));
}

/* ---------------- Pine on the chart: signal arrows + plot lines ---------------- */
let pineLines = [];
function registerPineFigures() {
  klinecharts.registerOverlay({
    name: 'pineSignal', totalStep: 1, lock: true,
    needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay }) => {
      const buy = overlay.extendData > 0;
      const c = coordinates[0];
      const y = c.y + (buy ? 12 : -12);
      const color = buy ? '#2dc08e' : '#f92855';
      return [{
        type: 'polygon',
        attrs: { coordinates: buy ? [{ x: c.x, y: y - 6 }, { x: c.x - 6, y: y + 5 }, { x: c.x + 6, y: y + 5 }] : [{ x: c.x, y: y + 6 }, { x: c.x - 6, y: y - 5 }, { x: c.x + 6, y: y - 5 }] },
        styles: { style: 'fill', color }
      }];
    }
  });
}

function registerPineIndicator(lines) {
  const colors = ['#f0a92b', '#1677ff', '#b06cff', '#2ec4e6', '#ff7ab6', '#9ccc65'];
  const maps = lines.map((l) => new Map(l.data.map((d) => [d.time, d.value])));
  klinecharts.registerIndicator({
    name: 'PINE',
    shortName: (S.state && (S.state.scripts.find((s) => s.id === S.script) || {}).name) || 'Pine',
    series: 'price',
    precision: 4,
    figures: lines.map((l, i) => ({ key: 'p' + i, title: l.name + ': ', type: 'line' })),
    styles: { lines: lines.map((_, i) => ({ color: colors[i % colors.length], size: 1.5, style: 'solid', smooth: false, dashedValue: [2, 2] })) },
    calc: (dataList) => dataList.map((d) => {
      const o = {};
      maps.forEach((m, i) => { const v = m.get(d.timestamp); if (v != null) o['p' + i] = v; });
      return o;
    })
  });
}

let signalTimer = null;
function refreshSignals() {
  clearTimeout(signalTimer);
  signalTimer = setTimeout(async () => {
    const c = chart();
    if (!c) return;
    c.removeOverlay({ groupId: 'pine' });
    if (pineLines.length) { c.removeIndicator('candle_pane', 'PINE'); pineLines = []; }
    if (!S.script) { updateLegend(); return; }
    try {
      const q = new URLSearchParams({ symbol: S.symbol, interval: S.interval, script: S.script });
      const d = await api('/api/signals?' + q);
      if (d.error) { $('chartMsg').textContent = '⚠ Script error: ' + d.error; return; }
      for (const m of d.markers.slice(-400)) {
        const bar = c.getDataList().find((b) => b.timestamp === m.time);
        if (!bar) continue;
        c.createOverlay({ name: 'pineSignal', groupId: 'pine', lock: true, extendData: m.value, points: [{ timestamp: m.time, value: m.value > 0 ? bar.low : bar.high }] });
      }
      if (d.lines && d.lines.length) {
        pineLines = d.lines;
        registerPineIndicator(d.lines);
        c.createIndicator('PINE', true, { id: 'candle_pane' });
      }
      S.signalInfo = { ms: d.ms, count: d.markers.length };
      updateLegend();
    } catch (e) { $('chartMsg').textContent = '⚠ ' + e.message; }
  }, 250);
}

function updateLegend() {
  const sc = S.state && S.state.scripts.find((s) => s.id === S.script);
  $('legend').textContent = sc ? `${nameOf(S.symbol)} · ${S.interval} · ${sc.name}${S.signalInfo ? ` · ${S.signalInfo.count} signals · ${S.signalInfo.ms} ms` : ''}` : `${nameOf(S.symbol)} · ${S.interval}`;
}

/* ---------------- live stream ---------------- */
function setStatus(kind, text) { $('dot').className = 'dot ' + kind; $('statusText').textContent = text; }

function connectStream(symbol, interval, callback) {
  if (S.es) S.es.close();
  const es = new EventSource('/api/stream?' + new URLSearchParams({ symbol, interval }));
  S.es = es;
  es.onopen = () => setStatus('live', 'live');
  es.onerror = () => setStatus('err', 'reconnecting');
  es.addEventListener('candle', (e) => {
    const c = JSON.parse(e.data);
    if (c.openTime < S.latestTs) return;
    S.latestTs = c.openTime;
    callback(toBar(c));
    setStatus('live', 'live');
  });
  es.addEventListener('close', () => refreshSignals());
  es.addEventListener('problem', (e) => { $('chartMsg').textContent = '⚠ ' + JSON.parse(e.data).error; });
  es.addEventListener('signal', (e) => { pendingSignals.push(JSON.parse(e.data)); clearTimeout(signalToastTimer); signalToastTimer = setTimeout(showSignalToasts, 600); });
}

/* Many pairs can fire at once: show up to 3 toasts, otherwise one summary. */
let pendingSignals = [], signalToastTimer = null;
function showSignalToasts() {
  const list = pendingSignals; pendingSignals = [];
  if (list.length > 3) {
    const buys = list.filter((s) => s.value > 0).length;
    toast(`<b>${list.length} signals</b> · ${buys} buy / ${list.length - buys} sell<div class="muted small">${esc(list[0].alert)} · ${list.slice(0, 6).map((s) => esc(s.name || s.symbol)).join(', ')}${list.length > 6 ? '…' : ''} · see Log</div>`);
  } else {
    for (const s of list) {
      const kind = s.value > 0 ? 'buy' : s.value < 0 ? 'sell' : '';
      toast(`<b>${esc(s.label)}</b> ${esc(s.name || s.symbol)} ${esc(s.interval)} @ ${fmtPrice(s.close, autoPrec(s.close))}<div class="muted small">${esc(s.alert)} · Telegram: ${s.telegram === 'ok' ? '✓ sent' : esc(s.telegram)}</div>`, kind);
    }
  }
  loadStateSoon();
}

/* ---------------- sidebar tabs ---------------- */
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + b.dataset.tab));
}));

/* ---------------- state ---------------- */
let stateTimer = null;
const loadStateSoon = () => { clearTimeout(stateTimer); stateTimer = setTimeout(loadState, 800); };
async function loadState() {
  try { S.state = await api('/api/state'); } catch (_) { return; }
  renderScripts(); renderAlerts(); renderLog(); renderSettings(); renderWatchlist(); renderPresets();
}

/* ---------------- watchlist ---------------- */
function renderWatchlist() {
  if (!S.state) return;
  const wl = S.state.watchlist;
  $('wlList').innerHTML = wl.length ? wl.map((id) => {
    const q = S.quotes[id] || {};
    const ch = q.changePct;
    return `<div class="wl-row ${id === S.symbol ? 'on' : ''}" data-sym="${esc(id)}">
      <span class="nm">${esc(nameOf(id))}<small>${esc(exOf(id))}</small></span>
      <span class="num">${q.last != null ? fmtPrice(q.last, q.precision) : '…'}</span>
      <span class="num ${ch > 0 ? 'buy' : ch < 0 ? 'sell' : ''}">${ch != null ? (ch > 0 ? '+' : '') + ch.toFixed(2) + '%' : ''}</span>
      <span class="x" data-del="${esc(id)}" title="Remove">✕</span>
    </div>`;
  }).join('') : '<div class="empty">Your watchlist is empty. Search above to add pairs.</div>';
}

async function loadQuotes() {
  if (!S.state || !S.state.watchlist.length) return;
  try { S.quotes = { ...S.quotes, ...(await api('/api/quotes?symbols=' + encodeURIComponent(S.state.watchlist.join(',')))) }; renderWatchlist(); } catch (_) { /* ignore */ }
}

async function saveWatchlist(list) {
  try { const r = await api('/api/watchlist', { method: 'POST', body: { symbols: list } }); S.state.watchlist = r.watchlist; renderWatchlist(); loadQuotes(); } catch (e) { toast(esc(e.message), 'err'); }
}

$('wlList').addEventListener('click', (e) => {
  const del = e.target.dataset.del;
  if (del) { saveWatchlist(S.state.watchlist.filter((s) => s !== del)); return; }
  const row = e.target.closest('.wl-row');
  if (row) setChartSymbol(row.dataset.sym);
});

let searchTimer = null, searchItems = [], searchActive = -1;
$('wlSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('wlSearch').value.trim();
  if (!q) { $('wlDrop').classList.remove('on'); return; }
  searchTimer = setTimeout(async () => {
    try { searchItems = (await api('/api/search?q=' + encodeURIComponent(q))).slice(0, 30); } catch (_) { searchItems = []; }
    searchActive = -1;
    $('wlDrop').innerHTML = searchItems.map((s, i) => `<div data-i="${i}"><span>${esc(s.name)}</span><span class="muted small">${esc(s.exchange)} · ${esc(s.kind)}</span></div>`).join('') || '<div class="muted">No match</div>';
    $('wlDrop').classList.add('on');
  }, 200);
});
$('wlSearch').addEventListener('keydown', (e) => {
  const rows = $('wlDrop').querySelectorAll('[data-i]');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    searchActive = Math.max(0, Math.min(rows.length - 1, searchActive + (e.key === 'ArrowDown' ? 1 : -1)));
    rows.forEach((r, i) => r.classList.toggle('active', i === searchActive));
  } else if (e.key === 'Enter') {
    const item = searchItems[searchActive >= 0 ? searchActive : 0];
    if (item) addFromSearch(item);
  } else if (e.key === 'Escape') { $('wlDrop').classList.remove('on'); }
});
$('wlDrop').addEventListener('mousedown', (e) => {
  const row = e.target.closest('[data-i]');
  if (row) addFromSearch(searchItems[Number(row.dataset.i)]);
});
$('wlSearch').addEventListener('blur', () => setTimeout(() => $('wlDrop').classList.remove('on'), 150));
function addFromSearch(item) {
  $('wlDrop').classList.remove('on');
  $('wlSearch').value = '';
  if (!S.state.watchlist.includes(item.id)) saveWatchlist([...S.state.watchlist, item.id]);
  setChartSymbol(item.id);
}

function renderPresets() {
  const opts = S.state.presets.filter((p) => !p.oanda || S.state.oanda).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('wlPreset').innerHTML = '<option value="">Add a ready-made list…</option>' + opts;
  $('aPreset').innerHTML = '<option value="">+ Ready-made list…</option>' + opts;
}
$('wlPreset').addEventListener('change', async (e) => {
  const id = e.target.value; e.target.value = '';
  if (!id) return;
  try {
    const { symbols } = await api('/api/presets/' + id);
    await saveWatchlist(Array.from(new Set([...S.state.watchlist, ...symbols])));
    toast(`Added ${symbols.length} pairs to your watchlist`);
  } catch (err) { toast(esc(err.message), 'err'); }
});

/* ---------------- scripts ---------------- */
function renderScripts() {
  const scripts = S.state.scripts;
  const opts = scripts.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}${s.builtIn ? ' (example)' : ''}</option>`).join('');
  $('scriptPick').innerHTML = '<option value="">— none —</option>' + opts;
  if (S.script && !scripts.find((s) => s.id === S.script)) S.script = '';
  $('scriptPick').value = S.script;
  $('aScript').innerHTML = opts;
  const cur = $('scriptEdit').value;
  $('scriptEdit').innerHTML = opts;
  if (cur && scripts.find((s) => s.id === cur)) $('scriptEdit').value = cur;
}
$('scriptPick').addEventListener('change', (e) => { S.script = e.target.value; LS.set('pa.script', S.script); refreshSignals(); });

async function openScript(id) {
  if (!id) return;
  const { source } = await api('/api/scripts/' + encodeURIComponent(id));
  $('scriptId').value = id; $('scriptSrc').value = source; $('checkResult').innerHTML = '';
}
$('scriptEdit').addEventListener('change', (e) => openScript(e.target.value));
$('scriptNew').addEventListener('click', () => {
  $('scriptId').value = 'my-strategy';
  $('scriptSrc').value = '//@version=6\nindicator("My Strategy", overlay = true)\n\nfast = ta.ema(close, 9)\nslow = ta.ema(close, 21)\nbuy  = ta.crossover(fast, slow)\nsell = ta.crossunder(fast, slow)\n\nplot(fast, "EMA 9")\nplot(slow, "EMA 21")\nplot(buy ? 1 : sell ? -1 : 0, "TVX_SIGNAL", display = display.data_window)\n';
  $('checkResult').innerHTML = '';
});
$('scriptCheck').addEventListener('click', async () => {
  $('checkResult').innerHTML = '<p class="muted small">Running…</p>';
  try {
    const r = await api('/api/scripts/check', { method: 'POST', body: { source: $('scriptSrc').value, symbol: S.symbol, interval: S.interval } });
    if (!r.ok) { $('checkResult').innerHTML = `<div class="err-text">✗ ${esc(r.error)}</div>`; return; }
    $('checkResult').innerHTML = `<p class="small buy">✓ Runs fine on ${esc(nameOf(r.symbol))} ${esc(r.interval)} (${r.ms} ms)</p>
      ${'TVX_SIGNAL' in r.plots ? '' : '<div class="err-text">No plot named TVX_SIGNAL — alerts need a signal plot (or set another plot name in the alert).</div>'}
      <div class="plotlist">${Object.entries(r.plots).map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(typeof v === 'number' ? fmtPrice(v, autoPrec(Math.abs(v))) : v)}</span></div>`).join('')}</div>`;
  } catch (e) { $('checkResult').innerHTML = `<div class="err-text">${esc(e.message)}</div>`; }
});
$('scriptSave').addEventListener('click', async () => {
  try {
    const { id } = await api('/api/scripts/' + encodeURIComponent($('scriptId').value.trim()), { method: 'PUT', body: { source: $('scriptSrc').value } });
    toast('Script saved ✓');
    await loadState();
    $('scriptEdit').value = id;
    if (S.script === id) refreshSignals();
  } catch (e) { toast(esc(e.message), 'err'); }
});
$('scriptDelete').addEventListener('click', async () => {
  const id = $('scriptId').value.trim();
  if (!id || !confirm(`Delete script "${id}"?`)) return;
  try { await api('/api/scripts/' + encodeURIComponent(id), { method: 'DELETE' }); toast('Deleted'); $('scriptSrc').value = ''; $('scriptId').value = ''; loadState(); } catch (e) { toast(esc(e.message), 'err'); }
});

/* ---------------- alerts ---------------- */
function renderAlerts() {
  const list = S.state.alerts;
  const scriptName = (id) => (S.state.scripts.find((s) => s.id === id) || {}).name || id;
  if (!list.length) {
    $('alertList').innerHTML = '<div class="empty">No alerts yet.<br><br><button class="primary" onclick="openAlert()">Create your first alert</button></div>';
    return;
  }
  $('alertList').innerHTML = `<div class="muted small" style="margin-bottom:8px">Server load: ${S.state.feeds} of ${S.state.maxFeeds} pair/timeframes</div>` + list.map((a) => {
    const st = a.status;
    const pairs = a.symbols.length === 1 ? esc(nameOf(a.symbols[0])) : `${a.symbols.length} pairs`;
    const statusLine = !a.enabled ? 'paused'
      : !st ? 'starting…'
      : `${st.ok}/${a.symbols.length} pairs running${st.lastRun ? ` · last check ${fmtAgo(st.lastRun)}` : ' · waiting for the next candle close'}${st.queue ? ` · ${st.queue} queued` : ''}`;
    return `<div class="card">
      <div class="row between">
        <b>${esc(a.name)}</b>
        <label class="switch" title="On / off"><input type="checkbox" data-toggle="${a.id}" ${a.enabled ? 'checked' : ''}><span></span></label>
      </div>
      <div class="row wrap" style="margin:6px 0">
        <span class="tag">${pairs}</span><span class="tag">${esc(a.interval)}</span><span class="tag">${esc(scriptName(a.scriptId))}</span>
      </div>
      <div class="muted small">${statusLine}</div>
      ${st && st.errors.length ? `<div class="err-text">${st.errors.slice(0, 3).map((e) => esc(nameOf(e.symbol)) + ': ' + esc(e.error)).join('<br>')}${st.errors.length > 3 ? `<br>…and ${st.errors.length - 3} more` : ''}</div>` : ''}
      ${a.lastError ? `<div class="err-text">${esc(a.lastError)}</div>` : ''}
      <div class="row" style="margin-top:8px">
        <button class="ghost small" data-edit="${a.id}">Edit</button>
        <button class="ghost small danger" data-del="${a.id}" style="margin-left:auto">Delete</button>
      </div>
    </div>`;
  }).join('');
}
$('alertList').addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.edit) openAlert(S.state.alerts.find((a) => a.id === t.dataset.edit));
  if (t.dataset.del && confirm('Delete this alert?')) {
    await api('/api/alerts/' + t.dataset.del, { method: 'DELETE' }).catch((err) => toast(esc(err.message), 'err'));
    loadState();
  }
});
$('alertList').addEventListener('change', async (e) => {
  const id = e.target.dataset.toggle;
  if (!id) return;
  const a = S.state.alerts.find((x) => x.id === id);
  try { await api('/api/alerts', { method: 'POST', body: { ...a, preset: '', enabled: e.target.checked } }); toast(e.target.checked ? 'Alert on' : 'Alert paused'); } catch (err) { toast(esc(err.message), 'err'); e.target.checked = !e.target.checked; }
  loadState();
});

function renderLog() {
  const h = S.state.history;
  $('logList').innerHTML = h.length ? h.map((s) => `
    <div class="log-item">
      <div class="row between">
        <span class="tag ${s.value > 0 ? 'buy' : s.value < 0 ? 'sell' : ''}">${esc(s.label)}</span>
        <span class="mono">${esc(s.name || s.symbol)} ${esc(s.interval)} @ ${fmtPrice(s.close, autoPrec(s.close))}</span>
      </div>
      <div class="row between small muted" style="margin-top:3px"><span>${esc(s.alert)}</span><span>${fmtTime(s.at)}</span></div>
      ${s.telegram !== 'ok' ? `<div class="err-text">Telegram: ${esc(s.telegram)}</div>` : ''}
    </div>`).join('') : '<div class="empty">No signals yet. They appear here and in Telegram when a candle closes with a signal.</div>';
}
$('clearLog').addEventListener('click', async () => { if (confirm('Clear the signal log?')) { await api('/api/history', { method: 'DELETE' }); loadState(); } });

/* alert dialog */
const parseList = (txt) => Array.from(new Set(String(txt).split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)));
function updateCount() { const n = parseList($('aSymbols').value).length; $('aCount').textContent = n ? `(${n})` : ''; }
function addToPairs(list) { $('aSymbols').value = parseList($('aSymbols').value + ',' + list.join(',')).join(', '); updateCount(); }
$('aSymbols').addEventListener('input', updateCount);
$('aUseChart').addEventListener('click', () => addToPairs([S.symbol]));
$('aUseWatch').addEventListener('click', () => addToPairs(S.state.watchlist));
$('aClear').addEventListener('click', () => { $('aSymbols').value = ''; updateCount(); });
$('aPreset').addEventListener('change', async (e) => {
  const id = e.target.value; e.target.value = '';
  if (!id) return;
  try { addToPairs((await api('/api/presets/' + id)).symbols); } catch (err) { $('aError').textContent = err.message; }
});

function openAlert(a) {
  const isNew = !a;
  a = a || { name: '', symbols: [S.symbol], interval: S.interval, scriptId: S.script || (S.state.scripts[0] || {}).id, plot: 'TVX_SIGNAL', trigger: 'signal', labels: '1=BUY,-1=SELL', template: '', enabled: true };
  $('alertTitle').textContent = isNew ? 'Create alert' : 'Edit alert';
  $('alertForm').dataset.id = isNew ? '' : a.id;
  $('alertForm').dataset.enabled = a.enabled !== false ? '1' : '';
  $('aName').value = a.name;
  $('aSymbols').value = a.symbols.join(', ');
  $('aInterval').innerHTML = S.state.intervals.map((i) => `<option>${i}</option>`).join('');
  $('aInterval').value = a.interval;
  $('aScript').value = a.scriptId;
  $('aPlot').value = a.plot;
  $('aTrigger').value = a.trigger;
  $('aLabels').value = a.labels;
  $('aTemplate').value = a.template || '';
  $('aError').textContent = '';
  updateCount();
  $('alertModal').classList.add('on');
}
window.openAlert = openAlert;
$('newAlert').addEventListener('click', () => openAlert());
$('alertCancel').addEventListener('click', () => $('alertModal').classList.remove('on'));
$('alertModal').addEventListener('mousedown', (e) => { if (e.target.id === 'alertModal') $('alertModal').classList.remove('on'); });
$('alertForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('aSave').disabled = true; $('aError').textContent = '';
  try {
    await api('/api/alerts', {
      method: 'POST',
      body: {
        id: f.dataset.id || undefined, enabled: f.dataset.enabled === '1' || !f.dataset.id,
        name: $('aName').value, symbols: parseList($('aSymbols').value), interval: $('aInterval').value, scriptId: $('aScript').value,
        plot: $('aPlot').value, trigger: $('aTrigger').value, labels: $('aLabels').value, template: $('aTemplate').value
      }
    });
    $('alertModal').classList.remove('on');
    toast('Alert saved ✓ — it runs on the server even when this page is closed.', 'buy');
    loadState();
  } catch (err) { $('aError').textContent = err.message; }
  $('aSave').disabled = false;
});

/* ---------------- settings ---------------- */
function renderSettings() {
  const st = S.state;
  const tg = st.settings.telegram;
  $('tgState').innerHTML = tg.tokenSet ? `Bot connected <span class="mono">${esc(tg.tokenHint)}</span>` : '<span class="sell">No bot token yet — alerts won\'t reach your phone.</span>';
  if (document.activeElement !== $('tgChat')) $('tgChat').value = tg.chatId || '';
  if (document.activeElement !== $('template')) $('template').value = st.settings.template;
  const p = st.persistence;
  $('storageCard').innerHTML = `<b>Saving</b><div class="small ${p.enabled && p.status.startsWith('ok') ? 'buy' : 'sell'}" style="margin-top:4px">${
    p.enabled ? (p.status.startsWith('ok') ? `✓ Alerts, scripts and watchlist are saved to your private GitHub repo <span class="mono">${esc(p.repo)}</span>${p.lastSync ? ' · last save ' + fmtAgo(p.lastSync) : ''}` : 'GitHub saving problem: ' + esc(p.status))
      : '⚠ Not saved permanently: changes are lost when the free server restarts. Add GITHUB_TOKEN and GITHUB_DATA_REPO in Render → Environment.'}</div>`;
  $('serverInfo').innerHTML = `Data: ${st.simulated ? '<b class="sell">SIMULATED</b> (test mode)' : 'Binance' + (st.oanda ? ' + OANDA' : ' (forex off: add OANDA_TOKEN)')} · Pair/timeframes running: ${st.feeds}${st.passwordProtected ? ' · <a href="/logout" style="color:inherit">Log out</a>' : ''}`;
}
$('tgSave').addEventListener('click', async () => { try { await api('/api/settings', { method: 'POST', body: { telegram: { chatId: $('tgChat').value } } }); toast('Saved ✓'); loadState(); } catch (e) { toast(esc(e.message), 'err'); } });
$('tgTest').addEventListener('click', async () => { try { await api('/api/telegram/test', { method: 'POST' }); toast('Test message sent — check Telegram ✓', 'buy'); } catch (e) { toast('Telegram: ' + esc(e.message), 'err'); } });
$('tgFind').addEventListener('click', async () => {
  try {
    const { chats } = await api('/api/telegram/find', { method: 'POST', body: {} });
    if (!chats.length) return toast('No messages found. Send any message to your bot, then click Find again.', 'err');
    $('tgChat').value = chats[chats.length - 1].id;
    toast('Found: ' + chats.map((c) => esc(c.name) + ' (' + c.id + ')').join(', ') + ' — click Save.');
  } catch (e) { toast('Telegram: ' + esc(e.message), 'err'); }
});
$('templateSave').addEventListener('click', async () => { try { await api('/api/settings', { method: 'POST', body: { template: $('template').value } }); toast('Format saved ✓'); } catch (e) { toast(esc(e.message), 'err'); } });

/* ---------------- start ---------------- */
loadState().then(async () => {
  await createChart();
  openScript($('scriptEdit').value);
  loadQuotes();
});
setInterval(loadState, 15000);
setInterval(loadQuotes, 10000);
