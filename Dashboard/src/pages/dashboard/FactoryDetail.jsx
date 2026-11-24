/**
 * One factory's devices, with the same Live / Last 7 Days tabs
 * Real-Time Data (Phase 3) uses - reusing Co2Chart/WeeklyAnalytics/
 * useReadings/useAnalytics directly rather than duplicating that logic,
 * scoped to this factory's own device list (GET /api/factories/{id}/devices)
 * instead of every device the gateway has ever seen. A regional_head
 * hitting another region's factoryId gets the same 404
 * getFactoryDevices() already surfaces server-side - shown here as the
 * page's own error state, not a silent redirect.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import Co2Chart from '../../components/Co2Chart.jsx'
import Co2Gauge from '../../components/Co2Gauge.jsx'
import {
  DEMO_COLOR,
  DEMO_LABEL,
  DemoEstimateChart,
  DemoReadingValue,
} from '../../components/DemoEstimate.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { DEMO_BANDS, DEMO_BANDS_LABEL, DEMO_GAUGE_THRESHOLDS } from '../../lib/demoBands.js'
import { ChartIcon } from '../../components/icons.jsx'
import WeeklyAnalytics from '../../components/WeeklyAnalytics.jsx'
import { useEventStream } from '../../context/eventStreamContext.js'
import { useAnalytics } from '../../hooks/useAnalytics.js'
import { getDemoHistoryDeviceIds, useReadings } from '../../hooks/useReadings.js'
import { useThresholds } from '../../hooks/useThresholds.js'
import { getFactoryDevices } from '../../services/api.js'
import { LEVEL_COLOR } from '../../lib/levels.js'

const ANALYTICS_DAYS = 7
const CHART_TABS = [
  { key: 'live', label: 'Live' },
  { key: 'weekly', label: 'Last 7 Days' },
]

const EMPTY_DEVICES = []

export default function FactoryDetail() {
  const { factoryId } = useParams()
  const { thresholds } = useThresholds()
  const { events } = useEventStream()

  const [devices, setDevices] = useState(EMPTY_DEVICES)
  // Which factoryId `devices` was actually fetched for - lets the render
  // below tell "still showing the previous factory's devices while this
  // one loads" apart from "this factory's devices, fetched" without a
  // synchronous reset in the effect (see useReadings.js's
  // seededHistoricalPoints for the same pattern).
  const [devicesFactoryId, setDevicesFactoryId] = useState(null)
  const [error, setError] = useState(null)
  // {factoryId, deviceId} rather than a bare deviceId, so switching
  // factories can't leak the previous factory's manual selection into
  // this one's device list purely by deriving it away at render time.
  const [manualSelection, setManualSelection] = useState(null)
  const [chartTab, setChartTab] = useState('live')

  useEffect(() => {
    let cancelled = false
    getFactoryDevices(factoryId)
      .then((rows) => {
        if (cancelled) return
        setDevices(rows)
        setDevicesFactoryId(factoryId)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setDevicesFactoryId(factoryId)
      })
    return () => {
      cancelled = true
    }
  }, [factoryId])

  const effectiveDevices = devicesFactoryId === factoryId ? devices : EMPTY_DEVICES
  const manualDeviceId = manualSelection?.factoryId === factoryId ? manualSelection.deviceId : null
  // Default to a device that is actually sending readings (devices are listed
  // newest-first, so the first one can be a registered-but-silent device),
  // then fall back to the first in the list. A manual dropdown pick wins.
  const liveDeviceId = effectiveDevices.find((device) =>
    events.some((e) => e.event_type === 'SENSOR_READING' && e.device_id === device.device_id),
  )?.device_id
  // After a reload nothing is live yet, so also prefer a device that has saved
  // demo history in this browser before falling back to the first in the list.
  const savedDemoDeviceId = effectiveDevices.find((device) =>
    getDemoHistoryDeviceIds().includes(device.device_id),
  )?.device_id
  const selectedDeviceId =
    manualDeviceId ?? liveDeviceId ?? savedDemoDeviceId ?? effectiveDevices[0]?.device_id ?? null
  const { points, demoPoints, demoLevel, current, level } = useReadings(thresholds, selectedDeviceId)
  const isDemo = level === 'DEMO_ESTIMATE'
  const { data: weeklyData, error: weeklyError } = useAnalytics(selectedDeviceId, ANALYTICS_DAYS)

  return (
    <div className="page">
      <div className="section-head">
        <h1>Factory devices</h1>
        {effectiveDevices.length > 0 && (
          <select
            className="device-select"
            value={selectedDeviceId ?? ''}
            onChange={(event) => setManualSelection({ factoryId, deviceId: event.target.value })}
          >
            {effectiveDevices.map((device) => (
              <option key={device.id} value={device.device_id}>
                {device.device_id} {device.is_hardware ? '(hardware)' : '(simulated)'}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="empty error-text">{error}</div>}
      {!error && effectiveDevices.length === 0 && (
        <EmptyState>No devices registered to this factory yet.</EmptyState>
      )}

      {effectiveDevices.length > 0 && (
        <>
          <section className="section">
            <div className="stat-row">
              <div className="card stat-card">
                <div className="stat-label">Current reading</div>
                <div
                  className="stat-value mono"
                  style={{ color: isDemo ? (LEVEL_COLOR[demoLevel] ?? DEMO_COLOR) : (LEVEL_COLOR[level] ?? 'var(--text)') }}
                >
                  {isDemo ? (
                    <DemoReadingValue current={current} />
                  ) : (
                    <>
                      {level === 'UNCALIBRATED' ? 'Uncalibrated' : current ? current.co2 : '—'}
                      {level !== 'UNCALIBRATED' && <span className="stat-unit">ppm</span>}
                    </>
                  )}
                </div>
                <div className="stat-sub">
                  {isDemo ? null : level === 'UNCALIBRATED'
                    ? // v_pin is an ADC-derived estimate, not a verified voltage.
                      `raw ADC ${current.raw_adc ?? '—'}` +
                      (Number.isFinite(current.v_pin) ? ` · ~${current.v_pin.toFixed(2)} V (est.)` : '') +
                      ` · at ${current.time}`
                    : current
                      ? `at ${current.time}`
                      : 'waiting for first reading'}
                </div>
              </div>
              <div className="card stat-card">
                <div className="stat-label">Level</div>
                <div
                  className="stat-value"
                  style={{ color: isDemo ? (LEVEL_COLOR[demoLevel] ?? DEMO_COLOR) : (LEVEL_COLOR[level] ?? 'var(--text-dim)') }}
                >
                  {isDemo ? `${demoLevel ?? 'UNKNOWN'} (demo)` : level}
                </div>
                {isDemo && (
                  <div className="stat-sub">
                    {DEMO_BANDS_LABEL} · warning ≥ {DEMO_BANDS.warning}, critical &gt; {DEMO_BANDS.critical} demo
                    ppm · not the real thresholds
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="section">
            <h2>
              {isDemo ? `Current level (${DEMO_LABEL} · ${DEMO_BANDS_LABEL})` : 'Current level'}
            </h2>
            <div className="card card-pad">
              {isDemo ? (
                <Co2Gauge
                  co2={current?.demo_ppm}
                  level={demoLevel}
                  thresholds={DEMO_GAUGE_THRESHOLDS}
                  unit="demo ppm"
                />
              ) : (
                <Co2Gauge co2={current?.co2} level={level} thresholds={thresholds} />
              )}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2 className="with-icon">
                <span className="card-icon-badge is-chart" aria-hidden="true">
                  <ChartIcon />
                </span>
                {chartTab === 'live'
                  ? isDemo
                    ? 'Estimated demo readings'
                    : 'Recent readings (ppm)'
                  : `Last ${ANALYTICS_DAYS} days (ppm)`}
              </h2>
              <div className="filters">
                {CHART_TABS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className={chartTab === key ? 'chip active' : 'chip'}
                    onClick={() => setChartTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="card card-pad">
              {chartTab === 'live' ? (
                isDemo ? (
                  <DemoEstimateChart points={demoPoints} />
                ) : (
                  <Co2Chart points={points} thresholds={thresholds} />
                )
              ) : (
                <WeeklyAnalytics days={weeklyData} thresholds={thresholds} error={weeklyError} />
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
