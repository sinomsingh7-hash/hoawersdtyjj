import type { CandleFill, CandlePattern, CloseIntel, Fvg, IndicatorState, XBar } from './types'

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d

/** Index of the last CONFIRMED candle (the forming bar is never used for close intelligence). */
export const lastClosedIndex = (bars: XBar[]) => {
  if (!bars.length) return -1
  return bars[bars.length - 1].is_closed ? bars.length - 1 : bars.length - 2
}

function classify(c: XBar, p: XBar): CandlePattern {
  const range = Math.max(c.high - c.low, 1e-9)
  const body = Math.abs(c.close - c.open)
  const upWick = c.high - Math.max(c.open, c.close)
  const loWick = Math.min(c.open, c.close) - c.low
  const bull = c.close > c.open
  const bear = c.close < c.open
  const pBody = Math.abs(p.close - p.open)
  if (bull && p.close < p.open && c.close >= p.open && c.open <= p.close && body > pBody) return 'BULL_ENGULF'
  if (bear && p.close > p.open && c.close <= p.open && c.open >= p.close && body > pBody) return 'BEAR_ENGULF'
  if (loWick >= 0.55 * range && body <= 0.35 * range && c.close >= c.low + 0.6 * range) return 'BULL_PIN'
  if (upWick >= 0.55 * range && body <= 0.35 * range && c.close <= c.low + 0.4 * range) return 'BEAR_PIN'
  if (body >= 0.8 * range) return bull ? 'BULL_MARUBOZU' : 'BEAR_MARUBOZU'
  if (body <= 0.1 * range) return 'DOJI'
  if (c.high <= p.high && c.low >= p.low) return 'INSIDE'
  return bull ? 'BULL_CLOSE' : 'BEAR_CLOSE'
}

export const emptyCloseIntel = (): CloseIntel => ({
  ready: false, bar_ts: 0, close_time_ms: 0, open: 0, high: 0, low: 0, close: 0, dir: 'SYNCING', score: 0, long_pts: 0, short_pts: 0,
  pattern: 'DOJI', body_pct: 0, upper_wick_pct: 0, lower_wick_pct: 0, clv: 0, vol_ratio: 0, range_atr: 0, delta: 0, delta_confirm: false,
  break_state: 'INSIDE_PREV', ema_side: 'MIXED',
})

/**
 * Score the last closed candle 0–100 per side from six confirmed-only factors:
 * close location (25), body strength (15), pattern (20), delta confirmation (15),
 * volume expansion (10) and confirmed EMA side (15).
 */
export function analyzeClosedCandle(bars: XBar[], ind: IndicatorState, tfMs: number): CloseIntel {
  const i = lastClosedIndex(bars)
  if (i < 21 || !ind.ready) return emptyCloseIntel()
  const c = bars[i]
  const p = bars[i - 1]
  const range = Math.max(c.high - c.low, 1e-9)
  const body = Math.abs(c.close - c.open)
  const upWick = c.high - Math.max(c.open, c.close)
  const loWick = Math.min(c.open, c.close) - c.low
  const clv = ((c.close - c.low) - (c.high - c.close)) / range
  let volSum = 0
  for (let k = i - 20; k < i; k++) volSum += bars[k].volume
  const volRatio = c.volume / Math.max(volSum / 20, 1e-9)
  const pattern = classify(c, p)
  const bull = c.close > c.open
  const bear = c.close < c.open
  const breakState: CloseIntel['break_state'] = c.close > p.high ? 'ABOVE_PREV_HIGH' : c.close < p.low ? 'BELOW_PREV_LOW' : 'INSIDE_PREV'
  const emaSide: CloseIntel['ema_side'] = c.close > ind.ema20 && ind.ema9 > ind.ema20 ? 'ABOVE' : c.close < ind.ema20 && ind.ema9 < ind.ema20 ? 'BELOW' : 'MIXED'
  const bodyPct = body / range
  let l = 0, s = 0

  if (clv >= 0.6) l += 25; else if (clv >= 0.3) l += 15
  if (clv <= -0.6) s += 25; else if (clv <= -0.3) s += 15

  if (bull && bodyPct >= 0.6) l += 15; else if (bull && bodyPct >= 0.4) l += 8
  if (bear && bodyPct >= 0.6) s += 15; else if (bear && bodyPct >= 0.4) s += 8

  const patternPts: Partial<Record<CandlePattern, [number, number]>> = {
    BULL_ENGULF: [20, 0], BEAR_ENGULF: [0, 20], BULL_PIN: [18, 0], BEAR_PIN: [0, 18], BULL_MARUBOZU: [15, 0], BEAR_MARUBOZU: [0, 15],
  }
  const [pl, ps] = patternPts[pattern] ?? [breakState === 'ABOVE_PREV_HIGH' ? 12 : 0, breakState === 'BELOW_PREV_LOW' ? 12 : 0]
  l += pl; s += ps

  const deltaConfirm = (bull && c.delta > 0) || (bear && c.delta < 0) || (pattern === 'BULL_PIN' && c.delta > 0) || (pattern === 'BEAR_PIN' && c.delta < 0)
  if (deltaConfirm && c.delta > 0) l += 15
  if (deltaConfirm && c.delta < 0) s += 15

  const volPts = volRatio >= 1.3 ? 10 : volRatio >= 1.0 ? 5 : 0
  if (bull || pattern === 'BULL_PIN') l += volPts
  else if (bear || pattern === 'BEAR_PIN') s += volPts

  if (emaSide === 'ABOVE') l += 15; else if (c.close > ind.ema20) l += 8
  if (emaSide === 'BELOW') s += 15; else if (c.close < ind.ema20) s += 8

  const score = Math.max(l, s)
  return {
    ready: true,
    bar_ts: c.ts,
    close_time_ms: c.ts + tfMs,
    open: c.open, high: c.high, low: c.low, close: c.close,
    dir: score < 50 || l === s ? 'NEUTRAL' : l > s ? 'LONG' : 'SHORT',
    score: round(score, 1),
    long_pts: round(l, 1),
    short_pts: round(s, 1),
    pattern,
    body_pct: round(bodyPct * 100, 1),
    upper_wick_pct: round((upWick / range) * 100, 1),
    lower_wick_pct: round((loWick / range) * 100, 1),
    clv: round(clv, 2),
    vol_ratio: round(volRatio, 2),
    range_atr: round(range / Math.max(ind.atr14, 1e-9), 2),
    delta: c.delta,
    delta_confirm: deltaConfirm,
    break_state: breakState,
    ema_side: emaSide,
  }
}

export const emptyFill = (): CandleFill => ({ ready: false, open_fvgs: [], nearest_bull: null, nearest_bear: null, filled_recent: 0, prev_candle_mid: 0, prev_candle_fill_pct: 0, prev_candle_mid_filled: false })

/**
 * Candle fill logic. Scans the last 80 closed candles for fair-value gaps (candle[i-1].high < candle[i+1].low
 * for bulls, mirrored for bears), then measures how much of each gap later price (including the forming bar)
 * has filled. Also measures how far the forming bar has retraced into the last closed candle's range.
 */
export function analyzeCandleFill(bars: XBar[], atr: number, price: number): CandleFill {
  const end = lastClosedIndex(bars)
  if (end < 5 || !(atr > 0) || !(price > 0)) return emptyFill()
  const start = Math.max(1, end - 80)
  const minGap = 0.05 * atr
  const open: Fvg[] = []
  let filledRecent = 0
  for (let i = start; i < end; i++) {
    const a = bars[i - 1]
    const c = bars[i + 1]
    let side: Fvg['side'] | null = null
    let top = 0, bottom = 0
    if (c.low - a.high >= minGap) { side = 'BULL'; top = c.low; bottom = a.high }
    else if (a.low - c.high >= minGap) { side = 'BEAR'; top = a.low; bottom = c.high }
    if (!side) continue
    let extreme = side === 'BULL' ? top : bottom
    for (let k = i + 2; k < bars.length; k++) extreme = side === 'BULL' ? Math.min(extreme, bars[k].low) : Math.max(extreme, bars[k].high)
    const size = top - bottom
    const filled = side === 'BULL' ? top - extreme : extreme - bottom
    const fillPct = Math.max(0, Math.min(100, (filled / size) * 100))
    if (fillPct >= 100) { filledRecent++; continue }
    open.push({ id: `${side}-${bars[i].ts}`, side, top: round(top), bottom: round(bottom), created_ts: bars[i].ts, fill_pct: round(fillPct, 1) })
  }
  const bulls = open.filter(g => g.side === 'BULL' && g.top <= price).sort((x, y) => y.top - x.top)
  const bears = open.filter(g => g.side === 'BEAR' && g.bottom >= price).sort((x, y) => x.bottom - y.bottom)
  const prev = bars[end]
  const forming = bars[bars.length - 1]
  const mid = (prev.high + prev.low) / 2
  const prevRange = Math.max(prev.high - prev.low, 1e-9)
  let fillPct = 0
  let midFilled = false
  if (forming !== prev) {
    const bullPrev = prev.close >= prev.open
    const retrace = bullPrev ? prev.high - forming.low : forming.high - prev.low
    fillPct = Math.max(0, Math.min(100, (retrace / prevRange) * 100))
    midFilled = bullPrev ? forming.low <= mid : forming.high >= mid
  }
  const nearest = [...bulls.slice(0, 2), ...bears.slice(0, 2)].sort((x, y) => Math.abs(price - (x.top + x.bottom) / 2) - Math.abs(price - (y.top + y.bottom) / 2))
  return {
    ready: true,
    open_fvgs: nearest,
    nearest_bull: bulls[0] ?? null,
    nearest_bear: bears[0] ?? null,
    filled_recent: filledRecent,
    prev_candle_mid: round(mid),
    prev_candle_fill_pct: round(fillPct, 1),
    prev_candle_mid_filled: midFilled,
  }
}
