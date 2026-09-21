/**
 * WebSocket client for the gateway's /ws event stream.
 *
 * Deliberately a module-level singleton rather than a per-component
 * connection, for two reasons:
 *   1. Several pages (System Monitor, Real-Time Data, Overview) all want
 *      the same live stream - one socket feeds all of them.
 *   2. React's StrictMode double-invokes effects in dev, so a
 *      connect-on-mount / close-on-unmount design would visibly thrash the
 *      connection on every mount. Here the socket is opened once on the
 *      first subscribe and simply stays open for the life of the page,
 *      so subscribing and unsubscribing are cheap and idempotent.
 *
 * Reconnection uses exponential backoff (the gateway being restarted
 * mid-demo is a normal event, not an error), and the connection status is
 * itself observable so the UI can honestly show "disconnected" rather than
 * silently displaying a frozen feed.
 *
 * /ws now requires a token (?token=<jwt>, same as notificationSocket.js's
 * /ws/notifications) - a security fix closing a confirmed unauthenticated
 * cross-region data leak on the gateway side. Without this change here,
 * that fix would reject every connection outright (no token was ever
 * sent before), breaking the five original pages entirely rather than
 * correctly scoping them - so this one attachment is the minimum needed
 * for the backend fix to do its job instead of just causing an outage.
 */

import { getStoredToken, GATEWAY_URL } from './api.js'

// The gateway serves HTTP and WebSocket on the same origin, so the ws://
// URL is derived from the same base rather than configured separately.
const WS_URL_BASE = `${GATEWAY_URL.replace(/^http/, 'ws')}/ws`

const INITIAL_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 10000

/** @type {WebSocket | null} */
let socket = null
let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS
let reconnectTimer = null

const eventListeners = new Set()
const statusListeners = new Set()

/** 'connecting' | 'connected' | 'disconnected' */
let status = 'disconnected'

function setStatus(next) {
  if (status === next) return
  status = next
  for (const listener of statusListeners) {
    listener(status)
  }
}

function connect() {
  // Already connected or mid-handshake - nothing to do. Guarding here is
  // what makes connect() safe to call from every subscribe().
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }

  const token = getStoredToken()
  if (!token) {
    // Nothing to authenticate with yet (e.g. the login screen, before
    // AuthContext has a token at all) - don't even attempt the handshake,
    // it would just be rejected. scheduleReconnect() keeps checking
    // periodically, same as notificationSocket.js, so logging in picks
    // this up automatically on the next retry with no page reload needed.
    setStatus('disconnected')
    scheduleReconnect()
    return
  }

  setStatus('connecting')
  socket = new WebSocket(`${WS_URL_BASE}?token=${encodeURIComponent(token)}`)

  socket.onopen = () => {
    reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS // reset backoff after a good connection
    setStatus('connected')
  }

  socket.onmessage = (raw) => {
    let event
    try {
      event = JSON.parse(raw.data)
    } catch {
      // A malformed frame must not kill the stream for every listener.
      console.warn('[socket] ignoring unparseable frame:', raw.data)
      return
    }
    for (const listener of eventListeners) {
      try {
        listener(event)
      } catch (err) {
        // One misbehaving component must not stop the others from
        // receiving this event.
        console.error('[socket] listener threw:', err)
      }
    }
  }

  socket.onerror = () => {
    // onclose always follows onerror, so reconnection is handled there
    // rather than in both places.
    console.warn('[socket] connection error')
  }

  socket.onclose = () => {
    setStatus('disconnected')
    socket = null
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return // a retry is already pending

  const delay = reconnectDelayMs
  console.info(`[socket] reconnecting in ${delay}ms`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)

  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS)
}

/**
 * Subscribe to every event the gateway broadcasts.
 * @param {(event: object) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribe(listener) {
  eventListeners.add(listener)
  connect()
  return () => eventListeners.delete(listener)
}

/**
 * Subscribe to connection-status changes. The listener is called
 * immediately with the current status so a component mounting into an
 * already-open connection renders correctly on its first paint.
 * @param {(status: string) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeStatus(listener) {
  statusListeners.add(listener)
  listener(status)
  connect()
  return () => statusListeners.delete(listener)
}

export function getStatus() {
  return status
}
