'use client'

import { CandlestickChart, Layers, LockKeyhole, Radio, ScanLine, ShieldCheck, Waves } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

const sections = [
  { icon: Waves, title: '01 · Solution A order flow', body: 'Mechanism 1 estimates every historical 1m bar with a 70% close-location / 30% body hybrid (tick rule on flat bars). Mechanism 4 overlays today’s tick-exact 1m flow from the okx_xau_flow_YYYY_MM_DD ring-buffer. Mechanism 3 replaces fully covered 1m bars with ~1,000 real taker prints from /market/trades + /market/history-trades. Mechanism 2 then rolls those 1m deltas into every 3m–4H bar of the last 25 hours, so absorption wicks keep their true net delta.' },
  { icon: Radio, title: '02 · Zero-polling dual WebSocket', body: 'K-lines stream on /ws/v5/business; BBO tick-by-tick, trades, liquidations, mark, index, funding and open interest stream on /ws/v5/public. Both open before REST hydration and buffer frames until Solution A completes. Trades are keyed by bar-open time on every timeframe, so prints that arrive before a new candle never leak into the wrong bar. Gaps heal with before=/after= cursors; a dead-man’s switch pings after 5s of silence and halts on a missed pong.' },
  { icon: Layers, title: '03 · Close-confirmed Signal Agreement', body: 'Each timeframe scores LONG and SHORT out of 100 on 8 order-flow factors: 5-bar delta (20), EMA 9/20/50 stack (15), 00:00 UTC VWAP bands (15), taker aggression (15), RSI-14 (10), sweep / absorption / CVD divergence / room (10), OI regime (10) and BBO spread & imbalance (5). Agreement = 45% intra-TF score on the CLOSED candle + 25% close-candle intelligence + 30% weighted cross-TF alignment (higher timeframes weigh up to 2×). The live forming-bar agreement is shown separately and never triggers a lock.' },
  { icon: CandlestickChart, title: '04 · Close-candle intelligence', body: 'Only confirmed candles are analysed, so nothing repaints. Each close is scored on close location value (25), body strength (15), pattern — engulfing, pin rejection, marubozu or a close beyond the previous high/low (20), order-flow delta confirming the candle colour (15), volume expansion vs the 20-bar average (10) and the confirmed EMA 9/20 side (15).' },
  { icon: ScanLine, title: '05 · Candle fill logic', body: 'Fair-value gaps (candle[i−1] high below candle[i+1] low, mirrored for bears) are tracked across the last 80 closed bars with a live fill percentage until fully filled. The ideal entry is a limit at the nearest unfilled FVG edge, else the signal candle 50% equilibrium, else 33% of risk — always 15–60% of the way from entry toward the stop. Its fill (or miss after one third of max-hold) is tracked after the lock.' },
  { icon: LockKeyhole, title: '06 · Immutable close-candle lock', body: 'Exactly one lock decision per confirmed candle, within a short freshness window after the close. All 8 gates must pass: LIVE feed, closed candle confirms ≥ 55, closed agreement ≥ threshold, ≥ 5/8 TFs aligned, next-higher TF not opposing, no RSI / VWAP 2SD exhaustion, spread within limit and room to TP1 before PDH/PDL. Entry, ideal entry, structure stop and targets are deep-frozen and sealed with a 64-bit FNV-1a fingerprint that is re-verified every tick and on reload; tampered or expired locks are discarded. TP1 moves the trail to breakeven, TP2 to TP1; locks resolve on TP3, a stop / trail breach or max-hold expiry, then a one-bar cooldown.' },
]

export function MethodologyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85svh] overflow-y-auto border border-border bg-card p-6 sm:max-w-2xl">
      <DialogHeader>
        <span className="eyebrow">TRANSPARENT BY DESIGN</span>
        <DialogTitle className="mt-2 text-2xl">Pure OKX order flow. Eight close-candle sealed locks.</DialogTitle>
        <DialogDescription className="mt-1 text-xs leading-relaxed">Every number on this terminal is computed in your browser from public OKX V5 data for XAU-USDT-SWAP. No API keys, no synthetic values, and no extra REST calls to refresh the Scalp Trade Cards.</DialogDescription>
      </DialogHeader>
      <Alert className="my-1 border-primary/25 bg-primary/5 p-3"><ShieldCheck className="text-primary" /><AlertTitle className="text-xs text-primary">Agreement is not probability</AlertTitle><AlertDescription className="mt-1 text-xs leading-relaxed">Signal Agreement measures how many rule-based factors line up. It is not a win rate, has not been independently validated, and does not place orders.</AlertDescription></Alert>
      <div className="flex flex-col gap-5 text-xs leading-relaxed text-muted-foreground">
        {sections.map(s => <section key={s.title}><h3 className="mb-2 flex items-center gap-2 font-medium text-foreground"><s.icon className="size-4 text-primary" />{s.title}</h3><p>{s.body}</p></section>)}
      </div>
    </DialogContent>
  </Dialog>
}
