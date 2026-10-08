# PineAlert

Your own live chart + Pine Script® alerts sent to Telegram, running 24/7 on Render's free plan.

- Test strategy included (`prev-candle-test.pine`): BTCUSDT 1m, candle closes red → BUY, green → SELL.
- Login password: Render → pinealert → Environment → `APP_PASSWORD`.
- Telegram: set `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID` in Render → Environment (kept across restarts).
- Add your own script: save it in the app's Scripts tab, or add a `.pine` file to this repository.

Licences: PineTS (AGPL-3.0), Lightweight Charts™ (Apache-2.0, © TradingView, Inc.).
