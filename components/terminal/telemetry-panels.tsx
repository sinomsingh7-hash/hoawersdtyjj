'use client'

import { Activity, CircleCheck, CircleDashed, CircleX, History, LoaderCircle, Radio, Skull } from 'lucide-react'
import type { EngineSnapshot } from '@/lib/xau/engine'
import { TF_LABEL } from '@/lib/xau/constants'
import { compact, num, pct, px, SYNCING, tone, utcTime } from '@/lib/xau/format'
import { cn } from '@/lib/utils'
import { DataRow, Panel, StatusDot } from './panel'

export function TelemetryPanel({ s }: { s: EngineSnapshot }) {
  const { bbo, mark, index, funding, oi, telemetry: tm, confluence: c } = s
  const imb = bbo.bid_qty + bbo.ask_qty > 0 ? (bbo.bid_qty / (bbo.bid_qty + bbo.ask_qty)) * 100 : null
  const basis = mark && index ? mark.markPx - index.idxPx : null
  return <Panel title="Live derivatives telemetry" icon={<Radio className="size-3.5" />} action={<span className="font-mono text-[9px] font-normal text-muted-foreground">{tm.exchange_latency_ms === null ? SYNCING : `${tm.exchange_latency_ms}ms`}</span>}>
    <div className="divide-y divide-border px-4">
      <DataRow label="Best bid · qty XAU"><span className="text-positive">{px(bbo.bid, 1)}</span> · {bbo.bid_qty ? num(bbo.bid_qty, 3) : SYNCING}</DataRow>
      <DataRow label="Best ask · qty XAU"><span className="text-negative">{px(bbo.ask, 1)}</span> · {bbo.ask_qty ? num(bbo.ask_qty, 3) : SYNCING}</DataRow>
      <DataRow label="Spread · bid imbalance">{bbo.spread > 0 ? num(bbo.spread, 2) : SYNCING} · {pct(imb)}</DataRow>
      <DataRow label="Mark price">{px(mark?.markPx, 2)}</DataRow>
      <DataRow label="Spot index XAU-USDT">{px(index?.idxPx, 2)}</DataRow>
      <DataRow label="Mark − index basis" className={tone(basis)}>{num(basis, 2, true)}</DataRow>
      <DataRow label="Funding · next">{funding ? `${(funding.fundingRate * 100).toFixed(4)}%` : SYNCING}{funding?.nextFundingRate != null ? ` · ${(funding.nextFundingRate * 100).toFixed(4)}%` : ''}</DataRow>
      <DataRow label="Funding settles">{funding ? `${utcTime(funding.fundingTime, false)} UTC` : SYNCING}</DataRow>
      <DataRow label={`Open interest XAU · ${oi?.source ?? '—'}`}>{oi ? num(oi.oiCcy, 1) : SYNCING}</DataRow>
      <DataRow label="OI regime (ΔPrice vs ΔOI)" className={c.oi_regime === 'NEW_LONGS' || c.oi_regime === 'SHORT_SQUEEZE' ? 'text-positive' : c.oi_regime === 'NEUTRAL' ? 'text-muted-foreground' : 'text-negative'}>{c.oi_regime}{c.oi_delta_xau !== null ? ` (${num(c.oi_delta_xau, 1, true)})` : ''}</DataRow>
    </div>
  </Panel>
}

export function TapePanel({ s }: { s: EngineSnapshot }) {
  return <Panel title="Tape · liquidations" icon={<Activity className="size-3.5" />} action={<span className="font-mono text-[9px] font-normal text-muted-foreground">id {s.telemetry.last_seen_trade_id || '—'}</span>}>
    <div className="grid flex-1 grid-cols-1 sm:grid-cols-2">
      <div className="min-h-0 border-b border-border sm:border-r sm:border-b-0">
        <div className="grid grid-cols-3 px-4 py-2 text-[9px] text-muted-foreground"><span>Time</span><span className="text-right">Price</span><span className="text-right">XAU</span></div>
        <ul className="max-h-72 overflow-y-auto px-4 pb-2" aria-label="Live trade prints">
          {s.tape.length === 0 && <li className="py-4 text-center text-[10px] text-muted-foreground">{SYNCING}</li>}
          {s.tape.slice(0, 40).map(t => <li key={t.id} className="grid grid-cols-3 py-0.5 font-mono text-[10px] tabular-nums">
            <span className="text-muted-foreground">{utcTime(t.ts)}</span>
            <span className={cn('text-right', t.side === 'buy' ? 'text-positive' : 'text-negative')}>{px(t.px, 1)}</span>
            <span className={cn('text-right', t.qty_xau >= 1 && 'font-semibold text-primary')}>{num(t.qty_xau, 3)}</span>
          </li>)}
        </ul>
      </div>
      <div className="min-h-0">
        <div className="flex items-center gap-1.5 px-4 py-2 text-[9px] text-muted-foreground"><Skull className="size-3" aria-hidden="true" />XAU-USDT-SWAP liquidations</div>
        <ul className="max-h-72 overflow-y-auto px-4 pb-2" aria-label="Live liquidations">
          {s.liquidations.length === 0 && <li className="py-4 text-center text-[10px] leading-relaxed text-muted-foreground">No gold liquidations since connect.<br />Stream is live; prints appear on forced closes.</li>}
          {s.liquidations.map((l, i) => <li key={`${l.ts}-${i}`} className="grid grid-cols-3 py-0.5 font-mono text-[10px] tabular-nums">
            <span className="text-muted-foreground">{utcTime(l.ts)}</span>
            <span className={l.posSide === 'long' ? 'text-negative' : 'text-positive'}>{l.posSide.toUpperCase()} @ {px(l.bkPx, 1)}</span>
            <span className="text-right">{num(l.qty_xau, 3)}</span>
          </li>)}
        </ul>
      </div>
    </div>
  </Panel>
}

export function HistoryPanel({ s }: { s: EngineSnapshot }) {
  const wins = s.history.filter(h => h.outcome === 'RESOLVED_WIN').length
  const total = s.history.length
  const netR = s.history.reduce((sum, h) => sum + h.r_multiple, 0)
  return <Panel title="Resolved scalp signals (this session)" icon={<History className="size-3.5" />} action={<span className="font-mono text-[9px] font-normal text-muted-foreground">{total ? `${wins}/${total} wins · ${netR >= 0 ? '+' : ''}${netR.toFixed(2)}R` : 'none yet'}</span>}>
    <div className="overflow-x-auto">
      <table className="w-full text-[10px]">
        <caption className="sr-only">Resolved scalp trade card signals</caption>
        <thead><tr className="border-b border-border text-[9px] text-muted-foreground"><th scope="col" className="px-4 py-2 text-left font-normal">Signal</th><th scope="col" className="py-2 text-left font-normal">Dir</th><th scope="col" className="py-2 text-right font-normal">Entry</th><th scope="col" className="py-2 text-right font-normal">Exit</th><th scope="col" className="py-2 text-right font-normal">Locked %</th><th scope="col" className="py-2 text-left pl-4 font-normal">Reason</th><th scope="col" className="px-4 py-2 text-right font-normal">R</th></tr></thead>
        <tbody>
          {total === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Locks resolve only on TP3, stop/trail breach or max-hold expiry.</td></tr>}
          {s.history.map(h => <tr key={`${h.signal.signal_id}-${h.resolved_at_ms}`} className="border-b border-border/60 last:border-0">
            <td className="px-4 py-1.5 font-mono">{h.signal.signal_id}</td>
            <td className={cn('py-1.5 font-mono', h.signal.direction === 'LONG' ? 'text-positive' : 'text-negative')}>{h.signal.direction}</td>
            <td className="py-1.5 text-right font-mono">{px(h.signal.entry_price)}</td>
            <td className="py-1.5 text-right font-mono">{px(h.exit_price)}</td>
            <td className="py-1.5 text-right font-mono">{pct(h.signal.locked_agreement_pct)}</td>
            <td className="py-1.5 pl-4 text-muted-foreground">{h.reason.replaceAll('_', ' ').toLowerCase()}</td>
            <td className={cn('px-4 py-1.5 text-right font-mono font-semibold', tone(h.r_multiple))}>{h.r_multiple > 0 ? '+' : ''}{h.r_multiple.toFixed(2)}R</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </Panel>
}

export function DiagnosticsPanel({ s }: { s: EngineSnapshot }) {
  const tm = s.telemetry
  return <Panel title="Boot handshake & feed watchdog" icon={<CircleCheck className="size-3.5" />} action={<span className={cn('font-mono text-[9px] font-normal', s.feedStatus === 'LIVE' ? 'text-positive' : 'text-primary')}>{s.feedStatus}</span>}>
    <ol className="flex flex-col gap-2 px-4 py-3">
      {s.boot.map(step => <li key={step.label} className="flex items-start gap-2 text-[10px]">
        {step.status === 'done' ? <CircleCheck className="mt-px size-3.5 shrink-0 text-positive" aria-label="done" /> : step.status === 'running' ? <LoaderCircle className="mt-px size-3.5 shrink-0 animate-spin text-primary" aria-label="running" /> : step.status === 'error' ? <CircleX className="mt-px size-3.5 shrink-0 text-negative" aria-label="error" /> : <CircleDashed className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-label="pending" />}
        <div className="min-w-0"><div>{step.label}</div>{step.detail && <div className="truncate font-mono text-[9px] text-muted-foreground">{step.detail}</div>}</div>
      </li>)}
    </ol>
    <div className="divide-y divide-border border-t border-border px-4">
      {(['business', 'public'] as const).map(k => <DataRow key={k} label={`${k} socket · ${tm.sockets[k].reconnects} reconnects`}><span className="inline-flex items-center gap-1.5"><StatusDot live={tm.sockets[k].state === 'open'} />{tm.sockets[k].state} · {tm.sockets[k].ms_since_last_ws_frame}ms</span></DataRow>)}
      <DataRow label="Clock offset (server − local)">{s.clockOffsetMs}ms</DataRow>
      <DataRow label="ctVal multiplier">{s.ctVal ? `${s.ctVal} XAU` : SYNCING}</DataRow>
      <DataRow label="Tick backfill · tick-exact 1m">{tm.tick_backfill_trades} · {tm.tick_exact_1m_bars}</DataRow>
      <DataRow label="Ring-buffer 1m restored">{tm.ring_buffer_bars}</DataRow>
      <DataRow label="REST calls (cards use 0)">{tm.rest_calls}</DataRow>
      <DataRow label="Bars loaded">{Object.entries(s.bars).map(([tf, list]) => `${TF_LABEL[tf as keyof typeof TF_LABEL]}:${list.length}`).join(' ')}</DataRow>
    </div>
    {s.error && <p className="border-t border-border px-4 py-2 text-[10px] text-negative">{s.error}</p>}
    <p className="mt-auto border-t border-border px-4 py-2 text-[9px] text-muted-foreground">24h swap volume {compact(s.bars['1h'].slice(-24).reduce((sum, b) => sum + b.volume, 0))} XAU (volCcy, last 24 1H bars)</p>
  </Panel>
}
