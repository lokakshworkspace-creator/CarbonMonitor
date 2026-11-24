/**
 * Verification - pick a record, verify it against the on-chain hash, and
 * see the result with full evidence (all three hashes) rather than just
 * a verdict.
 *
 * There is deliberately no way to edit a record's data from this page:
 * no write endpoint exists, and per the project's design the tamper
 * simulation happens out-of-band via mongosh, exactly as the Phase 2
 * live proof did it. This page only ever calls POST /verify/{id} against
 * whatever is currently in MongoDB - which is precisely what makes
 * re-verifying after an out-of-band edit a meaningful, honest test.
 */

import { useEffect, useState } from 'react'

import EmptyState from '../components/EmptyState.jsx'
import RecordAnchorFilter from '../components/RecordAnchorFilter.jsx'
import RecordPicker from '../components/RecordPicker.jsx'
import VerificationResult from '../components/VerificationResult.jsx'
import { useEventStream } from '../context/eventStreamContext.js'
import { useDemoReadings } from '../hooks/useDemoReadings.js'
import { filterByAnchor, mergeWithDemo } from '../lib/records.js'
import { getAnchoredRecords, getRecords, verifyRecord } from '../services/api.js'

// Matches Blockchain Logs: pull enough history that anchored records from
// earlier sessions stay selectable even when recent rows are all Pending
// test runs. 500 is the GET /records endpoint's own MAX_RECORDS_LIMIT.
// Still a window, though - the Anchored filter bypasses it entirely via
// getAnchoredRecords() below, which is unbounded.
const RECORDS_LIMIT = 500

// The Anchored filter's fetch is unbounded on the backend (by design - it must
// reach anchored records older than any window), so the picker only lists the
// newest this-many of them. The filter's "N of M" counter still shows the true
// total, so it reads as a window, not as the whole set.
const ANCHORED_VIEW_LIMIT = 50

export default function Verification() {
  const { events } = useEventStream()

  const [records, setRecords] = useState([])
  const [anchoredRecords, setAnchoredRecords] = useState([])
  const [recordsError, setRecordsError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState('all')
  // The board's stored demo estimates: listed in the "All" view as non-selectable
  // "Demo" rows (no hash, not anchored, never passed to verifyRecord()).
  const demoReadings = useDemoReadings()

  const [result, setResult] = useState(null)
  const [pending, setPending] = useState(false)
  const [verifyError, setVerifyError] = useState(null)

  // Refetched whenever Pipeline B stores or anchors a reading, so newly
  // published readings and fresh on-chain confirmations show up here
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
        setRecordsError(null)
      })
      .catch((err) => {
        if (!cancelled) setRecordsError(err.message)
      })
    // Separate, unbounded fetch so the Anchored filter can select from
    // every anchored record in scope, not just whichever happen to fall
    // inside the general fetch's most-recent-RECORDS_LIMIT window above.
    getAnchoredRecords()
      .then((data) => {
        if (cancelled) return
        setAnchoredRecords(data)
      })
      .catch((err) => {
        if (!cancelled) setRecordsError(err.message)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevantEventCount])

  async function handleVerify() {
    if (selectedId === null) return
    setPending(true)
    setVerifyError(null)
    try {
      const outcome = await verifyRecord(selectedId)
      setResult(outcome)
    } catch (err) {
      setVerifyError(err.message)
      setResult(null)
    } finally {
      setPending(false)
    }
  }

  // Filter is display-only over data already fetched; the selected-record
  // lookup checks both fetches so a selection survives toggling even when
  // it came from the Anchored filter's separate, unbounded record set.
  // anchoredRecords arrives newest first, so slice() keeps the 50 most recent.
  const visibleRecords =
    filter === 'anchored' ? anchoredRecords.slice(0, ANCHORED_VIEW_LIMIT) : filterByAnchor(records, filter)
  const selectedRecord =
    records.find((r) => r.id === selectedId) ?? anchoredRecords.find((r) => r.id === selectedId) ?? null
  // Demo rows only appear in the "All" view; anchored/pending are about real records.
  const pickerRows = filter === 'all' ? mergeWithDemo(visibleRecords, demoReadings) : visibleRecords
  const demoRowCount = pickerRows.length - visibleRecords.length

  return (
    <div className="page">
      <h1>Verification</h1>
      <p className="page-subtitle">
        Recompute a record&apos;s hash from its current data and compare it against what was anchored
        on Sepolia.
      </p>

      <section className="section">
        <h2>Select a record</h2>
        <RecordAnchorFilter
          value={filter}
          onChange={setFilter}
          visibleCount={visibleRecords.length}
          totalCount={filter === 'anchored' ? anchoredRecords.length : records.length}
        />
        {demoRowCount > 0 && (
          <p className="dim">
            Includes {demoRowCount} live reading{demoRowCount === 1 ? '' : 's'} from the board (shown as
            demo ppm): hashed and anchored like the others, but they are demo estimates outside the
            verifiable records, so they cannot be selected here.
          </p>
        )}
        <div className="card">
          {!recordsError && (records.length > 0 || anchoredRecords.length > 0) && pickerRows.length === 0 ? (
            <EmptyState>No {filter === 'anchored' ? 'anchored' : 'pending'} records in view.</EmptyState>
          ) : (
            <RecordPicker
              records={pickerRows}
              selectedId={selectedId}
              onSelect={setSelectedId}
              error={recordsError}
            />
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Result</h2>
          <button type="button" className="btn-verify" disabled={selectedId === null || pending} onClick={handleVerify}>
            {pending ? 'Verifying…' : 'Verify'}
          </button>
        </div>
        {selectedRecord && (
          <div className="selected-summary dim">
            Selected: <span className="mono">{selectedRecord.id}</span> — {selectedRecord.device_id},{' '}
            {selectedRecord.co2} ppm
          </div>
        )}
        {verifyError && <div className="empty error-text">{verifyError}</div>}
        <div className="card card-pad">
          <VerificationResult result={result} pending={pending} />
        </div>
      </section>

      <section className="section">
        <h2>Running the tamper demo through this page</h2>
        <div className="card card-pad demo-note">
          <p>
            This page can only verify what is already stored - there is no editor here, and there
            should not be one. The tamper simulation is meant to happen directly against MongoDB,
            outside the gateway, exactly as it was proven in Phase 2:
          </p>
          <ol>
            <li>Pick an anchored record above (its Anchored column shows a record number, not &quot;pending&quot;) and click Verify. It should read <strong>Verified</strong>.</li>
            <li>
              In a separate terminal, edit that record&apos;s <code>co2</code> field directly in
              MongoDB, e.g.:
              <pre className="code-block">
{`mongosh
use carbon_emission
db.sensor_data.updateOne(
  { _id: ObjectId("<the record's id from the table above>") },
  { $set: { co2: 9999.9 } }
)`}
              </pre>
            </li>
            <li>Click Verify again on the same record, with no other change. It should now read <strong>Tampered</strong>, with the recomputed hash no longer matching the on-chain hash.</li>
          </ol>
        </div>
      </section>
    </div>
  )
}
