import type { IndicatorState, XBar } from './types'

const K9 = 2 / 10
const K20 = 2 / 21
const K50 = 2 / 51
const RSI_N = 14
const ATR_N = 14
const WARMUP = 50

export const emptyIndicators = (): IndicatorState => ({
  ready: false, count: 0, prev_close: 0, ema9: 0, ema20: 0, ema50: 0, atr14: 0, avg_gain: 0, avg_loss: 0,
  live_ema9: 0, live_ema20: 0, live_ema50: 0, live_atr14: 0, live_rsi14: 50,
})

const trueRange = (bar: XBar, prevClose: number) => prevClose > 0
  ? Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose))
  : bar.high - bar.low

/**
 * Advance the confirmed (non-drifting) state by one CLOSED bar. EMAs seed from the first close
 * and Wilder RMAs (ATR / RSI) use 1/n smoothing; values are trusted once WARMUP bars are processed.
 */
export function commitClosedBar(s: IndicatorState, bar: XBar) {
  const c = bar.close
  if (s.count === 0) {
    s.ema9 = s.ema20 = s.ema50 = c
    s.atr14 = bar.high - bar.low
    s.avg_gain = 0
    s.avg_loss = 0
  } else {
    s.ema9 = (c - s.ema9) * K9 + s.ema9
    s.ema20 = (c - s.ema20) * K20 + s.ema20
    s.ema50 = (c - s.ema50) * K50 + s.ema50
    const tr = trueRange(bar, s.prev_close)
    s.atr14 = (s.atr14 * (ATR_N - 1) + tr) / ATR_N
    const change = c - s.prev_close
    s.avg_gain = (s.avg_gain * (RSI_N - 1) + Math.max(change, 0)) / RSI_N
    s.avg_loss = (s.avg_loss * (RSI_N - 1) + Math.max(-change, 0)) / RSI_N
  }
  s.prev_close = c
  s.count += 1
  s.ready = s.count >= WARMUP
}

const rsiFrom = (gain: number, loss: number) => loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss)

/** Pure temporary projection of the live forming bar; never mutates confirmed state. */
export function projectLive(s: IndicatorState, live: XBar | undefined) {
  if (!live || s.count === 0) return
  const c = live.close
  s.live_ema9 = (c - s.ema9) * K9 + s.ema9
  s.live_ema20 = (c - s.ema20) * K20 + s.ema20
  s.live_ema50 = (c - s.ema50) * K50 + s.ema50
  s.live_atr14 = (s.atr14 * (ATR_N - 1) + trueRange(live, s.prev_close)) / ATR_N
  const change = c - s.prev_close
  s.live_rsi14 = rsiFrom((s.avg_gain * (RSI_N - 1) + Math.max(change, 0)) / RSI_N, (s.avg_loss * (RSI_N - 1) + Math.max(-change, 0)) / RSI_N)
}

export function initIndicators(bars: XBar[]): IndicatorState {
  const s = emptyIndicators()
  for (const bar of bars.slice(0, -1)) commitClosedBar(s, bar)
  projectLive(s, bars.at(-1))
  return s
}

/** EMA series for chart overlays (display only). */
export function emaSeries(values: number[], period: number) {
  const k = 2 / (period + 1)
  const out: number[] = []
  let prev = values[0] ?? 0
  for (const v of values) { prev = (v - prev) * k + prev; out.push(prev) }
  return out
}
