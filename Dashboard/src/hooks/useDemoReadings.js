/**
 * The physical MQ-135's stored DEMO_ESTIMATE readings (GET /api/demo-readings),
 * newest first, refreshed whenever a new live demo reading arrives.
 *
 * Presentation estimates, not measurements. The gateway hashes and anchors them
 * like real records but keeps them in their own collection, so they are not in
 * the verifiable /records set. The Verification and Blockchain Logs pages list
 * them as non-selectable rows showing Pending / Anchored (see lib/records.js's
 * mergeWithDemo()).
 */

import { useEffect, useState } from 'react'

import { useEventStream } from '../context/eventStreamContext.js'
import { getDemoReadings } from '../services/api.js'

// Newest this-many are listed.
const DEMO_VIEW_LIMIT = 50

export function useDemoReadings() {
  const { events } = useEventStream()
  const [readings, setReadings] = useState([])

  // Newest live demo reading's id: changes on every one (unlike a count, it
  // keeps changing once the shared event buffer is full), refetching the list.
  const latestDemoEventId =
    events.find((e) => e.event_type === 'SENSOR_READING' && e.data?.calibration_status === 'DEMO_ESTIMATE')?._id ?? 0
  // Also refetch when an anchoring confirms, so a row moves Pending -> Anchored
  // without a reload (the confirmation lands seconds after the reading itself).
  const latestConfirmedEventId = events.find((e) => e.event_type === 'BLOCKCHAIN_CONFIRMED')?._id ?? 0

  useEffect(() => {
    let cancelled = false
    getDemoReadings({ limit: DEMO_VIEW_LIMIT })
      .then((data) => {
        if (!cancelled) setReadings(data)
      })
      .catch(() => {
        // An addition to the page's own list: a failure leaves it empty rather
        // than adding a second error UI next to the page's own one.
      })
    return () => {
      cancelled = true
    }
  }, [latestDemoEventId, latestConfirmedEventId])

  return readings
}
