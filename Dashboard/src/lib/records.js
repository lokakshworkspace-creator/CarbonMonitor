/**
 * Client-side record-list helpers shared by the Blockchain Logs and
 * Verification pages. Kept out of RecordAnchorFilter.jsx so that file
 * only exports a component (fast-refresh requirement), mirroring the
 * EventStream.jsx / eventStreamContext.js split elsewhere in this app.
 */

/**
 * Narrow a records array by on-chain anchor state, using the
 * blockchain_record_id GET /records already returns. Purely a view
 * filter - no request, no backend involvement.
 *
 * @param {Array} records - rows from GET /records
 * @param {'all'|'anchored'|'pending'} filter
 */
/**
 * Interleave the board's stored demo readings into a records list, newest
 * first by sensor timestamp, so the live hardware readings show up in the same
 * table as everything else. Each demo row is flagged isDemo: true and carries
 * its anchoring state (see demoAnchorState()). It is NOT one of the verifiable
 * /records rows, so callers must render it as non-selectable and never pass its
 * id to verification.
 *
 * Real records keep their relative order; only their position among the demo
 * rows is decided by time (a stable sort, with unparsable times last).
 */
export function mergeWithDemo(records, demoReadings) {
  if (demoReadings.length === 0) return records
  const demoRows = demoReadings.map((reading) => ({
    id: `demo-${reading.id}`,
    isDemo: true,
    device_id: reading.device_id,
    demo_ppm: reading.demo_ppm,
    sensor_timestamp: reading.sensor_timestamp,
    hashed: reading.hashed,
    blockchain_record_id: reading.blockchain_record_id ?? null,
    blockchain_tx_hash: reading.blockchain_tx_hash ?? null,
  }))
  const time = (row) => {
    const parsed = Date.parse(row.sensor_timestamp)
    return Number.isFinite(parsed) ? parsed : -Infinity
  }
  return [...demoRows, ...records].sort((a, b) => time(b) - time(a))
}

/**
 * Anchoring state of a merged demo row: 'anchored' (has an on-chain record id),
 * 'pending' (hashed, waiting for Sepolia) or 'legacy' (stored before demo
 * readings were hashed, so it never will be).
 */
export function demoAnchorState(row) {
  if (row.blockchain_record_id !== null && row.blockchain_record_id !== undefined) return 'anchored'
  return row.hashed ? 'pending' : 'legacy'
}

export function filterByAnchor(records, filter) {
  if (filter === 'anchored') return records.filter((r) => r.blockchain_record_id !== null)
  if (filter === 'pending') return records.filter((r) => r.blockchain_record_id === null)
  return records
}
