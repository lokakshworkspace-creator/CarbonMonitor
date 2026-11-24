/**
 * Display-only bands for the physical MQ-135's DEMO_ESTIMATE readings.
 *
 * The demo estimate is an ADC rescale with a floor of 400 and no upper cap (see
 * ESP32/main/main.ino), so the real 1000 / 2000 ppm thresholds (levels.js,
 * from the gateway's .env) cannot meaningfully be applied to it. These bands
 * are the ONE place the demo scale's levels are defined. They are not
 * thresholds: the gateway never evaluates, alerts on, stores or anchors demo
 * readings, and nothing here is sent anywhere.
 *
 * Real calibrated and simulated readings never touch this file - they keep
 * using classify() and the gateway's real thresholds.
 */

/** Demo band boundaries, on the demo-ppm scale (floor 400, no upper cap). */
export const DEMO_BANDS = Object.freeze({
  warning: 600, // WARNING from 600 up to and including 800
  critical: 800, // CRITICAL strictly above 800
})

/**
 * Hysteresis for the display-only demo CRITICAL notification: after one fires,
 * a device must read below (critical - margin) before another can, so a value
 * wobbling around 800 does not spam the bell.
 */
export const DEMO_ALERT_REARM_MARGIN = 50

/**
 * One step of the demo-CRITICAL notification state machine for one device.
 * `armed` is whether a notification may fire (initially true). Returns whether
 * to fire now and the new armed state: fires on entering CRITICAL, stays
 * silent while it remains high, re-arms once below (critical - margin).
 */
export function evaluateDemoAlert(armed, demoPpm) {
  if (!Number.isFinite(demoPpm)) return { fire: false, armed }
  if (demoPpm > DEMO_BANDS.critical) return { fire: armed, armed: false }
  if (demoPpm < DEMO_BANDS.critical - DEMO_ALERT_REARM_MARGIN) return { fire: false, armed: true }
  return { fire: false, armed }
}

/** Shape Co2Gauge expects ({warning, critical}), so it draws the demo bands. */
export const DEMO_GAUGE_THRESHOLDS = DEMO_BANDS

/** Wording used wherever the bands appear, so they cannot be read as real thresholds. */
export const DEMO_BANDS_LABEL = 'demo bands, display only'

/** Level of a demo-ppm value: NORMAL below 600, WARNING 600-800, CRITICAL above 800. */
export function classifyDemo(demoPpm) {
  if (!Number.isFinite(demoPpm)) return 'UNKNOWN'
  if (demoPpm > DEMO_BANDS.critical) return 'CRITICAL'
  if (demoPpm >= DEMO_BANDS.warning) return 'WARNING'
  return 'NORMAL'
}
