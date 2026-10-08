'use strict';
/* PineAlert web app: chart (Lightweight Charts™ by TradingView), alerts, scripts, settings. */

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

function toast(text, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = text;
  $('toasts').appendChild(t);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  setTimeout(() => t.remove(), 6000);
}

const fmtPrice = (p) => (typeof p !== 'number' ? '—' : Math.abs(p) >= 100 ? p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(Number(p.toPrecision(6))));
const fmtAgo = (ms) => { const s = Math.round((Date.now() - ms) / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
const fmtTime = (ms) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ---------------- state ---------------- */
const S = {
  symbol: LS.get('pa.symbol', 'BTCUSDT'),
  interval: LS.get('pa.interval', '1m'),
  script: LS.get('pa.script', 'prev-candle-test'),
  state: null,
  es: null
};
const QUICK_TF = ['1m', '5m', '15m', '1h', '4h', '1d'];

/* ---------------- chart ---------------- */
const LWC = window.LightweightCharts;
const css = getComputedStyle(document.documentElement);
const color = (v) => css.getPropertyValue(v).trim();
const chart = LWC.createChart($('chart'), {
  autoSize: true,
  localization: { locale: 'en-US' },
  layout: { background: { type: 'solid', color: color('--bg') }, textColor: color('--muted'), fontSize: 12 },
  grid: { vertLines: { color: '#171c27' }, horzLines: { color: '#171c27' } },
  rightPriceScale: { borderColor: color('--line') },
  timeScale: { borderColor: color('--line'), timeVisible: true, secondsVisible: false, rightOffset: 6 },
  crosshair: { mode: 0 }
});
const candleSeries = chart.addSeries(LWC.CandlestickSeries, {
  upColor: color('--buy'), downColor: color('--sell'), borderVisible: false,
  wickUpColor: color('--buy'), wickDownColor: color('--sell')
});
const markerApi = LWC.createSeriesMarkers(candleSeries, []);
let lineSeries = [];
const LINE_COLORS = ['#f0a92b', '#3d7bfd', '#b06cff', '#2ec4e6', '#ff7ab6', '#9ccc65'];

function applyChart(data) {
  candleSeries.setData(data.candles.map((c) => ({ time: c.openTime / 1000, open: c.open, high: c.high, low: c.low, close: c.close })));
  applyStudy(data);
  const last = data.candles[data.candles.length - 1];
  if (last) $('price').textContent = fmtPrice(last.close);
}

function applyStudy(data) {
  const many = data.markers.length > 150;
  markerApi.setMarkers(data.markers.map((m) => ({
    time: m.time / 1000,
    position: m.value > 0 ? 'belowBar' : 'aboveBar',
    color: m.value > 0 ? color('--buy') : color('--sell'),
    shape: m.value > 0 ? 'arrowUp' : 'arrowDown',
    text: many ? '' : (m.value > 0 ? 'BUY' : 'SELL')
  })));
  lineSeries.forEach((s) => chart.removeSeries(s));
  lineSeries = (data.lines || []).map((l, i) => {
    const s = chart.addSeries(LWC.LineSeries, { color: LINE_COLORS[i % LINE_COLORS.length], lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: l.name });
    s.setData(l.data.map((d) => ({ time: d.time / 1000, value: d.value })));
    return s;
  });
  const scriptName = (S.state && (S.state.scripts.find((s) => s.id === S.script) || {}).name) || '';
  $('legend').innerHTML = S.script
    ? `<span>${esc(S.symbol)} · ${esc(S.interval)}</span><span class="muted">${esc(scriptName)}${data.ms != null ? ` · ${data.ms}ms` : ''}</span>`
    : `<span>${esc(S.symbol)} · ${esc(S.interval)}</span>`;
  $('chartMsg').textContent = data.error ? '⚠ Script error: ' + data.error : '';
}

async function loadChart(fit) {
  $('chartMsg').textContent = 'Loading…';
  try {
    const q = new URLSearchParams({ symbol: S.symbol, interval: S.interval, script: S.script });
    const data = await api('/api/chart?' + q);
    applyChart(data);
    if (fit) chart.timeScale().scrollToRealTime();
    if (!data.candles.length) $('chartMsg').textContent = 'No data yet for ' + S.symbol + ' — check the symbol exists on Binance.';
  } catch (e) {
    $('chartMsg').textContent = '⚠ ' + e.message;
  }
}

let studyTimer = null;
async function refreshStudy() {
  clearTimeout(studyTimer);
  studyTimer = setTimeout(async () => {
    try {
      const q = new URLSearchParams({ symbol: S.symbol, interval: S.interval, script: S.script });
      applyStudy(await api('/api/chart?' + q));
    } catch (_) { /* next close will retry */ }
  }, 400);
}

function setStatus(kind, text) {
  $('dot').className = 'dot ' + kind;
  $('statusText').textContent = text;
}

function connectStream() {
  if (S.es) S.es.close();
  const es = new EventSource('/api/stream?' + new URLSearchParams({ symbol: S.symbol, interval: S.interval }));
  S.es = es;
  es.onopen = () => setStatus('live', 'live');
  es.onerror = () => setStatus('err', 'reconnecting');
  es.addEventListener('candle', (e) => {
    const c = JSON.parse(e.data);
    candleSeries.update({ time: c.openTime / 1000, open: c.open, high: c.high, low: c.low, close: c.close });
    $('price').textContent = fmtPrice(c.close);
    $('price').className = 'price ' + (c.close >= c.open ? 'buy' : 'sell');
    setStatus('live', 'live');
  });
  es.addEventListener('close', () => refreshStudy());
  es.addEventListener('signal', (e) => {
    const s = JSON.parse(e.data);
    const kind = s.value > 0 ? 'buy' : s.value < 0 ? 'sell' : '';
    toast(`<b>${esc(s.label)}</b> ${esc(s.symbol)} ${esc(s.interval)} @ ${fmtPrice(s.close)}<div class="muted small">${esc(s.alert)} · Telegram: ${s.telegram === 'ok' ? '✓ sent' : esc(s.telegram)}</div>`, kind);
    loadState();
  });
}

function switchMarket() {
  S.symbol = $('symbol').value.toUpperCase().trim() || 'BTCUSDT';
  $('symbol').value = S.symbol;
  LS.set('pa.symbol', S.symbol);
  LS.set('pa.interval', S.interval);
  renderTfs();
  loadChart(true);
  connectStream();
}

function renderTfs() {
  $('tfs').innerHTML = QUICK_TF.map((tf) => `<button data-tf="${tf}" class="${tf === S.interval ? 'on' : ''}">${tf}</button>`).join('');
}
$('tfs').addEventListener('click', (e) => {
  const tf = e.target.dataset.tf;
  if (!tf) return;
  S.interval = tf;
  switchMarket();
});
$('symbol').addEventListener('keydown', (e) => { if (e.key === 'Enter') { switchMarket(); e.target.blur(); } });
$('scriptPick').addEventListener('change', (e) => { S.script = e.target.value; LS.set('pa.script', S.script); loadChart(false); });

/* ---------------- sidebar tabs ---------------- */
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + b.dataset.tab));
}));

/* ---------------- state: alerts, log, scripts, settings ---------------- */
async function loadState() {
  try {
    S.state = await api('/api/state');
  } catch (e) { return; }
  renderScripts();
  renderAlerts();
  renderLog();
  renderSettings();
}

function renderScripts() {
  const opts = S.state.scripts.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  $('scriptPick').innerHTML = '<option value="">— no script —</option>' + opts;
  if (!S.state.scripts.find((s) => s.id === S.script)) S.script = '';
  $('scriptPick').value = S.script;
  $('aScript').innerHTML = opts;
  const cur = $('scriptEdit').value;
  $('scriptEdit').innerHTML = opts;
  if (cur && S.state.scripts.find((s) => s.id === cur)) $('scriptEdit').value = cur;
}

function renderAlerts() {
  const list = S.state.alerts;
  if (!list.length) {
    $('alertList').innerHTML = '<div class="empty">No alerts yet.<br><br><button class="primary" onclick="openAlert()">Create your first alert</button></div>';
    return;
  }
  $('alertList').innerHTML = list.map((a) => {
    const lc = a.lastCheck;
    const v = lc && lc.value;
    const val = lc ? `last candle: <span class="mono ${v > 0 ? 'buy' : v < 0 ? 'sell' : ''}">${v ?? 'na'}</span> · ${fmtAgo(lc.at)}` : (a.enabled ? 'waiting for the next candle close…' : 'paused');
    return `<div class="card">
      <div class="row between">
        <b>${esc(a.name)}</b>
        <label class="switch" title="On / off"><input type="checkbox" data-toggle="${a.id}" ${a.enabled ? 'checked' : ''}><span></span></label>
      </div>
      <div class="row" style="margin:6px 0;flex-wrap:wrap">
        <span class="tag">${esc(a.symbol)}</span><span class="tag">${esc(a.interval)}</span>
        <span class="tag">${esc((S.state.scripts.find((s) => s.id === a.scriptId) || {}).name || a.scriptId)}</span>
      </div>
      <div class="muted small">${val}</div>
      ${a.lastError ? `<div class="err-text">${esc(a.lastError)}</div>` : ''}
      <div class="row" style="margin-top:8px">
        <button class="ghost small" data-show="${a.id}">Show on chart</button>
        <button class="ghost small" data-edit="${a.id}">Edit</button>
        <button class="ghost small danger" data-del="${a.id}" style="margin-left:auto">Delete</button>
      </div>
    </div>`;
  }).join('');
}

$('alertList').addEventListener('click', async (e) => {
  const t = e.target;
  const find = (id) => S.state.alerts.find((a) => a.id === id);
  if (t.dataset.edit) openAlert(find(t.dataset.edit));
  if (t.dataset.show) {
    const a = find(t.dataset.show);
    S.symbol = a.symbol; S.interval = a.interval; S.script = a.scriptId;
    $('symbol').value = a.symbol; $('scriptPick').value = a.scriptId; LS.set('pa.script', a.scriptId);
    switchMarket();
  }
  if (t.dataset.del && confirm('Delete this alert?')) {
    await api('/api/alerts/' + t.dataset.del, { method: 'DELETE' }).catch((err) => toast(esc(err.message), 'err'));
    loadState();
  }
});
$('alertList').addEventListener('change', async (e) => {
  const id = e.target.dataset.toggle;
  if (!id) return;
  const a = S.state.alerts.find((x) => x.id === id);
  try {
    await api('/api/alerts', { method: 'POST', body: { ...a, enabled: e.target.checked } });
    toast(e.target.checked ? 'Alert on' : 'Alert paused');
  } catch (err) { toast(esc(err.message), 'err'); }
  loadState();
});

function renderLog() {
  const h = S.state.history;
  $('logList').innerHTML = h.length ? h.map((s) => `
    <div class="log-item">
      <div class="row between">
        <span class="tag ${s.value > 0 ? 'buy' : s.value < 0 ? 'sell' : ''}">${esc(s.label)}</span>
        <span class="mono">${esc(s.symbol)} ${esc(s.interval)} @ ${fmtPrice(s.close)}</span>
      </div>
      <div class="row between small muted" style="margin-top:3px">
        <span>${esc(s.alert)}</span><span>${fmtTime(s.at)}</span>
      </div>
      ${s.telegram !== 'ok' ? `<div class="err-text">Telegram: ${esc(s.telegram)}</div>` : ''}
    </div>`).join('') : '<div class="empty">No signals yet. They appear here and in Telegram when a candle closes with a signal.</div>';
}
$('clearLog').addEventListener('click', async () => { if (confirm('Clear the signal log?')) { await api('/api/history', { method: 'DELETE' }); loadState(); } });

function renderSettings() {
  const tg = S.state.settings.telegram;
  $('tgState').innerHTML = tg.tokenSet
    ? `Connected bot <span class="mono">${esc(tg.tokenHint)}</span>${tg.fromEnv ? ' (set on the server)' : ''}`
    : '<span class="sell">Not set up yet — alerts won\'t reach your phone.</span>';
  if (document.activeElement !== $('tgChat')) $('tgChat').value = tg.chatId || '';
  if (document.activeElement !== $('template')) $('template').value = S.state.settings.template;
  $('serverInfo').innerHTML = `Data: ${S.state.simulated ? '<b class="sell">SIMULATED</b> (test mode)' : 'Binance live'} · Active feeds: ${S.state.feeds.map((f) => `${esc(f.symbol)} ${esc(f.interval)} (${esc(f.status)})`).join(', ') || 'none'}${S.state.passwordProtected ? ' · <a href="/logout" style="color:inherit">Log out</a>' : ''}`;
}

$('tgSave').addEventListener('click', async () => {
  try {
    await api('/api/settings', { method: 'POST', body: { telegram: { token: $('tgToken').value, chatId: $('tgChat').value } } });
    $('tgToken').value = '';
    toast('Telegram saved ✓');
    loadState();
  } catch (e) { toast(esc(e.message), 'err'); }
});
$('tgTest').addEventListener('click', async () => {
  try { await api('/api/telegram/test', { method: 'POST' }); toast('Test message sent — check Telegram ✓', 'buy'); } catch (e) { toast('Telegram: ' + esc(e.message), 'err'); }
});
$('tgFind').addEventListener('click', async () => {
  try {
    const { chats } = await api('/api/telegram/find', { method: 'POST', body: { token: $('tgToken').value } });
    if (!chats.length) return toast('No messages found. Send any message to your bot, then click Find again.', 'err');
    $('tgChat').value = chats[chats.length - 1].id;
    toast('Found: ' + chats.map((c) => esc(c.name) + ' (' + c.id + ')').join(', ') + ' — click Save.');
  } catch (e) { toast('Telegram: ' + esc(e.message), 'err'); }
});
$('templateSave').addEventListener('click', async () => {
  try { await api('/api/settings', { method: 'POST', body: { template: $('template').value } }); toast('Format saved ✓'); } catch (e) { toast(esc(e.message), 'err'); }
});

/* ---------------- alert dialog ---------------- */
function openAlert(a) {
  const isNew = !a;
  a = a || { name: `${S.symbol} ${S.interval}`, symbol: S.symbol, interval: S.interval, scriptId: S.script || (S.state.scripts[0] || {}).id, plot: 'TVX_SIGNAL', trigger: 'signal', labels: '1=BUY,-1=SELL', template: '', enabled: true };
  $('alertTitle').textContent = isNew ? 'Create alert' : 'Edit alert';
  $('alertForm').dataset.id = isNew ? '' : a.id;
  $('alertForm').dataset.enabled = a.enabled !== false ? '1' : '';
  $('aName').value = a.name;
  $('aSymbol').value = a.symbol;
  $('aInterval').innerHTML = S.state.intervals.map((i) => `<option>${i}</option>`).join('');
  $('aInterval').value = a.interval;
  $('aScript').value = a.scriptId;
  $('aPlot').value = a.plot;
  $('aTrigger').value = a.trigger;
  $('aLabels').value = a.labels;
  $('aTemplate').value = a.template || '';
  $('alertModal').classList.add('on');
}
window.openAlert = openAlert;
$('newAlert').addEventListener('click', () => openAlert());
$('alertCancel').addEventListener('click', () => $('alertModal').classList.remove('on'));
$('alertModal').addEventListener('click', (e) => { if (e.target.id === 'alertModal') $('alertModal').classList.remove('on'); });
$('alertForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/alerts', {
      method: 'POST',
      body: {
        id: f.dataset.id || undefined, enabled: f.dataset.enabled === '1' || !f.dataset.id,
        name: $('aName').value, symbol: $('aSymbol').value, interval: $('aInterval').value, scriptId: $('aScript').value,
        plot: $('aPlot').value, trigger: $('aTrigger').value, labels: $('aLabels').value, template: $('aTemplate').value
      }
    });
    $('alertModal').classList.remove('on');
    toast('Alert saved ✓ — it runs on the server even when this page is closed.', 'buy');
    loadState();
  } catch (err) { toast(esc(err.message), 'err'); }
});

/* ---------------- script editor ---------------- */
async function openScript(id) {
  if (!id) return;
  const { source } = await api('/api/scripts/' + encodeURIComponent(id));
  $('scriptId').value = id;
  $('scriptSrc').value = source;
  $('checkResult').innerHTML = '';
}
$('scriptEdit').addEventListener('change', (e) => openScript(e.target.value));
$('scriptNew').addEventListener('click', () => {
  $('scriptId').value = 'my-strategy';
  $('scriptSrc').value = '//@version=6\nindicator("My Strategy", overlay = true)\n\nbuy  = ta.crossover(ta.ema(close, 9), ta.ema(close, 21))\nsell = ta.crossunder(ta.ema(close, 9), ta.ema(close, 21))\n\nplot(ta.ema(close, 9), "EMA 9")\nplot(ta.ema(close, 21), "EMA 21")\nplot(buy ? 1 : sell ? -1 : 0, "TVX_SIGNAL", display = display.data_window)\n';
  $('checkResult').innerHTML = '';
});
$('scriptCheck').addEventListener('click', async () => {
  $('checkResult').innerHTML = '<p class="muted small">Running…</p>';
  try {
    const r = await api('/api/scripts/check', { method: 'POST', body: { source: $('scriptSrc').value, symbol: S.symbol, interval: S.interval } });
    if (!r.ok) { $('checkResult').innerHTML = `<div class="err-text">✗ ${esc(r.error)}</div>`; return; }
    const hasSig = 'TVX_SIGNAL' in r.plots;
    $('checkResult').innerHTML = `<p class="small buy">✓ Runs fine on ${esc(S.symbol)} ${esc(S.interval)} (${r.ms} ms)</p>
      ${hasSig ? '' : '<div class="err-text">No plot named TVX_SIGNAL — alerts need a signal plot (or set another plot name in the alert).</div>'}
      <div class="plotlist">${Object.entries(r.plots).map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(typeof v === 'number' ? fmtPrice(v) : v)}</span></div>`).join('')}</div>`;
  } catch (e) { $('checkResult').innerHTML = `<div class="err-text">${esc(e.message)}</div>`; }
});
$('scriptSave').addEventListener('click', async () => {
  try {
    const { id } = await api('/api/scripts/' + encodeURIComponent($('scriptId').value.trim()), { method: 'PUT', body: { source: $('scriptSrc').value } });
    toast('Script saved ✓');
    await loadState();
    $('scriptEdit').value = id;
    if (S.script === id) loadChart(false);
  } catch (e) { toast(esc(e.message), 'err'); }
});
$('scriptDelete').addEventListener('click', async () => {
  const id = $('scriptId').value.trim();
  if (!id || !confirm(`Delete script "${id}"?`)) return;
  try {
    await api('/api/scripts/' + encodeURIComponent(id), { method: 'DELETE' });
    toast('Deleted');
    $('scriptSrc').value = ''; $('scriptId').value = '';
    loadState();
  } catch (e) { toast(esc(e.message), 'err'); }
});

/* ---------------- start ---------------- */
$('symbol').value = S.symbol;
renderTfs();
loadState().then(() => {
  openScript($('scriptEdit').value);
  loadChart(true);
  connectStream();
});
setInterval(loadState, 15000);
