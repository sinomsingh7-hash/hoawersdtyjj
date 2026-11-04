import { SCALP_CARD_CONFIG, TFS, TF_MS, type ScalpCardConfig, type Tf } from './constants'
import { analyzeCandleFill, analyzeClosedCandle, lastClosedIndex } from './candle-intel'
import { computeSeal, deepFreeze } from './seal'
import type { CandleFill, CloseIntel, Confluence, Direction, EvalDir, FeedStatus, GateCheck, Grade, IdealSource, IndicatorState, LockedSignal, Outcome, ResolvedSignal, ScalpCard, XBar } from './types'

export type Bbo = { bid: number; ask: number; bid_qty: number; ask_qty: number; spread: number; ts: number }
type RawEval = { ready: false; dir: 'SYNCING'; intra_pct: 0; long_pts: 0; short_pts: 0 } | { ready: true; dir: EvalDir; intra_pct: number; long_pts: number; short_pts: number }
const NOT_READY: RawEval = { ready: false, dir: 'SYNCING', intra_pct: 0, long_pts: 0, short_pts: 0 }

/** Higher timeframes carry more weight in the cross-TF agreement. */
const TF_WEIGHT: Record<Tf, number> = { '1m': 1, '3m': 1, '5m': 1.25, '15m': 1.5, '30m': 1.5, '1h': 1.75, '2h': 2, '4h': 2 }
const TOTAL_WEIGHT = TFS.reduce((s, tf) => s + TF_WEIGHT[tf], 0)
const W_INTRA = 0.45
const W_CLOSE = 0.25
const W_MTF = 0.3

export const emptyCard = (tf: Tf): ScalpCard => ({
  tf, status: 'SYNCING...', lock_state: 'SYNCING', is_locked: false, locked_signal: null, tp1_hit: false, tp2_hit: false,
  dynamic_trail_sl: 0, cooldown_bars_remaining: 0, bars_elapsed: 0, unrealized_pnl_xau: 0, unrealized_r: 0, agreement_drift_pct: 0,
  live_agreement_pct: 0, live_intra_pct: 0, live_mtf_pct: 0, aligned_tf_count: 0, candidate_dir: 'SYNCING', long_pts: 0, short_pts: 0,
  preview: null, last_resolved: null,
  closed_dir: 'SYNCING', closed_agreement_pct: 0, closed_intra_pct: 0, closed_aligned_count: 0, weighted_mtf_pct: 0,
  close_intel: null, fill: null, gates: [], gates_passed: 0, candidate_grade: null, next_close_ms: 0,
  last_eval_bar_ts: 0, last_eval_note: 'Waiting for first confirmed candle close', ideal_state: 'PENDING', seal_ok: true,
})

export type Consensus = { global_aligned_count: number; global_dir: EvalDir; global_signal_agreement_pct: number; bull_tfs: number; bear_tfs: number; ready_tfs: number }

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d
const isDir = (d: EvalDir): d is Direction => d === 'LONG' || d === 'SHORT'
const opposite = (d: Direction): Direction => (d === 'LONG' ? 'SHORT' : 'LONG')
const sidePts = (ev: { long_pts: number; short_pts: number; intra_pct?: number; score?: number }, d: EvalDir) => d === 'LONG' ? ev.long_pts : d === 'SHORT' ? ev.short_pts : Math.max(ev.long_pts, ev.short_pts)
const rsiFrom = (gain: number, loss: number) => loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss)
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16)

type ScoreInput = { bars: XBar[]; idx: number; ema9: number; ema20: number; ema50: number; atr: number; rsi: number; cf: Confluence; bbo: Bbo; cfg: ScalpCardConfig }

/** 8-factor order-flow score for one candle (forming or closed). */
function scoreCandle({ bars, idx, ema9, ema20, ema50, atr, rsi, cf, bbo, cfg }: ScoreInput): RawEval {
  const cur = bars[idx]
  const close = cur.close
  let delta5 = 0
  for (let k = Math.max(0, idx - 4); k <= idx; k++) delta5 += bars[k].delta
  const curDelta = cur.delta
  const vwap = cf.utc_vwap ?? close
  const vwapU1 = cf.vwap_upper_1sd ?? close
  const vwapL1 = cf.vwap_lower_1sd ?? close
  const vwapU2 = cf.vwap_upper_2sd ?? close
  const vwapL2 = cf.vwap_lower_2sd ?? close
  const buyShare = cur.buy_vol / Math.max(cur.volume, 1e-9)
  const spread = bbo.ask - bbo.bid
  const bboImb = bbo.bid_qty / Math.max(bbo.bid_qty + bbo.ask_qty, 1e-9)
  let l = 0, s = 0

  if (delta5 > 0) l += curDelta > 0 ? 20 : 12
  else if (delta5 < 0) s += curDelta < 0 ? 20 : 12
  if (close > ema9 && ema9 > ema20 && ema20 > ema50) l += 15
  else if (close > ema20) l += 10
  else if (close > ema9) l += 5
  if (close < ema9 && ema9 < ema20 && ema20 < ema50) s += 15
  else if (close < ema20) s += 10
  else if (close < ema9) s += 5
  if ((close >= vwap && close < vwapU2) || (close <= vwapL1 && curDelta > 0)) l += 15
  if ((close <= vwap && close > vwapL2) || (close >= vwapU1 && curDelta < 0)) s += 15
  if (buyShare >= 0.58) l += 15
  else if (buyShare >= 0.53) l += 10
  if (1 - buyShare >= 0.58) s += 15
  else if (1 - buyShare >= 0.53) s += 10
  if ((rsi >= 48 && rsi <= 72) || (rsi < 35 && cf.cvd_bull_div)) l += 10
  if ((rsi >= 28 && rsi <= 52) || (rsi > 65 && cf.cvd_bear_div)) s += 10
  const pdh = cf.pdh ?? close + 999
  const pdl = cf.pdl ?? close - 999
  if (cf.pdl_sweep || cf.absorption_bull || cf.cvd_bull_div || pdh - close >= 1.5 * atr) l += 10
  if (cf.pdh_sweep || cf.absorption_bear || cf.cvd_bear_div || close - pdl >= 1.5 * atr) s += 10
  if (cf.oi_regime === 'NEW_LONGS' || cf.oi_regime === 'SHORT_SQUEEZE') l += 10
  else if (cf.oi_regime === 'NEW_SHORTS' || cf.oi_regime === 'LONG_LIQ_FLUSH') s += 10
  if (spread > 0 && spread <= cfg.max_spread) {
    if (bboImb >= 0.5) l += 5
    if (bboImb <= 0.5) s += 5
  }
  const intra = Math.max(l, s)
  const dir: EvalDir = intra < 45 || l === s ? 'NEUTRAL' : l > s ? 'LONG' : 'SHORT'
  return { ready: true, dir, intra_pct: round(intra), long_pts: round(l), short_pts: round(s) }
}

const weightedMtf = (evals: Record<Tf, RawEval>, d: EvalDir) => {
  if (!isDir(d)) return { pct: 0, aligned: [] as Tf[] }
  const aligned = TFS.filter(k => evals[k].ready && evals[k].dir === d)
  return { pct: round((aligned.reduce((s, k) => s + TF_WEIGHT[k], 0) / TOTAL_WEIGHT) * 100), aligned }
}

type Levels = { entry: number; ideal: number; ideal_source: IdealSource; sl: number; sl_source: LockedSignal['sl_source']; sl_dist: number; tp1: number; tp2: number; tp3: number; rr_tp1_ideal: number; rr_tp3_ideal: number }

/** Structure stop beyond the signal swing, ideal limit entry from candle-fill logic, targets in R from market entry. */
function buildLevels(d: Direction, entry: number, atr: number, bars: XBar[], ci: number, fill: CandleFill, cfg: ScalpCardConfig): Levels {
  const sign = d === 'LONG' ? 1 : -1
  const recent = bars.slice(Math.max(0, ci - 2), ci + 1)
  const swing = d === 'LONG' ? Math.min(...recent.map(b => b.low)) : Math.max(...recent.map(b => b.high))
  const structDist = d === 'LONG' ? entry - (swing - 0.15 * atr) : swing + 0.15 * atr - entry
  const floor = 0.75 * cfg.sl_atr * atr
  const cap = 1.5 * cfg.sl_atr * atr
  const slDist = Math.min(cap, Math.max(floor, structDist))
  const sl_source: Levels['sl_source'] = structDist < floor ? 'ATR_FLOOR' : structDist > cap ? 'ATR_CAP' : 'STRUCTURE'
  const sl = entry - sign * slDist
  const near = entry - sign * 0.15 * slDist
  const far = entry - sign * 0.6 * slDist
  const inBand = (x: number | null | undefined): x is number => typeof x === 'number' && x > 0 && (d === 'LONG' ? x <= near && x >= far : x >= near && x <= far)
  const fvgEdge = d === 'LONG' ? fill.nearest_bull?.top : fill.nearest_bear?.bottom
  const sig = bars[ci]
  const candle50 = sig ? (sig.high + sig.low) / 2 : null
  let ideal = entry - sign * 0.33 * slDist
  let ideal_source: IdealSource = 'RISK_33'
  if (inBand(fvgEdge)) { ideal = fvgEdge; ideal_source = 'FVG_EDGE' }
  else if (inBand(candle50)) { ideal = candle50; ideal_source = 'CANDLE_50' }
  const tp1 = entry + sign * cfg.tp1_r * slDist
  const tp2 = entry + sign * cfg.tp2_r * slDist
  const tp3 = entry + sign * cfg.tp3_r * slDist
  const idealRisk = Math.max(Math.abs(ideal - sl), 1e-9)
  return {
    entry: round(entry, 2), ideal: round(ideal, 2), ideal_source, sl: round(sl, 2), sl_source, sl_dist: slDist,
    tp1: round(tp1, 2), tp2: round(tp2, 2), tp3: round(tp3, 2),
    rr_tp1_ideal: round(Math.abs(tp1 - ideal) / idealRisk, 2), rr_tp3_ideal: round(Math.abs(tp3 - ideal) / idealRisk, 2),
  }
}

function computeGates(args: { tf: Tf; d: EvalDir; feed: FeedStatus; ci: CloseIntel; agree: number; cfg: ScalpCardConfig; aligned: number; wMtf: number; closed: Record<Tf, RawEval>; rsi: number; cf: Confluence; atr: number; spread: number; lv: Levels | null }): GateCheck[] {
  const { tf, d, feed, ci, agree, cfg, aligned, wMtf, closed, rsi, cf, atr, spread, lv } = args
  const dir = isDir(d) ? d : null
  const nextTf = TFS[TFS.indexOf(tf) + 1]
  const htfPass = !!dir && (nextTf ? closed[nextTf].ready && closed[nextTf].dir !== opposite(dir) : wMtf >= 50)
  const close = ci.close
  const exhaustPass = dir === 'LONG' ? rsi <= 75 && (cf.vwap_upper_2sd === null || close <= cf.vwap_upper_2sd + 0.25 * atr)
    : dir === 'SHORT' ? rsi >= 25 && (cf.vwap_lower_2sd === null || close >= cf.vwap_lower_2sd - 0.25 * atr) : false
  const tp1Dist = lv ? Math.abs(lv.tp1 - lv.entry) : 0
  const roomPass = !!lv && (dir === 'LONG' ? cf.pdh === null || cf.pdh <= lv.entry || cf.pdh - lv.entry >= tp1Dist
    : dir === 'SHORT' ? cf.pdl === null || cf.pdl >= lv.entry || lv.entry - cf.pdl >= tp1Dist : false)
  return [
    { key: 'FEED', label: 'Both sockets LIVE', pass: feed === 'LIVE' },
    { key: 'CLOSE', label: 'Closed candle confirms ≥ 55', pass: !!dir && ci.dir === dir && ci.score >= 55 },
    { key: 'AGREE', label: `Closed agreement ≥ ${cfg.min_agree_pct}%`, pass: !!dir && agree >= cfg.min_agree_pct },
    { key: 'MTF', label: '≥ 5/8 TFs aligned on close', pass: !!dir && aligned >= 5 && wMtf >= 55 },
    { key: 'HTF', label: nextTf ? `${SCALP_CARD_CONFIG[nextTf].label} not opposing` : 'HTF weight ≥ 50%', pass: htfPass },
    { key: 'EXHAUST', label: 'No RSI / 2SD exhaustion', pass: exhaustPass },
    { key: 'SPREAD', label: `Spread ≤ ${cfg.max_spread}`, pass: spread > 0 && spread <= cfg.max_spread },
    { key: 'ROOM', label: 'Room to TP1 before PDH/PDL', pass: roomPass },
  ]
}

const gradeFor = (agree: number, min: number): Grade => agree >= min + 12 ? 'A+' : agree >= min + 6 ? 'A' : 'B'

export function resolveScalpCardLock(card: ScalpCard, outcome: Outcome, reason: ResolvedSignal['reason'], exitPx: number, nowMs: number, history: ResolvedSignal[]) {
  const sig = card.locked_signal
  if (!sig) return
  const slDist = Math.max(Math.abs(sig.entry_price - sig.initial_sl), 1e-9)
  const pnl = sig.direction === 'LONG' ? exitPx - sig.entry_price : sig.entry_price - exitPx
  const resolved: ResolvedSignal = deepFreeze({ signal: sig, outcome, reason, exit_price: round(exitPx, 2), r_multiple: round(pnl / slDist, 2), resolved_at_ms: nowMs })
  history.unshift(resolved)
  if (history.length > 50) history.pop()
  card.last_resolved = resolved
  card.is_locked = false
  card.locked_signal = null
  card.tp1_hit = false
  card.tp2_hit = false
  card.ideal_state = 'PENDING'
  card.cooldown_bars_remaining = 1
  card.lock_state = 'EXPIRED_COOLDOWN'
  card.status = outcome
}

/** Called once per CLOSED bar on tf: releases the 1-bar cooldown back to SCANNING. */
export function onCardBarClose(card: ScalpCard) {
  if (card.cooldown_bars_remaining > 0) {
    card.cooldown_bars_remaining -= 1
    if (card.cooldown_bars_remaining === 0 && !card.is_locked) card.lock_state = 'SCANNING'
  }
}

export function updateAll8ScalpTradeCards(args: {
  bars: Record<Tf, XBar[]>
  ind: Record<Tf, IndicatorState>
  bbo: Bbo
  confluence: Confluence
  feedStatus: FeedStatus
  cards: Record<Tf, ScalpCard>
  history: ResolvedSignal[]
  nowMs: number
}): Consensus {
  const { bars: allBars, ind: allInd, bbo, confluence: cf, feedStatus, cards, history, nowMs } = args
  const live = {} as Record<Tf, RawEval>
  const closed = {} as Record<Tf, RawEval>
  const intel = {} as Record<Tf, CloseIntel>
  const fills = {} as Record<Tf, CandleFill>

  // Pass 1: live (forming) score, confirmed close score, close-candle intelligence and candle fill.
  for (const tf of TFS) {
    const bars = allBars[tf]
    const ind = allInd[tf]
    const cfg = SCALP_CARD_CONFIG[tf]
    const ci = lastClosedIndex(bars)
    intel[tf] = analyzeClosedCandle(bars, ind, TF_MS[tf])
    fills[tf] = analyzeCandleFill(bars, ind.atr14, bars.at(-1)?.close ?? 0)
    if (bars.length < 50 || ci < 5 || !ind.ready || bbo.bid <= 0 || bbo.ask <= 0 || cf.utc_vwap === null) { live[tf] = NOT_READY; closed[tf] = NOT_READY; continue }
    live[tf] = scoreCandle({ bars, idx: bars.length - 1, ema9: ind.live_ema9, ema20: ind.live_ema20, ema50: ind.live_ema50, atr: ind.live_atr14, rsi: ind.live_rsi14, cf, bbo, cfg })
    closed[tf] = scoreCandle({ bars, idx: ci, ema9: ind.ema9, ema20: ind.ema20, ema50: ind.ema50, atr: ind.atr14, rsi: rsiFrom(ind.avg_gain, ind.avg_loss), cf, bbo, cfg })
  }

  // Resolved confirmed direction per TF: closed order-flow score first, close-candle anatomy as tiebreak.
  const resolvedClosed = Object.fromEntries(TFS.map(tf => {
    const c = closed[tf]
    const dir: EvalDir = !c.ready ? 'SYNCING' : isDir(c.dir) ? c.dir : intel[tf].ready && isDir(intel[tf].dir) ? intel[tf].dir : 'NEUTRAL'
    return [tf, { ...c, dir }]
  })) as Record<Tf, RawEval>

  // Pass 2: agreement, gates and the immutable close-candle lock lifecycle.
  for (const tf of TFS) {
    const card = cards[tf]
    const ev = live[tf]
    const cev = closed[tf]
    const ci = intel[tf]
    const fill = fills[tf]
    const bars = allBars[tf]
    const ind = allInd[tf]
    const cfg = SCALP_CARD_CONFIG[tf]
    const formingTs = bars.at(-1)?.ts ?? 0
    card.close_intel = ci.ready ? ci : null
    card.fill = fill.ready ? fill : null
    card.next_close_ms = formingTs ? formingTs + TF_MS[tf] : 0
    card.seal_ok = card.locked_signal ? computeSeal(card.locked_signal) === card.locked_signal.seal : true
    if (!ev.ready || !cev.ready || !ci.ready) {
      if (!card.is_locked) { card.status = 'SYNCING...'; card.lock_state = card.cooldown_bars_remaining > 0 ? 'EXPIRED_COOLDOWN' : 'SYNCING'; card.candidate_dir = 'SYNCING'; card.closed_dir = 'SYNCING' }
      continue
    }

    // Live (forming-bar) agreement — display only, never used to lock.
    const liveDir: EvalDir = card.is_locked && card.locked_signal ? card.locked_signal.direction : ev.dir
    const liveMtf = weightedMtf(live, liveDir)
    const liveIntra = sidePts(ev, liveDir)
    const liveAgree = round(W_INTRA * liveIntra + W_CLOSE * sidePts(ci, liveDir) + W_MTF * liveMtf.pct)

    // Confirmed (closed-candle) agreement — the only input to the lock.
    const closedDir: EvalDir = resolvedClosed[tf].dir
    const closedMtf = weightedMtf(resolvedClosed, closedDir)
    const closedIntra = sidePts(cev, closedDir)
    const closedAgree = isDir(closedDir) ? round(W_INTRA * closedIntra + W_CLOSE * sidePts(ci, closedDir) + W_MTF * closedMtf.pct) : round(W_INTRA * cev.intra_pct)

    Object.assign(card, {
      live_agreement_pct: liveAgree, live_intra_pct: liveIntra, live_mtf_pct: liveMtf.pct, aligned_tf_count: liveMtf.aligned.length,
      candidate_dir: ev.dir, long_pts: ev.long_pts, short_pts: ev.short_pts,
      closed_dir: closedDir, closed_agreement_pct: closedAgree, closed_intra_pct: closedIntra, closed_aligned_count: closedMtf.aligned.length, weighted_mtf_pct: closedMtf.pct,
    })

    if (card.is_locked && card.locked_signal) {
      const sig = card.locked_signal
      const d = sig.direction
      const execPx = d === 'LONG' ? bbo.bid : bbo.ask
      const fillPx = d === 'LONG' ? bbo.ask : bbo.bid
      const slDist = Math.abs(sig.entry_price - sig.initial_sl)
      card.agreement_drift_pct = round(liveAgree - sig.locked_agreement_pct)
      card.bars_elapsed = Math.max(0, Math.floor((formingTs - sig.locked_bar_ts) / TF_MS[tf]))
      card.unrealized_pnl_xau = round(d === 'LONG' ? execPx - sig.entry_price : sig.entry_price - execPx, 2)
      card.unrealized_r = round(card.unrealized_pnl_xau / Math.max(slDist, 1e-9), 2)
      if (card.ideal_state === 'PENDING') {
        if (d === 'LONG' ? fillPx <= sig.ideal_entry : fillPx >= sig.ideal_entry) card.ideal_state = 'FILLED'
        else if (card.bars_elapsed >= sig.ideal_fill_window_bars || card.tp1_hit) card.ideal_state = 'MISSED'
      }
      const slHit = d === 'LONG' ? execPx <= card.dynamic_trail_sl : execPx >= card.dynamic_trail_sl
      const tp3Hit = d === 'LONG' ? execPx >= sig.tp3_price : execPx <= sig.tp3_price
      const tp2Hit = d === 'LONG' ? execPx >= sig.tp2_price : execPx <= sig.tp2_price
      const tp1Hit = d === 'LONG' ? execPx >= sig.tp1_price : execPx <= sig.tp1_price
      if (tp3Hit) resolveScalpCardLock(card, 'RESOLVED_WIN', 'TP3_FULL_TARGET', execPx, nowMs, history)
      else if (slHit) resolveScalpCardLock(card, card.tp1_hit ? 'RESOLVED_WIN' : 'RESOLVED_LOSS', card.tp1_hit ? 'TRAIL_STOP_PROFIT' : 'INITIAL_SL_HIT', execPx, nowMs, history)
      else if (card.bars_elapsed >= cfg.max_hold_bars && !card.tp1_hit) resolveScalpCardLock(card, card.unrealized_pnl_xau > 0 ? 'RESOLVED_WIN' : 'EXPIRED_COOLDOWN', 'MAX_HOLD_EXPIRED', execPx, nowMs, history)
      else if (tp2Hit && !card.tp2_hit) { card.tp1_hit = true; card.tp2_hit = true; card.lock_state = 'TP2_PARTIAL'; card.dynamic_trail_sl = sig.tp1_price }
      else if (tp1Hit && !card.tp1_hit) { card.tp1_hit = true; card.lock_state = 'TP1_PARTIAL'; card.dynamic_trail_sl = sig.entry_price }
      if (card.is_locked) { card.status = card.lock_state; continue }
      // Resolution happened this tick: the just-evaluated close must not re-lock before the next close.
      card.last_eval_bar_ts = ci.bar_ts
    }

    // Unlocked: preview levels + gate checklist from the last CLOSED candle.
    const ciIdx = lastClosedIndex(bars)
    const spreadNow = bbo.ask - bbo.bid
    const lv = isDir(closedDir) ? buildLevels(closedDir, closedDir === 'LONG' ? bbo.ask : bbo.bid, ind.atr14, bars, ciIdx, fill, cfg) : null
    card.preview = lv ? { entry: lv.entry, ideal: lv.ideal, ideal_source: lv.ideal_source, sl: lv.sl, tp1: lv.tp1, tp2: lv.tp2, tp3: lv.tp3 } : null
    const rsiClosed = rsiFrom(ind.avg_gain, ind.avg_loss)
    card.gates = computeGates({ tf, d: closedDir, feed: feedStatus, ci, agree: closedAgree, cfg, aligned: closedMtf.aligned.length, wMtf: closedMtf.pct, closed: resolvedClosed, rsi: rsiClosed, cf, atr: ind.atr14, spread: spreadNow, lv })
    card.gates_passed = card.gates.filter(g => g.pass).length
    card.candidate_grade = isDir(closedDir) ? gradeFor(closedAgree, cfg.min_agree_pct) : null

    if (card.cooldown_bars_remaining > 0) { card.lock_state = 'EXPIRED_COOLDOWN'; card.status = 'COOLDOWN'; continue }
    card.lock_state = 'SCANNING'
    card.status = 'SCANNING'

    // Close-candle lock: exactly one decision per confirmed candle, only while that close is fresh.
    if (ci.bar_ts === card.last_eval_bar_ts) continue
    card.last_eval_bar_ts = ci.bar_ts
    const freshWindow = Math.min(TF_MS[tf] * 0.25, 30_000)
    if (nowMs - ci.close_time_ms > freshWindow) { card.last_eval_note = `Close ${hhmm(ci.bar_ts)} is stale — next decision at ${hhmm(card.next_close_ms)} UTC`; continue }
    const failed = card.gates.filter(g => !g.pass)
    if (!lv || !isDir(closedDir) || failed.length) {
      card.last_eval_note = `Close ${hhmm(ci.bar_ts)} rejected · ${failed.length ? failed.map(g => g.key).join(', ') : 'no direction'}`
      continue
    }

    const d: Direction = closedDir
    const grade = gradeFor(closedAgree, cfg.min_agree_pct)
    const fields = {
      signal_id: `XAU-${cfg.label}-${d[0]}-${ci.bar_ts}`,
      timeframe: tf,
      display_tf: cfg.label,
      locked_at_ms: nowMs,
      locked_bar_ts: formingTs,
      signal_bar_ts: ci.bar_ts,
      direction: d,
      entry_price: lv.entry,
      ideal_entry: lv.ideal,
      ideal_source: lv.ideal_source,
      ideal_fill_window_bars: Math.max(2, Math.ceil(cfg.max_hold_bars / 3)),
      initial_sl: lv.sl,
      sl_source: lv.sl_source,
      tp1_price: lv.tp1,
      tp2_price: lv.tp2,
      tp3_price: lv.tp3,
      rr_tp1_ideal: lv.rr_tp1_ideal,
      rr_tp3_ideal: lv.rr_tp3_ideal,
      atr_at_lock: round(ind.atr14, 2),
      grade,
      locked_agreement_pct: closedAgree,
      locked_intra_pct: closedIntra,
      locked_close_pct: sidePts(ci, d),
      locked_mtf_pct: closedMtf.pct,
    }
    card.locked_signal = deepFreeze<LockedSignal>({
      ...fields,
      locked_aligned_tfs: [...closedMtf.aligned],
      locked_tf_snapshot: TFS.map(k => ({ tf: k, dir: resolvedClosed[k].dir, intra_pct: closed[k].intra_pct })),
      close_snapshot: { pattern: ci.pattern, score: ci.score, clv: ci.clv, body_pct: ci.body_pct, vol_ratio: ci.vol_ratio, delta_confirm: ci.delta_confirm, open: ci.open, high: ci.high, low: ci.low, close: ci.close },
      gates: card.gates.map(g => ({ ...g })),
      seal: computeSeal(fields),
    })
    Object.assign(card, {
      is_locked: true, lock_state: 'LOCKED_ACTIVE', status: 'LOCKED_ACTIVE', tp1_hit: false, tp2_hit: false, bars_elapsed: 0,
      unrealized_pnl_xau: 0, unrealized_r: 0, agreement_drift_pct: 0, dynamic_trail_sl: lv.sl, ideal_state: 'PENDING', seal_ok: true,
      last_eval_note: `Locked on ${hhmm(ci.bar_ts)} close · grade ${grade}`,
    })
  }

  const readyTfs = TFS.filter(tf => closed[tf].ready)
  const bull = readyTfs.filter(tf => resolvedClosed[tf].dir === 'LONG').length
  const bear = readyTfs.filter(tf => resolvedClosed[tf].dir === 'SHORT').length
  const domDir: EvalDir = readyTfs.length === 0 ? 'SYNCING' : bull === bear ? 'NEUTRAL' : bull > bear ? 'LONG' : 'SHORT'
  return {
    global_aligned_count: Math.max(bull, bear),
    global_dir: domDir,
    global_signal_agreement_pct: weightedMtf(resolvedClosed, domDir).pct,
    bull_tfs: bull,
    bear_tfs: bear,
    ready_tfs: readyTfs.length,
  }
}
