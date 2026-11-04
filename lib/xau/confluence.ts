import { TFS, type Tf } from './constants'
import type { Confluence, IndicatorState, OiRegime, XBar } from './types'

const DAY_MS = 86_400_000
const ASIAN_END_MS = 8 * 3_600_000
const dateKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export const emptyConfluence = (): Confluence => ({
  ready: false, pdh: null, pdl: null, pd_date: null, cdh: null, cdl: null, dist_pdh: null, dist_pdl: null,
  asian_high: null, asian_low: null, pdh_sweep: false, pdl_sweep: false, sweep_alert: false, sweep_testing: false, sweep_detail: null,
  utc_vwap: null, vwap_distance: null, vwap_upper_1sd: null, vwap_lower_1sd: null, vwap_upper_2sd: null, vwap_lower_2sd: null,
  cvd: null, cvd_bull_div: false, cvd_bear_div: false, absorption_bull: false, absorption_bear: false, absorption_tf: null,
  oi_regime: 'NEUTRAL', oi_delta_xau: null, oi_price_delta: null, matrix: [], confluence_score: 0, terminal_bias: 'SYNCING...',
})

export type OiSample = { ts: number; oi: number; px: number }

export function classifyOi(samples: OiSample[], nowMs: number): { regime: OiRegime; dOi: number | null; dPx: number | null } {
  const latest = samples.at(-1)
  if (!latest) return { regime: 'NEUTRAL', dOi: null, dPx: null }
  const base = samples.find(s => nowMs - s.ts <= 300_000 && latest.ts - s.ts >= 60_000) ?? samples[0]
  if (base === latest) return { regime: 'NEUTRAL', dOi: 0, dPx: 0 }
  const dOi = latest.oi - base.oi
  const dPx = latest.px - base.px
  let regime: OiRegime = 'NEUTRAL'
  if (dPx > 0 && dOi > 0) regime = 'NEW_LONGS'
  else if (dPx > 0 && dOi < 0) regime = 'SHORT_SQUEEZE'
  else if (dPx < 0 && dOi > 0) regime = 'NEW_SHORTS'
  else if (dPx < 0 && dOi < 0) regime = 'LONG_LIQ_FLUSH'
  return { regime, dOi, dPx }
}

function absorption(bars: XBar[]) {
  const bar = bars.at(-2)
  if (!bar?.is_closed || bars.length < 23) return { bull: false, bear: false }
  const window = bars.slice(-22, -2)
  const avgVol20 = window.reduce((sum, b) => sum + b.volume, 0) / window.length
  const range = bar.high - bar.low
  if (!(bar.volume > 2 * avgVol20) || range <= 0 || Math.abs(bar.close - bar.open) > 0.25 * range) return { bull: false, bear: false }
  const clv = (bar.close - bar.low) / range
  // Aggressive sellers absorbed by passive bids (close holds high) is bullish, and the mirror is bearish.
  return { bull: bar.delta < 0 && clv >= 0.5, bear: bar.delta > 0 && clv <= 0.5 }
}

export function computeConfluence(
  bars: Record<Tf, XBar[]>,
  ind: Record<Tf, IndicatorState>,
  price: number,
  nowMs: number,
  oi: { regime: OiRegime; dOi: number | null; dPx: number | null },
): Confluence {
  const out = emptyConfluence()
  const b1m = bars['1m']
  const b1h = bars['1h']
  if (!b1m.length || !b1h.length || !(price > 0)) return out

  const today0 = Math.floor(nowMs / DAY_MS) * DAY_MS
  const todayKey = dateKey(today0)

  // 24-hour liquidity map
  const byDay = new Map<string, { h: number; l: number }>()
  for (const b of b1h) {
    const key = dateKey(b.ts)
    const day = byDay.get(key)
    if (day) { day.h = Math.max(day.h, b.high); day.l = Math.min(day.l, b.low) }
    else byDay.set(key, { h: b.high, l: b.low })
  }
  const prevKey = [...byDay.keys()].filter(k => k < todayKey).sort().at(-1)
  if (prevKey) {
    const pd = byDay.get(prevKey)!
    out.pdh = pd.h; out.pdl = pd.l; out.pd_date = prevKey
    out.dist_pdh = price - pd.h; out.dist_pdl = price - pd.l
  }
  const today = byDay.get(todayKey)
  if (today) { out.cdh = today.h; out.cdl = today.l }

  if (out.pdh !== null && out.pdl !== null) {
    for (const tf of ['1m', '5m'] as const) {
      const list = bars[tf]
      const prev = list.at(-2)
      const live = list.at(-1)
      if (prev?.is_closed) {
        if (prev.high > out.pdh && prev.close < out.pdh) { out.pdh_sweep = true; out.sweep_detail = `${tf} PDH sweep rejected` }
        if (prev.low < out.pdl && prev.close > out.pdl) { out.pdl_sweep = true; out.sweep_detail = `${tf} PDL sweep reclaimed` }
      }
      if (live && (live.high > out.pdh || live.low < out.pdl)) out.sweep_testing = true
    }
    out.sweep_alert = out.pdh_sweep || out.pdl_sweep
  }

  // 00:00 UTC VWAP + SD bands, CVD and Asian range
  const todays = b1m.filter(b => b.ts >= today0)
  let cumVol = 0, cumPv = 0, cumP2v = 0, cvd = 0
  const cvdSeries: number[] = []
  let asianHigh = -Infinity, asianLow = Infinity
  for (const b of todays) {
    const tp = (b.high + b.low + b.close) / 3
    cumVol += b.volume; cumPv += tp * b.volume; cumP2v += tp * tp * b.volume
    cvd += b.delta
    cvdSeries.push(cvd)
    if (b.ts < today0 + ASIAN_END_MS) { asianHigh = Math.max(asianHigh, b.high); asianLow = Math.min(asianLow, b.low) }
  }
  if (cumVol > 0) {
    const vwap = cumPv / cumVol
    const std = Math.sqrt(Math.max(0, cumP2v / cumVol - vwap * vwap))
    out.utc_vwap = vwap; out.vwap_distance = price - vwap
    out.vwap_upper_1sd = vwap + std; out.vwap_lower_1sd = vwap - std
    out.vwap_upper_2sd = vwap + 2 * std; out.vwap_lower_2sd = vwap - 2 * std
  }
  if (todays.length) out.cvd = cvd
  if (Number.isFinite(asianHigh)) { out.asian_high = asianHigh; out.asian_low = asianLow }

  // CVD divergence at PDH / PDL / Asian range boundaries (last 60 minutes split into two halves)
  if (todays.length >= 60) {
    const n = todays.length
    const prior = { from: n - 60, to: n - 30 }
    const recent = { from: n - 30, to: n }
    const argExt = (from: number, to: number, pick: (b: XBar) => number, better: (a: number, b: number) => boolean) => {
      let idx = from
      for (let i = from; i < to; i++) if (better(pick(todays[i]), pick(todays[idx]))) idx = i
      return idx
    }
    const tol = Math.max((ind['5m'].atr14 || 0) * 0.5, 0.5)
    const levels = [out.pdh, out.pdl, out.asian_high, out.asian_low].filter((v): v is number => v !== null)
    const nearLevel = (px: number) => levels.some(level => Math.abs(px - level) <= tol)
    const pLow = argExt(prior.from, prior.to, b => b.low, (a, b) => a < b)
    const rLow = argExt(recent.from, recent.to, b => b.low, (a, b) => a < b)
    if (todays[rLow].low < todays[pLow].low && cvdSeries[rLow] > cvdSeries[pLow] && nearLevel(todays[rLow].low)) out.cvd_bull_div = true
    const pHigh = argExt(prior.from, prior.to, b => b.high, (a, b) => a > b)
    const rHigh = argExt(recent.from, recent.to, b => b.high, (a, b) => a > b)
    if (todays[rHigh].high > todays[pHigh].high && cvdSeries[rHigh] < cvdSeries[pHigh] && nearLevel(todays[rHigh].high)) out.cvd_bear_div = true
  }

  for (const tf of ['1m', '5m'] as const) {
    const a = absorption(bars[tf])
    if (a.bull || a.bear) { out.absorption_bull ||= a.bull; out.absorption_bear ||= a.bear; out.absorption_tf ??= tf }
  }

  out.oi_regime = oi.regime
  out.oi_delta_xau = oi.dOi
  out.oi_price_delta = oi.dPx

  // 1m–4h delta & trend alignment matrix
  let score = 0
  for (const tf of TFS) {
    const list = bars[tf]
    const s = ind[tf]
    const last = list.at(-1)
    if (!last || !s.ready) { out.matrix.push({ tf, delta5: 0, ema20: 0, close: 0, vote: 0 }); continue }
    const delta5 = list.slice(-5).reduce((sum, b) => sum + b.delta, 0)
    const vote: -1 | 0 | 1 = delta5 > 0 && last.close > s.live_ema20 ? 1 : delta5 < 0 && last.close < s.live_ema20 ? -1 : 0
    score += vote
    out.matrix.push({ tf, delta5, ema20: s.live_ema20, close: last.close, vote })
  }
  out.confluence_score = score
  out.terminal_bias = score >= 5 ? 'STRONG BULLISH' : score <= -5 ? 'STRONG BEARISH' : 'MIXED / CHOP'
  out.ready = out.utc_vwap !== null
  return out
}
