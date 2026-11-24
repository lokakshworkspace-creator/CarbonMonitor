/**
 * Blockchain Logs - every recent record's anchoring status, anchored and
 * pending both shown, so this page reads as "the full picture of what's
 * on-chain" rather than a list that quietly omits the in-flight ones.
 *
 * Reuses GET /records (built in step 3/4) - it already carries
 * blockchain_record_id and blockchain_tx_hash per record, so no new
 * endpoint was needed for this page.
 */

import { useEffect, useState } from 'react'

import EmptyState from '../components/EmptyState.jsx'
import RecordAnchorFilter from '../components/RecordAnchorFilter.jsx'
import { useEventStream } from '../context/eventStreamContext.js'
import { useDemoReadings } from '../hooks/useDemoReadings.js'
import { demoAnchorState, filterByAnchor, mergeWithDemo } from '../lib/records.js'
import { getAnchoredRecords, getRecords } from '../services/api.js'

// Pulled up from the GET /records default so anchored records from earlier
// sessions stay in view even when recent activity is mostly Pending test
// runs. 500 is the endpoint's own MAX_RECORDS_LIMIT. This still windows
// "All"/"Pending" to the most recent 500 readings of any anchor state -
// "Anchored" bypasses this entirely via getAnchoredRecords() below, which
// is unbounded, so an anchored record older than this window is still
// found there even though it would drop out of this general fetch.
const RECORDS_LIMIT = 500

function truncateHash(hash) {
  if (!hash) return null
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`
}

export default function BlockchainLogs() {
  const { events } = useEventStream()
  const [records, setRecords] = useState([])
  const [anchoredRecords, setAnchoredRecords] = useState([])
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  // The board's stored demo estimates, listed in the "All" view as "Demo" rows:
  // never hashed and never sent to Sepolia, so they have no record # or transaction.
  const demoReadings = useDemoReadings()

  // Refetched whenever Pipeline B stores or confirms a reading, so a
  // reading that just anchored moves from "Pending" to its tx hash
  // without a manual refresh.
  const relevantEventCount = events.filter(
    (e) => e.event_type === 'DATABASE_STORED' || e.event_type === 'BLOCKCHAIN_CONFIRMED',
  ).length

  useEffect(() => {
    let cancelled = false
    getRecords(RECORDS_LIMIT)
      .then((data) => {
        if (cancelled) return
        setRecords(data)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    // Separate, unbounded fetch so the Anchored filter shows every
    // anchored record in scope, not just whichever happen to fall inside
    // the general fetch's most-recent-RECORDS_LIMIT window above.
    getAnchoredRecords()
      .then((data) => {
        if (cancelled) return
        setAnchoredRecords(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevantEventCount])

  const anchoredCount = anchoredRecords.length

  const visibleRecords = filter === 'anchored' ? anchoredRecords : filterByAnchor(records, filter)
  const rows = filter === 'all' ? mergeWithDemo(visibleRecords, demoReadings) : visibleRecords
  const demoRowCount = rows.length - visibleRecords.length

  return (
    <div className="page">
      <h1>Blockchain Logs</h1>
      <p className="page-subtitle">
        Every recent reading&apos;s anchoring status - {anchoredCount} confirmed on Sepolia in total.
      </p>

      <section className="section">
        <RecordAnchorFilter
          value={filter}
          onChange={setFilter}
          visibleCount={visibleRecords.length}
          totalCount={filter === 'anchored' ? anchoredRecords.length : records.length}
        />
        {demoRowCount > 0 && (
          <p className="dim">
            Includes {demoRowCount} live reading{demoRowCount === 1 ? '' : 's'} from the board (shown as
            demo ppm), hashed and anchored on Sepolia like the others.
          </p>
        )}
        <div className="card">
          {error && <div className="empty error-text">{error}</div>}
          {!error && records.length === 0 && anchoredRecords.length === 0 && rows.length === 0 && (
            <EmptyState>
              No records yet. Publish a reading with{' '}
              <code>python tests/mqtt_test_publisher.py --scenario normal</code>
            </EmptyState>
          )}
          {!error && (records.length > 0 || anchoredRecords.length > 0) && rows.length === 0 && (
            <EmptyState>No {filter === 'anchored' ? 'anchored' : 'pending'} records in view.</EmptyState>
          )}
          {!error && rows.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>CO₂</th>
                  <th>Sensor timestamp</th>
                  <th>Record #</th>
                  <th>Transaction</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((record) => {
                  if (record.isDemo) {
                    const state = demoAnchorState(record)
                    return (
                      <tr key={record.id} className={state === 'anchored' ? undefined : 'row-pending'}>
                        <td className="mono">{record.device_id}</td>
                        <td>{record.demo_ppm} demo ppm</td>
                        <td className="mono dim">{record.sensor_timestamp}</td>
                        <td>
                          {state === 'anchored' ? (
                            <span className="badge badge-online">#{record.blockchain_record_id}</span>
                          ) : (
                            <span className="dim">—</span>
                          )}
                        </td>
                        <td>
                          {state === 'anchored' ? (
                            <a
                              className="mono tx-link"
                              title={record.blockchain_tx_hash}
                              href={`https://sepolia.etherscan.io/tx/${record.blockchain_tx_hash}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {truncateHash(record.blockchain_tx_hash)} ↗
                            </a>
                          ) : (
                            <span className="dim">{state === 'pending' ? 'not yet submitted' : 'not sent to Sepolia'}</span>
                          )}
                        </td>
                        <td>
                          {state === 'anchored' ? (
                            <span className="badge badge-online">Anchored</span>
                          ) : (
                            <span className="badge badge-pending">{state === 'pending' ? 'Pending' : 'Not anchored'}</span>
                          )}
                        </td>
                      </tr>
                    )
                  }
                  const anchored = record.blockchain_record_id !== null
                  return (
                    <tr key={record.id} className={anchored ? undefined : 'row-pending'}>
                      <td className="mono">{record.device_id}</td>
                      <td>{record.co2} ppm</td>
                      <td className="mono dim">{record.sensor_timestamp}</td>
                      <td>
                        {anchored ? (
                          <span className="badge badge-online">#{record.blockchain_record_id}</span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td>
                        {anchored ? (
                          <a
                            className="mono tx-link"
                            title={record.blockchain_tx_hash}
                            href={`https://sepolia.etherscan.io/tx/${record.blockchain_tx_hash}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {truncateHash(record.blockchain_tx_hash)} ↗
                          </a>
                        ) : (
                          <span className="dim">not yet submitted</span>
                        )}
                      </td>
                      <td>
                        {anchored ? (
                          <span className="badge badge-online">Anchored</span>
                        ) : (
                          <span className="badge badge-pending">Pending</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}
