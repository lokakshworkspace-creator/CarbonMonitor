/**
 * Presentation-only display for the physical MQ-135's DEMO_ESTIMATE readings.
 *
 * "Estimated Demo PPM" is an ADC rescale (floor 400, no upper cap; see
 * ESP32/main/main.ino), NOT a CO2 measurement. The chart and levels below are
 * drawn like every other factory's (warning/critical lines and level-coloured
 * dots) so the demo reads consistently, but against the separate DEMO bands
 * (lib/demoBands.js), never the real 1000/2000 ppm thresholds. Every one of
 * them is labelled as a demo estimate, and the levels are display-only: the
 * gateway never evaluates, alerts on, stores or anchors these readings.
 */

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import EmptyState from './EmptyState.jsx'
import { DEMO_BANDS, DEMO_BANDS_LABEL } from '../lib/demoBands.js'
import { LEVEL_COLOR } from '../lib/levels.js'

export const DEMO_COLOR = '#5b9bd5'
const GRID_COLOR = '#232c2e'
const AXIS_COLOR = '#8fa39c'
const TOOLTIP_BG = '#12181a'
const LIVE_LINE_COLOR = '#2fbf8f'

export const DEMO_LABEL = 'DEMO ESTIMATE'

/** Value + caption for the "Current reading" card when the latest reading is a demo estimate. */
export function DemoReadingValue({ current }) {
  return (
    <>
      {current.demo_ppm}
      <span className="stat-unit">ppm</span>
    </>
  )
}

function LevelDot({ cx, cy, payload }) {
  if (cx === undefined || cy === undefined) return null
  return <circle cx={cx} cy={cy} r={3} fill={LEVEL_COLOR[payload.level] ?? LIVE_LINE_COLOR} />
}

export function DemoEstimateChart({ points }) {
  if (points.length === 0) {
    return <EmptyState>Waiting for demo readings…</EmptyState>
  }

  // Same fixed 0-based axis with headroom above the top band that Co2Chart
  // uses above its critical line, so the demo series sits on a similar scale.
  const maxReading = Math.max(...points.map((p) => p.demo_ppm))
  const yMax = Math.max(DEMO_BANDS.critical, maxReading) * 1.15

  return (
    <div className="chart">
      <div style={{ color: DEMO_COLOR, marginBottom: 8, fontSize: 12 }}>
        {DEMO_LABEL} · Physical MQ-135 · {DEMO_BANDS_LABEL} (not the real 1000 / 2000 ppm thresholds)
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="time" stroke={AXIS_COLOR} tick={{ fontSize: 11 }} minTickGap={28} />
          <YAxis stroke={AXIS_COLOR} tick={{ fontSize: 11 }} width={46} domain={[0, Math.round(yMax)]} />
          <Tooltip
            contentStyle={{
              background: TOOLTIP_BG,
              border: `1px solid ${GRID_COLOR}`,
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: AXIS_COLOR }}
            formatter={(value, _name, item) => [
              `${value} demo ppm · ${item.payload.level} (${DEMO_BANDS_LABEL}) · raw ADC ${item.payload.raw_adc ?? '—'}`,
              'Estimated Demo PPM',
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: AXIS_COLOR }} />

          <ReferenceLine
            y={DEMO_BANDS.warning}
            stroke={LEVEL_COLOR.WARNING}
            strokeDasharray="5 4"
            label={{ value: `demo warning ${DEMO_BANDS.warning} (${DEMO_BANDS_LABEL})`, fill: LEVEL_COLOR.WARNING, fontSize: 10, position: 'insideTopRight' }}
          />
          <ReferenceLine
            y={DEMO_BANDS.critical}
            stroke={LEVEL_COLOR.CRITICAL}
            strokeDasharray="5 4"
            label={{ value: `demo critical ${DEMO_BANDS.critical} (${DEMO_BANDS_LABEL})`, fill: LEVEL_COLOR.CRITICAL, fontSize: 10, position: 'insideTopRight' }}
          />

          <Line
            type="monotone"
            dataKey="demo_ppm"
            name="Estimated Demo PPM"
            stroke={LIVE_LINE_COLOR}
            strokeWidth={2}
            dot={<LevelDot />}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
