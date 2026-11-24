/**
 * Turns the shared event buffer's SENSOR_READING events into chart-ready
 * points and the current reading - seeded with each device's recent
 * history from GET /api/readings so the chart isn't empty on
 * mount/reconnect/device-switch until the next live reading happens to
 * arrive.
 *
 * Extracted because Real-Time Data and Overview both need "what is the
 * latest reading and what level is it" - and because the filtering has a
 * detail worth stating once rather than twice: the buffer is newest-first,
 * so it must be reversed for the chart, and only events carrying a `data`
 * payload count (older event types have no `data` key at all).
 *
 * deviceId is optional and defaults to no filtering - every reading from
 * every device is merged into one series, which is Overview's existing
 * "latest reading, whoever sent it" glance behavior and stays unchanged
 * on purpose (Overview shows a single most-recent value, not a chart
 * line, so merging devices there is not the misleading-line-series
 * problem a multi-device chart would have). Real-Time Data's chart is
 * the one place multiple devices' readings genuinely must not be merged
 * silently into what looks like one device's line, so it passes an
 * explicit deviceId to filter to a single selected device - and history
 * is only fetched when a specific device is selected, for the same
 * reason: there is no single device to seed Overview's merged view from.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { useEventStream } from '../context/eventStreamContext.js'
import { classifyDemo } from '../lib/demoBands.js'
import { classify } from '../lib/levels.js'
import { getDemoReadings, getReadings } from '../services/api.js'

// Enough history to show a full demo sequence without the x-axis turning
// into an unreadable smear.
const MAX_LIVE_POINTS = 60
const HISTORY_LIMIT = 200

// A stable shared reference (not a fresh [] literal per render) so the
// "no device selected" case doesn't defeat the points useMemo below -
// every new array reference would otherwise count as "changed" on every
// render, even though the value never does.
const EMPTY_POINTS = []

// Demo-estimate history (presentation only). The gateway stores DEMO_ESTIMATE
// readings in their own collection (GET /api/demo-readings) - never in
// sensor_data, never hashed or anchored - and that is the chart's source of
// truth. The shared event buffer holds only 500 events of every type for every
// device, so it alone would be short and empty on every reload.
//
// This per-device rolling copy in THIS BROWSER ONLY (localStorage) is just a
// display cache/fallback: it covers readings from before the gateway stored
// them, and a server fetch that failed. Nothing is ever sent from it.
const DEMO_STORE_KEY = 'carbonmonitor.demoPoints.v1'
const DEMO_MAX_POINTS = 500
const DEMO_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Date.parse that falls back (instead of returning NaN) for a missing/garbled value. */
function parseTs(value, fallback) {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function loadDemoStore() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DEMO_STORE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveDemoStore(store) {
  try {
    window.localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(store))
  } catch {
    // Storage unavailable/full: the in-memory copy still works for this session.
  }
}

/** Device ids that have saved demo history in this browser (newest reading first). */
export function getDemoHistoryDeviceIds() {
  const store = loadDemoStore()
  return Object.keys(store)
    .filter((id) => Array.isArray(store[id]) && store[id].length > 0)
    .sort((a, b) => store[b][store[b].length - 1].ts - store[a][store[a].length - 1].ts)
}

export function useReadings(thresholds, deviceId = null) {
  const { events } = useEventStream()

  // The historical seed, fetched once per selected device - NOT replaced
  // by live points arriving afterward, only appended to (see `points`
  // below). Stored without `level`: classify() is applied at merge time
  // against whatever `thresholds` currently is, so a seed fetched before
  // useThresholds() resolves doesn't get stuck showing UNKNOWN forever.
  const [historicalPoints, setHistoricalPoints] = useState([])

  useEffect(() => {
    // No synchronous setState for the "nothing selected" case - see
    // `seededHistoricalPoints` below, which derives [] for that case
    // during render instead of writing it here as a side effect.
    if (deviceId === null) return
    let cancelled = false
    getReadings(deviceId, HISTORY_LIMIT)
      .then((rows) => {
        if (cancelled) return
        setHistoricalPoints(
          rows.map((row) => ({
            time: new Date(row.sensor_timestamp).toLocaleTimeString([], { hour12: false }),
            co2: row.co2,
          })),
        )
      })
      .catch(() => {
        // History is a nice-to-have hydration, not a requirement - the
        // live buffer alone still renders correctly, so this fails
        // silently rather than adding a second error UI next to
        // useThresholds'/useDevices' own.
        if (!cancelled) setHistoricalPoints([])
      })
    return () => {
      cancelled = true
    }
  }, [deviceId])

  // Masks a stale seed from a previously-selected device the instant
  // deviceId goes back to null, without needing a matching effect run to
  // clear it first.
  const seededHistoricalPoints = deviceId === null ? EMPTY_POINTS : historicalPoints

  // The gateway's stored demo readings for this device (chronological). Held
  // with the device id it was fetched for, so a stale result for a previously
  // selected device is ignored rather than shown.
  const [serverDemo, setServerDemo] = useState({ deviceId: null, rows: EMPTY_POINTS })

  useEffect(() => {
    if (deviceId === null) return
    let cancelled = false
    getDemoReadings({ deviceId, limit: DEMO_MAX_POINTS })
      .then((rows) => {
        if (cancelled) return
        const mapped = rows
          .map((row) => ({
            ts: parseTs(row.sensor_timestamp, NaN),
            demo_ppm: row.demo_ppm,
            raw_adc: row.raw_adc,
            v_pin: row.v_pin,
          }))
          .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.demo_ppm))
          .map((p) => ({ ...p, time: new Date(p.ts).toLocaleTimeString([], { hour12: false }) }))
          .reverse() // the API is newest first; the chart wants oldest first
        setServerDemo({ deviceId, rows: mapped })
      })
      .catch(() => {
        // Falls back to the browser cache + live readings below.
        if (!cancelled) setServerDemo({ deviceId, rows: EMPTY_POINTS })
      })
    return () => {
      cancelled = true
    }
  }, [deviceId])

  const livePoints = useMemo(() => {
    const readings = events.filter(
      (event) =>
        event.event_type === 'SENSOR_READING' &&
        event.data &&
        (deviceId === null || event.device_id === deviceId),
    )
    return readings
      .slice(0, MAX_LIVE_POINTS)
      .reverse()
      .map((event) => ({
        time: new Date(event.timestamp).toLocaleTimeString([], { hour12: false }),
        // A demo reading is keyed by its device timestamp (the gateway forwards it),
        // so a live point and its stored copy from /api/demo-readings share one key.
        ts: parseTs(event.data.sensor_timestamp, new Date(event.timestamp).getTime()),
        co2: event.data.co2,
        // Uncalibrated hardware readings carry co2: null plus these raw fields.
        // v_pin is an ADC-derived estimate, not a verified voltage. Live-only:
        // these are never stored, so history above has none of them.
        raw_adc: event.data.raw_adc,
        v_pin: event.data.v_pin,
        calibration_status: event.data.calibration_status,
        // DEMO_ESTIMATE only: an ADC rescale, NOT CO2. Never put into `co2`.
        demo_ppm: event.data.demo_ppm,
      }))
  }, [events, deviceId])

  // historicalPoints are all strictly older than anything livePoints can
  // hold (the fetch above runs once, at mount/device-switch, before any
  // live point for this device exists) - so this concatenation is already
  // in chronological order with no sort needed. The seed is appended to,
  // never replaced or dropped, by whatever arrives live afterward.
  const allPoints = useMemo(
    () =>
      [...seededHistoricalPoints, ...livePoints].map((p) => ({
        ...p,
        // An uncalibrated reading is never classified as NORMAL (or any CO2 level).
        level:
          p.calibration_status === 'DEMO_ESTIMATE'
            ? 'DEMO_ESTIMATE'
            : p.calibration_status === 'UNCALIBRATED'
              ? 'UNCALIBRATED'
              : classify(p.co2, thresholds),
      })),
    [seededHistoricalPoints, livePoints, thresholds],
  )

  // `points` is the plottable series of real CO2: uncalibrated and demo
  // readings have no CO2 value, so they stay out of it (a null point would
  // draw a stray dot, and a demo value must never sit on the real chart).
  const points = useMemo(
    () => allPoints.filter((p) => p.level !== 'UNCALIBRATED' && p.level !== 'DEMO_ESTIMATE'),
    [allPoints],
  )

  // Separate series for the presentation demo chart: the gateway's stored demo
  // readings (falling back to this browser's cache when there are none) merged
  // with whatever just arrived live. Idempotent, so re-running it (re-renders,
  // StrictMode) is harmless.
  const demoStoreRef = useRef(null)
  const demoHistory = useMemo(() => {
    if (deviceId === null) return EMPTY_POINTS
    if (demoStoreRef.current === null) demoStoreRef.current = loadDemoStore()
    const store = demoStoreRef.current

    const fromServer = serverDemo.deviceId === deviceId ? serverDemo.rows : EMPTY_POINTS
    const cutoff = Date.now() - DEMO_MAX_AGE_MS
    // The cache is only a fallback, and ages out; the server copy does not.
    const base = fromServer.length > 0 ? fromServer : (store[deviceId] ?? []).filter((p) => p.ts >= cutoff)

    const byTs = new Map(base.map((p) => [p.ts, p]))
    let changed = false
    for (const p of livePoints) {
      if (p.calibration_status === 'DEMO_ESTIMATE' && Number.isFinite(p.demo_ppm) && !byTs.has(p.ts)) {
        byTs.set(p.ts, { ts: p.ts, time: p.time, demo_ppm: p.demo_ppm, raw_adc: p.raw_adc, v_pin: p.v_pin })
        changed = true
      }
    }

    const merged = [...byTs.values()].sort((a, b) => a.ts - b.ts).slice(-DEMO_MAX_POINTS)

    if (changed || merged.length !== (store[deviceId] ?? []).length) {
      store[deviceId] = merged
      saveDemoStore(store)
    }
    return merged
  }, [livePoints, deviceId, serverDemo])

  // Display-only level of each demo reading against the separate DEMO bands
  // (lib/demoBands.js) - NOT the gateway's real thresholds, and NOT an alert:
  // the gateway never evaluates, stores or notifies on demo readings.
  const demoPoints = useMemo(
    () => demoHistory.map((p) => ({ ...p, level: classifyDemo(p.demo_ppm) })),
    [demoHistory],
  )

  // `current` for one selected device may be uncalibrated, so pages can show
  // "Uncalibrated" plus raw ADC / voltage. The merged all-devices view
  // (deviceId === null, Overview) keeps its original "latest real CO2" meaning.
  //
  // A device with saved demo history is treated as a demo device from the
  // first render after a reload, unless a real calibrated reading has arrived
  // live since. Otherwise `current` would be the newest database row (an old
  // real reading) until the first live demo reading showed up, hiding the saved
  // history behind the old chart for the first ~20 s.
  const liveHasRealReading = livePoints.some(
    (p) =>
      p.calibration_status !== 'DEMO_ESTIMATE' && p.calibration_status !== 'UNCALIBRATED' && Number.isFinite(p.co2),
  )
  const demoMode = deviceId !== null && demoHistory.length > 0 && !liveHasRealReading
  const lastDemo = demoMode ? demoHistory[demoHistory.length - 1] : null

  const currentSource = deviceId === null ? points : allPoints
  const current = lastDemo
    ? { ...lastDemo, co2: null, calibration_status: 'DEMO_ESTIMATE', level: 'DEMO_ESTIMATE' }
    : currentSource.length > 0
      ? currentSource[currentSource.length - 1]
      : null

  // Display-only demo-band level of the latest reading, or null when the
  // current reading is not a demo estimate.
  const demoLevel = current && current.level === 'DEMO_ESTIMATE' ? classifyDemo(current.demo_ppm) : null

  return { points, demoPoints, demoLevel, current, level: current ? current.level : 'UNKNOWN' }
}
