/**
 * Real-Time Data - the live CO2 view: current reading, its level against
 * the configured thresholds, the gateway's current alert state, and a
 * rolling chart of recent readings.
 *
 * Everything here is driven off the shared EventStream context, so this
 * page adds no second WebSocket connection - it reads the same buffer the
 * System Monitor does. The reading derivation, threshold fetch and alert
 * state all come from shared hooks/lib modules that Overview uses too.
 *
 * With more than one device publishing, every stat here (current
 * reading, level, gauge, chart) is a single-value-per-device view, so
 * they all filter to one selected device rather than trying to show
 * several devices' current values at once - a device selector picks
 * which one, defaulting to the first device seen. This is what keeps
 * the chart from silently interleaving two devices' readings into one
 * misleading line.
 */

import { useMemo, useState } from 'react'

import Co2Chart from '../components/Co2Chart.jsx'
import Co2Gauge from '../components/Co2Gauge.jsx'
import {
  DEMO_COLOR,
  DEMO_LABEL,
  DemoEstimateChart,
  DemoReadingValue,
} from '../components/DemoEstimate.jsx'
import { ChartIcon } from '../components/icons.jsx'
import WeeklyAnalytics from '../components/WeeklyAnalytics.jsx'
import { useEventStream } from '../context/eventStreamContext.js'
import { useAnalytics } from '../hooks/useAnalytics.js'
import { useDeviceRegistry } from '../hooks/useDeviceRegistry.js'
import { useDevices } from '../hooks/useDevices.js'
import { getDemoHistoryDeviceIds, useReadings } from '../hooks/useReadings.js'
import { useThresholds } from '../hooks/useThresholds.js'
import { currentAlertState } from '../lib/alerts.js'
import { DEMO_BANDS, DEMO_BANDS_LABEL, DEMO_GAUGE_THRESHOLDS } from '../lib/demoBands.js'
import { LEVEL_COLOR } from '../lib/levels.js'

const ANALYTICS_DAYS = 7
const CHART_TABS = [
  { key: 'live', label: 'Live' },
  { key: 'weekly', label: 'Last 7 Days' },
]

export default function RealTimeData() {
  const { events } = useEventStream()
  const { devices } = useDevices()
  const { thresholds, error: thresholdError } = useThresholds()

  // manualSelection is null until the user picks something from the
  // dropdown; until then, selectedDeviceId derives straight from the
  // roster during render - no effect needed, since GET /devices/status
  // returns devices in first-seen order (a plain Python dict preserves
  // insertion order), so "the first device" is already stable across
  // refetches without needing to be locked in separately.
  //
  // The dropdown lists the REGISTRY (every device in the caller's factories,
  // grouped by factory - see useDeviceRegistry.js), not just devices that have
  // sent a message since the gateway started, so simulated factories can be
  // picked too (they show their stored history even while nothing publishes).
  // Live devices missing from the registry still appear, under "Other devices".
  // Default stays the first live device, falling back to the first registered one.
  const { groups } = useDeviceRegistry()
  const [manualSelection, setManualSelection] = useState(null)
  const selectedDeviceId = manualSelection ?? devices[0]?.device_id ?? groups[0]?.devices[0]?.device_id ?? null

  // The dropdown shows one entry per FACTORY, by name. Choosing it opens that
  // factory's device: the one that has been sending (or that has demo history
  // saved in this browser), otherwise the first listed. A factory with several
  // devices therefore shows just one of them here.
  const liveStatus = new Map(devices.map((device) => [device.device_id, device]))
  const savedDemoIds = new Set(getDemoHistoryDeviceIds())
  const pickDevice = (factoryDevices) =>
    (
      factoryDevices.find((device) => liveStatus.has(device.device_id)) ??
      factoryDevices.find((device) => savedDemoIds.has(device.device_id)) ??
      factoryDevices[0]
    ).device_id
  const factoryOptions = groups.map(({ factory, devices: factoryDevices }) => ({
    factory,
    deviceId: pickDevice(factoryDevices),
    deviceIds: factoryDevices.map((device) => device.device_id),
  }))
  const registeredIds = new Set(factoryOptions.flatMap((option) => option.deviceIds))
  const unregisteredLive = devices.filter((device) => !registeredIds.has(device.device_id))
  const hasAnyDevice = factoryOptions.length > 0 || unregisteredLive.length > 0
  const OTHER_PREFIX = 'device:'
  const selectedOptionValue =
    factoryOptions.find((option) => option.deviceIds.includes(selectedDeviceId))?.factory.id ??
    (selectedDeviceId !== null ? `${OTHER_PREFIX}${selectedDeviceId}` : '')
  function handleDropdownChange(value) {
    if (value.startsWith(OTHER_PREFIX)) {
      setManualSelection(value.slice(OTHER_PREFIX.length))
      return
    }
    const option = factoryOptions.find((candidate) => candidate.factory.id === value)
    if (option) setManualSelection(option.deviceId)
  }

  const { points, demoPoints, demoLevel, current, level } = useReadings(thresholds, selectedDeviceId)
  const isDemo = level === 'DEMO_ESTIMATE'

  const [chartTab, setChartTab] = useState('live')
  const { data: weeklyData, error: weeklyError } = useAnalytics(selectedDeviceId, ANALYTICS_DAYS)

  // THRESHOLD_* events always carry the device_id that triggered them
  // (threshold.py's build_event never omits it), so filtering to the
  // selected device is enough to get that device's own alert state -
  // otherwise a second device's CRITICAL alert could show up while
  // looking at the first device's NORMAL chart.
  const alertState = useMemo(
    () => currentAlertState(events.filter((e) => e.device_id === selectedDeviceId)),
    [events, selectedDeviceId],
  )

  return (
    <div className="page">
      <div className="section-head">
        <div>
          <h1>Real-Time Data</h1>
          <p className="page-subtitle">Live CO₂ readings streamed from the gateway as each one arrives.</p>
        </div>
        <select
          className="device-select"
          value={selectedOptionValue}
          disabled={!hasAnyDevice}
          onChange={(e) => handleDropdownChange(e.target.value)}
        >
          {!hasAnyDevice && <option value="">No factories yet</option>}
          {factoryOptions.map(({ factory, deviceId }) => (
            <option key={factory.id} value={factory.id}>
              {factory.name} {liveStatus.get(deviceId)?.online ? '●' : '○'}
            </option>
          ))}
          {/* A live device that is not in any registered factory: shown by its id, last. */}
          {unregisteredLive.map((device) => (
            <option key={device.device_id} value={`${OTHER_PREFIX}${device.device_id}`}>
              {device.device_id} {device.online ? '●' : '○'}
            </option>
          ))}
        </select>
      </div>

      {thresholdError && <div className="empty error-text">{thresholdError}</div>}

      <section className="section">
        <div className="stat-row">
          <div className="card stat-card">
            <div className="stat-label">Current reading</div>
            <div
              className="stat-value"
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
            <div className="stat-sub">
              {isDemo
                ? `${DEMO_BANDS_LABEL} · warning ≥ ${DEMO_BANDS.warning}, critical > ${DEMO_BANDS.critical} demo ppm · not the real thresholds`
                : thresholds
                  ? `warning ≥ ${thresholds.warning}, critical ≥ ${thresholds.critical} ppm`
                  : 'loading thresholds…'}
            </div>
          </div>

          <div className="card stat-card">
            <div className="stat-label">Gateway alert state</div>
            <div className="stat-value small">{alertState}</div>
            <div className="stat-sub">with cooldown &amp; hysteresis applied</div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>{isDemo ? `Current level (${DEMO_LABEL} · ${DEMO_BANDS_LABEL})` : 'Current level'}</h2>
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
            {chartTab === 'live' && (
              <span className="dim count">{isDemo ? demoPoints.length : points.length} points</span>
            )}
          </div>
        </div>
        <div className="card card-pad">
          {/* Only one of these renders at a time - a separate tab, never
              an overlay on the live chart, per the two views having no
              shared x-axis (per-reading vs per-day). */}
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
    </div>
  )
}
