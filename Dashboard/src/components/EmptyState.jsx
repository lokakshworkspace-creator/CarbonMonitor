/**
 * Illustrated replacement for a plain `<div className="empty">text</div>`
 * - a small growing-sprout SVG (icons.jsx) above the same message that
 * was already there. Applied only to call sites that already rendered
 * plain "no data yet" text (see each page's own diff) - this component
 * does not introduce any empty state that didn't already exist, and it
 * is deliberately NOT used for error messages, loading text, or
 * instructional prompts ("select a record above"), which stay plain text
 * since a growth illustration would misrepresent what those actually are.
 *
 * `children` carries the exact same message content the plain version
 * had (including the odd `<code>` snippet some of them already had) -
 * this is a visual wrapper, not a rewrite of any copy.
 */
import { SproutIllustration } from './icons.jsx'

export default function EmptyState({ children, compact = false }) {
  return (
    <div className={compact ? 'empty empty-illustrated is-compact' : 'empty empty-illustrated'}>
      <SproutIllustration className="empty-sprout" size={compact ? 32 : 48} />
      <div className="empty-illustrated-message">{children}</div>
    </div>
  )
}
