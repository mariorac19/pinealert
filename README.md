# PineAlert

Your own TradingView-style charts with Pine Script® alerts sent to Telegram, running 24/7 on Render's free plan.

- **Markets:** every Binance crypto pair, plus forex, gold/silver, indices and oil through a free OANDA practice account.
- **Chart:** drawing tools (trend lines, Fibonacci, channels, shapes, waves), 20+ indicators, timeframes 1m–1W, scroll back through history, and your Pine script's signals and lines on top.
- **Watchlist alerts:** run one Pine script on up to ~100 pairs. When many signals fire at once they arrive as one Telegram summary.

## Settings (Render → pinealert → Environment)

| Key | What it is |
|---|---|
| `APP_PASSWORD` | Login password for the site |
| `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID` | Your Telegram bot and chat |
| `OANDA_TOKEN` | Personal access token of a free OANDA *practice* account (forex/metals/indices) |
| `GITHUB_TOKEN`, `GITHUB_DATA_REPO` | Saves alerts, watchlist and your scripts to a **private** repo so restarts lose nothing |

## Your Pine script
Add one line so alerts can read your signals:
```pine
plot(buy ? 1 : sell ? -1 : 0, "TVX_SIGNAL", display = display.data_window)
```

Licences: PineTS (AGPL-3.0), KLineChart / KLineChart Pro (Apache-2.0).
