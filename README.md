# OMNISCIENT — XAU/USDT Multi-Timeframe Scalping Terminal

A Bloomberg-style gold scalping terminal for the **XAU/USDT** perpetual, built with Next.js and
powered entirely by **real OKX exchange data** — live ticker, order book, candles and derivatives.

## Features

- **Pure OKX V5 order flow (Solution A)** for `XAU-USDT-SWAP` (displayed as `XAUUSDT`):
  1. 1m CLV + tick-rule delta estimator on 1,500 historical 1m bars (index 6 `volCcy` = true XAU volume).
  2. 1m → 3m…4H delta rollup across the last 25 hours (fixes absorption-wick misreads).
  3. Tick-exact backfill from ~1,000 real taker prints (`/market/trades` + `/market/history-trades`).
  4. Persistent `okx_xau_flow_YYYY_MM_DD` localStorage ring-buffer so 00:00 UTC CVD survives refreshes.
- **Zero-polling dual WebSocket**: all 8 `candle*` channels on `/ws/v5/business`; `bbo-tbt`, `trades`,
  `liquidation-orders`, `mark-price`, `index-tickers`, `funding-rate`, `open-interest` on `/ws/v5/public`.
  Frames are buffered until REST hydration finishes, trades are keyed by bar-open time per timeframe,
  gaps heal with `before=` / `after=` cursors, and a ping/pong dead-man's switch halts stale feeds.
- **Rate-limit safe REST**: per-endpoint sliding windows at 75% of OKX limits, 429 / `50011` back-off,
  1m bars 1–1,200 from `/market/candles` and 1,201–1,500 from `/market/history-candles`.
- **Confluence**: PDH / PDL / Asian range sweeps, 00:00 UTC VWAP ±1/2SD, CVD divergence, absorption,
  ΔPrice vs ΔOI regime, and a 1m–4H delta & EMA20 trend matrix (`confluence_score` −8…+8).
- **8 Scalp Trade Cards (1m, 3m, 5m, 15m, 30m, 1H, 2H, 4H)** with an 8-factor Signal Agreement %,
  cross-timeframe alignment, an immutable SCANNING → LOCKED → RESOLVED lock (frozen entry / SL / TP1–3),
  breakeven and profit trails, max-hold expiry and a one-bar cooldown. Cards use zero extra REST calls.

## v18 upgrade — close-candle sealed signals

- **Close-candle intelligence** (`lib/xau/candle-intel.ts`): every confirmed candle is scored on CLV, body, pattern
  (engulf / pin / marubozu / break of prior high-low), delta confirmation, volume expansion and confirmed EMA side.
- **Candle fill logic**: fair-value gaps over the last 80 closed bars with live fill %, previous-candle 50% fill,
  and an **Ideal Entry** limit at the nearest unfilled FVG edge → signal candle 50% → 33% of risk.
- **Signal Agreement %** = 45% closed intra-TF score + 25% close-candle score + 30% HTF-weighted cross-TF alignment.
- **Immutable lock**: one decision per confirmed close, 8 gates must pass, structure-based stop, Entry / Ideal Entry /
  Stop Loss / Target 1-3 deep-frozen and sealed (64-bit FNV-1a), re-verified every tick and restored across reloads.

## Architecture

All market logic runs in the browser (`lib/xau/`): `engine.ts` (boot handshake, sockets, bar state
machine), `orderflow.ts`, `indicators.ts` (non-drifting two-state EMA/ATR/RSI), `confluence.ts`,
`scalp-cards.ts`, `rest.ts` (rate limiter) and `ring-buffer.ts`. UI lives in `components/terminal/`.

## Getting started

Clone and run the exact same terminal:

```bash
git clone https://github.com/mauryapankaj8225-sys/Molahodert.git
cd Molahodert

# pnpm (recommended — the repo ships a pnpm-lock.yaml)
corepack enable
pnpm install
pnpm dev

# or npm
npm install
npm run dev
```

Open http://localhost:3000.

No API keys or configuration are required — the terminal reads only public OKX market data
endpoints, so it works out of the box with no `.env` file.

Production build:

```bash
pnpm build && pnpm start
```

## Disclaimer

Designed for discipline, not certainty. No signal guarantees profit. Factor agreement is not a
probability of profit. This terminal does not place trades. Trade only with capital you can afford
to lose.
