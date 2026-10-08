// server.js
import http from "node:http";
import fs2 from "node:fs";
import path2 from "node:path";
import crypto2 from "node:crypto";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// lib/feed.js
import { EventEmitter } from "node:events";
var MAX_CANDLES = 1e3;
var INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w"];
var INTERVAL_MS = {
  "1m": 6e4,
  "3m": 18e4,
  "5m": 3e5,
  "15m": 9e5,
  "30m": 18e5,
  "1h": 36e5,
  "2h": 72e5,
  "4h": 144e5,
  "6h": 216e5,
  "8h": 288e5,
  "12h": 432e5,
  "1d": 864e5,
  "3d": 2592e5,
  "1w": 6048e5
};
var REST = process.env.BINANCE_REST || "https://data-api.binance.vision";
var WS = process.env.BINANCE_WS || "wss://data-stream.binance.vision/ws";
var log = (...a) => console.log((/* @__PURE__ */ new Date()).toISOString(), "[feed]", ...a);
var Feed = class extends EventEmitter {
  constructor(symbol, interval) {
    super();
    this.symbol = symbol;
    this.interval = interval;
    this.candles = [];
    this.status = "starting";
    this.lastMessageAt = 0;
  }
  get key() {
    return `${this.symbol}|${this.interval}`;
  }
  /** Only fully closed candles (what alerts are computed on). */
  closedCandles() {
    const now = Date.now();
    return this.candles.filter((c) => c.closed || c.closeTime < now);
  }
  _upsert(c, closed) {
    const last = this.candles[this.candles.length - 1];
    const candle = { ...c, closed: !!closed };
    if (last && last.openTime === c.openTime) {
      this.candles[this.candles.length - 1] = candle;
    } else if (!last || c.openTime > last.openTime) {
      if (last && !last.closed) {
        last.closed = true;
        this.emit("close", last);
      }
      this.candles.push(candle);
      if (this.candles.length > MAX_CANDLES) this.candles.splice(0, this.candles.length - MAX_CANDLES);
    } else {
      return;
    }
    this.lastMessageAt = Date.now();
    this.emit("update", candle);
    if (closed && !(last && last.openTime === c.openTime && last.closed)) this.emit("close", candle);
  }
  info() {
    return { symbol: this.symbol, interval: this.interval, status: this.status, candles: this.candles.length, lastMessageAt: this.lastMessageAt };
  }
};
var BinanceFeed = class extends Feed {
  async start() {
    this.stopped = false;
    await this._loadHistory();
    this._connect();
    this.watchdog = setInterval(() => {
      if (this.ws && Date.now() - this.lastMessageAt > 9e4) {
        log(this.key, "stream silent, reconnecting");
        try {
          this.ws.close();
        } catch (_) {
        }
      }
    }, 3e4);
  }
  async _loadHistory() {
    const url = `${REST}/api/v3/klines?symbol=${this.symbol}&interval=${this.interval}&limit=1000`;
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text().catch(() => "")}`.slice(0, 200));
        const rows = await r.json();
        const now = Date.now();
        const fresh = rows.map((k) => ({
          openTime: k[0],
          open: +k[1],
          high: +k[2],
          low: +k[3],
          close: +k[4],
          volume: +k[5],
          closeTime: k[6],
          closed: k[6] < now
        }));
        if (!this.candles.length) {
          this.candles = fresh;
        } else {
          const lastT = this.candles[this.candles.length - 1].openTime;
          for (const c of fresh) if (c.openTime >= lastT) this._upsert(c, c.closed);
        }
        this.lastMessageAt = Date.now();
        log(this.key, `history loaded (${fresh.length} candles)`);
        return;
      } catch (e) {
        this.status = "error: " + e.message;
        log(this.key, "history failed:", e.message);
        if (this.stopped) return;
        await new Promise((r) => setTimeout(r, Math.min(3e4, 2e3 * attempt)));
      }
    }
  }
  _connect() {
    if (this.stopped) return;
    const url = `${WS}/${this.symbol.toLowerCase()}@kline_${this.interval}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.status = "live";
      this.retry = 0;
      log(this.key, "stream connected");
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        const k = m.k;
        if (!k) return;
        this._upsert({ openTime: k.t, closeTime: k.T, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v }, k.x);
      } catch (_) {
      }
    };
    ws.onerror = () => {
    };
    ws.onclose = async () => {
      if (this.stopped) return;
      this.status = "reconnecting";
      this.retry = (this.retry || 0) + 1;
      const wait = Math.min(3e4, 1e3 * 2 ** Math.min(this.retry, 5));
      log(this.key, `stream closed, retry in ${wait / 1e3}s`);
      await new Promise((r) => setTimeout(r, wait));
      await this._loadHistory();
      this._connect();
    };
  }
  stop() {
    this.stopped = true;
    clearInterval(this.watchdog);
    try {
      this.ws && this.ws.close();
    } catch (_) {
    }
  }
};
var SimFeed = class extends Feed {
  async start() {
    const step = Number(process.env.SIM_MS || 3e3);
    const iv = INTERVAL_MS[this.interval] || 6e4;
    let t = Math.floor(Date.now() / iv) * iv - 300 * iv;
    let p = 65e3;
    const mk = (time) => {
      const o = p;
      const c = +(p + (Math.random() - 0.5) * 120).toFixed(2);
      p = c;
      return { openTime: time, closeTime: time + iv - 1, open: o, close: c, high: +(Math.max(o, c) + Math.random() * 40).toFixed(2), low: +(Math.min(o, c) - Math.random() * 40).toFixed(2), volume: +(Math.random() * 10).toFixed(3) };
    };
    for (let i = 0; i < 300; i++) {
      this.candles.push({ ...mk(t), closed: true });
      t += iv;
    }
    this.status = "live (simulated)";
    let live = mk(t);
    this._upsert(live, false);
    let ticks = 0;
    this.timer = setInterval(() => {
      ticks++;
      if (ticks % 3 === 0) {
        this._upsert(live, true);
        t += iv;
        live = mk(t);
        this._upsert(live, false);
      } else {
        live = { ...live, close: +(live.close + (Math.random() - 0.5) * 30).toFixed(2) };
        live.high = Math.max(live.high, live.close);
        live.low = Math.min(live.low, live.close);
        this._upsert(live, false);
      }
    }, step / 3);
  }
  stop() {
    clearInterval(this.timer);
  }
};
var FeedManager = class {
  constructor() {
    this.feeds = /* @__PURE__ */ new Map();
    this.users = /* @__PURE__ */ new Map();
  }
  async acquire(symbol, interval, user) {
    const key = `${symbol}|${interval}`;
    let f = this.feeds.get(key);
    if (!f) {
      f = process.env.FEED === "sim" ? new SimFeed(symbol, interval) : new BinanceFeed(symbol, interval);
      f.setMaxListeners(100);
      this.feeds.set(key, f);
      this.users.set(key, /* @__PURE__ */ new Set());
      f.ready = f.start().catch((e) => log(key, "start failed", e.message));
    }
    this.users.get(key).add(user);
    await f.ready;
    return f;
  }
  release(symbol, interval, user) {
    const key = `${symbol}|${interval}`;
    const u = this.users.get(key);
    if (!u) return;
    u.delete(user);
    if (u.size === 0) {
      setTimeout(() => {
        if (this.users.get(key) && this.users.get(key).size === 0) {
          this.feeds.get(key).stop();
          this.feeds.delete(key);
          this.users.delete(key);
          log(key, "stopped (no users)");
        }
      }, 6e4);
    }
  }
  list() {
    return Array.from(this.feeds.values()).map((f) => f.info());
  }
};

// lib/alerts.js
import { EventEmitter as EventEmitter2 } from "node:events";
import crypto from "node:crypto";

// lib/store.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
var DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
var DB_FILE = path.join(DATA_DIR, "db.json");
var SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.join(ROOT, "scripts");
var DEFAULT_DB = {
  settings: {
    telegram: { token: "", chatId: "" },
    template: "{{emoji}} {{label}} {{symbol}} {{interval}}\nPrice: {{close}}\nScript: {{script}}\nCandle: {{candleTime}}"
  },
  alerts: [],
  history: []
};
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
var db;
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  db = { ...structuredClone(DEFAULT_DB), ...db, settings: { ...DEFAULT_DB.settings, ...db.settings || {} } };
} catch (_) {
  db = structuredClone(DEFAULT_DB);
}
var saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 200);
}
var getDb = () => db;
var safeId = (id) => String(id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
function listScripts() {
  return fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".pine")).map((f) => {
    const id = f.slice(0, -5);
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, f), "utf8");
    const m = src.match(/(?:indicator|strategy)\s*\(\s*["']([^"']+)["']/);
    return { id, name: m ? m[1] : id };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
function readScript(id) {
  const file = path.join(SCRIPTS_DIR, safeId(id) + ".pine");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}
function writeScript(id, source) {
  const sid = safeId(id);
  if (!sid) throw new Error("Invalid script name");
  fs.writeFileSync(path.join(SCRIPTS_DIR, sid + ".pine"), String(source));
  return sid;
}
function deleteScript(id) {
  const file = path.join(SCRIPTS_DIR, safeId(id) + ".pine");
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// lib/pine.js
import { PineTS } from "pinets";
var RUN_BARS = Number(process.env.RUN_BARS || 500);
var NA = (v) => v === null || v === void 0 || typeof v === "number" && !Number.isFinite(v) || Number.isNaN(v);
async function runPine(source, candles, bars = RUN_BARS) {
  const data = candles.slice(-bars).map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    openTime: c.openTime,
    closeTime: c.closeTime
  }));
  if (data.length < 2) throw new Error("Not enough candles yet");
  const t = Date.now();
  const res = await new PineTS(data).run(source);
  const plots = {};
  for (const [name, p] of Object.entries(res.plots || {})) {
    if (name.startsWith("__") || !p || !Array.isArray(p.data)) continue;
    plots[name] = p.data.map((d) => ({ time: d.time, value: NA(d.value) ? null : d.value }));
  }
  return { plots, ms: Date.now() - t };
}
function lastValue(plots, plot) {
  const s = plots[plot];
  if (!s || !s.length) return null;
  const v = s[s.length - 1].value;
  if (typeof v === "boolean") return v ? 1 : 0;
  return typeof v === "number" ? v : null;
}
function linePlots(plots, signalPlot) {
  const out = [];
  for (const [name, s] of Object.entries(plots)) {
    if (name === signalPlot) continue;
    const nums = s.filter((d) => typeof d.value === "number");
    if (nums.length < s.length * 0.5) continue;
    const distinct = new Set(nums.slice(-200).map((d) => d.value));
    if (distinct.size <= 3) continue;
    out.push({ name, data: nums });
  }
  return out.slice(0, 6);
}

// lib/telegram.js
var API = process.env.TELEGRAM_API || "https://api.telegram.org";
function telegramConfig(settings) {
  return {
    token: process.env.TELEGRAM_TOKEN || settings.telegram && settings.telegram.token || "",
    chatId: process.env.TELEGRAM_CHAT_ID || settings.telegram && settings.telegram.chatId || ""
  };
}
async function sendTelegram(cfg, text) {
  if (!cfg.token || !cfg.chatId) throw new Error("Telegram is not set up (token / chat ID)");
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${API}/bot${cfg.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cfg.chatId, text, disable_web_page_preview: true })
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok !== false) return;
      lastErr = new Error(j.description || "HTTP " + r.status);
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((res) => setTimeout(res, 1e3 * (i + 1)));
  }
  throw lastErr;
}
async function findChats(token) {
  const r = await fetch(`${API}/bot${token}/getUpdates`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || "Telegram error");
  const chats = [];
  for (const u of j.result || []) {
    const m = u.message || u.channel_post || u.my_chat_member || u.edited_message;
    const c = m && m.chat;
    if (c && !chats.find((x) => x.id === c.id)) chats.push({ id: c.id, name: c.title || c.username || c.first_name || "" });
  }
  return chats;
}

// lib/alerts.js
var HISTORY_MAX = 500;
var log2 = (...a) => console.log((/* @__PURE__ */ new Date()).toISOString(), "[alerts]", ...a);
function parseLabels(s) {
  const map = {};
  String(s || "").split(",").forEach((part) => {
    const i = part.indexOf("=");
    if (i <= 0) return;
    const k = Number(part.slice(0, i).trim());
    const v = part.slice(i + 1).trim();
    if (Number.isFinite(k) && v) map[k] = v;
  });
  return map;
}
function decide(alert, v, prev) {
  if (v === null || v === void 0) return null;
  const labels = parseLabels(alert.labels);
  if (alert.trigger === "change") {
    if (prev === null || prev === void 0 || prev === v) return null;
    return labels[v] || `CHANGE ${prev} \u2192 ${v}`;
  }
  if (v === 0) return null;
  if (labels[v]) return labels[v];
  if (alert.trigger === "nonzero") return `SIGNAL ${v}`;
  return v > 0 ? "BUY" : "SELL";
}
var fmtPrice = (p) => typeof p === "number" ? Math.abs(p) >= 100 ? p.toFixed(2) : String(Number(p.toPrecision(6))) : "?";
var fmtTime = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
function render(template, vars) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => k in vars ? String(vars[k]) : m);
}
var AlertEngine = class extends EventEmitter2 {
  constructor(feeds2) {
    super();
    this.feeds = feeds2;
    this.attached = /* @__PURE__ */ new Map();
    this.queues = /* @__PURE__ */ new Map();
  }
  async start() {
    for (const a of getDb().alerts) if (a.enabled) await this.attach(a).catch((e) => log2("attach failed", a.id, e.message));
  }
  async attach(alert) {
    this.detach(alert.id);
    const feed = await this.feeds.acquire(alert.symbol, alert.interval, "alert:" + alert.id);
    const handler = (candle) => this.enqueue(alert.id, () => this.evaluate(alert.id, feed, candle));
    feed.on("close", handler);
    this.attached.set(alert.id, { feed, handler, symbol: alert.symbol, interval: alert.interval });
    log2(`watching ${alert.name} (${alert.symbol} ${alert.interval})`);
  }
  detach(id) {
    const a = this.attached.get(id);
    if (!a) return;
    a.feed.off("close", a.handler);
    this.feeds.release(a.symbol, a.interval, "alert:" + id);
    this.attached.delete(id);
  }
  enqueue(id, job) {
    const prev = this.queues.get(id) || Promise.resolve();
    const next = prev.then(job).catch((e) => log2("job error", id, e.message));
    this.queues.set(id, next);
    return next;
  }
  /** Runs the alert's script on all candles up to the one that just closed. */
  async evaluate(id, feed, candle) {
    const alert = getDb().alerts.find((a) => a.id === id);
    if (!alert || !alert.enabled) return;
    const source = readScript(alert.scriptId);
    if (!source) {
      alert.lastError = "Script not found: " + alert.scriptId;
      save();
      return;
    }
    const candles = feed.candles.filter((c) => c.openTime <= candle.openTime);
    let plots, ms;
    try {
      ({ plots, ms } = await runPine(source, candles));
    } catch (e) {
      alert.lastError = "Script error: " + e.message;
      alert.lastCheck = { at: Date.now(), candle: candle.openTime };
      save();
      log2(alert.name, alert.lastError);
      return;
    }
    const series = plots[alert.plot];
    if (!series) {
      alert.lastError = `Plot "${alert.plot}" not found. Plots in script: ${Object.keys(plots).join(", ")}`;
      save();
      return;
    }
    const v = lastValue(plots, alert.plot);
    const prevPoint = series.length > 1 ? series[series.length - 2].value : null;
    const prev = typeof prevPoint === "boolean" ? prevPoint ? 1 : 0 : prevPoint;
    alert.lastError = "";
    alert.lastCheck = { at: Date.now(), candle: candle.openTime, value: v, ms };
    const label = decide(alert, v, prev);
    if (!label || alert.lastFiredCandle === candle.openTime) {
      save();
      return;
    }
    alert.lastFiredCandle = candle.openTime;
    save();
    await this.fire(alert, { label, value: v, prev, candle });
  }
  async fire(alert, { label, value, prev, candle }) {
    const db3 = getDb();
    const script = (listScripts().find((s) => s.id === alert.scriptId) || {}).name || alert.scriptId;
    const vars = {
      emoji: value > 0 ? "\u{1F7E2}" : value < 0 ? "\u{1F534}" : "\u{1F514}",
      label,
      symbol: alert.symbol,
      interval: alert.interval,
      value,
      prev,
      close: fmtPrice(candle.close),
      open: fmtPrice(candle.open),
      high: fmtPrice(candle.high),
      low: fmtPrice(candle.low),
      script,
      alert: alert.name,
      candleTime: fmtTime(candle.openTime),
      sentAt: fmtTime(Date.now())
    };
    const text = render(alert.template || db3.settings.template, vars);
    const entry = {
      id: crypto.randomUUID(),
      alertId: alert.id,
      alert: alert.name,
      symbol: alert.symbol,
      interval: alert.interval,
      label,
      value,
      close: candle.close,
      candleTime: candle.openTime,
      at: Date.now(),
      text,
      telegram: "sending"
    };
    try {
      await sendTelegram(telegramConfig(db3.settings), text);
      entry.telegram = "ok";
    } catch (e) {
      entry.telegram = e.message;
    }
    db3.history.unshift(entry);
    db3.history.length = Math.min(db3.history.length, HISTORY_MAX);
    save();
    log2(`${label} ${alert.symbol} ${alert.interval} @ ${vars.close} \u2192 telegram: ${entry.telegram}`);
    this.emit("signal", entry);
  }
};

// server.js
try {
  const envFile = path2.join(path2.dirname(fileURLToPath2(import.meta.url)), ".env");
  for (const line of fs2.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch (_) {
}
var ROOT2 = path2.dirname(fileURLToPath2(import.meta.url));
var FLAT = !fs2.existsSync(path2.join(ROOT2, "public"));
var PUBLIC = FLAT ? ROOT2 : path2.join(ROOT2, "public");
var FLAT_FILES = /* @__PURE__ */ new Set(["index.html", "app.js", "style.css", "login.html"]);
var PORT = Number(process.env.PORT || 8080);
var HOST = process.env.HOST || "0.0.0.0";
var PASSWORD = process.env.APP_PASSWORD || "";
var SESSION = PASSWORD ? crypto2.createHash("sha256").update("pinealert:" + PASSWORD).digest("hex") : "";
var feeds = new FeedManager();
var engine = new AlertEngine(feeds);
var SYMBOL_RE = /^[A-Z0-9]{3,20}$/;
var db2 = getDb();
if (!db2.seeded) {
  if (!db2.alerts.length && readScript("prev-candle-test")) {
    db2.alerts.push({
      id: crypto2.randomUUID(),
      name: "BTC 1m test",
      enabled: true,
      symbol: "BTCUSDT",
      interval: "1m",
      scriptId: "prev-candle-test",
      plot: "TVX_SIGNAL",
      trigger: "signal",
      labels: "1=BUY,-1=SELL",
      template: ""
    });
  }
  db2.seeded = true;
  save();
}
var send = (res, code, body, headers = {}) => {
  const isStr = typeof body === "string" || Buffer.isBuffer(body);
  res.writeHead(code, { "Content-Type": isStr ? "text/plain; charset=utf-8" : "application/json", "Cache-Control": "no-store", ...headers });
  res.end(isStr ? body : JSON.stringify(body));
};
var fail = (res, code, msg) => send(res, code, { error: msg });
function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("Body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const type = req.headers["content-type"] || "";
      try {
        if (type.includes("application/json")) resolve(raw ? JSON.parse(raw) : {});
        else resolve(Object.fromEntries(new URLSearchParams(raw)));
      } catch (e) {
        reject(new Error("Invalid body"));
      }
    });
    req.on("error", reject);
  });
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((p) => p.trim().split("=")).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
}
function authed(req) {
  if (!PASSWORD) return true;
  const c = cookies(req).pa_session || "";
  return c.length === SESSION.length && crypto2.timingSafeEqual(Buffer.from(c), Buffer.from(SESSION));
}
var MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
function serveStatic(req, res, pathname) {
  const file = path2.normalize(path2.join(PUBLIC, pathname === "/" ? "index.html" : pathname));
  if (FLAT && !FLAT_FILES.has(path2.basename(file))) return fail(res, 404, "Not found");
  if (!file.startsWith(PUBLIC) || !fs2.existsSync(file) || fs2.statSync(file).isDirectory()) return fail(res, 404, "Not found");
  res.writeHead(200, { "Content-Type": MIME[path2.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs2.createReadStream(file).pipe(res);
}
function publicSettings() {
  const s = getDb().settings;
  const tg = telegramConfig(s);
  return {
    telegram: { tokenSet: !!tg.token, tokenHint: tg.token ? tg.token.slice(0, 6) + "\u2026" + tg.token.slice(-4) : "", chatId: tg.chatId, fromEnv: !!process.env.TELEGRAM_TOKEN },
    template: s.template
  };
}
function validateAlert(b) {
  const symbol = String(b.symbol || "").toUpperCase().trim();
  if (!SYMBOL_RE.test(symbol)) throw new Error("Symbol must look like BTCUSDT");
  if (!INTERVALS.includes(b.interval)) throw new Error("Invalid timeframe");
  if (!readScript(b.scriptId)) throw new Error("Choose a script");
  return {
    name: String(b.name || `${symbol} ${b.interval}`).slice(0, 60),
    enabled: b.enabled !== false,
    symbol,
    interval: b.interval,
    scriptId: safeId(b.scriptId),
    plot: String(b.plot || "TVX_SIGNAL").slice(0, 80),
    trigger: ["signal", "nonzero", "change"].includes(b.trigger) ? b.trigger : "signal",
    labels: String(b.labels ?? "1=BUY,-1=SELL").slice(0, 200),
    template: String(b.template || "").slice(0, 1e3)
  };
}
var clients = /* @__PURE__ */ new Set();
engine.on("signal", (entry) => {
  for (const c of clients) c.write(`event: signal
data: ${JSON.stringify(entry)}

`);
});
async function stream(req, res, q) {
  const symbol = String(q.get("symbol") || "BTCUSDT").toUpperCase();
  const interval = q.get("interval") || "1m";
  if (!SYMBOL_RE.test(symbol) || !INTERVALS.includes(interval)) return fail(res, 400, "Bad symbol/interval");
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 3000\n\n");
  const user = "chart:" + crypto2.randomUUID();
  clients.add(res);
  const feed = await feeds.acquire(symbol, interval, user);
  const onUpdate = (c) => res.write(`event: candle
data: ${JSON.stringify(c)}

`);
  const onClose = (c) => res.write(`event: close
data: ${JSON.stringify(c)}

`);
  feed.on("update", onUpdate);
  feed.on("close", onClose);
  const ping = setInterval(() => res.write(": ping\n\n"), 2e4);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
    feed.off("update", onUpdate);
    feed.off("close", onClose);
    feeds.release(symbol, interval, user);
  });
}
async function chart(res, q) {
  const symbol = String(q.get("symbol") || "BTCUSDT").toUpperCase();
  const interval = q.get("interval") || "1m";
  const scriptId = q.get("script") || "";
  const plot = q.get("plot") || "TVX_SIGNAL";
  if (!SYMBOL_RE.test(symbol) || !INTERVALS.includes(interval)) return fail(res, 400, "Bad symbol/interval");
  const user = "snapshot:" + crypto2.randomUUID();
  const feed = await feeds.acquire(symbol, interval, user);
  try {
    const candles = feed.candles.slice(-1e3);
    const out = { symbol, interval, status: feed.status, candles, markers: [], lines: [], plots: [], error: "" };
    const source = scriptId && readScript(scriptId);
    if (source) {
      const closed = candles.filter((c) => c.closed);
      try {
        const { plots, ms } = await runPine(source, closed, 1e3);
        out.ms = ms;
        out.plots = Object.keys(plots);
        const sig = plots[plot] || [];
        for (const d of sig) {
          const v = typeof d.value === "boolean" ? d.value ? 1 : 0 : d.value;
          if (typeof v === "number" && v !== 0) out.markers.push({ time: d.time, value: v });
        }
        out.lines = linePlots(plots, plot);
      } catch (e) {
        out.error = e.message;
      }
    }
    send(res, 200, out);
  } finally {
    feeds.release(symbol, interval, user);
  }
}
async function route(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const m = req.method;
  if (p === "/health") return send(res, 200, { ok: true, feeds: feeds.list().length, alerts: getDb().alerts.length });
  if (p === "/login") {
    if (m === "POST") {
      const b = await readBody(req).catch(() => ({}));
      if (PASSWORD && b.password === PASSWORD) {
        res.writeHead(302, { "Set-Cookie": `pa_session=${SESSION}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 90}`, Location: "/" });
        return res.end();
      }
      await new Promise((r) => setTimeout(r, 800));
      res.writeHead(302, { Location: "/login.html?e=1" });
      return res.end();
    }
    res.writeHead(302, { Location: "/login.html" });
    return res.end();
  }
  if (p === "/logout") {
    res.writeHead(302, { "Set-Cookie": "pa_session=; Path=/; Max-Age=0", Location: "/login.html" });
    return res.end();
  }
  if (p === "/login.html" || p === "/style.css") return serveStatic(req, res, p);
  if (!authed(req)) {
    if (p.startsWith("/api/")) return fail(res, 401, "Login required");
    res.writeHead(302, { Location: "/login.html" });
    return res.end();
  }
  if (!p.startsWith("/api/")) return serveStatic(req, res, p);
  if (p === "/api/state" && m === "GET") {
    const d = getDb();
    return send(res, 200, {
      intervals: INTERVALS,
      feeds: feeds.list(),
      scripts: listScripts(),
      alerts: d.alerts,
      settings: publicSettings(),
      history: d.history.slice(0, 100),
      passwordProtected: !!PASSWORD,
      simulated: process.env.FEED === "sim"
    });
  }
  if (p === "/api/chart" && m === "GET") return chart(res, url.searchParams);
  if (p === "/api/stream" && m === "GET") return stream(req, res, url.searchParams);
  if (p === "/api/alerts" && m === "POST") {
    const b = await readBody(req);
    const d = getDb();
    const clean = validateAlert(b);
    let alert = b.id && d.alerts.find((a) => a.id === b.id);
    if (alert) {
      Object.assign(alert, clean, { lastError: "", lastFiredCandle: alert.lastFiredCandle });
    } else {
      alert = { id: crypto2.randomUUID(), ...clean, createdAt: Date.now() };
      d.alerts.push(alert);
    }
    save();
    if (alert.enabled) await engine.attach(alert);
    else engine.detach(alert.id);
    return send(res, 200, alert);
  }
  const am = p.match(/^\/api\/alerts\/([\w-]+)$/);
  if (am && m === "DELETE") {
    const d = getDb();
    engine.detach(am[1]);
    d.alerts = d.alerts.filter((a) => a.id !== am[1]);
    save();
    return send(res, 200, { ok: true });
  }
  const sm = p.match(/^\/api\/scripts\/([\w-]+)$/);
  if (sm && m === "GET") {
    const src = readScript(sm[1]);
    return src == null ? fail(res, 404, "Not found") : send(res, 200, { id: sm[1], source: src });
  }
  if (sm && m === "PUT") {
    const b = await readBody(req);
    if (!b.source || !/indicator\s*\(|strategy\s*\(/.test(b.source)) throw new Error("The script needs an indicator(...) or strategy(...) line");
    const id = writeScript(sm[1], b.source);
    return send(res, 200, { id });
  }
  if (sm && m === "DELETE") {
    if (getDb().alerts.some((a) => a.scriptId === sm[1])) throw new Error("An alert uses this script \u2014 delete or change the alert first");
    deleteScript(sm[1]);
    return send(res, 200, { ok: true });
  }
  if (p === "/api/scripts/check" && m === "POST") {
    const b = await readBody(req);
    const symbol = String(b.symbol || "BTCUSDT").toUpperCase();
    const interval = INTERVALS.includes(b.interval) ? b.interval : "1m";
    if (!SYMBOL_RE.test(symbol)) throw new Error("Bad symbol");
    const user = "check:" + crypto2.randomUUID();
    const feed = await feeds.acquire(symbol, interval, user);
    try {
      const { plots, ms } = await runPine(String(b.source || ""), feed.candles.filter((c) => c.closed));
      const last = Object.fromEntries(Object.entries(plots).map(([k, s]) => [k, s.length ? s[s.length - 1].value : null]));
      return send(res, 200, { ok: true, ms, plots: last });
    } catch (e) {
      return send(res, 200, { ok: false, error: e.message });
    } finally {
      feeds.release(symbol, interval, user);
    }
  }
  if (p === "/api/settings" && m === "POST") {
    const b = await readBody(req);
    const s = getDb().settings;
    if (b.telegram) {
      if (typeof b.telegram.token === "string" && b.telegram.token.trim()) s.telegram.token = b.telegram.token.trim();
      if (typeof b.telegram.chatId === "string") s.telegram.chatId = b.telegram.chatId.trim();
    }
    if (typeof b.template === "string" && b.template.trim()) s.template = b.template.slice(0, 1e3);
    save();
    return send(res, 200, publicSettings());
  }
  if (p === "/api/telegram/test" && m === "POST") {
    await sendTelegram(telegramConfig(getDb().settings), "\u2705 PineAlert is connected. Your signals will arrive here.");
    return send(res, 200, { ok: true });
  }
  if (p === "/api/telegram/find" && m === "POST") {
    const b = await readBody(req);
    const token = (b.token || "").trim() || telegramConfig(getDb().settings).token;
    if (!token) throw new Error("Paste the bot token first");
    return send(res, 200, { chats: await findChats(token) });
  }
  if (p === "/api/history" && m === "DELETE") {
    getDb().history = [];
    save();
    return send(res, 200, { ok: true });
  }
  return fail(res, 404, "Not found");
}
var server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    if (!res.headersSent) fail(res, 400, e.message);
    else res.end();
  });
});
server.listen(PORT, HOST, async () => {
  console.log(`PineAlert running on http://${HOST}:${PORT}  (data: ${process.env.FEED === "sim" ? "SIMULATED" : "Binance live"})`);
  if (!PASSWORD) console.log("\u26A0  No APP_PASSWORD set \u2014 anyone who can reach this port can open the app.");
  await engine.start();
  const publicUrl = process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  if (publicUrl) {
    const ping = () => fetch(publicUrl.replace(/\/$/, "") + "/health").catch(() => {
    });
    setInterval(ping, 10 * 60 * 1e3);
    console.log("Keep-alive enabled \u2192", publicUrl);
  }
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => {
  save();
  setTimeout(() => process.exit(0), 300);
});
