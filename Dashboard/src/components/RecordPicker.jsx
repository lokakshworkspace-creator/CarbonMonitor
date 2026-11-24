/**
 * Record picker for the Verification page: recent readings from
 * GET /records, newest first, showing each record's current
 * verification_status and whether it has an on-chain anchor yet.
 *
 * This list is read-only by design - there is no write endpoint, and the
 * tamper simulation is meant to happen out-of-band via mongosh, the same
 * way the Phase 2 live proof did it. The page only ever asks the gateway
 * to verify what is already in the database.
 */

import EmptyState from './EmptyState.jsx'
import { demoAnchorState } from '../lib/records.js'

const STATUS_BADGE_CLASS = {
  Verified: 'badge-online',
  Tampered: 'badge-CRITICAL',
  Pending: '',
}

export default function RecordPicker({ records, selectedId, onSelect, error }) {
  if (error) {
    return <div className="empty error-text">{error}</div>
  }
  if (records.length === 0) {
    return (
      <EmptyState>
        No records yet. Publish a reading with{' '}
        <code>python tests/mqtt_test_publisher.py --scenario normal</code>
      </EmptyState>
    )
  }

  // Rows flagged isDemo (see lib/records.js's mergeWithDemo()) are the board's
  // demo estimates: hashed and anchored like the rest, but kept apart from the
  // verifiable /records set, so they are listed here and not selectable.

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Device</th>
          <th>CO₂</th>
          <th>Sensor timestamp</th>
          <th>Status</th>
          <th>Anchored</th>
        </tr>
      </thead>
      <tbody>
        {records.map((record) =>
          record.isDemo ? (
            <tr key={record.id}>
              <td className="mono">{record.device_id}</td>
              <td>{record.demo_ppm} demo ppm</td>
              <td className="mono dim">{record.sensor_timestamp}</td>
              <td>
                <span className="badge">Pending</span>
              </td>
              <td>
                {demoAnchorState(record) === 'anchored' ? (
                  <span className="badge badge-online">#{record.blockchain_record_id}</span>
                ) : (
                  <span className="dim">{demoAnchorState(record) === 'pending' ? 'pending' : 'not anchored'}</span>
                )}
              </td>
            </tr>
          ) : (
            <tr
              key={record.id}
              className={record.id === selectedId ? 'row-selected' : 'row-selectable'}
              onClick={() => onSelect(record.id)}
            >
              <td className="mono">{record.device_id}</td>
              <td>{record.co2} ppm</td>
              <td className="mono dim">{record.sensor_timestamp}</td>
              <td>
                <span className={`badge ${STATUS_BADGE_CLASS[record.verification_status] ?? ''}`}>
                  {record.verification_status}
                </span>
              </td>
              <td>
                {record.blockchain_record_id !== null ? (
                  <span className="badge badge-online">#{record.blockchain_record_id}</span>
                ) : (
                  <span className="dim">pending</span>
                )}
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  )
}
