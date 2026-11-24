/**
 * Display-only notifications for the physical MQ-135's DEMO_ESTIMATE readings.
 *
 * The real bell (useNotifications.js) shows notifications the gateway saved to
 * MongoDB after a real threshold alert. Demo readings never reach that path -
 * the gateway skips thresholds, storage and the blockchain for them on purpose
 * - so nothing would ever ring the bell. This hook raises a notification IN
 * THIS BROWSER ONLY when a demo reading enters the CRITICAL demo band
 * (lib/demoBands.js). Nothing is sent to or stored by the gateway/MongoDB, and
 * every message says it is a demo ("demo bands, display only").
 *
 * It listens on the existing shared WebSocket (services/socket.js), which the
 * gateway already scopes by region, so a regional head only sees their own
 * region's demo devices. Fires once per entry into CRITICAL, then re-arms only
 * after the reading drops below (critical - DEMO_ALERT_REARM_MARGIN).
 */

import { useEffect, useRef, useState } from 'react'

import { DEMO_BANDS, DEMO_BANDS_LABEL, evaluateDemoAlert } from '../lib/demoBands.js'
import { subscribe } from '../services/socket.js'

const TOAST_DURATION_MS = 6000
const MAX_DEMO_NOTIFICATIONS = 50

export function useDemoAlerts() {
  const [notifications, setNotifications] = useState([])
  const [toasts, setToasts] = useState([])
  // deviceId -> false while a CRITICAL notification is outstanding for it.
  const armed = useRef({})
  const counter = useRef(0)

  useEffect(() => {
    return subscribe((event) => {
      if (event.event_type !== 'SENSOR_READING' || !event.data) return
      if (event.data.calibration_status !== 'DEMO_ESTIMATE') return
      const ppm = event.data.demo_ppm
      if (!Number.isFinite(ppm)) return
      const deviceId = event.device_id

      const step = evaluateDemoAlert(armed.current[deviceId] ?? true, ppm)
      armed.current[deviceId] = step.armed

      if (step.fire) {
        counter.current += 1
        const notification = {
          id: `demo-${counter.current}`,
          demo: true,
          severity: 'critical',
          device_id: deviceId,
          co2_value: ppm,
          created_at: event.timestamp ?? new Date().toISOString(),
          message: `DEMO: ${deviceId} reached the CRITICAL demo band (${ppm} demo ppm, above ${DEMO_BANDS.critical}) - ${DEMO_BANDS_LABEL}`,
        }
        setNotifications((previous) => [notification, ...previous].slice(0, MAX_DEMO_NOTIFICATIONS))

        const toastKey = `${notification.id}-${Date.now()}`
        setToasts((previous) => [...previous, { key: toastKey, notification }])
        setTimeout(() => {
          setToasts((previous) => previous.filter((t) => t.key !== toastKey))
        }, TOAST_DURATION_MS)
      }
    })
  }, [])

  function markSeen(notificationId) {
    setNotifications((previous) => previous.filter((n) => n.id !== notificationId))
  }

  function dismissToast(key) {
    setToasts((previous) => previous.filter((t) => t.key !== key))
  }

  return { notifications, toasts, markSeen, dismissToast }
}
