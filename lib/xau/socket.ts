const connectStamps: number[] = []

/** OKX allows 3 WebSocket connection attempts per second per IP; space attempts across both sockets. */
function connectDelay() {
  const now = Date.now()
  while (connectStamps.length && now - connectStamps[0] >= 1000) connectStamps.shift()
  if (connectStamps.length < 3) { connectStamps.push(now); return 0 }
  return 1000 - (now - connectStamps[0]) + 10
}

export type SocketState = 'idle' | 'connecting' | 'open' | 'closed'

type Options = {
  name: 'business' | 'public'
  urls: readonly string[]
  subscribe: object
  onMessage: (data: string) => void
  onOpen: (isReconnect: boolean) => void
  onClose: () => void
}

/**
 * Persistent OKX WebSocket with exponential back-off (1s → 30s), raw "ping"/"pong" keepalive
 * and a dead-man's switch driven by the engine watchdog.
 */
export class OkxSocket {
  state: SocketState = 'idle'
  lastFrameAt = 0
  pingSentAt = 0
  pingDeadlineMs = 0
  reconnects = 0
  url = ''
  private ws: WebSocket | null = null
  private failures = 0
  private urlIndex = 0
  private openedOnce = false
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly opts: Options) {}

  start() { this.stopped = false; this.connect() }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    this.ws?.close()
    this.ws = null
    this.state = 'closed'
  }

  private connect() {
    if (this.stopped) return
    const wait = connectDelay()
    if (wait > 0) { this.timer = setTimeout(() => this.connect(), wait); return }
    this.state = 'connecting'
    this.url = this.opts.urls[this.urlIndex % this.opts.urls.length]
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      if (this.ws !== ws) return
      this.state = 'open'
      this.failures = 0
      this.lastFrameAt = Date.now()
      this.pingSentAt = 0
      ws.send(JSON.stringify(this.opts.subscribe))
      const reconnect = this.openedOnce
      this.openedOnce = true
      this.opts.onOpen(reconnect)
    }
    ws.onmessage = event => {
      if (this.ws !== ws) return
      this.lastFrameAt = Date.now()
      this.pingSentAt = 0
      if (event.data === 'pong') return
      this.opts.onMessage(String(event.data))
    }
    ws.onerror = () => ws.close()
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.state = 'closed'
      this.opts.onClose()
      if (this.stopped) return
      // Alternate between the 8443 spec URI and the 443 endpoint OKX is migrating to.
      if (!this.openedOnce || this.failures > 0) this.urlIndex++
      const backoff = Math.min(30_000, 1000 * 2 ** this.failures++)
      this.reconnects++
      this.timer = setTimeout(() => this.connect(), backoff)
    }
  }

  sendPing(deadlineMs: number) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send('ping')
    this.pingSentAt = Date.now()
    this.pingDeadlineMs = deadlineMs
  }

  forceReconnect() {
    this.pingSentAt = 0
    this.ws?.close()
  }
}
