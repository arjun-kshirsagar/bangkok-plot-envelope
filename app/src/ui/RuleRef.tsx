import { ZONE_RULES } from '../rules'

function firstSentence(text: string, max = 160): string {
  const cut = text.split(/(?<=\.)\s/)[0] ?? text
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut
}

/** Rule ids as small muted references; hover shows clause + one-line formula; flags assumed rules. */
export function RuleRef({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null
  return (
    <span className="rule-refs">
      {ids.map((id) => {
        const rule = ZONE_RULES.rules.find((r) => r.id === id)
        const title = rule ? `${rule.source}\n\n${firstSentence(rule.formula)}` : id
        return (
          <span key={id} className={`rule-ref${rule?.assumed ? ' assumed' : ''}`} title={title} tabIndex={0}>
            {id}
            {rule?.assumed && <span className="assumed-badge">assumed</span>}
          </span>
        )
      })}
    </span>
  )
}
