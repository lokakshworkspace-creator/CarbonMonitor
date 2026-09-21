/**
 * Original, hand-authored inline SVG icons/illustrations for the nature +
 * industrial + climate-action visual pass. Every shape here is written
 * directly in this file - nothing hotlinked, no icon library, no stock
 * imagery - so the whole app keeps rendering with zero network
 * dependency beyond what's already loaded (an unreliable demo-venue
 * connection must never blank out part of the UI).
 *
 * Colors in HeroScene are hardcoded hex, not var(--token) - same reason
 * Co2Chart.jsx/WeeklyAnalytics.jsx already do this for their own SVG
 * output (see those files' own GRID_COLOR/AXIS_COLOR constants): kept in
 * sync with styles.css's :root tokens by hand, deliberately, rather than
 * risk a CSS custom property not resolving consistently inside every
 * inline-SVG context this ends up rendered in. The small line icons
 * below (Leaf/Factory/Chart/ClimateBadge) use currentColor instead - they
 * are always placed inside an element that already sets `color` via CSS
 * (see styles.css's .card-icon-badge and .climate-badge), which is the
 * one context that resolves reliably.
 *
 * Simple geometric line style throughout (rounded strokes, 1.6px weight)
 * for the small icons, so they read as one consistent family rather than
 * a grab-bag - see the project's brief for exactly this requirement.
 */

/** Emissions/CO2 data - a single curved leaf with one vein line. */
export function LeafIcon({ className, size = 14 }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 14C4 8 9 4 19 4c0 10-4 15-10 15-2.2 0-3.6-.5-5-2" />
      <path d="M4 20c3-4 6.5-6.8 11-10" />
    </svg>
  )
}

/** Facility/device cards - a simple factory roofline + chimney. */
export function FactoryIcon({ className, size = 14 }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="13" width="18" height="8" />
      <path d="M6 13V9l4 3V9l4 3V6l4 3v4" />
      <path d="M17 6V4" />
    </svg>
  )
}

/** Analytics views - three ascending bars on an axis. */
export function ChartIcon({ className, size = 14 }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M7.5 17V12M12 17V8M16.5 17v-5" />
    </svg>
  )
}

/**
 * Empty-state illustration ("a small illustrated state" per the brief) -
 * a growing sprout: stem, two leaf lobes at different heights (teal then
 * green, echoing the two accent tokens), and a faint ground ellipse.
 * Deliberately larger/more detailed than the line icons above - this is
 * the one place in the pass meant to read as a small illustration rather
 * than a glyph.
 */
export function SproutIllustration({ className, size = 48 }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="32" cy="56" rx="15" ry="3" fill="var(--text-faint)" />
      <path d="M32 54V30" stroke="var(--accent-2)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M32 34c-10 2-16-4-16-14 10 0 16 6 16 14Z" fill="var(--accent-2)" opacity="0.6" />
      <path d="M32 28c9 2 15-4 15-13-9 0-15 5-15 13Z" fill="var(--accent)" opacity="0.75" />
    </svg>
  )
}

/**
 * Original mark for the SDG-13 credit line (AppFooter.jsx) - NOT a
 * reproduction of the official UN SDG-13 icon (a white numeral "13" and
 * cyclone/eye pictograph on a solid dark circle). This is a distinct,
 * hand-drawn growth/sunlight motif instead: three short rays above a stem
 * with two leaf lobes. Colored via currentColor - .climate-badge
 * (styles.css) sets the forest-green color on its wrapper.
 */
export function ClimateBadgeIcon({ className, size = 15 }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2.5v3" />
      <path d="M7.6 4.6l1.6 2.4" />
      <path d="M16.4 4.6l-1.6 2.4" />
      <path d="M12 21V11" />
      <path d="M12 15c-4 .4-6-2.2-6-6.2 5 0 6 3 6 6.2Z" />
      <path d="M12 12c4 .4 6-2.2 6-6.2-5 0-6 3-6 6.2Z" />
    </svg>
  )
}

/**
 * Decorative background scene for the login screen and sidebar header
 * (styles.css's .hero-banner) - a factory silhouette whose chimney smoke
 * gradually resolves into leaf shapes, connecting into a foliage cluster
 * threaded with thin circuit-trace lines/nodes (echoing plant veins).
 *
 * `preserveAspectRatio="xMinYMid slice"` (left-anchored, not centered):
 * the login page's container is much taller/narrower than this scene's
 * native 800x300 ratio, and a centered crop there was found (by actually
 * screenshotting it, not just reading the markup) to cut the factory
 * silhouette out of view entirely, since it sits in the leftmost fifth of
 * the viewBox - left-anchoring keeps the factory-into-leaves transition
 * on screen in that tall layout, at the cost of cropping some of the
 * rightmost foliage/circuit-trace detail, which is the better trade-off
 * given the brief's emphasis on the smokestack-to-leaf motif specifically.
 * The sidebar strip is short and wide enough that this crops very little
 * either way.
 *
 * Purely decorative (aria-hidden) and non-interactive (focusable=false,
 * and its container sets pointer-events: none in CSS) - it must never be
 * reachable by keyboard nav or intercept a click meant for the content in
 * front of it.
 */
export function HeroScene({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 800 300"
      preserveAspectRatio="xMinYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="heroSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0b0f0e" />
          <stop offset="55%" stopColor="#0f1b17" />
          <stop offset="100%" stopColor="#12271d" />
        </linearGradient>
        <linearGradient id="heroGround" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#173224" />
          <stop offset="100%" stopColor="#0b0f0e" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="800" height="300" fill="url(#heroSky)" />

      {/* rolling ground line */}
      <path d="M0 230C160 210 260 250 400 235S680 205 800 225V300H0Z" fill="url(#heroGround)" />

      {/* factory silhouette, left third */}
      <g fill="#0e1613" stroke="#1c2e26" strokeWidth="1">
        <rect x="40" y="150" width="120" height="80" />
        <path d="M40 150l30-28h60l30 28Z" />
        <rect x="70" y="110" width="14" height="42" />
        <rect x="120" y="95" width="14" height="57" />
      </g>

      {/* smoke drifting up-right from the tallest chimney, resolving from
          plain circles into leaf silhouettes as it rises */}
      <g opacity="0.85">
        <circle cx="127" cy="88" r="6" fill="#3a4a44" />
        <circle cx="140" cy="72" r="8" fill="#3f5a4c" />
        <path d="M158 56c10-4 20 2 22 12-11 3-20-2-22-12Z" fill="#3f7e44" opacity="0.8" />
        <path d="M190 44c12-6 24 0 27 12-13 4-24-2-27-12Z" fill="#3f7e44" />
        <path d="M228 36c14-5 27 3 29 15-14 3-27-4-29-15Z" fill="#2fbf8f" opacity="0.85" />
      </g>

      {/* foliage cluster, right two-thirds */}
      <g fill="#3f7e44">
        <path d="M300 210c30-40 90-46 130-18-32 34-92 42-130 18Z" opacity="0.5" />
        <path d="M420 220c26-46 88-58 132-32-30 40-94 54-132 32Z" opacity="0.65" />
        <path d="M540 205c30-42 94-50 136-20-32 36-96 44-136 20Z" opacity="0.5" />
        <path d="M630 225c24-38 78-46 114-20-26 32-82 40-114 20Z" fill="#2fbf8f" opacity="0.55" />
      </g>

      {/* circuit-trace lines/nodes over the foliage - the plant-vein /
          circuit-trace hybrid the brief calls for */}
      <g stroke="#2fbf8f" strokeWidth="1" opacity="0.35" fill="none">
        <path d="M330 205 L380 190 L420 195 L470 178" />
        <circle cx="380" cy="190" r="2.5" fill="#2fbf8f" />
        <circle cx="470" cy="178" r="2.5" fill="#2fbf8f" />
        <path d="M540 200 L580 182 L625 188 L668 170" />
        <circle cx="580" cy="182" r="2.5" fill="#2fbf8f" />
        <circle cx="625" cy="188" r="2.5" fill="#2fbf8f" />
      </g>
    </svg>
  )
}
