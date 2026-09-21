/**
 * Short footer/about credit - visible on the login screen and from the
 * main authenticated layout's sidebar (App.jsx), per the brief. Purely
 * presentational: no data fetching, no routing.
 *
 * The badge (icons.jsx's ClimateBadgeIcon) is an ORIGINAL mark inspired
 * by the climate-action theme, not a reproduction of the official UN
 * SDG-13 icon/logo - that artwork (a white numeral "13" and a
 * cyclone/eye pictograph on a solid dark circle, plus the UN wordmark) is
 * a UN trademark and is never reproduced anywhere in this codebase. The
 * credit line names the real goal by number and title only ("UN
 * Sustainable Development Goal 13: Climate Action"), the same way any
 * project can factually describe what it aligns with in plain text.
 *
 * Copy is deliberately modest and factual (a monitoring prototype, not a
 * claim of impact) - see the brief's explicit instruction against
 * overstated marketing language here.
 */
import { ClimateBadgeIcon } from './icons.jsx'

export default function AppFooter({ compact = false }) {
  return (
    <div className={compact ? 'app-footer is-compact' : 'app-footer'}>
      <span className="climate-badge">
        <ClimateBadgeIcon />
      </span>
      <p className="app-footer-mission">
        A student capstone monitoring CO₂ emissions via IoT sensors and anchoring the readings on a
        public blockchain for tamper-evident record-keeping. Aligned with UN Sustainable Development
        Goal 13: Climate Action.
      </p>
    </div>
  )
}
