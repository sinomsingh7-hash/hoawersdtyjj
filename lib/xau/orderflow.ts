import type { Flow, XBar } from './types'

export type CandleRow = string[]

/** Parse a 9-element OKX candle row into the 13-key bar. Index 6 (volCcy) is true XAU volume. */
export function parseRow(row: CandleRow, tfMs: number): XBar | null {
  const ts = Number.parseInt(row[0], 10)
  const open = Number.parseFloat(row[1])
  const high = Number.parseFloat(row[2])
  const low = Number.parseFloat(row[3])
  const close = Number.parseFloat(row[4])
  const volume = Number.parseFloat(row[6])
  const quote_vol = Number.parseFloat(row[7])
  if (![ts, open, high, low, close, volume, quote_vol].every(Number.isFinite) || low <= 0 || high < low) return null
  return {
    ts, open, high, low, close, volume, quote_vol,
    close_ts: ts + tfMs - 1,
    is_closed: String(row[8]) === '1',
    trades: Math.trunc(Number.parseFloat(row[5]) || 0),
    buy_vol: 0,
    sell_vol: 0,
    delta: 0,
  }
}

/**
 * Solution A — Mechanism 1: 1-minute intrabar CLV + tick-rule hybrid estimator.
 * 70% weight on close location inside the range, 30% on body direction; tick rule on flat bars.
 */
export function compute1mHistoricalOrderflow(bar: Pick<XBar, 'open' | 'high' | 'low' | 'close' | 'volume'>, prevClose: number) {
  const { open: o, high: h, low: l, close: c, volume: volXau } = bar
  const rng = h - l
  let buyRatio: number
  if (rng > 0) {
    const clvBuyRatio = (c - l) / rng
    const bodyRatio = 0.5 + 0.5 * ((c - o) / rng)
    buyRatio = 0.7 * clvBuyRatio + 0.3 * bodyRatio
  } else {
    buyRatio = c > prevClose ? 0.65 : c < prevClose ? 0.35 : 0.5
  }
  const buy_vol = volXau * buyRatio
  const sell_vol = volXau - buy_vol
  return { buy_vol, sell_vol, delta: buy_vol - sell_vol }
}

export function applyEstimatedFlow(bars: XBar[]) {
  for (let i = 0; i < bars.length; i++) {
    const prevClose = i > 0 ? bars[i - 1].close : bars[i].open
    Object.assign(bars[i], compute1mHistoricalOrderflow(bars[i], prevClose))
  }
}

/**
 * Solution A — Mechanism 2: overwrite HTF buy/sell/delta with the sum of constituent 1m bars
 * for every HTF bar inside the 1m history window (fixes absorption-wick misreads).
 */
export function rollup1mDeltaToHtf(bars1m: XBar[], htfBars: XBar[], tfMs: number) {
  const oldest1mTs = bars1m.length ? bars1m[0].ts : 0
  const buckets = new Map<number, XBar[]>()
  for (const b of bars1m) {
    const bucketTs = Math.floor(b.ts / tfMs) * tfMs
    const list = buckets.get(bucketTs)
    if (list) list.push(b)
    else buckets.set(bucketTs, [b])
  }
  for (const htf of htfBars) {
    if (htf.ts < oldest1mTs) continue
    const sub = buckets.get(htf.ts)
    if (!sub?.length) continue
    htf.buy_vol = sub.reduce((sum, b) => sum + b.buy_vol, 0)
    htf.sell_vol = sub.reduce((sum, b) => sum + b.sell_vol, 0)
    htf.delta = htf.buy_vol - htf.sell_vol
  }
}

/** Merge batches: each OKX batch is newest-first, so reverse, dedupe by ts (later page wins), sort ascending. */
export function mergeBatches(batches: XBar[][]): XBar[] {
  const byTs = new Map<number, XBar>()
  for (const batch of batches) for (const bar of batch) byTs.set(bar.ts, bar)
  return [...byTs.values()].sort((a, b) => a.ts - b.ts)
}

export function addFlow(target: Flow, source: Flow) {
  target.buy_vol += source.buy_vol
  target.sell_vol += source.sell_vol
  target.delta = target.buy_vol - target.sell_vol
  target.trades += source.trades
}
