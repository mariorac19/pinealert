var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// lib/symbols.js
var symbols_exports = {};
__export(symbols_exports, {
  INTERVALS: () => INTERVALS,
  INTERVAL_MS: () => INTERVAL_MS,
  OANDA_GRANULARITY: () => OANDA_GRANULARITY,
  displayName: () => displayName,
  parseSymbol: () => parseSymbol,
  supportsInterval: () => supportsInterval
});
function oandaFromCompact(code) {
  const m = code.match(/^([A-Z]{3})([A-Z]{3})$/);
  if (m && (FIAT.includes(m[1]) || METALS.includes(m[1])) && FIAT.includes(m[2])) return `${m[1]}_${m[2]}`;
  return null;
}
function parseSymbol(input) {
  let s = String(input || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!s) throw new Error("Empty symbol");
  let provider = "";
  const i = s.indexOf(":");
  if (i > 0) {
    provider = s.slice(0, i);
    s = s.slice(i + 1);
  }
  s = s.replace("/", "_");
  if (provider === "OANDA" || !provider && (s.includes("_") || oandaFromCompact(s))) {
    const code = s.includes("_") ? s : oandaFromCompact(s) || s;
    if (!/^[A-Z0-9]{2,10}_[A-Z0-9]{2,10}$/.test(code)) throw new Error(`Unknown OANDA instrument "${input}" (try EURUSD, XAUUSD, NAS100_USD)`);
    return { id: `OANDA:${code}`, provider: "oanda", code };
  }
  if (provider && provider !== "BINANCE") throw new Error(`Unknown market "${provider}" \u2014 use BINANCE: or OANDA:`);
  if (!/^[A-Z0-9]{3,20}$/.test(s)) throw new Error(`Bad symbol "${input}"`);
  return { id: `BINANCE:${s}`, provider: "binance", code: s };
}
function displayName(id) {
  const { provider, code } = parseSymbol(id);
  return provider === "oanda" ? code.replace("_", "/") : code;
}
function supportsInterval(id, interval) {
  if (!INTERVALS.includes(interval)) return false;
  return parseSymbol(id).provider === "binance" || interval in OANDA_GRANULARITY;
}
var INTERVALS, INTERVAL_MS, OANDA_GRANULARITY, FIAT, METALS;
var init_symbols = __esm({
  "lib/symbols.js"() {
    INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w"];
    INTERVAL_MS = {
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
    OANDA_GRANULARITY = {
      "1m": "M1",
      "5m": "M5",
      "15m": "M15",
      "30m": "M30",
      "1h": "H1",
      "2h": "H2",
      "4h": "H4",
      "6h": "H6",
      "8h": "H8",
      "12h": "H12",
      "1d": "D",
      "1w": "W"
    };
    FIAT = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "SGD", "HKD", "NOK", "SEK", "DKK", "ZAR", "MXN", "PLN", "TRY", "CZK", "HUF", "CNH", "THB"];
    METALS = ["XAU", "XAG", "XPT", "XPD", "XCU"];
  }
});

// lib/feed.js
var feed_exports = {};
__export(feed_exports, {
  BinanceFeed: () => BinanceFeed,
  FeedManager: () => FeedManager,
  INTERVALS: () => INTERVALS,
  OandaFeed: () => OandaFeed,
  SimFeed: () => SimFeed,
  fetchHistory: () => fetchHistory,
  oandaInstruments: () => oandaInstruments
});
import { EventEmitter } from "node:events";
async function binanceKlines(code, interval, { limit = 1e3, endTime } = {}) {
  const q = new URLSearchParams({ symbol: code, interval, limit: String(limit) });
  if (endTime) q.set("endTime", String(endTime));
  const r = await fetch(`${BINANCE_REST}/api/v3/klines?${q}`);
  if (!r.ok) throw new Error(`Binance HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}`);
  const now = Date.now();
  return (await r.json()).map((k) => ({
    openTime: k[0],
    open: +k[1],
    high: +k[2],
    low: +k[3],
    close: +k[4],
    volume: +k[5],
    closeTime: k[6],
    closed: k[6] < now
  }));
}
async function oandaAccount() {
  if (oandaAccountId) return oandaAccountId;
  const r = await fetch(`${OANDA_REST}/v3/accounts`, { headers: oandaHeaders() });
  if (!r.ok) throw new Error(`OANDA login failed (HTTP ${r.status}) \u2014 check OANDA_TOKEN`);
  const j = await r.json();
  oandaAccountId = j.accounts && j.accounts[0] && j.accounts[0].id;
  if (!oandaAccountId) throw new Error("OANDA: no account found for this token");
  return oandaAccountId;
}
async function oandaInstruments() {
  const id = await oandaAccount();
  const r = await fetch(`${OANDA_REST}/v3/accounts/${id}/instruments`, { headers: oandaHeaders() });
  if (!r.ok) throw new Error(`OANDA HTTP ${r.status}`);
  return (await r.json()).instruments || [];
}
async function oandaCandles(code, interval, { count = 500, to } = {}) {
  const q = new URLSearchParams({ granularity: OANDA_GRANULARITY[interval], price: "M", count: String(count) });
  if (to) q.set("to", String(Math.floor(to / 1e3)));
  const r = await fetch(`${OANDA_REST}/v3/instruments/${code}/candles?${q}`, { headers: oandaHeaders() });
  if (r.status === 429) throw new Error("OANDA rate limit");
  if (!r.ok) throw new Error(`OANDA HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}`);
  const iv = INTERVAL_MS[interval];
  return ((await r.json()).candles || []).map((c) => {
    const t = Math.round(parseFloat(c.time) * 1e3);
    return { openTime: t, closeTime: t + iv - 1, open: +c.mid.o, high: +c.mid.h, low: +c.mid.l, close: +c.mid.c, volume: c.volume, closed: !!c.complete };
  });
}
async function fetchHistory(symbol, interval, { to, limit = 500 } = {}) {
  const { provider, code } = parseSymbol(symbol);
  if (process.env.FEED === "sim") return [];
  if (provider === "oanda") return oandaCandles(code, interval, { count: Math.min(limit, 5e3), to });
  return binanceKlines(code, interval, { limit: Math.min(limit, 1e3), endTime: to });
}
var MAX_CANDLES, BINANCE_REST, BINANCE_WS, OANDA_REST, OANDA_STREAM, oandaToken, log, sleep, Feed, BinanceHub, binanceHub, BinanceFeed, oandaHeaders, oandaAccountId, OandaHub, oandaHub, OandaFeed, SimFeed, FeedManager;
var init_feed = __esm({
  "lib/feed.js"() {
    init_symbols();
    MAX_CANDLES = Number(process.env.MAX_CANDLES || 1e3);
    BINANCE_REST = process.env.BINANCE_REST || "https://data-api.binance.vision";
    BINANCE_WS = process.env.BINANCE_WS || "wss://data-stream.binance.vision/stream";
    OANDA_REST = process.env.OANDA_REST || "https://api-fxpractice.oanda.com";
    OANDA_STREAM = process.env.OANDA_STREAM || "https://stream-fxpractice.oanda.com";
    oandaToken = () => process.env.OANDA_TOKEN || "";
    log = (...a) => console.log((/* @__PURE__ */ new Date()).toISOString(), "[feed]", ...a);
    sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    Feed = class extends EventEmitter {
      constructor(symbol, interval) {
        super();
        this.symbol = symbol;
        this.interval = interval;
        this.candles = [];
        this.status = "starting";
        this.lastMessageAt = 0;
        this.setMaxListeners(200);
      }
      get key() {
        return `${this.symbol}|${this.interval}`;
      }
      _upsert(c, closed) {
        const last = this.candles[this.candles.length - 1];
        const candle = { ...c, closed: !!closed };
        if (last && last.openTime === c.openTime) {
          const wasClosed = last.closed;
          this.candles[this.candles.length - 1] = candle;
          this.lastMessageAt = Date.now();
          this.emit("update", candle);
          if (closed && !wasClosed) this.emit("close", candle);
          return;
        }
        if (last && c.openTime < last.openTime) {
          const i = this.candles.findIndex((x) => x.openTime === c.openTime);
          if (i >= 0) this.candles[i] = { ...candle, closed: true };
          return;
        }
        if (last && !last.closed) {
          last.closed = true;
          this.emit("close", last);
        }
        this.candles.push(candle);
        if (this.candles.length > MAX_CANDLES) this.candles.splice(0, this.candles.length - MAX_CANDLES);
        this.lastMessageAt = Date.now();
        this.emit("update", candle);
        if (closed) this.emit("close", candle);
      }
      info() {
        return { symbol: this.symbol, interval: this.interval, status: this.status, candles: this.candles.length, lastMessageAt: this.lastMessageAt };
      }
    };
    BinanceHub = class {
      constructor() {
        this.feeds = /* @__PURE__ */ new Map();
        this.ws = null;
        this.timer = null;
        this.retry = 0;
      }
      add(feed) {
        this.feeds.set(`${feed.code.toLowerCase()}@kline_${feed.interval}`, feed);
        this._schedule();
      }
      remove(feed) {
        this.feeds.delete(`${feed.code.toLowerCase()}@kline_${feed.interval}`);
        this._schedule();
      }
      _schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this._connect(), 800);
      }
      _connect() {
        const streams = Array.from(this.feeds.keys());
        const old = this.ws;
        this.ws = null;
        if (old) {
          old.onclose = null;
          try {
            old.close();
          } catch (_) {
          }
        }
        if (!streams.length) return;
        const ws = new WebSocket(`${BINANCE_WS}?streams=${streams.join("/")}`);
        this.ws = ws;
        ws.onopen = () => {
          this.retry = 0;
          log(`binance stream connected (${streams.length} pair/timeframes)`);
          for (const f of this.feeds.values()) {
            f.status = "live";
            f.resync();
          }
        };
        ws.onmessage = (ev) => {
          try {
            const m = JSON.parse(ev.data);
            const k = m.data && m.data.k;
            const f = k && this.feeds.get(m.stream);
            if (f) f._upsert({ openTime: k.t, closeTime: k.T, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v }, k.x);
          } catch (_) {
          }
        };
        ws.onerror = () => {
        };
        ws.onclose = () => {
          if (this.ws !== ws) return;
          this.retry++;
          const wait = Math.min(3e4, 1e3 * 2 ** Math.min(this.retry, 5));
          for (const f of this.feeds.values()) f.status = "reconnecting";
          log(`binance stream closed, retry in ${wait / 1e3}s`);
          clearTimeout(this.timer);
          this.timer = setTimeout(() => this._connect(), wait);
        };
      }
      /** Watchdog: if nothing arrived for 90 s, reconnect. */
      check() {
        if (!this.ws || !this.feeds.size) return;
        const newest = Math.max(...Array.from(this.feeds.values()).map((f) => f.lastMessageAt || 0));
        if (Date.now() - newest > 9e4) {
          log("binance stream silent, reconnecting");
          this._connect();
        }
      }
    };
    binanceHub = new BinanceHub();
    setInterval(() => binanceHub.check(), 3e4).unref();
    BinanceFeed = class extends Feed {
      constructor(symbol, interval) {
        super(symbol, interval);
        this.code = parseSymbol(symbol).code;
      }
      async start() {
        for (let attempt = 1; ; attempt++) {
          try {
            this.candles = await binanceKlines(this.code, this.interval, { limit: MAX_CANDLES });
            this.lastMessageAt = Date.now();
            break;
          } catch (e) {
            this.status = "error: " + e.message;
            if (/HTTP 400/.test(e.message) || this.stopped) throw e;
            await sleep(Math.min(3e4, 2e3 * attempt));
          }
        }
        binanceHub.add(this);
      }
      /** After a reconnect: pull the last few candles so no close is missed. */
      async resync() {
        try {
          const fresh = await binanceKlines(this.code, this.interval, { limit: 5 });
          const lastT = this.candles.length ? this.candles[this.candles.length - 1].openTime : 0;
          for (const c of fresh) if (c.openTime >= lastT) this._upsert(c, c.closed);
        } catch (_) {
        }
      }
      stop() {
        this.stopped = true;
        binanceHub.remove(this);
      }
    };
    oandaHeaders = () => ({ Authorization: `Bearer ${oandaToken()}`, "Accept-Datetime-Format": "UNIX" });
    oandaAccountId = null;
    OandaHub = class {
      constructor() {
        this.feeds = /* @__PURE__ */ new Map();
        this.timer = null;
        this.ctrl = null;
        this.closeTimers = /* @__PURE__ */ new Map();
      }
      add(feed) {
        if (!this.feeds.has(feed.code)) this.feeds.set(feed.code, /* @__PURE__ */ new Set());
        this.feeds.get(feed.code).add(feed);
        this._armClose(feed);
        this._schedule();
      }
      remove(feed) {
        const set = this.feeds.get(feed.code);
        if (set) {
          set.delete(feed);
          if (!set.size) this.feeds.delete(feed.code);
        }
        clearTimeout(this.closeTimers.get(feed));
        this.closeTimers.delete(feed);
        this._schedule();
      }
      /** At every candle boundary (+2 s), ask OANDA for the finished candle. Staggered to stay gentle. */
      _armClose(feed) {
        const iv = INTERVAL_MS[feed.interval];
        const jitter = this.closeTimers.size % 40 * 60;
        const wait = iv - Date.now() % iv + 2e3 + jitter;
        this.closeTimers.set(feed, setTimeout(async () => {
          if (feed.stopped) return;
          await feed.refresh();
          this._armClose(feed);
        }, wait));
      }
      _schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this._connect(), 1200);
      }
      async _connect() {
        if (this.ctrl) {
          this.ctrl.abort();
          this.ctrl = null;
        }
        const codes = Array.from(this.feeds.keys());
        if (!codes.length || !oandaToken()) return;
        const ctrl = new AbortController();
        this.ctrl = ctrl;
        try {
          const id = await oandaAccount();
          const r = await fetch(`${OANDA_STREAM}/v3/accounts/${id}/pricing/stream?instruments=${codes.join(",")}`, { headers: oandaHeaders(), signal: ctrl.signal });
          if (!r.ok) throw new Error("HTTP " + r.status);
          log(`oanda stream connected (${codes.length} instruments)`);
          const dec = new TextDecoder();
          let buf = "";
          for await (const chunk of r.body) {
            buf += dec.decode(chunk, { stream: true });
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl);
              buf = buf.slice(nl + 1);
              if (!line.trim()) continue;
              let m;
              try {
                m = JSON.parse(line);
              } catch (_) {
                continue;
              }
              if (m.type !== "PRICE") continue;
              const bid = m.bids && m.bids[0] && +m.bids[0].price;
              const ask = m.asks && m.asks[0] && +m.asks[0].price;
              if (!bid || !ask) continue;
              const mid = (bid + ask) / 2;
              const t = Math.round(parseFloat(m.time) * 1e3);
              for (const f of this.feeds.get(m.instrument) || []) f.tick(mid, t);
            }
          }
          throw new Error("stream ended");
        } catch (e) {
          if (ctrl.signal.aborted) return;
          log("oanda stream:", e.message, "\u2014 retry in 10s");
          this.timer = setTimeout(() => this._connect(), 1e4);
        }
      }
    };
    oandaHub = new OandaHub();
    OandaFeed = class extends Feed {
      constructor(symbol, interval) {
        super(symbol, interval);
        this.code = parseSymbol(symbol).code;
      }
      async start() {
        if (!oandaToken()) {
          this.status = "error: OANDA_TOKEN not set";
          throw new Error("Forex/metals need an OANDA token (Render \u2192 Environment \u2192 OANDA_TOKEN)");
        }
        if (!(this.interval in OANDA_GRANULARITY)) throw new Error(`OANDA has no ${this.interval} timeframe`);
        for (let attempt = 1; ; attempt++) {
          try {
            this.candles = await oandaCandles(this.code, this.interval, { count: MAX_CANDLES });
            this.status = "live";
            this.lastMessageAt = Date.now();
            break;
          } catch (e) {
            this.status = "error: " + e.message;
            if (/HTTP 400|HTTP 401|HTTP 404|token/i.test(e.message) || this.stopped) throw e;
            await sleep(Math.min(3e4, 3e3 * attempt));
          }
        }
        oandaHub.add(this);
      }
      /** Live tick from the price stream: update (or open) the current candle. */
      tick(price, t) {
        const iv = INTERVAL_MS[this.interval];
        if (this.interval === "1d" || this.interval === "1w") {
          const last2 = this.candles[this.candles.length - 1];
          if (last2 && !last2.closed) this._upsert({ ...last2, close: price, high: Math.max(last2.high, price), low: Math.min(last2.low, price) }, false);
          return;
        }
        const openTime = t - t % iv;
        const last = this.candles[this.candles.length - 1];
        if (last && last.openTime === openTime) {
          this._upsert({ ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price), volume: (last.volume || 0) + 1 }, false);
        } else if (!last || openTime > last.openTime) {
          if (last && !last.closed) last.pendingClose = true;
          this.candles.push({ openTime, closeTime: openTime + iv - 1, open: price, high: price, low: price, close: price, volume: 1, closed: false });
          if (this.candles.length > MAX_CANDLES) this.candles.shift();
          this.lastMessageAt = Date.now();
          this.emit("update", this.candles[this.candles.length - 1]);
        }
      }
      /** Confirm finished candles with OANDA's own data (exact OHLC, 'complete' flag). */
      async refresh() {
        try {
          const fresh = await oandaCandles(this.code, this.interval, { count: 3 });
          for (const c of fresh) {
            const i = this.candles.findIndex((x) => x.openTime === c.openTime);
            if (i >= 0) {
              const wasClosed = this.candles[i].closed && !this.candles[i].pendingClose;
              this.candles[i] = c;
              this.emit("update", c);
              if (c.closed && !wasClosed) this.emit("close", c);
            } else if (!this.candles.length || c.openTime > this.candles[this.candles.length - 1].openTime) {
              this._upsert(c, c.closed);
            }
          }
          this.candles.sort((a, b) => a.openTime - b.openTime);
          this.status = "live";
        } catch (e) {
          this.status = "error: " + e.message;
        }
      }
      stop() {
        this.stopped = true;
        oandaHub.remove(this);
      }
    };
    SimFeed = class extends Feed {
      async start() {
        const step = Number(process.env.SIM_MS || 3e3);
        const iv = INTERVAL_MS[this.interval] || 6e4;
        let t = Math.floor(Date.now() / iv) * iv - 300 * iv;
        let p = this.symbol.includes("OANDA") ? 1.1 : 65e3;
        const vol = p * 9e-4;
        const mk = (time) => {
          const o = p;
          const c = +(p + (Math.random() - 0.5) * vol * 2).toFixed(5);
          p = c;
          return { openTime: time, closeTime: time + iv - 1, open: o, close: c, high: +(Math.max(o, c) + Math.random() * vol).toFixed(5), low: +(Math.min(o, c) - Math.random() * vol).toFixed(5), volume: +(Math.random() * 10).toFixed(3) };
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
            live = { ...live, close: +(live.close + (Math.random() - 0.5) * vol * 0.3).toFixed(5) };
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
    FeedManager = class {
      constructor() {
        this.feeds = /* @__PURE__ */ new Map();
        this.users = /* @__PURE__ */ new Map();
      }
      async acquire(symbol, interval, user) {
        const { id, provider } = parseSymbol(symbol);
        if (!supportsInterval(id, interval)) throw new Error(`${id} has no ${interval} timeframe`);
        const key = `${id}|${interval}`;
        let f = this.feeds.get(key);
        if (!f) {
          const Ctor = process.env.FEED === "sim" ? SimFeed : provider === "oanda" ? OandaFeed : BinanceFeed;
          f = new Ctor(id, interval);
          this.feeds.set(key, f);
          this.users.set(key, /* @__PURE__ */ new Set());
          f.ready = f.start().catch((e) => {
            f.failed = e;
            log(key, "start failed:", e.message);
          });
        }
        this.users.get(key).add(user);
        await f.ready;
        if (f.failed) {
          this.users.get(key).delete(user);
          if (!this.users.get(key).size) {
            f.stop && f.stop();
            this.feeds.delete(key);
            this.users.delete(key);
          }
          throw f.failed;
        }
        return f;
      }
      release(symbol, interval, user) {
        let id;
        try {
          id = parseSymbol(symbol).id;
        } catch (_) {
          return;
        }
        const key = `${id}|${interval}`;
        const u = this.users.get(key);
        if (!u) return;
        u.delete(user);
        if (u.size === 0) {
          setTimeout(() => {
            if (this.users.get(key) && this.users.get(key).size === 0) {
              this.feeds.get(key).stop();
              this.feeds.delete(key);
              this.users.delete(key);
            }
          }, 6e4).unref();
        }
      }
      get(symbol, interval) {
        try {
          return this.feeds.get(`${parseSymbol(symbol).id}|${interval}`) || null;
        } catch (_) {
          return null;
        }
      }
      list() {
        return Array.from(this.feeds.values()).map((f) => f.info());
      }
    };
  }
});

// lib/store.js
var store_exports = {};
__export(store_exports, {
  SCRIPTS_DIR: () => SCRIPTS_DIR,
  deleteScript: () => deleteScript,
  flush: () => flush,
  getDb: () => getDb,
  init: () => init,
  listScripts: () => listScripts,
  persistence: () => persistence,
  readScript: () => readScript,
  safeId: () => safeId,
  save: () => save,
  writeScript: () => writeScript
});
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
function normalise(raw) {
  const d = { ...structuredClone(DEFAULT_DB), ...raw || {} };
  d.settings = { ...DEFAULT_DB.settings, ...raw && raw.settings };
  d.settings.telegram = { ...DEFAULT_DB.settings.telegram, ...raw && raw.settings && raw.settings.telegram };
  for (const a of d.alerts) {
    if (!a.symbols) a.symbols = a.symbol ? [a.symbol] : [];
    if (a.symbols.length && !String(a.symbols[0]).includes(":")) a.symbols = a.symbols.map((s) => `BINANCE:${s}`);
    delete a.symbol;
  }
  if (!Array.isArray(d.watchlist)) d.watchlist = DEFAULT_DB.watchlist.slice();
  return d;
}
function exportable() {
  const copy = structuredClone(db);
  copy.settings.telegram = { token: "", chatId: copy.settings.telegram.chatId };
  copy.history = copy.history.slice(0, HISTORY_KEEP);
  return copy;
}
async function init() {
  if (!gh.token || !gh.repo) {
    gh.status = "off";
    return;
  }
  try {
    const r = await fetch(`${GH_API}/repos/${gh.repo}/contents/${gh.path}`, { headers: ghHeaders() });
    if (r.status === 404) {
      gh.status = "ok (new)";
    } else if (!r.ok) {
      throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    } else {
      const j = await r.json();
      gh.sha = j.sha;
      const remote = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
      const localToken = db.settings.telegram.token;
      db = normalise(remote);
      if (localToken) db.settings.telegram.token = localToken;
      writeLocal();
      gh.status = "ok";
      console.log((/* @__PURE__ */ new Date()).toISOString(), "[store] loaded from GitHub", gh.repo, `(${db.alerts.length} alerts, ${Object.keys(db.scripts).length} scripts)`);
    }
    gh.lastImportantHash = importantHash();
  } catch (e) {
    gh.status = "error: " + e.message;
    console.log((/* @__PURE__ */ new Date()).toISOString(), "[store] GitHub load failed:", e.message);
  }
}
async function pushRemote() {
  if (!gh.token || !gh.repo) return;
  if (pushing) {
    pushAgain = true;
    return;
  }
  pushing = true;
  try {
    const body = { message: "PineAlert data", content: Buffer.from(JSON.stringify(exportable(), null, 1)).toString("base64") };
    if (gh.sha) body.sha = gh.sha;
    let r = await fetch(`${GH_API}/repos/${gh.repo}/contents/${gh.path}`, { method: "PUT", headers: { ...ghHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) {
      const cur = await fetch(`${GH_API}/repos/${gh.repo}/contents/${gh.path}`, { headers: ghHeaders() });
      if (cur.ok) {
        body.sha = (await cur.json()).sha;
        r = await fetch(`${GH_API}/repos/${gh.repo}/contents/${gh.path}`, { method: "PUT", headers: { ...ghHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      }
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    gh.sha = (await r.json()).content.sha;
    gh.status = "ok";
    gh.lastSync = Date.now();
  } catch (e) {
    gh.status = "error: " + e.message;
    console.log((/* @__PURE__ */ new Date()).toISOString(), "[store] GitHub save failed:", e.message);
  } finally {
    pushing = false;
    if (pushAgain) {
      pushAgain = false;
      scheduleRemote(true);
    }
  }
}
function scheduleRemote(important) {
  const delay = important ? 3e3 : 3e5;
  const due = Date.now() + delay;
  if (remoteTimer && remoteDue <= due) return;
  clearTimeout(remoteTimer);
  remoteDue = due;
  remoteTimer = setTimeout(() => {
    remoteTimer = null;
    pushRemote();
  }, delay);
}
function writeLocal() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    db.history.length = Math.min(db.history.length, 1e3);
    writeLocal();
    const h = importantHash();
    const important = h !== gh.lastImportantHash;
    gh.lastImportantHash = h;
    scheduleRemote(important);
  }, 200);
}
async function flush() {
  clearTimeout(saveTimer);
  writeLocal();
  if (remoteTimer) {
    clearTimeout(remoteTimer);
    remoteTimer = null;
    await pushRemote();
  }
}
function bundled() {
  try {
    return Object.fromEntries(fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".pine")).map((f) => [f.slice(0, -5), fs.readFileSync(path.join(SCRIPTS_DIR, f), "utf8")]));
  } catch (_) {
    return {};
  }
}
function listScripts() {
  const all = { ...bundled(), ...db.scripts };
  return Object.entries(all).map(([id, src]) => ({ id, name: nameOf(src, id), builtIn: !(id in db.scripts) })).sort((a, b) => a.name.localeCompare(b.name));
}
function readScript(id) {
  const sid = safeId(id);
  if (sid in db.scripts) return db.scripts[sid];
  const file = path.join(SCRIPTS_DIR, sid + ".pine");
  return sid && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}
function writeScript(id, source) {
  const sid = safeId(id);
  if (!sid) throw new Error("Invalid script name");
  db.scripts[sid] = String(source).slice(0, 2e5);
  save();
  return sid;
}
function deleteScript(id) {
  const sid = safeId(id);
  if (!(sid in db.scripts)) throw new Error("Built-in scripts cannot be deleted");
  delete db.scripts[sid];
  save();
}
var ROOT, DATA_DIR, DB_FILE, SCRIPTS_DIR, GH_API, HISTORY_KEEP, DEFAULT_DB, db, gh, persistence, ghHeaders, importantHash, pushing, pushAgain, remoteTimer, remoteDue, saveTimer, getDb, safeId, nameOf;
var init_store = __esm({
  "lib/store.js"() {
    ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
    DB_FILE = path.join(DATA_DIR, "db.json");
    SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.join(ROOT, "scripts");
    GH_API = process.env.GITHUB_API || "https://api.github.com";
    HISTORY_KEEP = 300;
    DEFAULT_DB = {
      settings: {
        telegram: { token: "", chatId: "" },
        template: "{{emoji}} {{label}} {{name}} {{interval}}\nPrice: {{close}}\nScript: {{script}}\nCandle: {{candleTime}}"
      },
      alerts: [],
      watchlist: ["BINANCE:BTCUSDT", "BINANCE:ETHUSDT", "BINANCE:SOLUSDT", "OANDA:EUR_USD", "OANDA:XAU_USD"],
      scripts: {},
      // your own scripts: id -> Pine source
      history: []
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
      db = normalise(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
    } catch (_) {
      db = normalise(null);
    }
    gh = {
      token: process.env.GITHUB_TOKEN || "",
      repo: process.env.GITHUB_DATA_REPO || "",
      // "owner/name"
      path: "pinealert-db.json",
      sha: null,
      status: "off",
      lastSync: 0,
      lastImportantHash: ""
    };
    persistence = () => ({ enabled: !!(gh.token && gh.repo), repo: gh.repo, status: gh.status, lastSync: gh.lastSync });
    ghHeaders = () => ({ Authorization: `Bearer ${gh.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pinealert" });
    importantHash = () => crypto.createHash("sha1").update(JSON.stringify([db.alerts.map((a) => ({ ...a, lastCheck: 0, lastError: "", fired: 0 })), db.scripts, db.watchlist, db.settings.template, db.settings.telegram.chatId])).digest("hex");
    pushing = false;
    pushAgain = false;
    remoteTimer = null;
    remoteDue = 0;
    saveTimer = null;
    getDb = () => db;
    safeId = (id) => String(id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
    nameOf = (src, id) => {
      const m = String(src).match(/(?:indicator|strategy)\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']/);
      return m ? m[1] : id;
    };
  }
});

// lib/pine.js
var pine_exports = {};
__export(pine_exports, {
  lastValue: () => lastValue,
  linePlots: () => linePlots,
  runPine: () => runPine
});
import { PineTS } from "pinets";
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
var RUN_BARS, NA;
var init_pine = __esm({
  "lib/pine.js"() {
    RUN_BARS = Number(process.env.RUN_BARS || 300);
    NA = (v) => v === null || v === void 0 || typeof v === "number" && !Number.isFinite(v) || Number.isNaN(v);
  }
});

// lib/telegram.js
var telegram_exports = {};
__export(telegram_exports, {
  findChats: () => findChats,
  sendTelegram: () => sendTelegram,
  telegramConfig: () => telegramConfig
});
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
var API;
var init_telegram = __esm({
  "lib/telegram.js"() {
    API = process.env.TELEGRAM_API || "https://api.telegram.org";
  }
});

// lib/alerts.js
var alerts_exports = {};
__export(alerts_exports, {
  AlertEngine: () => AlertEngine,
  decide: () => decide,
  fmtPrice: () => fmtPrice,
  parseLabels: () => parseLabels,
  render: () => render
});
import { EventEmitter as EventEmitter2 } from "node:events";
import crypto2 from "node:crypto";
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
function fmtPrice(p) {
  if (typeof p !== "number") return "?";
  const a = Math.abs(p);
  return a >= 1e3 ? p.toFixed(2) : a >= 10 ? p.toFixed(3) : a >= 1 ? p.toFixed(4) : String(Number(p.toPrecision(5)));
}
function render(template, vars) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => k in vars ? String(vars[k]) : m);
}
var log2, BUNDLE_MS, BUNDLE_OVER, fmtTime, AlertEngine;
var init_alerts = __esm({
  "lib/alerts.js"() {
    init_store();
    init_pine();
    init_telegram();
    init_symbols();
    log2 = (...a) => console.log((/* @__PURE__ */ new Date()).toISOString(), "[alerts]", ...a);
    BUNDLE_MS = 2500;
    BUNDLE_OVER = 3;
    fmtTime = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
    AlertEngine = class extends EventEmitter2 {
      constructor(feeds2) {
        super();
        this.feeds = feeds2;
        this.attached = /* @__PURE__ */ new Map();
        this.status = /* @__PURE__ */ new Map();
        this.queue = [];
        this.running = false;
        this.fired = /* @__PURE__ */ new Set();
        this.outbox = /* @__PURE__ */ new Map();
      }
      async start() {
        for (const a of getDb().alerts) if (a.enabled) this.attach(a).catch((e) => log2("attach failed", a.name, e.message));
      }
      statusOf(id) {
        const s = this.status.get(id);
        if (!s) return null;
        const syms = Object.entries(s.symbols);
        return {
          pairs: syms.length,
          ok: syms.filter(([, v]) => !v.error).length,
          errors: syms.filter(([, v]) => v.error).slice(0, 20).map(([k, v]) => ({ symbol: k, error: v.error })),
          lastRun: s.lastRun,
          lastSignals: syms.filter(([, v]) => v.value && v.value !== 0).slice(0, 50).map(([k, v]) => ({ symbol: k, value: v.value, at: v.at })),
          queue: this.queue.length
        };
      }
      async attach(alert) {
        this.detach(alert.id);
        const list = [];
        this.attached.set(alert.id, list);
        const st = { symbols: {}, lastRun: 0 };
        this.status.set(alert.id, st);
        log2(`watching "${alert.name}" \u2014 ${alert.symbols.length} pairs on ${alert.interval}`);
        let i = 0;
        const worker = async () => {
          while (i < alert.symbols.length) {
            const symbol = alert.symbols[i++];
            if (this.attached.get(alert.id) !== list) return;
            try {
              const feed = await this.feeds.acquire(symbol, alert.interval, "alert:" + alert.id);
              if (this.attached.get(alert.id) !== list) {
                this.feeds.release(symbol, alert.interval, "alert:" + alert.id);
                return;
              }
              const handler = (candle) => this.enqueue({ alertId: alert.id, symbol, feed, candle });
              feed.on("close", handler);
              list.push({ symbol, feed, handler });
              st.symbols[symbol] = { value: null, at: 0 };
            } catch (e) {
              st.symbols[symbol] = { error: e.message };
            }
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
      }
      detach(id) {
        const list = this.attached.get(id);
        if (!list) return;
        const alert = getDb().alerts.find((a) => a.id === id);
        for (const { symbol, feed, handler } of list) {
          feed.off("close", handler);
          this.feeds.release(symbol, feed.interval, "alert:" + id);
        }
        this.attached.delete(id);
        this.status.delete(id);
        this.queue = this.queue.filter((j) => j.alertId !== id);
        if (alert) log2(`stopped "${alert.name}"`);
      }
      enqueue(job) {
        const key = `${job.alertId}|${job.symbol}|${job.candle.openTime}`;
        if (this.fired.has(key) || this.queue.some((j) => `${j.alertId}|${j.symbol}|${j.candle.openTime}` === key)) return;
        this.queue.push(job);
        this.pump();
      }
      async pump() {
        if (this.running) return;
        this.running = true;
        try {
          while (this.queue.length) {
            const job = this.queue.shift();
            try {
              await this.evaluate(job);
            } catch (e) {
              log2("evaluate error", job.symbol, e.message);
            }
            await new Promise((r) => setImmediate(r));
          }
        } finally {
          this.running = false;
        }
      }
      /** Run the alert's script on candles up to the one that just closed. */
      async evaluate({ alertId, symbol, feed, candle }) {
        const alert = getDb().alerts.find((a) => a.id === alertId);
        const st = this.status.get(alertId);
        if (!alert || !alert.enabled || !st) return;
        const source = readScript(alert.scriptId);
        if (!source) {
          alert.lastError = "Script not found: " + alert.scriptId;
          return;
        }
        const candles = feed.candles.filter((c) => c.openTime <= candle.openTime && (c.closed || c.openTime === candle.openTime));
        let plots;
        try {
          ({ plots } = await runPine(source, candles));
        } catch (e) {
          st.symbols[symbol] = { error: "Script error: " + e.message, at: Date.now() };
          alert.lastError = "Script error: " + e.message;
          return;
        }
        const series = plots[alert.plot];
        if (!series) {
          alert.lastError = `Plot "${alert.plot}" not found. Plots in script: ${Object.keys(plots).join(", ")}`;
          st.symbols[symbol] = { error: alert.lastError, at: Date.now() };
          return;
        }
        const v = lastValue(plots, alert.plot);
        const prevPoint = series.length > 1 ? series[series.length - 2].value : null;
        const prev = typeof prevPoint === "boolean" ? prevPoint ? 1 : 0 : prevPoint;
        st.symbols[symbol] = { value: v, at: Date.now() };
        st.lastRun = Date.now();
        alert.lastError = "";
        const label = decide(alert, v, prev);
        const key = `${alertId}|${symbol}|${candle.openTime}`;
        if (!label || this.fired.has(key)) return;
        this.fired.add(key);
        if (this.fired.size > 2e4) this.fired = new Set(Array.from(this.fired).slice(-1e4));
        this.collect(alert, { symbol, label, value: v, prev, candle });
      }
      /** Gather signals for a moment so many pairs firing together become one message. */
      collect(alert, sig) {
        let box = this.outbox.get(alert.id);
        if (!box) {
          box = { items: [] };
          box.timer = setTimeout(() => {
            this.outbox.delete(alert.id);
            this.flush(alert.id, box.items);
          }, BUNDLE_MS);
          this.outbox.set(alert.id, box);
        }
        box.items.push(sig);
      }
      async flush(alertId, items) {
        const db2 = getDb();
        const alert = db2.alerts.find((a) => a.id === alertId);
        if (!alert || !items.length) return;
        const script = (listScripts().find((s) => s.id === alert.scriptId) || {}).name || alert.scriptId;
        const emoji = (v) => v > 0 ? "\u{1F7E2}" : v < 0 ? "\u{1F534}" : "\u{1F514}";
        const entries = items.map(({ symbol, label, value, prev, candle }) => {
          const name = displayName(symbol);
          const vars = {
            emoji: emoji(value),
            label,
            symbol,
            name,
            exchange: symbol.split(":")[0],
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
          return {
            id: crypto2.randomUUID(),
            alertId: alert.id,
            alert: alert.name,
            symbol,
            name,
            interval: alert.interval,
            label,
            value,
            close: candle.close,
            candleTime: candle.openTime,
            at: Date.now(),
            text: render(alert.template || db2.settings.template, vars),
            telegram: "sending"
          };
        });
        let messages;
        if (entries.length <= BUNDLE_OVER) {
          messages = entries.map((e) => e.text);
        } else {
          const head = `\u{1F4CA} ${alert.name} \xB7 ${alert.interval} \xB7 ${entries.length} signals
${script} \xB7 candle ${fmtTime(entries[0].candleTime)}
`;
          const lines = entries.map((e) => `${emoji(e.value)} ${e.label} ${e.name} @ ${fmtPrice(e.close)}`);
          messages = [];
          let cur = head;
          for (const l of lines) {
            if ((cur + "\n" + l).length > 3800) {
              messages.push(cur);
              cur = `(continued)`;
            }
            cur += "\n" + l;
          }
          messages.push(cur);
        }
        let status = "ok";
        const cfg = telegramConfig(db2.settings);
        for (const m of messages) {
          try {
            await sendTelegram(cfg, m);
          } catch (e) {
            status = e.message;
          }
          if (messages.length > 1) await new Promise((r) => setTimeout(r, 1100));
        }
        for (const e of entries) e.telegram = status;
        db2.history.unshift(...entries);
        db2.history.length = Math.min(db2.history.length, 1e3);
        save();
        log2(`"${alert.name}": ${entries.length} signal(s) \u2192 telegram: ${status}`);
        for (const e of entries) this.emit("signal", e);
      }
    };
  }
});

// lib/markets.js
var markets_exports = {};
__export(markets_exports, {
  PRESETS: () => PRESETS,
  displayName: () => displayName,
  precisionFor: () => precisionFor,
  quotes: () => quotes,
  resolvePreset: () => resolvePreset,
  searchSymbols: () => searchSymbols
});
async function binanceAll() {
  if (SIM()) return ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"].map((s, i) => ({ symbol: s, last: 100 * (i + 1), changePct: i - 2, quoteVolume: 1e9 / (i + 1) }));
  if (Date.now() - binanceTickers.at < 2e4 && binanceTickers.list.length) return binanceTickers.list;
  const r = await fetch(`${BINANCE_REST2}/api/v3/ticker/24hr?type=MINI`);
  if (!r.ok) throw new Error("Binance HTTP " + r.status);
  const list = (await r.json()).filter((t) => +t.lastPrice > 0 && +t.quoteVolume > 0).map((t) => ({ symbol: t.symbol, last: +t.lastPrice, changePct: +t.openPrice ? (+t.lastPrice - +t.openPrice) / +t.openPrice * 100 : 0, quoteVolume: +t.quoteVolume }));
  binanceTickers = { at: Date.now(), list };
  return list;
}
async function oandaAll() {
  if (SIM()) return FX_MAJORS.concat(["XAU_USD", "NAS100_USD"]).map((n) => ({ name: n, displayName: n.replace("_", "/"), type: n.startsWith("XAU") ? "METAL" : n.includes("100") ? "CFD" : "CURRENCY", displayPrecision: 5 }));
  if (!hasOanda()) return [];
  if (Date.now() - oandaList.at < 6 * 36e5 && oandaList.list.length) return oandaList.list;
  const list = await oandaInstruments();
  oandaList = { at: Date.now(), list };
  return list;
}
async function searchSymbols(q) {
  const s = String(q || "").toUpperCase().replace(/[/:\s_]/g, "");
  const out = [];
  try {
    for (const i of await oandaAll()) {
      const flat = i.name.replace("_", "");
      if (!s || flat.includes(s) || i.displayName.toUpperCase().replace(/[/ ]/g, "").includes(s)) {
        out.push({ id: `OANDA:${i.name}`, name: i.displayName, exchange: "OANDA", kind: oandaKind(i), precision: i.displayPrecision });
      }
    }
  } catch (_) {
  }
  try {
    const bin = (await binanceAll()).filter((t) => !s || t.symbol.includes(s)).sort((a, b) => {
      const ea = a.symbol === s || a.symbol === s + "USDT", eb = b.symbol === s || b.symbol === s + "USDT";
      return eb - ea || b.quoteVolume - a.quoteVolume;
    }).slice(0, 60);
    for (const t of bin) out.push({ id: `BINANCE:${t.symbol}`, name: t.symbol, exchange: "BINANCE", kind: "crypto", precision: precisionFor(t.last) });
  } catch (_) {
  }
  return out.sort((a, b) => (b.name.replace(/\W/g, "") === s) - (a.name.replace(/\W/g, "") === s)).slice(0, 80);
}
function precisionFor(p) {
  if (!p) return 2;
  if (p >= 1e3) return 2;
  if (p >= 10) return 3;
  if (p >= 1) return 4;
  if (p >= 0.01) return 5;
  return 8;
}
async function resolvePreset(id) {
  if (id.startsWith("crypto_top")) {
    const n = Number(id.replace("crypto_top", "")) || 50;
    const list = (await binanceAll()).filter((t) => t.symbol.endsWith("USDT") && !STABLE.has(t.symbol.slice(0, -4)) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol)).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, n);
    return list.map((t) => `BINANCE:${t.symbol}`);
  }
  if (!hasOanda() && !SIM()) throw new Error("This list needs OANDA (set OANDA_TOKEN in Render \u2192 Environment)");
  const all = await oandaAll();
  const pick = {
    fx_majors: (i) => FX_MAJORS.includes(i.name),
    fx_all: (i) => i.type === "CURRENCY",
    metals: (i) => i.type === "METAL",
    indices: (i) => INDEX_CODES.includes(i.name),
    commodities: (i) => COMMODITY_CODES.includes(i.name)
  }[id];
  if (!pick) throw new Error("Unknown list");
  return all.filter(pick).map((i) => `OANDA:${i.name}`);
}
async function quotes(ids, feeds2) {
  const out = {};
  const bin = [], oan = [];
  for (const raw of ids.slice(0, 200)) {
    let p;
    try {
      p = parseSymbol(raw);
    } catch (_) {
      continue;
    }
    (p.provider === "oanda" ? oan : bin).push(p);
  }
  if (bin.length) {
    try {
      const map = new Map((await binanceAll()).map((t) => [t.symbol, t]));
      for (const p of bin) {
        const t = map.get(p.code);
        if (t) out[p.id] = { last: t.last, changePct: t.changePct, precision: precisionFor(t.last) };
      }
    } catch (_) {
    }
  }
  if (oan.length && (hasOanda() || SIM())) {
    for (const p of oan) {
      const f = feeds2 && (feeds2.get(p.id, "1m") || feeds2.get(p.id, "5m") || feeds2.get(p.id, "15m") || feeds2.get(p.id, "1h"));
      const last = f && f.candles.length ? f.candles[f.candles.length - 1].close : null;
      let d = oandaDaily.get(p.code);
      if (!SIM() && (!d || Date.now() - d.at > 3e5)) {
        try {
          const r = await fetch(`${OANDA_REST2}/v3/instruments/${p.code}/candles?granularity=D&count=2&price=M`, { headers: { Authorization: `Bearer ${process.env.OANDA_TOKEN}` } });
          const c = (await r.json()).candles || [];
          d = { at: Date.now(), prevClose: c.length > 1 ? +c[c.length - 2].mid.c : null, last: c.length ? +c[c.length - 1].mid.c : null };
          oandaDaily.set(p.code, d);
        } catch (_) {
        }
      }
      const price = last ?? (d && d.last);
      if (price != null) out[p.id] = { last: price, changePct: d && d.prevClose ? (price - d.prevClose) / d.prevClose * 100 : null, precision: precisionFor(price) };
    }
  }
  return out;
}
var BINANCE_REST2, OANDA_REST2, SIM, hasOanda, STABLE, INDEX_CODES, COMMODITY_CODES, FX_MAJORS, binanceTickers, oandaList, oandaKind, PRESETS, oandaDaily;
var init_markets = __esm({
  "lib/markets.js"() {
    init_feed();
    init_symbols();
    BINANCE_REST2 = process.env.BINANCE_REST || "https://data-api.binance.vision";
    OANDA_REST2 = process.env.OANDA_REST || "https://api-fxpractice.oanda.com";
    SIM = () => process.env.FEED === "sim";
    hasOanda = () => !!process.env.OANDA_TOKEN;
    STABLE = /* @__PURE__ */ new Set(["USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "EUR", "GBP", "TRY", "BRL", "AEUR", "EURI", "USD1", "XUSD", "PAXG", "USDE", "BFUSD", "RLUSD"]);
    INDEX_CODES = ["US30_USD", "SPX500_USD", "NAS100_USD", "US2000_USD", "DE30_EUR", "DE40_EUR", "UK100_GBP", "FR40_EUR", "EU50_EUR", "JP225_USD", "HK33_HKD", "AU200_AUD", "CN50_USD", "IN50_USD", "NL25_EUR", "ESPIX_EUR", "CH20_CHF", "SG30_SGD", "TWIX_USD"];
    COMMODITY_CODES = ["BCO_USD", "WTICO_USD", "NATGAS_USD", "CORN_USD", "WHEAT_USD", "SOYBN_USD", "SUGAR_USD"];
    FX_MAJORS = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "USD_CAD", "NZD_USD"];
    binanceTickers = { at: 0, list: [] };
    oandaList = { at: 0, list: [] };
    oandaKind = (i) => i.type === "CURRENCY" ? "forex" : i.type === "METAL" ? "metal" : INDEX_CODES.includes(i.name) ? "index" : COMMODITY_CODES.includes(i.name) ? "commodity" : "cfd";
    PRESETS = [
      { id: "crypto_top20", name: "Crypto \u2014 top 20 USDT pairs (by 24h volume)" },
      { id: "crypto_top50", name: "Crypto \u2014 top 50 USDT pairs" },
      { id: "crypto_top100", name: "Crypto \u2014 top 100 USDT pairs" },
      { id: "fx_majors", name: "Forex \u2014 7 majors", oanda: true },
      { id: "fx_all", name: "Forex \u2014 all pairs (~68)", oanda: true },
      { id: "metals", name: "Metals \u2014 gold, silver\u2026", oanda: true },
      { id: "indices", name: "Indices \u2014 US30, NAS100, SPX500, DAX\u2026", oanda: true },
      { id: "commodities", name: "Commodities \u2014 oil, gas\u2026", oanda: true }
    ];
    oandaDaily = /* @__PURE__ */ new Map();
  }
});

// server.js
import http from "node:http";
import fs2 from "node:fs";
import path2 from "node:path";
import crypto3 from "node:crypto";
import { fileURLToPath as fileURLToPath2 } from "node:url";
try {
  const envFile = path2.join(path2.dirname(fileURLToPath2(import.meta.url)), ".env");
  for (const line of fs2.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch (_) {
}
var { FeedManager: FeedManager2, fetchHistory: fetchHistory2 } = await Promise.resolve().then(() => (init_feed(), feed_exports));
var { INTERVALS: INTERVALS2, parseSymbol: parseSymbol2, displayName: displayName2, supportsInterval: supportsInterval2 } = await Promise.resolve().then(() => (init_symbols(), symbols_exports));
var { AlertEngine: AlertEngine2 } = await Promise.resolve().then(() => (init_alerts(), alerts_exports));
var store = await Promise.resolve().then(() => (init_store(), store_exports));
var { runPine: runPine2, linePlots: linePlots2 } = await Promise.resolve().then(() => (init_pine(), pine_exports));
var { sendTelegram: sendTelegram2, telegramConfig: telegramConfig2, findChats: findChats2 } = await Promise.resolve().then(() => (init_telegram(), telegram_exports));
var markets = await Promise.resolve().then(() => (init_markets(), markets_exports));
var { getDb: getDb2, save: save2, listScripts: listScripts2, readScript: readScript2, writeScript: writeScript2, deleteScript: deleteScript2, safeId: safeId2 } = store;
var ROOT2 = path2.dirname(fileURLToPath2(import.meta.url));
var FLAT = !fs2.existsSync(path2.join(ROOT2, "public"));
var PUBLIC = FLAT ? ROOT2 : path2.join(ROOT2, "public");
var FLAT_FILES = /* @__PURE__ */ new Set(["index.html", "app.js", "style.css", "login.html"]);
var PORT = Number(process.env.PORT || 8080);
var HOST = process.env.HOST || "0.0.0.0";
var PASSWORD = process.env.APP_PASSWORD || "";
var SESSION = PASSWORD ? crypto3.createHash("sha256").update("pinealert:" + PASSWORD).digest("hex") : "";
var MAX_FEEDS = Number(process.env.MAX_FEEDS || 120);
var feeds = new FeedManager2();
var engine = new AlertEngine2(feeds);
await store.init();
var db0 = getDb2();
if (!db0.seeded) {
  if (!db0.alerts.length && readScript2("prev-candle-test")) {
    db0.alerts.push({
      id: crypto3.randomUUID(),
      name: "BTC 1m test",
      enabled: true,
      symbols: ["BINANCE:BTCUSDT"],
      interval: "1m",
      scriptId: "prev-candle-test",
      plot: "TVX_SIGNAL",
      trigger: "signal",
      labels: "1=BUY,-1=SELL",
      template: ""
    });
  }
  db0.seeded = true;
  save2();
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
  return c.length === SESSION.length && crypto3.timingSafeEqual(Buffer.from(c), Buffer.from(SESSION));
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
  const s = getDb2().settings;
  const tg = telegramConfig2(s);
  return {
    telegram: { tokenSet: !!tg.token, tokenHint: tg.token ? tg.token.slice(0, 6) + "\u2026" + tg.token.slice(-4) : "", chatId: tg.chatId, fromEnv: !!process.env.TELEGRAM_TOKEN },
    template: s.template
  };
}
var symbolOrThrow = (s) => parseSymbol2(s).id;
async function validateAlert(b, existingId) {
  const interval = b.interval;
  if (!INTERVALS2.includes(interval)) throw new Error("Invalid timeframe");
  if (!readScript2(b.scriptId)) throw new Error("Choose a script");
  let symbols = [];
  if (b.preset) symbols = await markets.resolvePreset(b.preset);
  const extra = Array.isArray(b.symbols) ? b.symbols : String(b.symbols || "").split(/[\s,;]+/);
  for (const s of extra) if (String(s).trim()) symbols.push(symbolOrThrow(s));
  symbols = Array.from(new Set(symbols));
  if (!symbols.length) throw new Error("Add at least one pair");
  const bad = symbols.filter((s) => !supportsInterval2(s, interval));
  if (bad.length) throw new Error(`${bad.slice(0, 3).join(", ")} ${bad.length > 1 ? "have" : "has"} no ${interval} timeframe (OANDA has no 3m/3d)`);
  const others = getDb2().alerts.filter((a) => a.enabled && a.id !== existingId);
  const keys = new Set(others.flatMap((a) => a.symbols.map((s) => `${s}|${a.interval}`)));
  if (b.enabled !== false) symbols.forEach((s) => keys.add(`${s}|${interval}`));
  if (keys.size > MAX_FEEDS) throw new Error(`Too many pairs in active alerts (${keys.size}). The free server is limited to ${MAX_FEEDS} pair/timeframe combinations \u2014 pause another alert or use fewer pairs.`);
  return {
    name: String(b.name || (symbols.length === 1 ? `${displayName2(symbols[0])} ${interval}` : `${symbols.length} pairs ${interval}`)).slice(0, 60),
    enabled: b.enabled !== false,
    symbols,
    interval,
    preset: b.preset || "",
    scriptId: safeId2(b.scriptId),
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
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 3000\n\n");
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 2e4);
  let feed = null, symbol = null, interval = null;
  const user = "chart:" + crypto3.randomUUID();
  const onUpdate = (c) => res.write(`event: candle
data: ${JSON.stringify(c)}

`);
  const onClose = (c) => res.write(`event: close
data: ${JSON.stringify(c)}

`);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
    if (feed) {
      feed.off("update", onUpdate);
      feed.off("close", onClose);
      feeds.release(symbol, interval, user);
    }
  });
  if (q.get("symbol")) {
    try {
      symbol = symbolOrThrow(q.get("symbol"));
      interval = INTERVALS2.includes(q.get("interval")) ? q.get("interval") : "1m";
      feed = await feeds.acquire(symbol, interval, user);
      if (res.destroyed) {
        feeds.release(symbol, interval, user);
        return;
      }
      feed.on("update", onUpdate);
      feed.on("close", onClose);
    } catch (e) {
      res.write(`event: problem
data: ${JSON.stringify({ error: e.message })}

`);
    }
  }
}
async function withFeed(symbol, interval, fn) {
  const user = "snap:" + crypto3.randomUUID();
  const feed = await feeds.acquire(symbol, interval, user);
  try {
    return await fn(feed);
  } finally {
    feeds.release(symbol, interval, user);
  }
}
async function history(res, q) {
  const symbol = symbolOrThrow(q.get("symbol"));
  const interval = q.get("interval");
  if (!supportsInterval2(symbol, interval)) return fail(res, 400, `${symbol} has no ${interval} timeframe`);
  const to = Number(q.get("to")) || 0;
  if (to) return send(res, 200, { candles: (await fetchHistory2(symbol, interval, { to, limit: 500 })).filter((c) => c.openTime < to) });
  return send(res, 200, await withFeed(symbol, interval, (f) => ({ candles: f.candles.slice(), status: f.status })));
}
async function signals(res, q) {
  const symbol = symbolOrThrow(q.get("symbol"));
  const interval = q.get("interval");
  const scriptId = q.get("script") || "";
  const plot = q.get("plot") || "TVX_SIGNAL";
  const source = scriptId && readScript2(scriptId);
  if (!source) return send(res, 200, { markers: [], lines: [], plots: [] });
  return send(res, 200, await withFeed(symbol, interval, async (feed) => {
    const closed = feed.candles.filter((c) => c.closed);
    try {
      const { plots, ms } = await runPine2(source, closed, 1e3);
      const markers = [];
      for (const d of plots[plot] || []) {
        const v = typeof d.value === "boolean" ? d.value ? 1 : 0 : d.value;
        if (typeof v === "number" && v !== 0) markers.push({ time: d.time, value: v });
      }
      return { ms, plots: Object.keys(plots), markers, lines: linePlots2(plots, plot) };
    } catch (e) {
      return { error: e.message, markers: [], lines: [], plots: [] };
    }
  }));
}
async function route(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const m = req.method;
  const q = url.searchParams;
  if (p === "/health") return send(res, 200, { ok: true, feeds: feeds.list().length, alerts: getDb2().alerts.length, queue: engine.queue.length });
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
    const d = getDb2();
    return send(res, 200, {
      intervals: INTERVALS2,
      feeds: feeds.list().length,
      maxFeeds: MAX_FEEDS,
      scripts: listScripts2(),
      alerts: d.alerts.map((a) => ({ ...a, status: engine.statusOf(a.id) })),
      watchlist: d.watchlist,
      settings: publicSettings(),
      history: d.history.slice(0, 150),
      presets: markets.PRESETS,
      oanda: !!process.env.OANDA_TOKEN || process.env.FEED === "sim",
      persistence: store.persistence(),
      passwordProtected: !!PASSWORD,
      simulated: process.env.FEED === "sim"
    });
  }
  if (p === "/api/search" && m === "GET") return send(res, 200, await markets.searchSymbols(q.get("q")));
  if (p === "/api/quotes" && m === "GET") return send(res, 200, await markets.quotes(String(q.get("symbols") || "").split(",").filter(Boolean), feeds));
  if (p === "/api/history" && m === "GET") return history(res, q);
  if (p === "/api/signals" && m === "GET") return signals(res, q);
  if (p === "/api/stream" && m === "GET") return stream(req, res, q);
  const pm = p.match(/^\/api\/presets\/([\w-]+)$/);
  if (pm && m === "GET") return send(res, 200, { symbols: await markets.resolvePreset(pm[1]) });
  if (p === "/api/watchlist" && m === "POST") {
    const b = await readBody(req);
    const list = Array.from(new Set((b.symbols || []).map(symbolOrThrow))).slice(0, 200);
    getDb2().watchlist = list;
    save2();
    return send(res, 200, { watchlist: list });
  }
  if (p === "/api/alerts" && m === "POST") {
    const b = await readBody(req);
    const d = getDb2();
    const clean = await validateAlert(b, b.id);
    let alert = b.id && d.alerts.find((a) => a.id === b.id);
    if (alert) Object.assign(alert, clean, { lastError: "" });
    else {
      alert = { id: crypto3.randomUUID(), ...clean, createdAt: Date.now() };
      d.alerts.push(alert);
    }
    save2();
    if (alert.enabled) engine.attach(alert).catch((e) => console.log("attach", e.message));
    else engine.detach(alert.id);
    return send(res, 200, alert);
  }
  const am = p.match(/^\/api\/alerts\/([\w-]+)$/);
  if (am && m === "DELETE") {
    const d = getDb2();
    engine.detach(am[1]);
    d.alerts = d.alerts.filter((a) => a.id !== am[1]);
    save2();
    return send(res, 200, { ok: true });
  }
  if (p === "/api/scripts/check" && m === "POST") {
    const b = await readBody(req);
    const symbol = symbolOrThrow(b.symbol || "BINANCE:BTCUSDT");
    const interval = supportsInterval2(symbol, b.interval) ? b.interval : "1h";
    try {
      return send(res, 200, await withFeed(symbol, interval, async (feed) => {
        const { plots, ms } = await runPine2(String(b.source || ""), feed.candles.filter((c) => c.closed));
        const last = Object.fromEntries(Object.entries(plots).map(([k, s]) => [k, s.length ? s[s.length - 1].value : null]));
        return { ok: true, ms, plots: last, symbol, interval };
      }));
    } catch (e) {
      return send(res, 200, { ok: false, error: e.message });
    }
  }
  const sm = p.match(/^\/api\/scripts\/([\w-]+)$/);
  if (sm && m === "GET") {
    const src = readScript2(sm[1]);
    return src == null ? fail(res, 404, "Not found") : send(res, 200, { id: sm[1], source: src });
  }
  if (sm && m === "PUT") {
    const b = await readBody(req);
    if (!b.source || !/indicator\s*\(|strategy\s*\(/.test(b.source)) throw new Error("The script needs an indicator(...) or strategy(...) line");
    return send(res, 200, { id: writeScript2(sm[1], b.source) });
  }
  if (sm && m === "DELETE") {
    if (getDb2().alerts.some((a) => a.scriptId === sm[1])) throw new Error("An alert uses this script \u2014 delete or change the alert first");
    deleteScript2(sm[1]);
    return send(res, 200, { ok: true });
  }
  if (p === "/api/settings" && m === "POST") {
    const b = await readBody(req);
    const s = getDb2().settings;
    if (b.telegram) {
      if (typeof b.telegram.token === "string" && b.telegram.token.trim()) s.telegram.token = b.telegram.token.trim();
      if (typeof b.telegram.chatId === "string") s.telegram.chatId = b.telegram.chatId.trim();
    }
    if (typeof b.template === "string" && b.template.trim()) s.template = b.template.slice(0, 1e3);
    save2();
    return send(res, 200, publicSettings());
  }
  if (p === "/api/telegram/test" && m === "POST") {
    await sendTelegram2(telegramConfig2(getDb2().settings), "\u2705 PineAlert is connected. Your signals will arrive here.");
    return send(res, 200, { ok: true });
  }
  if (p === "/api/telegram/find" && m === "POST") {
    const b = await readBody(req);
    const token = (b.token || "").trim() || telegramConfig2(getDb2().settings).token;
    if (!token) throw new Error("Paste the bot token first");
    return send(res, 200, { chats: await findChats2(token) });
  }
  if (p === "/api/history" && m === "DELETE") {
    getDb2().history = [];
    save2();
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
  console.log(`PineAlert running on http://${HOST}:${PORT}  (data: ${process.env.FEED === "sim" ? "SIMULATED" : "Binance" + (process.env.OANDA_TOKEN ? " + OANDA" : "")} \xB7 storage: ${store.persistence().enabled ? "GitHub " + store.persistence().repo : "local only"})`);
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
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => {
  try {
    await store.flush();
  } catch (_) {
  }
  process.exit(0);
});
